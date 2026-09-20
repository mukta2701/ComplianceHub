# Milestone 1 GitHub integration AWS dev acceptance implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Milestone 1 as an accepted AWS dev pilot by running the App Runner web service and bounded GitHub connection runner from the same immutable ECR image, delivering connection-only Slack notices, and recording current live-provider and human evidence.

**Architecture:** App Runner remains the web runtime. A protected hourly GitHub Actions workflow reads App Runner's current immutable ECR digest and runs `node dist/github-connection-reconcile.mjs` once on a GitHub-hosted worker. The finite runner gains a dedicated database claim and bounded delivery path for `github_connection_health` Slack records so it never invokes general compliance Monitoring.

**Tech stack:** Next.js 16.3, TypeScript 5, Node.js 22, Vitest 4, Supabase PostgreSQL and pgTAP, Docker, Amazon ECR and App Runner, GitHub Actions with AWS OpenID Connect, GitHub App APIs, Slack incoming webhooks.

**Spec:** `docs/superpowers/specs/2026-09-20-github-integration-aws-dev-acceptance-design.md`

## Global constraints

- Work only in `/Users/m1ghty/~ My Files/02 - Personal/ComplianceHub/.worktrees/milestone-1` on `feature/m1-phase7-connections` until an explicit merge checkpoint.
- Preserve unrelated files in the root checkout. Do not clean, reset, move, delete or commit them.
- Keep App Runner's default command as `node server.js`.
- Keep the finite command exactly `node dist/github-connection-reconcile.mjs`.
- Use the current App Runner ECR digest as the sole image source for manual and scheduled reconciliation.
- Run the schedule hourly at minute 23 UTC.
- Keep the six GitHub permissions read-only and the pilot repository as the only selected repository.
- The finite runner may claim only `github_connection_health` Slack records. It must not run Monitoring checks or claim Monitoring notifications.
- Keep credentials, raw webhook payloads, private logs and Slack webhook URLs out of source, commands, workflow output and evidence.
- Run heavy checks sequentially with `node --import=tsx scripts/local-resource-guard.ts -- <command>`.
- Use the Supabase skill before database migration work and the browser-testing skill before live browser acceptance.
- If an unexpected defect requires a Next.js application change, read the relevant installed guide under `node_modules/next/dist/docs/` before editing it.
- Stop for action-time confirmation before entering a Slack webhook, changing GitHub App repository scope or merging to `main`.
- Do not create ECS, EventBridge, an application load balancer, new AWS networking, a staging environment or production resources.

## Review focus

- A queued Monitoring alert must remain untouched when the connection runner drains Slack work. Task 1 adds a database isolation test and Task 2 adds an adapter test.
- A stale connection-delivery lease must recover without recovering another alert kind. Task 1 tests both rows in the same transaction.
- An App Runner image identifier using a tag, another registry or another repository must stop the workflow before Docker runs. Task 3 adds static workflow-contract tests for each form.
- A runner secret containing spaces or literal escaped newlines must reach Docker without appearing in the command or logs. Task 3 uses inherited named environment variables and fixture-marker checks.
- A failed Slack transport must return a failed runner result while leaving the durable delivery eligible for bounded retry. Task 2 tests the safe summary, failure exit and exact lease finalisation.

---

### Task 1: Add a connection-only Slack queue and claim contract

**Files:**

- Create: `supabase/migrations/20260920110000_github_connection_alert_delivery_worker.sql`
- Create: `supabase/tests/database/105_github_connection_alert_delivery_worker.sql`

**Interfaces:**

- Produces: `public.queue_github_connection_alert_delivery(uuid, uuid, uuid, text, text, jsonb) returns boolean`.
- Produces: `public.claim_github_connection_alert_delivery(text) returns table(delivery_id uuid, organisation_id uuid, channel_id uuid, lock_token uuid, attempt_count integer, safe_payload jsonb)`.
- Reuses: `public.complete_alert_delivery(uuid, uuid)` and `public.fail_alert_delivery(uuid, uuid)`.
- Retains: the old `enqueue_github_connection_alert_delivery(..., worker_id text)` function for rollout compatibility. New application code must stop calling it.

- [ ] **Step 1: Read the Supabase instructions and current database contract**

Read the Supabase skill completely, then read migrations `20260904210742_durable_monitoring_alert_delivery.sql` and `20260914110002_github_connection_alerts.sql` plus database test 104. Confirm the new migration is additive and does not change an applied migration.

- [ ] **Step 2: Write the failing pgTAP contract**

Create test 105 with fixtures for one `github_connection_health` delivery and one `monitoring_finding` delivery. Assert all of the following:

