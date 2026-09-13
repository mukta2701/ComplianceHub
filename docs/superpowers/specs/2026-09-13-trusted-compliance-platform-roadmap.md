# ComplianceHub Trusted Compliance Platform — Five-Milestone Roadmap

Date: 13 September 2026

Status: Sole active future sequence; written roadmap awaiting owner review

PRD: [Product requirements and description](2026-09-13-trusted-compliance-platform-prd.md)

## 1. How to use this roadmap

This roadmap defines what comes after the current architecture and visual-design programme. It organises the work into five independently reviewable milestones. Each milestone will later receive its own detailed phases, implementation plan, review gates and evidence.

This is not a live progress tracker and does not mark historical implementation as currently accepted. The [release checklist](../../release-checklist.md) remains the only overall status source.

This roadmap supersedes the earlier top-level roadmap and older MCP planning documents. Historical evidence remains available only to explain earlier demonstrations; it does not direct future work.

The roadmap distinguishes GitHub integration from Monitoring because selecting and governing the provider scope is a useful, independently testable outcome. It also distinguishes portable Automation from AWS deployment so application behaviour can be proven before cloud acceptance.

## 2. Recommended sequence

```text
Current architecture and visual programme
                    ↓
1. GitHub organisation and repository integration
                    ↓
2. Trustworthy Monitoring
                    ↓
3. Portable built-in Platform Automation
                    ↓
4. Company AWS staging and platform cutover
                    ↓
5. Company-wide ComplianceHub MCP assistant
```

Milestones 3 and 4 are closely related but remain separate acceptance claims. MCP design and local stabilisation may begin once its source facts and permissions are stable, but company-wide MCP acceptance occurs only after the required AWS-hosted identity and ingress path exists.

## 3. Milestone 1 — GitHub organisation and repository integration

### Outcome

An Owner can connect the approved company GitHub organisation, see the repositories available to the installation, select the repositories ComplianceHub is authorised to monitor and understand the current connection/scope health.

### What it will have

- least-privilege company GitHub App installation;
- workspace-bound installation identity;
- complete, paginated repository discovery;
- explicit Owner-approved repository scope;
- safe connect, reconnect, revoke and scope-change flows;
- signed, replay-safe webhook intake;
- preserved history when a repository leaves scope;
- connection, permission and collection-access status in Settings → Connections;
- a local fictional acceptance route and a separately authorised live company-repository rehearsal.

### What it will do

- establish exactly which GitHub organisation and repositories are in scope;
- prevent an installation or repository from crossing workspace boundaries;
- make scope changes auditable;
- create the prerequisites for Monitoring collection;
- report connection success without pretending that monitoring results already exist.

### Completion evidence

- the intended repositories shown in ComplianceHub match the approved GitHub App installation;
- Owner scope selection and removal behave correctly;
- cross-workspace, replay and permission-denial tests pass;
- one approved live repository connection is demonstrated without changing repository settings;
- current connection state is reconciled across UI, database and provider metadata.

### Explicitly deferred

- compliance interpretation of repository observations;
- automatic GitHub configuration changes;
- organisation-wide MFA and owner-governance scanning.

## 4. Milestone 2 — Trustworthy Monitoring

### Outcome

ComplianceHub turns complete observations from selected repositories into versioned, explainable and traceable technical compliance results that feed Evidence, Findings and permitted remediation work.

### What it will have

- deterministic versioned checks;
- AI-proposed check-to-control mappings with rationale and confidence;
- one-time Owner approval and renewed approval after material mapping changes;
- immutable official result provenance;
- explicit Pass, Failure, Unknown and Not applicable outcomes;
- evidence, finding and task lifecycle links;
- result freshness and historical-mapping state;
- daily and authorised on-demand rechecks;
- attention-first Monitoring pages with collection and result health;
- in-app and sanitised Slack change alerts.

### What it will do

