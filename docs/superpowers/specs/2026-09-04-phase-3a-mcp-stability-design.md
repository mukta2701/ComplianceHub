# Phase 3A — MCP Stability and Usability Design

Date: 2026-09-04
Status: Design approved in chat; independent design review passed; awaiting user review of the committed specification
Owner: ComplianceHub

## Objective

Make the existing local ComplianceHub web application and MCP connection reliably usable by a non-technical operator before expanding the MCP tool surface. Phase 3A removes connection ambiguity, makes the least-privilege OAuth path repeatable, provides safe local demo sign-in recovery, and exposes honest connection guidance in the web application.

Phase 3A is complete only when a fresh Codex process can authenticate through the supported command, read the correct `ComplianceHub Local Demo` workspace, return the current GitHub result set, and reconcile with the authenticated web application without selecting a stale connector.

## Current verified state

- The canonical local application origin is `http://127.0.0.1:3100`.
- The canonical local MCP resource is `http://127.0.0.1:3100/mcp`.
- Local Supabase Auth and data services use `http://127.0.0.1:54321`.
- The MCP server metadata name is `compliancehub-internal`; the current Codex configuration name is `compliancehub-local`.
- The MCP advertises seven read or preparation tools. `post_daily_digest` is disabled.
- The latest verified GitHub result set contains 15 results: eight pass, five fail, and two unknown.
- The basic MCP slice is working, but the larger Phase 3 company-wide read surface remains Phase 3B work.
- A previously installed personal plugin selected a different empty workspace. That plugin has been uninstalled; the canonical direct MCP configuration remains.

## Root cause being addressed

The application and database remained healthy while the user experienced two authentication failures:

1. The visible browser tab had no valid application session and correctly redirected `/app` to `/sign-in`.
2. `codex mcp login compliancehub-local` was run without an explicit scope list. The current Codex client then requested all standard scopes advertised by the Supabase authorization server, including `phone`. ComplianceHub intentionally permits only `openid`, `profile`, `email`, and optional `offline_access`, so the consent action rejected the request.

The supported Codex command exposes a `--scopes` option. Phase 3A must use that option rather than weakening the consent boundary or adding phone-number access.

## Design principles

1. **Least privilege remains binding.** Phase 3A must not add `phone`, write, administrative, GitHub mutation, or Slack delivery scopes.
2. **One canonical connection.** Operator guidance and proof must name `compliancehub-local`. A stale hosted or personal plugin must never be silently selected as a fallback.
3. **No operating-system control from the web app.** The web application may display connection guidance and health, but it must never run `codex`, alter `~/.codex`, or install or remove plugins from an HTTP request.
4. **Local convenience cannot become a hosted backdoor.** One-click demo sign-in and local proof display are available only in explicit server-side loopback demo mode, with exact loopback origin checks, local Supabase checks, a clean stamped release, and a server-only credential. A production-built application may use this mode only on the exact local loopback stack; hosted and non-loopback deployments always fail closed.
5. **Connection claims require proof.** The UI reports OAuth authorization only from the existing Supabase grant list, endpoint availability only from application-owned health checks, and local client verification only from a current redaction-safe runtime proof that still reconciles with the database. These are separate states; none implies another.
6. **Failures are actionable and safe.** Messages name the recovery action without exposing OAuth codes, bearer tokens, refresh tokens, credentials, database errors, or raw provider payloads.

## Component design

### 1. Canonical local MCP setup command

Add an application-owned local setup utility and package commands with static arguments:

- `npm run demo:start` is the verification-supported local start command. It validates a clean release-relevant source/configuration tree, builds the application, injects the exact clean `HEAD` SHA as `COMPLIANCEHUB_RELEASE_SHA`, enables server-only `COMPLIANCEHUB_LOCAL_DEMO_MODE=1`, and starts the immutable production build with the equivalent of `next start --hostname 127.0.0.1 --port 3100`. It fails if it cannot bind exactly that IPv4 loopback listener.
- `npm run mcp:doctor` performs read-only checks.
- `npm run mcp:login` invokes the supported Codex OAuth login with the exact scopes `openid,profile,email,offline_access`.
- `npm run mcp:smoke` performs one bounded read-only verification against `compliancehub-local` and prints a single safe summary line.
- `npm run mcp:acceptance` runs the release-only owned-server network proof when port 3100 is intentionally free; it is not part of everyday sign-in recovery.

