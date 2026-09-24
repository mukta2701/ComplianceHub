# Deployment / Go-live runbook

## Milestone 1 Task 8: one image, two commands

The production image contains both the standalone web application and the
finite GitHub connection-reconciliation runner. Its default command remains:

```text
node server.js
```

A scheduler can override that command with exactly:

```text
node dist/github-connection-reconcile.mjs
```

The override runs one bounded cycle and exits; it does not contain a timer or
remain resident. Supply the GitHub App and Supabase credentials only as runtime
environment variables. Do not pass them as Docker build arguments or include
them in the bundle, image history, image environment, or captured logs.

The local and CI container checks use fictional configuration. They prove that
the same non-root image serves its web health endpoint, runs the exact finite
command within an external timeout, and keeps the fictional secret markers out
of the inspected bundle, image history, image environment, and logs. That
evidence does not prove a live GitHub App or provider cycle, Slack delivery,
production Supabase behavior, the historical company AWS ECS/EventBridge
staging path, a hosted release, or human acceptance. Those remain separate
gates.

## Milestone 1 AWS dev acceptance (current operating instructions)

The 20 September 2026 AWS dev acceptance design and plan replace the unfinished
company ECS/EventBridge staging delivery for Milestone 1. Do not create or use a
separate staging environment for this pilot. The existing AWS dev App Runner
service is the web runtime, and its current immutable ECR image digest is the
only image source for connection reconciliation.

### Web service and finite runner

App Runner keeps the production image's default command:

```text
node server.js
```

The reconciliation workflow overrides that same image with exactly:

```text
node dist/github-connection-reconcile.mjs
```

The override performs one bounded connection-reconciliation cycle, drains only
connection-health Slack work, and exits. It does not start a timer, run
`/api/cron/monitor`, claim Monitoring findings, or create compliance outcomes.
The workflow first reads App Runner's current image identifier and rejects a
tag, another registry, another repository, or a malformed digest before Docker
runs.

### Reconciliation workflow and schedule

`.github/workflows/reconcile-github-connections-aws-dev.yml` runs on a
GitHub-hosted worker. It uses the existing `aws-dev` environment and an AWS
OIDC role with no long-lived AWS access key. Its normal job calls the local
`.github/actions/reconcile-github-connections-aws-dev` composite action for
manual `workflow_dispatch` (including an optional expected release SHA) and
the hourly schedule at minute 23 UTC (`23 * * * *`). The concurrency lock
prevents overlapping cycles, and the workflow supplies an outer timeout around
the runner's own bounded deadline. The action validates App Runner's current
immutable digest, checks an optional release SHA, pulls that same image and
exits after the exact finite command.

Before this workflow is installed on the default branch, a manual dispatch of
`Deploy AWS dev` can set
`run_github_reconciliation_acceptance=true`. The deploy job then exposes only
the validated `sha256:<64 lowercase hex>` digest and runs two ordinary,
sequential `ubuntu-24.04` jobs. Each checks out `github.sha`, uses the same
composite action and passes the digest plus release SHA with strict binding
enabled. The input defaults to `false`, so ordinary pushes and manual deploys
remain web-only. The acceptance jobs receive the existing `aws-dev`
environment's named variables and secrets on the action step; secret values
are never action inputs or cross-job outputs. The environment currently has no
reviewer-protection rule; this is an execution path and not a claim of human
approval enforcement.

GitHub schedules run from the repository's default branch only. A feature branch
can prove the workflow contract and the opt-in deployment acceptance calls; it
cannot prove scheduled execution. Scheduled runs
may start late or be skipped during GitHub service disruption, so a missing
scheduled run is not evidence that the connection is healthy.

### Configuration names and secret boundary

Configure only the `aws-dev` inputs below; never copy their values
into this repository, Docker build arguments, workflow arguments or evidence.
The four environment variable names used by the reconciliation workflow are:

- `AWS_DEV_ECR_REGISTRY`;
- `AWS_DEV_SERVICE_ARN`;
- `AWS_DEV_SITE_URL`;
- `NEXT_PUBLIC_SUPABASE_URL`.

The protected secret names are:

- `AWS_DEV_DEPLOY_ROLE_ARN`;
- `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, and
  `SLACK_ALLOWED_WEBHOOK_SHA256`;
- `AWS_DEV_GITHUB_APP_ID`, `AWS_DEV_GITHUB_APP_SLUG`,
  `AWS_DEV_GITHUB_APP_CLIENT_ID`, `AWS_DEV_GITHUB_APP_CLIENT_SECRET`,
  `AWS_DEV_GITHUB_APP_PRIVATE_KEY`, `AWS_DEV_GITHUB_WEBHOOK_SECRET`, and
  `AWS_DEV_GITHUB_ALLOWED_ACCOUNT_ID`.

The workflow derives the runtime `NEXT_PUBLIC_SITE_URL` from
`AWS_DEV_SITE_URL`; do not configure a separate protected value for that
runtime name. It fixes `GITHUB_ALLOWED_ACCOUNT_TYPE` to `Organization` and the
following reconciliation bounds in reviewed workflow source, so they are not
protected-environment inputs:

- `GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES=20`;
- `GITHUB_CONNECTION_MAX_INSTALLATIONS=10`;
- `GITHUB_CONNECTION_MAX_SLACK_DELIVERIES=10`;
- `GITHUB_CONNECTION_TIME_BUDGET_MS=240000`.

The deploy workflow maps the `AWS_DEV_GITHUB_*` aliases to the exact runtime
`GITHUB_*` names. The finite runner does not receive `CRON_SECRET`, browser
keys, a GitHub personal access token, or a Slack webhook URL. Secret values are
masked before Docker starts and are removed with the runner's temporary
container and log.

### Connection-only notifications and evidence limits

The runner may claim and deliver only `github_connection_health` Slack rows. It
uses the same approved destination-digest and encrypted-configuration checks as
the application, and failed delivery remains durable for a later bounded retry.
The general `POST /api/cron/monitor` route continues to own Monitoring
evaluation and Monitoring alert delivery; this finite command never invokes it
and never claims its rows.

Local fictional-data tests, image scans, workflow contract checks and a manual
feature-branch run prove source and packaging behavior only. They do not prove
the hosted App Runner digest, live Supabase/GitHub/Slack behavior, default-branch
scheduled execution, production readiness, or human acceptance. Record each
environment and release separately when those later gates are authorized.

## Existing GitHub shadow collection maintenance (separate from the finite runner)

The AWS dev environment runs the read-only GitHub shadow collector
at `05:29 UTC`, before the existing daily and monitoring maintenance jobs. The
same job can be started with the `github-collect` workflow-dispatch option. Its
request key is the UTC day (`scheduled:YYYY-MM-DD`), so workflow retries reserve
the same per-repository run instead of duplicating history.

The route has a 270-second cancellation deadline inside the 300-second Container
Apps request ceiling. The initial pilot is intentionally limited operationally to
one selected repository. Do not expand it until batching and sharding have been
measured. This route returns aggregate counts and writes only GitHub shadow
inventory, runs, and observations; it does not create evidence or findings,
change readiness/MCP answers, or deliver Slack messages.
`repositoriesDeferred` is non-zero when another worker still owns an active
lease. Callers must treat that response as in-progress work, not as terminal
success; the deterministic retry key will resolve the same run later.

The older personal-staging shadow-collection instructions below are retained as
historical reference for that separate route. They are not a prerequisite for
the current AWS dev connection-runner acceptance. Keep any runtime credentials
out of application tables, logs, build output, client-visible environment
variables, and local developer environment files.

This is the concrete checklist to take ComplianceHub from the local build to a live
site. Steps marked **(you)** need account creation or secret entry that only the
account owner can do; everything else is already prepared in the repo.

## 0. Prerequisites

- The repo builds clean locally: `npm run lint && npm run typecheck && npm run test && npm run build`, plus `supabase test db` (pgTAP) green.
- All committed migrations must apply in order from an empty local database via `supabase db reset`, followed by a green `supabase test db`, before applying them to a hosted project. Never infer production safety from a stale migration/test count in documentation.
- CI also runs `npm run test:db:upgrade` against its disposable local Supabase.
  This historical-upgrade harness is destructive: it erases the local database,
  resets to `20260807047000`, seeds malformed legacy delivery rows, applies the
  later migration, verifies the backfill, and resets once more to a fresh current
  schema without seed data. It uses `--local` only and must never be pointed at a
  linked or hosted project. Outside CI it refuses to invoke Supabase unless the
  operator explicitly sets `COMPLIANCEHUB_ALLOW_LOCAL_DB_RESET=1`; use that
  override only when all local data can be permanently discarded.
- The full Playwright e2e suite passes against a **production build** (`npm run build` followed by `scripts/playwright-production-server.sh`), confirming the deployed artifact serves the whole app end-to-end. (Locally run e2e with `--workers=1` or `--workers=2` — full parallelism overwhelms the single local Supabase with concurrent sign-ups.)

## 1. Hosted Supabase **(you — separate deployment runbook)**

This section documents the broader hosted application deployment. It is not the
current Milestone 1 AWS dev runner gate. The AWS dev acceptance path uses the
existing dev project and the one reviewed migration named in the 20 September
plan; do not apply the historical personal-staging migration list below as a
substitute.

1. Create a managed Supabase project (a UK/EU region where available).
2. Apply the committed migrations to it (link the project, then `supabase db push`, or run the SQL in order). Do **not** run `db reset` against production.
3. From the project's API settings, copy: the **Project URL**, the **anon key**, and the **service-role key** (server-only).

### Historical GitHub foundation migration checkpoint (not the current AWS dev gate)

The historical personal-staging project for that earlier rollout was project ref
`ytenjiyjdcrjkgwmciqw`. Confirm that exact ref in both the Supabase dashboard and
CLI before linking or applying anything, then take and verify a recoverable
backup. From the last deployed schema, both `supabase migration list` and
`supabase db push --dry-run` must show exactly these twenty-four pending additive
migrations, in this order:

1. `20260817010000_github_collection_foundation.sql`
2. `20260817020000_github_collection_run_leases.sql`
3. `20260817030000_github_webhook_delivery_ids.sql`
4. `20260817192458_github_shadow_ui_summary.sql`
5. `20260818030000_automation_proposal_signal_uniqueness.sql`
6. `20260818040000_harden_oauth_trigger_permissions.sql`
7. `20260818050000_grant_safe_connection_metadata.sql`
8. `20260818060000_automation_task_draft_uniqueness.sql`
9. `20260818070000_reassert_finalise_soa_operator_guard.sql`
10. `20260818100000_harden_risk_matrix_editor_identity.sql`
11. `20260818110000_idempotent_automation_reviews.sql`
12. `20260818120000_atomic_kpi_task.sql`
13. `20260818130000_harden_risk_matrix_mutations.sql`
14. `20260818140000_atomic_monitoring_finding_task.sql`
15. `20260824184627_github_compliance_enum_values.sql`
16. `20260824184628_github_compliance_materialisation.sql`
17. `20260824212223_github_materialisation_jobs.sql`
18. `20260825014236_github_official_results_and_mcp_read.sql`
19. `20260825040825_mcp_github_digest_v2.sql`
20. `20260825053718_restrict_slack_delivery_destination.sql`
21. `20260825073650_github_compliance_control_room.sql`
22. `20260825082411_harden_github_control_room_ownership_privacy_indexes.sql`
23. `20260825094343_owner_only_github_installation_claim.sql`
24. `20260825124025_github_finalize_job_function_portability.sql`

Stop if the project ref, ordering, or pending set differs. The Slack reservation
upgrade uses one explicit two-stage deployment; do not apply migrations 20–24
before the bridge revision is healthy:

1. Apply and verify migrations 1–19 through
   `20260825040825_mcp_github_digest_v2.sql`. Set the protected migration
   attestation temporarily to `20260825040825` and manually run **Deploy
   AWS dev**. This deploys the policy-capable
   image with `DAILY_DIGEST_RESERVATION_MODE=bridge`; it tries the six-argument
   reservation first and may use the service-only legacy overload only when
   PostgREST returns exact `PGRST202`.
2. Verify the bridge health response reports policy `v1`, reservation mode
   `bridge`, and the exact release SHA. Then apply only additive migration 20
   (`20260825053718`), migration 21 (`20260825073650`), migration 22
   (`20260825082411`), migration 23 (`20260825094343`), and migration 24 (`20260825124025`), rerun the migration
   list and database checks, and set
   `HOSTED_SUPABASE_MIGRATION_VERSION=20260825124025`.
3. Manually dispatch `rollout_phase=final`. The first final requires the exact
   healthy policy-capable bridge revision, coherent same-slot Slack/core
   references, and migration `20260825124025`; it deploys
   `DAILY_DIGEST_RESERVATION_MODE=strict`. In steady-state operation, subsequent
   manual final and automatic `workflow_run` deployments remain strict and may
   follow an exact policy-capable predecessor whose captured mode is either
   `bridge` or `strict`. A blank mode, missing `v1` marker, mismatched release
   SHA, or non-final schema still fails before mutation, so the initial manual
   bridge remains mandatory.

After migration 24, verify the GitHub tables, security-invoker summary and
control-room reads, the Owner-authorised service retry boundary, and both
service-only reservation overloads plus the claim/finalise/inspection RPC
signatures. The five-argument overload is temporary rollout compatibility and
must remain denied to PUBLIC, anon, and authenticated until a later reviewed
retirement migration removes it. Confirm that a materialisation job at its
25-attempt ceiling becomes visible as `exhausted` instead of being reclaimed or
reported healthy. The deploy preflight binds the project and phase-specific
migration attestations to the exact `NEXT_PUBLIC_SUPABASE_URL`; changing the
target project invalidates the gate. These attestations are not substitutes for
the list, dry run, backup, or direct verification. Rolling the Container App
back never rolls the database back.

## 2. AWS dev hosting **(you — external authorization checkpoint)**

The dev target is AWS App Runner in `eu-west-2`, running one immutable image
from ECR (`compliancehub-dev`). Render, Azure, and Vercel hosting are not used.

1. Confirm the AWS account, region, ECR registry, App Runner service, and
   access role with the company AWS administrator. The workflow assumes the
   `aws-dev` GitHub environment and an OIDC deploy role; no long-lived AWS
   credential lives in the repository.
2. Record the App Runner service URL. Set `NEXT_PUBLIC_SITE_URL` to its HTTPS
   origin and `MCP_RESOURCE_URL` to the same origin ending exactly in `/mcp`.
3. Create the protected GitHub environment `aws-dev`. Configure the
   variables and secrets below. Public values are build inputs; server secrets
   are passed at runtime to App Runner or to a bounded collection container,
   never baked into the image.
4. The **Deploy AWS dev** workflow (`.github/workflows/deploy-aws-dev.yml`)
   builds and pushes the immutable image for `main` (reusing the image when
   the commit is already built), updates the App Runner service, waits for it
   to report `RUNNING`, then verifies `/api/health/live` matches the deployed
   SHA and `/api/health` reports database access. The deploy and daily
   collection jobs receive the AWS OIDC token only inside the protected
   `aws-dev` environment; each receives only the secrets it needs. Build and
   general test actions run outside that trust boundary.
5. Do not merge or deploy a release until the hosted migration checkpoint and
   GitHub organisation-owner registration checkpoint below are complete.

GitHub environment variables (`aws-dev` environment):

| Variable | Value |
|---|---|
| `AWS_DEV_ECR_REGISTRY` | ECR registry host for the dev repository |
| `AWS_DEV_SERVICE_ARN` | App Runner service ARN for dev |
| `AWS_DEV_ACCESS_ROLE_ARN` | IAM role App Runner uses to pull the ECR image |
| `AWS_DEV_SITE_URL` | Exact AWS dev HTTPS origin |
| `NEXT_PUBLIC_SUPABASE_URL` | Dev Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required legacy public key used by current browser/server clients |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preferred public key |
| `NEXT_PUBLIC_SITE_URL` | Exact AWS dev HTTPS origin |
| `MCP_RESOURCE_URL` | Exact AWS dev HTTPS origin plus `/mcp` |
| `SUPABASE_OAUTH_ISSUER` | `https://<project-ref>.supabase.co/auth/v1` |
| `SUPABASE_OAUTH_JWKS_URL` | `<issuer>/.well-known/jwks.json` |
| `MCP_JWT_ALGORITHMS` | `RS256,ES256` |
| `HOSTED_SUPABASE_PROJECT_REF` | `ytenjiyjdcrjkgwmciqw`, only after the exact hosted project, backup, and twenty-four-migration checkpoint above pass |
| `HOSTED_SUPABASE_MIGRATION_VERSION` | `20260825124025`, only after the twenty-four-migration checkpoint above passes |
| `REGISTERED_GITHUB_APP_SITE_URL` | Exact canonical origin registered in GitHub; must equal `NEXT_PUBLIC_SITE_URL` |