- turn a valid Pass into official Evidence without claiming certification;
- turn a Failure into one deduplicated Finding;
- create or reuse a remediation Task only when an approved owner exists;
- keep Unknown truthful when permission, feature or data is unavailable;
- resolve the matching Finding after a newer valid Pass;
- keep Task completion independent from technical remediation;
- preserve time-limited exceptions as visibly failing-with-exception;
- preserve historical results when scope or mappings change.

### Completion evidence

- fictional Pass, Failure, Unknown, Not applicable, stale and historical-mapping scenarios reconcile across provider-shaped observations, database records and visible pages;
- duplicate collection and materialisation do not duplicate business records;
- an approved live repository produces current observations and official results;
- alert audiences receive only safe intended content;
- independent review confirms truthful language and lifecycle behaviour.

### Explicitly deferred

- unattended orchestration for every recurring ComplianceHub job;
- automatic remediation of GitHub settings;
- wider organisation-account governance permissions.

## 5. Milestone 3 — Portable built-in Platform Automation

### Outcome

ComplianceHub performs due internal and provider work automatically through one portable, durable and observable runner, without requiring a person to press Enable or keep a browser session open.

### What it will have

- automatic workspace enrolment;
- business schedules and a PostgreSQL job ledger;
- stable job occurrence identities;
- bounded executions, claims, leases and attempts;
- job-specific retry, recovery and Action required states;
- adapters for Monitoring, Evidence, Policies, Findings, Tasks, ticket synchronisation and notifications;
- contextual in-app status instead of an Automation workspace;
- private compliance and restricted engineering/operations Slack destinations;
- an audited, restricted emergency suspension;
- a cloud-neutral `runDueAutomation` interface usable locally and from AWS.

### What it will do

- plan and claim due work safely;
- prevent overlapping runners from duplicating jobs or business outcomes;
- isolate failures so unrelated jobs continue;
- retry temporary failures with bounded increasing delay;
- stop unsafe repetition when authorised human or provider action is required;
- send meaningful change, failure and recovery notifications;
- record execution health without confusing it with compliance status.

### Completion evidence

- sequential resource-safe tests prove due planning, concurrency, leases, retries, deduplication and isolation;
- a local fictional production-mode demonstration runs the same portable command intended for AWS;
- missed or failed work becomes visible in the correct product area;
- repeated cycles do not duplicate Evidence, Findings, Tasks or notifications;
- no normal Automation section or Enable button is introduced.

### Explicitly deferred

- AWS infrastructure acceptance;
- migration of Supabase data services;
- provider actions beyond already approved scopes.

## 6. Milestone 4 — Company AWS staging and platform cutover

### Outcome

The company-controlled AWS environment reliably hosts the ComplianceHub web process and starts the portable Automation runner under approved company security, networking, monitoring and operational controls.

### What it will have

- private immutable images in ECR;
- ECS Fargate web service behind the company-approved load balancer;
- EventBridge Scheduler target for a finite ECS Fargate Automation task;
- SQS dead-letter handling for failed schedule delivery;
- Secrets Manager and KMS protection;
- separate least-privilege runtime, scheduler, deployment and human roles;
- CloudWatch logs, metrics, heartbeats and alarms;
- approved DNS, TLS, networking, ingress and egress;
- OIDC/federated deployment credentials rather than permanent AWS access keys;
- documented rollout, rollback and scheduler-ownership transfer.

### What it will do

- run the web application independently of scheduled Automation executions;
- start the exact tested Automation command on schedule;
- detect task-start failure, crash, timeout, missing heartbeat and dead-letter accumulation independently;
- keep secrets and sensitive evidence out of ordinary logs;
- prevent the legacy and AWS production schedulers from owning the same work concurrently;
- retain Supabase temporarily while proving the AWS application/runtime layer.

### Completion evidence

- the company AWS administrator confirms the environment requirements;
- the exact tested image runs both commands in staging;
- IAM, secret access, networking and logging match the approved controls;
- scheduled and deliberately failed executions exercise alarms and dead-letter handling;
- app health remains stable during Automation work;
- repeated scheduled cycles remain deduplicated;
- rollback restores the previous accepted image and scheduler state;
- company staging acceptance is recorded separately from production approval.