```sql
select ok(
  has_function_privilege(
    'service_role',
    'public.queue_github_connection_alert_delivery(uuid,uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  ),
  'service role may queue connection Slack work'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_github_connection_alert_delivery(text)',
    'EXECUTE'
  ),
  'authenticated callers cannot claim connection Slack work'
);
```

The test must also prove:

- the first queue call returns true and an identical call returns false;
- a claim returns only the `github_connection_health` row;
- the Monitoring row remains queued and unchanged;
- a stale running connection lease is recovered after five minutes;
- a stale Monitoring lease is not recovered by the connection claim;
- invalid worker IDs, cross-workspace installations, malformed payloads and disabled channels fail closed;
- completing or failing with a stale lock token returns false.

- [ ] **Step 3: Run the database test and confirm the expected red state**

Run:

```sh
node --import=tsx scripts/local-resource-guard.ts -- npm run test:db
```

Expected result: test 105 fails because the two new functions do not exist. Existing tests must not fail for an unrelated reason.

- [ ] **Step 4: Implement the additive migration**

Implement `queue_github_connection_alert_delivery` by copying the current validation, workspace ownership, enabled-channel, minimum-severity, idempotency-key and `ON CONFLICT DO NOTHING` rules from the existing enqueue function. It must insert a queued row without creating a lock and return `found`.

Implement `claim_github_connection_alert_delivery` with the existing worker-ID rule and lease fields. Its stale recovery and claim queries must both include:

```sql
delivery.kind = 'github_connection_health'
and delivery.subject_type = 'github_installation'
and delivery.installation_id is not null
and delivery.safe_payload ->> 'type' = 'connection_health'
```

Grant both functions only to `service_role`. Revoke them from `public`, `anon` and `authenticated`. Preserve the existing five-attempt terminal behavior and safe Owner/Admin failure notification.

- [ ] **Step 5: Run the database contract to green**

Run:

```sh
node --import=tsx scripts/local-resource-guard.ts -- npm run test:db
```

Expected result: all pgTAP tests pass, including test 105. The Monitoring row remains unclaimed in the mixed-kind case.

- [ ] **Step 6: Commit and push the database contract**

```sh
git add supabase/migrations/20260920110000_github_connection_alert_delivery_worker.sql \
  supabase/tests/database/105_github_connection_alert_delivery_worker.sql
git commit -m "fix(github): isolate connection Slack delivery work"
git push origin feature/m1-phase7-connections
```

### Task 2: Drain connection Slack work inside the finite runner

**Files:**

