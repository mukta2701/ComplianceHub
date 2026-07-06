# Phase B — Kill the Spreadsheets: feature backlog

Phase B took every compliance workflow that a 10–20 person organisation used to run in Excel — the risk register, the Statement of Applicability (SoA) and the asset inventory — and rebuilt each as a first-class, tenant-isolated module with XLSX/CSV export. This document catalogues the nine features that shipped (grounded in the migrations, domain modules, server actions and route handlers actually on the `phase-b-kill-spreadsheets` branch) and proposes realistic, high-value follow-ups. Import with column mapping was deliberately split out to Phase B.5, so it is not catalogued here. Deferred hardening items carried in the SDD ledger are collected at the end.

## Asset inventory

**What shipped:** A new `public.assets` table (migration `202607020016_assets.sql`) with reference, description, `owner_location`, optional `owner_id`, `classification` (`asset_classification` enum: highly_confidential / confidential / internal_use_only / public), `value_criticality` (`asset_value` enum: high / medium / low), `category_id`, security controls, lifespan, last-updated and remarks; backed by the `summariseAssets` domain module and `assetInputSchema` in `src/features/assets/`, per-org seeded `asset_categories`, and the `/app/assets` list (with a stat row), `/app/assets/new`, `/app/assets/[id]` and `/app/assets/[id]/edit` pages.

**Status:** Done

**Suggested improvements:**
- Add saved views plus classification / value / category filters to the asset list so large inventories stay navigable.
- Add bulk actions (re-classify, re-assign owner, delete) to the inventory list to avoid editing assets one at a time.
- Surface asset review staleness derived from `lifespan` / `last_updated` into the dashboard needs-attention queue, so ageing assets prompt a review.

## Asset↔risk linking

**What shipped:** A `public.asset_risks` many-to-many link table (composite `(asset_id, organisation_id)` and `(risk_id, organisation_id)` tenant FKs, audit + split RLS) with link and unlink server actions rendered on the asset detail page (`src/app/app/assets/[id]/page.tsx`), so an asset can be tied to the risks it is exposed to.

**Status:** Done

**Suggested improvements:**
- Show aggregate linked-risk exposure on each asset (e.g. the highest linked residual RAG band) and a linked-asset count on each risk.
- Add bulk asset↔risk linking so several assets can be attached to a risk (and vice versa) in one action.
- Add a coverage-gap view that flags high-value or highly-confidential assets with no linked risks.

## Risk treatment plans (RTPs)

**What shipped:** A `public.risk_treatment_plans` table with an `rtp_status` enum (planned / in_progress / completed / cancelled), reference, summary, treatment measures, optional control reference, assigned lead, and target / actual completion dates; the `summariseRtpProgress` roll-up in `src/features/risks/domain/rtp.ts`; and `createRtpAction` / `updateRtpStatusAction` / `deleteRtpAction` (create optionally spawns a task with `source = 'risk_treatment'`, owner = lead, due = target) surfaced on the new `/app/risks/[id]` detail page.

**Status:** Done

**Suggested improvements:**
- Surface overdue RTPs (past `target_completion` with no `actual_completion`) on the risk detail and the dashboard needs-attention queue.
- Notify the assigned lead as the target date approaches, via the existing notifications channel (email / Slack).
- Roll RTP progress up onto the risk register list (e.g. a "2/3 plans complete" pill), not just the detail page.

## Risk category taxonomy

**What shipped:** A per-workspace `public.risk_categories` table seeded with the toolkit's seven distinct categories (the duplicated vendor entry deduped) and backfilled for existing organisations (migration `202607020010`); the free-text `risks.category` column was migrated to a `category_id` composite FK with no data loss (migration `202607020011`), and the new-risk form now offers a controlled category dropdown.

**Status:** Done

**Suggested improvements:**
- Add a category management screen to rename, reorder, merge and archive categories (currently they are only seeded and backfilled).
- Add a guided "reassign these N risks first" flow before an in-use category can be deleted (the DB restricts the delete; the UI should explain it).
- Add category-level risk roll-up counts and a per-category heatmap to the register.

## Configurable RAG bands + risk appetite

**What shipped:** A `public.risk_matrix_config` table (per-org `low_max` / `moderate_max` / `high_max` thresholds plus an optional `appetite_threshold`, migration `202607020012`) feeding a rewritten `riskBand(score, config)` and `exceedsAppetite(score, config)` in `src/features/risks/domain/risks.ts`; `DEFAULT_RISK_MATRIX_CONFIG` reproduces the legacy hardcoded bands exactly, and a compact RAG-threshold editor plus labelled RAG pills render on the risks page via `config-actions.ts`.

**Status:** Done

**Suggested improvements:**
- Render a 5×5 Likelihood×Impact heatmap coloured by the configured RAG bands, with per-cell risk counts, derived directly from the matrix config.
- Surface an appetite-breach queue that lists every risk whose residual score exceeds the configured appetite.
- Validate thresholds inline (strictly increasing) before submit and record who changed the RAG configuration and when.

## 7-value SoA status

