# ComplianceHub Trusted Compliance Platform — Product Requirements and Description

Date: 13 September 2026

Status: Sole active future product direction; written document awaiting owner review

Owner: ComplianceHub

Roadmap: [Five-milestone delivery roadmap](2026-09-13-trusted-compliance-platform-roadmap.md)

## 1. Document purpose

This PRD organises the agreed product direction for the work that follows the current architecture and visual-design programme. It describes the product outcome shared by five connected milestones:

1. GitHub organisation and repository integration;
2. trustworthy compliance Monitoring;
3. built-in Platform Automation;
4. company-controlled AWS hosting;
5. a company-wide ComplianceHub MCP assistant.

Each milestone will receive its own reviewed design and phase-by-phase implementation plan before implementation. This PRD does not claim that a milestone, provider connection, AWS environment or hosted release is complete.

The [release checklist](../../release-checklist.md) remains the sole live status record. This document defines intended product behaviour, not current delivery status.

## 2. Product description

ComplianceHub is the company's visual compliance control room and official record of its compliance programme. It connects approved company systems, turns their observations into traceable compliance facts, keeps recurring compliance work operating automatically, and lets authorised employees understand those facts through a company-managed AI assistant.

The product has four distinct responsibilities:

| Responsibility | Product role |
|---|---|
| ComplianceHub web application | Visual control room for records, configuration, review, approval, corrective work and audit history |
| Monitoring | Converts approved provider observations into explicit Pass, Failure, Unknown or Not applicable results |
| Platform Automation | Performs approved recurring work, recovery and notification without a normal Enable button or dedicated Automation workspace |
| MCP server and company Codex | Gives employees permission-aware, conversational access to ComplianceHub facts |

These responsibilities share trusted ComplianceHub records but do not duplicate one another. Automation creates or updates authorised facts and work. MCP explains those facts when an employee asks. The web application remains authoritative when a record must be inspected, reviewed, approved or changed.

## 3. Problem to solve

Company compliance information is difficult to maintain and understand when it is split across provider settings, spreadsheets, evidence files, tickets and specialist terminology. Manual checking becomes stale, repeated coordination consumes the compliance team, and leadership can mistake a summary for verified proof.

ComplianceHub must make the operating position understandable without weakening its truthfulness:

- provider scope must be deliberate;
- every technical result must retain provenance and freshness;
- missing access or missing information must remain Unknown rather than becoming a false Pass;
- automatic work must be reliable, deduplicated and visible in the area it affects;
- employees must see only information permitted by their role;
- conversational answers must remain traceable to the official records;
- local demonstrations, historical proof, live-provider proof, AWS acceptance and production approval must remain distinct.

## 4. Product goals

### 4.1 Connect the approved company scope

An Owner can connect the approved company GitHub organisation through a least-privilege GitHub App, see the repositories available to the installation and select the repositories ComplianceHub is authorised to monitor. Removing a repository from future scope preserves its historical records.

### 4.2 Produce trustworthy monitoring facts

ComplianceHub regularly and on demand checks selected repositories against deterministic rules. An Owner approves each proposed check-to-control mapping before its results affect the compliance programme. Results create or refresh the correct Evidence, Finding and remediation relationships without treating a technical check as certification or overall compliance.

### 4.3 Operate without routine human intervention

Platform Automation is built into the product. Every workspace receives internal recurring administration automatically, and an approved provider connection adds its own recurring work. The system plans durable jobs, performs bounded attempts, recovers safely from temporary failures and alerts people only when action or awareness is required.

### 4.4 Run in the company-controlled AWS environment

The web application and Automation runtime move to the existing company-controlled AWS environment in stages. The initial AWS phase retains Supabase for authentication, PostgreSQL data and evidence storage while the company separately assesses whether those data services should later move.

### 4.5 Make compliance conversational without replacing governance

The company-owned Codex becomes the first approved AI client for ComplianceHub. The MCP server authenticates each person, applies a stricter permission matrix, returns bounded structured facts and provides sources, freshness, limitations and protected web links. Codex presents the result in the tone of a calm, knowledgeable compliance colleague.

## 5. Users and outcomes

### Owner

The Owner configures company connections and repository scope, approves monitoring mappings, sees the complete permitted operating position, governs MCP data exposure and jointly accepts production release with the company AWS/security administrator.

### Admin

An Admin operates the compliance programme, investigates monitoring and Automation problems, reviews evidence status, findings, risks, audits and tasks, and performs safe retries or recovery where authorised.

### Member

A Member sees published company summaries, approved policies, their assigned work and safe explanations relevant to them. MCP does not give Members broad visibility merely because an AI client makes aggregation easy.

### Leadership reader

