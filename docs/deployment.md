# Deployment / Go-live runbook

## GitHub shadow collection maintenance

The personal Azure staging environment runs the read-only GitHub shadow collector
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

Personal staging requires `CRON_SECRET` and all eight `GITHUB_*` values listed
below. They are runtime-only deployment secrets, rotated together through one
inactive a/b slot. Keep the private key and all GitHub tokens out of application
tables, logs, build output, client-visible environment variables, and local
developer environment files.

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

## 1. Hosted Supabase **(you)**

1. Create a managed Supabase project (a UK/EU region where available).
2. Apply the committed migrations to it (link the project, then `supabase db push`, or run the SQL in order). Do **not** run `db reset` against production.
3. From the project's API settings, copy: the **Project URL**, the **anon key**, and the **service-role key** (server-only).

### GitHub foundation migration checkpoint

The personal staging project for this rollout is project ref
`ytenjiyjdcrjkgwmciqw`. Confirm that exact ref in both the Supabase dashboard and
CLI before linking or applying anything, then take and verify a recoverable
backup. From the last deployed schema, both `supabase migration list` and
`supabase db push --dry-run` must show exactly these four pending additive
migrations, in this order:

1. `20260817010000_github_collection_foundation.sql`
2. `20260817020000_github_collection_run_leases.sql`
3. `20260817030000_github_webhook_delivery_ids.sql`
4. `20260817192458_github_shadow_ui_summary.sql`

Stop if the project ref, ordering, or pending set differs. After the backup is
verified, apply that reviewed set once with `supabase db push`, rerun
`supabase migration list`, and verify the GitHub tables, security-invoker summary
view, and service-only RPC signatures. Only then set the protected environment
variables `HOSTED_SUPABASE_PROJECT_REF=ytenjiyjdcrjkgwmciqw` and
`HOSTED_SUPABASE_MIGRATION_VERSION=20260817192458`. The deploy preflight binds
both attestations to the exact `NEXT_PUBLIC_SUPABASE_URL`; changing the target
project invalidates the gate. These attestations are not substitutes for the
list, dry run, backup, or direct verification. The migrations remain compatible
with the previous application revision; rolling the Container App back does not
roll the database back.

## 2. Azure Container Apps staging **(you — external authorization checkpoint)**

The staging target is Azure Container Apps Consumption in UK South. It scales
from zero to one replica and uses a public immutable image in GHCR; do not create
an Azure Container Registry. Render, AWS, and Vercel hosting are not used.

1. Install Azure CLI and Bicep, then sign in to the intended subscription.
2. Deploy `infra/azure/foundation.bicep` at subscription scope. Supply the owner
   email for budget alerts. The template creates the resource group, capped
   30-day Log Analytics workspace, Consumption environment, bootstrap app, and a
   one-unit monthly budget in the subscription's billing currency with 50%, 80%,
   and 100% notifications.
3. Record the `containerAppFqdn` output. Set `NEXT_PUBLIC_SITE_URL` to its HTTPS
   origin and `MCP_RESOURCE_URL` to the same origin ending exactly in `/mcp`.
4. Create the protected GitHub environment `azure-staging`. Configure the
   variables and secrets below. Public values are build inputs; secret values
   are written directly to alternating Container Apps secret slots and are never
   placed in the Bicep parameters file or container image.
5. Create a Microsoft Entra application and GitHub federated credential only
   after the account owner approves the persistent authorization. Grant only the
   custom ARM-deployment role at the staging resource group, Container App
   read/write at the exact app, and managed-environment read/join at the exact
   environment. Azure CLI also needs `listSecrets/action` at that exact app to
   preserve the untouched rollback slot during its update; never print that
   response. Do not grant subscription scope, Contributor, delete, exec, or
   role-management permissions.
6. The **Deploy Azure staging** workflow publishes and deploys `main` only after
   the complete `CI` workflow succeeds. A manual run may publish without
   deploying, or deploy a deliberately selected ref after the workflow exists on
   the default branch. The deploy job alone receives the Azure OIDC token and
   environment secrets; build and test actions run outside that trust boundary.
7. Verify the GHCR package is anonymously pullable before deployment. This
   public repository's package inherits public visibility, so Container Apps
   needs no long-lived registry credential. The workflow deploys the immutable
   image digest, not a mutable tag.
