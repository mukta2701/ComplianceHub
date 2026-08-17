# GitHub Collection Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ComplianceHub's sample-only GitHub posture with a private GitHub App that collects deterministic, traceable repository observations into a tenant-safe shadow store without changing readiness, evidence, findings, Slack, or MCP answers.

**Architecture:** This is the first of three releases from the approved GitHub-first automation design. A canonical `github_installations` record owns repository scope; a server-only GitHub App adapter creates short-lived installation tokens; a pure rule evaluator converts bounded API facts into versioned observations; and scheduled, manual, and webhook-triggered runs write only to shadow tables. The existing Nango ticketing connection and existing evidence/finding machinery remain unchanged until the second release deliberately consumes approved observations.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, React 19, Supabase PostgreSQL/RLS/pgTAP, Zod 4, `jose` 6, Vitest 4, Playwright 1.61, Azure Container Apps, GitHub REST API version `2026-03-10`.

## Global Constraints

- Collection is read-only: no repository, issue, workflow, ruleset, or administration writes.
- CI and unit/integration tests make no live GitHub calls; every response comes from sanitised fixtures or injected fetch fakes.
- A GitHub `unknown` or unavailable result must never become `pass`.
- Phase 1 shadow observations must not alter readiness, create evidence, create/resolve findings, send Slack alerts, or change MCP compliance answers.
- GitHub App private keys, client secrets, user tokens, installation tokens, webhook secrets, response headers, source-code bodies, and unnecessary member data must never enter PostgreSQL, logs, browser bundles, or thrown error messages.
- GitHub user access tokens used to verify an installation are discarded immediately after the callback.
- Every new tenant row uses split RLS policies, composite tenant foreign keys, the existing tenant-validation pattern, and `capture_audit_event` where mutable business state is involved.
- Collection is idempotent by GitHub delivery ID, collection request key, and observation fingerprint.
- Repository reads are paginated with `per_page=100`, bounded to 100 selected repositories per installation, and stopped on rate-limit diagnostics.
- Timestamps are UTC ISO strings; user-facing dates remain `en-GB`; scheduled display semantics use `Europe/London`.
- Existing personal Azure staging remains the only deployment target for this release; `.github/workflows/deploy-azure-adtecher-staging.yml` and `infra/azure/foundation*.bicep` are not executed or extended.

---

### Task 1: Provider-neutral observation and rule contracts

**Files:**
- Create: `src/features/github/domain/observation.ts`
- Create: `src/features/github/domain/rules.ts`
- Test: `src/features/github/domain/rules.test.ts`

**Interfaces:**
- Consumes: no network or database APIs.
- Produces: `GitHubFactSet`, `GitHubObservation`, `ObservationResult`, `DiagnosticCode`, `RULE_PACK_VERSION`, `evaluateGitHubRepository(facts, context)`.

- [ ] **Step 1: Write the failing evaluator tests**

Create table-driven tests that prove pass, fail, unknown, and not-applicable behaviour and stable identifiers:

```ts
import { describe, expect, it } from "vitest";
import { evaluateGitHubRepository, RULE_PACK_VERSION } from "./rules";
import type { GitHubFactSet } from "./observation";

const complete: GitHubFactSet = {
  repository: { id: 101, owner: "adtecher", name: "portal", visibility: "private", archived: false, defaultBranch: "main", url: "https://github.com/adtecher/portal" },
  branchProtection: { state: "available", value: { forcePushesBlocked: true, deletionsBlocked: true, approvingReviews: 2, dismissesStaleReviews: true, codeOwnerReviews: true, requiredStatusChecks: ["test"] } },
  dependabot: { state: "available", value: { openHigh: 0, openCritical: 0 } },
  codeScanning: { state: "available", value: { openHigh: 0, openCritical: 0 } },
  secretScanning: { state: "available", value: { enabled: true, pushProtectionEnabled: true, openAlerts: 0 } },
  securityWorkflows: { state: "available", value: [{ name: "CodeQL", active: true, latestConclusion: "success" }] },
  administration: { state: "available", value: { outsideCollaboratorAdmins: 0 } },
};

describe("evaluateGitHubRepository", () => {
  it("emits stable versioned passing observations", () => {
    const first = evaluateGitHubRepository(complete, { runId: "run-1", observedAt: "2026-08-17T12:00:00.000Z" });
    const second = evaluateGitHubRepository(complete, { runId: "run-2", observedAt: "2026-08-17T13:00:00.000Z" });
    expect(first.find((item) => item.checkId === "github.branch.force_pushes")?.result).toBe("pass");
    expect(first.map((item) => item.observationKey)).toEqual(second.map((item) => item.observationKey));
    expect(first.every((item) => item.ruleVersion === RULE_PACK_VERSION)).toBe(true);
  });

  it("never converts denied data into a pass", () => {
    const observations = evaluateGitHubRepository({
      ...complete,
      dependabot: { state: "unavailable", diagnosticCode: "permission_denied" },
    }, { runId: "run-3", observedAt: "2026-08-17T12:00:00.000Z" });
    expect(observations.find((item) => item.checkId === "github.dependabot.high_critical")?.result).toBe("unknown");
  });

  it("marks runtime controls not applicable for archived repositories", () => {
    const observations = evaluateGitHubRepository({
      ...complete,
      repository: { ...complete.repository, archived: true },
    }, { runId: "run-4", observedAt: "2026-08-17T12:00:00.000Z" });
    expect(observations.find((item) => item.checkId === "github.workflow.security")?.result).toBe("not_applicable");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- src/features/github/domain/rules.test.ts`

