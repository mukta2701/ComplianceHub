# Phase B — Kill the Spreadsheets (Design Spec)

**Date:** 2026-07-05
**Status:** Draft for founder review
**Parent roadmap:** `2026-07-05-product-roadmap-v3.md` §Phase B (approved, phase ordering B → C → D)
**Ground truth:** `.superpowers/research/iso-toolkit-structures.md` (structural digest of the six toolkit workbooks), `.superpowers/research/isms-reference-features.md`
**Binding architecture principles:** `2026-07-02-compliancehub-v2-design.md` §3, §3a, §10 (RLS + attack tests on every tenant table, tenant-validation + audit triggers, domain-first testing, e2e + axe gates, en-GB, original content — no toolkit text copied verbatim).

## Goal

Reach parity with — and improve on — the founder's ISO 27001:2022 toolkit workbooks so no compliance work is left in Excel, and let every module export to XLSX/CSV. Import (with column mapping) is split into a focused fast-follow, **Phase B.5**, so the biggest, riskiest piece does not destabilise the rest of Phase B.

## Decisions (locked for this spec; revisable at review)

1. **Risk matrix — keep the proven 5×5, add configurable RAG banding.** The toolkit is a plain Likelihood×Impact (1–5 each → 1–25) score with *no* colour banding and *no* inherent-vs-residual split. The app already has 5×5 with inherent + residual (an improvement over the template). Phase B adds an editable per-workspace **RAG band configuration** (Low/Medium/High/Critical thresholds over the 1–25 range) plus an optional **risk-appetite** threshold, rather than a fully configurable variable-size matrix engine. Rationale: matches the toolkit's mechanic, adds the colour triage it lacks, and avoids over-engineering a multi-matrix system a 10–20-person team will not use. (The full configurable-matrix engine from the roadmap is explicitly deferred as YAGNI unless a later need appears.)

2. **SoA implementation status — adopt the full 7-value toolkit vocabulary + per-control owner.** Parity is the whole point. The 4-value `soa_status` enum (`implemented/partial/planned/not_applicable`) is replaced by the toolkit's 7 values: **Pending, Absent, In Progress, Established, Operational, Advanced, Not Applicable**. Each SoA item also gains an **owner** (`owner_id → profiles`) — the "map controls into the company" requirement. Existing data is migrated (mapping rule in §Data Migration).

3. **Import/export split — export in Phase B, import in Phase B.5.** Phase B ships XLSX/CSV **export** for every register (risk, SoA, asset inventory, plus the existing modules) immediately. The **import + column-mapping wizard** — whose exit criterion is "the founder's real workbooks import cleanly" — is Phase B.5, designed once and applied to all three registers.

## Scope — four workstreams

### B1. Risk management deepening

**New entity: Risk Treatment Plan (RTP).** The toolkit models treatment as a *separate* sheet (RTP Ref → Risk No., with Target/Actual Completion). Mirror that as a first-class linked entity rather than the current free-text `risks.treatment_plan`.

