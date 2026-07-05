# Phase C — Run the Audit (Design Spec)

**Date:** 2026-07-06
**Status:** Draft for founder review
**Parent roadmap:** `2026-07-05-product-roadmap-v3.md` §Phase C (approved, order B → C → D).
**Ground truth:** `.superpowers/research/iso-toolkit-structures.md` §4 (Internal Audit Checklist), §6 (Management Review / Performance Measurement), and the Internal Audit Plan .docx methodology summary.
**Binding:** v2 §10 — RLS + pgTAP attack tests (all 4 cross-tenant verbs) on every new tenant table; tenant-validation + audit triggers; domain-first testing; e2e + axe (zero violations); en-GB; ORIGINAL content (no toolkit text verbatim). Presentation matches the Phase A design system (fragments, single h1, `PageIntro`/`Card`/`Pill`/`Stat`). Findings/corrective actions reuse the existing tasks engine — no parallel task machinery.

## Goal

Run the ISO 27001 internal audit inside ComplianceHub instead of spreadsheets: schedule audits, work a clause/control checklist, log findings/non-conformities that become owned remediation tasks, track KPIs for management review, produce a leadership readiness report + an audit evidence pack, and give an external auditor a time-boxed read-only view. Exit criterion: a full internal audit can be planned, executed, reported, and followed to closure in-app.

## Decisions (locked for this spec; revisable at review)

1. **Auditor access = a time-boxed, read-only shareable link — NOT a new auth role.** The roadmap's non-goal is explicit ("no full auditor portal; a time-boxed read-only link suffices"). We add NO new membership role (keep owner/member). Instead, an owner mints an `auditor_access` token (random, hashed-at-rest, with an `expires_at` and a `framework`/scope) that grants an **unauthenticated** visitor read-only access to a curated audit view (the readiness report + finalised evidence pack + the selected audit's checklist/findings) at `/audit-view/<token>`. No write paths, no app login, auto-expires. This mirrors the existing invitation-token pattern but is read-only and app-login-free.

2. **Findings/non-conformities spawn tasks via the existing engine.** A finding with a corrective action creates a linked `task` (owner = responsible person, `source = 'audit'` — add this value to the `task_source` enum in its own isolated migration, per the Phase B enum-ordering rule). No new remediation machinery.

3. **KPI log is a light flat register** (per the toolkit) — indicator, measurement type, threshold, observations, next steps → optional task. No computed scoring/RAG (the toolkit has none).

## Scope — four workstreams

### C1. Internal audit module (`src/features/audits`)

