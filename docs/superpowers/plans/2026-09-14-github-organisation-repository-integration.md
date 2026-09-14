# GitHub Organisation and Repository Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Milestone 1 so a ComplianceHub Owner can securely connect the company-owned private GitHub App, discover the full authorised repository inventory, select the pilot repository, and rely on automatic connection/scope health reporting without ComplianceHub changing GitHub or creating compliance outcomes.

**Architecture:** Harden the existing GitHub connection boundary instead of rebuilding it. Keep GitHub as the authorisation provider, add complete bounded repository discovery, give connection reconciliation its own durable state and finite runner, route connection webhooks away from later Monitoring materialisation, reuse the existing in-app/Slack delivery foundation for sanitised incidents, and expose health only in Settings → Connections. Package the runner in the same immutable container image as the Next.js web service; deploy to the company-controlled AWS staging environment only after the company administrator supplies and approves the required environment contract.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5, Node.js 22, Supabase/PostgreSQL with RLS and pgTAP, Zod 4, `jose` 6, Vitest 4, React Testing Library, Playwright 1.61, Docker, Amazon ECR, ECS Fargate, EventBridge Scheduler, Secrets Manager/KMS and CloudWatch.

**Spec:** `docs/superpowers/specs/2026-09-14-github-organisation-repository-integration-design.md`

## Global Constraints

- Milestone 1 owns trusted GitHub connection, repository scope and operational health only. It must not create or update official Evidence, Findings, remediation Tasks, control decisions, readiness scores or general Platform Automation jobs.
- Request exactly six repository permissions, all read-only: `metadata`, `administration`, `actions`, `vulnerability_alerts`, `security_events`, and `secret_scanning_alerts`. Reject missing, stronger or additional permissions. Do not request `contents`.
- Keep the two scope layers distinct: the GitHub App must be installed with **Only select repositories** first, then a ComplianceHub Owner chooses the active product scope. Discovery may exceed the installation-token selection cap; a single installation token remains limited to at most 100 explicitly selected repository IDs.
- Owner may install, reconnect, disconnect and change repository scope. Admin may inspect safe connection health only. Member must not reach connection configuration or diagnostics.
- There is no Automation page or enable switch. A valid connection and selected repository automatically participate in connection reconciliation.
- Keep direct GitHub App/OAuth authorisation. Do not introduce Nango or another hosted connection broker into this GitHub App path.
- Do not persist or log GitHub user tokens, installation tokens, private keys, client secrets, webhook secrets, complete raw webhook bodies, provider response bodies or source code.
- Webhook intake remains bounded, signed and replay-safe. Connection events may trigger connection reconciliation; later Monitoring events must not create compliance outcomes while this milestone is being accepted.
- Treat temporary, rate-limited, authentication, permission, suspension, repository-removal and provider-not-found outcomes separately. Never turn unavailable provider data into a healthy state.
- Automatic recovery may retry and re-verify only. It must never reinstall the GitHub App, broaden its permissions, reselect a removed repository or widen either scope layer.
- Emit at most one sanitised incident notification and one matching recovery notification for the same open incident. Routine healthy reconciliation stays quiet.
- Use one dedicated pilot repository for live acceptance. Company-wide repository rollout, production GitHub App creation and production AWS release are separate decisions.
- Keep Supabase for authentication, PostgreSQL and storage during this milestone.
- AWS infrastructure values are company inputs, not application defaults. Missing account, region, network, IAM, DNS, logging, retention, budget or alert-destination approval blocks AWS execution; it must not be guessed.
- Read the relevant checked-in Next.js 16.3 guides in `node_modules/next/dist/docs/` before changing Route Handlers, Server Actions, environment handling or self-hosting behavior.
- Follow red-green-refactor for every behavior change. Do not weaken existing tests or historical acceptance claims.
- Run heavy checks sequentially through `node --import=tsx scripts/local-resource-guard.ts -- <command>` as required by `docs/local-resource-guard.md`.
- After each coherent task, run focused checks, update `docs/release-checklist.md` with truthful evidence, commit only intended files and push `origin/codex/milestone-1-github-integration`. Do not merge, deploy, alter provider configuration or expose secrets without the task's explicit gate.

## Planned File Structure

The implementation deepens the existing `src/features/github` module and adds only the following focused seams:

```text
src/features/github/
├── domain/
│   ├── connection-health.ts
│   └── connection-health.test.ts
├── application/
│   ├── github-user-oauth.ts                 # complete user-authorised discovery
│   ├── installation-claim.ts                # canonical full inventory
│   ├── github-installation-api.ts           # scheduled App/installation reads
│   ├── github-installation-api.test.ts
│   ├── reconcile-github-connection.ts        # one installation reconciliation
│   ├── reconcile-github-connection.test.ts
│   ├── github-connection-store.ts            # service-only persistence adapter
│   ├── github-connection-store.test.ts
│   ├── github-connection-alerts.ts           # safe incident/recovery projection
│   ├── github-connection-alerts.test.ts
│   ├── run-github-connection-cycle.ts        # bounded scheduled/webhook cycle
│   └── run-github-connection-cycle.test.ts
└── components/
    ├── github-connection-health.ts
    └── github-connection-health.test.ts

scripts/
├── github-connection-reconcile.ts            # finite ECS command
├── github-connection-reconcile.test.ts
└── validate-aws-staging-contract.ts

supabase/
├── migrations/
│   ├── 20260914110000_complete_github_installation_discovery.sql
│   ├── 20260914110001_github_connection_reconciliation.sql
│   └── 20260914110002_github_connection_alerts.sql
└── tests/database/
    ├── 102_complete_github_installation_discovery.sql
    ├── 103_github_connection_reconciliation.sql
    └── 104_github_connection_alerts.sql

e2e/github-connection-milestone.spec.ts
.github/workflows/deploy-aws-staging.yml
docs/deployment/aws-staging-github-pilot.md
docs/evidence/2026-09-14-github-connection-local.md
docs/evidence/2026-09-14-github-connection-aws-staging.md
docs/evidence/2026-09-14-github-connection-live-provider.md
```

