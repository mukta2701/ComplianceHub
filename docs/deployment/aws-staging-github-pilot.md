# AWS staging GitHub pilot — contract and runbook (Task 9)

This is the company-controlled staging gate for Milestone 1. No AWS resource,
GitHub App, secret value or deploy happens in Task 9. Task 9 only defines what
your AWS/security admin must approve, and provides a local validator.

Roles in this repo: you manage security and approve this contract. Charlie as
CEO is the first stakeholder who accepts the pilot outcome in Task 11. No
personal AWS account is used — see “No production / no personal” below.

## Responsibility table

| Activity | Owner | Evidence |
|---|---|---|
| Approve staging account, region, network, IAM, logging, budget | You (security) | Validator pass + approver + date recorded, values stay in company control plane |
| Supply Secrets Manager ARNs + KMS, load GitHub secrets | You (security / secret admin) | ARNs only in contract; values never in Git, chat or logs |
| Approve GitHub App (6 read perms, selected repos, 1 pilot repo) | Company GitHub admin | Task 11 live-provider evidence |
| Accept pilot (health, incident/recovery, read-only) | You + Charlie | Task 11 acceptance note |
| Roll back staging on failure | Rollback owner named in contract | Rollback run in Task 10 evidence |

## Required non-secret contract (validator input)

Set via environment for `scripts/validate-aws-staging-contract.ts`. Names are
exact; comma-separated means `a,b,c`. Do NOT put secret values here.

```
AWS_STAGING_ACCOUNT_ID=111122223333
AWS_PRODUCTION_ACCOUNT_ID=999988887777
AWS_STAGING_REGION=eu-west-2
AWS_STAGING_ECR_REPOSITORY=111122223333.dkr.ecr.eu-west-2.amazonaws.com/compliancehub-staging
AWS_STAGING_ECS_CLUSTER=compliancehub-staging-cluster
AWS_STAGING_WEB_SERVICE=compliancehub-web-staging
AWS_STAGING_WEB_TASK_FAMILY=compliancehub-web-staging
AWS_STAGING_RECONCILIATION_TASK_FAMILY=compliancehub-reconcile-staging
AWS_STAGING_PRIVATE_SUBNET_IDS=subnet-aaa,subnet-bbb
AWS_STAGING_WEB_SG=sg-xxx
AWS_STAGING_RUNNER_SG=sg-yyy
AWS_STAGING_RUNNER_USES_PUBLIC_SUBNET=false
AWS_STAGING_ALB_LISTENER_ARN=arn:aws:elasticloadbalancing:...
AWS_STAGING_ALB_TARGET_GROUP_ARN=arn:aws:elasticloadbalancing:...:targetgroup/...
AWS_STAGING_HTTPS_ORIGIN=https://compliancehub-staging.example.com
AWS_STAGING_ROUTE53_ACM_DECISION=route53 zone + ACM cert decision
AWS_STAGING_WEB_ROLE_ARN=arn:aws:iam::...:role/...-web
AWS_STAGING_RUNNER_ROLE_ARN=arn:aws:iam::...:role/...-runner
AWS_STAGING_SCHEDULER_ROLE_ARN=arn:aws:iam::...:role/...-scheduler
AWS_STAGING_DEPLOY_ROLE_ARN=arn:aws:iam::...:role/...-deploy
AWS_STAGING_OIDC_SUBJECT=repo:ORG/ComplianceHub:ref:refs/heads/main
AWS_STAGING_SECRETS_ARNS=arn:aws:secretsmanager:...,... 
AWS_STAGING_KMS_KEY_ARN=arn:aws:kms:...:key/...
AWS_STAGING_LOG_GROUPS=/aws/ecs/...-web,/aws/ecs/...-runner
AWS_STAGING_LOG_RETENTION_DAYS=90
AWS_STAGING_SCHEDULE_NAME=compliancehub-staging-reconcile
AWS_STAGING_SCHEDULE_TIMEZONE=Europe/London
AWS_STAGING_SCHEDULE_CADENCE=rate(1 hour)
AWS_STAGING_SCHEDULER_DLQ_ARN=arn:aws:sqs:...:...-dlq
AWS_STAGING_ALARM_DESTINATION_ARN=arn:aws:sns:...:...-alarms
AWS_STAGING_SLACK_DESTINATION=C0123456789AB - #compliance-staging (private)
AWS_STAGING_BUDGET_OWNER=security@example.com
AWS_STAGING_BUDGET_THRESHOLD_GBP=200
AWS_STAGING_SUPABASE_EGRESS_APPROVED=1
AWS_STAGING_ROLLBACK_OWNER=security@example.com
AWS_STAGING_IAC_PATH=in-repo:.github/workflows/deploy-aws-staging.yml
```