The doctor verifies:

- the application health endpoint returns healthy database status and a non-`unknown` `releaseSha` equal to the exact clean local `HEAD` SHA;
- the process serving port 3100 is bound only to `127.0.0.1`, with no wildcard, non-loopback IPv4, externally reachable IPv6, or additional listener for that port;
- protected-resource metadata names the exact resource and advertises exactly `openid`, `email`, and `profile`; `offline_access` is requested at login but is not a protected-resource scope;
- `codex mcp get compliancehub-local --json` reports an enabled streamable-HTTP entry targeting the exact canonical resource;
- that entry enables exactly the seven approved read/preparation tools and disables `post_daily_digest`;
- `codex plugin list --json` confirms that the known conflicting `compliancehub-internal@personal` plugin is not installed.

The doctor must not read or print credentials, inspect browser storage, decode access tokens, mutate Codex configuration, uninstall plugins, or perform GitHub/Slack network writes. A missing or conflicting entry produces one exact recovery command and exits non-zero.

The shared release-identity helper fails `demo:start`, `mcp:smoke`, and `mcp:acceptance` when `HEAD` is unavailable; when any tracked release-relevant source or configuration differs from `HEAD`; or when any untracked runtime source/configuration file could affect the build. The checked path set includes application/runtime source, public assets, runtime configuration, package manifests and the scripts used by these commands, while excluding test-only files, documentation, evidence, ignored artifacts, and other files that cannot enter the build. Ordinary `npm run dev` remains available for active development, reports `releaseSha: "unknown"`, and can never produce or display **Client verified**.

The login utility must execute only:

```text
codex mcp login compliancehub-local --scopes openid,profile,email,offline_access
```

The wrapper accepts no pass-through arguments, inherits the interactive terminal so the user sees and approves the normal consent page, and never rewrites the generated authorization URL. Raw interactive OAuth output is never copied into a transcript or evidence artifact because it may contain a short-lived authorization URL or code.

Operator smoke and release acceptance are deliberately separate:

1. `mcp:smoke` works against the already-running canonical application. It first requires the shared release-identity check and `/api/health.releaseSha` to equal the same exact clean `HEAD`. It reuses the existing deterministic MCP validator, database reconciliation, artifact schema/redaction helpers, static server call-path checks, and before/after protected-state hash primitives from `scripts/mcp-github-read-proof.ts`. It then runs `codex exec --ephemeral --sandbox read-only --json --ignore-user-config --strict-config` with static configuration overrides that expose only `compliancehub-local` at the doctor-verified canonical resource and a fixed final-output schema. It machine-parses JSONL tool events, ignores final prose, rejects shell, web, any other MCP server, any unapproved tool, or any event it cannot verify, and requires successful calls using only `list_workspaces`, `get_compliance_overview`, and `list_github_compliance_results`. If the installed Codex event format cannot expose verifiable MCP server, tool, and structured-result data, this gate fails rather than inferring success from text. The complete operator smoke is enclosed by protected-state snapshots which must remain identical.
2. `mcp:acceptance` requires the same clean `HEAD`, injects that SHA into its owned server, and extends the existing owned-server lifecycle in `scripts/mcp-proof-owned-server.ts`, including its guarded server network ledger. It runs only when port 3100 is intentionally free, binds its owned child only to `127.0.0.1`, proves that exact listener identity, rejects wildcard/non-loopback/additional listeners, and never stops or restarts an existing application process. It writes a new Phase 3A release artifact and never overwrites historical Phase 2 or Phase 3.0 proof.

