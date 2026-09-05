# Local showcase operator guide

This guide describes the fictional Northstar showcase on the existing local
Supabase project `compliancehub`. Release acceptance and outstanding staging
items are tracked in [release-checklist.md](release-checklist.md). The reproducible local release is tagged `demo-rc-20260905-3`. Resolve its exact
commit with `git rev-parse demo-rc-20260905-3^{commit}`; final tested identity and
results are in `artifacts/release-2026-09-05/release-acceptance.json`. Staging has
not been deployed or accepted.

## Start the demo

Prerequisites: Node 22 or later (rehearsed with Node 25.6.1/npm 11.9.0), the
locked dependencies, Supabase CLI, and the existing Colima Docker context. Allow at least 4 GB of VM memory when running the demo
and a separate database test stack together; the existing 2 GB VM needs completed
test services stopped to avoid resource pressure.
Use the checkout at `demo-rc-20260905-3` (preserve any later work before switching).
Run from the ComplianceHub checkout:

```sh
npm ci
supabase status
supabase migration up --local
npm run demo:build
npm run demo:start
```

The database must be the local `compliancehub` stack at
`http://127.0.0.1:54321`; the app opens at
[http://127.0.0.1:3100](http://127.0.0.1:3100). If the existing stack is stopped,
start it with `supabase start` from this checkout. Do not use a database reset.
The launcher checks the local Docker context, database identity, migration
version, release commit and source contents. It reads the local keys from
Supabase status and disables outbound provider credentials. It does not edit
`.env.local`, which currently points at a hosted project.

In another terminal, prepare or resume the fictional workspace:

```sh
npm run demo:setup
npm run demo:verify
npm run demo:member
```

Setup uses application workflows, saves IDs after each step, and reuses matching
records. A missing or changed previously recorded row stops setup for review.
It does not delete records or repair drift automatically. Keep
`artifacts/showcase-v1/` with this local database: it contains the manifest,
private synthetic credentials, browser session, and generated exports. Do not
commit these files or share the browser session. The preserved CEO fixture is
separate and must not be reapplied.

Sign in with the local credentials in
`artifacts/showcase-v1/credentials.json`. Select **Northstar Demo — Showcase v1**.
The current linked page URLs are in `artifacts/showcase-v1/manifest.json`.

## Five-minute demonstration

1. Open Gap assessment: show all ten answers and the completed, read-only
   assessment. One answer records pending independent access-review sign-off.
2. Open its Statement of Applicability: show the control decisions, named owner,
   fictional evidence, and immutable final version. Explain that the remaining
   improvement is deliberate and the data does not represent certification.
3. Open Risk register: follow NS-R-001 and explain its medium residual score.
   Follow the linked treatment task NS-RTP-001 to show the same owner and due
   date, risk, control, and evidence.
4. Open Evidence and Policies: show the access-review sample and approved
   NS-POL-001 policy. All names and records belong to the same fictional workspace.
5. Open Internal audits: show NS-AUD-001, its non-compliant checklist item and
   observation referring to the existing treatment plan. Open Leadership report
   and download the report and audit pack.

## Recovery during the demonstration

- After a refresh, sign in again only if the normal session has expired. Do not
  repeatedly retry a rejected password: the application deliberately limits
  sign-in attempts. Saved local browser sessions let setup resume normally.
- If the app stops, rerun `npm run demo:start`. If source or migration identity
  changed, the launcher refuses the old build; build the intended commit again.
- If setup stops, preserve its output and rerun after correcting the cause.
  A lock records the setup process ID. Remove only a confirmed stale lock after
  checking that no setup process remains; never run two setups together.
- If an export fails, keep the visible error and use the already verified local
  exports only after identifying their release and snapshot. Do not claim a
  failed live export worked.
- Do not restore a backup over the demo database as an ad-hoc repair. The raw
  pre-showcase backup is preserved under `artifacts/release-2026-09-05/` and has
  a known historical synthetic audit-row consistency limitation. Restoration
  work belongs in a separate environment.

## Scope

External Slack/email/provider delivery is disabled for this rehearsal.
Selected external report sharing, private policy feedback notifications, and
policy-to-control mapping remain outside the delivered implementation. Local
acceptance does not constitute staging acceptance or permission to deploy.

The SoA export contains manual evidence references from its immutable snapshot;
linked evidence records are shown in the live evidence vault and are not embedded
attachments. The export now states this distinction explicitly.

Security rehearsal limits public auditor views to 300 requests per minute across
the site and 30 per issued link. A limited link displays temporary unavailability.
Jira credential RPCs and direct counter updates require the backend service role. Audit events permit backend inserts and member-scoped reads; API roles cannot truncate the log or manipulate its identity sequence. Public error reporting
returns 503 without a write if durable limiter storage is unavailable. Two
moderate npm audit entries remain for one UUID advisory in ExcelJS; the identified
ExcelJS path calls unaffected v4, as recorded in the release checklist.

For a stopped app with the existing matching build/database, only
`npm run demo:start` is needed. The accepted local database migration checkpoint
is `20260905013000` (129 migrations). Do not point these commands at hosted
Supabase or copy the synthetic local encryption key into staging.

Re-run the saved desktop/mobile acceptance without creating business records:
stop the app server first, then run:

```sh
SHOWCASE_REHEARSAL=1 node --import=tsx scripts/demo-local.ts test-e2e -- e2e/showcase.spec.ts --workers=1 --retries=0
npm run demo:start
```

Exports append audit metadata as expected. The audit record contains the user,
workspace, resource and format; it does not contain exported document contents.
