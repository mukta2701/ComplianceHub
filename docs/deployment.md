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

## 5. Real Jira / GitHub integrations (optional) **(you)**

The integration code is complete and proven with a fake provider; connecting a **real** tracker is a documented setup step:

1. Register an OAuth app with Jira or GitHub; note the client id/secret.
2. Add a connection in **Settings → Integrations** with a valid access token (Owner/Admin operator-only).
3. Set `INTEGRATIONS_LIVE=1` in the Vercel environment.
4. **Token storage hardening:** connection `access_token`/`refresh_token` are stored in `integration_connections` under operator-only RLS. Before relying on a real connection, move these to Supabase Vault or an encrypted column — plaintext-at-rest is acceptable only for the sandbox/dev path.

## Self-hosting (alternative)

Use the official Supabase Docker distribution and deploy the Next.js container behind TLS. The operator owns patching, availability, monitoring, backups, recovery testing, email delivery, and secret rotation. The same environment variables and cron endpoints apply.