Expected: FAIL because `./rules` and `./observation` do not exist.

- [ ] **Step 3: Define the observation contract**

Implement the following public types in `observation.ts`:

```ts
export type ObservationResult = "pass" | "fail" | "unknown" | "not_applicable";
export type ObservationSeverity = "low" | "medium" | "high" | "critical";
export type DiagnosticCode = "permission_denied" | "feature_unavailable" | "not_found" | "rate_limited" | "provider_unavailable" | "invalid_response";
export type DataState<T> = { state: "available"; value: T } | { state: "unavailable"; diagnosticCode: DiagnosticCode };

export type GitHubFactSet = {
  repository: { id: number; owner: string; name: string; visibility: "public" | "private" | "internal"; archived: boolean; defaultBranch: string; url: string };
  branchProtection: DataState<{ forcePushesBlocked: boolean; deletionsBlocked: boolean; approvingReviews: number; dismissesStaleReviews: boolean; codeOwnerReviews: boolean; requiredStatusChecks: string[] }>;
  dependabot: DataState<{ openHigh: number; openCritical: number }>;
  codeScanning: DataState<{ openHigh: number; openCritical: number }>;
  secretScanning: DataState<{ enabled: boolean; pushProtectionEnabled: boolean; openAlerts: number }>;
  securityWorkflows: DataState<Array<{ name: string; active: boolean; latestConclusion: string | null }>>;
  administration: DataState<{ outsideCollaboratorAdmins: number }>;
};

export type GitHubObservation = {
  observationKey: string;
  runId: string;
  repositoryId: number;
  checkId: string;
  ruleVersion: string;
  subjectType: "github_repository";
  subjectId: string;
  result: ObservationResult;
  severity: ObservationSeverity | null;
  title: string;
  explanation: string;
  remediation: string | null;
  observedAt: string;
  freshUntil: string;
  sourceUrl: string;
  fingerprint: string;
  diagnosticCode: DiagnosticCode | null;
};
```

- [ ] **Step 4: Implement deterministic rules**

Set `RULE_PACK_VERSION = "github-repository-v1"`; implement explicit rules for repository visibility/archive state, force pushes, deletions, approving reviews, stale approvals, code-owner review, status checks, high/critical Dependabot alerts, high/critical code-scanning alerts, secret scanning, push protection, open secret alerts, approved security workflow state, and outside-collaborator administrators. Use `node:crypto` SHA-256 over canonical JSON for `fingerprint`, use `owner/name/checkId/RULE_PACK_VERSION` for `observationKey`, and set `freshUntil` to `observedAt + 36 hours`.

The evaluator must route unavailable inputs through this helper:

```ts
function unknown(input: RuleContext, diagnosticCode: DiagnosticCode): GitHubObservation {
  return observation(input, {
    result: "unknown",
    severity: null,
    explanation: "GitHub did not provide enough verified information for this check.",
    remediation: "Restore the required GitHub App permission or feature, then run collection again.",
    diagnosticCode,
  });
}
```

- [ ] **Step 5: Run domain tests and commit**

Run: `npm test -- src/features/github/domain/rules.test.ts`

Expected: PASS with all four result states covered.

```bash
git add src/features/github/domain
git commit -m "feat(github): define deterministic repository rules"
```

### Task 2: GitHub App authentication and bounded REST client

**Files:**
- Create: `src/features/github/application/github-app-auth.ts`
- Create: `src/features/github/application/github-api.ts`
- Test: `src/features/github/application/github-app-auth.test.ts`
- Test: `src/features/github/application/github-api.test.ts`

**Interfaces:**
- Consumes: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, injected `fetch`, selected numeric repository IDs.
- Produces: `createAppJwt(config, now)`, `createInstallationToken(input)`, `githubRequest(input)`, `collectInstallationRepositories(input)`.

- [ ] **Step 1: Write failing authentication tests**

Cover RS256 JWT claims (`iat = now - 60`, `exp = now + 540`, `iss = appId`), PEM newline normalisation, missing configuration, a token request restricted to `repository_ids`, no assumptions about token length, and safe errors that contain neither response bodies nor credentials.

```ts
it("requests a short-lived token restricted to selected repository IDs", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    token: "ghs_APPID_JWT_example",
    expires_at: "2026-08-17T13:00:00Z",
  }), { status: 201 }));
  const result = await createInstallationToken({ installationId: 77, repositoryIds: [101, 102], fetchImpl, appJwt: "signed" });
  expect(result.expiresAt).toBe("2026-08-17T13:00:00Z");
  expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ repository_ids: [101, 102] });
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `npm test -- src/features/github/application/github-app-auth.test.ts src/features/github/application/github-api.test.ts`

Expected: FAIL because the adapter files do not exist.

- [ ] **Step 3: Implement GitHub App JWT and installation-token exchange**

Use `importPKCS8` and `SignJWT` from `jose`; reject empty app IDs/keys; allow 1–100 unique positive repository IDs; POST only to `https://api.github.com/app/installations/{id}/access_tokens`; and request no broader permission than:

```ts
const READ_PERMISSIONS = {
  actions: "read",
  administration: "read",
  dependabot_alerts: "read",
  metadata: "read",
  secret_scanning_alerts: "read",
  security_events: "read",
} as const;
```

Never return the token from a route or persist it; keep it only inside the collection call stack.

- [ ] **Step 4: Implement the allowlisted REST client**

`githubRequest` accepts path segments rather than a URL, encodes every segment, enforces the `api.github.com` origin, adds `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2026-03-10`, uses `AbortSignal.timeout(15_000)`, and maps statuses as follows:

```ts
export function diagnosticForStatus(status: number): DiagnosticCode | null {
  if (status === 401 || status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return null;
}
```

Pagination follows only an RFC 8288 `rel="next"` URL whose origin is `https://api.github.com`, caps at 100 pages, and requests `per_page=100`.

- [ ] **Step 5: Run adapter tests and commit**

Run: `npm test -- src/features/github/application/github-app-auth.test.ts src/features/github/application/github-api.test.ts`

Expected: PASS, including pagination, timeout, hostile `Link`, rate-limit, and redaction cases.

```bash
git add src/features/github/application/github-app-auth.ts src/features/github/application/github-api.ts src/features/github/application/*.test.ts
git commit -m "feat(github): add bounded GitHub App client"
```

### Task 3: Tenant-safe GitHub installation and shadow-observation schema

**Files:**
- Create: `supabase/migrations/20260817010000_github_collection_foundation.sql`
- Create: `supabase/tests/database/063_github_collection_foundation.sql`

**Interfaces:**
- Consumes: existing `organisations`, `memberships`, `capture_audit_event`, `is_organisation_member`, `is_organisation_operator`.
- Produces: `github_installations`, `github_repositories`, `github_collection_runs`, `github_observations`, `github_webhook_deliveries`, a service-only `github_oauth_states` replay ledger, and `set_github_repository_selected(...)`.

- [ ] **Step 1: Write the failing pgTAP contract**

The database test must assert:

```sql
select has_table('public', 'github_installations');
select has_table('public', 'github_repositories');
select has_table('public', 'github_collection_runs');
select has_table('public', 'github_observations');
select has_table('public', 'github_webhook_deliveries');
select col_is_pk('public', 'github_installations', 'id');
select has_unique('public', 'github_installations', 'github_installations_provider_id_key');
select has_fk('public', 'github_repositories', 'github_repositories_installation_tenant_fk');
select has_fk('public', 'github_observations', 'github_observations_repository_tenant_fk');
```

Add Owner/Admin/Member/outsider and cross-tenant SELECT/INSERT/UPDATE/DELETE assertions. Browser-authenticated users may read safe installation/repository/run/observation summaries in their own workspace; only the verified server boundary may insert installations, runs, observations, and delivery records. Only workspace operators may change `github_repositories.selected` through a security-definer RPC that checks membership.

- [ ] **Step 2: Run the database test and confirm RED**

Run: `npm run test:db -- 063_github_collection_foundation.sql`

Expected: FAIL because the tables are absent.

- [ ] **Step 3: Add the schema and invariants**

Use these core shapes:

```sql
create type public.github_installation_status as enum ('active', 'suspended', 'revoked', 'needs_attention');
create type public.github_collection_status as enum ('running', 'succeeded', 'partial', 'failed', 'rate_limited');
create type public.github_observation_result as enum ('pass', 'fail', 'unknown', 'not_applicable');

create table public.github_installations (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider_installation_id bigint not null unique check (provider_installation_id > 0),
  account_id bigint not null check (account_id > 0),
  account_login text not null check (account_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'),
  account_type text not null check (account_type in ('Organization', 'User')),
  repository_selection text not null check (repository_selection in ('all', 'selected')),
  status public.github_installation_status not null default 'active',
  connected_by uuid,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organisation_id),
  constraint github_installations_connector_tenant_fk foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id) on delete set null (connected_by)
);
```

`github_repositories` stores provider ID, owner, name, full name, safe HTML URL, visibility, default branch, archive state, `selected boolean default false`, `available boolean default true`, `last_seen_at`, and an optional `removed_at`. Inventory refresh preserves selection for repositories still present, marks omitted repositories unavailable instead of deleting them, and collectors target only available selected repositories. `github_collection_runs` stores trigger (`initial`, `scheduled`, `manual`, `webhook`), request key, status, safe diagnostic code, timestamps, and counts, with unique `(repository_id, request_key)` so one scheduled request can reserve one run per target. `github_observations` stores every field in `GitHubObservation`, uses `(collection_run_id, observation_key)` as the immutable uniqueness boundary, and never stores raw provider payloads. Carry installation IDs through repository, run, and observation rows and use composite consistency foreign keys so a repository cannot be attached to a run from another installation even within the same tenant. A provider installation ID has immutable tenant ownership: reconnect/upsert may refresh its metadata but may never move it between organisations. `github_webhook_deliveries` stores delivery ID, event name, payload SHA-256, safe repository/installation IDs, status, received/processed timestamps, and no raw body. `github_oauth_states` stores only a SHA-256 state hash, bound organisation/actor/pending provider installation IDs, expiry and consumed timestamp; it has no authenticated grants and permits an atomic service-role consume-once operation. Keep the PKCE verifier only in the integrity-protected HttpOnly cookie, not in this table.