- Modify: `src/features/github/application/github-connection-alerts.ts`
- Modify: `src/features/github/application/github-connection-alerts.test.ts`
- Modify: `src/features/github/application/github-connection-store.ts`
- Modify: `src/features/github/application/github-connection-store.test.ts`
- Modify: `src/features/monitoring/application/slack-alert-store.ts`
- Modify: `src/features/monitoring/application/slack-alert-store.test.ts`
- Modify: `scripts/github-connection-reconcile.ts`
- Modify: `scripts/github-connection-reconcile.test.ts`
- Modify: `scripts/build-runtime-bundles.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Changes: `GitHubConnectionAlertDependencies.enqueueSlackAlert(input): Promise<boolean>`.
- Changes: `enqueueConnectionSlackAlert(client, input): Promise<boolean>`.
- Adds: `createSupabaseGitHubConnectionSlackAlertDeliveryStore(database): SlackAlertDeliveryStore`.
- Adds: `drainSupabaseGitHubConnectionSlackAlertDeliveries(supabase, batchSize, signal): Promise<{ claimed: number; delivered: number; failed: number }>`.
- Extends: `CycleEnvironment` with `maximumSlackDeliveries: number` from `GITHUB_CONNECTION_MAX_SLACK_DELIVERIES`, default 10, range 1 through 25.
- Adds to the safe runner summary: `slackClaimed`, `slackDelivered` and `slackFailed`.

- [ ] **Step 1: Write failing unit tests for queue semantics**

Change the connection alert tests so a new notice expects `enqueueSlackAlert` to resolve `true`, a duplicate expects `false`, and `slackQueued` is 1 only for `true`.

Change the store tests to expect this call:

```ts
expect(rpc).toHaveBeenCalledWith(
  "queue_github_connection_alert_delivery",
  expect.objectContaining({
    target_organisation_id: INPUT.organisationId,
    target_channel_id: INPUT.channelId,
    target_installation_id: INPUT.installationId,
    target_kind: "incident",
    target_diagnostic_code: "permission_mismatch",
  }),
);
```

The adapter must accept only a boolean database result. Database errors and non-boolean responses must throw `Connection alert delivery queue failed` without including database details.

- [ ] **Step 2: Write failing unit tests for connection-only draining**

Add tests proving that `createSupabaseGitHubConnectionSlackAlertDeliveryStore` calls `claim_github_connection_alert_delivery`, never `claim_alert_delivery`, and reuses the existing complete and fail RPCs.

Add a drain test with an approved fictional webhook and encrypted stored configuration. Expect:

```ts
await expect(drainSupabaseGitHubConnectionSlackAlertDeliveries(
  supabase,
  10,
  AbortSignal.timeout(5_000),
)).resolves.toEqual({ claimed: 1, delivered: 1, failed: 0 });
```

Add failure cases for an unapproved destination, decrypt failure, Slack non-2xx response, stale lease and aborted signal. No assertion or thrown error may include the webhook URL or encrypted value.

- [ ] **Step 3: Write failing finite-runner tests**

Extend `scripts/github-connection-reconcile.test.ts` to prove:

- missing Slack batch configuration defaults to 10;
- 0, 26, fractions and non-numeric values fail before work starts;
- one shared abort signal bounds reconciliation and Slack draining;
- the Slack drain runs after reconciliation and receives the configured limit;
- safe logs include only `slackClaimed`, `slackDelivered` and `slackFailed` counts;
- one failed Slack delivery makes the CLI return exit code 1 after recording the safe summary;
- a thrown Slack error returns exit code 1 with the existing redacted failure line.

Extend the bundle test's dependency interface with:

```ts
drainSlackDeliveries(
  service: unknown,
  batchSize: number,
  signal: AbortSignal,
): Promise<{ claimed: number; delivered: number; failed: number }>;
```

The bundled fictional cycle must call the drain once, exit within eight seconds and keep all fixture secrets out of stdout, stderr and bundle output.

- [ ] **Step 4: Run the focused tests and confirm the expected red state**

Run:

```sh
node --import=tsx scripts/local-resource-guard.ts -- npx vitest run \
  src/features/github/application/github-connection-alerts.test.ts \
  src/features/github/application/github-connection-store.test.ts \
  src/features/monitoring/application/slack-alert-store.test.ts \
  scripts/github-connection-reconcile.test.ts \
  scripts/build-runtime-bundles.test.ts \
  --maxWorkers=1
```

Expected result: failures name the missing queue RPC, connection-only store, Slack drain dependency and summary fields.

- [ ] **Step 5: Implement the queue adapter and dedicated store**

Change `enqueueConnectionSlackAlert` and `enqueueGitHubConnectionAlertDelivery` to return a boolean from `queue_github_connection_alert_delivery`.

Refactor the Slack store's destination resolution and posting callbacks into one private builder used by both drains. Keep the existing general Monitoring drain unchanged. Add a connection store whose `claim` method calls only `claim_github_connection_alert_delivery`.

- [ ] **Step 6: Implement the bounded runner drain**

Parse `GITHUB_CONNECTION_MAX_SLACK_DELIVERIES`. Create one deadline signal for the full command by combining the caller's signal with `AbortSignal.timeout(timeBudgetMs)`. Pass that signal to the connection cycle and the Slack drain.

After the cycle finishes, call:

```ts
const slack = await dependencies.drainSlackDeliveries(
  service,
  environment.maximumSlackDeliveries,
  deadlineSignal,
);
```

Return and log the cycle counts plus the three Slack counts. Return exit code 1 when `slack.failed > 0`; the database retry record remains the source of retry truth. Keep provider errors, webhook URLs, payloads and credentials out of both output streams.

- [ ] **Step 7: Extend the CI container fixture**

Set `GITHUB_CONNECTION_MAX_SLACK_DELIVERIES=1` in the existing fictional runner smoke. Make the fixture server return an empty row set for `claim_github_connection_alert_delivery`. Require the log to contain:

```text
slackClaimed=0 slackDelivered=0 slackFailed=0
```

Add fictional `APP_ENCRYPTION_KEY` and `SLACK_ALLOWED_WEBHOOK_SHA256` markers to the container invocation and the existing absence scan. Keep the exact runner command unchanged.

- [ ] **Step 8: Run focused application, bundle and container checks**

Run sequentially:

```sh
node --import=tsx scripts/local-resource-guard.ts -- npx vitest run \
  src/features/github/application/github-connection-alerts.test.ts \
  src/features/github/application/github-connection-store.test.ts \
  src/features/monitoring/application/slack-alert-store.test.ts \
  scripts/github-connection-reconcile.test.ts \
  scripts/build-runtime-bundles.test.ts \
  --maxWorkers=1

node --import=tsx scripts/local-resource-guard.ts -- docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=fictional-anon \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=fictional-publishable \
  --build-arg NEXT_PUBLIC_SITE_URL=https://dev.example.test \
  -t compliancehub:m1-aws-dev .