During operator smoke, GitHub results are requested first with `{workspaceId, limit: 50}` and then with the exact returned cursor and unchanged filters until `nextCursor` is null. The accumulated result set must have no duplicate IDs and must contain exactly 15 active/current records from the single newest terminal database collection run: eight pass, five fail, two unknown, and zero not-applicable. Workspace identity, overview source, every readiness field, collection run identifier/time, and result identities/outcomes must equal the independently queried web/database projection. The operator smoke and the latest release acceptance must both pass for the same source commit before the local client proof is written.

### 2. OAuth consent and recovery behavior

The existing scope allowlist remains `openid`, `email`, `profile`, and `offline_access`. The existing rejection tests for `phone`, mixed supported-plus-phone requests, and arbitrary write scopes remain binding.

The consent page must explain the four supported scopes in plain language. When the request contains unsupported access, the safe failure view must say that the connection requested more identity access than ComplianceHub allows and direct the local operator to the canonical `npm run mcp:login` command. It must not reflect the rejected scope token or authorization identifier.

Refresh tokens remain client-side OAuth credentials managed by Codex and Supabase Auth. ComplianceHub does not store them in an application table. A fresh login revokes or replaces only the named local connection grant when the client performs that behavior; Phase 3A does not revoke unrelated applications.

### 3. Local demo sign-in recovery

Add a local-only **Open demo workspace** action to the sign-in page. The button is rendered only when every render-time guard passes:

- server-only `COMPLIANCEHUB_LOCAL_DEMO_MODE=1` is present;
- the configured site origin is exactly `http://127.0.0.1:3100`;
- the configured Supabase origin is the exact local loopback project;
- the request Host is the exact configured loopback site;
- the server-only demo email and password are present.

The server action always exists but revalidates every render-time guard, requires the exact loopback Origin, and applies a bounded local rate limit before attempting authentication. It performs an ordinary Supabase password sign-in and creates the same normal user session as the existing form. Through that resulting user session, it then verifies that the authenticated user is an active member of the fixed `ComplianceHub Local Demo` workspace. A mismatch signs the user out and fails generically. The action does not use an anonymous privileged lookup, admin session, service-role session minting, magic link, or browser-visible credentials. The password must remain in an ignored local runtime environment file and must never enter source, HTML, JavaScript, URLs, logs, screenshots, test snapshots, or evidence artifacts.

The demo-mode flag is never exposed to client JavaScript. Outside the complete exact loopback configuration, the action is absent and its server endpoint fails closed without attempting authentication. Hosted or non-loopback environments have no usable demo shortcut, including production builds and environments where an attacker sets the flag or sends matching form fields.

The ordinary email/password sign-in remains available and unchanged.

### 4. AI assistant status in the web application

The existing Settings information is reorganized into a user-facing **AI assistant** status panel. It shows:

- display name: **ComplianceHub Internal**;
- local Codex connection name: `compliancehub-local`;
- access mode: **Read-only and recommendation-only**;
- the seven read/preparation tools the server offers and the business areas they currently cover;
- MCP endpoint availability;
- the current user's existing connected-application authorization grants, if any, without implying that a grant identifies or proves this MCP resource;
- whether a current local client verification proof exists, including the real proof time and safe result when present;
- a copyable example question;
- collapsed recovery instructions containing `npm run mcp:doctor` and `npm run mcp:login`.

The panel must not claim that Codex or ChatGPT is connected merely because the `/mcp` endpoint is healthy. It distinguishes:

- **Endpoint available** — the application can serve MCP requests;
- **Application authorization approved** — the existing Supabase grant list contains a current application grant; the UI names that application but does not describe the grant as a live MCP connection or bind it to this resource;
- **Client verified** — a redaction-safe local smoke proof completed successfully and still matches the current database projection;
- **Needs verification** — no current proof exists or the proof is stale;
- **Configuration problem** — the application cannot serve the canonical metadata safely.

The primary Settings surface remains non-technical. Commands stay inside an administrator disclosure. Monitoring continues to contain findings and scan controls; Settings contains only connection status and recovery.

### 5. Redaction-safe local proof artifact

The smoke utility writes one bounded JSON artifact to `artifacts/mcp-runtime-proof.json`. The existing `artifacts/` ignore rule keeps it out of source control, and the writer uses an atomic replacement with owner-only file permissions. This is a local diagnostic proof, not a compliance record and not a substitute for the immutable database audit trail.

