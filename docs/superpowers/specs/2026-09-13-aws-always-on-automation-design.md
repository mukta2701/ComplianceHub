# ComplianceHub AWS always-on automation design

Date: 13 September 2026
Status: Approved product and architecture design; not implemented or deployed.

## 1. Bounded outcome

ComplianceHub will include Platform Automation as an always-available product capability. Every workspace participates in internal recurring administration from creation. Approved provider connections add external work automatically; they do not enable the automation engine.

The web application and automation runner will be built from the same source and immutable container image. The web process serves people. A separate, finite runner processes due work and exits. In the intended AWS environment, Amazon EventBridge Scheduler will start that runner as an Amazon ECS task on AWS Fargate.

There will be no Automation navigation section and no normal Enable Automation button. Results and failures appear in the relevant product areas and through contextual in-app and Slack notifications.

This design does not deploy AWS resources, replace Supabase, enable live providers, activate Slack or establish hosted acceptance.

## 2. Confirmed context

ComplianceHub is currently a Next.js modular monolith backed by Supabase Auth, PostgreSQL, private evidence storage and row-level access rules. Existing automation behavior is distributed across authenticated cron routes, provider collectors, monitoring workers, daily administration, materialisation jobs, ticket synchronisation and notification delivery.

The current hosted design uses GitHub Actions schedules to call protected application routes. Azure staging has not been accepted as a release. The owner has now selected a company-controlled AWS environment for the next hosting direction. Whether that environment already has an approved non-production account, region and landing-zone controls remains unknown and must be confirmed with the company AWS administrator before infrastructure is written or deployed.

The owner selected a phased backend decision:

1. Move the web application and automation runtime to AWS while retaining Supabase temporarily.
2. Assess database, authentication, evidence storage and backup placement as a separate milestone using the company's residency, ownership, security and procurement requirements.

## 3. Product boundaries

Platform Automation is built-in infrastructure, not a user workspace.

| Responsibility | Product meaning |
|---|---|
| Settings → Connections | Which external systems the company has authorised, and their approved scope |
| Platform Automation | What work is due, how it is claimed, retried and recorded |
| Monitoring | What connected-system compliance checks discovered |
| Evidence | What dated proof is preserved, including provenance and freshness |
| Findings | What failed or requires investigation |
| Tasks | Who is responsible for corrective or recurring work |
| Notifications | Who needs to know about a meaningful change or operational problem |

Outcomes stay in their respective areas. GitHub collection health and check results appear in Monitoring. Evidence expiry appears in Evidence and resulting Tasks. Due policy reviews appear in Policies and Tasks. Credential or provider-scope problems appear in Settings → Connections. Platform Automation coordinates these modules without taking ownership of their business rules.

## 4. Canonical domain language

- **Platform Automation:** ComplianceHub's built-in facility for planning and performing repeatable recurring work across workspaces.
- **Connection:** an approved relationship with an external system, including its permitted scope and current access condition.
- **Schedule:** a rule describing when a kind of recurring work becomes due.
- **Execution:** one invocation of the bounded automation runner.
- **Job:** one durable occurrence of bounded work for one workspace and purpose.
- **Attempt:** one try to complete a Job.
- **Outcome:** the result returned by the responsible product module.
- **Business record:** Evidence, Finding, Task or notification created or updated because of an Outcome.
- **Action required:** an operational state that automation cannot truthfully resolve without authorised human or external-system action.

The following distinctions are binding:

- Execution succeeded does not mean a compliance check passed.
- Task completion does not prove technical remediation or close a Finding.
- Provider unavailability does not prove a compliance failure.
- A requested retry is not a recovered operation.
- An accepted exception is not a passing technical check.

## 5. Considered deployment approaches

### Selected: scheduled Fargate runner with PostgreSQL job ledger

EventBridge Scheduler starts a finite ECS Fargate task. The task invokes the portable ComplianceHub runner, claims due PostgreSQL Jobs, processes a bounded amount of work and exits.

This preserves cloud-neutral business logic, keeps job and business-record history together, works locally, and avoids an always-running worker for predominantly periodic work.

### Rejected for this milestone: Lambda and Step Functions

AWS-managed orchestration would provide useful execution views and retry facilities, but it would distribute ComplianceHub's workflow across AWS definitions and application modules, require new adapters for current code, and make local verification less representative.

### Deferred unless measured load justifies it: continuously running ECS worker

