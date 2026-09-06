# Local showcase operator guide

This guide describes the fictional Northstar showcase on the existing local
Supabase project `compliancehub`. Release acceptance and outstanding staging
items are tracked in [release-checklist.md](release-checklist.md). The current
human-review candidate and exact environment are recorded in
`artifacts/human-review-2026-09-06/acceptance-candidate.json`; final packaging is
recorded alongside it in `release-package.json`. The earlier tag
`demo-rc-20260905-3` and its acceptance artifacts remain preserved historical
checkpoints. Staging has not been deployed or accepted.

## App, workspaces and accounts

The local app is one running copy of ComplianceHub at `http://127.0.0.1:3100`,
connected to the local Supabase database. Safari and the in-app Browser can stay
signed in as different accounts. The workspace name in the sidebar identifies
the records you are viewing; changing browsers does not change the application.

- **ComplianceHub Local Demo** is the preserved reference workspace in Safari.
  Its GitHub observations are saved records. The isolated production demo launcher
  disables provider credentials, so this runtime cannot run fresh GitHub checks.
- **Northstar Demo — Showcase v1** is the fictional showcase, with its own Owner
  account and private credentials in `artifacts/showcase-v1/credentials.json`.
  Its assessment, risks, tasks, policies, evidence and audit use the same app.
  No live GitHub connection is implied by these fictional records.
- The hosted Azure app is a separate running copy with a separate database and
  accounts. A successful local sign-in does not verify its hosted counterpart.
  Hosted acceptance remains pending the staging gates in the release checklist.

Keep credentials and browser sessions private and beside their matching local
manifest. Do not paste provider keys into these fictional account files or commit
anything under the private `artifacts/showcase-v1/` directory.

The current usability changes add readable **Evidence details**, links back to
originating findings from tasks, evidence linking on audit checklists, and linked
evidence metadata/content in the audit pack. Completed tasks can still receive
new evidence. A task's **Done** status, a finding's recorded resolution and an
evidence item's freshness are separate facts. GitHub resolution still requires
a newer fresh passing observation. Human audit closure is an operator decision
supported by checklist review and evidence; it is not automated provider verification.
The separately labelled NS-AUD-002 follow-up now exercises the fictional human-review
sequence. The original NS-AUD-001 and its open observation remain unchanged.
This demonstrates recorded human verification; it does not enable live GitHub checks
or add an enforced evidence prerequisite to manual audit closure.

The newer usability checkpoint has been tested locally; see the current checklist
section and `artifacts/workflow-usability-2026-09-05/checkpoint.json` for its exact
runtime commit. RC3 remains the preserved earlier release, not a claim that the
new monitoring-to-resolution scenario is complete. To run the current checkpoint,
keep the existing checkout and use the commands below; do not switch branches over
unfinished work. The private task checkpoint preserves its pre-existing **In progress** state.

On Evidence, the compact summary shows freshness. **Linked controls (93)** opens
the baseline mapping list; **Manage links** opens the existing editing controls.
A short excerpt makes long notes readable at a glance. **Evidence details** opens
the full note; **Manage record** contains Supersede and Withdraw. Small risk/task/policy/audit links stay visible.
Technical GitHub metadata is under **Technical details**. If an account changes
in another browser tab, return to this tab to refresh its workspace and role from
the server. The restoration proof is recorded in
`artifacts/evidence-restoration-2026-09-05/acceptance.json`. The subsequent selected-record
fix was tested at `8f19bbf9f213292239acb5d444a6e377e66e366d`; its build, tests and
runtime recovery evidence are in `artifacts/runtime-check-2026-09-05/`. Always
compare the running `/api/health` release SHA with `.next/local-demo-build.json`;
an older acceptance file does not identify a newer running build.

## Fictional finding-to-review walkthrough

