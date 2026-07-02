# ComplianceHub v2 — From Readiness Snapshot to Compliance Operating Loop

**Date:** 2026-07-02
**Status:** Draft for review
**Owner:** Mukta Choudhury

## 1. Vision

ComplianceHub v1 answers "how ready were you on the day you completed the assessment?" v2 answers "how ready are you right now?" — the core value proposition of platforms like Vanta and Drata, scaled to what one small team can build and run on Next.js + Supabase.

The product loop v2 creates:

```
assess → identify gaps → assign tasks → attach evidence → evidence ages →
automation flags drift → tasks regenerate → dashboard reflects live posture
```

Direction decisions already made:

- **Workflow automation first.** Recurring tasks, review reminders, evidence expiry, and control-drift flags — buildable now with Supabase + cron. Third-party integrations (GitHub, Google Workspace) are a later horizon, not this plan.
- **UK-first, multi-framework roadmap.** ISO 27001:2022 stays the backbone; UK GDPR (as amended by the Data (Use and Access) Act 2025) and AI governance (ISO/IEC 42001 with an EU AI Act overlay) follow as framework modules on a shared control library (§3a). Cyber Essentials remains a future option on the same model.
- **Top three modules:** evidence vault, policy management, asset + vendor registers. People & training deferred.
- **AI assistance as a later phase**, behind a feature flag, never auto-publishing.

## 2. Research inputs

- **ISO-27001-2022-Toolkit (PehanIn)** — 12 artifact areas: gap assessment, SoA, risk register, scope/context, asset inventory, BC/DR, policies & procedures, awareness/training, management review, ISMS checklists, internal audit plan, ROI. v1 already covers gap assessment, SoA, and risk register; v2 adds evidence, policies, assets/vendors, and a management-review export. Scope/context, BC/DR, training, internal audit, and ROI remain future modules.
- **Vanta / Drata** — their differentiators are continuous control monitoring, automated evidence collection from integrations, task/remediation workflows, policy management with employee acceptance, vendor risk, and trust centers. v2 adopts the *workflow* half of that list; the *integration* half is deferred.
- **Open-source rivals (Probo, Comp AI)** — validate the demand for a self-hostable alternative; Comp AI's AI policy editor is the model for the deferred AI phase.

## 3. Architecture principles (unchanged from v1)

- Modular monolith: Next.js App Router + Supabase (Postgres, Auth, Storage). No new services.
- Every tenant row carries `organisation_id` and is protected by RLS with cross-tenant attack tests.
- Domain logic lives in framework-independent TypeScript under `src/features/<module>/domain|application`, test-first.
- Immutable things stay immutable: catalogue versions, final SoA snapshots, audit events — and now evidence records and policy versions.
- Never expose the service-role key to browser code. Assessment content and policy templates are original, independently written.

## 3a. Framework-agnostic control library (decided in Phase 1, load-bearing for everything after)

v1 hardcodes ISO Annex A references (`control_ref`) throughout. Multi-framework support requires the "common controls" model used by Vanta/Drata:

- `frameworks` (versioned, immutable catalogues): ISO 27001:2022 now; UK GDPR and ISO 42001 later.
- `requirements`: the clauses/articles of a framework (e.g. an Annex A control, a UK GDPR article obligation, a 42001 clause).
- `controls`: the shared, framework-neutral library of things an organisation actually does ("MFA enforced", "access reviewed quarterly", "processing records maintained").
- `requirement_control_mappings`: many-to-many. One control satisfies requirements across several frameworks; evidence, tasks, and policies attach to **controls**, so satisfying work is done once and counted everywhere.

Phase 1 ships this schema with ISO 27001 as the only framework populated (existing `control_ref` usage migrates onto it). The cost now is one layer of indirection; the payoff is that adding UK GDPR or ISO 42001 becomes a content exercise (author the catalogue + mappings) instead of a schema rewrite.

## 4. Phase 1 — Workflow automation core

The backbone. Three units that together make posture *live*.

### 4.1 Tasks & remediation engine (`src/features/tasks`)

- `tasks` table: `organisation_id`, `title`, `detail`, `status` (`open | in_progress | done | cancelled`), `owner_membership_id`, `due_on`, `recurrence` (null or `RRULE`-lite: `weekly | monthly | quarterly | annually`), `source` (`manual | gap | evidence_expiry | policy_review | system`), and optional links: `control_ref`, `risk_id`, `evidence_id`, `policy_id`.
- Gap-to-task: from the assessment gaps view, one click creates a pre-filled task per gap (same pattern as the existing gap-to-risk suggestion).
- Recurring tasks: when a recurring task is completed, the application layer creates the next occurrence (`due_on` advanced by the recurrence interval). No background scheduler needed for regeneration — it happens at completion time; the cron job (4.3) only flags overdue work.
- Compliance calendar seed: an optional starter set of recurring tasks (access review quarterly, policy review annually, backup restore test semi-annually) the user can accept during onboarding. Original content, stored as a versioned catalogue like the assessment.
- UI: `/app/tasks` list with filters (status, owner, overdue), task detail, and task widgets on the dashboard and on each control/risk page.