The artifact contains only:

- proof kind and schema version;
- canonical resource origin;
- client label (`Codex local`);
- workspace identifier and safe workspace name;
- tool names exercised;
- overview source and the complete readiness object;
- latest GitHub collection run identifier and collection time;
- returned GitHub result count and outcome counts;
- started, completed, and expiry timestamps;
- success or safe failure category;
- mandatory source commit identifier, equal to the verified runtime health SHA.

It must not persist or expose tokens, authorization identifiers, PKCE material, email addresses, commands containing secrets, raw model output, raw GitHub payloads, private repository contents, or provider error bodies. Failed smoke runs remove any previous success artifact before starting and never leave a success-shaped record behind.

The proof expires exactly 60 minutes after completion. The Settings server component may read this file only when server-only loopback demo mode and every exact site/Supabase/release guard pass, including under the production build started by `demo:start`. It validates the schema, canonical origin, expiry, non-`unknown` runtime health SHA, matching mandatory source SHA in both proof artifacts, successful operator-smoke database-safety gate, successful named-Codex event gate, workspace membership, every readiness field, latest GitHub collection run identifier, and every current result identity/outcome before displaying **Client verified**. A missing, malformed, expired, source-dirty, mismatched, remotely configured, or unreadable artifact becomes **Needs verification** without exposing its contents. Hosted and non-loopback environments never read or display local proof files, regardless of build mode or supplied flags.

Phase 3A adds no proof table and writes no audit event during MCP verification. A durable tenant-scoped production verification record, if later required, belongs to Phase 5 and requires a separate reviewed design.

## Data flow

### MCP login

1. The operator runs `npm run mcp:doctor`.
2. The doctor validates the local endpoint and named Codex configuration without mutation.
3. The operator runs `npm run mcp:login` if authorization is missing or expired.
4. Codex starts OAuth with the exact four approved scopes and PKCE.
5. Supabase Auth redirects to the ComplianceHub consent page.
6. The signed-in user approves the displayed identity and refresh access.
7. Codex stores its OAuth credential; ComplianceHub stores no raw client credential.
8. `npm run mcp:smoke` completes the live database-safety/reconciliation gate and the machine-parsed named-Codex gate; it writes the ignored local client proof only when a same-commit release-acceptance artifact also exists.
9. Settings displays the latest verified status.

### Local demo sign-in

1. The local sign-in page evaluates server-side environment and exact Host guards.
2. When all guards pass, it renders **Open demo workspace**.
3. The server action revalidates every render guard, exact Origin, and rate limit, then performs ordinary password authentication with server-only environment values.
4. Supabase creates a normal browser session subject to the existing RLS policies.
5. The user is redirected to `/app` and sees the fixed local demo workspace.

## Error handling

- App or database unavailable: doctor reports **Local ComplianceHub is not healthy** and the exact start command; it does not attempt OAuth.
- Missing Codex entry: doctor reports the exact safe add command; it does not add the entry automatically.
- Wrong MCP URL or enabled write tool: doctor reports a configuration mismatch and exits non-zero.
- Unsupported OAuth scope: consent fails closed and provides the canonical least-privilege login command.
- Expired/revoked OAuth token: smoke reports **MCP authorization required** and points to `npm run mcp:login`.
- Wrong workspace: smoke reports **Connected to a different ComplianceHub workspace** and fails even if the MCP request itself succeeded.
- Demo shortcut guard failure: the shortcut is absent; a direct action request returns a generic unavailable response without authentication.
- Local proof write or reconciliation failure: the read-only MCP result still returns to the operator, but the UI remains **Needs verification** and no success timestamp is invented.

## Testing and evidence

All production behavior changes follow RED → GREEN TDD.

Required automated coverage:

- unit tests for doctor parsing, exact command construction, safe error mapping, and redaction;
- regression tests proving the login command includes the exact scope list and never includes `phone`;
- consent action and page tests for supported and unsupported scope sets;
- local demo action tests covering the exact loopback production-demo mode plus every flag, Host, Origin, Supabase, credential, membership, hosted-production, and non-loopback failure guard;
- launcher and doctor tests proving exact `127.0.0.1:3100` binding and rejection of wildcard, non-loopback IPv4, externally reachable IPv6, and additional listeners;
- browser tests for ordinary sign-in, one-click local demo sign-in, Settings status states, keyboard operation, and no credential exposure;
- MCP route and service tests proving the seven-tool read-only catalogue and disabled posting tool;
- local-proof parser, expiry, permission, environment-guard, redaction, and database-reconciliation tests;
- a fresh direct MCP smoke using the canonical named connection;
- a release-only owned-server acceptance run proving zero server-side GitHub/Slack attempts and unchanged protected database state;
- web/MCP/database reconciliation for workspace, readiness, and GitHub result counts;
- `npm run lint`, `npm run typecheck`, complete application tests, database tests, integration tests, production build, and critical browser routes.

Required evidence artifacts:

- redaction-safe terminal transcript for doctor and MCP smoke, plus only the login wrapper's safe exit category and post-login grant/doctor evidence; raw OAuth output remains ephemeral;
- screenshot of the local sign-in recovery action;
- screenshot of the AI assistant Settings panel;
- screenshot of Monitoring after the same verified MCP result generation;
- implementer report, independent reviewer verdict, and supervisor go/no-go decision.

## Implementation roles and gates

Phase 3A uses sequential implementation with independent review:

1. **Implementer** — works test-first from the implementation plan, commits each bounded task, and records exact tests.
2. **Reviewer** — receives a scoped diff package and checks specification compliance, security, usability, and code quality.
3. **Supervisor** — independently reconciles the final browser, MCP, database, and test evidence and decides go/no-go.

The next task does not begin while the current task has an unresolved important finding. Phase 3B does not begin until the Phase 3A supervisor returns GO.

## Non-goals

Phase 3A does not:

- add the Phase 3B company-wide MCP tools;
- change GitHub checks, permissions, repository selection, or finding logic;
- send Slack messages or advertise a Slack write tool;
- deploy Azure, configure hosted Supabase, or claim production availability;
- install an organization GitHub App;
- execute local commands from a browser request;
- accept `phone` or custom write scopes for convenience;
- make readiness, certification, or security claims beyond stored evidence.

## Completion criteria

Phase 3A is complete only when all of the following are true:

- a clean local operator path is documented as verified demo start → doctor → least-privilege login → smoke;
- the normal login command never requests `phone`;
- a fresh Codex process reads the correct demo workspace and all 15 current GitHub results;
- the MCP and web application agree on the same workspace, readiness indicator, and result counts;
- the stale personal plugin is absent and the doctor detects its reinstallation;
- local demo sign-in and proof display work through the clean loopback production-demo runtime, while every hosted or non-loopback path fails closed;
- the verified demo and owned acceptance processes listen only on `127.0.0.1:3100`, and doctor rejects any broader or additional listener;
- Settings distinguishes endpoint health from client verification and never invents proof;
- both proof artifacts and `/api/health` expose the same mandatory clean source SHA, never `unknown`;
- all required test gates and visual checks pass;
- the operator smoke produces no protected application-database delta, while the same-commit release acceptance and static call-path tests provide current zero-attempt server-network evidence;
- neither proof path mutates GitHub, Slack, hosted services, MCP registration, plugin state, or unrelated Codex configuration; permitted local changes are the ignored proof artifacts and transient runtime files;
- the separate explicit login step may change only the expected Supabase OAuth client/grant lifecycle and the named Codex client credential;
- the reviewer approves and the supervisor returns GO.

## Subsequent phase boundary

Phase 3B begins only after Phase 3A completion. It implements the approved company-wide read model for assessments, SoA, risks, evidence, governance, scope, integrations, recent changes, and deterministic recommendation cards. Phase 4 remains the exclusive owner of Slack OAuth, channel selection, scheduled delivery, mentions, retries, idempotency, and external Slack writes. Phase 5 remains the Azure, hosted Supabase, and organization GitHub rollout.