```

Run the image's web health smoke and exact runner override with fictional configuration. Scan image history, image environment, the bundled file and captured logs for every fictional secret marker.

- [ ] **Step 9: Commit and push the finite-runner fix**

```sh
git add src/features/github/application/github-connection-alerts.ts \
  src/features/github/application/github-connection-alerts.test.ts \
  src/features/github/application/github-connection-store.ts \
  src/features/github/application/github-connection-store.test.ts \
  src/features/monitoring/application/slack-alert-store.ts \
  src/features/monitoring/application/slack-alert-store.test.ts \
  scripts/github-connection-reconcile.ts \
  scripts/github-connection-reconcile.test.ts \
  scripts/build-runtime-bundles.test.ts .github/workflows/ci.yml
git commit -m "fix(github): deliver connection alerts in finite runner"
git push origin feature/m1-phase7-connections
```

### Task 3: Add the protected AWS dev reconciliation workflow

**Files:**

- Create: `.github/workflows/reconcile-github-connections-aws-dev.yml`
- Create: `src/test/aws-dev-github-reconciliation-workflow.test.ts`
- Modify: `.github/workflows/deploy-aws-dev.yml`
- Modify: `.env.example`

**Interfaces:**

- Consumes: App Runner variable `AWS_DEV_SERVICE_ARN`, ECR variable `AWS_DEV_ECR_REGISTRY`, existing OIDC secret `AWS_DEV_DEPLOY_ROLE_ARN`, existing Supabase/GitHub secrets, `APP_ENCRYPTION_KEY` and `SLACK_ALLOWED_WEBHOOK_SHA256` from `aws-dev`.
- Produces: manual `workflow_dispatch` with optional `expected_release_sha`, normal `aws-dev` jobs that call the local composite action, and schedule `23 * * * *`.
- Runs: `node dist/github-connection-reconcile.mjs` from App Runner's current digest.

- [ ] **Step 1: Write the failing workflow-contract test**

Create a Vitest test that reads both AWS workflows as text. Require the reconciliation workflow to contain:

```yaml
on:
  schedule:
    - cron: "23 * * * *"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: compliancehub-github-reconcile-aws-dev
  cancel-in-progress: false
```

The test must also require:

- job environment `aws-dev`;
- job permissions `contents: read` and `id-token: write` only;
- a job timeout of 10 minutes and command timeout of 7 minutes;
- App Runner `describe-service` as the image source;
- validation against `${AWS_DEV_ECR_REGISTRY}/compliancehub-dev@sha256:`;
- ECR login before pull;
- inherited Docker environment names, not `--env NAME=value`;
- exact override `node dist/github-connection-reconcile.mjs`;
- `NODE_ENV=production`, `GITHUB_ALLOWED_ACCOUNT_TYPE=Organization`, maximum cycle values and Slack limit;
- no `docker build`, moving tag, `latest`, artifact upload, cron endpoint, Monitoring command or secret value interpolation in a Docker argument;
- unconditional container cleanup;
- `SLACK_ALLOWED_WEBHOOK_SHA256` in the App Runner deployment environment and source configuration.

Add rejection assertions for tag-only, wrong registry and wrong repository image identifiers in the shell validation block.

- [ ] **Step 2: Run the focused test and confirm the expected red state**

Run:

```sh
node --import=tsx scripts/local-resource-guard.ts -- npx vitest run \
  src/test/aws-dev-github-reconciliation-workflow.test.ts --maxWorkers=1