### 4.2 Evidence vault (`src/features/evidence`)

- `evidence` table: `organisation_id`, `title`, `kind` (`file | link | note`), `storage_path` (Supabase Storage, private bucket, per-org prefix) or `url`, `description`, `owner_membership_id`, `collected_on`, `valid_until` (nullable), `review_interval` (nullable), `status` (`current | expiring | expired`, derived), immutable after creation except status metadata; superseding evidence creates a new record linked via `replaces_evidence_id`.
- `evidence_links` join table: evidence ↔ (`control_ref` | `risk_id` | `task_id` | `policy_id`). One item of evidence can satisfy several controls.
- Storage: new private Supabase Storage bucket `evidence`, RLS-scoped by organisation prefix; signed URLs for download; 25 MB per file limit; allowed types: pdf, png, jpg, docx, xlsx, csv, txt.
- Control pages and the SoA view show evidence count and freshness per control ("2 items, 1 expiring in 14 days").
- Deletion policy: evidence is never hard-deleted; it can be marked `superseded` or `withdrawn` (audit event written). Keeps the audit trail honest.

### 4.3 Scheduled automation + notifications (`src/features/automation`)

- Route `POST /api/cron/daily`, authenticated with the existing `CRON_SECRET` env var (already provisioned in `.env.example` — currently unused). Triggered by Vercel Cron in production; runnable manually in dev.
- Daily sweep (idempotent, all writes audited):
  1. Evidence with `valid_until` within 30 days → status `expiring`; past → `expired`; creates a linked task (`source: evidence_expiry`) if none open.
  2. Tasks past `due_on` → flagged overdue (derived in queries; sweep writes a notification, not a status mutation).
  3. Controls whose linked evidence is all expired, or with open overdue tasks → surfaced in a "needs attention" dashboard queue.
- `notifications` table: `organisation_id`, `membership_id`, `kind`, `subject_ref`, `read_at`. In-app notification bell only in this plan; email digests are deferred to the future horizon (§9) because production email needs an SMTP/Resend provider decision.

**Phase 1 exit criteria:** a gap can be turned into an owned, dated task; evidence can be attached to a control and expires visibly; the daily cron demonstrably moves statuses and raises notifications; all covered by unit + RLS + e2e tests.

## 5. Phase 2 — Policy management (`src/features/policies`)

- `policies` table (per org): `title`, `control_refs`, `status` (`draft | in_review | approved | retired`), `owner_membership_id`, `review_due_on`.
- `policy_versions` table: immutable numbered versions, markdown body, `created_by`, `approved_by`, `approved_on`. Editing an approved policy creates a new draft version; approval is restricted to owner/admin roles.
- `policy_acknowledgements` table: `policy_version_id`, `membership_id`, `acknowledged_at`. Members see a "policies to acknowledge" queue; admins see acceptance percentage per policy.
- Template catalogue: 6–8 original, independently written starter policies (information security, access control, acceptable use, incident response, supplier security, data protection, business continuity summary, secure development). Same versioned-catalogue pattern and content-methodology constraints as the assessment: no ISO text reproduction.
- Policy ↔ compliance loop: an approved, in-date policy automatically counts as evidence (`kind: policy`) for its mapped controls; a policy past `review_due_on` degrades to `expiring` and spawns a review task.
- Export: approved policies render to PDF/DOCX through the existing export pipeline.

## 6. Phase 3 — Asset & vendor registers

### 6.1 Assets (`src/features/assets`)

- `assets` table: `name`, `category` (`information | hardware | software | service | people | site`), `classification` (`public | internal | confidential | restricted`), `owner_membership_id`, `location`, `criticality` (1–5), `notes`, `status`.
- Risk linkage: risks gain an optional `asset_id`. The risk creation flow can start from an asset ("what could go wrong with this?") — upgrading the register to a proper asset-based risk methodology, the approach auditors expect.
- CSV import for initial population (validated with zod, capped rows, template download).

### 6.2 Vendors (`src/features/vendors`)

- `vendors` table: `name`, `service_description`, `data_shared` (`none | internal | personal | special_category`), `criticality`, `owner_membership_id`, `review_interval`, `next_review_on`, `status` (`active | offboarding | exited`).
- Vendor reviews are recurring tasks (`source: system`); contracts/DPAs attach as evidence linked to supplier controls.
- Vendor list view doubles as the supplier-security answer for the SoA supplier controls.

## 7. Phase 4 — Continuous readiness & reporting

