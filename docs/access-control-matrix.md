# ComplianceHub access-control matrix

This document is the reviewed database contract for the Owner, Admin, and Member
portals. It reflects the schema after
`20260714055739_harden_oauth_lifecycle_and_connector_provenance.sql`, including
the connection enablement, broker-reference, and offboarding hardening applied
earlier in the chain.

- **Operator** means an organisation membership with role `owner` or `admin`.
- **Member** means the ordinary `member` role.
- **R** means an RLS-scoped read. **W** means a permitted operational mutation,
  still subject to column constraints, immutable-row triggers, and application
  validation. A dash means no direct access.
- `service_role` workers are not represented by the portal columns. They retain
  only their separately granted automation, monitoring, delivery, and audit
  responsibilities.

## Organisation-scoped public tables

The pgTAP inventory test enumerates these 39 tables from the catalog. A new
public table with `organisation_id` makes the test fail until this matrix and its
policies are reviewed.

| Table | Operator | Member | Notes |
|---|---:|---:|---|
| `alert_channels` | R/W | — | Delivery configuration and secrets are operator-only. Disabled channels are excluded from delivery. Removing the configuring user clears provenance but preserves the shared channel for remaining operators. |
| `assessment_responses` | R/W | R | Writes normally go through `save_assessment_response`. |
| `assessment_sessions` | R/W | R | Member cannot create, complete, or revise an assessment. |
| `asset_categories` | R/W | R | Curated asset-register reference data. |
| `asset_risks` | R/W | R | Tenant-scoped asset/risk relationships. |
| `assets` | R/W | R | Member receives a read-only asset register. |
| `audit_checklist_items` | R/W | R | Member receives read-only audit progress. |
| `audit_events` | R | R | Trigger-generated; no authenticated role may directly insert, update, or delete. |
| `audit_findings` | R/W | R | Member receives read-only findings. |
| `auditor_access_log` | R | — | External-auditor access metadata is operator-only and function-generated. |
| `auditor_access_tokens` | R/W | — | Bearer-token lifecycle is operator-only. |
| `audits` | R/W | R | Member receives the curated audit register. |
| `control_crosswalks` | R/W | R | Organisation-authored mapping notes are read-only for Members. |
| `evidence` | R/W | R | Member can read metadata but cannot add/supersede evidence. |
| `evidence_links` | R/W | R | Member cannot change evidence/control relationships. |
| `evidence_sources` | R/W | — | Provider configuration and tokens are operator-only. |
| `integration_connections` | R/W | — | GitHub/Jira configuration is operator-only. OAuth rows store only deployment-unique Nango broker references, are bound to the active user/email/workspace tags, remain disabled until a verified strict repo/project target is configured, and never store provider OAuth tokens. Provider/mode/broker identity is immutable; broker uniqueness remains tombstoned after revoke. Removing the configuring user clears provenance without deleting shared configuration. |
| `invitations` | R/W* | — | Owner manages Admin/Member invites; Admin manages Member invites only. Writes use invitation RPCs. |
| `kpi_measurements` | R/W | R | Member receives read-only measurements. |
| `kpis` | R/W | R | Member receives read-only KPI definitions and results. |
| `leadership_report_snapshots` | R | R | Immutable, exact published report payloads; only operators publish through `publish_leadership_report`. |
| `memberships` | R/W* | R | Owner manages elevated roles; Admin may update/remove ordinary Members only. Member has no write. |
| `monitor_sources` | R/W | — | Monitoring configuration is operator-only. An enabled GitHub OAuth connection owns a linked OAuth monitor source with no provider token; only the parent can enable, disable, or revoke it, and workers resolve configuration/broker references from that active same-tenant parent. Sandbox sources remain independently manageable and fake. Removing a configuring user clears provenance without deleting sources. Disabled sources neither run nor appear in Member summaries. |
| `monitoring_findings` | R/U | R | Monitoring worker inserts; operators resolve/update; Members read active findings. |
| `notifications` | own R/U | own R/U | Every role may read its own notifications and update its own read state only. |
| `policies` | R/W | approved R | Members cannot see draft, in-review, or archived policies. |
| `policy_acceptances` | organisation R | own R | No direct writes for any authenticated role; `accept_policy` is the only write path. Pre-upgrade rows remain hidden until securely re-accepted and stamped `trusted_at`. |
| `policy_feedback_comments` | R | R | Immutable comments; creation is limited to the guarded create/reply RPCs. |
| `policy_feedback_threads` | R | approved-policy R | Collaboration is limited to approved policies for every role. Operators retain historical read and resolve/reopen access after a policy leaves approved status. |
| `risk_categories` | R/W | R | Member receives read-only risk reference data. |
| `risk_matrix_config` | R/W | R | Member receives the current matrix but cannot reconfigure it. |
| `risk_treatment_plans` | R/W | R | Member receives read-only treatment progress. |
| `risks` | R/W | R | Member receives the curated risk register. |
| `soa_items` | R/W | R | Member receives read-only Statement of Applicability items. |
| `soa_registers` | R/W | R | Draft/successor creation is operator-only. |
| `soa_snapshots` | R/W* | R | Created by `finalise_soa`; finalised snapshots remain immutable. |
| `task_tickets` | R/W | R | External ticket state is read-only for Members. |
| `tasks` | R/C/U | R | Member cannot create, complete, or revise tasks. |
| `trust_center_settings` | R/W | — | Publishing configuration remains operator-only. |