An authorised reader receives concise published summaries that distinguish verified records, missing data, recommendations and accepted decisions. A generated answer never implies certification or legal assurance.

### Company AWS/security administrator

The company administrator controls AWS account, region, networking, IAM, logging, secrets, deployment authority, cost controls and operational acceptance. Product tests do not replace this accountable approval.

## 6. Product requirements by milestone

### Milestone 1 — GitHub organisation and repository integration

The product will:

- use a company-approved, least-privilege GitHub App;
- bind installations and repositories to the correct ComplianceHub workspace;
- show available repositories and let an Owner approve monitoring scope;
- preserve installation, repository and scope history;
- validate webhook authenticity and make replay safe;
- show credential, permission and collection-access problems in Settings → Connections;
- avoid treating connection success as proof that collection or monitoring works.

It will not change GitHub repository settings automatically in this milestone.

### Milestone 2 — Trustworthy Monitoring

The product will:

- collect complete, traceable observations for selected repositories;
- run deterministic versioned checks;
- let AI propose check-to-control mappings with rationale and confidence;
- require Owner approval before a mapping can affect official results;
- require renewed approval when the applicable rule, framework, control or mapping version changes;
- publish explicit Pass, Failure, Unknown or Not applicable outcomes;
- create or refresh official Evidence for valid passing outcomes;
- create or reopen one deduplicated Finding for a failure;
- create or reuse a remediation Task only when an approved owner can be selected;
- let a newer valid Pass resolve the matching Finding without automatically completing its Task;
- preserve exceptions as failing-with-exception until independently remediated;
- provide an attention-first Monitoring view and truthful freshness/history.

### Milestone 3 — Built-in Platform Automation

The product will:

- enrol every workspace in internal recurring administration;
- add provider work when an Owner approves a connection and its scope;
- use a durable PostgreSQL schedule and job ledger;
- create stable job occurrences, bounded claims, expiring leases and auditable attempts;
- apply job-specific bounded retry and increasing delay for temporary failures;
- mark persistent permission or configuration problems as Action required;
- keep independent jobs isolated so one failure does not block unrelated work;
- place business outcomes in Monitoring, Evidence, Findings, Tasks, Policies or Connections;
- create the authorised in-app notification first and optionally deliver a sanitised Slack notice;
- keep compliance alerts separate from restricted engineering/operations alerts;
- provide an audited emergency suspension for authorised company administrators.

There will be no normal Automation navigation section and no normal Enable Automation button.

### Milestone 4 — Company-controlled AWS platform

The product will:

- build one immutable container image for the web and Automation commands;
- run the Next.js web application as an ECS Fargate service behind an approved load balancer;
- run one finite Automation cycle as an EventBridge Scheduler-triggered ECS Fargate task;
- use ECR, Secrets Manager, KMS, CloudWatch and an SQS dead-letter path as approved by the company;
- keep web, Automation, scheduler, deployment and human administration identities separate and least privilege;
- use company-approved TLS, networking, logging, retention, cost and incident controls;
- prove missing executions and task failures through an independent AWS watchdog;
- introduce AWS staging without running the legacy and AWS production schedulers concurrently;
- retain Supabase temporarily behind cloud-neutral application interfaces;
- require a separate reviewed decision before production cutover or data-platform migration.

### Milestone 5 — Company-wide ComplianceHub MCP assistant

The product will:

- keep ComplianceHub as the visual control room and official source of truth;
- expose several narrow, permission-aware tools rather than database access or one unrestricted question tool;
- use the company-owned Codex as the only approved first-release client;
- require each person to authenticate with their own ComplianceHub identity;
- apply an MCP-specific role and field policy in addition to database row-level security;
- support employee self-service as the priority use case, followed by compliance investigation and executive explanation;
- cover approved policies, assigned work, published summaries, controls, evidence status, findings, risks, audits, Monitoring and leadership reports according to role;
- keep raw evidence bodies, credentials, provider payloads, secrets and unnecessary person-level data out of MCP;
- remain read, explain, summarise and recommend only;
- keep general guidance visibly separate from verified company facts;
- return source references, freshness, limitations and protected ComplianceHub links;
- present answers in clear, human language instead of exposing the internal structured response;
- record user, workspace, tool, time, outcome and referenced-record metadata without retaining the conversation;
- fail safely on stale, unknown, conflicting, unauthorised or unavailable information;
- leave proactive collection, work creation and Slack alerts to Platform Automation.

## 7. End-to-end product journey

```text
Owner connects company GitHub and selects repositories
                         ↓
Monitoring collects observations and applies approved mappings
                         ↓
Official Evidence, Findings and Tasks preserve the result
                         ↓
Platform Automation keeps checks and recurring work current
                         ↓
AWS runs the web and Automation processes under company controls
                         ↓
Employee asks company Codex a compliance question
                         ↓
MCP returns only permitted, traceable ComplianceHub facts
                         ↓
Codex explains the answer and links back to the visual control room
```