- **Live readiness model** (`src/features/readiness`, pure domain logic): control status becomes a function of (latest assessment answer, evidence freshness, open remediation tasks, mapped policy state). Deterministic, unit-tested, explainable — each control shows *why* it has its status. Dashboard headline becomes "readiness now" with a trend sparkline (daily snapshot row written by the cron sweep).
- **Management review pack**: one-click PDF/DOCX export assembling posture summary, top risks, overdue tasks, evidence gaps, policy acceptance — the toolkit's "Management Review Meeting" artifact, generated instead of hand-written. Reuses the finalised-snapshot export pattern.

## 7a. Phase 5 — UK GDPR framework module

Every UK business is subject to UK GDPR already, so this is the widest-audience framework after ISO. Built on the §3a model: a UK GDPR requirements catalogue (original plain-English summaries of obligations, ICO-aligned, DUAA 2025-aware — never reproducing legal text) mapped onto the shared control library, plus the privacy-specific registers the ICO expects:

- **Records of processing (RoPA)**: processing activities register (purpose, lawful basis, data categories, recipients, retention) — reuses the register UI patterns from assets/vendors.
- **DPIA workflow**: screening questions → full assessment → sign-off, stored as immutable versions like policies.
- **Data-subject request tracker**: request log with statutory clocks (task engine drives the deadlines).
- **Breach log**: incident record with the 72-hour assessment trail.

Existing machinery reused: evidence attaches to privacy controls, policies cover privacy notices, vendors register doubles as the processors list.

## 7b. Phase 6 — AI governance module (ISO/IEC 42001 + EU AI Act overlay)

The UK has no AI statute (regulator-led approach; an AI Bill remains pending as of mid-2026), so the certifiable, procurement-driven framework is ISO/IEC 42001. Shipped as: a 42001 requirements catalogue on the shared control library, an AI system inventory (extends the asset register with model/provider/purpose/risk fields), and an **EU AI Act overlay** — a mapping layer that classifies inventoried AI systems (prohibited/high-risk/limited/minimal) and shows which 42001-mapped controls also serve AI Act obligations, relevant to tenants selling into the EU (high-risk deadline deferred to December 2027 by the Digital Omnibus). The overlay is mappings and content, not a separate module.

Sequencing note: Phases 5 and 6 are deliberately swappable — both are catalogue + registers on the §3a model. GDPR is first because its audience is universal in the UK; flip them if AI-governance demand arrives sooner.

## 8. Phase 7 — AI assistance (feature-flagged)

- Capabilities: draft a policy from a plain-English description; suggest risk treatments for a gap; explain a control in context. Uses the Claude API server-side.
- Guardrails: flag-off by default per organisation; AI output always lands as a *draft* requiring human approval; prompts send the minimum context (control text, user's description — never member PII or evidence file contents); every AI generation writes an audit event. These constraints align with the repo's privacy-review tooling.
- Not started until Phases 1–2 are shipped: AI drafting needs the policy data model to exist.

## 9. Explicitly deferred (future horizon, not in this plan)

- Third-party integrations for automated evidence (GitHub first: MFA, branch protection — highest value/effort ratio when the time comes).
- Trust center (public posture page), people & training module, internal audit module, BC/DR planning, scope/context builder, Cyber Essentials framework (fits the §3a model when wanted), email digests/SMTP, billing/SaaS.

## 10. Cross-cutting requirements

- Every new table: RLS + cross-tenant attack tests (`supabase/tests/database/`), immutability invariants where declared, audit events on all mutations.
- Every module: domain logic test-first (vitest), at least one e2e journey (Playwright), demo-mode variant with sample data so the public demo shows the full loop.
- Accessibility: all new pages pass the existing axe e2e gate.
- Migrations follow the numbered-SQL pattern; no destructive changes to shipped tables.
- Catalogue/policy content follows `docs/content-methodology.md`: original, owner-reviewed, no standard-text reproduction.

## 11. Sequencing rationale and risks

Phase 1 before 2: policies-as-evidence needs the evidence vault; tasks are the substrate for every later "automation" behaviour, and the §3a control library must land here because every later phase builds on it. Phase 3 is independent of 2 and could swap earlier if register demand is higher. Phase 4 needs 1–3's signals to be meaningful. Phases 5 and 6 (UK GDPR, AI governance) are content-plus-registers on the shared model and mutually swappable. AI assistance (Phase 7) last by explicit decision.

Main risks: (a) scope creep — each phase is shippable alone; stop-points are real; (b) storage security — evidence bucket must get the same RLS attack-test rigour as tables; (c) content workload — policy templates are writing-heavy, not code-heavy; schedule them as content tasks; (d) readiness-model credibility — keep the scoring explainable, never a black box.

## 12. Success criteria for v2 overall

- A new organisation can go from sign-up to: assessment done, gaps converted to owned tasks, evidence attached to its top controls, starter policies approved and acknowledged — inside one session.
- Thirty days later, without anyone logging in, the daily sweep has flagged aged evidence and overdue reviews, and the dashboard readiness reflects that drift.
- A management review pack can be exported that an external reviewer recognises as audit-preparation-grade.
