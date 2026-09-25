# Integrated GitHub connection AWS dev evidence — 22 September 2026

## Candidate and environment

- Application source: `799fa7718c1bb09711093167aa938d328438fe22` on `codex/m1-main-integration` (draft PR [#27](https://github.com/mukta2701/ComplianceHub/pull/27)).
- Environment: existing AWS dev App Runner service in `eu-west-2`, not company staging or production.
- Runtime image: `sha256:e2b5c8fde5c44da183bff03af25ea19dadfa2371e89dcfb03d4db6174102ea98` from the existing `compliancehub-dev` ECR repository.
- Database: only reviewed migration `20260922191439_github_connection_lifecycle_repair.sql` was applied to the linked AWS dev Supabase project after a dry run; remote migration history then contained its version. The older root local database was not changed.

## Fresh automated and hosted checks

- [Branch CI run 35778726312](https://github.com/mukta2701/ComplianceHub/actions/runs/35778726312) and [PR CI run 35778730167](https://github.com/mukta2701/ComplianceHub/actions/runs/35778730167) both completed successfully for the exact application source. These include the database and full browser gates; they do not establish live-provider acceptance.
- [AWS dev deployment run 35780414073](https://github.com/mukta2701/ComplianceHub/actions/runs/35780414073) completed its deploy and both protected reconciliation jobs successfully for that source. The jobs checked the hosted release SHA and immutable image binding before running.
- Fresh hosted liveness reported `status=ok` and the exact application source SHA. Database health reported `status=ok`, `db=ok` and the same SHA.
- First bounded runner call reported `webhookDeliveriesClaimed=0`, `installationsClaimed=1`, `healthy=1`, `retrying=0`, `actionRequired=0`, `recovered=0`, `ownershipLost=0`, `slackClaimed=0`, `slackDelivered=0`, `slackFailed=0`. The second call reported zero for every count. Both exited successfully.
- A fresh authenticated AWS dev browser inspection showed the actual AdTecher GitHub installation Healthy, one selected/available private pilot repository, the six approved read-only permissions, and the Slack connection as Connected. Monitoring displayed live-provider findings; no fictional `Example-Co` CI fixture was present in the hosted Connections page.

## What remains unproven

- The healthy first check and idle second check do **not** prove a real provider suspension, fail-closed collection, incident/recovery deduplication, or an in-app and Slack alert. No Slack delivery occurred in these jobs.
- The agreed, bounded suspension/reactivation rehearsal requires Aman's explicit action-time coordination for the single pilot App/repository. Suspension is an agreed alternative to the original scope-removal exercise, not evidence that scope removal was tested. No suspension instruction or GO has been issued yet.
- Approved Admin and Member sessions, GitHub webhook redelivery, and Owner acceptance are still needed. Do not substitute fictional CI identities for live role proof.
- The hourly `23 * * * *` UTC workflow exists on the feature branch but has not been merged to the default branch. Therefore no actual unattended scheduled event has been demonstrated. GitHub Actions schedule can be delayed or occasionally dropped; it is not an availability guarantee.
- PR #27 is draft and unmerged. This is AWS dev manual-run evidence only, not a production or Milestone 1 completion claim.