```

Expected result: the reconciliation workflow file is missing and the deploy workflow lacks the Slack destination digest.

- [ ] **Step 3: Implement the protected workflow**

Use the pinned checkout action already present in the deployment workflow and the existing AWS credentials action version. The normal job must call a local composite action that owns AWS credential setup, immutable image resolution, health validation, ECR pull, masking, cleanup and the exact finite runner command. The job must:

1. assume `AWS_DEV_DEPLOY_ROLE_ARN` through OpenID Connect;
2. call `aws apprunner describe-service` for `AWS_DEV_SERVICE_ARN`;
3. require an image identifier matching the exact dev ECR repository plus `@sha256:<64 lowercase hexadecimal characters>`;
4. optionally compare `/api/health/live` with `expected_release_sha` for a manual run;
5. log in to ECR and pull the immutable identifier;
6. mask every secret used by Docker;
7. run Docker with inherited variable names only;
8. wrap Docker with `timeout 7m` and a cleanup trap;
9. print the finite runner's sanitised summary and preserve its exit status.

Pass these runtime names:

```text
NODE_ENV
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
APP_ENCRYPTION_KEY
SLACK_ALLOWED_WEBHOOK_SHA256
GITHUB_APP_ID
GITHUB_APP_SLUG
GITHUB_APP_CLIENT_ID
GITHUB_APP_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY
GITHUB_WEBHOOK_SECRET
GITHUB_ALLOWED_ACCOUNT_ID
GITHUB_ALLOWED_ACCOUNT_TYPE
GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES
GITHUB_CONNECTION_MAX_INSTALLATIONS
GITHUB_CONNECTION_MAX_SLACK_DELIVERIES
GITHUB_CONNECTION_TIME_BUDGET_MS
```

Do not pass `CRON_SECRET`, browser keys or a GitHub personal access token.

- [ ] **Step 4: Map the approved Slack digest into App Runner**

Add `SLACK_ALLOWED_WEBHOOK_SHA256: ${{ secrets.SLACK_ALLOWED_WEBHOOK_SHA256 }}` to the deployment step's environment. Add a `jq --arg` and `RuntimeEnvironmentVariables` entry without printing the value.

Change `.env.example` from “Staging requires Organization” to “Hosted AWS dev and production require Organization.” Do not change the local `User` exception.

- [ ] **Step 5: Run the workflow-contract and related secret tests**

Run:

```sh
node --import=tsx scripts/local-resource-guard.ts -- npx vitest run \
  src/test/aws-dev-github-reconciliation-workflow.test.ts \
  src/features/mcp/plugin-contract.test.ts \
  src/test/playwright-ci-diagnostics.test.ts \
  --maxWorkers=1
```

Expected result: all tests pass and no test fixture contains a real account identifier, secret or webhook URL.

- [ ] **Step 6: Commit and push the workflow**

```sh
git add .github/workflows/reconcile-github-connections-aws-dev.yml \
  .github/workflows/deploy-aws-dev.yml \
  src/test/aws-dev-github-reconciliation-workflow.test.ts .env.example
git commit -m "ci(github): schedule AWS dev connection reconciliation"
git push origin feature/m1-phase7-connections
```

### Task 4: Replace the unfinished staging plan with AWS dev instructions

**Files:**

- Read: `docs/superpowers/specs/2026-09-14-github-organisation-repository-integration-design.md`
- Read: `docs/superpowers/plans/2026-09-14-github-organisation-repository-integration.md`
- Modify: `docs/deployment.md`
- Modify: `docs/release-checklist.md`

**Interfaces:**

- Makes the 20 September design and this plan authoritative for the remaining Milestone 1 work.
- Preserves all completed Phase 1 through Phase 8 records and historical evidence.

- [ ] **Step 1: Verify the approved supersession notices**

Confirm the notice near the top of each 14 September document says that the product behavior remains approved while the ECS/EventBridge staging delivery and acceptance sections are historical. Confirm both notices link to the approved 20 September design and this plan. Do not delete the historical Task 9 through Task 11 text.

- [ ] **Step 2: Document the two AWS dev commands and schedule**

Update `docs/deployment.md` with:

- App Runner default command `node server.js`;
- reconciliation override `node dist/github-connection-reconcile.mjs`;
- App Runner's current digest as the image source;
- hourly minute 23 UTC schedule and manual dispatch;
- GitHub-hosted worker, existing `aws-dev` environment and OIDC boundary, without assuming reviewer protection;
- required variables and secrets by name only;
- connection-only Slack drain and its separation from `/api/cron/monitor`;
- feature-branch manual proof versus default-branch scheduled proof;
- evidence limits, including delayed or skipped GitHub schedules and no production claim.

- [ ] **Step 3: Update the plain-language release status**

Replace the design-draft entry at the top of `docs/release-checklist.md` with an implementation-in-progress entry. Preserve every historical entry below it. State exactly which source commits and environments are verified at that point.

- [ ] **Step 4: Check documentation consistency**

Run:

```sh
rg -n "Task 9|Task 10|Task 11|ECS|EventBridge|company staging|AWS dev|reconcile-github-connections" \
  docs/superpowers/specs/2026-09-14-github-organisation-repository-integration-design.md \
  docs/superpowers/plans/2026-09-14-github-organisation-repository-integration.md \
  docs/superpowers/specs/2026-09-20-github-integration-aws-dev-acceptance-design.md \
  docs/superpowers/plans/2026-09-20-github-integration-aws-dev-acceptance.md \
  docs/deployment.md docs/release-checklist.md