- [ ] **Step 4: Add RLS, grants, audit triggers, and safe RPCs**

Use split policies and explicit column grants. The service role receives the minimum SELECT/INSERT/UPDATE needed for collection and no DELETE on shadow history. `set_github_repository_selected(repository_id uuid, selected boolean)` must derive the organisation from the row, require `is_organisation_operator`, reject selecting unavailable repositories, cap selected repositories at 100, and audit the change through the repository update trigger. The OAuth replay ledger has no browser-readable policy and its conditional consume updates only an unconsumed, unexpired row whose complete binding matches.

- [ ] **Step 5: Reset and test the database, then commit**

Run: `npx supabase db reset && npm run test:db`

Expected: all migrations apply from empty and all pgTAP files pass.

```bash
git add supabase/migrations/20260817010000_github_collection_foundation.sql supabase/tests/database/063_github_collection_foundation.sql
git commit -m "feat(github): add tenant-safe shadow collection schema"
```

### Task 4: Verified installation claim flow

**Files:**
- Create: `src/features/github/application/github-user-oauth.ts`
- Create: `src/features/github/application/installation-claim.ts`
- Create: `src/app/api/github/setup/route.ts`
- Create: `src/app/api/github/callback/route.ts`
- Test: `src/features/github/application/github-user-oauth.test.ts`
- Test: `src/features/github/application/installation-claim.test.ts`
- Test: `src/app/api/github/setup/route.test.ts`
- Test: `src/app/api/github/callback/route.test.ts`

**Interfaces:**
- Consumes: authenticated workspace Owner/Admin context, immutable configured `GITHUB_ALLOWED_ACCOUNT_ID`, `installation_id` from GitHub setup redirect, GitHub App user OAuth with PKCE, app JWT verification, service-only transactional claim RPC.
- Produces: one verified `github_installations` record and reconciled repository inventory; no retained user token.

- [ ] **Step 1: Write failing setup and callback tests**

Prove that setup rejects unauthenticated/non-operator callers and malformed or duplicate query inputs. Without `installation_id`, it redirects only to `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`. With `installation_id`, it creates a 32-byte base64url state and PKCE verifier; stores the verifier, pending installation ID, original organisation ID, and original actor ID in one strict versioned integrity-protected `HttpOnly`, `Secure`, `SameSite=Lax`, ten-minute cookie scoped to `/api/github`; stores only the state SHA-256 and complete binding in the service-only replay ledger; and redirects to GitHub OAuth. Prove that callback rejects missing/mismatched/expired/already-consumed state, duplicate parameters, or changed/demoted actor/workspace; only one parallel callback atomically consumes the matching state hash before token exchange; the cookie is cleared before awaited auth/provider work on every terminal path; the code exchange uses `code_verifier`; the installation appears in `GET /user/installations`; app metadata through `GET /app/installations/{id}` matches the requested ID, is not suspended, belongs to the configured Organization account ID, and has exactly the required read permissions; inventory from paginated `GET /user/installations/{id}/repositories` is at most 100 unique canonical repositories owned by that account; a reconnect preserves selection for present repositories and marks omitted repositories unavailable; an existing provider installation cannot move tenants; the user token is discarded; and success redirects exactly to `/app/integrations?github=connected`.

- [ ] **Step 2: Run route and application tests and confirm RED**

Run: `npm test -- src/features/github/application/github-user-oauth.test.ts src/features/github/application/installation-claim.test.ts src/app/api/github/setup/route.test.ts src/app/api/github/callback/route.test.ts`

Expected: FAIL because the claim flow does not exist.

- [ ] **Step 3: Implement OAuth state, PKCE, and user-token exchange**

Read `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` only server-side. Derive a domain-separated cookie MAC key; reject malformed, oversized, or version-mismatched flow cookies. Build the callback URL only from validated `siteUrl()` and the authorize URL with `client_id`, exact `redirect_uri`, random `state`, `code_challenge`, `code_challenge_method=S256`, `allow_signup=false`, and `prompt=select_account`. Exchange the callback code with `POST https://github.com/login/oauth/access_token`, `Accept: application/json`, and a `URLSearchParams` body containing `client_id`, `client_secret`, `code`, exact `redirect_uri`, and `code_verifier`; all provider calls use a 15-second timeout, `cache: "no-store"`, `redirect: "error"`, and trusted-origin bounded pagination. Validate the JSON response and exact token type with Zod; never log or return tokens, secrets, codes, verifiers, provider error strings, or response bodies. Rate-limit setup and callback by actor and source class and return only canonical `303` redirects with no-store, no-referrer, and noindex headers.

- [ ] **Step 4: Verify and claim the installation**

`claimInstallation` must require all three independently verified inputs:

```ts
export type VerifiedInstallationClaim = {
  organisationId: string;
  actorId: string;
  requestedInstallationId: number;
  userInstallationIds: number[];
  appInstallation: {
    id: number;
    account: { id: number; login: string; type: "Organization" | "User" };
    repositorySelection: "all" | "selected";
    permissions: Record<string, string>;
    suspendedAt: string | null;
  };
  repositories: Array<{ id: number; owner: string; name: string; fullName: string; htmlUrl: string; visibility: "public" | "private" | "internal"; archived: boolean; defaultBranch: string }>;
};
```

Reject unless the requested ID is present in `userInstallationIds`, equals `appInstallation.id`, `repositorySelection` is `selected`, `account.type` is `Organization`, numeric `account.id` equals `GITHUB_ALLOWED_ACCOUNT_ID`, the installation is not suspended, and the permission keys and values exactly match `READ_PERMISSIONS`. Treat login as display-only. Canonicalize repositories: positive unique IDs, owner matching the installation account case-insensitively, consistent owner/name/full-name fields, and a rebuilt safe `https://github.com/{owner}/{name}` URL. Then call `claim_github_installation_server(...)`: it advisory-locks the provider installation ID, re-checks current operator membership in the transaction, attributes audit events to that actor with transaction-local claims, enforces immutable tenant ownership, upserts installation metadata and permissions, reconciles at most 100 repositories atomically, preserves selection for present repositories, and marks omitted repositories unavailable. Discard the user token when the function returns.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/features/github/application/github-user-oauth.test.ts src/features/github/application/installation-claim.test.ts src/app/api/github/setup/route.test.ts src/app/api/github/callback/route.test.ts`

Expected: PASS with spoofed installation, cross-workspace, state replay, and token-redaction tests green.

```bash
git add src/features/github/application src/app/api/github
git commit -m "feat(github): verify and claim GitHub App installations"
```

### Task 5: Sanitised repository fact collector

**Files:**
- Create: `src/features/github/application/collect-repository-facts.ts`
- Test: `src/features/github/application/collect-repository-facts.test.ts`
- Modify: `src/features/github/domain/observation.ts`
- Modify: `src/features/github/domain/rules.ts`
- Modify: `src/features/github/domain/rules.test.ts`
- Create: `src/features/github/application/fixtures/repository-complete.json`
- Create: `src/features/github/application/fixtures/repository-denied.json`
- Create: `src/features/github/application/fixtures/repository-unlicensed.json`

**Interfaces:**
- Consumes: `githubRequest`, selected repository identity, short-lived installation token.
- Produces: exactly one `GitHubFactSet`; source responses are discarded after mapping.

- [ ] **Step 1: Write failing fixture-driven tests**

Assert exact requests and output for:

- `GET /repos/{owner}/{repo}`
- `GET /repos/{owner}/{repo}/rules/branches/{default_branch}?per_page=100`
- `GET /repos/{owner}/{repo}/dependabot/alerts?state=open&severity=high,critical&per_page=100`
- `GET /repos/{owner}/{repo}/code-scanning/alerts?state=open&severity=high&per_page=100`
- `GET /repos/{owner}/{repo}/code-scanning/alerts?state=open&severity=critical&per_page=100`
- `GET /repos/{owner}/{repo}/secret-scanning/alerts?state=open&per_page=100`
- `GET /repos/{owner}/{repo}/actions/workflows?per_page=100`
- latest run lookup only for server-configured approved security workflow numeric IDs
- `GET /repos/{owner}/{repo}/collaborators?affiliation=outside&permission=admin&per_page=100`

Tests must prove endpoint-aware status semantics: repository metadata 404 aborts; ordinary 401/403 becomes `permission_denied`; code-scanning 403 and secret-alert 404 become `feature_unavailable`; 429 becomes a typed rate-limit stop; 5xx becomes `provider_unavailable`; malformed JSON becomes `invalid_response`; pagination is bounded; member names are reduced to a count; and no file contents are requested. If the 100-page cap is reached while a next link remains, the corresponding fact is unavailable rather than a partial count.

- [ ] **Step 2: Run the collector test and confirm RED**

Run: `npm test -- src/features/github/application/collect-repository-facts.test.ts`

Expected: FAIL because the collector does not exist.

- [ ] **Step 3: Implement endpoint-specific Zod schemas and safe mapping**

Keep each response schema inside `collect-repository-facts.ts`, `.passthrough()` provider objects, and expose only fields used by `GitHubFactSet`. An endpoint failure affects only its corresponding `DataState`; repository metadata failure aborts the repository because the stable subject cannot be verified. Verify the returned numeric repository ID matches the selected target. Read secret-scanning and push-protection enablement from repository metadata's `security_and_analysis` block; the alert list establishes only the alert count. Refactor the Task 1 fact contract and rules so configuration, push protection, and alert count have separate `DataState` values—known-disabled configuration must fail even when the alert list is unavailable, and no unavailable alert list may become a zero-alert pass.

`collectRepositoryFacts` accepts `approvedSecurityWorkflowIds: readonly number[]`. Treat numeric workflow IDs as the reviewed allowlist; never approve a mutable display name. List workflows, retain only allowlisted IDs, then request `GET /repos/{owner}/{repo}/actions/workflows/{workflowId}/runs?per_page=1`. Empty runs yield `latestConclusion: null`; a failed approved-workflow lookup makes the workflow fact unavailable.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/features/github/application/collect-repository-facts.test.ts src/features/github/domain/rules.test.ts`