Use **Northstar Demo — Showcase v1**. In Internal audits, open **NS-AUD-002 —
Northstar fictional independent sign-off follow-up**. Its checklist records the
synthetic review, and its finding links to the owned corrective-action task.
The task is Done. The rehearsal independently checked that the finding stayed
In progress at that point; only a later explicit human closure changed it.

Open the linked **Northstar FICTIONAL human review — NS-AUD-002** evidence note.
It identifies the task, finding, checklist, control, review time, synthetic sample
and limitations. Its collection date and validity are separate from task status.
Return to the audit to inspect the compliant checklist and closed finding in its
Reporting stage, then export the audit pack. A separate new Member report snapshot
reflects this recorded state; the original publication remains preserved. The original audit's open observation is deliberately
retained; this scenario does not claim the entire workspace is audit-ready.

To extend an existing prepared local showcase, run:

```sh
npm run demo:setup -- -- --human-review
npm run demo:setup -- -- --human-review --verify-only
```

Both separators are intentional: npm forwards one to the guarded launcher, which
forwards the remaining arguments to setup. Subsequent ordinary setup runs also
verify an existing human-review scenario. Setup checkpoints exact intended changes
and refuses unrelated drift. If it stops with a pending action, preserve the
manifest and log; confirm whether that action committed before retrying. Never
clear a pending journal or delete records merely to make setup pass. The recorded
first rehearsal includes recovered timing and selector failures for reference.

The original readiness PDF is preserved. New exports use
`artifacts/showcase-v1/human-review-audit-pack.csv` and
`artifacts/showcase-v1/human-review-readiness-report.pdf`.
Final release/browser acceptance remains recorded in the single release checklist.

## Start the demo

Prerequisites: Node 22 or later (rehearsed with Node 25.6.1/npm 11.9.0), the
locked dependencies, Supabase CLI, and the existing Colima Docker context. Allow at least 4 GB of VM memory when running the demo
and a separate database test stack together; the existing 2 GB VM needs completed
test services stopped to avoid resource pressure.
For the historical RC3 demonstration, use its tag in a separate checkout. For the
current usability checkpoint, use this existing branch; the launcher records its exact commit.
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
5. Open Performance: the fictional access-review completion measure has two
   manual readings, 85% and 95%, with a target of 95%. This demonstrates stored
   readings and a real calculated trend, not a live integration.
6. Open Internal audits: show NS-AUD-001, its non-compliant checklist item and
   observation referring to the existing treatment plan. Open Leadership report
   and download the report and audit pack.

## Recovery during the demonstration

- After a refresh, sign in again only if the normal session has expired. Do not
  repeatedly retry a rejected password: the application deliberately limits
  sign-in attempts. Saved local browser sessions let setup resume normally.
- If the app stops, rerun `npm run demo:start`. If source or migration identity
  changed, the launcher refuses the old build; build the intended commit again.
- If the page hangs, check the app with `curl --max-time 8 -fsS
  http://127.0.0.1:3100/api/health`. A timeout is a failed check, even when the
  browser still displays an old page. Check `supabase status` separately. Stop
  only the app with Ctrl-C in its startup terminal before restarting it; do not
  reset or restart the database as a first response.
- Keep a local log when rehearsing for an extended period. From the checkout,
  run the following instead of the plain start command, and leave that terminal
  open. A separate terminal can use `tail -f artifacts/runtime/current-server.log`.
  Log output is diagnostic evidence, not proof that the application is healthy.

  ```sh
  mkdir -p artifacts/runtime
  (umask 077; npm run demo:start >> artifacts/runtime/current-server.log 2>&1)
  ```

  A previous process entered an exception-reporting loop. File logging preserved
  later diagnostics and the recovered process stayed responsive at the next-day
  check; the original trigger remains unconfirmed.
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

The dashboard and report label the existing weighted SoA metric as control maturity.
Open **How this score works** for the weights and exclusions. This is separate
from verification results. Research and section-level rationale extend the existing
[design review](design-review/2026-07-06-full-app-design-and-feature-draft.md).
