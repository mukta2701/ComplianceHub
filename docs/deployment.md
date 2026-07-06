# Deployment / Go-live runbook

This is the concrete checklist to take ComplianceHub from the local build to a live
site. Steps marked **(you)** need account creation or secret entry that only the
account owner can do; everything else is already prepared in the repo.

## 0. Prerequisites

- The repo builds clean locally: `npm run lint && npm run typecheck && npm run test && npm run build` (or the `pnpm`/`npx` equivalents), plus `supabase test db` (pgTAP) green.
- Migrations `supabase/migrations/202607020001 … 202607020033` apply in order from an empty database (verified locally). No data seed is required beyond the approved catalogue content.

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
| `NEXT_PUBLIC_SITE_URL` | yes | Your real site origin, e.g. `https://app.example.com`. **The code reads `NEXT_PUBLIC_SITE_URL`** (not `…_APP_URL`) for invitation links and auth redirects, falling back to `http://localhost:3000` — so if it is unset, production invite/reset links point at localhost. |
| `CRON_SECRET` | yes | High-entropy random string; gates both cron routes. |
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

1. Custom SMTP provider in Supabase Auth (so invitation and auth emails send from your domain), with the verified application URL matching `NEXT_PUBLIC_SITE_URL`.
2. Spend controls, monitoring, and database backups; exercise a restore into a separate project before public launch.
3. The Supabase free tier and Vercel Hobby are for development, not dependable/commercial production (projects can pause; backups are limited).

## 5. Real Jira / GitHub integrations (optional) **(you)**

The integration code is complete and proven with a fake provider; connecting a **real** tracker is a documented setup step:

1. Register an OAuth app with Jira or GitHub; note the client id/secret.
2. Add a connection in **Settings → Integrations** with a valid access token (owner-only).
3. Set `INTEGRATIONS_LIVE=1` in the Vercel environment.
4. **Token storage hardening:** connection `access_token`/`refresh_token` are stored in `integration_connections` under owner-only RLS. Before relying on a real connection, move these to Supabase Vault or an encrypted column — plaintext-at-rest is acceptable only for the sandbox/dev path.

## Self-hosting (alternative)

Use the official Supabase Docker distribution and deploy the Next.js container behind TLS. The operator owns patching, availability, monitoring, backups, recovery testing, email delivery, and secret rotation. The same environment variables and cron endpoints apply.