GitHub environment secrets:

GitHub Actions does not allow user-defined secret names beginning `GITHUB_`, so
the protected environment uses the `AWS_DEV_GITHUB_*` source names below. The
deploy job maps them to the exact `GITHUB_*` App Runner runtime names without
printing their values.

| Secret | Purpose |
|---|---|
| `AWS_DEV_DEPLOY_ROLE_ARN` | Existing OIDC role used by the AWS dev deploy and daily collection jobs |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only cron and validated digest lifecycle |
| `APP_ENCRYPTION_KEY` | Stable AES-256-GCM application key |
| `CRON_SECRET` | Authenticates maintenance workflow calls |
| `SLACK_ALLOWED_WEBHOOK_SHA256` | Exact lowercase SHA-256 of the canonical Mukta-owned, server-approved private Slack destination; server-only and blank until verified |
| `AWS_DEV_GITHUB_APP_ID` | Maps to runtime `GITHUB_APP_ID`; numeric private App ID |
| `AWS_DEV_GITHUB_APP_CLIENT_ID` | Maps to runtime `GITHUB_APP_CLIENT_ID`; App OAuth client ID |
| `AWS_DEV_GITHUB_APP_CLIENT_SECRET` | Maps to runtime `GITHUB_APP_CLIENT_SECRET`; App OAuth client secret |
| `AWS_DEV_GITHUB_APP_PRIVATE_KEY` | Maps to runtime `GITHUB_APP_PRIVATE_KEY`; PKCS#8/PEM key stored as one line with literal escaped `\n` markers |
| `AWS_DEV_GITHUB_WEBHOOK_SECRET` | Maps to runtime `GITHUB_WEBHOOK_SECRET`; high-entropy webhook HMAC secret |
| `AWS_DEV_GITHUB_APP_SLUG` | Maps to runtime `GITHUB_APP_SLUG`; exact private App slug |
| `AWS_DEV_GITHUB_ALLOWED_ACCOUNT_ID` | Maps to runtime `GITHUB_ALLOWED_ACCOUNT_ID`; immutable numeric organisation ID |
| `AWS_DEV_GITHUB_APPROVED_SECURITY_WORKFLOW_IDS` | Maps to runtime `GITHUB_APPROVED_SECURITY_WORKFLOW_IDS`; one to twenty comma-separated numeric workflow IDs for the dedicated pilot repository |

