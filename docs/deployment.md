# Deployment / Go-live runbook

This is the concrete checklist to take ComplianceHub from the local build to a live
site. Steps marked **(you)** need account creation or secret entry that only the
account owner can do; everything else is already prepared in the repo.

## 0. Prerequisites

- The repo builds clean locally: `npm run lint && npm run typecheck && npm run test && npm run build`, plus `supabase test db` (pgTAP) green.
- All committed migrations must apply in order from an empty local database via `supabase db reset`, followed by a green `supabase test db`, before applying them to a hosted project. Never infer production safety from a stale migration/test count in documentation.
- The full Playwright e2e suite (42 tests) passes against a **production build** (`next build && next start`), confirming the deployed artifact serves the whole app end-to-end. (Locally run e2e with `--workers=1` or `--workers=2` — full parallelism overwhelms the single local Supabase with concurrent sign-ups.)

## 1. Hosted Supabase **(you)**

1. Create a managed Supabase project (a UK/EU region where available).
2. Apply the committed migrations to it (link the project, then `supabase db push`, or run the SQL in order). Do **not** run `db reset` against production.
3. From the project's API settings, copy: the **Project URL**, the **anon key**, and the **service-role key** (server-only).

## 2. Vercel project + environment **(you)**

Create a Vercel project from this repo and set these environment variables (names must match exactly — see `.env.example`):

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server-only.** Used solely by the cron routes; never exposed to the client. |
| `NEXT_PUBLIC_SITE_URL` | yes | Your real site origin, e.g. `https://app.example.com`. It is the canonical origin for invitation and Auth redirects; production fails closed if it is absent. |
| `CRON_SECRET` | yes | High-entropy random string; gates both cron routes. |
| `RESEND_API_KEY` | for invitation delivery | **Server-only.** Resend API key with sending access. Never use a `NEXT_PUBLIC_` variable for it. If absent, invitations remain retryable with status `not_configured` and no mail request is made. |
| `INVITATION_FROM_EMAIL` | for invitation delivery | **Server-only.** Verified sender, e.g. `ComplianceHub <invites@notify.example.com>`. |
| `GOOGLE_AUTH_ENABLED` | after Google setup | Server-side flag. Leave unset until the Google + Supabase checkpoints below are complete, then set to `1`. |
| `MICROSOFT_AUTH_ENABLED` | after Microsoft setup | Server-side flag. Leave unset until the Entra + Supabase checkpoints below are complete, then set to `1`. |
| `INTEGRATIONS_LIVE` | no | Leave **unset** to use the built-in sandbox tracker. Set to `1` only after step 5. |
| `NANGO_BASE_URL` | for provider OAuth | **Server-only.** Defaults to `https://api.nango.dev`; set only when using another reviewed Nango deployment. |
| `NANGO_SECRET_KEY` | for provider OAuth | **Server-only. Never `NEXT_PUBLIC_*`.** Creates short-lived Connect sessions and authorizes Nango Proxy calls. |
| `NANGO_GITHUB_INTEGRATION_ID` | for GitHub OAuth | Nango integration ID/unique key configured for the reviewed GitHub OAuth app. |
| `NANGO_JIRA_INTEGRATION_ID` | for Jira OAuth | Nango integration ID/unique key configured for the reviewed Jira OAuth app. |

## 3. Cron automation (already declared in `vercel.json`)

`vercel.json` declares two Vercel Cron entries; you only need `CRON_SECRET` set for them to work:

- `GET /api/cron/daily` — `0 6 * * *` (daily). The evidence-freshness + policy-review sweep: raises tasks and notifications when evidence goes stale or a policy's review date passes. Idempotent (notifications deduped per day; a new task is opened only when none is already open for that item), so retries and manual runs are safe.
- `GET /api/cron/integrations-sync` — `0 * * * *` (hourly). Polls external ticket status back for connected trackers. A no-op while there are no due tickets, and uses the sandbox provider unless `INTEGRATIONS_LIVE=1`.

Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`; each route rejects any request whose bearer token does not match. Manual invocation in development:

```bash
curl -i -X GET http://localhost:3000/api/cron/daily            -H "Authorization: Bearer $CRON_SECRET"
curl -i -X GET http://localhost:3000/api/cron/integrations-sync -H "Authorization: Bearer $CRON_SECRET"
```

## 4. Production hardening **(you)**

1. Verify a dedicated sending subdomain in Resend and publish the required SPF and DKIM records; publish a DMARC policy as well. Create `RESEND_API_KEY` and set `INVITATION_FROM_EMAIL` only after verification. This enables ComplianceHub's workspace-membership invitations.
2. Configure a custom SMTP provider in Supabase Auth for sign-up, confirmation, password-reset, and other Auth-owned emails, with the verified application URL matching `NEXT_PUBLIC_SITE_URL`. This is separate from the Resend HTTP adapter used for workspace-membership invitations.
3. Spend controls, monitoring, and database backups; exercise a restore into a separate project before public launch.
4. The Supabase free tier and Vercel Hobby are for development, not dependable/commercial production (projects can pause; backups are limited).
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
create provider apps, accept consent, or enter deployment secrets for you. Keep
`INTEGRATIONS_LIVE` unset until every staging checkpoint below passes.

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
   short-lived Connect session bound to the signed-in user and workspace; the
   browser never receives `NANGO_SECRET_KEY`.
4. After Nango reports success, ComplianceHub verifies the opaque connection
   reference by making a safe provider identity call through Nango Proxy. Only
   then is the reference stored. Provider OAuth access/refresh tokens remain in
   Nango and are not stored in `integration_connections`.
5. The new record remains **Authorized · setup required**. Enter a GitHub
   owner/repository or an Atlassian Cloud URL/project key. Database constraints
   prevent a forged request from enabling an OAuth row before this target is
   valid.
6. Set `INTEGRATIONS_LIVE=1` in staging. Create a remediation ticket and run the
   integration sync; verify the ticket URL/status and Nango request logs. Disabled
   and revoked connections must remain no-ops.
7. Repeat the flow in production only after staging succeeds. Record who approved
   the provider scopes and schedule rotation/review of the Nango secret and OAuth
   applications.

OAuth here is **provider authorization**: it grants ComplianceHub access to a
GitHub/Jira API. It is separate from Google/Microsoft SSO in section 4a, which
authenticates a person signing in to ComplianceHub.

The manual password-token forms remain inside **Local sandbox / developer setup**
for deterministic local tests. They are not the recommended production path.

## 6. Slack alert channel (optional) **(you)**

1. Create a Slack incoming webhook for the intended workspace/channel.
2. In **Settings → Connections → Alert channels**, add the webhook and minimum
   severity. The encrypted webhook is never selected back into the page.
3. Disable or remove the channel to stop delivery. In-app notifications remain
   always on; disabled Slack channels are excluded by the monitoring worker.

## Self-hosting (alternative)

Use the official Supabase Docker distribution and deploy the Next.js container behind TLS. The operator owns patching, availability, monitoring, backups, recovery testing, email delivery, and secret rotation. The same environment variables and cron endpoints apply.
