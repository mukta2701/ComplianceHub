# Phase B.5 — Import + Column-Mapping Wizard (Design Spec)

**Date:** 2026-07-05
**Status:** Draft for founder review
**Parent:** `2026-07-05-product-roadmap-v3.md` §Phase B (import was split out of Phase B as a focused fast-follow); companion to `2026-07-05-phase-b-kill-the-spreadsheets-design.md`.
**Ground truth:** `.superpowers/research/iso-toolkit-structures.md` (the six workbook structures).
**Binding:** v2 §10 — RLS on every write (imports insert via RLS-scoped actions, never service role); domain-first tests; e2e + axe; en-GB; original content. Presentation matches the Phase A design system.

## Goal

Let a user upload their existing toolkit workbook (XLSX or CSV) for the **risk register**, **SoA**, or **asset inventory**, map its columns to ComplianceHub fields, preview + validate, and import the rows — so exports and imports round-trip and the toolkit spreadsheets can be retired. Exit criterion: the founder's real workbooks import cleanly.

## Scope (three importers, one shared wizard)

One reusable import pipeline + a per-module adapter, mirroring the Phase B export helper (which already emits toolkit-mirrored column schemas — import reverses them).

### Shared pipeline (`src/features/imports/`)
- **Parse** (`parseWorkbook`): accept an uploaded XLSX (via `exceljs`, already a dep) or CSV; return `{ headers: string[], rows: string[][] }` from the first/selected sheet. Strip a single leading apostrophe from each cell (Phase B's CSV formula-injection guard adds one on export — this reverses it losslessly). Skip blank leading/section rows heuristically (the toolkit workbooks have merged section-title rows and a header row not always at row 1 — the parser locates the header row by matching expected header tokens).
- **Column mapping** (`suggestMapping`): given file headers + a target field schema (label + key + required + parser/enum), auto-suggest a mapping by case/whitespace-insensitive header match (e.g. "Risk Description" → `title`/`description`), returning a mapping the user can override.
- **Coerce + validate** (`validateRows`): apply each target field's coercion (enum label → internal value using the same label maps as export, e.g. "Operational" → `operational`, "Highly Confidential" → `highly_confidential`, "In Progress" → `in_progress`; likelihood/impact numeric 1–5; dates), then validate each row with the module's existing zod schema (`riskInputSchema`/`assetInputSchema`/an SoA-item schema). Return per-row `{ ok, values }` or `{ ok:false, errors }`. No row is imported unless valid; invalid rows are reported, not silently dropped.
- Pure/testable: parse + suggest + validate take bytes/arrays and return data — no DB, no request objects. Full vitest coverage (CSV+XLSX parse, apostrophe strip, header-row detection, enum-label coercion, zod rejection).

### Per-module adapters (target field schemas — reverse of the export schemas)
- **Risk register:** Risk ID (optional; generate `R-###` if blank) | Description → title/detail | Category (match/create `risk_categories` by name) | Likelihood 1–5 | Impact 1–5 | Mitigation → treatment_plan | Owner (match member by display name; else unassigned) | Status (label→`risk_status`) | Review Date.
- **SoA:** Control Number (match existing `soa_items` in the selected register by `control_code`, else skip with a notice — SoA items are generated from controls, so import UPDATES applicability/status/justification/owner rather than creating rows) | Applicable (Yes/No) | Justification | Implementation Status (7-value label→enum) | Owner | Comments.
- **Asset inventory:** Asset Description → description | Owner & Location → owner_location (+ match owner by name if resolvable) | Classification (label→enum) | Value/Criticality (label→enum) | Security Controls | Lifespan | Last Updated | Remarks; Category matched/created in `asset_categories`.

### Import actions (`src/app/app/<module>/import` route + server action)
- Server action receives the validated, coerced rows (re-validated server-side with the same zod schema — never trust client) and inserts/updates via the RLS-scoped `requireAppContext()` client in a batch, setting `organisation_id`/`created_by`. Category/member resolution happens server-side against the caller's org. Returns `{ imported, skipped, errors }`.
- Rate-limited like other mutations. Idempotency note: risk/asset import always inserts new rows (no natural key) — the wizard warns "N rows will be added"; SoA import updates matched controls.

### UI (`/app/<module>` → "Import" flow)
- An **Import** button beside the existing Export buttons on the risk/SoA/assets pages, opening `/app/<module>/import`.
- Wizard steps as a single progressively-revealed page (Phase A design system, fragments, axe-clean): (1) upload file → (2) column-mapping table (file header → target field selects, pre-filled by `suggestMapping`) → (3) preview + validation summary (valid/invalid counts, per-row errors) → (4) confirm import → result summary with a link to the imported records. Nothing writes until the user confirms at step 4.

## Testing
- Domain: vitest for parse (CSV/XLSX, apostrophe strip, header detection), mapping suggestion, enum-label coercion, zod validation per module.
- pgTAP: no new tables (imports reuse existing tables' RLS); add a test that a batch insert respects RLS/tenant (or rely on existing per-table attack tests — imports use the same policies).
- E2E: upload a small fixture workbook for each module → map → preview shows valid/invalid → confirm → assert the rows appear (risk/asset) or are updated (SoA); axe-zero on the wizard pages. Round-trip test: export a module to XLSX, re-import it, assert the data matches.

## Non-goals
No background/async import jobs (synchronous, small workbooks — 10–20-person scale); no multi-sheet mapping beyond selecting one sheet; no import for tasks/evidence/assessment (only the 3 toolkit registers); no dedup/merge on re-import of risks/assets (additive, with a clear warning).

## Exit criteria
The founder's real risk-register, SoA, and asset-inventory workbooks import cleanly through the wizard (with a clear report of any skipped/invalid rows); export→import round-trips; full test gate green.