Validator rules (all local, no AWS calls):

* Every field above required. Missing field fails with that field name.
* `AWS_STAGING_ACCOUNT_ID` must be 12 digits and differ from
  `AWS_PRODUCTION_ACCOUNT_ID` — production misuse fails as
  `productionAccountMisuse`.
* `AWS_STAGING_HTTPS_ORIGIN` must be `https://` with no trailing slash, path,
  query or fragment.
* `AWS_STAGING_RUNNER_USES_PUBLIC_SUBNET` must be exactly `false`.
* Role ARNs must not contain `*`.
* `AWS_STAGING_LOG_RETENTION_DAYS` must be 1–3653. `0` or `99999` fails.
* `AWS_STAGING_BUDGET_OWNER`, `AWS_STAGING_ALARM_DESTINATION_ARN`,
  `AWS_STAGING_ROLLBACK_OWNER` required — no anonymous budget/alarms.
* Errors print only field names, never supplied values.

Run locally:

```sh
node --import=tsx scripts/validate-aws-staging-contract.ts
echo $?
```

Exit `0` with `{"ok":true}` on pass. Exit `1` with `{"ok":false,"errors":[...]}`
on fail. Record only pass/fail, approver, date and safe IDs — never secrets.

## Secret injection (Task 10, not Task 9)

The eight GitHub values (`GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`,
`GITHUB_APP_SLUG`, `GITHUB_ALLOWED_ACCOUNT_ID`, plus
`GITHUB_APPROVED_SECURITY_WORKFLOW_IDS`) plus `SUPABASE_SERVICE_ROLE_KEY`,
`CRON_SECRET`, `APP_ENCRYPTION_KEY` live only in Secrets Manager/KMS named by
the ARNs above. ECS injects them at runtime. They never appear in Git, image
history, `NEXT_PUBLIC_*`, build args or logs. Rotation owner/date recorded in
Task 11 without exposing values.

## Callback / webhook URLs (Task 10)

Derived from `AWS_STAGING_HTTPS_ORIGIN` (no trailing slash):

* `${ORIGIN}/api/github/callback`
* `${ORIGIN}/api/github/setup`
* `${ORIGIN}/api/github/webhook`

Health before App install:

* `${ORIGIN}/api/health/live`
* Manual zero-work reconcile: `node dist/github-connection-reconcile.mjs` must
  exit safely with no installation.

## Task commands

* Web: `node server.js` (default image command, non-root `nextjs`).
* Reconcile: `node dist/github-connection-reconcile.mjs` (finite, no timer,
  bounded `GITHUB_CONNECTION_MAX_*` / `TIME_BUDGET_MS`, `SIGTERM`/`SIGINT`
  abort, sanitised JSON summary or generic failure).

## Rollback

Rollback owner restores previous accepted image digest + task definitions,
keeps EventBridge inactive until healthy, then re-verifies health routes and
one zero-work reconcile. Record digest, date, reason. Rolling back the app
never rolls back the database.

## Evidence capture

* Task 9: validator pass/fail + approver + date + safe IDs in
  `docs/release-checklist.md`. No secret values.
* Task 10: image digest, environment, checks, DLQ/alarm proof, rollback proof
  in `docs/evidence/2026-09-14-github-connection-aws-staging.md`.
* Task 11: App identity, pilot repo ID, event IDs/times, incident/recovery,
  read-only proof in `docs/evidence/2026-09-14-github-connection-live-provider.md`.

## No production / no personal boundary

* This contract is staging only. Production GitHub App, production AWS,
  wider rollout, Milestone 2 compliance judgments, Milestone 3 automation,
  Milestone 4 production acceptance and Milestone 5 MCP remain out of scope.
* Do not substitute a personal AWS account, personal repo or user-owned App.
  If any input or the allowed IaC path is missing, stop after Task 9.
