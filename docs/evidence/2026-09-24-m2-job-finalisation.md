# Milestone 2 GitHub job finalisation: local verification

This is a local source and database checkpoint on `codex/m2-monitoring-design`, not a hosted release or live GitHub App acceptance.

## Change

An individual, current Owner approval now wakes the matching parked GitHub materialisation job. A successful worker lease that reaches its final allowed attempt can also detect a newly approved check that arrived while it was working: it leaves the job claimable with a fresh attempt budget instead of silently exhausting it. All-rejected collections complete without creating official results. The older whole-pack result writer remains inaccessible to application roles; historical records remain readable.

The direct database test holds an exact-entry approval transaction open while a second session tries to finalise attempt 25. It verifies the second session waits, the approval commits, completion resets the budget, the next claim starts at attempt 1, and the newly approved check becomes a second official result. The test first failed against the old finaliser at the budget-reset and next-claim assertions, then passed with the fix. Retryable exhaustion, stale lease tokens, idempotent replay and unrelated-organisation isolation are also covered. Test fixtures are removed after the run.

## Fresh checks on 24 September 2026

- A disposable local database passed both a from-scratch migration replay and an upgrade from migration `20260807047000`; each ran 110 database test files and 2,515 assertions with exit code 0. The preserved preview database and AWS were not migrated or reset.
- The targeted application materialiser test passed 54 assertions. The full guarded application run passed 353 files and 3,191 tests, with 3 intentional skips. Typecheck, lint, shell syntax and `git diff --check` passed.
- Independent code review found no blocking code or security issue. It identified three weaknesses in the first concurrency test (ordering, incomplete approved payload and fixture cleanup); those were corrected before the final passing checks.
- The isolated test helper now accepts the current local Docker Desktop context only when its endpoint is a local Unix socket. Its database-only stack excludes the conflicting logging service. It creates and removes a uniquely named disposable project.

## What a CISO can conclude

This prevents a quiet failure in the background job: a late Owner approval remains queued for processing rather than being lost at the retry ceiling. It does **not** establish that all 15 observed GitHub checks are approved, current, compliant, or visible as official results. The separate [local Monitoring preview](2026-09-23-m2-monitoring-currentness.md) still uses fictional data and the earlier running build at port 3400; this backend patch makes no visual change to that preview. The UI should prominently show checks awaiting review instead of leading with “No recorded active findings” or “Up to date” when most observations lack approved official results.

## Release boundary

The individual Mapping Review presentation, daily collection schedule, compliance-change notifications to a private Slack channel, built-in AI mapping proposals requiring Owner acceptance, and a live selected-repository journey remain unfinished. The Milestone 1 GitHub App pilot acceptance also remains separately open. No AWS deployment, default-branch merge, GitHub App permission change or live Slack alert was performed by this checkpoint.