Expected: PASS and fixture snapshots contain no tokens, headers, source bodies, or member identities.

```bash
git add src/features/github/application/collect-repository-facts.ts src/features/github/application/collect-repository-facts.test.ts src/features/github/application/fixtures src/features/github/domain
git commit -m "feat(github): collect sanitised repository security facts"
```

### Task 6: Idempotent shadow collection orchestration

**Files:**
- Create: `src/features/github/application/run-collection.ts`
- Create: `src/features/github/application/collection-deps.ts`
- Test: `src/features/github/application/run-collection.test.ts`
- Test: `src/features/github/application/collection-deps.test.ts`
- Create: `src/app/api/cron/github-collect/route.ts`
- Test: `src/app/api/cron/github-collect/route.test.ts`
- Modify: `.github/workflows/azure-maintenance.yml`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: active installations, selected repositories, Tasks 1/2/5, service-role persistence.
- Produces: `runGitHubCollection(deps, request)` and authenticated `POST /api/cron/github-collect`.

- [ ] **Step 1: Write failing orchestration tests**

Use injected fakes to prove one failed repository does not starve another; a duplicate request key returns the existing run; complete observations are inserted once; partial runs contain only complete per-check results; rate limiting stops the installation and records `rate_limited`; no phase-2 dependency is called.

```ts
expect(summary).toEqual({
  installationsChecked: 1,
  repositoriesChecked: 1,
  observationsStored: 15,
  repositoriesFailed: 1,
  runsPartial: 1,
});
expect(deps.createEvidence).not.toHaveBeenCalled();
expect(deps.saveFinding).not.toHaveBeenCalled();
expect(deps.deliverSlack).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run orchestration tests and confirm RED**

Run: `npm test -- src/features/github/application/run-collection.test.ts src/features/github/application/collection-deps.test.ts src/app/api/cron/github-collect/route.test.ts`

Expected: FAIL because the runner and route do not exist.

- [ ] **Step 3: Implement the pure runner and Supabase adapter**

Use this boundary:

```ts
export type CollectionRequest = { trigger: "initial" | "scheduled" | "manual" | "webhook"; requestKey: string; installationId?: string; repositoryId?: string };
export type CollectionDependencies = {
  listTargets(request: CollectionRequest): Promise<CollectionTarget[]>;
  reserveRun(target: CollectionTarget, request: CollectionRequest): Promise<{ id: string; duplicate: boolean }>;
  collectFacts(target: CollectionTarget): Promise<GitHubFactSet>;
  evaluate(facts: GitHubFactSet, context: { runId: string; observedAt: string }): GitHubObservation[];
  refreshRepository(target: CollectionTarget, facts: GitHubFactSet): Promise<void>;
  saveObservations(runId: string, organisationId: string, repositoryId: string, observations: GitHubObservation[]): Promise<number>;
  finaliseRun(runId: string, result: RunResult): Promise<void>;
  now(): Date;
};
```

Database writes use insert-on-conflict/no-op for `(repository_id, request_key)` and `(collection_run_id, observation_key)`. A scheduled request therefore reserves one run per target repository instead of colliding globally. Collection history is append-only; repository inventory fields refresh only after verified metadata; a failure never extends observation freshness.

`CollectionTarget` must distinguish local UUIDs (`installationId`, `repositoryId`) from GitHub numeric IDs (`providerInstallationId`, `providerRepositoryId`) and also carry `organisationId`, `owner`, and `name`. Validate a complete, distinct observation set before one bulk insert: every observation's `runId` matches the reservation and numeric `repositoryId` matches `providerRepositoryId`. A typed safe `GitHubCollectionError` with `diagnosticCode: "rate_limited"` finalises the current run as rate-limited, skips only the remaining targets for that installation, and continues other installations. A complete set containing any `unknown` finalises as `partial`; `not_applicable` alone remains `succeeded`. Finalisation updates only rows still in `running` state.

- [ ] **Step 4: Add the cron route and personal-Azure schedule**

The route uses `isAuthorisedCron`, `createSupabaseServiceClient`, a 300-second maximum duration, safe structured logging, and returns counts only. Never pass raw provider errors to `logError`, because it persists messages and stacks. Add `github-collect` to `workflow_dispatch`; schedule it at `29 5 * * *` so collection completes before existing 06:07 daily maintenance and 07:13 monitoring. Replace the workflow's catch-all route selection with explicit schedule/route cases that fail closed for an unknown value. The scheduled workflow invokes `${SITE_URL}/api/cron/github-collect` with `CRON_SECRET`.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/features/github/application src/app/api/cron/github-collect/route.test.ts && npm run typecheck`

Expected: PASS; the workflow parser accepts `github-collect`; no Adtecher migration workflow changes.

```bash
git add src/features/github/application src/app/api/cron/github-collect .github/workflows/azure-maintenance.yml docs/deployment.md
git commit -m "feat(github): run idempotent shadow collection"
```

### Task 7: Signed webhook intake and replay-safe rechecks