## 8. Human-facing MCP experience

MCP structured output is an internal contract, not the employee-facing response. Codex will:

- lead with the direct answer in ordinary language;
- explain why the answer matters to that person;
- suggest one useful next step without inventing an owner, deadline or company decision;
- keep the normal response concise and allow follow-up questions;
- present source and freshness information as a quiet footer or supporting detail;
- state stale, unknown or conflicting information plainly without alarmism;
- avoid repetitive labels, audit jargon, fake enthusiasm and unnecessary technical detail.

ComplianceHub records remain authoritative if generated prose and a source record appear to disagree.

## 9. Cross-cutting trust and operational requirements

- Every tenant-owned read and write is workspace scoped and tested against cross-tenant access.
- Every consequential automatic outcome is idempotent, attributable and auditable.
- Provider unavailability never becomes a compliance Failure unless the applicable deterministic rule supports that result.
- Task completion never proves technical remediation.
- An exception never becomes a Pass.
- A prepared or attempted notification is distinct from confirmed delivery.
- Raw credentials, private evidence and sensitive diagnostics never enter normal logs, screenshots, Slack messages or MCP output.
- The web application remains usable when MCP is unavailable.
- Independent AWS monitoring can report an Automation outage when the Automation runner cannot report for itself.
- The local production preview and verification process follow the repository's resource-protection guidance.

## 10. Success measures

Success is evaluated as a collection of separate facts, not one vanity metric:

- selected repository scope is accurate and reviewable;
- official Monitoring results reconcile with provider observations and stored provenance;
- recurring work runs without duplicate records or unexplained gaps;
- meaningful failures and recoveries reach only the intended notification audiences;
- AWS staging meets company security and operational acceptance;
- MCP answers reconcile with the corresponding database projection and visible ComplianceHub page;
- role and cross-workspace tests prove that restricted data is not disclosed;
- pilot users can answer routine compliance questions with less compliance-team assistance;
- users judge the conversational answers useful and understandable;
- no success claim relies solely on call count, process uptime or an AI-generated assessment.

## 11. Non-goals

This product sequence does not include:

- automatic changes to GitHub security settings;
- an unrestricted AI database query interface;
- MCP-created tasks, record edits, finding resolution or notification delivery;
- raw evidence-document retrieval through MCP;
- employee use of individual Codex or Claude accounts in the first MCP release;
- a dedicated Automation workspace or normal master enable switch;
- organisation-wide GitHub MFA or owner-governance scanning without a separate permission and privacy design;
- an immediate migration of Supabase data, authentication or storage into AWS;
- production deployment based only on local or fictional proof;
- claims of certification, legal assurance, total security or overall compliance.

## 12. Dependencies and accountable decisions

- The current architecture/visual increment must complete before this roadmap begins.
- Trustworthy Monitoring depends on approved GitHub repository scope and mapping governance.
- Platform Automation depends on stable business-module interfaces and a durable job model.
- AWS infrastructure depends on the company AWS administrator confirming the approved account, non-production environment, region, networking, ingress/egress, IAM, logging, retention, deployment and cost controls.
- The hosted MCP ingress model depends on whether company Codex reaches ComplianceHub through public protected HTTPS or the corporate network.
- Company-wide MCP completion depends on trustworthy source data, the AWS-hosted identity path, role acceptance and company-owned Codex acceptance.

## 13. Acceptance boundaries

Each milestone must distinguish:

1. source implemented;
2. automated checks passed;
3. behaviour demonstrated locally with fictional data;
4. live-provider behaviour demonstrated;
5. company AWS staging accepted;
6. human stakeholder acceptance;
7. production release approved.

Passing one boundary does not imply another. Detailed evidence and current status belong in the release checklist and linked evidence documents.

## 14. Authoritative direction and historical records

This PRD and its companion roadmap are the sole active product direction for future work after the current architecture programme. They supersede the earlier top-level roadmap and all earlier active MCP designs and implementation plans. Those superseded files have been removed from the active documentation tree; Git history preserves them if an historical investigation is ever required.

Historical evidence documents remain because they record what was demonstrated at a particular time. They are evidence, not instructions and not proof of current behaviour. Earlier feature-specific designs may explain already-shipped source, but they do not change the future sequence or requirements in this PRD.

The [AWS always-on automation design](2026-09-13-aws-always-on-automation-design.md), approved during the same product discussion, supplies detailed architecture for Milestones 3 and 4. Every milestone will still receive a fresh, milestone-specific design before its implementation plan is written.
