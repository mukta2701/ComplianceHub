# Milestone 2 retired GitHub writer: local checkpoint

This checkpoint closes one old result-writing route on the isolated `codex/m2-monitoring-design` branch. It is not an AWS release or Milestone 2 acceptance.

## What changed

- An additive migration removes `EXECUTE` on `materialise_github_observations_server` from `PUBLIC`, `anon`, `authenticated`, and `service_role`. It retains the function and historical rows for reading and database-owner maintenance.
- The application already calls `materialise_github_approved_entries_server` for exact approved entries. No application caller of the old writer was found.
- Database tests now require an actual service-role permission denial and a successful replay through the exact-entry writer. Historical fixture tests use a session-local, test-only helper rather than restoring runtime access. The older test's Member approval-read expectation now matches the current Admin/Owner-only policy.

## Fresh verification, 24 September 2026

The named disposable local database was `supabase_db_compliancehub-m2-sourceonly`. Eight database suites ran sequentially through the local resource guard, with no database reset. All exited 0: 070 (181 assertions), 072 (78), 073 (62), 078 (17), 079 (62), 115 (49), 116 (4), and 117 (20). Total: 473 assertions, no `not ok`. The new denial test first failed against the old grant, then passed after the migration. A direct local privilege check found no legacy-writer execution for application roles and retained execution for `service_role` on the new writer. `git diff --check` passed. Independent source review found no blocking issue.

Suite 070's concurrency fixture requires a TCP connection with password authentication. Its first local attempt through a Unix socket had no server IP for its own dblink connection and did not test the product behavior. The final TCP run passed all 181 assertions. The disposable database had earlier migrations applied directly without matching migration-ledger entries, including the preceding Monitoring change. These results prove focused behavior, not a clean migration-chain upgrade.

The signed-in local Owner preview at `http://127.0.0.1:3400/app/monitoring` remained available and showed one current approved result from a fictional 15-observation collection. This database permission change does not change the screen layout. The browser's current view is local, fictional evidence, not live GitHub or AWS evidence.

## CISO reading of the preview

Counting only the one approved, current result is more honest than showing all 15 observations as passing compliance checks. The screen still puts “No recorded active findings” and “Up to date” ahead of the review gap. An Owner could mistake collection freshness for overall compliance readiness; the 14 observations without official approved results need a clearer review count and next action. Do not claim a clean monitoring position from this preview.

## Release boundary

AWS's currently served application must move to the exact-entry writer before the old writer's permission is revoked there. The AWS deploy workflow does not apply database migrations, and this checkpoint did not change AWS. Job-finalisation race handling, the individual Mapping Review presentation, actual daily scheduling, compliance-change Slack alerts, Owner exceptions, built-in AI mapping proposals, a clean upgrade test, and a live read-only selected-repository journey remain separate acceptance gates. The approved plan places AI proposals in Phase 4, after the deterministic monitoring path is reliable; an Owner must accept a proposal before it can affect an official result.