### Daily GitHub compliance collection (AWS dev)

Once merged to `main`, the protected `Collect GitHub compliance checks (AWS
dev)` workflow is configured to run daily at 09:23 UTC, subject to the
`aws-dev` environment protections. It requires the AWS dev, Supabase and
read-only GitHub App configuration above. Before running, it checks that the
live app and database are healthy. It also checks that the App Runner image
uses the exact ECR digest and that the live release SHA is a tag on that
digest. A manual run must supply the exact release SHA shown by the live
health endpoint.
The runner then executes `dist/github-compliance-collect.mjs` from that
immutable image, collecting only active, selected repositories and writing
count-only results to the workflow log. The collection command has a
four-minute internal deadline; Docker and the job have seven- and twelve-minute
limits.

This is source configuration only. No scheduled run, live GitHub collection or
provider acceptance has been demonstrated from this feature branch.

The job's GitHub permissions are `contents: read` plus `id-token: write` for
AWS OIDC; it has no repository write permission and contains no App Runner
update call. It reuses the existing `AWS_DEV_DEPLOY_ROLE_ARN` for the approved
Milestone 1 workflow pattern. A dedicated AWS role restricted to describing
the App Runner service and pulling this ECR repository is a later IAM
hardening option. The container receives only the Supabase service-role key
and GitHub App ID, private key and approved workflow IDs as secrets. It does
not receive Slack, webhook or OAuth-client credentials.

GitHub may download an RSA private key with a `BEGIN RSA PRIVATE KEY` header,
but the runtime deliberately accepts PKCS#8 only. Convert the downloaded key
offline into a separate, owner-readable file (never overwrite the original):

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in <downloaded-key.pem> -out <converted-pkcs8-key.pem>
chmod 600 <converted-pkcs8-key.pem>
head -n 1 <converted-pkcs8-key.pem   # PKCS#8 BEGIN marker
tail -n 1 <converted-pkcs8-key.pem   # PKCS#8 END marker
openssl pkcs8 -in <converted-pkcs8-key.pem> -nocrypt -out /dev/null
```

The final command must exit zero. Confirm the first and last lines are the
PKCS#8 BEGIN/END `PRIVATE KEY` markers, then use
an approved secret-entry tool to replace each newline with the two literal
characters `\n`. Do not print the converted key, paste it into a shell history,
or store either key file in this repository. The deployment preflight rejects
actual newlines, a non-PKCS#8 header, a missing PKCS#8 footer, or any trailing
payload after the footer.

Application environment variables (names must match `.env.example`):

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server-only.** Used by cron routes and the MCP daily-digest delivery boundary only after user-scoped Owner, current-fact, and message validation. Never expose it to the client. |
| `NEXT_PUBLIC_SITE_URL` | yes | Your real site origin, e.g. `https://app.example.com`. It is the canonical origin for invitation and Auth redirects; production fails closed if it is absent. |
| `CRON_SECRET` | yes | High-entropy random string; gates all maintenance cron routes. |
| `SLACK_ALLOWED_WEBHOOK_SHA256` | for every real Slack write | **Server-only.** Exact lowercase SHA-256 of the canonical Mukta-owned, server-approved private Slack destination. Blank or malformed configuration blocks delivery. Never expose it in a build argument, browser variable, health response, UI, or log. |
| `GITHUB_APP_ID` | for GitHub shadow pilot | **Server-only.** Numeric identifier of the approved private GitHub App. |
| `GITHUB_APP_CLIENT_ID` | for GitHub shadow pilot | **Server-only.** OAuth client identifier used only by setup/callback routes. |
| `GITHUB_APP_CLIENT_SECRET` | for GitHub shadow pilot | **Server-only.** OAuth client secret used for PKCE callback exchange and the integrity-protected flow cookie. |
| `GITHUB_APP_PRIVATE_KEY` | for GitHub shadow pilot | **Server-only.** PEM private key for short-lived App JWT signing. Store it as one line with literal escaped `\n` markers; never expose or persist it. |
| `GITHUB_WEBHOOK_SECRET` | for GitHub shadow pilot | **Server-only.** High-entropy HMAC secret for signed webhook intake. |
| `GITHUB_APP_SLUG` | for GitHub shadow pilot | **Server-only.** Exact slug used to construct the installation URL. |
| `GITHUB_ALLOWED_ACCOUNT_ID` | for GitHub shadow pilot | **Server-only.** Immutable numeric Adtecher organisation ID; never substitute a personal account. |
| `GITHUB_ALLOWED_ACCOUNT_TYPE` | local personal pilot only | **Server-only, optional.** Set exactly to `User` only on an HTTP loopback origin during the personal local pilot; leave unset for hosted/organisation rollout. |
| `GITHUB_APPROVED_SECURITY_WORKFLOW_IDS` | for GitHub shadow pilot | **Server-only.** One to twenty unique comma-separated numeric workflow IDs approved for the dedicated pilot repository. |
| `RESEND_API_KEY` | for invitation delivery | **Server-only.** Resend API key with sending access. Never use a `NEXT_PUBLIC_` variable for it. If absent, invitations remain retryable with status `not_configured` and no mail request is made. |
| `INVITATION_FROM_EMAIL` | for invitation delivery | **Server-only.** Verified sender, e.g. `ComplianceHub <invites@notify.example.com>`. |
| `GOOGLE_AUTH_ENABLED` | after Google setup | Server-side flag. Leave unset until the Google + Supabase checkpoints below are complete, then set to `1`. |
| `MICROSOFT_AUTH_ENABLED` | after Microsoft setup | Server-side flag. Leave unset until the Entra + Supabase checkpoints below are complete, then set to `1`. |
| `MCP_RESOURCE_URL` | for internal MCP staging | Exact canonical HTTPS endpoint ending `/mcp`; never a preview URL. |
| `SUPABASE_OAUTH_ISSUER` | for internal MCP staging | Exact `https://<project-ref>.supabase.co/auth/v1` issuer. |
| `SUPABASE_OAUTH_JWKS_URL` | for internal MCP staging | Exact issuer JWKS URL: `<issuer>/.well-known/jwks.json`. |
| `MCP_JWT_ALGORITHMS` | for internal MCP staging | Asymmetric allowlist only: `RS256,ES256`. |
| `NANGO_BASE_URL` | for provider OAuth | **Server-only.** Defaults to `https://api.nango.dev`; set only when using another reviewed Nango deployment. |
| `NANGO_SECRET_KEY` | for provider OAuth | **Server-only. Never `NEXT_PUBLIC_*`.** Creates short-lived Connect sessions and authorizes Nango Proxy calls. |
| `NANGO_GITHUB_INTEGRATION_ID` | for GitHub OAuth | Nango integration ID/unique key configured for the reviewed GitHub OAuth app. |
| `NANGO_JIRA_INTEGRATION_ID` | for Jira OAuth | Nango integration ID/unique key configured for the reviewed Jira OAuth app. |