A permanent worker would reduce job-start latency but add continuous cost, replica lifecycle management and concurrency risk without a demonstrated need.

AWS App Runner is not selected. AWS states that App Runner is closed to new customers and recommends ECS Express Mode for new deployments.

## 6. System architecture

One immutable container image will support two commands:

- the **web command**, which runs the Next.js application as an ECS Fargate service;
- the **automation command**, which runs one bounded cycle as an ECS Fargate task and exits.

```text
Internet → load balancer → Fargate web service → ComplianceHub UI/actions

EventBridge Scheduler → Fargate automation task
                              ↓
                     runDueAutomation
                              ↓
                     PostgreSQL job ledger
                       ├── GitHub adapter
                       ├── Monitoring module
                       ├── Evidence module
                       ├── Policy module
                       ├── Finding/Task modules
                       ├── Ticket adapters
                       └── Notification adapters

CloudWatch/EventBridge watchdog → operations alert destination
```

The primary orchestration seam is one deep module:

```text
runDueAutomation({ executionId, startedAt, maximumJobs, timeBudget })
```

Callers do not manage individual providers, leases or retry rules. The module plans due work, creates stable occurrences, claims Jobs, calls the responsible adapters, records Outcomes and returns a safe execution summary.

The web process never hosts a permanent timer loop. An authorised "Check again" action creates or prioritises a Job; it does not perform a long provider workflow inside the browser request.

## 7. Scheduling and job model

One EventBridge schedule wakes the runner frequently. The exact interval will be set from measured runtime and company cost requirements; five minutes is the initial design assumption, not a committed production value. Each business Schedule retains its own cadence, such as daily GitHub collection or daily evidence-freshness review.

On each Execution, the runner:

1. records the Execution identity and tested release;
2. finds overdue and currently due Schedules;
3. creates missing Jobs using stable occurrence identities;
4. claims a bounded number of Jobs with expiring leases;
5. processes independent Jobs within its time budget;
6. saves each Outcome and its resulting-record references;
7. schedules safe retries or marks Action required;
8. queues notifications;
9. records the Execution summary;
10. exits.

Jobs are small enough to retry and understand independently: one repository collection, one materialisation batch, one workspace freshness sweep, one ticket batch or one notification delivery. A failed repository does not block unrelated internal work.

The initial PostgreSQL interface will support the behaviors represented by:

```text
planDueWork(now)
claimNextJob(workerId)
completeJob(jobId, outcome)
scheduleRetry(jobId, reason, nextAttempt)
markActionRequired(jobId, reason)
```

The precise interface may become smaller during implementation, but callers must not need to understand storage locking or provider-specific retry details.

## 8. Automatic enrolment and connection lifecycle

Workspace creation automatically establishes internal recurring administration for evidence freshness, policy reviews, overdue work, configured ticket synchronisation, notification delivery and retention work.

When an Owner connects GitHub and approves repository scope:

1. the Connection is recorded securely;
2. an initial collection Job becomes due;
3. each selected repository participates in its recurring Schedule;
4. AI prepares check-to-control mapping proposals with rationale and confidence;
5. an Owner approves each mapping once;
6. later eligible results process automatically.

Changes to the applicable rule, control, framework or mapping version require renewed mapping approval. AI does not authorise its own mapping.

Pausing or revoking GitHub prevents future GitHub collection while retaining history. It does not pause internal Platform Automation. Removing a repository from scope records when monitoring stopped and preserves its Evidence, Findings, Tasks and earlier observations.

## 9. GitHub outcome flow

The first provider scope remains the explicitly selected repositories available to the approved GitHub App installation. Organisation-wide MFA and owner-governance scanning are deferred because they require separate provider permissions, privacy review and acceptance.

For each selected repository:

```text
Collect complete observations
          ↓
Approved mapping available?
  ├── no  → request mapping approval
  └── yes
       ├── Pass    → create or refresh official Evidence
       ├── Failure → create or reopen one deduplicated Finding
       │                 ↓
       │           approved owner available?
       │             ├── yes → create or reuse remediation Task
       │             └── no  → notify the coordinator
       └── Unknown → explain the missing permission, feature or fact
```

A newer, valid passing observation may resolve the matching Finding. It does not complete the remediation Task. The Task retains its own contribution and review lifecycle.

Task ownership follows an approved check/control owner, then a configured repository owner. AI never assigns an arbitrary workspace member. If no approved owner exists, the Finding is preserved and the coordinator is asked to assign it.

## 10. Failure and recovery