Existing files are modified where their current behavior is already the correct seam. Do not create a generic provider framework or duplicate the existing Slack transport.

---

## Phase 1 — Freeze the Security and Runtime Contract

### Task 1: Centralise and prove the exact GitHub App contract

**User-visible outcome:** Misconfigured deployments fail safely, and the product can truthfully explain that its GitHub connection is read-only and restricted to the approved company account.

**Demonstration:** Focused tests reject every missing, additional or write-level permission; reject a non-company account or `all` repository selection; and prove that secrets cannot appear in returned diagnostics.

**Files:**

- Modify: `src/features/github/application/github-runtime-config.ts`
- Modify: `src/features/github/application/github-runtime-config.test.ts`
- Modify: `src/features/github/application/github-app-auth.ts`
- Modify: `src/features/github/application/github-app-auth.test.ts`
- Modify: `src/features/github/application/installation-claim.ts`
- Modify: `src/features/github/application/installation-claim.test.ts`
- Modify: `src/app/api/github/setup/route.ts`
- Modify: `src/app/api/github/setup/route.test.ts`
- Modify: `src/app/api/github/callback/route.ts`
- Modify: `src/app/api/github/callback/route.test.ts`
- Modify: `.env.example`

### Interfaces

Keep `READ_PERMISSIONS` as the only exported permission object and add one server-only configuration entry point:

```ts
export type GitHubConnectionConfig = {
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
  allowedAccountId: number;
  allowedAccountType: "Organization" | "User";
};

export function getGitHubConnectionConfig(): GitHubConnectionConfig;
export function hasExactReadPermissions(value: unknown): value is typeof READ_PERMISSIONS;
```

`allowedAccountType: "User"` remains legal only for the existing local development/test exception. AWS staging requires `Organization`.

### Steps

- [ ] Write failing config tests for all eight GitHub variables, escaped PEM newlines, a positive safe account ID, the local-only `User` exception and fixed redacted errors.
- [ ] Write table-driven failing permission tests for each missing permission, one added permission, one `write` value and one unexpected permission value.
- [ ] Run `npm test -- src/features/github/application/github-runtime-config.test.ts src/features/github/application/github-app-auth.test.ts src/features/github/application/installation-claim.test.ts src/app/api/github/setup/route.test.ts src/app/api/github/callback/route.test.ts` and confirm the new cases fail for the expected missing contract.
- [ ] Implement `getGitHubConnectionConfig()` and route setup/callback/authentication callers through it. Do not return secret-bearing configuration from a Route Handler or Server Component.
- [ ] Implement one exact-permission comparison and use it for both installation claim and later reconciliation.
- [ ] Update `.env.example` comments to identify server-only secrets, the staging `Organization` rule and the absence of `contents`/write access. Keep values fictional.
- [ ] Rerun the focused tests and expect all to pass.
- [ ] Run `npm run typecheck` and `npm run lint` through the local resource guard.
- [ ] Commit and push: `git commit -m "refactor(github): centralise connection security contract"`.

**Phase 1 gate:** Configuration and permission facts have one tested source of truth. This is automated source proof only; no GitHub App has been inspected yet.

---

## Phase 2 — Complete Repository Discovery and Atomic Scope Binding

### Task 2: Follow the full authorised repository inventory

**User-visible outcome:** An Owner connecting a large GitHub installation sees the complete authorised repository inventory rather than a rejected or silently truncated first page.

**Demonstration:** A 201-repository fixture follows three trusted pages, stores 201 unique stable identities atomically, and still limits an individual installation-token request to at most 100 explicitly selected repositories.

**Files:**

- Modify: `src/features/github/application/github-user-oauth.ts`
- Modify: `src/features/github/application/github-user-oauth.test.ts`
- Modify: `src/features/github/application/installation-claim.ts`
- Modify: `src/features/github/application/installation-claim.test.ts`
- Modify: `src/app/api/github/callback/route.test.ts`
- Add: `supabase/migrations/20260914110000_complete_github_installation_discovery.sql`
- Add: `supabase/tests/database/102_complete_github_installation_discovery.sql`
- Modify: `supabase/tests/database/076_owner_only_github_installation_claim.sql`

### Interfaces

```ts
export const MAX_GITHUB_DISCOVERY_PAGES = 100;
export const MAX_DISCOVERED_REPOSITORIES = 10_000;

export async function collectUserInstallationRepositories(input: {
  userToken: string;
  installationId: number;
  fetchImpl?: typeof fetch;
}): Promise<UserInstallationRepository[]>;
```

