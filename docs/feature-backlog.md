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
- Produce styled, branded XLSX output (formatted header row, sensible column widths, auto-filters) so the export can genuinely replace the workbooks.

## Deferred hardening

The following previously reported items are now closed and tracked as `Done` in `docs/feature-backlog.csv`: CSV formula-injection protection, XLSX import round-trip, XLSX content round-trip coverage, risk-matrix policy identity and active-workspace reads, operator-only risk-matrix mutations, owner-only monitoring-finding mutations with atomic remediation-task linking, RTP delete errors, asset-link empty-id guards, category position collision, export filename/button coverage, export rate-limit/audit coverage, evidence owner fallback, policy-evidence rate limiting and policy-scoped unlinking, and server-side SoA owner-membership validation. A broader operator-facing digest status dashboard and live connector secret vault remain backlog items.

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
- Auditor access hardening: replace the short-lived flash cookie with a single-use server-side store.
- Management-review meeting record (agenda + minutes) built on the KPI log.

**Deferred hardening (from reviews):** pgTAP 021 per-query cross-org coverage (RPC code-clean, public-view e2e renders full payload); `grant usage public to anon` broader than needed; auditor token `on delete cascade` with its audit.

---

## Phase D — Policies + Integrations (Done)

**What shipped:** A **policy library** with an approval lifecycle (draft → in review → approved → archived), per-employee acceptance tracking, a *material-edit* rule that bumps the version and re-triggers acceptance via an org-scoped notification, policies attachable as first-class evidence, scheduled review reminders, and 10 original starter policies selectable from the authoring form. A **ticketing-integrations** workstream: owner-managed Jira / GitHub Issues connections, a provider-abstracted push that raises a remediation task as a pre-filled ticket, a ticket status chip on the task, and a `CRON_SECRET`-gated poll-sync route — all proven end-to-end with a FAKE provider (a real connection is a documented go-live step behind `INTEGRATIONS_LIVE`). DB-level trigger enforces that only owners approve/status-change a policy and only owner-or-policy-owner edits content (defence-in-depth beyond the server actions).

**Suggested improvements (backlog):**
- Rich policy body: markdown/rich-text editing + rendering, headings, and a table of contents (currently a plain textarea + pre-wrapped text).
- Acceptance nudges: notify members who have not accepted the current version; an owner "chase outstanding" action; acceptance export for audit evidence.
- E-signature / attestation record (name + timestamp + version hash) for stronger audit defensibility.
- Integrations: two-way sync (close the ComplianceHub task when the ticket closes), Slack/Teams notifications, and a real OAuth connect flow UI (the code path exists; the connect wizard is a go-live item).
- Push-to-tracker from findings and risks (not only tasks); bulk-push overdue remediation.
- Move integration tokens to Supabase Vault / an encrypted column before any real connection (go-live hardening, already flagged on the connect checklist).

**Deferred hardening (from the whole-branch review):** `024` pgTAP omits an UPDATE-verb assertion (evidence_links has no UPDATE path); poll-cron per-ticket errors now isolated (returns `{synced, failed}`) but failures are counted, not logged per-row.

## Internal MCP + daily Slack digest (shipped)

**What shipped:** an OAuth-protected Streamable HTTP MCP endpoint with seven
tenant-scoped read/prepare tools plus a separate Owner-only `post_daily_digest`
external-write tool, including a bounded immutable official-GitHub read,
schema-v2 deterministic digest facts, and an Owner-only daily Slack digest
workflow. Digest claims are derived from a prepared fact hash that covers the
exact GitHub partition, prior-delivery baseline, immutable lifecycle changes,
and truncation state;
reservation/finalisation RPCs make concurrent calls idempotent, webhook URLs are
encrypted at rest, and delivery outcomes are terminally classified. A private
ComplianceHub plugin and daily-brief skill keep preparation side-effect-free
unless the user explicitly requests a send. Hosted OAuth and a real Slack
webhook remain go-live checkpoints, not local defaults.

**Suggested improvements:**
- Complete hosted MCP Inspector/Codex/Claude OAuth acceptance against the canonical Azure origin.
- Configure a real Slack incoming webhook and record three redacted shadow deliveries, including failure/unknown handling.
- Add operator-facing schedule status and a bounded retry/recovery dashboard for abandoned digest reservations.

## GitHub verified collection and materialisation (pipeline shipped)

**What shipped:** a private GitHub App claim/callback flow, tenant-safe
installation and repository scope, deterministic rule evaluation, bounded
collection orchestration, signed replay-safe webhook intake, manual recheck UI,
collection-health summaries, immutable mapping approval/provenance, transactional
evidence/finding materialisation, and immutable official results consumed by the
read-only MCP result tool and schema-v2 digest. Raw shadow observations never
become official facts by themselves. The local personal pilot accepts a `User`
account only on an HTTP loopback origin; hosted deployments stay
organisation-only. Official GitHub technical results remain narrower than ISO
certification, readiness, security, or overall-compliance claims.

**Suggested improvements:**
- Complete the hosted Supabase migration and Azure secret/registration checkpoints.
- Run the approved Adtecher one-repository shadow pilot and commit a redacted comparison proof.
- Add the separately planned Owner-facing mapping approval and official-result UI after the shadow proof passes.
