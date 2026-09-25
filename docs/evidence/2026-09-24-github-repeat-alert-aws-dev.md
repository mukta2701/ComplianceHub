# GitHub repeat-alert AWS dev release, 24 September 2026

## Release

The owner authorised the AWS dev database update and web deployment. The feature branch `codex/m1-repeat-incident-alert` supplied source `605e0c8902d4b3d6412f954dbfc13f5b6a401bbb`. [CI run 36019876656](https://github.com/mukta2701/ComplianceHub/actions/runs/36019876656) passed its application, database upgrade and pgTAP, container, and secret checks for that source. The [local repeat-alert evidence](2026-09-24-github-repeat-alert-local.md) records the focused 164-assertion test and independent review.

The linked Supabase project reference matched the existing `aws-dev` public project URL. A migration dry run named only `20260924120000_github_connection_repeat_incident_fix.sql`. The migration applied without error. A read-only database query then found one matching migration-history row, the new private queue function, service-role permission to call the projector, and no authenticated-role permission to call it. No data-reset command ran.

[Manual deployment run 36022196112](https://github.com/mukta2701/ComplianceHub/actions/runs/36022196112) succeeded for the exact source above. The optional reconciliation-acceptance jobs were off and skipped. A fresh request to `/api/health/live` returned `status: ok` and the same release SHA. A fresh request to `/api/health` returned `status: ok`, `db: ok`, and the same release SHA. Samples of the public App Runner address returned healthy results before and after the switch.

## Limit

These checks prove the reviewed source and migration reached AWS dev and that the application can reach its database. They do not prove that a new GitHub incident produces a Slack message or that the message's link opens the correct ComplianceHub record. This release did not suspend the GitHub App, change repository scope, dispatch a reconciliation run, or send a test alert. The hourly reconciliation workflow is not yet on the default branch; Admin/Member hosted checks and human acceptance remain open.