git diff --check
```

Expected result: old ECS/EventBridge text is visibly historical, current instructions point to AWS dev, and no document claims implementation or acceptance that has not happened.

- [ ] **Step 5: Commit and push the operational documentation**

```sh
git add docs/deployment.md docs/release-checklist.md
git commit -m "docs(github): replace staging gate with AWS dev acceptance"
git push origin feature/m1-phase7-connections
```

### Task 5: Run the final automated candidate gates

**Files:**

- Modify only if a test exposes a defect: the smallest affected source and test files.
- Modify after green checks: `docs/release-checklist.md`.

**Interfaces:**

- Produces: one pushed candidate commit with current automated, local database and container evidence.

- [ ] **Step 1: Run focused GitHub and Slack tests**

Run:

```sh
node --import=tsx scripts/local-resource-guard.ts -- npx vitest run \
  src/features/github \
  src/features/monitoring/application/slack-alert-queue.test.ts \
  src/features/monitoring/application/slack-alert-store.test.ts \
  scripts/github-connection-reconcile.test.ts \
  scripts/build-runtime-bundles.test.ts \
  src/test/aws-dev-github-reconciliation-workflow.test.ts \
  --maxWorkers=1
```

Expected result: all focused checks pass with intentional skips identified.

- [ ] **Step 2: Run database upgrade and database tests sequentially**

```sh
node --import=tsx scripts/local-resource-guard.ts -- npm run test:db:upgrade
node --import=tsx scripts/local-resource-guard.ts -- npm run test:db
```

Expected result: an existing schema upgrades through migration `20260920110000` and every pgTAP test passes.

- [ ] **Step 3: Run application gates sequentially**

```sh
node --import=tsx scripts/local-resource-guard.ts -- npm run lint
node --import=tsx scripts/local-resource-guard.ts -- npm run typecheck
node --import=tsx scripts/local-resource-guard.ts -- npm test -- --maxWorkers=1
node --import=tsx scripts/local-resource-guard.ts -- npm run build
node --import=tsx scripts/local-resource-guard.ts -- npm run test:integration
```

Expected result: every command exits zero. Record counts and intentional skips without copying private logs.

- [ ] **Step 4: Run the production container and browser gates sequentially**

Build one candidate image. Prove its default web command, exact finite override, non-root user, bounded exit and fixture-secret absence. Then run `e2e/github-connection-milestone.spec.ts` on desktop and mobile against a production-mode local preview.

Use the supported local preview launcher and keep it independent of a temporary terminal session. Verify `/api/health/live`, `/api/health` and the actual Connections page after the browser run.

- [ ] **Step 5: Record automated evidence and push**

Update only the top release-status entry. State that the evidence is local or CI and does not yet prove AWS dev runner, live Slack or provider recovery.

```sh
git add docs/release-checklist.md
git commit -m "docs: record AWS dev acceptance candidate checks"
git push origin feature/m1-phase7-connections
```

Wait for both branch and pull-request CI on the exact commit. Every application, database, container and secret job must pass before Task 6.

### Task 6: Apply the migration and demonstrate the candidate in AWS dev

**Files:**

- Add: `docs/evidence/2026-09-20-github-connection-aws-dev.md`
- Modify: `docs/release-checklist.md`

**Interfaces:**

- Consumes: the exact green candidate SHA, migration `20260920110000`, existing `aws-dev` App Runner service and GitHub environment.
- Produces: fresh App Runner web and manual finite-runner evidence for one immutable digest.

- [ ] **Step 1: Confirm the external-change checkpoint**

Before applying the migration or deploying, show the exact candidate SHA, migration filename, current App Runner release and expected effect. Continue only under the approved AWS dev execution authority. Do not touch another Supabase project or AWS environment.

Read the `aws-dev` GitHub environment protection rules. The hourly schedule must be able to start unattended. If a required-reviewer rule would pause scheduled jobs, stop and record the policy decision instead of weakening it silently.

- [ ] **Step 2: Apply the one reviewed migration through the Supabase skill**

Link only the existing dev project. Run migration list and dry run. The dry run must name exactly `20260920110000_github_connection_alert_delivery_worker.sql`. Stop if it names another migration.

Apply the migration, then verify local and remote history match. Record only the migration version and pass/fail result.

- [ ] **Step 3: Deploy the exact candidate to App Runner**

Dispatch `.github/workflows/deploy-aws-dev.yml` from the candidate branch with
`run_github_reconciliation_acceptance=true` and wait for completion. This keeps
the deployment and both finite-runner calls on one immutable candidate. Verify:

- the workflow used the candidate SHA;
- App Runner reached `RUNNING`;
- `/api/health/live` reports that SHA;
- `/api/health` reports a healthy database;
- the image identifier is an immutable ECR digest;
- no secret appears in workflow logs.

- [ ] **Step 4: Verify the two finite acceptance calls**

The deploy workflow's first ordinary acceptance job receives `github.sha` and
the exact `sha256:<64 lowercase hex>` digest emitted by its `Set image
reference` step. The local composite action reconstructs the full ECR image URI
inside each job, validates the digest and release before Docker runs, and
receives secrets through the action step environment only. Require the first
and second jobs to use the same values, finish within the workflow bounds, and
produce a bounded zero-work or healthy exit with a safe count-only summary.

Require the second job to produce no duplicate connection incident, recovery or
Slack delivery. The standalone scheduled/manual workflow remains available for
direct use after it is registered on the default branch.

- [ ] **Step 5: Record sanitised AWS dev evidence**

Create the evidence file with date, candidate SHA, digest, workflow run links, health results, safe runner counts and limits. State that the container ran on a GitHub-hosted worker and that scheduled default-branch proof, live Slack, provider failure/recovery, role checks and human acceptance remain unfinished.

- [ ] **Step 6: Commit and push the AWS dev evidence**

```sh
git add docs/evidence/2026-09-20-github-connection-aws-dev.md docs/release-checklist.md
git commit -m "docs(github): record AWS dev runner evidence"
git push origin feature/m1-phase7-connections
```

### Task 7: Run the live GitHub, Slack and role rehearsal

**Files:**

- Add: `docs/evidence/2026-09-20-github-connection-live-provider.md`
- Modify: `docs/release-checklist.md`
- Modify only if a defect is reproduced: the smallest affected source and test files in a separate red-green commit.

**Interfaces:**

- Consumes: the deployed candidate digest, approved private Slack destination, existing dev GitHub App and one private pilot repository.
- Produces: current provider, Slack, role and Owner-acceptance evidence.

- [ ] **Step 1: Prepare the browser and evidence boundary**

Read the browser-testing skill. Open the authenticated AWS dev app and GitHub App administration in the user-visible browser. Record only safe identifiers and timestamps. Do not capture credentials, raw payloads, webhook URLs or private provider logs.

- [ ] **Step 2: Connect the approved Slack destination**

Pause for the Owner to enter the webhook URL through the application's protected Slack connection form. Confirm the matching lowercase SHA-256 value exists in the `aws-dev` environment without reading or printing either value.

After the digest secret exists, dispatch the AWS dev deployment workflow for the same candidate SHA so App Runner receives the approved digest. Verify the image digest did not change and health remains green. Then verify the page reports Slack connected. Do not send a test message that bypasses the durable connection-alert queue.

- [ ] **Step 3: Verify role behavior**

Using approved test accounts or sessions:

- Owner sees installation, repository scope, reconnect and disconnect controls;
- Admin sees organisation, selected scope, exact permissions, freshness and incidents with no mutation controls;
- Member cannot reach connection configuration or provider diagnostics.

Do not create new external identities without Owner approval. If a role account is unavailable, record the missing human dependency and stop that acceptance claim.

- [ ] **Step 4: Verify webhook replay safety**

Use GitHub's approved delivery redelivery control so the provider retains the raw body. Record the delivery identifier only. Verify the application stores one delivery result and creates no duplicate reconciliation, incident or Slack work.

- [ ] **Step 5: Confirm the live scope-removal action**

Show the exact GitHub App, organisation and pilot repository plus the expected temporary effect. Obtain action-time confirmation before removing the repository from the App's selected scope.

- [ ] **Step 6: Prove fail-closed incident delivery**

Remove only the pilot repository. Run the protected finite workflow or wait for the hourly schedule. Verify:

Before Task 8, use the deploy workflow's opt-in acceptance input for the two
sequential finite calls; do not treat an unregistered feature-branch standalone
dispatch as pre-merge evidence.

- Connections reports `Partly unavailable` or the approved Owner-action state;
- collection for the repository is stopped;
- Owners and Admins receive one in-app incident;
- the approved Slack destination receives one sanitised incident;
- a repeated runner invocation produces no duplicate incident or Slack message.

- [ ] **Step 7: Confirm and restore the pilot repository**

Obtain action-time confirmation, restore the same repository and run or await genuine provider reconciliation. Verify Healthy state, one in-app recovery and one Slack recovery message. Run the finite command again and prove no duplicate recovery.

- [ ] **Step 8: Prove scheduled repair and read-only behavior**

After the workflow exists on the default branch in Task 8, observe one hourly scheduled run repairing an intentionally pending connection prompt. Until then, record only manual proof.

Review the GitHub App permission page and available provider audit information. Record that the App grants only the six approved read permissions and that no observed request or audit entry indicates a write. Do not claim stronger provider evidence than GitHub exposes.

- [ ] **Step 9: Record and push sanitised live evidence**

Record the App identity, pilot repository identifier, candidate digest, safe delivery IDs or timestamps, role results, incident/recovery results and evidence limits. Obtain explicit Owner acceptance of the AWS dev pilot.

```sh
git add docs/evidence/2026-09-20-github-connection-live-provider.md docs/release-checklist.md
git commit -m "docs(github): record live AWS dev pilot acceptance"
git push origin feature/m1-phase7-connections
```

### Task 8: Merge, prove the default-branch schedule and close Milestone 1

**Files:**

- Modify: `docs/evidence/2026-09-20-github-connection-aws-dev.md`
- Modify: `docs/evidence/2026-09-20-github-connection-live-provider.md`
- Modify: `docs/release-checklist.md`

**Interfaces:**

- Produces: default-branch scheduled evidence and the final Milestone 1 acceptance record.

- [ ] **Step 1: Present the merge checkpoint**

Show the exact feature SHA, green CI runs, migration state, AWS dev manual-run evidence, live-provider evidence and remaining scheduled-proof limitation. Obtain explicit authorization before changing pull-request bases, merging or triggering the automatic `main` deployment.

- [ ] **Step 2: Integrate the stacked work without force pushes**

Inspect pull requests 18 through 24 and their current bases. Use the smallest safe GitHub operation that puts the complete reviewed feature history on `main`. Retarget stacked pull requests only when required and preserve their review history. Never force-push.

After each merge or base change, confirm the resulting diff and required checks before continuing. Attach every created pull request to the task. Do not mark an unmerged stacked branch as integrated.

- [ ] **Step 3: Verify the automatic main deployment**

Wait for the `main` deployment workflow. Verify App Runner reports the final main release SHA and healthy database. Confirm its current image identifier is the immutable digest used by the runner.

- [ ] **Step 4: Prove a default-branch scheduled run**

Wait for the first hourly minute-23 run, or use the workflow's default-branch manual dispatch only as preliminary proof. The final scheduled claim requires an actual `schedule` event.

Verify the scheduled job:

- used the existing `aws-dev` environment;
- resolved the current App Runner digest;
- ran the exact finite command once;
- exited within ten minutes;
- emitted only the sanitised count summary;
- did not claim Monitoring alerts or create compliance outcomes;
- did not duplicate an incident, recovery or Slack delivery.

- [ ] **Step 5: Run final hosted smoke and acceptance review**

In a fresh authenticated browser session, verify health, Connections, Monitoring separation and the role states already accepted. Confirm Slack remains connected and GitHub health is fresh.

The ComplianceHub Owner and repository environment administrator review the final evidence. One person may fill both roles if that person controls both boundaries.

- [ ] **Step 6: Record completion without broadening the claim**

Update both evidence files and the top of `docs/release-checklist.md`. State that Milestone 1 is an accepted AWS dev pilot. State that it is not company staging, production acceptance, an availability guarantee, independent scheduler monitoring or wider repository rollout.

Commit and push the final evidence on a normal branch and merge it only with explicit authorization:

```sh
git add docs/evidence/2026-09-20-github-connection-aws-dev.md \
  docs/evidence/2026-09-20-github-connection-live-provider.md \
  docs/release-checklist.md