### Private GitHub App registration checkpoint

An Adtecher GitHub organisation owner or App manager must create or update this
as a **private, Adtecher-owned** GitHub App before the branch is merged or the
AWS dev deployment is triggered. Do not use a user-owned App or a personal
repository as a substitute.

Use the exact origin in `NEXT_PUBLIC_SITE_URL` for every URL below, with no
preview origin, path prefix, credentials, query, fragment, or trailing slash on
the origin itself:

- Homepage URL: `${NEXT_PUBLIC_SITE_URL}`
- Callback URL: `${NEXT_PUBLIC_SITE_URL}/api/github/callback`
- Setup URL: `${NEXT_PUBLIC_SITE_URL}/api/github/setup`
- Webhook URL: `${NEXT_PUBLIC_SITE_URL}/api/github/webhook`

Keep **Request user authorization (OAuth) during installation** disabled so the
setup URL can start the bounded PKCE flow, enable **Redirect on update**, and
keep webhook SSL verification enabled. Set repository permissions only to
Actions: read, Administration: read, Dependabot alerts: read, Metadata: read,
Secret scanning alerts: read, and Code scanning alerts (`security_events`):
read. Grant no write permission and no organisation/user permission.

Subscribe only to `installation`, `installation_repositories`, `repository`,
`branch_protection_rule`, `repository_ruleset`, `workflow_run`,
`dependabot_alert`, `code_scanning_alert`, and `secret_scanning_alert`. Install
the App with **Only select repositories** and approve exactly one dedicated
Adtecher pilot repository. Record its numeric organisation account ID as
`GITHUB_ALLOWED_ACCOUNT_ID`; login text is display-only and is not the trust
boundary. Record the exact registered origin in the protected environment
variable `REGISTERED_GITHUB_APP_SITE_URL`. The deploy preflight requires it to
equal `NEXT_PUBLIC_SITE_URL`, ensuring any canonical URL change pauses rollout
until the GitHub callback, setup, and webhook registration is updated.

Enter the eight GitHub runtime values only through their `AWS_DEV_GITHUB_*` secret
aliases in the protected `aws-dev` environment. Do not add them to `.env.local`, repository
variables, Docker build arguments, application tables, workflow output, forks,
or any other hosting environment. The local seeded Playwright proof
does not require these values and makes no GitHub request.

## 3. Existing cron automation (scheduled calls to AWS dev)

These HTTP cron routes are separate from the current finite GitHub connection
workflow above. In particular, the finite runner does not call
`/api/cron/monitor` and does not deliver Monitoring work.

The four cron routes below run on the AWS dev origin with `CRON_SECRET`.
Scheduled invocation is re-established on the AWS side; until then invoke them
manually or on a reviewed schedule. Their intended UTC cadence is:

- `POST /api/cron/github-collect` — `29 5 * * *` (05:29 UTC daily). Runs the lease-protected, read-only GitHub shadow collector before any downstream maintenance. During the first pilot, select exactly one dedicated repository.
- `POST /api/cron/daily` — `7 6 * * *` (06:07 UTC daily). First classifies digest reservations left in-flight for more than 15 minutes as `unknown` for human review (never automatic retry), runs a bounded fair recovery claim for durable GitHub materialisation jobs, and reports exhausted 25-attempt jobs as explicit needs-attention dead letters. Exhausted jobs are not silently reset; recovery requires a separately reviewed, audited operator workflow. It then collects evidence, runs integration sync, and performs the evidence-freshness + policy-review sweep. Notifications are deduplicated per day and a new task is opened only when none is already open for that item, so retries and manual runs are safe.
- `POST /api/cron/monitor` — `13 7 * * *` (07:13 UTC daily). Checks every organisation's configured monitoring sources, reconciles findings, and sends enabled finding alerts. Non-zero minutes avoid GitHub Actions' highest scheduled-load window.
- `POST /api/cron/automation-purge` — `29 7 * * *` (07:29 UTC daily). Purges up to 100 expired source objects per invocation while retaining hashed provenance and proposal references for the configured retention window; the response reports any deferred remainder for the next scheduled run.

Integration sync is folded into the 06:07 UTC daily pipeline. The compatibility route `POST /api/cron/integrations-sync` remains available for a deliberate manual run, but it has no separate Vercel schedule and must not be described or deployed as an hourly cron.

The workflow sends `Authorization: Bearer <CRON_SECRET>`; each route rejects any request whose bearer token does not match. Manual invocation in development:

```bash
curl -i -X POST http://localhost:3100/api/cron/github-collect -H "Authorization: Bearer $CRON_SECRET"
curl -i -X POST http://localhost:3100/api/cron/daily   -H "Authorization: Bearer $CRON_SECRET"
curl -i -X POST http://localhost:3100/api/cron/monitor -H "Authorization: Bearer $CRON_SECRET"
curl -i -X POST http://localhost:3100/api/cron/automation-purge -H "Authorization: Bearer $CRON_SECRET"
```

The MCP daily-digest write also requires `SUPABASE_SERVICE_ROLE_KEY`. The OAuth
client never receives this key: the Next server resolves the signed-in user and
workspace, verifies Owner role, recomputes facts, validates every outgoing line,
and only then constructs the server-only client used for the actor-bound reserve
and finalize RPCs. Deployment smoke tests must confirm authenticated/anon clients
cannot execute either lifecycle RPC directly.

## 4. Production hardening **(you)**

1. Verify a dedicated sending subdomain in Resend and publish the required SPF and DKIM records; publish a DMARC policy as well. Create `RESEND_API_KEY` and set `INVITATION_FROM_EMAIL` only after verification. This enables ComplianceHub's workspace-membership invitations.
2. Configure a custom SMTP provider in Supabase Auth for sign-up, confirmation, password-reset, and other Auth-owned emails, with the verified application URL matching `NEXT_PUBLIC_SITE_URL`. This is separate from the Resend HTTP adapter used for workspace-membership invitations.
3. Spend controls, monitoring, and database backups; exercise a restore into a separate project before public launch.
4. Supabase Free and the AWS dev budget guard are for internal
   dev, not a dependable production SLA. Budget alerts do not impose a hard spending cap.
5. Confirm the hosted project's exposed schemas remain the Supabase defaults and
   verify Storage operations through the official API. `storage.objects` is owned
   by `supabase_storage_admin`; do not change its ownership or revoke its managed
   grants from an application migration. Escalate unexpected provider grants or
   behavior to Supabase before launch. ComplianceHub's own `public` tables must
   still pass `048_special_table_privileges.sql`.

## 4a. Optional Google / Microsoft login **(you — external authorization checkpoint)**

The application code is wired but both providers stay hidden and make no provider
call until their server-side flag is exactly `1`. Do not enable either flag until
all steps for that provider have been completed and tested in a non-production
Supabase project.

Common Supabase steps:

1. In **Supabase Auth → URL Configuration**, keep the Site URL equal to
   `NEXT_PUBLIC_SITE_URL` and add `${NEXT_PUBLIC_SITE_URL}/auth/callback` to the
   redirect allowlist. Add the localhost equivalent only to the local/staging
   project, not production.
2. The redirect URI registered with Google or Microsoft is the Supabase Auth
   callback, `https://<project-ref>.supabase.co/auth/v1/callback`. The application
   callback above is the allowlisted `redirectTo` that Supabase uses after its PKCE
   exchange; these are two different URLs.
3. Store provider client IDs/secrets only in the Supabase provider settings. They
   are never `NEXT_PUBLIC_*` variables and do not belong in this repository.
4. Exercise sign-in, sign-up, sign-out, and `/invite` continuation in staging,
   including a wrong-account invitation, before enabling a production flag.

Google checkpoint:

1. Create a Google OAuth web client, configure its consent screen, and register
   the Supabase Auth callback URL.
2. Enable Google in Supabase Auth with that client ID/secret.
3. Set `GOOGLE_AUTH_ENABLED=1` only after the staging round trip succeeds.

Microsoft checkpoint:

1. Register a Microsoft Entra web application, select the intended tenant/account
   audience, add the Supabase Auth callback URL, and create a client secret with a
   monitored expiry/rotation date.
2. Add the optional `email` and `xms_edov` claims to the Entra application. The app
   requests the required `email` OAuth scope; `xms_edov` lets Supabase distinguish
   a Microsoft-verified email and reduces email-impersonation risk.
3. Enable Azure in Supabase Auth with the application ID/secret and appropriate
   tenant URL, then set `MICROSOFT_AUTH_ENABLED=1` only after staging succeeds.

Workspace invitation links contain a 256-bit bearer token. The raw link endpoint
immediately exchanges it for a 45-minute HttpOnly, SameSite=Lax cookie scoped to
`/invite`, then redirects to a token-free URL. Do not add analytics, third-party
scripts, referrer overrides, or raw-token query/form handling to invitation pages.

## 5. Real Jira / GitHub integrations through Nango (optional) **(you — external authorization checkpoint)**

ComplianceHub contains the tested server boundary and Connect UI, but it cannot
create provider apps, accept consent, or enter deployment secrets for you.