- New table `public.audits`: `id`, `organisation_id`, `reference` (e.g. `AUD-001`), `title`, `scope` (text), `status` (enum `audit_status`: `planned/in_progress/reporting/closed`), `lead_auditor_id → memberships` (composite tenant FK), `planned_start date`, `planned_end date`, `framework` (text, default 'ISO 27001:2022'), timestamps, `created_by`. Split RLS, tenant + audit triggers, pgTAP attack tests (all 4 verbs).
- New table `public.audit_checklist_items` (the toolkit's 9-column checklist, one row per item): `id`, `organisation_id`, `audit_id → audits` (composite tenant FK), `area` (text — Audit Area/Process), `clause_reference` (text — mixes main-clause + Annex A refs), `checklist_item` (text — the question), `control_id → controls(id)` (nullable — link to the control library when the ref maps), `compliant` (enum `checklist_result`: `compliant/non_compliant/not_applicable/not_tested`, default `not_tested`), `evidence_note` (text), `findings` (text), `responsible_id → memberships` (nullable composite FK), `reviewed_on date`, `position int`. Split RLS + triggers + attack tests.
- New table `public.audit_findings`: `id`, `organisation_id`, `audit_id → audits`, `checklist_item_id → audit_checklist_items` (nullable), `summary` (text), `severity` (enum `finding_severity`: `observation/minor_nc/major_nc`), `root_cause` (text), `corrective_action` (text), `task_id → tasks(id)` (nullable — the spawned remediation task), `status` (enum `finding_status`: `open/in_progress/closed`), timestamps, `created_by`. Split RLS + triggers + attack tests.
- Evidence per checklist item: reference existing `evidence` via a link (reuse the `evidence_links` pattern, adding an `audit_checklist_item_id` nullable column to `evidence_links`, or a small `audit_evidence_links` table — decide in the plan; prefer extending `evidence_links` if its RLS/shape allows cleanly).
- Domain module + tests (audit status roll-up, checklist completion %, finding severity summary). Server actions. Pages: `/app/audits` (list + stat row: open audits, open findings, non-conformities), `/app/audits/new`, `/app/audits/[id]` (detail: metadata, checklist table with inline result/finding controls, findings list with "raise corrective-action task"). Nav entry. e2e + axe.

### C2. Management review / KPI log (`src/features/kpis`, light)

- New table `public.kpis`: `id`, `organisation_id`, `control_function` (text), `indicator` (text), `measurement_type` (enum `measurement_type`: `automatic/manual/external`), `threshold` (text — free-form target), `observations` (text), `next_steps` (text), `responsible_id → memberships` (nullable), `last_reviewed date`, `task_id → tasks(id)` (nullable), timestamps, `created_by`. Split RLS + triggers + attack tests.
- Domain (measurement-type labels; a simple "needs-review" heuristic if `last_reviewed` is stale — optional). Server actions. Pages: `/app/kpis` (list + new/inline edit); "raise task from next steps" reuses the tasks engine. Nav entry. e2e + axe.

### C3. Reporting

- **Leadership readiness report** (`/app/reports/readiness`, and a print/PDF export reusing the existing SoA snapshot PDF/DOCX route pattern in `src/app/api/app/soa/[id]/...`): framework coverage (SoA implementation-status breakdown via the Phase B `soaReadinessWeight`), risk posture (RAG band distribution from `risk_matrix_config`), task health (open/overdue), evidence health (current/expiring/expired via `summariseEvidenceFreshness`), audit status + open non-conformities. All read-only aggregation via RLS-scoped queries — no new tables.
- **Audit evidence pack export**: for a selected audit, a bundled export (XLSX/CSV via the Phase B `exports` helper, or a PDF) of the checklist + findings + linked evidence references. Route `GET /api/app/audits/[id]/pack?format=…`, RLS-scoped, tenant-safe.

### C4. Auditor access (time-boxed read-only link)

- New table `public.auditor_access_tokens`: `id`, `organisation_id`, `token_hash` (text — store a hash, never the raw token), `label` (text), `audit_id → audits` (nullable — scope to one audit or the whole org readiness view), `framework` (text), `expires_at timestamptz`, `created_by`, `created_at`, `revoked_at` (nullable). Split RLS (only owners of the org can create/list/revoke; the token itself is validated server-side, not via RLS).
- **Public read-only view** at `/audit-view/[token]` (outside the authenticated app group): a server component that renders the read-only view by calling a SINGLE dedicated `security definer` RPC `public.audit_view_for_token(raw_token text)`. That function hashes the input, looks the token up, rejects it if not found / `expires_at` passed / `revoked_at` set (returning null), and otherwise returns ONLY the report/pack payload for exactly that token's `organisation_id` (+ scoped `audit_id` if set) — the readiness aggregates, the scoped audit's checklist/findings, and finalised evidence references. NO write controls, NO app nav, NO login. This is the ONE sanctioned narrow use of `security definer` for reads (an unauthenticated visitor has no RLS identity); it is token-gated, org-scoped inside the function body (every internal query filtered by the resolved `organisation_id`), returns no other tenant's data by construction, and is NOT the service-role client. Do NOT use the service-role client anywhere in the public view. Rate-limited; token lookups constant-time-ish (hash compare).
- Owner UI: a "Share with auditor" panel in `/app/audits/[id]` (or settings) to mint (show the raw token/link ONCE), list, and revoke tokens with their expiry.

## Testing (per v2 §10)
- pgTAP attack tests (all 4 cross-tenant verbs) for `audits`, `audit_checklist_items`, `audit_findings`, `kpis`, `auditor_access_tokens`; plus a test that the auditor-token `security definer` read returns ONLY the token's org data and refuses expired/revoked/unknown tokens.
- Domain unit tests (audit roll-up, checklist %, finding severity, readiness aggregation, measurement-type labels, token expiry logic).
- E2E + axe: plan an audit → work a checklist item → raise a finding → corrective-action task appears in `/app/tasks`; create a KPI → raise task; open the readiness report; mint an auditor link → open `/audit-view/<token>` in a fresh (no-auth) context and see the read-only report, and confirm an expired/revoked token is refused. Zero axe violations on every new page incl. the public audit view.
- Full gate: eslint, tsc, vitest, next build, `supabase test db`, Playwright (chromium + mobile).

## Non-goals (Phase C)
No new membership/auth role; no workflow engine for audits (simple status only); no computed KPI scoring/RAG; no scheduled/recurring audit automation (manual create); no multi-framework beyond a `framework` label; no AI.

## Exit criteria
An internal audit can be planned → checklist executed → findings raised as owned tasks → readiness report + evidence pack produced → an external auditor given a time-boxed read-only link → audit closed. Full test gate green. The auditor-token elevated read is provably scoped to the token's org and refuses expired/revoked tokens.