git commit -m "docs(github): accept Milestone 1 AWS dev pilot"
git push origin HEAD
```

## Final verification matrix

Run or confirm these checks on the final accepted source and record their exact environment:

- [ ] Focused GitHub, Slack and workflow-contract unit tests pass.
- [ ] Database upgrade rehearsal and all pgTAP tests pass.
- [ ] Lint, type checking, full unit tests, build and integration tests pass.
- [ ] The production container serves web health by default as a non-root user.
- [ ] The same image digest runs one bounded finite reconciliation command and exits.
- [ ] Fictional secrets are absent from source delta, image history, image environment, bundle and captured logs.
- [ ] Desktop and mobile Connections journeys pass against a local production preview with fictional data.
- [ ] AWS dev App Runner reports the accepted release and healthy database.
- [ ] The protected runner resolves the App Runner digest and completes manually.
- [ ] An actual default-branch schedule event completes without overlap or duplicate work.
- [ ] Live GitHub scope removal fails closed and restoration produces one recovery.
- [ ] One in-app and one Slack incident and recovery are demonstrated without duplicates.
- [ ] Owner, Admin and Member behavior is demonstrated with approved sessions.
- [ ] Webhook redelivery is deduplicated without storing a raw payload in evidence.
- [ ] Available provider evidence supports the no-write claim.
- [ ] Owner and repository environment administrator acceptance is recorded.
- [ ] The release checklist separates automated, local, AWS dev, live-provider, Slack, role, human and production evidence.