8. The first rollout may initialise slot `a` only when all three legacy secret
   references are absent. Later rollouts write credentials to the opposite slot
   only after proving the legacy references are coherent and the prior GitHub
   reference set is either absent (the one-time upgrade) or all eight values in
   the same slot; partial or mixed state fails closed. It creates a new revision
   even on a rerun, waits for that exact
   revision to be Healthy/Running and `latestReadyRevisionName`, then validates
   that the canonical origin exactly matches the Container App ingress FQDN
   before checking liveness, readiness, OAuth resource metadata, and the bounded
   unauthenticated MCP challenge. On failure or cancellation it copies the
   previous healthy revision and applies the same exact-revision proof before
   bounded rollback smoke.
9. Do not merge or deploy this release until the hosted migration checkpoint and
   GitHub organisation-owner registration checkpoint below are complete. The
   current environment has no GitHub App values, `main` auto-deploys after CI,
   and no environment reviewer currently supplies a second approval boundary.

GitHub environment variables:

| Variable | Value |
|---|---|
| `AZURE_RESOURCE_GROUP` | `rg-compliancehub-staging-uks` |
| `AZURE_CONTAINER_ENVIRONMENT` | `cae-compliancehub-staging-uks` |
| `AZURE_CONTAINER_APP` | `ca-compliancehub-staging` |
| `NEXT_PUBLIC_SUPABASE_URL` | Staging Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required legacy public key used by current browser/server clients |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Preferred public key |
| `NEXT_PUBLIC_SITE_URL` | Exact Azure HTTPS origin |
| `MCP_RESOURCE_URL` | Exact Azure HTTPS origin plus `/mcp` |
| `SUPABASE_OAUTH_ISSUER` | `https://<project-ref>.supabase.co/auth/v1` |
| `SUPABASE_OAUTH_JWKS_URL` | `<issuer>/.well-known/jwks.json` |
| `MCP_JWT_ALGORITHMS` | `RS256,ES256` |
| `HOSTED_SUPABASE_PROJECT_REF` | `ytenjiyjdcrjkgwmciqw`, only after the exact hosted project, backup, and four-migration checkpoint above pass |
| `HOSTED_SUPABASE_MIGRATION_VERSION` | `20260817192458`, only after the four-migration checkpoint above passes |
| `REGISTERED_GITHUB_APP_SITE_URL` | Exact canonical origin registered in GitHub; must equal `NEXT_PUBLIC_SITE_URL` |

GitHub environment secrets:

GitHub Actions does not allow user-defined secret names beginning `GITHUB_`, so
the protected environment uses the `AZURE_GITHUB_*` source names below. The
deploy job maps them to the exact `GITHUB_*` Container App runtime names without
printing their values.

| Secret | Purpose |
|---|---|
| `AZURE_CLIENT_ID` | OIDC application/client ID |
| `AZURE_TENANT_ID` | OIDC tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Target subscription ID |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only cron and validated digest lifecycle |
| `APP_ENCRYPTION_KEY` | Stable AES-256-GCM application key |
| `CRON_SECRET` | Authenticates maintenance workflow calls |
| `AZURE_GITHUB_APP_ID` | Maps to runtime `GITHUB_APP_ID`; numeric private App ID |
| `AZURE_GITHUB_APP_CLIENT_ID` | Maps to runtime `GITHUB_APP_CLIENT_ID`; App OAuth client ID |
| `AZURE_GITHUB_APP_CLIENT_SECRET` | Maps to runtime `GITHUB_APP_CLIENT_SECRET`; App OAuth client secret |
| `AZURE_GITHUB_APP_PRIVATE_KEY` | Maps to runtime `GITHUB_APP_PRIVATE_KEY`; PKCS#8/PEM key stored as one line with literal escaped `\n` markers |
| `AZURE_GITHUB_WEBHOOK_SECRET` | Maps to runtime `GITHUB_WEBHOOK_SECRET`; high-entropy webhook HMAC secret |
| `AZURE_GITHUB_APP_SLUG` | Maps to runtime `GITHUB_APP_SLUG`; exact private App slug |
| `AZURE_GITHUB_ALLOWED_ACCOUNT_ID` | Maps to runtime `GITHUB_ALLOWED_ACCOUNT_ID`; immutable numeric Adtecher organisation ID |
| `AZURE_GITHUB_APPROVED_SECURITY_WORKFLOW_IDS` | Maps to runtime `GITHUB_APPROVED_SECURITY_WORKFLOW_IDS`; one to twenty comma-separated numeric workflow IDs for the dedicated pilot repository |

