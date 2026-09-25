# Milestone 1 — GitHub organisation and repository integration design

**Status:** Approved design

**Approved:** 14 September 2026

**Product milestone:** 1 of 5 in the trusted compliance platform roadmap

> **Delivery amendment approved 20 September 2026:** The product behavior in this design remains approved. The company ECS/EventBridge staging delivery and acceptance path in sections 11 through 13 is historical. The approved [AWS dev acceptance design](2026-09-20-github-integration-aws-dev-acceptance-design.md) replaces that path without changing the role, permission, repository-scope or connection-health contracts.

## 1. Purpose

Milestone 1 establishes the trusted boundary between one ComplianceHub workspace and the approved company GitHub organisation. An Owner can install the company-owned GitHub App, prove authority over the installation, discover every repository available to it, and select the repositories that ComplianceHub may later monitor.

Milestone 1 reports connection and scope health. It does not decide whether the company is compliant, create official Evidence, create Findings or remediation Tasks, or run the built-in Platform Automation planned for later milestones.

The accepted user-visible outcome is:

> A company-owned GitHub App can be securely connected to ComplianceHub, discover approved repositories, monitor only the explicitly selected scope, and clearly report connection health without modifying anything in GitHub.

## 2. Delivery approach

Complete and harden the existing GitHub integration. Do not rebuild it and do not create a generic provider platform first.

The existing installation, OAuth, repository-selection, webhook, database and Connections-interface foundations remain the implementation base. Work should close verified gaps, strengthen focused seams where required, configure the minimum company AWS staging runtime, and produce current live-provider acceptance evidence.

Existing GitHub collection, Monitoring and materialisation code may remain in the repository. Its presence is not Milestone 1 acceptance and it must not blur the boundary between trusted connection data and later compliance interpretation.

## 3. Roles and authority

### Owner

An Owner may:

- start installation and reconnection;
- prove authorised GitHub access;
- bind the verified installation to the workspace;
- select or remove repositories from ComplianceHub scope;
- review and follow recovery guidance;
- deliberately disconnect or replace the installation.

### Admin

An Admin may inspect the connected organisation, selected repositories, reconciliation freshness and safe connection incidents. An Admin may not install, reconnect, disconnect, or change repository scope. The interface must not show an Admin an action prompt that only an Owner can complete.

### Member

A Member has no access to GitHub connection configuration, provider diagnostics or installation controls. Later milestones may show a Member permitted compliance results related to their work without exposing the provider connection.

### Company AWS/security administrator

The company administrator controls the approved AWS account, region, networking, IAM, secrets, logging, cost controls and staging acceptance. Product tests do not replace this approval.

## 4. Permission and scope contract

### 4.1 Repository permissions

The staging GitHub App requests exactly these six repository permissions, all at read level:

- `metadata`;
- `administration`;
- `actions`;
- `vulnerability_alerts`;
- `security_events`;
- `secret_scanning_alerts`.

Milestone 1 rejects installations that are missing one of these permissions or grant a broader level. It requests no write permission and no general `contents` permission.

Additional permissions are outside Milestone 1. `checks: read` and `pull_requests: read` may be evaluated during Milestone 2. `members: read`, deployment access, custom-property access or `contents: read` require a named compliance use case, data-handling decision and separate approval before the GitHub App registration changes.

### 4.2 Two-layer repository scope

Repository access has two deliberate layers:

1. The GitHub organisation installs the App using **Only select repositories**.
2. A ComplianceHub Owner selects which of those authorised repositories is active in the workspace.

ComplianceHub cannot select a repository the GitHub installation cannot access. A repository leaving either layer stops future collection without erasing its permitted history.

Milestone 1 acceptance uses one dedicated pilot repository. The product may be technically ready for more repositories, but company-wide rollout is not part of this milestone.

## 5. Architecture

The GitHub Connection module is a focused boundary with four responsibilities.