1. Create a Nango environment. Register a GitHub OAuth app and Jira OAuth app with
   the callback URLs and least-privilege scopes shown by Nango. Complete any
   provider consent/app-review requirements.
2. Configure one Nango integration for GitHub and one for Jira. Set
   `NANGO_SECRET_KEY`, `NANGO_GITHUB_INTEGRATION_ID`, and
   `NANGO_JIRA_INTEGRATION_ID` as server-only deployment variables. Leave
   `NANGO_BASE_URL` at `https://api.nango.dev` unless a reviewed self-hosted Nango
   deployment is intentionally used.
3. In staging, sign in as an Owner or Admin and open **Settings → Connections**.
   Authorize one provider through its OAuth button. ComplianceHub creates a
   short-lived Connect session tagged with the signed-in user ID, verified email,
   and workspace ID; the browser never receives `NANGO_SECRET_KEY`.
4. After Nango reports success, ComplianceHub reads Nango's credential-free
   connection metadata from `GET /connections` and requires an exact connection
   ID, integration ID, provider, user ID, verified email, and workspace tag
   match. Only then is the opaque reference stored. Its provider, mode, and
   broker identity become immutable, and deployment-wide tombstone uniqueness
   prevents the reference being replayed even after revocation. Provider OAuth
   access/refresh tokens remain in Nango and are not stored locally. Revocation
   uses `DELETE /connections/{connectionId}` before local retirement. All local
   OAuth insert, target configuration, enable/disable, and soft-revoke writes
   use the verified server boundary; authenticated browser sessions can mutate
   sandbox rows only and cannot hard-delete OAuth tombstones.
5. The new record remains **Authorized · setup required**. Enter a GitHub
   owner/repository or an Atlassian Cloud URL/project key. ComplianceHub verifies
   GitHub repository access. For Jira it matches the submitted tenant against
   Atlassian `accessible-resources`, stores the verified cloud ID, and verifies
   project access. Database constraints reject unverified or malformed targets.
6. In staging, create a remediation ticket and run the integration sync; verify
   the ticket URL/status and Nango request logs. Jira 3LO calls must appear under
   `api.atlassian.com/ex/jira/{cloudId}`. Enabling GitHub also creates a linked
   OAuth monitoring source for branch protection, required reviews, secret
   scanning, and organisation MFA. That source is controlled only through its
   parent connection: it cannot be toggled or disconnected independently, and
   the worker resolves its configuration and broker references from the active
   parent at run time. For personal/user-owned repositories, organisation MFA is
   reported not applicable/unavailable while repository checks continue. Checks
   that GitHub hides for the granted scopes are unavailable and never fabricated
   as passing.
   Disabled and revoked connections must remain no-ops; revocation must retire
   the Nango connection before local cleanup succeeds.
7. Remove the configuring user in staging and verify that the GitHub/Jira
   connection, linked monitor source, and alert channels remain available to a
   remaining Owner/Admin. Offboarding clears the departed user's provenance; it
   does not delete shared workspace configuration.
8. Repeat the flow in production only after staging succeeds. Record who approved
   the provider scopes and schedule rotation/review of the Nango secret and OAuth
   applications.

OAuth tombstones are removed only as part of an explicit database-level deletion
of the entire workspace through the `organisations` cascade. ComplianceHub does
not expose workspace deletion to authenticated portal sessions. Treat any future
workspace-destruction workflow as a privileged retention decision because it
also releases the workspace's retired broker identities.

OAuth here is **provider authorization**: it grants ComplianceHub access to a
GitHub/Jira API. It is separate from Google/Microsoft SSO in section 4a, which
authenticates a person signing in to ComplianceHub.

The manual password-token forms remain inside **Local sandbox / developer setup**
for deterministic local tests. They are not the recommended production path.

## 5a. Internal MCP OAuth staging gate **(you — production blocker)**

Supabase OAuth Server remains beta. Apply this only in staging first; the MCP
business tools must remain disabled in production until every compatibility test
below passes from MCP Inspector, Codex, and Claude.

1. In **Authentication → OAuth Server**, enable OAuth 2.1, set the authorization
   path to `/oauth/consent`, and enable Dynamic Client Registration. Explicit
   consent must remain required. The local equivalents are committed under
   `[auth.oauth_server]` in `supabase/config.toml`.
2. In **Authentication → Signing Keys**, activate an asymmetric RS256 or ES256
   key. Confirm the published JWKS URL and copy the exact issuer/JWKS values into
   deployment variables. Symmetric JWT algorithms are rejected by ComplianceHub.
3. Insert the one exact hosted audience after migrations are applied:

   ```sql
   insert into private.mcp_oauth_config(config_key, audience)
   values ('resource', 'https://compliancehub.example/mcp')
   on conflict (config_key) do update
   set audience = excluded.audience, updated_at = now();
   ```

   Do this separately in staging and production. The migration intentionally has
   no hosted default. `supabase/seed.sql` supplies localhost only for local resets.
4. In **Authentication → Hooks**, enable the Custom Access Token hook
   `pg-functions://postgres/private/mcp_access_token_hook`. It is a security-
   invoker function: ordinary browser claims are returned unchanged in
   Supabase's documented `{ claims }` output shape; OAuth events are detected
   from `claims.client_id`, get only the configured `aud` change, and fail closed
   when claims are malformed or the private audience row is absent.
5. Register exact redirect URIs for the test clients. Do not use wildcard or
   preview-deployment redirects. The consent screen displays the registered
   return origin and never approves automatically.
6. Verify discovery and resource metadata, DCR, authorization-code + S256 PKCE,
   exact `resource`/audience behavior, refresh rotation, user grant revocation,
   expired tokens, and revoked sessions. In particular, current Supabase
   documentation does not prove that every client/server combination echoes RFC
   8707 `resource` exactly, so validate the issued `aud` and the complete round
   trip rather than inferring compatibility from discovery alone.