**Files:**
- Create: `src/features/github/application/webhook.ts`
- Test: `src/features/github/application/webhook.test.ts`
- Create: `src/features/github/application/webhook-worker.ts`
- Test: `src/features/github/application/webhook-worker.test.ts`
- Create: `src/app/api/github/webhook/route.ts`
- Test: `src/app/api/github/webhook/route.test.ts`
- Modify: `src/app/api/cron/github-collect/route.ts`
- Modify: `src/app/api/cron/github-collect/route.test.ts`

**Interfaces:**
- Consumes: raw UTF-8 request bytes, `X-Hub-Signature-256`, `X-GitHub-Delivery`, `X-GitHub-Event`, `GITHUB_WEBHOOK_SECRET`.
- Produces: a durably queued verified delivery and, when the bounded worker drains it, a scoped webhook collection request; no direct compliance writes.

- [ ] **Step 1: Write failing signature and replay tests**

Use GitHub's published vector (`secret = "It's a Secret to Everybody"`, payload `Hello, World!`, expected `sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17`). Prove missing/invalid signatures return 401, duplicate delivery returns 202 without re-enqueuing, unsupported events return 202/ignored, malformed payload returns 400 after signature verification, and installation/repository events enqueue only validated numeric routing IDs. Prove the worker atomically claims queued or retryable rows, maps provider IDs to one tenant-scoped local installation/repository, invokes Task 6 with `requestKey: "webhook:<delivery-id>"`, and reaches `processed`, `ignored`, or a safe retryable `failed` state without exposing raw errors.

- [ ] **Step 2: Run webhook tests and confirm RED**

Run: `npm test -- src/features/github/application/webhook.test.ts src/features/github/application/webhook-worker.test.ts src/app/api/github/webhook/route.test.ts src/app/api/cron/github-collect/route.test.ts`

Expected: FAIL because webhook handling does not exist.

- [ ] **Step 3: Implement constant-time verification and allowlisted events**

Read the request stream with a hard 1 MiB bound before JSON parsing; reject a larger declared or streamed body with `413`; calculate HMAC-SHA256 over the exact retained bytes; compare strictly formatted equal-length buffers with `timingSafeEqual`; hash but do not store the body. Allow `installation`, `installation_repositories`, `repository`, `branch_protection_rule`, `repository_ruleset`, `workflow_run`, `dependabot_alert`, `code_scanning_alert`, and `secret_scanning_alert`. Treat sender/repository names as untrusted text and retain only validated positive numeric IDs for routing. Atomically reserve the unique delivery as `queued` and return `202` without waiting for GitHub collection; a duplicate returns `202` and does not create another request.

Add a bounded worker to the existing `github-collect` cron path before scheduled reconciliation. It claims queued rows and stale `processing` rows with an attempt cap, resolves only active installations and selected repositories from stored numeric IDs, then calls `runGitHubCollection`. Installation-wide events remain installation-scoped and Task 6 expands them only to selected repositories. Update delivery lifecycle timestamps and safe diagnostic codes; never store a raw body or provider/database error. The daily scheduled collector remains the recovery path for deliberately rejected oversized deliveries and any webhook that exhausts retries.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/features/github/application/webhook.test.ts src/features/github/application/webhook-worker.test.ts src/app/api/github/webhook/route.test.ts src/app/api/cron/github-collect/route.test.ts`

Expected: PASS with duplicate, malformed, hostile-text, and signature-vector cases green.

```bash
git add src/features/github/application/webhook.ts src/features/github/application/webhook.test.ts src/features/github/application/webhook-worker.ts src/features/github/application/webhook-worker.test.ts src/app/api/github/webhook src/app/api/cron/github-collect
git commit -m "feat(github): accept replay-safe signed webhooks"
```

### Task 8: Owner repository scope and shadow-status UI

**Files:**
- Modify: `src/app/app/integrations/page.tsx`
- Modify: `src/app/app/integrations/connections-catalog.tsx`
- Modify: `src/app/app/integrations/actions.ts`
- Create: `src/features/github/components/github-installation-panel.tsx`
- Test: `src/features/github/components/github-installation-panel.test.tsx`
- Modify: `src/app/app/integrations/page.test.tsx`
- Modify: `src/app/app/integrations/actions.test.ts`

**Interfaces:**
- Consumes: safe installation/repository/latest-run summaries and `set_github_repository_selected` RPC.
- Produces: Owner/Admin install link, repository selection controls, manual shadow recheck, and explicit health text.

- [ ] **Step 1: Write failing UI and action tests**

Prove operators see the private GitHub App panel; Members do not; install uses `/api/github/setup`; selection requires an operator and validated UUID/boolean; 101st selected repository is rejected; manual recheck uses a random request key; status distinguishes Active, Needs attention, Suspended, Partial collection, Never collected, and Stale; `Stale` means the latest completed collection is older than the domain's 36-hour observation-freshness boundary; no observation can be approved or made readiness-affecting in this release.

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `npm test -- src/features/github/components/github-installation-panel.test.tsx src/app/app/integrations/page.test.tsx src/app/app/integrations/actions.test.ts`

Expected: FAIL because the panel and actions do not exist.

- [ ] **Step 3: Implement safe queries, actions, and accessible controls**

Page projections must exclude permissions JSON beyond a persisted derived `permissions_ok` boolean and exclude every credential by construction. Use the tenant-safe latest-run summary view/RPC rather than an unbounded run-history query or per-repository N+1 reads. Keep the existing Nango GitHub connection distinct and label this surface `GitHub App shadow collection`. Repository controls use native checkboxes with labels containing the full repository name; status text uses `role="status"`; the manual recheck button is disabled while pending and reports counts without raw errors. The server action calls the Task 6 runner directly after operator validation and server-side rate limiting; it never calls the cron route or exposes `CRON_SECRET`.

- [ ] **Step 4: Run UI tests and commit**

Run: `npm test -- src/features/github/components/github-installation-panel.test.tsx src/app/app/integrations/page.test.tsx src/app/app/integrations/actions.test.ts && npm run typecheck`

Expected: PASS with axe-compatible labels and operator boundaries.

```bash
git add src/app/app/integrations src/features/github/components
git commit -m "feat(github): manage repository shadow collection"
```

### Task 9: Configuration, full verification, and personal Azure staging rollout

**Files:**
- Modify: `.env.example`
- Modify: `docs/deployment.md`
- Modify: `docs/release-checklist.md`
- Modify: `.github/workflows/deploy-azure-staging.yml`
- Modify: `infra/azure/application.bicep`
- Modify: `src/features/mcp/azure-deployment-contract.test.ts`
- Create: `e2e/github-shadow-collection.spec.ts`

**Interfaces:**
- Consumes: GitHub App registration values and the existing rollback-safe personal Azure deployment.
- Produces: documented, secret-safe deployment and recorded shadow-collection proof for one dedicated test repository.

- [ ] **Step 1: Write failing deployment-contract and E2E tests**

Require these server-only variables/secrets: `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_SLUG`, and `GITHUB_ALLOWED_ACCOUNT_ID`. Assert none is a Docker build arg, `NEXT_PUBLIC_*` value, workflow log line, health response, or client bundle reference. E2E covers mocked install inventory, selecting one test repository, manual collection, and viewing shadow results without any readiness delta.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- src/features/mcp/azure-deployment-contract.test.ts && npx playwright test e2e/github-shadow-collection.spec.ts --workers=1`

