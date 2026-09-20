# GitHub connection AWS dev evidence — 20 September 2026

## Accepted candidate boundary

- Source: `689e1f2f0257aac7d20ef6f36454fd124b729f88` on `feature/m1-phase7-connections`.
- Hosted target: the existing AWS dev App Runner service in `eu-west-2`.
- Runtime image: `sha256:8f8c2385ff3b33640e53641f567bb6488850e3172e94a8e42d3271c9aaac358b` from the existing `compliancehub-dev` ECR repository.
- Database change: only migration `20260920110000_github_connection_alert_delivery_worker.sql` was named by the dry run, applied to the linked dev project, and then present in matching local and remote migration history.

This evidence covers the AWS dev acceptance candidate. It does not describe company staging or production.

## Fresh hosted evidence

[AWS dev deployment and reconciliation run 35523262051](https://github.com/mukta2701/ComplianceHub/actions/runs/35523262051) completed successfully on its second attempt for the exact candidate SHA. The original attempt deployed and verified the web service but exposed one missing ECR layer-download permission on the existing GitHub Actions role. The role's existing inline policy was inspected before change. Only `ecr:GetDownloadUrlForLayer` was added to the existing statement scoped to the `compliancehub-dev` repository; no trust rule, role, attached policy or cross-account access changed. AWS policy simulation changed from `implicitDeny` to `allowed` for that exact action and repository.

The failed jobs were rerun against the already deployed candidate rather than rebuilding or redeploying it. The workflow verified the deployed release SHA and immutable image digest before each container invocation.

- App Runner liveness: `status=ok`, release SHA `689e1f2f0257aac7d20ef6f36454fd124b729f88`.
- App Runner database health: `status=ok`, `db=ok`, same release SHA.
- First finite runner call: finished in 24 seconds; `webhookDeliveriesClaimed=0`, `installationsClaimed=1`, `healthy=1`, `retrying=0`, `actionRequired=0`, `recovered=0`, `ownershipLost=0`, `slackClaimed=0`, `slackDelivered=0`, `slackFailed=0`.
- Second finite runner call: finished in 30 seconds; every reported count was zero.
- Both jobs used the same candidate release and immutable image and exited successfully within the workflow bound.
- A fresh count-only database query for the two-minute UTC window containing both calls found one successful scheduled reconciliation, no unsuccessful reconciliation, and zero opened incidents, resolved incidents, connection notifications or connection Slack-delivery rows. The query selected no identifiers, payloads or destinations.

The first call therefore demonstrated one healthy live-provider reconciliation. The immediately repeated call found no due work and produced no incident, recovery or Slack activity.

## Evidence limits

- The container ran on GitHub-hosted workers using the existing protected `aws-dev` environment. This is not evidence that the App Runner web process itself runs a background worker.
- The repeated healthy call is bounded no-work evidence. It does not prove incident or recovery deduplication under a real provider failure.
- No live Slack destination was configured or exercised; both calls reported zero Slack work.
- Owner, Admin and Member behavior was not freshly rehearsed in this run.
- Webhook redelivery, repository-scope removal and restoration were not exercised.
- The standalone hourly workflow is not registered on the default branch yet, so this is manual acceptance evidence rather than an actual scheduled event.
- The feature branch is not merged. No production, wider rollout or human acceptance is claimed.

Task 7 must supply the live Slack, role, replay and provider failure/recovery evidence. Task 8 must supply merge, automatic `main` deployment, actual default-branch schedule and final human acceptance evidence.