**What shipped:** The 4-value `soa_status` enum was replaced by `public.soa_implementation_status` (pending / absent / in_progress / established / operational / advanced / not_applicable) via a breaking `USING CASE` swap that maps existing rows (migration `202607020015`); the `SoaStatus` TypeScript union and `SOA_STATUS_LABEL` were widened to match, and the SoA review page (`/app/soa/[id]`) now renders a 7-value status select with the applicable/not-applicable check preserved.

**Status:** Done

**Suggested improvements:**
- Add bulk status transitions and keyboard-friendly inline editing so a whole register can be triaged quickly.
- Add a per-control status-change history / timeline beyond the immutable finalised snapshot.
- Add status filters / segments to surface the Pending and Absent backlog at a glance.

## Per-control SoA owner

**What shipped:** `soa_items.owner_id` was added as a composite-FK reference into `memberships` (migration `202607020015`, `on delete set null`); `reviewSoaItemAction` now persists the owner, the SoA review page renders an owner select alongside each control, and the SoA export carries an Owner column resolved via memberships → profiles.

**Status:** Done

**Suggested improvements:**
- Add an SoA owner-workload view grouping controls by owner with counts by status.
- Add bulk owner assignment across a selected group of controls.
- Notify owners of controls still Pending or Absent ahead of an audit deadline.

## SoA readiness weighting

**What shipped:** `src/features/soa/domain/readiness.ts` provides `soaReadinessWeight` (pending / absent 0, in_progress 0.4, established 0.7, operational 0.9, advanced 1; not_applicable returns null and is excluded) and `summariseSoaReadiness`, which weights only applicable items and returns a rounded percent — an original weighting rather than the toolkit's decorative percentages.

**Status:** Done

**Suggested improvements:**
- Surface the weighted readiness percent and its trend on the readiness dashboard and as an audit-pack metric.
- Make the maturity weights configurable per workspace instead of hardcoded.
- Add a readiness breakdown by category and by owner to show where the gaps concentrate.

## XLSX/CSV export for all modules

**What shipped:** A shared `src/features/exports/exports.ts` helper (`toCsv` with RFC 4180 escaping, `toXlsx` via `exceljs@^4.4.0`) feeds thin, RLS-scoped route handlers at `GET /api/app/{risks,soa,assets,tasks,evidence,assessment}/export?format=xlsx|csv`, each emitting toolkit-mirrored column headers with human-readable labels for category, owner, classification, value and status, plus correct content-type and attachment filenames; export buttons are wired into every module.

**Status:** Done

**Suggested improvements:**
- Add an audit-pack export that bundles all registers, the finalised SoA snapshot and the evidence index into a single workbook or zip for auditors.
- Add an XLSX import round-trip (the planned Phase B.5) so exported workbooks re-import cleanly.
- Produce styled, branded XLSX output (formatted header row, sensible column widths, auto-filters) so the export can genuinely replace the workbooks.
- Rate-limit and audit the export route handlers (create actions are already rate-limited; the export endpoints only auth-check).

## Deferred hardening

Small backlog items carried forward in the SDD ledger (`.superpowers/sdd/progress.md`, Phase B section) and the GO-LIVE notes:

- **CSV formula-injection is unmitigated** — the shared `cell()` escaper (`src/features/exports/exports.ts`) quotes commas / quotes / newlines but does not neutralise a leading `=`, `+`, `-` or `@`, so exported free text can execute as a spreadsheet formula (Task 12 minor; security-relevant, also gates the B.5 round-trip).
- **XLSX export test checks the container, not the content** — there is no round-trip read-back assertion on the generated workbook (Task 12 minor).
- **Dual lockfiles / package-manager decision before deploy** — Task 12 created the project's first `package-lock.json` alongside the existing `pnpm-lock.yaml`; both now carry `exceljs`, but a single package manager must be chosen and `pnpm install --frozen-lockfile` verified at deploy (GO-LIVE item).
- **`risk_matrix_config` update policy does not re-assert `updated_by = auth.uid()`** — the server action always sets it, but the RLS with-check does not pin it (Task 3 minor).
- **RTP delete action discards the DB error** — `deleteRtpAction` swallows any delete failure, matching the existing pattern but hiding errors (Task 5 minor).
- **`reviewSoaItemAction` lacks server-side owner-membership re-validation** — the composite FK backstops it and the UI is unreachable for a non-member, but there is no explicit server check (Task 7 minor).
- **Asset link/unlink actions lack an empty-id guard** — the form is always valid today, but the actions do not defensively guard a blank id (Task 11 minor).
- **Category-backfill `dense_rank` position collision** — the `202607020011` backfill can collide positions for category values that differ only by case; it passed on real data as a one-shot but is not collision-proof (Task 2 minor).
- **Export e2e hits endpoints, not buttons, and asserts no filenames** — the download tests call the routes directly and do not assert the `content-disposition` filename (Tasks 13/14 minor).
- **Evidence export owner fallback is `""` rather than "Unassigned"** — inconsistent with the other export owner columns (Task 14 minor).
- **`maybeSingle` risk-matrix-config read assumes a single active org** — a pre-existing pattern that will need revisiting for multi-org membership (Task 3 minor).

---

