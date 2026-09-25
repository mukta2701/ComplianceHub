# Milestone 1 GitHub integration AWS dev acceptance design

**Status:** Approved design

**Decision date:** 20 September 2026

**Approved:** 20 September 2026

**Scope:** Replace the unbuilt company ECS and EventBridge staging acceptance path for Milestone 1. Keep the approved GitHub connection product boundary and complete the pilot in the existing AWS dev environment.

## 1. Decision

Milestone 1 will use the existing AWS dev deployment as its pilot acceptance environment. It will not create a separate staging environment.

The existing App Runner service remains the web runtime. The existing ECR repository remains the image source. A protected GitHub Actions workflow will pull the exact immutable image used by App Runner and run one finite GitHub connection reconciliation cycle with this command:

```sh
node dist/github-connection-reconcile.mjs
```

The workflow will support deliberate manual runs and a reviewed schedule. Each invocation will run one bounded cycle and exit. It will use the existing dev Supabase project, private GitHub App and one selected pilot repository.

This document changes the delivery and acceptance sections of the approved 14 September design. The original role model, six read-only GitHub permissions, selected-repository rule, connection-health behavior, data-retention rules and Milestone 1 product boundary remain unchanged.

## 2. Purpose

The revised acceptance path must prove that the implemented GitHub connection operates against the live dev provider configuration without requiring an unused company staging platform.

Completion requires current evidence for all of these behaviors:

- the web application and finite runner use the same immutable image;
- the finite runner operates against the dev GitHub App, pilot repository and database;
- the finite runner completes only GitHub connection-health Slack deliveries and leaves Monitoring work untouched;
- scheduled reconciliation repairs a missed webhook prompt;
- revoked or changed repository access fails closed;
- one in-app and one Slack incident are followed by one recovery notice;
- Owners, Admins and Members receive the approved access levels;
- replayed webhook delivery identifiers do not create duplicate work;
- GitHub receives no write request;
- automated, local, hosted, live-provider and human evidence stay separate.

## 3. Runtime architecture

### 3.1 Web runtime

AWS App Runner continues to run the production image with its default command:

```sh
node server.js
```

The deployment workflow resolves or builds the image for an exact commit, pushes it to the existing ECR repository and updates App Runner by immutable digest. Hosted health checks must report the expected release identity and database health.

### 3.2 Finite reconciliation runtime

A separate protected workflow runs the reconciliation command from the App Runner service's current ECR digest. The container runs on a GitHub-hosted Actions worker. It does not run inside App Runner, ECS or EventBridge.

The workflow must:

- use the protected `aws-dev` GitHub environment;
- authenticate to AWS through OpenID Connect and avoid permanent AWS access keys;
- read the App Runner service's current image identifier and fail unless it names the expected ECR repository by immutable digest;
- pull the image from the existing ECR repository;
- pass runtime configuration through masked environment values without placing values in command arguments, workflow output or artifacts;
- set a timeout longer than the application cycle budget but short enough to stop a stuck job;
- prevent overlapping reconciliation jobs;
- capture only the runner's sanitised summary and exit status;
- remove the local container and credentials when the job ends;
- exit successfully only when the finite command exits successfully.

The workflow will not build another image. App Runner is the source of truth for both manual and scheduled runs. An optional manual expected-release input may make the workflow fail when App Runner does not report the release under review. The workflow must record only the safe release commit and digest in acceptance evidence.

The finite command must also drain bounded Slack deliveries whose kind is `github_connection_health`. It must not claim or deliver Monitoring findings or another subsystem's notifications. The current implementation queues and leases a connection notice but depends on the unscheduled general Monitoring cron to deliver it. The implementation plan must close that gap with a connection-only claim and delivery path inside the same bounded command. The existing encrypted destination policy, destination digest check, retry limit and sanitised payload contract remain in force.

### 3.3 Scheduling

The GitHub Actions schedule replaces the proposed EventBridge scheduler for Milestone 1 only. It runs hourly at minute 23 UTC. Manual dispatch remains available for acceptance and recovery checks.

The workflow runs only connection reconciliation. It must not run Monitoring compliance evaluation, create official Evidence, create Findings, create remediation Tasks or enable the general Automation system.

GitHub Actions schedules run only from the repository's default branch. A feature branch can prove manual execution, but scheduled acceptance must wait until the approved workflow is merged. GitHub Actions schedules can start late or be skipped during provider disruption. Milestone 1 evidence must record these limits. Production scheduling and independent operations alerting remain part of later AWS production work.

## 4. Trust and secret handling

The `aws-dev` GitHub environment remains the control point for deployment and runner configuration. Environment protection rules and repository permissions determine who can run the workflow with live dev secrets.

The runner receives only the values required by the finite command. These include the dev Supabase service configuration, the hosted GitHub connection configuration, the application encryption key and the approved Slack destination digest. It does not receive `CRON_SECRET` or browser-only values. Secret values must never appear in:

- repository files or commits;
- Docker build arguments, layers, image configuration or history;
- workflow command lines, output, annotations or uploaded artifacts;
- health responses or browser data;
- captured acceptance evidence.

The workflow must mask every injected secret before invoking Docker. It must use inherited environment names or a short-lived permission-restricted environment file. The file must be removed during unconditional cleanup. Tests must use fictional markers and scan workflow logs and image metadata for those markers.

The existing AWS deploy role may be reused only if review confirms that its trust policy accepts the protected workflow and permits App Runner inspection plus ECR authentication and image pulls. A narrower pull-only role is preferred if the existing role grants deployment permissions that the scheduled runner does not need. Any IAM change requires a reviewed AWS diff and must stay inside the existing dev account.