Expected: FAIL because the secret-slot contract and E2E flow are absent.

- [ ] **Step 3: Extend rollback-safe secret slots and documentation**

Extend the existing inactive-slot staging and revision activation steps in `.github/workflows/deploy-azure-staging.yml` and the corresponding secret references in `infra/azure/application.bicep`; preserve the previous revision's values during rollback; pass only secret references to Container Apps. Document GitHub App registration as private, Adtecher-only, read-only; set `GITHUB_ALLOWED_ACCOUNT_ID` to the immutable numeric Adtecher organisation ID; leave GitHub's `Request user authorization (OAuth) during installation` option disabled because it prevents the setup-URL flow; use exact callback `/api/github/callback`, setup `/api/github/setup`, and webhook `/api/github/webhook`; subscribe only to the events from Task 7; and use one dedicated test repository.

- [ ] **Step 4: Run complete local verification**

Run:

```bash
npx supabase db reset
npm run test:db
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test e2e/github-shadow-collection.spec.ts --workers=1
```

Expected: every command exits 0; no live GitHub request occurs.

- [ ] **Step 5: Commit the release configuration**

```bash
git add .env.example docs/deployment.md docs/release-checklist.md .github/workflows/deploy-azure-staging.yml infra/azure/application.bicep src/features/mcp/azure-deployment-contract.test.ts e2e/github-shadow-collection.spec.ts
git commit -m "chore(github): prepare personal Azure shadow rollout"
```

- [ ] **Step 6: Perform the external registration checkpoint**

In GitHub, create or update the private App with the documented URLs and read-only permissions. Add its secrets to the existing personal Azure staging GitHub environment. Do not add them to `.env.local`, repository secrets visible to forks, application tables, or the Adtecher Azure environment.

- [ ] **Step 7: Deploy with the existing personal Azure workflow**

Run the `Deploy Azure staging` workflow with `deploy=true`. Confirm the immutable image digest, new Container Apps revision, health check, OAuth/MCP contract check, and rollback target. Do not run `Deploy Azure Adtecher staging`.

- [ ] **Step 8: Execute and record the shadow proof**

Install the App on one dedicated Adtecher test repository, select it in ComplianceHub, run collection, and record:

- installation/account safe identifiers;
- selected repository safe identifier;
- collection run ID, start/end time, status, and counts;
- manual comparison of each observation with GitHub settings;
- proof that readiness, existing evidence/findings, MCP answers, and Slack delivery did not change;
- proof that a repeated run creates no duplicate request or observations.

Store the redacted proof in `docs/deployment/github-shadow-pilot.md` and commit it. Stop before enabling evidence or findings; that is the second release plan.

## Plan boundary and follow-up releases

This plan completes rollout stages 1–3 of the approved design: live GitHub App connection, one dedicated repository, shadow collection, and manual comparison. The following work receives separate implementation plans after the shadow proof passes:

1. Mapping approval plus evidence/finding lifecycle, including fresh-pass-only resolution and extended finding states.
2. MCP/Slack/web consumption, confirmation-gated GitHub Issue creation, and the ten-business-day pilot.