### Explicitly deferred

- automatic production deployment;
- deletion of retained Azure history;
- migration of database, authentication or evidence storage from Supabase;
- production acceptance without a separate decision.

## 7. Milestone 5 — Company-wide ComplianceHub MCP assistant

### Outcome

Employees use the company-owned Codex as a helpful ComplianceHub assistant. MCP supplies only the employee's permitted, traceable company facts; Codex explains them naturally and links back to the visual control room.

### What it will have

- one canonical AWS-hosted MCP endpoint;
- company-owned Codex as the only approved first-release client;
- individual ComplianceHub OAuth authentication;
- strict client, workspace, role, tool and field authorisation;
- narrow tools for employee work, policies, published summaries, controls, evidence status, attention items, Monitoring, GitHub results, risks, audits and leadership reports;
- bounded structured results with source references, freshness, limitations and protected links;
- human-facing answers in the approved calm compliance-colleague style;
- clear separation of company facts from general guidance;
- metadata-only MCP audit history;
- diagnostics, login recovery, token refresh, revocation and safe rate limiting;
- operational health and failure alerts without a dedicated primary MCP workspace.

### What it will do

- prioritise employee self-service questions about applicable policies, assigned work and deadlines;
- support Owner/Admin investigation of evidence gaps, failures, risks, audits and Monitoring changes;
- support concise published leadership explanations;
- return Unknown or Stale instead of guessing;
- report permitted conflicting records and recommend governed review;
- recommend a next step without inventing ownership, deadlines or approval;
- keep raw evidence inside ComplianceHub;
- leave all schedules, writes, task creation and proactive alerts to Platform Automation.

### Completion evidence

- the existing seven-tool foundation is re-proven through one canonical configuration;
- expanded tools reconcile with database projections and corresponding web pages;
- Owner, Admin and Member tests prove the agreed permission matrix;
- cross-workspace, invalid-client and restricted-field tests fail closed;
- protected state is unchanged across MCP read proofs;
- company Codex completes direct, follow-up, refusal, stale and conflict scenarios;
- a cross-role pilot finds the answers accurate, understandable and useful;
- the Compliance Owner and company AWS/security administrator jointly accept company-wide release.

### Explicitly deferred

- individual employee Codex or Claude accounts;
- MCP write tools;
- MCP-triggered notifications or schedules;
- raw evidence-document retrieval;
- conversation storage by ComplianceHub;
- support for every compatible MCP client.

## 8. Cross-milestone release gates

Every milestone receives its own detailed design and implementation plan. Its evidence must separately identify:

- source implemented;
- focused automated checks passed;
- broader regression checks passed;
- local fictional behaviour demonstrated;
- live-provider behaviour demonstrated where applicable;
- AWS staging behaviour demonstrated where applicable;
- accessibility and human review completed where applicable;
- responsible company acceptance obtained;
- production release approved.

A proposal, passing test, local screenshot, historical artifact or AI recommendation is not evidence that a later gate passed.

## 9. Critical dependencies

| Dependency | Required before |
|---|---|
| Current architecture/visual programme accepted | Starting Milestone 1 execution |
| Approved GitHub organisation and repository scope | Live Milestone 2 proof |
| Stable Monitoring and business-record interfaces | Completing Milestone 3 |
| Company AWS account, region, networking, IAM, logging and cost decisions | Writing/deploying Milestone 4 infrastructure |
| Accepted AWS-hosted OAuth and MCP ingress | Completing Milestone 5 |
| Company-owned Codex access and named cross-role pilot users | Milestone 5 pilot |

## 10. Recommended next action

When the current architecture work is accepted, begin Milestone 1 with a current-state audit of the existing GitHub App, repository-listing flow, tests and historical evidence. Reuse working foundations, but require fresh acceptance rather than assuming that earlier local or provider proof is still current.

Do not begin all five milestones as one implementation branch. Create one milestone-specific design and one milestone-specific implementation plan at a time. Complete its review and evidence gates before the next milestone takes ownership of the dependency.