The App Runner deployment must map `SLACK_ALLOWED_WEBHOOK_SHA256` into the web runtime before a live Slack destination can be approved. The current deployment documentation lists this secret, but the current AWS dev workflow does not pass it to App Runner. The finite runner and web service must use the same approved digest without revealing it.

The GitHub App keeps exactly the six approved read-only repository permissions. The workflow must not receive a GitHub personal access token or any credential that can write to the pilot repository.

## 5. Failure and recovery

The finite command already has bounded work counts, a time budget, lease-based claiming and sanitised success or failure output. The connection-only Slack drain must use a separate bound within the same outer time budget. The workflow adds an outer timeout and concurrency lock.

A failed run must:

- return a failed workflow conclusion;
- retain no raw provider response, webhook payload or secret-bearing container log;
- leave durable work available for a later bounded run according to the existing lease and retry rules;
- finalise or safely release every Slack delivery lease it acquires;
- avoid reporting a successful reconciliation or recovery.

Milestone 1 does not require a new paging system for the dev scheduler. GitHub's workflow result is the operational result for this pilot. Independent task-start monitoring, a dead-letter queue and production service-level objectives remain deferred.

## 6. Live acceptance sequence

Acceptance uses the existing AWS dev origin, private GitHub App, dev Supabase project and one dedicated private pilot repository.

The sequence is:

1. Record the accepted web release commit and ECR digest.
2. Prove that App Runner reports that release and a healthy database.
3. Manually run the finite command from the same digest with no pending work and verify a bounded zero-work or healthy exit.
4. Verify the Owner can see the connected organisation, exact permissions, selected pilot repository and fresh health.
5. Verify an Admin sees health and scope without installation, reconnection, disconnection or scope controls.
6. Verify a Member cannot reach connection configuration or provider diagnostics.
7. Replay an approved delivery identifier without storing its raw payload and verify no duplicate processing.
8. Remove the pilot repository from the GitHub App's selected scope after explicit action-time confirmation.
9. Run or await reconciliation and verify fail-closed health plus one in-app and one Slack incident.
10. Restore the pilot repository after explicit action-time confirmation.
11. Run or await genuine provider reconciliation and verify healthy recovery plus one in-app and one Slack recovery notice, with no duplicate incident.
12. Prove that a scheduled run from the default branch repairs a deliberately pending or missed webhook reconciliation prompt.
13. Review available GitHub audit and request evidence for the absence of writes.
14. Record acceptance by the ComplianceHub Owner and the administrator responsible for the repository's `aws-dev` environment. One person may fill both roles when that person controls both boundaries.

The live scope removal and restoration change GitHub access. The operator must confirm each action when the exact repository and expected effect are visible. Slack connection requires an approved private destination. The webhook URL must be entered through the application's protected Owner flow and must not appear in chat, source files, terminal history or evidence.

## 7. Evidence

Evidence must identify its environment, release commit, image digest, date and limits. The repository will keep sanitised evidence only.

The final record separates:

- source code implemented and pushed;
- automated checks against fictional configuration;
- local production-mode browser behavior with fictional data;
- AWS dev App Runner web health;
- the GitHub-hosted finite runner using the AWS dev image and configuration;
- live GitHub provider behavior for the pilot repository;
- live Slack incident and recovery delivery;
- role checks;
- Owner acceptance.

AWS dev acceptance does not prove company staging, production readiness, production availability, independent scheduler monitoring, production backup and recovery, or wider repository rollout.

## 8. Revised definition of done

Milestone 1 is complete when all of the following are current and recorded:

1. The private dev GitHub App grants exactly the six approved read permissions and access to only the pilot repository.
2. An Owner can connect the verified organisation, discover its complete available repository inventory and select the pilot repository.
3. An Admin has a read-only health view and a Member cannot reach connection configuration.
4. Webhook and scheduled reconciliation verify connection and scope without producing compliance outcomes.
5. Changed access fails closed and produces one sanitised incident followed by one verified recovery in the application and Slack.
6. The same immutable ECR image runs the healthy App Runner web service and the finite reconciliation command on a protected GitHub Actions worker.
7. Secrets remain in protected control-plane configuration. Installation and user tokens are not persisted, raw webhook payloads are not retained, and GitHub receives no write request.
8. Automated, local, AWS dev, live-provider, Slack, role and human evidence are current and separately labelled.
9. The ComplianceHub Owner and the repository environment administrator accept the pilot and its stated limits.

The milestone will be described as an accepted AWS dev pilot. It will not be described as company staging or production acceptance.

## 9. Deferred work

This design does not add:

- ECS Fargate, EventBridge Scheduler, an application load balancer, Route 53 or new AWS networking;
- a company staging account or staging GitHub App;
- independent scheduler alarms, a dead-letter queue or production rollback automation;
- a production GitHub App or production deployment;
- more repositories or broader GitHub permissions;
- compliance interpretation, official Evidence, Findings, remediation Tasks or the general Automation system.

These items require separate designs and approval if the product later needs them.

## 10. Implementation-planning constraints

The implementation plan must replace only the unfinished staging tasks in the 14 September plan. Phases 1 through 8 remain historical implementation records.

The plan must use test-driven development for workflow behavior and static contract checks. It must keep source changes, workflow deployment, live provider changes and acceptance evidence in separate commits where practical. Heavy local checks must run sequentially through the resource guard.

The plan must stop before each external mutation that needs action-time confirmation. This includes changing the pilot repository's GitHub App scope, connecting Slack and merging pull requests. Scheduled proof requires the workflow on the default branch, so merge authorization is a real acceptance dependency. The plan must not merge to `main`, deploy a different application release or modify production configuration without separate authority.