GitHub remains the authorisation provider. Milestone 1 introduces no hosted authentication or connection broker between GitHub and ComplianceHub. An in-process open-source client library may be adopted only if implementation review shows that it reduces custom security-sensitive code without changing this trust boundary.

### 5.1 Connection ownership

- start the Owner-only installation flow;
- bind a short-lived, one-use state to the actor and workspace;
- use GitHub authorisation to prove that the actor can see the returned installation;
- verify the configured company account identity and type;
- bind one verified provider installation to the intended ComplianceHub workspace;
- reject cross-workspace installation or repository claims.

### 5.2 Repository scope

- discover every repository available to the installation using bounded pagination;
- preserve GitHub's stable repository identity independently from its display name;
- permit only an Owner to select an available repository;
- audit additions and removals;
- preserve historical identity when access or selection ends.

### 5.3 Trusted provider communication

- create short-lived, repository- and permission-restricted installation tokens when possible;
- accept only bounded, correctly signed and replay-safe webhook deliveries;
- independently reconcile installation, permission and repository state on a schedule;
- expose verified connection facts through a narrow read-only contract for Milestone 2.

### 5.4 Operational health

- derive connection and scope health for Settings → Connections;
- retry temporary failures without unnecessary human interruption;
- open one deduplicated incident for a persistent or serious failure;
- send sanitised in-app and Slack incident and recovery notices;
- never widen GitHub access or reinstall the App automatically.

## 6. Connection and data flow

### 6.1 Initial connection

1. A signed-in Owner starts setup.
2. ComplianceHub creates a short-lived, one-use security state bound to the Owner and workspace.
3. GitHub asks the Owner to install the private staging App on selected repositories.
4. GitHub redirects the Owner back to the registered ComplianceHub callback.
5. ComplianceHub verifies the state, actor, workspace, GitHub authority, organisation identity, installation ID, repository-selection mode and exact permission set.
6. ComplianceHub follows every repository-results page within configured bounds.
7. It stores the verified installation and available repository identities for that workspace.
8. The temporary GitHub user credential used to prove authority is discarded.

### 6.2 Repository selection

The Owner selects the pilot repository. The database verifies that it belongs to the workspace-bound installation and is currently available. The action records who changed scope and when.

### 6.3 Webhook intake

The public webhook endpoint:

- enforces a bounded request size;
- validates required delivery metadata;
- verifies the HMAC signature before trusting the body;
- accepts only supported event routing;
- uses the GitHub delivery ID to make replay harmless;
- records a cryptographic payload fingerprint and safe processing metadata;
- does not retain the complete raw body.

Connection and scope events can update or trigger verification of provider state. Events intended for later Monitoring must not create official compliance outcomes during Milestone 1.

### 6.4 Scheduled reconciliation

A finite scheduled process creates a short-lived installation token, reads the current installation and repository metadata, and compares it with the stored workspace-bound state. It records freshness, marks changed or unavailable scope truthfully, opens or resolves an incident, and exits.

Reconciliation verifies connectivity and scope only. It is not a Milestone 2 compliance check and is not the complete Milestone 3 Automation engine.

## 7. Data retention and protection

ComplianceHub retains only the data needed to prove and operate the connection:

- workspace and installation identity;
- GitHub organisation identity and account type;
- exact granted permissions and installation status;
- stable repository identity, safe repository metadata, availability and selected state;
- delivery ID, event name, fingerprint, processing status and timestamps;
- reconciliation status, diagnostic class and freshness;
- actor and timestamp for scope and connection audit events;
- sanitised incident and recovery records.

ComplianceHub does not retain complete raw webhook payloads, source code, installation tokens, GitHub user tokens, private keys, client secrets, webhook secrets or unrelated GitHub user data. Logs and Slack messages must not contain these values.

Historical connection and repository facts follow the company-approved retention policy. The company policy and AWS log-retention value are deployment inputs; absence of a supplied value must block production acceptance rather than cause silent deletion or indefinite accidental logging.