Failures are classified before retrying:

| Class | Examples | Required behavior |
|---|---|---|
| Temporary | rate limit, short network outage | bounded retry with increasing delay |
| Interrupted | worker stopped after claiming | lease expires and another Execution safely reclaims |
| Action required | revoked access, missing permission, stale mapping | stop automatic retries and notify the responsible people |
| Permanent limitation | unsupported provider feature | record Unknown or not applicable; never fabricate Pass or Failure |
| Ambiguous external delivery | Slack timeout after a possible send | preserve uncertain outcome; do not blindly duplicate delivery |

Retry limits vary by Job type. Repeated failure cannot be labelled healthy merely because the scheduler continues running. One Job's failure does not roll back unrelated successful Outcomes.

An authorised person may record a time-limited compliance exception with its reason, approver and review date. The affected result remains visibly failing-with-exception. Repeated business alerts may pause until the exception expires or its conditions change; the result never becomes Pass.

## 11. User visibility and notifications

There is no Automation page. The durable ledger exists for reliability, audit and support, but ordinary users see only contextual operational status.

- GitHub collection failure links to Monitoring.
- Expired or revoked credentials link to Settings → Connections.
- Evidence-freshness work links to Evidence or the resulting Task.
- Policy-review work links to Policies or the resulting Task.
- Findings and remediation link to their normal records.

ComplianceHub always creates the authorised in-app notification first. Slack is an additional delivery adapter.

The approved private compliance channel receives sanitised notices for new or reopened Findings, stale Evidence, due policy work, overdue work, provider Action required and confirmed recovery. Routine success remains quiet.

A separate restricted engineering/operations channel receives missed scheduler invocations, ECS task failures, missing heartbeats, dead-letter accumulation, secret or AWS permission failures, emergency suspension and confirmed infrastructure recovery.

Slack messages contain safe summaries and authenticated ComplianceHub links. Raw evidence contents, provider credentials and sensitive diagnostics remain inside authorised systems.

Slack is a channel-only notice path. ComplianceHub does not send employee direct messages or let a Slack reply approve, edit, resolve or complete a record. Employees follow the link and act in ComplianceHub, where their normal role permissions and audit history apply.

## 12. Independent watchdog and emergency control

Every runner Execution records a heartbeat and terminal summary. CloudWatch and EventBridge independently detect failed task startup, task crash or timeout, missing heartbeat, repeated failure and dead-letter accumulation. This infrastructure path must not depend on the failed ComplianceHub runner to report its own outage.

There is no normal user-facing Enable or Disable control. A restricted company administrator may suspend the runner, one provider or one dangerous Job type during an incident. Suspension and resumption require a reason, are audited and notify the operations destination. Resumption does not automatically claim that earlier work recovered.

## 13. AWS deployment and security

The target is the existing company-controlled AWS environment. Before infrastructure work, the company AWS administrator must confirm:

- the approved account and non-production environment;
- region and data-residency requirements;
- landing-zone networking and ingress/egress controls;
- IAM and deployment-authority boundaries;
- logging, monitoring, retention and incident-management requirements;
- allowed infrastructure-as-code and CI/CD path;
- budget ownership and cost controls.

The proposed AWS resources are:

- Amazon ECR for private immutable images;
- an ECS Fargate service behind an Application Load Balancer for the web process;
- an EventBridge Schedule targeting an ECS Fargate task for the runner;
- an SQS dead-letter queue for failed scheduler delivery;
- AWS Secrets Manager and KMS for runtime secrets;
- CloudWatch for logs, metrics, heartbeats and alarms;
- Route 53 and ACM where approved for company DNS and TLS.

Distinct least-privilege roles are required for the web task, automation task, EventBridge Scheduler, deployment identity and human administrators. GitHub Actions should use AWS federation/OIDC rather than permanent AWS access keys.

Where the company landing zone permits, tasks run in private subnets and only the load balancer accepts public traffic. Outbound access is limited to approved dependencies such as Supabase, GitHub and Slack. Logs exclude secrets and raw evidence contents.

Primary AWS references:

- [Schedule ECS tasks with EventBridge Scheduler](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html)
- [Schedule containers on Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/scheduling_tasks.html)
- [AWS guidance for a containerised scalable web application](https://docs.aws.amazon.com/solutions/building-a-containerized-and-scalable-web-application-on-aws/)
- [Use Secrets Manager with ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-app-secrets-manager.html)
- [AWS App Runner availability change](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html)

## 14. Migration and cutover

AWS staging is introduced without allowing the old and new production schedulers to run concurrently:

1. obtain the company AWS requirements;
2. implement and locally verify the portable runner and durable ledger;
3. create infrastructure as code for the approved staging environment;
4. deploy the web image with the EventBridge schedule inactive;
5. verify app, database, identity and secret access;
6. run the automation task manually against approved fictional staging data;
7. activate one staging Schedule and verify retries, watchdog, dead-letter and deduplication behavior;
8. disable the corresponding GitHub Actions schedule;
9. activate the complete AWS staging Schedule;
10. observe it across an agreed acceptance window;
11. request a separate production decision.

Azure infrastructure and historical deployment evidence are retained until AWS staging is accepted. They are not evidence that AWS works. Any later removal is a separate reviewed change.

## 15. Verification and acceptance

### Automated source and database checks

- due work is planned once;
- duplicate dispatcher Executions do not duplicate Jobs;
- two workers cannot claim the same Job;
- expired leases recover safely;
- retry delay and limits are enforced;
- Action required stops automatic retry;
- one failed Job does not block independent work;
- service-level execution cannot cross workspace scope;
- business records and notifications remain deduplicated;
- Job success and compliance status remain independent;
- newer passing observation, not Task completion, resolves the Finding;
- emergency suspension and resumption are audited.

### Local fictional demonstration

A resource-safe full-preview command runs the same portable runner used by AWS. It demonstrates automatic internal scheduling, provider enrolment after connection, Pass/Failure/Unknown, automatic Evidence/Finding/Task outcomes, temporary retry and recovery, persistent Action required, contextual in-app notices, sanitised simulated Slack delivery and repeated execution without duplicates.

This is local fictional proof only.

### Company AWS staging acceptance

- the exact tested image runs both commands;
- EventBridge starts the intended ECS task;
- the runner exits within its resource and time budget;
- secret access matches the approved roles;
- leases prevent overlapping work;
- CloudWatch detects a deliberately failed or missing execution;
- the SQS dead-letter path works;
- the two approved alert destinations receive only their intended messages;
- user-facing app health remains stable during execution;
- repeated scheduled cycles do not duplicate records;
- the former GitHub Actions schedule is inactive before AWS takes ownership;
- rollback restores the previous accepted image and schedule.

Passing local checks does not prove AWS. Passing AWS staging does not prove a live provider. A live-provider rehearsal does not authorise production.

## 16. Delivery sequence

### Milestone A — AWS readiness checkpoint

The company AWS administrator supplies the approved non-production target and its requirements. No infrastructure is written or deployed before this checkpoint.

### Milestone B — portable always-on automation foundation

Implement the deep runner seam, PostgreSQL schedule/job/attempt ledger, automatic workspace enrolment, bounded work planning, leases, retry classification and contextual health projections. Demonstrate locally with fictional data. This milestone makes no hosted or live-provider claim.

### Milestone C — AWS staging web and runner

Build the approved AWS infrastructure, deploy the shared image, prove manual and scheduled runs, alarms, dead-letter behavior, secrets, isolation, rollback and absence of duplicate scheduling.

### Milestone D — approved live provider and notification rehearsal

Use deliberately approved GitHub repository scope and private Slack destinations to prove the current release's live collection, materialisation, notification and recovery paths. This does not establish production acceptance.

### Later decision — AWS data-platform assessment

Decide whether Supabase remains managed externally, is self-hosted in AWS or is replaced by AWS-native database/auth/storage capabilities. Do not combine that decision with Milestones B or C.

## 17. Explicitly deferred

- organisation-wide GitHub MFA and owner-governance scanning;
- automatic changes to GitHub security settings;
- new provider integrations;
- a general-purpose workflow builder;
- SQS or Step Functions as the product job ledger without demonstrated need;
- a permanently running worker without measured latency or throughput need;
- migrating PostgreSQL, authentication, evidence storage or backups from Supabase;
- production deployment, customer launch or certification claims.

## 18. Approval record

The owner approved the AWS direction, cloud-neutral automation core, automatic workspace enrolment, single frequent dispatcher, PostgreSQL ledger, bounded Jobs, contextual product visibility, independent watchdog, protected emergency suspension, separated Slack destinations, staged migration and verification boundaries in the design discussion on 13 September 2026.

This approval authorises design documentation. It does not authorise AWS resource creation, provider writes, live Slack messages, production deployment or migration of company data.
