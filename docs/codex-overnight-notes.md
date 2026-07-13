# Codex overnight readiness notes

Date: 2026-07-13  
Branch: `main`  
Readiness verdict: **NO-GO for hosted deployment until the three new database migrations are applied through the approved production migration process.**

## Executive summary

The application code on `main` is green, pushed, and proven against the local Supabase stack. The exact final code passed lint, TypeScript, 327 tests across 66 files, and a Next.js production build. A fresh authenticated browser smoke completed signup, sign-in, organisation onboarding, and loaded `/app`, risks, SoA, tasks, evidence, monitoring, and settings with zero browser console/page/HTTP 5xx errors. `/api/health` returned HTTP 200 with `db: ok`, and the fresh server log contained no errors.

Hosted deployment remains blocked because the migrations below were deliberately tested locally but not pushed to hosted Supabase:

- `20260713003509_transactional_recurrence.sql`
- `20260713005956_auditor_access_log.sql`
- `20260713010021_monitoring_findings_realtime.sql`

Deploying the application before those migrations would leave the recurrence RPC, auditor access table, and Realtime publication out of sync with the code.

## Completed work

- T1 documentation accuracy — `1833551`: corrected policy-template and capability claims to match the product.
- T2 Zod 4 migration — `020f681`: replaced deprecated UUID schema APIs and runtime-tested authenticated risk/task flows.
- T3 transactional recurrence — `fdbc83c`, `22a3396`: made recurring-task advancement atomic, database-derived, row-locked, and tenant-safe.
- T4 immutable auditor access log — `bdc7a76`: added owner-only, immutable public-audit access history with bounded UI reads.
- T5 Realtime monitoring toasts — `6a0a0c3`, `3435e1a`: added organisation-filtered Realtime delivery with bounded retry and polling fallback.
- T6 Twilio WhatsApp adapter — `52964ed`: added complete server-only credential gating, per-channel recipients, form-encoded Basic Auth delivery, safe transport errors, and deterministic no-op behavior when unconfigured.
- Final runtime repair — `5035169`: allowed only configured loopback Supabase HTTP/WebSocket origins in development CSP; production CSP is unchanged.

Optional T7-T9 work was skipped to protect the prime directive and avoid expanding deployment risk after the required tasks were green.

## Verification evidence

- `npm run verify`: passed on final source — ESLint, `tsc --noEmit`, 66 test files / 327 tests, and production build.
- Local database tests: recurrence and auditor-access pgTAP suites passed 16/16 during their task gates.
- Runtime: fresh Next.js dev process using local Supabase environment, `/api/health` HTTP 200 with database OK.
- Browser: fresh authenticated Chromium smoke across seven core application pages; zero console errors, page errors, or HTTP 5xx responses.
- Server: no errors in the fresh successful smoke log.
- Git: `main` matched `origin/main` at the start of this report and the worktree was clean.

## Required human actions before GO

1. Apply the three listed migrations to hosted Supabase using the approved reviewed production migration workflow. Do **not** run an unreviewed `supabase db push`.
2. Verify the hosted schema/RLS/publication and run the same authenticated core-page smoke against the deployment candidate.
3. Confirm `APP_ENCRYPTION_KEY`, `CRON_SECRET`, and `NEXT_PUBLIC_SITE_URL` are configured in the Vercel production environment, then trigger the deployment.
4. Clean up hosted test users, organisations, and related fixtures created during early T2/T3 runtime smoke attempts. No hosted schema mutation was performed, and cleanup was intentionally not attempted without explicit authority.
5. If WhatsApp delivery is wanted, configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_WHATSAPP_FROM`, then provision WhatsApp alert channels with a per-channel `config.to`. These are optional: with any credential absent, the adapter makes no network request.

Local recovery note: the existing hardening migration and a local-only `service_role` read grant on `public.controls` were applied to correct local stack drift after a disk-space interruption. This did not alter hosted Supabase or add a source migration.

## GO criteria

Change the verdict to GO only after the production migrations and environment checks above pass, hosted health is database-OK, and an authenticated hosted smoke has zero browser/server errors.