## 8. Credential lifecycle

- The GitHub App private key, client secret and webhook secret live in AWS Secrets Manager and are protected with KMS.
- Secrets are injected only into the runtime that needs them and never built into the image.
- Installation tokens are created on demand, kept in memory and never persisted or logged.
- The private key is rotated every 90 days and immediately after suspected exposure.
- Rotation validates the replacement key before revoking the previous key.
- Staging and production use separate private, company-owned GitHub Apps, installations, callback and webhook addresses, credentials and AWS secrets.

Milestone 1 provisions and accepts only the staging App. The production App belongs to the later production release path.

## 9. Interface design

GitHub remains in **Settings → Connections** and does not become a separate main navigation section.

Before connection, an Owner sees a plain-language explanation that the company GitHub organisation will be connected read-only and that ComplianceHub will not change GitHub.

After connection, the Owner sees:

- the connected organisation;
- plain-language connection health;
- last successful reconciliation;
- the exact granted read permissions;
- available and selected repositories;
- repository-scope management;
- reconnect or review-access actions when needed;
- a protected link to the corresponding GitHub installation settings.

Admins see the organisation, scope, freshness and safe incidents without mutation controls. Members do not see the connection configuration.

There is no general Automation enable switch. Once an Owner validly connects GitHub and selects a repository, connection reconciliation operates automatically. This does not enable later compliance interpretation or remediation Automation.

Status communication combines a concise state with a useful explanation and next action. For example:

> GitHub is connected and the pilot repository was checked five minutes ago. No action is needed.

or:

> ComplianceHub has not been able to verify GitHub access since 09:40. We are retrying automatically. Owners have been notified because the App's permission may have changed.

## 10. Failure, recovery and notifications

Connection health uses these meanings:

- **Healthy:** access and scope were verified recently.
- **Retrying:** a temporary failure occurred and bounded automatic recovery is in progress.
- **Partially unavailable:** one repository or capability cannot be verified while the rest remains usable.
- **Owner action required:** access is revoked, the installation is suspended, credentials are invalid or permissions changed.
- **Disconnected:** the installation no longer exists or was deliberately removed.

Temporary network and GitHub service failures use bounded retries with increasing delays. Provider rate limits wait until the provider permits another attempt. Authentication and permission failures do not retry forever. Repository removal fails closed for that repository. A later successful reconciliation closes the matching incident and records recovery.

One-off temporary failures stay quiet. Serious access failures alert immediately; persistent temporary failures alert after the retry threshold. Owners and Admins see the incident in ComplianceHub. The designated Slack channel receives one sanitised incident message and one recovery message rather than repeated noise.

ComplianceHub never automatically reinstalls the App, widens permissions, or restores repository scope.

## 11. Minimum AWS staging architecture

Milestone 1 uses the approved AWS platform pattern only to the extent required for a live provider pilot:

- the existing ComplianceHub image is stored in Amazon ECR;
- the Next.js application runs as an ECS Fargate staging service;
- a company-approved load balancer exposes the HTTPS application, callback and webhook routes;
- Route 53 and ACM provide company-controlled DNS and TLS where approved;
- EventBridge Scheduler starts a finite Fargate GitHub-reconciliation task;
- Secrets Manager and KMS protect runtime secrets;
- CloudWatch receives sanitised logs, metrics and alarms;
- Supabase temporarily continues to provide authentication, PostgreSQL and storage.

The web service, reconciliation task, scheduler, deployment identity and human administrators use separate least-privilege IAM roles. GitHub Actions uses AWS OIDC federation instead of permanent AWS access keys.

The running application reports its exact release identity and database health. AWS independently detects a web-service outage or reconciliation task that fails to start, so a failed application task is not solely responsible for reporting its own failure.