The function must require one stable `total_count`, follow only `api.github.com` `rel="next"` links, force `per_page=100`, reject duplicate IDs, reject a changed total, reject more than 100 pages/10,000 repositories and fail the complete claim on any partial page. It must not return the user token.

The replacement `claim_github_installation_server(...)` keeps the current signature, Owner/workspace checks, account binding and transactionality. It raises the verified discovery bound from 100 to 10,000 without changing the separate 100-selected-repository rule used for installation tokens.

### Steps

- [ ] Replace the old “at most 100” OAuth test with failing tests for three-page success, hostile next origin, repeated page, duplicate ID, changed total, missing final rows and the 10,000-item bound.
- [ ] Add a failing canonical-claim test that accepts 101 unique repositories while rejecting 10,001, malformed ownership and duplicate identities.
- [ ] Run the three focused TypeScript test files and confirm RED because discovery currently reads only one page and claim canonicalisation caps at 100.
- [ ] Implement complete bounded pagination and canonical ordering by stable provider repository ID before persistence.
- [ ] Write pgTAP tests proving a 101-row claim is atomic, unavailable old repositories are preserved with `available=false`/`removed_at`, returned repositories cannot cross installations or workspaces, and only an Owner can claim.
- [ ] Implement the replacement RPC without weakening its advisory lock, composite ancestry, RLS, grants or audit actor.
- [ ] Run the focused TypeScript tests, then `bash scripts/test-db-isolated.sh supabase/tests/database/102_complete_github_installation_discovery.sql` (or the repository's supported focused pgTAP command).
- [ ] Run the complete database suite once because the RPC is security-sensitive.
- [ ] Commit and push: `git commit -m "fix(github): discover complete installation repository scope"`.

**Phase 2 gate:** Full provider-authorised inventory is stored truthfully and atomically. No repository is yet claimed healthy merely because it was discovered.

---

## Phase 3 — Durable Connection Health Without Compliance Judgments

### Task 3: Add the connection-health state machine and reconciliation ledger

**User-visible outcome:** ComplianceHub can distinguish healthy access, temporary retry, partial scope loss, Owner action required and disconnection without borrowing Monitoring/Evidence status.

**Demonstration:** Domain tests cover every transition; pgTAP proves tenant isolation, bounded leasing, stale-lease recovery, incident identity and historical preservation.

**Files:**

- Add: `src/features/github/domain/connection-health.ts`
- Add: `src/features/github/domain/connection-health.test.ts`
- Add: `supabase/migrations/20260914110001_github_connection_reconciliation.sql`
- Add: `supabase/tests/database/103_github_connection_reconciliation.sql`
- Modify: `supabase/tests/database/063_github_collection_foundation.sql`

### Domain interfaces

```ts
export type GitHubConnectionHealth =
  | "healthy"
  | "retrying"
  | "partially_unavailable"
  | "owner_action_required"
  | "disconnected";

export type GitHubConnectionDiagnostic =
  | "provider_rate_limited"
  | "provider_temporary_failure"
  | "installation_suspended"
  | "installation_revoked"
  | "permission_mismatch"
  | "account_mismatch"
  | "repository_unavailable"
  | "invalid_provider_response"
  | "internal_failure";

export type ConnectionReconciliationDecision = {
  health: GitHubConnectionHealth;
  retryAt: string | null;
  openIncident: boolean;
  closeIncident: boolean;
  diagnostic: GitHubConnectionDiagnostic | null;
};

export function decideConnectionReconciliation(input: {
  previousHealth: GitHubConnectionHealth;
  consecutiveFailures: number;
  outcome: "success" | "partial" | "temporary_failure" | "action_required" | "disconnected";
  diagnostic: GitHubConnectionDiagnostic | null;
  now: string;
  providerRetryAt?: string | null;
}): ConnectionReconciliationDecision;
```

### Database contract

Add safe health fields to `github_installations`: `health`, `last_reconciliation_attempt_at`, `last_successful_reconciliation_at`, `consecutive_reconciliation_failures`, `next_reconciliation_at`, `health_diagnostic_code`, `reconciliation_locked_by`, and `reconciliation_locked_until`.

Add `github_connection_reconciliation_runs` with full `(installation_id, organisation_id)` ancestry, `trigger` (`initial`, `scheduled`, `webhook`), opaque `request_key`, terminal status, safe diagnostic, timestamps and counts only. Do not store provider bodies or tokens.

Provide service-only functions:

```sql
claim_due_github_connection_reconciliations_server(target_worker_id uuid, target_limit integer, target_now timestamptz)
finalize_github_connection_reconciliation_server(target_run_id uuid, target_worker_id uuid, target_outcome text, target_diagnostic_code text, target_next_attempt_at timestamptz, target_repository_snapshot jsonb)
```

The finaliser must use compare-and-set lease ownership, update installation/repository truth atomically, preserve removed history and return whether an incident opened, remained open or recovered.

Provide one authenticated Owner-only lifecycle command:

```sql
disconnect_github_installation(target_installation_id uuid)
returns boolean
```

It must derive the actor/workspace from the authenticated context, mark the installation `disconnected`, stop future claims, make every repository unavailable/unselected, preserve all historical rows and emit the existing audit trail. It must not call GitHub, delete the provider installation or imply that GitHub-side access was revoked.

### Steps

- [ ] Write failing table-driven domain tests for first success, one temporary failure, threshold-crossing persistent failure, provider rate-limit time, partial repository loss, exact-permission failure, suspension, revocation and successful recovery.
- [ ] Run the domain test and confirm RED because the state machine does not exist.
- [ ] Implement the pure state machine with fixed retry policy: temporary failures retry after 1, 5 and 15 minutes; the third consecutive temporary failure opens an incident; serious access failures open immediately; provider rate-limit time wins when later; successful verification resets the failure count.
- [ ] Write failing pgTAP tests for schema, composite foreign keys, safe column grants, Owner/Admin read visibility, Member denial, claim bounds, `SKIP LOCKED`, stale lease recovery, idempotent request keys, CAS finalisation, cross-workspace denial and no compliance-record writes.
- [ ] Add failing pgTAP cases proving only an Owner can disconnect, disconnection preserves history, no future work is claimed and a repeated disconnect is harmless.
- [ ] Implement the migration and service-only RPCs. Preserve existing installation/repository audit behavior.
- [ ] Rerun focused domain and database tests, followed by the full database suite.
- [ ] Commit and push: `git commit -m "feat(github): add durable connection reconciliation state"`.

**Phase 3 gate:** Connection health now has its own durable, tenant-safe meaning. It still has no provider adapter or user-facing status.

---

## Phase 4 — Verify Provider State Automatically

### Task 4: Implement one fail-closed installation reconciliation

**User-visible outcome:** ComplianceHub can independently verify that the connected organisation, exact permissions and repository scope still match the approved connection.

**Demonstration:** Provider-shaped fixtures prove healthy, changed permission, suspended/revoked, removed repository, renamed repository, rate-limited and malformed-response outcomes without persisting credentials.

**Files:**

- Add: `src/features/github/application/github-installation-api.ts`
- Add: `src/features/github/application/github-installation-api.test.ts`
- Add: `src/features/github/application/reconcile-github-connection.ts`
- Add: `src/features/github/application/reconcile-github-connection.test.ts`
- Add: `src/features/github/application/github-connection-store.ts`
- Add: `src/features/github/application/github-connection-store.test.ts`
- Modify: `src/features/github/application/github-app-auth.ts`
- Modify: `src/features/github/application/github-app-auth.test.ts`

### Interfaces

```ts
export type InstallationSnapshot = {
  installationId: number;
  account: { id: number; login: string; type: "Organization" | "User" };
  repositorySelection: "selected";
  permissions: typeof READ_PERMISSIONS;
  suspendedAt: string | null;
  repositories: UserInstallationRepository[];
};

export async function readInstallationSnapshot(input: {
  installationId: number;
  appJwt: string;
  installationToken: string;
  fetchImpl?: typeof fetch;
}): Promise<InstallationSnapshot>;

export async function reconcileGitHubConnection(
  deps: ReconcileGitHubConnectionDependencies,
  claim: ClaimedGitHubConnectionReconciliation,
): Promise<GitHubConnectionReconciliationResult>;
```

The adapter uses the App JWT for installation identity/permissions and a short-lived in-memory installation token for paginated installation repositories. It classifies 401/403, 404, 429, 5xx, timeout and invalid data without including provider content. It validates the stored company account and exact permission set before marking success.

### Steps

- [ ] Write failing adapter tests for safe URL construction, 100-page pagination, duplicate/change detection, fixed API origin/version, timeout, rate-limit reset handling and redacted errors.
- [ ] Write failing reconciliation tests for every domain outcome and prove `finalize` is called once with a safe canonical snapshot or safe diagnostic only.
- [ ] Run focused tests and confirm RED because the installation-level provider boundary does not exist.
- [ ] Implement `readInstallationSnapshot()` using the existing JWT/token exchange helpers. Keep credentials in the call stack only and discard references after use.
- [ ] Implement the persistence adapter over the Phase 3 RPCs; validate every database row with Zod before use.
- [ ] Implement `reconcileGitHubConnection()` as the single orchestration seam for one claimed installation. Do not import collection, observation, mapping or materialisation modules.
- [ ] Add an import-boundary test proving `reconcile-github-connection.ts` cannot depend on `run-collection.ts`, `rules.ts`, `materialise-approved-observations.ts`, Evidence, Finding or Task modules.
- [ ] Run all new tests plus existing GitHub App/OAuth/webhook tests, typecheck and lint.
- [ ] Commit and push: `git commit -m "feat(github): reconcile installation and repository access"`.

**Phase 4 gate:** A single installation can be verified independently and safely. Repeated/scheduled work and alerts remain unfinished.

---

## Phase 5 — Webhook and Scheduled Execution

### Task 5: Separate connection events from Monitoring and add a bounded cycle

**User-visible outcome:** Installation and repository changes are noticed promptly, while scheduled reconciliation repairs missed events automatically; neither path creates compliance outcomes.

**Demonstration:** One test cycle drains connection events, claims due installations, reconciles each at most once and exits. Monitoring events remain available to their existing worker and connection events never invoke collection/materialisation.

**Files:**

- Modify: `src/features/github/application/webhook-worker.ts`
- Modify: `src/features/github/application/webhook-worker.test.ts`
- Add: `src/features/github/application/run-github-connection-cycle.ts`
- Add: `src/features/github/application/run-github-connection-cycle.test.ts`
- Add: `scripts/github-connection-reconcile.ts`
- Add: `scripts/github-connection-reconcile.test.ts`
- Modify: `supabase/migrations/20260914110001_github_connection_reconciliation.sql`
- Modify: `supabase/tests/database/103_github_connection_reconciliation.sql`
- Modify: `package.json`
- Modify: `package-lock.json`

### Interfaces

Extend claimed webhook parsing with `eventName`. Add a service-only claim RPC dedicated to `installation`, `installation_repositories` and `repository`; update the existing generic claim so the two consumers cannot claim the same delivery class.

```ts
export type GitHubConnectionCycleSummary = {
  executionId: string;
  webhookDeliveriesClaimed: number;
  installationsClaimed: number;
  healthy: number;
  retrying: number;
  actionRequired: number;
  recovered: number;
  ownershipLost: number;
};

export async function runGitHubConnectionCycle(input: {
  executionId: string;
  maximumWebhookDeliveries: number;
  maximumInstallations: number;
  timeBudgetMs: number;
  signal?: AbortSignal;
}): Promise<GitHubConnectionCycleSummary>;
```

The production command accepts bounded numeric environment configuration, records a safe execution ID/summary, returns exit code 0 only when the cycle completed within its contract and exits. It contains no timer loop.

### Steps

- [ ] Write failing pgTAP tests that connection-only and Monitoring webhook claims are mutually exclusive, replay-safe and lease-recoverable.
- [ ] Write failing worker tests proving connection events schedule/claim connection reconciliation and never call `runGitHubCollection` or `reconcileApprovedGitHubObservations`.
- [ ] Write failing cycle tests for duplicate webhook/schedule convergence, claim bounds, time budget, abort handling, one-installation failure isolation and safe summary output.
- [ ] Run focused tests and confirm the new contracts fail.
- [ ] Add the filtered claim behavior and event name to persistence mapping.
- [ ] Implement `runGitHubConnectionCycle()` with bounded sequential processing first. Do not add concurrency until provider/runtime measurements justify it.
- [ ] Add `scripts/github-connection-reconcile.ts` as a thin production entry point with `SIGTERM`/`SIGINT` abort handling and no secret logging.
- [ ] Add `github:reconcile-connections` to `package.json` for local execution through `node --conditions=react-server --import=tsx`.
- [ ] Run focused unit/database tests, then one fictional local cycle twice and prove the second execution does not duplicate work.
- [ ] Commit and push: `git commit -m "feat(github): run bounded connection reconciliation cycles"`.

**Phase 5 gate:** Automatic connection reconciliation works locally through webhooks plus a finite scheduled command. This is not the Milestone 3 general Automation engine.

---

## Phase 6 — Quiet Incidents and Confirmed Recovery

### Task 6: Project health incidents into in-app and Slack notifications

**User-visible outcome:** Owners/Admins receive one useful alert when GitHub access needs attention and one recovery notice when it is genuinely verified again; temporary one-off failures remain quiet.

**Demonstration:** Tests open one incident after the configured threshold, deduplicate repeated failures, send safe in-app/Slack payloads, resolve only after provider verification and send one recovery notice.

**Files:**

- Add: `supabase/migrations/20260914110002_github_connection_alerts.sql`
- Add: `supabase/tests/database/104_github_connection_alerts.sql`
- Add: `src/features/github/application/github-connection-alerts.ts`
- Add: `src/features/github/application/github-connection-alerts.test.ts`
- Modify: `src/features/monitoring/application/slack-alert-queue.ts`
- Modify: `src/features/monitoring/application/slack-alert-queue.test.ts`
- Modify: `src/features/monitoring/application/slack-alert-store.ts`
- Modify: `src/features/github/application/run-github-connection-cycle.ts`
- Modify: `src/features/github/application/run-github-connection-cycle.test.ts`

### Interfaces

Add `github_connection_incidents` with installation/workspace ancestry, stable incident key, safe diagnostic class, `opened_at`, `last_observed_at`, `resolved_at` and audit history. Extend the existing durable `alert_deliveries` subject contract to accept `github_installation` without pretending it is an `integration_connection`.

```ts
export type GitHubConnectionNotice = {
  kind: "incident" | "recovery";
  installationId: string;
  organisationId: string;
  accountLogin: string;
  health: "partially_unavailable" | "owner_action_required" | "disconnected" | "healthy";
  diagnostic: GitHubConnectionDiagnostic | null;
  occurredAt: string;
  connectionHref: "/app/integrations";
};

export async function queueGitHubConnectionNotice(
  deps: GitHubConnectionAlertDependencies,
  notice: GitHubConnectionNotice,
): Promise<{ inAppQueued: number; slackQueued: number }>;
```

Slack payloads may contain organisation-safe account name, plain-language state, occurrence time and an authenticated ComplianceHub link. They must not contain repository contents, credentials, raw provider bodies, internal stack traces or AWS identifiers.

### Steps

- [ ] Write failing pgTAP tests for one open incident per installation/diagnostic, repeated-observation updates, one resolution, Owner/Admin in-app recipients, Member exclusion, Slack idempotency, workspace ancestry and safe payload constraints.
- [ ] Write failing application tests for immediate serious alert, delayed persistent-temporary alert, quiet one-off failure, no duplicate, one recovery and destination-unavailable behavior.
- [ ] Run focused tests and confirm RED.
- [ ] Implement the incident table/RPCs and extend the durable alert subject constraints without weakening existing Monitoring/Jira delivery guarantees.
- [ ] Add the GitHub connection payload formatter to the existing Slack queue. Keep delivery transport/retry ownership in the existing Slack worker.
- [ ] Queue notices only from an atomic reconciliation transition result; never infer recovery from a retry request or scheduler success.
- [ ] Run focused tests, the complete Slack alert tests and the full database suite.
- [ ] Commit and push: `git commit -m "feat(github): notify connection incidents and recovery"`.

**Phase 6 gate:** Persistent/serious connection failures and verified recoveries are durable, deduplicated and safely deliverable. A configured live Slack destination is not yet proven.

---

## Phase 7 — Truthful Settings → Connections Experience

### Task 7: Present human connection health with exact role behavior

**User-visible outcome:** Owners can manage the GitHub connection and scope; Admins can understand health without seeing unusable controls; Members cannot reach the configuration. Status text is concise, human and actionable.

**Demonstration:** Desktop/mobile component and browser tests show pre-connection, healthy, retrying, partial, action-required and disconnected states for Owner/Admin, plus Member redirect and the corrected Monitoring prompt.

**Files:**

- Add: `src/features/github/components/github-connection-health.ts`
- Add: `src/features/github/components/github-connection-health.test.ts`
- Modify: `src/features/github/components/github-installation-panel.tsx`
- Modify: `src/features/github/components/github-installation-panel.test.tsx`
- Modify: `src/app/app/integrations/page.tsx`
- Add or modify: `src/app/app/integrations/page.test.tsx`
- Modify: `src/features/github/components/github-collection-health-panel.tsx`
- Modify: `src/features/github/components/github-collection-health-panel.test.tsx`
- Modify: `src/app/app/integrations/actions.ts`
- Modify: `src/app/app/integrations/actions.test.ts`
- Add: `e2e/github-connection-milestone.spec.ts`

### Presentation interface

```ts
export type GitHubConnectionPresentation = {
  label: "Healthy" | "Retrying" | "Partly unavailable" | "Owner action required" | "Disconnected";
  summary: string;
  nextAction: string | null;
  tone: "success" | "warning" | "danger" | "neutral";
  checkedAt: string | null;
};

export function presentGitHubConnectionHealth(input: {
  health: GitHubConnectionHealth;
  diagnostic: GitHubConnectionDiagnostic | null;
  lastSuccessfulReconciliationAt: string | null;
  now: string;
}): GitHubConnectionPresentation;

export async function disconnectGitHubInstallationAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string }>;
```

Example healthy copy: “GitHub is connected and the pilot repository was checked five minutes ago. No action is needed.” Example failure copy: “ComplianceHub cannot currently verify GitHub access. We are retrying automatically; an Owner has been notified because the App permission may have changed.”

### Steps

- [ ] Write failing presenter tests for every health/diagnostic combination, relative-time boundaries and no invented action or success.
- [ ] Write failing component/page tests proving Owner controls, Admin read-only facts, Member route denial, exact six-permission display, full repository totals, selected/available distinction and protected GitHub installation link.
- [ ] Add a failing regression test for the existing Monitoring inconsistency: Admin must see “Ask a workspace Owner to connect GitHub” and no link/button that implies Admin can manage the App.
- [ ] Run the focused tests and confirm RED.
- [ ] Implement the pure presentation mapper and extend the safe installation query with health/freshness fields. Do not expose raw `permissions` to Member or an unrestricted client component; project only the exact approved labels.
- [ ] Update `GitHubInstallationPanel` with plain-language status, last successful check, exact permissions and scope facts. Keep repository mutations Owner-only and remove any enable/disable language.
- [ ] Gate the Monitoring connection prompt with `canManageOperation("manage-github-app")`, not general Connections management.
- [ ] Implement the Owner-only disconnect Server Action over `disconnect_github_installation`; preserve historical identity, stop future reconciliation and never claim that the GitHub-side installation was removed.
- [ ] Use the existing secure setup route for deliberate reconnection; do not add a second OAuth flow.
- [ ] Run the focused component/page/action tests and Playwright desktop/mobile scenario against fictional data.
- [ ] Run accessibility checks for status announcements, focus order, control labels and narrow-screen containment.
- [ ] Commit and push: `git commit -m "feat(github): show truthful connection health and scope"`.

**Phase 7 gate:** The complete Milestone 1 experience is demonstrable locally with fictional provider-shaped data. This does not prove live GitHub, Slack or AWS.

---

## Phase 8 — One Immutable Image and Company AWS Staging Gate

### Task 8: Package the finite runner in the production image

**User-visible outcome:** The exact application release can run as either the web service or one finite connection-reconciliation task, without a permanent timer or separate source build.

**Demonstration:** CI builds one image; its default command serves Next.js; an ECS-style command override runs one bounded fictional reconciliation cycle and exits; neither image inspection nor logs reveal secrets.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `Dockerfile`
- Add: `scripts/build-runtime-bundles.ts`
- Add: `scripts/build-runtime-bundles.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/deployment.md`

### Runtime contract

- Add `esbuild` as a pinned development dependency.
- `npm run build:runtimes` bundles `scripts/github-connection-reconcile.ts` to `dist/github-connection-reconcile.mjs` for Node 22.
- The Docker builder runs runtime bundling and `next build`; the final non-root image contains both `.next/standalone` and the bundled command.
- Default command remains `node server.js`.
- ECS reconciliation command override is exactly `node dist/github-connection-reconcile.mjs`.

### Steps

- [ ] Write a failing bundle test that builds the entry point, starts it with fully fictional/injected dependencies, confirms one cycle and confirms clean exit.
- [ ] Add the pinned bundler and implement the bundle script with a deterministic output path and sourcemap policy that does not copy source or secrets into the final image.
- [ ] Modify the Dockerfile to copy the runtime bundle into the same final non-root image.
- [ ] Extend CI container checks to run the web command health smoke and the finite runner command with safe fictional configuration; assert the runner exits within the time budget.
- [ ] Scan the final image history/environment and captured logs for the fixture secrets used by the test.
- [ ] Run the production container checks sequentially through the resource guard locally.
- [ ] Update deployment documentation to distinguish the two commands and their evidence limits.
- [ ] Commit and push: `git commit -m "build(github): package finite reconciliation runner"`.

### Task 9: Obtain and validate the company AWS staging contract

**Operational outcome:** Infrastructure work starts only with an approved company account and does not invent networking, IAM, retention, DNS or alert policy.

**Demonstration:** A checked-in validator fails for each missing/unsafe input and passes a company-admin-supplied, non-secret staging contract. The approved values themselves remain in the company control plane, not in Git.

**Files:**

- Add: `scripts/validate-aws-staging-contract.ts`
- Add: `scripts/validate-aws-staging-contract.test.ts`
- Add: `docs/deployment/aws-staging-github-pilot.md`
- Modify: `.env.example`

### Required company-owned inputs

The validator requires: AWS account ID; region; ECR repository; ECS cluster; web service and task family; reconciliation task family; private subnet IDs; web and runner security-group IDs; load-balancer listener/target-group identifiers; staging HTTPS origin; Route 53/ACM decision; web, runner, scheduler and deploy role ARNs; GitHub OIDC subject policy; Secrets Manager ARNs; KMS key ARN; CloudWatch log groups and retention days; EventBridge schedule name/time zone/cadence; scheduler DLQ ARN; alarm destination; Slack compliance destination; budget owner/threshold; Supabase egress approval; rollback owner; and allowed IaC/CI path.

### Steps

- [ ] Write failing validator tests for every required field, production account misuse, non-HTTPS origin, public runner subnet, wildcard role indication, zero/indefinite retention and missing budget/alarm ownership.
- [ ] Implement validation without calling AWS or printing values classified as sensitive.
- [ ] Write the staging runbook: responsibility table, required resources, secret injection, callback/webhook URLs, task commands, rollback, evidence capture and explicit “no production” boundary.
- [ ] Ask the company AWS/security administrator to supply and approve the contract through the company's secret/configuration process.
- [ ] Run the validator against that supplied environment and record only pass/fail, approver, date and safe resource identifiers.
- [ ] Stop here if any input or the allowed IaC/CI path is missing. Do not create an alternate personal AWS environment.
- [ ] Commit and push the validator/runbook: `git commit -m "docs(aws): define github staging acceptance contract"`.

**Phase 8 gate:** The shared image is ready and the company AWS contract is approved. Until Task 9 passes, AWS deployment tasks are blocked by the company AWS/security administrator—not by application code.

---

## Phase 9 — Deploy and Accept the Staging Pilot

### Task 10: Deploy through the approved company path

**Operational outcome:** The company AWS staging environment runs the exact tested image as an ECS web service and finite EventBridge-triggered reconciliation task with company-controlled secrets, logging and alarms.

**Demonstration:** The immutable image digest matches CI; HTTPS app/callback/webhook routes work; manual and scheduled tasks exit safely; CloudWatch observes a deliberate failed/missed task; DLQ and rollback work.

**Files:**

- Add after Task 9 approval: `.github/workflows/deploy-aws-staging.yml`
- Modify after Task 9 approval: `docs/deployment/aws-staging-github-pilot.md`
- Add: `docs/evidence/2026-09-14-github-connection-aws-staging.md`
- Modify: `docs/release-checklist.md`

If the company mandates an external IaC/deployment repository, the workflow change belongs there and this repository records only the reviewed interface and evidence link. Do not create competing IaC here. The exact supplemental infrastructure plan must name the company-approved repository/files before implementation begins.

### Steps

- [ ] Confirm the allowed IaC/CI path recorded in Task 9 and review the exact deployment diff with the company administrator.
- [ ] Add/update the approved OIDC deployment workflow with `id-token: write`, `contents: read`, a protected staging environment and no permanent AWS access keys.
- [ ] Build once, push the immutable digest to ECR, update both web and reconciliation task definitions to that digest, and keep the EventBridge schedule inactive.
- [ ] Inject the eight GitHub values from Secrets Manager/runtime configuration; keep `NEXT_PUBLIC_*` values limited to genuinely public configuration and set a stable `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` for multi-instance Next.js.
- [ ] Verify ALB HTTPS, health routes, callback URL and bounded webhook endpoint before installing the App.
- [ ] Run the reconciliation command manually with no installation and confirm a safe zero-work exit.
- [ ] Activate EventBridge for connection reconciliation only; verify finite exit, non-overlap, CloudWatch logs, heartbeat/alarm and scheduler DLQ.
- [ ] Deliberately fail a staging task without exposing a credential, prove independent operations alerting, restore the accepted task definition and prove recovery.
- [ ] Prove rollback to the previous accepted image/task definition and then restore the candidate digest.
- [ ] Record exact digest, environment, date, checks, limitations and administrator acceptance in the AWS evidence file.
- [ ] Commit/push repository-owned workflow/evidence changes. Do not call this production acceptance.

### Task 11: Run the one-repository live GitHub and Slack rehearsal

**User-visible outcome:** The company can connect its private staging GitHub App to one approved pilot repository, see current scope health, and receive useful incident/recovery notices.

**Demonstration:** Owner installation, Admin read-only view, Member denial, repository removal/re-addition, permission failure/recovery, webhook replay and scheduled repair all work against the live provider without any GitHub write.

**Files:**

- Add: `docs/evidence/2026-09-14-github-connection-live-provider.md`
- Modify: `docs/release-checklist.md`
- Modify only if a defect is found: the smallest affected implementation/test files, through a separate red-green task and commit.

### Steps

- [ ] Company GitHub administrator creates/uses the private staging App with exactly the six read permissions, approved callback/webhook URLs and only the dedicated pilot repository.
- [ ] Company secret administrator loads the private key, client secret and webhook secret into the approved Secrets Manager entries and records the 90-day rotation owner/date without exposing values.
- [ ] A ComplianceHub Owner completes setup and verifies the company organisation identity and complete available repository inventory.
- [ ] The Owner selects only the pilot repository; verify no write request appears in GitHub audit/provider logs.
- [ ] An Admin views organisation, selected scope, exact permissions, freshness and safe incidents with no install/reconnect/scope controls.
- [ ] A Member is denied the connection configuration and diagnostics.
- [ ] Replay a captured delivery ID through the approved test mechanism and prove no duplicate processing. Do not store the raw payload in repository evidence.
- [ ] Remove the pilot repository from the GitHub App scope, prove fail-closed `partially_unavailable`/action guidance and one in-app plus one Slack incident.
- [ ] Restore the approved repository, wait for a genuine provider reconciliation and prove one recovery notice with no duplicated incident.
- [ ] Temporarily exercise an approved permission/suspension failure only if the GitHub administrator judges it safe; otherwise record it as fixture/AWS proof, not live proof.
- [ ] Verify a missed webhook is repaired by scheduled reconciliation.
- [ ] Record provider App identity, repository identifier, tested image digest, safe event IDs/times, results and limitations. Do not record credentials, raw payloads or source content.
- [ ] Obtain explicit ComplianceHub Owner and company AWS/security administrator acceptance.
- [ ] Commit and push only sanitised evidence/status changes: `git commit -m "docs(github): record milestone 1 staging acceptance"`.

**Phase 9 gate:** Milestone 1 is accepted only when automated checks, local fictional demonstration, AWS staging proof, live GitHub proof and human acceptance are all current and separately recorded.

---

## Final Verification Matrix

Run these in order, not in parallel, on the final candidate:

- [ ] Focused GitHub domain/application/route/component tests pass.
- [ ] `npm run test:integration` passes against the isolated local database.
- [ ] `npm run test:db:upgrade` proves an existing schema upgrades safely.
- [ ] `npm run test:db` passes, including tests 102–104.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes with any intentional skips identified.
- [ ] `npm run build` passes under the resource guard.
- [ ] Production Docker web and finite-runner commands pass from the same image digest.
- [ ] `e2e/github-connection-milestone.spec.ts` passes on desktop and mobile against a production-mode local preview with fictional data.
- [ ] Secret scan passes for source, Git history delta, image history and captured logs.
- [ ] Local fictional evidence explicitly says it is not live-provider or AWS proof.
- [ ] AWS evidence identifies company staging, exact image digest and administrator acceptance.
- [ ] Live-provider evidence identifies one approved pilot repository and proves read-only requests, incident/recovery deduplication and scheduled repair.
- [ ] `docs/release-checklist.md` distinguishes implemented code, automated checks, local demonstration, AWS staging, live provider, Slack delivery, human acceptance, production and wider rollout.

## Milestone 1 Definition of Done

Milestone 1 is complete only when:

1. the staging GitHub App requests exactly the six approved read permissions and only selected repositories;
2. an Owner can connect the verified company organisation, discover the complete available inventory and select one pilot repository;
3. an Admin has a truthful read-only health view and a Member cannot reach connection configuration;
4. webhook plus scheduled reconciliation verify connection/scope without producing compliance outcomes;
5. revoked/changed access fails closed and emits one sanitised incident plus one verified recovery in-app and Slack;
6. the same immutable image runs the healthy web service and finite ECS reconciliation task in company AWS staging;
7. secrets remain in the approved company control plane, installation/user tokens are not persisted, raw webhook payloads are not retained and GitHub receives no write request;
8. automated, local, AWS, live-provider and human evidence are current, separately labelled and accepted by the ComplianceHub Owner and company AWS/security administrator.

Production rollout, more repositories, additional permissions, compliance evaluation (Milestone 2), general Platform Automation (Milestone 3), full AWS production acceptance (Milestone 4) and the company-wide MCP assistant (Milestone 5) remain outside this plan.