GitHub may download an RSA private key with a `BEGIN RSA PRIVATE KEY` header,
but the runtime deliberately accepts PKCS#8 only. Convert the downloaded key
offline with `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt`, confirm
the converted first line is exactly `-----BEGIN PRIVATE KEY-----`, and then use
an approved secret-entry tool to replace each newline with the two literal
characters `\n`. Do not print the converted key, paste it into a shell history,
or store either key file in this repository. The deployment preflight rejects
actual newlines, a non-PKCS#8 header, or a missing PKCS#8 footer.

Application environment variables (names must match `.env.example`):

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server-only.** Used by cron routes and the MCP daily-digest delivery boundary only after user-scoped Owner, current-fact, and message validation. Never expose it to the client. |
| `NEXT_PUBLIC_SITE_URL` | yes | Your real site origin, e.g. `https://app.example.com`. It is the canonical origin for invitation and Auth redirects; production fails closed if it is absent. |
| `CRON_SECRET` | yes | High-entropy random string; gates all maintenance cron routes. |
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
personal staging deployment is triggered. Do not use a user-owned App or a
personal repository as a substitute.

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

Enter the eight GitHub runtime values only through their `AZURE_GITHUB_*` secret
aliases in the protected personal `azure-staging` environment. Do not add them to `.env.local`, repository
variables, Docker build arguments, application tables, workflow output, forks,
or the unavailable Adtecher Azure environment. The local seeded Playwright proof
does not require these values and makes no GitHub request.

## 3. Cron automation (GitHub Actions calling Azure)

`.github/workflows/azure-maintenance.yml` declares four UTC schedules and calls
the Azure origin with `CRON_SECRET` from the protected `azure-staging`
environment:

- `POST /api/cron/github-collect` — `29 5 * * *` (05:29 UTC daily). Runs the lease-protected, read-only GitHub shadow collector before any downstream maintenance. During the first pilot, select exactly one dedicated repository.
- `POST /api/cron/daily` — `7 6 * * *` (06:07 UTC daily). First classifies digest reservations left in-flight for more than 15 minutes as `unknown` for human review (never automatic retry), collects evidence, runs integration sync, and then performs the evidence-freshness + policy-review sweep. Notifications are deduplicated per day and a new task is opened only when none is already open for that item, so retries and manual runs are safe.
- `POST /api/cron/monitor` — `13 7 * * *` (07:13 UTC daily). Checks every organisation's configured monitoring sources, reconciles findings, and sends enabled finding alerts. Non-zero minutes avoid GitHub Actions' highest scheduled-load window.
- `POST /api/cron/automation-purge` — `29 7 * * *` (07:29 UTC daily). Purges expired source content while retaining hashed provenance and proposal references for the configured retention window.

Integration sync is folded into the 06:07 UTC daily pipeline. The compatibility route `POST /api/cron/integrations-sync` remains available for a deliberate manual run, but it has no separate Vercel schedule and must not be described or deployed as an hourly cron.

The workflow sends `Authorization: Bearer <CRON_SECRET>`; each route rejects any request whose bearer token does not match. Manual invocation in development:

```bash
curl -i -X POST http://localhost:3000/api/cron/github-collect -H "Authorization: Bearer $CRON_SECRET"
curl -i -X POST http://localhost:3000/api/cron/daily   -H "Authorization: Bearer $CRON_SECRET"
curl -i -X POST http://localhost:3000/api/cron/monitor -H "Authorization: Bearer $CRON_SECRET"
curl -i -X POST http://localhost:3000/api/cron/automation-purge -H "Authorization: Bearer $CRON_SECRET"
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
4. Supabase Free and Azure's monthly Container Apps grant are for internal
   staging, not a dependable production SLA. Scale-to-zero creates cold starts;
   budget alerts do not impose a hard spending cap.
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
7. Enable one private Slack test channel as the organisation's digest channel.
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
   > result to the configured Slack channel. Resolve the single accessible
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

1. Create a Slack incoming webhook for the intended workspace/channel.
2. In **Settings → Connections → Alert channels**, add the webhook and minimum
   severity. The encrypted webhook is never selected back into the page.
3. Disable or remove the channel to stop delivery. In-app notifications remain
   always on; disabled Slack channels are excluded by the monitoring worker.

## Self-hosting (alternative)

Use the official Supabase Docker distribution and deploy the Next.js container behind TLS. The operator owns patching, availability, monitoring, backups, recovery testing, email delivery, and secret rotation. The same environment variables and cron endpoints apply.