- New table `public.risk_treatment_plans`:
  - `id`, `organisation_id` (tenant), `risk_id → risks(id) on delete cascade`, `reference` (e.g. `RTP-001`, unique per org), `summary`, `treatment_measures` (text), `control_id → controls(id) on delete set null` (nullable — the toolkit's "Control Reference"), `assigned_lead_id → profiles`, `target_completion date`, `actual_completion date` (nullable), `status` (new enum `public.rtp_status`: `planned/in_progress/completed/cancelled`), timestamps, `created_by`.
  - RLS: `is_organisation_member(organisation_id)` per the standard select/insert/update/delete policy split; tenant-validation trigger asserting `risk_id`'s org matches; `capture_audit_event` trigger.
  - **Spawns a task:** creating an RTP optionally creates a linked `task` (owner = assigned lead, due = target completion, `source = 'risk_treatment'`) via the existing tasks engine — reusing `createTask`, no new task machinery. Completing all of a risk's RTPs is surfaced on the risk (not auto-closing the risk).
- Keep `risks.treatment` (mitigate/avoid/transfer/accept) and `risks.treatment_plan` free-text for backward compatibility, but the UI promotes RTPs as the structured path.

**Risk categories — controlled vocabulary.** The toolkit has an 8-entry category list with a known duplicate ("Third-Party/Vendor Risk" twice). Replace the free-text `risks.category` with a per-workspace **category taxonomy**:
- New table `public.risk_categories` (`id`, `organisation_id`, `name`, `position`, unique per org). Seeded with the toolkit's 7 *distinct* categories (dedupe the vendor duplicate): Data Security, Physical Security, Compliance, Access Control, Network Security, Operational, Third-Party/Vendor Risk.
- `risks.category` becomes `category_id → risk_categories(id)` (nullable during migration; see §Data Migration). Members can add/rename categories.

**RAG banding config.** New table `public.risk_matrix_config` (one row per org, created on demand): four integer thresholds partitioning 1–25 into Low/Medium/High/Critical, plus an optional `appetite_threshold`. Domain function `riskBand(score, config)` replaces the current hardcoded band logic; default thresholds match today's behaviour so nothing regresses if a workspace never customises.

### B2. SoA upgrade

- New enum `public.soa_implementation_status` with the 7 toolkit values. `soa_items.status` migrates from `soa_status` to the new enum; the old `soa_status` type is dropped after migration.
- `soa_items` gains `owner_id → profiles(id) on delete set null`.
- The `check ((applicable and status <> 'not_applicable') or (not applicable and status = 'not_applicable'))` constraint is preserved against the new `not_applicable` value.
- Domain: a status→readiness weighting map (used by the dashboard/reporting) lives in `src/features/soa/domain` with tests; **no** decorative static percentages (the toolkit's Metrices percentages are illustrative and are *not* ported).
- SoA snapshots (immutable) capture the new status + owner. Snapshot immutability trigger unchanged.

### B3. Asset inventory (new module `src/features/assets`)

- New table `public.assets`: `id`, `organisation_id`, `reference` (e.g. `AST-001`), `description` (name), `owner_location` (text; the toolkit's "Owner & Location" — keep as one field for parity, plus optional `owner_id → profiles` for in-app ownership), `classification` (enum: **Highly Confidential, Confidential, Internal Use Only, Public**), `value_criticality` (enum: **High, Medium, Low**), `category_id → asset_categories`, `security_controls` (text), `lifespan` (text), `last_updated date`, `remarks` (text), timestamps, `created_by`.
- New enums `public.asset_classification`, `public.asset_value`. New table `public.asset_categories` seeded with the toolkit's category taxonomy (General, Organization, Asset Management, Human Resources, Physical & Environmental, …).
- Link table `public.asset_risks` (`asset_id`, `risk_id`, tenant) — assets linkable to risks (many-to-many), per roadmap.
- Classification and Value are **independent, uncombined** enums (no derived score) — matches the toolkit exactly.
- Full stack: migration + RLS + attack tests (pgTAP), domain module + tests, server actions, `/app/assets` pages (list with stat row + filters, new/edit form, detail with linked risks) in the Phase-A product design language, nav entry, e2e + axe.
- Reference data (classification handling rules, value definitions) rendered as static help content, authored originally (not copied from the workbook).

### B4. Export (cross-cutting, designed once; import is B.5)

- New route handlers `GET /api/app/<module>/export?format=xlsx|csv` for risk register, SoA, asset inventory, and the existing tasks/evidence/assessment modules.
- One shared server-side export helper (`src/features/exports/`) that takes rows + a column schema and emits XLSX (via a lib TBD in the plan — candidate: `exceljs`, already-permissible pure-JS) or CSV. Column schemas mirror the toolkit headers so a later re-import round-trips.
- Buttons wired into each module's page header. Downloads follow the existing evidence-download action pattern (auth + tenant scoped).

## Data flow & integration

- All new tables follow the established pattern: `organisation_id` tenant column, `is_organisation_member` RLS (split select/insert/update/delete), a `validate_tenant` BEFORE trigger for any cross-table FK (RTP→risk, asset_risks→asset/risk), and a `capture_audit_event` AFTER trigger.
- New server actions live in each feature's `actions.ts`, reuse `requireAppContext`, and never bypass RLS. No service-role usage (that is reserved for the daily sweep).
- Tasks spawned by RTPs reuse the existing tasks engine unchanged — Phase B adds a `risk_treatment` value to the task `source` vocabulary only.

## Data migration

- `risks.category (text)` → `category_id`: create `risk_categories` seed per org, then map existing free-text categories by case-insensitive name to the seeded rows; unmatched values become new `risk_categories` rows for that org so nothing is lost. Drop `risks.category` after backfill.
- `soa_items.status`: map old→new — `implemented→Operational`, `partial→In Progress`, `planned→Pending`, `not_applicable→Not Applicable`. (Documented, reversible mapping.)
- All migrations are additive-then-backfill-then-drop within a single numbered migration per table, tested against the already-migrated local DB (no `db reset` — see environment note).

## Testing (per v2 §10, non-negotiable)

- **pgTAP** RLS attack tests for every new table: cross-tenant SELECT/INSERT/UPDATE/DELETE denial, tenant-validation trigger rejection, audit-event capture.
- **Domain unit tests** (vitest) for `riskBand(config)`, RTP status roll-up, SoA readiness weighting, asset enums, export column-schema mapping.
- **E2E + axe** (Playwright): create RTP → task spawned; change SoA status through the 7 values + set owner; create asset → link to risk; export each register and assert a non-empty file downloads. Zero axe violations on every new page.
- Full gate before merge: eslint, tsc, vitest, `next build`, `supabase test db`, Playwright (chromium + mobile).

## Non-goals (Phase B)

Configurable variable-size matrix engine; import/mapping (→ B.5); the toolkit's decorative pie charts and static percentages; asset→control auto-mapping; any AI features.

## Exit criteria

- Risk register has structured RTPs (spawning tasks), a category taxonomy, and configurable RAG bands; SoA carries the 7-value status + owner; a working asset inventory module linked to risks; every module exports to XLSX/CSV. Full test gate green. Phase B.5 then delivers clean import of the founder's real workbooks.