The private `storage.objects` evidence bucket follows the same model: tenant
Members may read evidence objects; only operators may upload. There are no
authenticated update/delete policies for evidence objects.

`storage.objects` is a Supabase-managed exception to the application-owned table
privilege inventory. Supabase requires storage-schema entities to remain owned by
`supabase_storage_admin`; application migrations must not change that ownership
or revoke the platform-managed API grants. ComplianceHub therefore hardens
`TRUNCATE`, `REFERENCES`, and `TRIGGER` on every application-owned `public` table
and its `postgres` default ACL, verifies that no API-executable application
function exposes `TRUNCATE` or storage DDL, and relies on the provider boundary
plus the evidence-object RLS policies for Storage operations.

## Public tables without `organisation_id`

These tables are deliberately classified separately so the direct-column
inventory does not imply they were missed.

| Table(s) | Access rule |
|---|---|
| `organisations` | Members read their organisations. Authenticated onboarding creates a workspace with the caller as Owner; only Owner may directly update workspace identity. |
| `profiles` | A user reads their own profile and colleague profiles; only the user updates their own profile. |
| `assessment_control_mappings`, `catalogue_categories`, `catalogue_questions`, `catalogue_versions`, `control_catalogue_controls`, `control_catalogue_versions`, `controls`, `frameworks`, `requirement_control_mappings`, `requirements`, `task_catalogue_items`, `task_catalogue_versions` | Authenticated read-only reference/catalogue data, limited to published versions where the schema has a publication field. |
| `app_errors`, `rate_limit_counters` | No portal access; internal/service use only. |

## Authenticated mutation RPCs

Postgres `EXECUTE` cannot distinguish application roles because Owner, Admin, and
Member all use the `authenticated` database role. Every operational RPC therefore
performs its organisation-role check inside the function; RLS remains defense in
depth for security-invoker functions.

| Function | Who may mutate | Security rule |
|---|---|---|
| `accept_policy(uuid)` | Any verified current member | Locks an approved policy and current membership, derives user/org/version/time, stamps `trusted_at`, and upserts one authoritative acceptance. |
| `create_policy_feedback(uuid,text,text)` | Any current member on an approved policy | Derives the organisation, policy version, author, and time and creates the thread and first immutable comment atomically. |
| `complete_recurring_task(uuid)` | Operator | Checks the operator before locking/completing and creating the successor. |
| `create_evidence_record(jsonb)` | Operator | Derives the target organisation from the validated payload and checks operator before insert/supersession. |
| `create_soa_draft(uuid,text)` | Operator | Target assessment must belong to an operated organisation. |
| `create_soa_successor(uuid,text)` | Operator | Source snapshot must belong to an operated organisation. |
| `finalise_soa(uuid)` | Operator | Register must belong to an operated organisation; existing completeness/concurrency checks remain. |
| `notify_policy_reaccept(uuid,text)` | Operator | Policy must belong to an operated organisation. |
| `publish_leadership_report(uuid,jsonb)` | Operator | Derives organisation name, publisher, and time; rejects any payload outside the exact bounded `ReadinessReport` shape and inserts an immutable snapshot. |
| `reply_policy_feedback(uuid,text)` | Any current member on an approved policy | Locks the open thread and policy lifecycle, derives author/time, and appends an immutable comment. |
| `save_assessment_response(uuid,uuid,assessment_answer,text,bigint)` | Operator | Assessment must belong to an operated organisation; revision conflict protection remains. |
| `set_policy_feedback_status(uuid,boolean)` | Operator | Locks the thread and atomically resolves or reopens it with trusted resolver metadata. |

### Lifecycle/self-service exceptions

| Function/surface | Caller | Reason |
|---|---|---|
| `create_organisation_with_owner(text,text)` | Authenticated user | Onboarding atomically creates the organisation and its first Owner membership. |
| `issue_invitation(...)` | Owner; Admin for Member role only | Invitation lifecycle and role delegation. Owner invitations are impossible. |
| `resend_invitation(...)`, `revoke_invitation(uuid)`, `record_invitation_delivery(...)` | Owner; Admin for Member invitations only | Same locked role-delegation rules as issue. |
| `accept_invitation(text)` | Verified invited account | Email-bound, token-gated membership creation; not an operational Member write. |
| `notifications` update policy | Any role, own row only | Allows a user to mark their own notification read. |
| `profiles` update policy | Any role, own row only | Allows self-service profile maintenance. |
| delegated `memberships` policies | Owner; Admin over ordinary Members only | Owner retains elevated-role/ownership control while Admin handles ordinary membership operations. |

The invitation functions are intentionally not rewritten by the operational
hardening migration. Their row locks, verified-email checks, role limits, and
narrow grants remain covered by database tests `042` through `046`. Onboarding,
delegation, and own-notification behavior are also covered by `009`, `042`, and
the lifecycle assertions in `047`.

### Token-gated and service-only side effects

- `audit_view_for_token(text)` is the public auditor read path and records an
  access-log event after validating the bearer token. It is not a portal write.
- `increment_rate_limit(text,integer)` is executable only by `service_role`.
- Trigger functions (`capture_audit_event`, immutable guards, seed triggers) are
  internal mutation mechanisms, not authenticated application APIs.
