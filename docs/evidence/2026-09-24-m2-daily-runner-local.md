# Milestone 2 daily GitHub collection: local source evidence

This is source and test evidence on `codex/m2-monitoring-design`, not a scheduled AWS dev run or a live GitHub App result.

## What the code now does

- One daily UTC request key is shared by the protected cron route and a finite command. Existing repository selection, reservation and lease recovery remain the boundaries for the run.
- The shared runner collects eligible repositories and then reconciles up to 100 official-result jobs. A failed repository does not prevent a successful repository from being considered. A partial technical observation is not itself an operational scheduling failure.
- Collection failure, deferred work, failed materialisation and a same-day retry of an already failed or rate-limited run all keep the operational result at **needs attention**. The command exits unsuccessfully for incomplete work and prints only aggregate counts. Its overall deadline stops a stalled process without printing provider or database details.
- The existing cron route keeps its separate webhook drain and response shape. No workflow, Docker image or live schedule was changed.

## Fresh checks

- The same-day duplicate failure and stalled-command deadline tests failed before their fixes, then passed. The five focused collection/command suites passed **44 tests** before the final two regressions; the final focused run passed **25 tests across the three affected suites**.
- After integration and the two independent-review fixes, the full application run passed **356 files, 3,224 tests, 3 intentionally skipped**. TypeScript, full lint and a guarded production build passed.
- A direct command invocation with deliberately blank required configuration exited unsuccessfully with only a generic error; it did not call a provider or database. This is a safe failure check, not proof that a live command collects data.
- The earlier disposable database clean-install and upgrade checks predate this source-only runner. No database migration was added or rerun for this increment.

## Release boundary

The Milestone 1 `build-runtime-bundles.ts` and Docker packaging are still on a separate integration branch. This command is not yet bundled into the AWS dev image. No default-branch daily workflow, actual scheduled event, private-channel compliance-change alert, built-in AI mapping proposal or live selected-repository acceptance has been demonstrated. The production-mode local Monitoring preview at `http://127.0.0.1:3500/app/monitoring` remains on the earlier individual-review build. Do not treat its fictional screen as evidence for the new runner, and do not deploy this partial Milestone 2 branch yet.