7. Repeat the complete flow in **MCP Inspector, Codex, and Claude**. A pass means
   each client can register, sign in, display consent, refresh, call the protected
   resource, and then loses access immediately after the user revokes its grant.

Local revocation evidence is executable in
`session-revocation.integration.test.ts`: a normal user token succeeds against
`/auth/v1/user`, Auth session revocation makes that same endpoint return
`session_not_found`, and `auth.getUser(token)` maps it to
`AuthSessionMissingError`. The current Supabase Auth client sends grant
revocation to `DELETE /user/oauth/grants?client_id=...`; its API contract states
that this revokes the user's grant, deletes that client's active sessions, and
invalidates its refresh tokens. Because the complete OAuth grant/session binding
depends on hosted beta behavior, re-prove that final link in each staging client
before production rather than adding a service-role MCP data path.

Production rollout is blocked until DCR + PKCE + resource/audience + refresh +
revocation pass in all three clients. Record the staging evidence and signing-key
identifier in the rollout log; never record access tokens, authorization codes,
or refresh tokens.

The hosted `/mcp` endpoint limits requests per verified user and OAuth client.
Production uses the shared Postgres rate-limit RPC when the service-role secret is
configured. A process-local counter is only the local/degraded fallback: it resets
with a serverless isolate and cannot enforce a global limit by itself. Confirm the
RPC migration and service-role variable are present before staging load tests, and
monitor fallback log events without recording bearer tokens or request bodies.
V1 accepts exactly one JSON-RPC message per POST and rejects every batch array
before creating an MCP server or running a tool. Authenticated invalid requests
still consume the user-and-client rate-limit allowance.

## 5b. Private plugin, Slack digest, and scheduled task **(you — after 5a passes)**

The validated source package is in `plugins/compliancehub-internal`. It stays
private and must not be submitted to the public plugin directory. Its
`.app.json` references the registered private application
`asdk_app_6a82f504a814819182e544ececddefc9`.

1. Deploy the exact staging commit and complete every gate in section 5a.
2. In ChatGPT developer mode, register the canonical staging `/mcp` URL. Copy
   the application ID from the resulting plugin settings page; it starts with
   `asdk_app`.
3. Confirm `plugins/compliancehub-internal/.app.json` contains the registered
   mapping:

   ```json
   {
     "apps": {
       "compliancehub": {
         "id": "asdk_app_6a82f504a814819182e544ececddefc9"
       }
     }
   }
   ```

   Validate the finished package with
   `python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/compliancehub-internal`.
4. Install the finished package from a private local or organisation-controlled
   marketplace. Share it only with the internal ChatGPT/Codex workspace. The
   `daily-compliance-brief` skill supplies the Codex workflow; the MCP server's
   own instructions carry the essential closed-world and write constraints for
   Claude and other clients.
5. Connect the designated Owner OAuth account. Confirm Member and Admin accounts
   can use read tools but receive `FORBIDDEN` from `post_daily_digest`.
6. Run digest generation in shadow mode without calling the post tool. Manually
   compare every number, date, control reference, and selected priority with the
   returned fact bundle.
7. After Mukta verifies the intended incoming webhook, configure its exact
   canonical URL digest as the server-only `SLACK_ALLOWED_WEBHOOK_SHA256`
   deployment secret. Enable only that Mukta-owned, server-approved private
   Slack destination as the organisation's digest channel. A label or channel
   name is display text, never destination identity.
   Run three manual London-date deliveries and verify one delivery row, one
   immutable attempt history, one safe audit trail, and no duplicate for each
   date. Exercise a confirmed Slack rejection and an ambiguous network outcome;
   only the confirmed failure may be retried.
8. Only after those three runs pass, create the hosted Codex scheduled task for
   **09:00 Europe/London** with the platform default model and reasoning settings
   and the designated Owner connection. First call `list_workspaces`. If the
   Owner can access more than one workspace, put the exact intended workspace
   UUID in the saved prompt; do not rely on a display name or an undefined
   "configured workspace". Use this task prompt:

   > This is the trusted hosted scheduled-post invocation. Use
   > `$daily-compliance-brief` for today's Europe/London date and deliver the
   > result to the server-approved private Slack destination. Resolve the single accessible
   > ComplianceHub workspace, or use the exact saved workspace UUID, call
   > `prepare_daily_digest`, and stop successfully if already
   > delivered. Summarise only returned facts using the skill's exact composition
   > contract, then call `post_daily_digest` once. Report failed or unknown
   > delivery outcomes for human review and never retry an unknown.

9. Keep delivery on the private channel for three scheduled runs, then move the
   existing configured digest flag to the team channel. Dogfood for ten business
   days while retaining the web application as the administration and fallback
   surface. Review the first ten digests manually.

V1 is accepted only when every numerical claim matches its fact bundle, no
duplicate or unauthorised post occurs, no restricted content appears, and at
least 95% of scheduled runs deliver successfully. An `unknown` outcome is not a
successful delivery and always requires human review. Do not create the schedule
before the registered app mapping and private-channel tests exist; a locally
scheduled job cannot substitute for the hosted Owner OAuth connection.

## 6. Slack alert channel (optional) **(you)**

1. Mukta creates and verifies one incoming webhook for the intended private
   destination. Compute the lowercase SHA-256 of its canonical URL using an
   approved secret-entry workflow and store only that digest as the server-only
   `SLACK_ALLOWED_WEBHOOK_SHA256` deployment secret.
2. In **Settings → Connections → Alert channels**, add the webhook and minimum
   severity. Only the Mukta-owned, server-approved private Slack destination is
   accepted; the encrypted webhook is never selected back into the page.
3. Disable or remove the channel to stop delivery. In-app notifications remain
   always on; disabled Slack channels are excluded by the monitoring worker.

## Self-hosting (alternative)

Use the official Supabase Docker distribution and deploy the Next.js container behind TLS. The operator owns patching, availability, monitoring, backups, recovery testing, email delivery, and secret rotation. The same environment variables and cron endpoints apply.
