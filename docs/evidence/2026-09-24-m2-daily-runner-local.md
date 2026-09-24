# Milestone 2 daily GitHub collection: local source evidence

This is source and test evidence on `codex/m2-monitoring-design`, not a scheduled AWS dev run or a live GitHub App result.

## What the code now does

- One daily UTC request key is shared by the protected cron route and a finite command. Existing repository selection, reservation and lease recovery remain the boundaries for the run.
- The shared runner collects eligible repositories and then reconciles up to 100 official-result jobs. A failed repository does not prevent a successful repository from being considered. A partial technical observation is not itself an operational scheduling failure.
- Collection failure, deferred work, failed materialisation and a same-day retry of an already failed or rate-limited run all keep the operational result at **needs attention**. The command exits unsuccessfully for incomplete work and prints only aggregate counts. Its overall deadline stops a stalled process without printing provider or database details.
- The existing cron route keeps its separate webhook drain and response shape. The production Dockerfile now bundles the finite runner. A proposed protected AWS dev workflow binds a daily run to the exact healthy App Runner ECR digest and release SHA, then runs the container with a bounded deadline and only the required provider/database configuration. This workflow is source on the feature branch, not an active schedule.
- The workflow fails if the container exits unsuccessfully or omits a valid final count-only summary. It reconstructs only approved count fields for logs, keeping repository names, provider text and secrets out of the intended output.

## Fresh checks

- The same-day duplicate failure and stalled-command deadline tests failed before their fixes, then passed. The five focused collection/command suites passed **44 tests** before the final two regressions; the final focused run passed **25 tests across the three affected suites**.
- After integration and the two independent-review fixes, the full application run passed **356 files, 3,224 tests, 3 intentionally skipped**. TypeScript, full lint and a guarded production build passed.
- A direct command invocation with deliberately blank required configuration exited unsuccessfully with only a generic error; it did not call a provider or database. This is a safe failure check, not proof that a live command collects data.
- The earlier disposable database clean-install and upgrade checks predate this source-only runner. No database migration was added or rerun for this increment.
- After packaging integration, the full application suite passed **359 files, 3,250 tests, 3 intentionally skipped**. Typecheck, full lint, guarded runtime bundle build and guarded web production build passed. The isolated packaging increment also passed **12 focused tests**, workflow syntax validation and a missing-configuration smoke check that failed closed. An independent review identified three workflow defects before integration; all three were corrected with parser and workflow regressions.
- [Fresh feature-branch CI](https://github.com/mukta2701/ComplianceHub/actions/runs/35960457196) passed secret scanning, container build/smoke, database upgrade (14 assertions) and full pgTAP (110 files, 2,515 assertions), 3,250 application tests with 3 skips, 5 integration files, and 32 Chromium browser tests with 26 intentionally skipped. The browser journey now asserts the truthful “Checked recently” label and opens Owner mapping review when approvals are pending. This is CI against disposable data, not a live GitHub provider or AWS scheduled run.

## Release boundary

This Milestone 2 branch now has its own runtime bundle and Docker packaging, but the command is **not in the AWS dev image**. No default-branch daily workflow, actual scheduled event, private-channel compliance-change alert, built-in AI mapping proposal or live selected-repository acceptance has been demonstrated. The production-mode local Monitoring preview at `http://127.0.0.1:3500/app/monitoring` remains on the earlier individual-review build. Do not treat its fictional screen as evidence for the new runner, and do not deploy this partial Milestone 2 branch yet.
