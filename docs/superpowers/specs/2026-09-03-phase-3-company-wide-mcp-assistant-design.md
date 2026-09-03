# Phase 3 — Company-Wide MCP Compliance Assistant Design

Date: 2026-09-03
Status: User approved
Owner: ComplianceHub

## Objective

Turn the existing OAuth-protected ComplianceHub MCP server into a tenant-scoped, company-wide compliance assistant for Codex and ChatGPT. The assistant reads every useful, authorized business-compliance domain on demand, explains the recorded posture, prioritizes problems, and recommends evidence-linked remediation without silently changing ComplianceHub, GitHub, Slack, or any connected system.

## User outcome

An authorized user can ask questions such as:

- What is our recorded ISO 27001 posture and what is that indicator based on?
- What are our five most important problems and why?
- Which assessment gaps affect our Statement of Applicability?
- Which applicable controls lack current evidence?
- Which risks are above appetite and lack a treatment or task?
- Which policies, audits, non-conformities, and KPIs need attention?
- What did the latest GitHub scan prove, fail to prove, or leave unknown?
- What changed since the previous scan or leadership report?
- What should leadership prioritize next week?
- Prepare a concise Slack-ready brief without sending it.

Every answer must distinguish recorded fact, missing data, stale data, unknown state, recommendation, and completed action. No response may imply ISO certification, legal assurance, overall security, or compliance beyond the returned evidence.

## Chosen architecture

### Hybrid fact-and-recommendation model

ComplianceHub supplies closed-world, structured facts and deterministic remediation inputs. Codex or ChatGPT turns those facts into conversational answers. The MCP server does not call an internal language model and does not accept free-form SQL or expose a raw database dump.

This design rejects two alternatives:

1. A raw `read_company_database` dump is unsafe, expensive, difficult to paginate, and would expose implementation tables rather than user goals.
2. A single server-side `ask_compliancehub` language-model endpoint would be opaque, hard to reconcile, and would duplicate the model already present in Codex or ChatGPT.

Tools are grouped by recognizable compliance goals and return stable identifiers for safe follow-up calls. Reads and external writes are separated by resource, scope, consent, and tool advertisement.

### Safe company-data coverage

“Every company database area” means every useful authorized business-compliance view, not every physical table or column.

Required read coverage:

- organisation scope and framework coverage;
- assessment sessions, responses, unanswered items, and gaps;
- Statement of Applicability controls, applicability, implementation status, rationale, and review blockers;
- evidence inventory, lifecycle, control links, provenance, and freshness;
- risks, inherent and residual scoring, appetite, treatments, reviews, and linked work;
- tasks, remediation state, due dates, provenance, and relationships;
- policies, lifecycle, review state, acceptance coverage, and safe feedback state;
- audits, checklist progress, findings, non-conformities, and corrective-action state;
- KPIs, measurements, targets, trend direction, and stale or breached values;
- assets, classifications, scope membership, and linked risks;
- monitoring findings, source health, lifecycle, and remediation state;
- official GitHub results, selected repositories, collection health, mappings, freshness, evidence, findings, and approved remediation;
- integration, automation, notification, trust-centre, leadership-report, and recent-change summaries.

Prohibited output:

- OAuth states, authorization codes, access or refresh tokens;
- GitHub private keys, installation tokens, raw provider payloads, or webhook bodies;
- Slack webhook URLs, channel secrets, or arbitrary destinations;
- database credentials, encryption material, rate-limit state, or internal errors;
- private auditor tokens, raw evidence file bodies, storage URLs, or unnecessary person-level fields;
- service-role-only implementation records.

Sensitive operational state may be represented only by a safe derived health value such as connected, disconnected, healthy, stale, or failed.

## Tool surface

The existing safe reads remain, with precise language and common metadata. The company-wide surface adds focused tools:

1. `get_company_compliance_snapshot` — cross-domain posture, coverage, freshness, limitations, and latest baselines.
2. `list_assessment_and_soa_gaps` — assessment gaps and affected SoA/control decisions.
3. `list_risks_and_remediation_work` — risks, treatments, tasks, owners as safe role labels, due state, and relationships.
4. `list_evidence_and_control_coverage` — evidence lifecycle, control links, missing coverage, and provenance.
5. `list_governance_records` — policy, audit, non-conformity, KPI, and acceptance state.
6. `get_scope_assets_and_framework_coverage` — declared scope, assets, asset risks, frameworks, requirements, and mappings.
7. `get_monitoring_and_integration_health` — monitoring, GitHub, collection, integration, automation, and notification health without secrets.
8. `list_recent_compliance_changes` — safe, bounded business changes with an explicit baseline.
9. `analyze_compliance_gaps` — deterministic prioritized issues and recommendation-only remediation.

Every list is bounded and reports completeness. Pagination begins without a cursor and is exhaustive only after following each exact bound cursor to `null` using the same workspace and filters. A detail follow-up returns safe fields and relationships for a stable record reference; it never treats a client-supplied identifier as authority.

## Common response contract

Every successful read result uses contract version `3` and includes:

- canonical data origin;
- selected workspace and caller-visible role;
- `asOf` and source timestamps;
- freshness or lifecycle state;
- coverage, truncation, and pagination truth;
- stable source and relationship references;
- explicit limitations and non-certification wording.

The server fails closed if its structured output does not match its declared schema. Legacy clients receive the same safe serialized structured payload in `content`; newer clients also receive `structuredContent`.

Readiness language must name the exact metric. For example, “recorded SoA implementation indicator is 43%” is acceptable; “the company is 43% compliant” is not.

## Recommendation contract

`analyze_compliance_gaps` returns deterministic, model-ready problem cards containing:

- priority and severity;
- stable reason code and ranking inputs;
- plain-language problem statement and why it matters;
- framework, requirement, control, and supporting-record references;
- freshness and missing-data warnings;
- approved or catalogue-backed remediation guidance;
- suggested sequence and effort band;
- `recommendationOnly: true`;
- `requiresApproval: true`.

Recommendations never claim an action was completed. Phase 3 adds no task creation, record update, policy edit, finding resolution, GitHub mutation, or Slack delivery action.

## Authorization and transport

- All company reads run with the signed-in user token and database row-level security.
- Workspace membership is verified independently of caller-supplied identifiers.
- Anonymous and cross-tenant calls fail without disclosing whether a target exists.
- Phase 3 advertises only read and recommendation tools on its normal resource.
- Slack delivery is isolated to Phase 4 behind explicit delivery authority and consent; the existing write is not advertised to Phase 3 clients.
- The server supports the current MCP `2026-07-28` stateless protocol and the required legacy `2025-11-25` flow through supported SDK entry points.
- Browser-origin requests use an exact configured allowlist. Hostile and `null` origins are rejected before MCP handling, while legitimate non-browser clients may omit `Origin`.
- Production uses a public HTTPS endpoint or OpenAI Secure MCP Tunnel. Loopback HTTP is allowed only in a verified local-development environment.

## Client guidance

The MCP provides reusable prompts for:

- `ceo_compliance_brief`;
- `compliance_officer_gap_review`;
- `audit_readiness_review`;
- `remediation_plan`.

Static status meanings, supported frameworks, and approved guidance may be exposed as read-only resources. Live company data remains tool-driven so authorization, freshness, pagination, and auditability remain explicit.

Server instructions begin with tenant-scoped truth, canonical data source, freshness, completeness, recommendation-only behavior, and non-certification limits. Slack-specific behavior is outside the Phase 3 read resource.

## Visual reference

The web application remains the human reference surface. Settings gains an “AI assistant” section showing:

- MCP connection status and endpoint type;
- read-only/recommendation-only status;
- company-data coverage by business area;
- connected AI applications;
- supported example questions;
- last verified proof time and result when a real proof artifact exists.

The UI never fabricates a live verification timestamp. MCP results used in proof must reconcile with the corresponding Dashboard, Assessment, SoA, Evidence, Risks, Tasks, Policies, Audits, KPIs, Scope, Connections, Monitoring, and Leadership views.

## Delivery sequence

### Phase 3.0 — foundation correction

1. Align the real local MCP audience and Codex configuration with application port `3100`.
2. Upgrade to supported current MCP SDK packages and preserve required legacy compatibility.
3. Add exact origin protection and compatibility tests.
4. Separate Phase 3 read advertisement from Slack delivery authority.
5. Re-run the Phase 2 OAuth/GitHub proof without altering its historical artifact.

### Phase 3.1 — company-wide read model

1. Approve the domain, field, role, and sensitivity matrix in code and tests.
2. Add RLS-scoped database read functions and bounded application services.
3. Register the focused tools and common response envelope.
4. Prove anonymous and cross-tenant denial, output allowlists, pagination, and zero writes.

### Phase 3.2 — explain and prioritize

1. Add deterministic gap classification and priority ordering.
2. Link every recommendation to returned evidence and approved guidance.
3. Add missing/stale/unknown and non-certification adversarial tests.
4. Prove all output remains recommendation-only.

### Phase 3.3 — client usability and visual status

1. Add reusable prompts/resources and improve tool-selection descriptions.
2. Update plugin metadata and connection documentation.
3. Add the AI assistant status and coverage panel to Settings.
4. Reconcile visible demo values with MCP facts.

### Phase 3.4 — acceptance proof

1. Run direct, indirect, follow-up, refusal, unsupported, empty, invalid, and cross-tenant evaluations.
2. Exercise current and legacy protocol clients through OAuth discovery, tool listing, calls, errors, and pagination.
3. Run a real local Codex MCP conversation.
4. Test ChatGPT through a secure tunnel or HTTPS endpoint when the account permits developer-mode connection.
5. Capture redaction-safe terminal artifacts and application screenshots.
6. Run complete unit, database, integration, lint, type, build, browser, privacy, and protected-state gates.

## Completion criteria

Phase 3 is complete only when:

- every required business domain has an authorized MCP read path;
- every new tool is bounded, schema-validated, tenant-scoped, and read-only;
- current and legacy client proofs pass;
- local Codex answers the evaluation questions using MCP facts;
- ChatGPT compatibility is proven through secure developer-mode connection or is reported as the single exact external account/tunnel blocker;
- MCP facts reconcile with independent database projections and visible pages;
- no protected database, GitHub, Slack, or external state changes during Phase 3 proof;
- screenshots and machine-readable proof artifacts are saved;
- implementer reports DONE, reviewer reports APPROVED, and supervisor reports GO.

## Phase boundary

Phase 4 owns Slack mention/event handling, Slack OAuth and channel installation, delivery confirmation, scheduling, idempotency, retries, unknown-delivery recovery, and external Slack network calls. Phase 3 may prepare a Slack-ready answer payload but never sends it.

## Reference basis

- OpenAI, “Define tools” — goal-oriented tools, explicit contracts, separated read/write behavior, safe output, and accurate annotations.
- OpenAI, “Build an MCP server” — supported SDK, server instructions, structured schemas, authorization, and Streamable HTTP.
- OpenAI, “Connect and test your plugin” — HTTPS or Secure MCP Tunnel, Inspector checks, and representative client evaluations.
- Model Context Protocol `2026-07-28` specification and TypeScript SDK v2 migration guidance.