The company AWS administrator must supply and approve the exact non-production account, region, VPC, subnets, ingress and egress rules, DNS name, certificate approach, log retention, budgets and alert destination before infrastructure implementation. This staging prerequisite does not complete Milestone 4 or authorise production cutover.

## 12. Verification strategy

Evidence remains separated by what it proves.

### 12.1 Automated checks

Automated checks cover:

- Owner-only connection and repository-scope mutations;
- Admin read-only access and Member exclusion;
- one-use callback state, actor/workspace binding and installation authority;
- exact six-permission enforcement;
- complete paginated repository discovery and configured bounds;
- cross-workspace and cross-installation isolation;
- webhook signature, size, replay and event validation;
- selection, removal and historical preservation;
- reconciliation, bounded retry, incident deduplication and recovery;
- log and Slack sanitisation;
- absence of GitHub write operations.

### 12.2 Local production demonstration

An exact production-mode local build uses fictional, provider-shaped data to demonstrate the complete Connections experience on desktop and mobile. This proves application behaviour only. It is not live GitHub, AWS or human acceptance.

### 12.3 AWS staging acceptance

The exact tested image is deployed to the approved staging target. Acceptance verifies HTTPS callback and webhook availability, application and database health, release identity, secret injection, least-privilege IAM, EventBridge task startup, independent CloudWatch failure detection, and absence of secrets from the image, health response, logs and alerts.

### 12.4 Live GitHub pilot

The company-owned staging App is installed on one dedicated repository. An Owner connects it, discovers and selects the repository, receives a genuine webhook and observes successful reconciliation. The pilot also demonstrates scope removal, fail-closed disconnection, role restrictions, one sanitised Slack incident and recovery.

The granted GitHub permissions and available provider audit information must support the claim that ComplianceHub performed no write operation. Historical provider observations are not a substitute for this current pilot.

### 12.5 Human acceptance

Milestone 1 completes only after the ComplianceHub Owner and company AWS/security administrator accept the current automated, local, AWS and live-provider evidence. Production release and wider repository rollout require separate decisions.

## 13. Definition of done

Milestone 1 is finished when all of the following are true:

- the private staging GitHub App is installed on one approved pilot repository;
- GitHub grants exactly the six approved read permissions;
- an Owner connects the App and selects the repository;
- Admins inspect health without changing connection or scope;
- Members cannot reach GitHub configuration;
- valid webhooks are accepted and forged or replayed deliveries fail safely;
- scheduled reconciliation identifies current installation, permission and repository state;
- temporary failures retry within bounds;
- revoked access stops collection and creates the intended in-app and Slack incident;
- verified recovery closes the incident and sends a recovery notice;
- no GitHub write, general source-code collection, raw-payload retention or secret leakage occurs;
- required automated checks pass;
- the exact local build, AWS staging runtime and live GitHub round trip have separately recorded evidence;
- the ComplianceHub Owner and company AWS/security administrator approve the pilot.

## 14. Explicitly deferred

- compliance interpretation of GitHub facts;
- official Evidence, Findings or remediation Tasks created from GitHub observations;
- additional GitHub permissions;
- organisation-wide MFA or owner-governance scanning;
- automatic GitHub configuration changes;
- the general built-in Platform Automation engine;
- production GitHub App installation;
- full AWS platform acceptance or production cutover;
- organisation-wide repository rollout;
- migration of Supabase authentication, PostgreSQL or storage;
- the company-wide ComplianceHub MCP assistant.

## 15. Implementation-planning constraints

The implementation plan must begin from a fresh gap analysis against this approved design. It must distinguish existing behaviour that only needs current verification from missing behaviour that requires implementation. It must not claim that historical local or provider proof satisfies the milestone.

Each phase must state its user-visible outcome, affected module seams, automated checks, local evidence, external dependency and exit criterion. Infrastructure phases must wait for the company AWS administrator's exact staging inputs and authority. No phase may broaden GitHub permissions, enable later Monitoring outcomes, deploy to production or connect additional company repositories without a new decision.