## Phase B.5 — Spreadsheet import + column-mapping wizard (Done)

**What shipped:** Upload XLSX/CSV → auto-suggested column mapping → validation preview (valid/invalid + per-row errors) → confirm, for risk register, SoA, and asset inventory. Server-side re-validation, RLS-scoped writes, org-scoped name→id resolution. SoA import *updates* matched controls (never inserts). Lossless export→import round-trip (reverses Phase B's label maps + CSV formula guard). Robustness: calendar-date validation, XLSX rich-text cells, 500-row cap + rate limit.

**Suggested improvements (backlog):**
- Save & reuse named column mappings per workbook template (skip re-mapping each time).
- Drag-and-drop upload + per-sheet selection for multi-sheet workbooks.
- Import history / audit trail with undo-last-import.
- Dedup-on-re-import for risk/asset (currently additive with a warning) — match on a natural key.
- Real asset owner-name resolution (currently the combined "Owner & Location" column never matches a display name — effectively a no-op).
- Async/background import for large workbooks (currently synchronous, capped at 500 rows).
- Downloadable blank import templates matching the expected headers.

**Deferred hardening (from reviews):** apostrophe-strip caveat for hand-authored leading-`'` data; `intField` accepts hex-ish input; SoA confirm shows "(0)" when no controls match; pre-existing Phase-A sidebar footer/avatar overlap (shell polish).

---

## Phase C — Run the audit (Done)

**What shipped:** Internal audit module (schedule audits, work a clause/control checklist, raise findings/non-conformities that spawn owned corrective-action tasks), a KPI/management-review register, a leadership readiness report (framework coverage, risk posture, task/evidence health, audit status) with PDF export + an audit evidence-pack export, and time-boxed **read-only external-auditor access** via hashed tokens + a security-definer org-scoped RPC + a public `/audit-view/<token>` page (no login, no service-role, refuses expired/revoked/unknown).

**Suggested improvements (backlog):**
- Recurring/scheduled audits (annual/quarterly cycle) auto-created from a calendar.
- Audit templates: pre-populate the checklist from the full Annex A control set for a framework.
- Findings dashboard + trend over time; link findings to the SoA control they affect.
- KPI trend charts + threshold RAG status (currently a flat log); KPI edit UI.
- Readiness report: scheduled email/PDF to leadership; a 5th risk-band tone so high vs very-high are visually distinct.
- Auditor access hardening: flash the one-time link via a single-use server-side store instead of a 60s cookie; per-view access log of auditor-token reads; escape `audit.reference` in the evidence-pack filename.
- Management-review meeting record (agenda + minutes) built on the KPI log.

**Deferred hardening (from reviews):** evidence-pack Content-Disposition filename not escaped; pgTAP 021 per-query cross-org coverage (RPC code-clean, public-view e2e renders full payload); `grant usage public to anon` broader than needed; auditor token `on delete cascade` with its audit.

---

## Phase D — Policies + Integrations (Done)

**What shipped:** A **policy library** with an approval lifecycle (draft → in review → approved → archived), per-employee acceptance tracking, a *material-edit* rule that bumps the version and re-triggers acceptance via an org-scoped notification, and policies attachable as first-class evidence. A **ticketing-integrations** workstream: owner-managed Jira / GitHub Issues connections, a provider-abstracted push that raises a remediation task as a pre-filled ticket, a ticket status chip on the task, and a `CRON_SECRET`-gated poll-sync route — all proven end-to-end with a FAKE provider (a real connection is a documented go-live step behind `INTEGRATIONS_LIVE`). DB-level trigger enforces that only owners approve/status-change a policy and only owner-or-policy-owner edits content (defence-in-depth beyond the server actions).

**Suggested improvements (backlog):**
- Policy templates: seed a starter set of ISO 27001 policies (Information Security, Access Control, Incident Response, Supplier, BYOD…) so a new org publishes in minutes instead of authoring from a blank box.
- Rich policy body: markdown/rich-text editing + rendering, headings, and a table of contents (currently a plain textarea + pre-wrapped text).
- Scheduled policy review reminders (use `review_due` + the daily sweep to raise a task/notification when a policy is due for review).
- Acceptance nudges: notify members who have not accepted the current version; an owner "chase outstanding" action; acceptance export for audit evidence.
- E-signature / attestation record (name + timestamp + version hash) for stronger audit defensibility.
- Integrations: two-way sync (close the ComplianceHub task when the ticket closes), Slack/Teams notifications, and a real OAuth connect flow UI (the code path exists; the connect wizard is a go-live item).
- Push-to-tracker from findings and risks (not only tasks); bulk-push overdue remediation.
- Move integration tokens to Supabase Vault / an encrypted column before any real connection (go-live hardening, already flagged on the connect checklist).

**Deferred hardening (from the whole-branch review):** policy evidence link/unlink actions lack the rate-limit the other policy actions carry and `unlink` deletes by `linkId` without re-scoping to `policyId` (RLS still org-scopes it); `024` pgTAP omits an UPDATE-verb assertion (evidence_links has no UPDATE path); poll-cron per-ticket errors now isolated (returns `{synced, failed}`) but failures are counted, not logged per-row.
