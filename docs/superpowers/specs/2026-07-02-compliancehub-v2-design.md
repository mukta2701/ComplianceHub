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
- **ISO 27001:2022 only, deeper.** No second framework yet. Cyber Essentials is recorded as a future option.
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

## 8. Phase 5 — AI assistance (feature-flagged)

- Capabilities: draft a policy from a plain-English description; suggest risk treatments for a gap; explain a control in context. Uses the Claude API server-side.
- Guardrails: flag-off by default per organisation; AI output always lands as a *draft* requiring human approval; prompts send the minimum context (control text, user's description — never member PII or evidence file contents); every AI generation writes an audit event. These constraints align with the repo's privacy-review tooling.
- Not started until Phases 1–2 are shipped: AI drafting needs the policy data model to exist.

## 9. Explicitly deferred (future horizon, not in this plan)

- Third-party integrations for automated evidence (GitHub first: MFA, branch protection — highest value/effort ratio when the time comes).
- Trust center (public posture page), people & training module, internal audit module, BC/DR planning, scope/context builder, Cyber Essentials framework, email digests/SMTP, billing/SaaS.

## 10. Cross-cutting requirements

- Every new table: RLS + cross-tenant attack tests (`supabase/tests/database/`), immutability invariants where declared, audit events on all mutations.
- Every module: domain logic test-first (vitest), at least one e2e journey (Playwright), demo-mode variant with sample data so the public demo shows the full loop.
- Accessibility: all new pages pass the existing axe e2e gate.
- Migrations follow the numbered-SQL pattern; no destructive changes to shipped tables.
- Catalogue/policy content follows `docs/content-methodology.md`: original, owner-reviewed, no standard-text reproduction.

## 11. Sequencing rationale and risks

Phase 1 before 2: policies-as-evidence needs the evidence vault; tasks are the substrate for every later "automation" behaviour. Phase 3 is independent of 2 and could swap earlier if register demand is higher. Phase 4 needs 1–3's signals to be meaningful. Phase 5 last by explicit decision.

Main risks: (a) scope creep — each phase is shippable alone; stop-points are real; (b) storage security — evidence bucket must get the same RLS attack-test rigour as tables; (c) content workload — policy templates are writing-heavy, not code-heavy; schedule them as content tasks; (d) readiness-model credibility — keep the scoring explainable, never a black box.

## 12. Success criteria for v2 overall

- A new organisation can go from sign-up to: assessment done, gaps converted to owned tasks, evidence attached to its top controls, starter policies approved and acknowledged — inside one session.
- Thirty days later, without anyone logging in, the daily sweep has flagged aged evidence and overdue reviews, and the dashboard readiness reflects that drift.
- A management review pack can be exported that an external reviewer recognises as audit-preparation-grade.
