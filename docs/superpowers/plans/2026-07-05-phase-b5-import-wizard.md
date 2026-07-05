# Phase B.5 — Import + Column-Mapping Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload their existing toolkit workbook (XLSX or CSV) for the **risk register**, **SoA**, or **asset inventory**, map its columns to ComplianceHub fields, preview + validate every row, and import — so Phase B's exports and B.5's imports round-trip losslessly and the toolkit spreadsheets can be retired. Exit criterion: the founder's real workbooks import cleanly, with a clear report of any skipped/invalid rows.

**Architecture:** One reusable, *pure* pipeline in `src/features/imports/` (no DB, no request objects, fully vitest-covered): `parseWorkbook` (XLSX via the already-installed `exceljs`, hand-rolled CSV parser, single-leading-apostrophe strip that reverses Phase B's CSV formula-injection guard, token/density header-row detection for the toolkit's merged section rows) → `suggestMapping` (case/whitespace-insensitive header→field match) → `coerceAndValidate` (enum-label reversal using the **same** `RISK_STATUS_LABEL`/`SOA_STATUS_LABEL`/`ASSET_CLASSIFICATION_LABEL`/`ASSET_VALUE_LABEL` maps Phase B exports with, numeric/date/bool coercion, per-row zod). Three pure **adapters** (`adapters/{risk,soa,asset}.ts`) supply each module's `TargetField[]` + importable-row zod schema, keyed by an `ADAPTERS` registry. A single generic server-action pair (`analyseImportAction` parses an uploaded file; `runImportAction` re-validates every row server-side, resolves category/member **names→ids** against the caller's org, and inserts/updates through the RLS-scoped `requireAppContext()` client — never the service role) drives one shared client `ImportWizard` component behind three thin `/app/<module>/import` fragment pages. Risk/asset import is **additive** (with a "N rows will be added" warning); SoA import **updates matched `control_code` rows** in a selected register (SoA items are generated from controls, never inserted). **No new tables** — imports reuse the existing tables' RLS.

**Tech Stack:** Next.js 16 (App Router, server components + server actions, client component for the wizard), React 19, Tailwind v4 + the hand-authored design system in `src/app/globals.css`, Supabase (Postgres 15 + RLS) via `requireAppContext()`, zod v4, `exceljs` (already a dependency, added in Phase B Task 12), Playwright + `@axe-core/playwright`, vitest.

## Global Constraints

- **v2 §10 non-negotiables (every task):** imports write **only** through the RLS-scoped `requireAppContext()`/`createSupabaseServerClient()` client — **never** the service role; **re-validate every row server-side** with the module's zod schema (`riskInputSchema`/`assetInputSchema`/`soaItemReviewSchema`) before any insert/update; **domain-first testing** (write the vitest assertion before the implementation); **e2e + axe (zero violations)** on every new page; **en-GB** copy throughout; **ORIGINAL content only** (no toolkit cell text copied verbatim).
- **No new tenant tables are expected.** Imports reuse the existing `risks`/`soa_items`/`assets`/`risk_categories`/`asset_categories`/`memberships` tables and their existing split RLS + audit triggers (Phase B, migrations `202607020010`–`202607020016`, pgTAP `010`–`014`). **If any task finds it must add a table**, that table needs split RLS (`is_organisation_member`) + a `capture_audit_event` trigger + a pgTAP attack test asserting cross-tenant SELECT/INSERT/UPDATE/DELETE denial before it merges.
- **Reverse the export label maps for coercion — single source of truth.** Import must accept *exactly* what Phase B export emits (incl. stripping the leading-apostrophe CSV guard from `src/features/exports/exports.ts`). Do not hand-write parallel enum tables; call `reverseLabels(...)` over `RISK_STATUS_LABEL` (`src/features/risks/domain/risks.ts`), `SOA_STATUS_LABEL` (`src/features/soa/domain/soa.ts`), `ASSET_CLASSIFICATION_LABEL`/`ASSET_VALUE_LABEL` (`src/features/assets/domain/assets.ts`). Export→import must be **lossless** for the mapped fields.
- **Presentation matches Phase A.** Wizard pages are **fragments** (AppShell in `src/components/app-shell.tsx` owns the single `<main className="content">` and the only page-title `<h1>`); reuse `PageIntro`/`Card`/`Pill`/`Stat` from `src/components/ui.tsx`; section headings are `<h2>`/`<h3>`; **never invent colours** (only the existing CSS custom properties + `.pill`/`.button` classes; real `Pill` tones: `blue green low amber medium red high critical neutral`); register any import-page title in `AppShell`'s `TITLES` array. axe ZERO violations.
- **Purity boundary.** `src/features/imports/**` is pure and importable from both server and client — it must NOT import `exceljs` outside `parse.ts`, must NOT import server-only modules, and adapters expose no DB code. `parse.ts` imports `exceljs` and is only ever imported by the server action. Category/member resolution and persistence live in `src/app/app/imports/actions.ts` (server-only).
- **Environment (this machine):**
  - `pnpm` is **not** on `PATH`. Run every tool via `npx <tool>` or `./node_modules/.bin/<tool>`. `package.json` scripts and `playwright.config.ts`'s `webServer.command: "pnpm dev"` are not usable directly.
  - Playwright has `reuseExistingServer: true` (non-CI). **Before running Playwright, start the dev server yourself:** `./node_modules/.bin/next dev` (background) and wait for `http://127.0.0.1:3000`. Playwright then reuses it.
  - Local Supabase stack runs at `127.0.0.1:54321`. **No schema changes in this phase** — do NOT run `npx supabase db reset` and do NOT expect new migrations. If a pgTAP file is added it is run with `npx supabase test db` only.
  - Integration tests (`**/*.integration.test.{ts,tsx}`) are **excluded** from `npx vitest run` by `vitest.config.ts`; the import pipeline is unit-testable and must land in normal `*.test.ts` files.
- **Conventional commits, the configured Git author, NO co-author trailer.** The pre-commit privacy hook has known false positives; `git commit --no-verify` is permitted **only** when a commit is blocked with zero genuine findings.
- **Work in this working directory on a Phase-B.5 branch** (created in Task 1). No separate worktree.

### Existing signatures this plan builds on (all verified against the codebase)

- **Export helper** `src/features/exports/exports.ts`: `type ExportColumn<T> = { header: string; value: (row: T) => string | number | null }`; `toCsv<T>(columns, rows): string`; `toXlsx<T>(sheetName, columns, rows): Promise<Buffer>`. The CSV path prefixes any cell matching `/^[=+\-@\t\r]/` with a leading `'` (formula-injection guard) — **import strips one leading apostrophe to reverse this**. XLSX writes inline strings (no apostrophe).
- **Export column schemas** (import reverses these exact headers, label→enum):
  - `src/app/api/app/risks/export/route.ts` — `Risk ID, Risk Description, Risk Category, Likelihood, Impact, Risk Rating, Mitigation Measures, Risk Owner, Status, Review Date`. Status via `RISK_STATUS_LABEL`; description column is `description || title`; Risk Rating is derived (`calculateRiskScore`) and **not imported**.
  - `src/app/api/app/soa/export/route.ts` — `Control Number, Control Description, Is Control Applicable?, Justification for the Inclusion/Exclusion, Implementation Status, Owner, Comments`. Applicable is `Yes`/`No`; status via `SOA_STATUS_LABEL`; Owner resolved via memberships→profiles.
  - `src/app/api/app/assets/export/route.ts` — `Asset Reference, Asset Description, Category, Owner & Location, Classification, Value (Criticality), Security Controls, Asset Lifespan, Last Updated, Remarks`. Classification/Value via `ASSET_CLASSIFICATION_LABEL`/`ASSET_VALUE_LABEL`.
- **Domain label maps** (single source of truth for reversal):
  - `src/features/risks/domain/risks.ts`: `type RiskStatus = "open"|"treating"|"accepted"|"closed"`; `const RISK_STATUS_LABEL: Record<RiskStatus,string> = { open:"Open", treating:"Treating", accepted:"Accepted", closed:"Closed" }`; `calculateRiskScore(l,i)`.
  - `src/features/soa/domain/soa.ts`: `type SoaStatus = "pending"|"absent"|"in_progress"|"established"|"operational"|"advanced"|"not_applicable"`; `const SOA_STATUS_LABEL: Record<SoaStatus,string>` (`In Progress`, `Not Applicable`, …).
  - `src/features/assets/domain/assets.ts`: `type AssetClassification`, `type AssetValue`; `ASSET_CLASSIFICATION_LABEL` (`"Highly Confidential"`, `"Internal Use Only"`, …), `ASSET_VALUE_LABEL` (`High/Medium/Low`).
- **Zod schemas to re-validate against (server-side, post-resolution):**
  - `src/features/risks/application/risk.ts` `riskInputSchema` — requires `organisationId(uuid)`, `reference(1..40)`, `title(1..200)`, `description(1..10000)`, `categoryId(uuid)`, `ownerId(uuid).nullable().optional()`, `likelihood/impact/residualLikelihood/residualImpact` = `z.coerce.number().int().min(1).max(5)`, `treatment` enum `["mitigate","avoid","transfer","accept"]`, `treatmentPlan.default("")`, `reviewDate = z.union([z.iso.date(), z.literal("")]).optional()`, `status` enum `["open","treating","accepted","closed"]`, `evidence.default("")`.
  - `src/features/assets/application/asset.ts` `assetInputSchema` — `reference(1..40)`, `description(1..200)`, `ownerLocation.default("")`, `ownerId(uuid|null)`, `classification` enum, `valueCriticality` enum, `categoryId(uuid|null)`, `securityControls/remarks.default("")`, `lifespan(≤120)`, `lastUpdated(iso|null)`.
  - `src/features/soa/application/review.ts` `soaItemReviewSchema` — `itemId(uuid)`, `status` (7-value enum), `applicable(bool)`, `justification(1..10000)`, `evidence.default("")`, `.refine` (applicable ⇒ status ≠ `not_applicable`; not applicable ⇒ status = `not_applicable`).
- **Server-action conventions:** `requireAppContext()` (`src/lib/app-context.ts`) → `{ supabase, user, membership, organisation:{id,name} }`. `enforceRateLimit(key, { limit, windowMs })` (`src/lib/security/rate-limit.ts`). Create pattern (`src/app/app/actions.ts` `createRiskAction`, `src/app/app/assets/actions.ts` `createAssetAction`): `const parsed = schema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id })` then `supabase.from(table).insert({ ...snake_case..., created_by: user.id })`, `revalidatePath`. Reading an uploaded file (`src/app/app/evidence/actions.ts` `createEvidenceAction`): `const file = formData.get("file"); if (!(file instanceof File) || file.size === 0) …`.
- **Category/member resolution ground truth:** `risk_categories`/`asset_categories` are per-org tables with `unique (organisation_id, name)` and `position integer` (Phase B migrations `202607020010`/`202607020015…`). Match case-insensitively on `name`; create a missing one with `position = (max position)+1` (see `acceptRiskSuggestionAction` in `src/app/app/actions.ts`, which reuses/creates a `"Readiness"` category exactly this way). Members resolve through `memberships.select("user_id,profiles(display_name)")` → map `display_name`→`user_id` (see every `new/page.tsx` owner `<select>`).
- **SoA specifics:** `soa_items` are generated by the `create_soa_draft` RPC from controls; each row has `control_code`, `control_title`, `applicable`, `status`, `justification`, `evidence`, `owner_id` and belongs to a `soa_register_id`. `soa_items.owner_id` references `memberships(user_id)`. Import **UPDATES** matched `control_code` rows in the chosen register; unmatched codes are **skipped with a notice** (never inserted).
- **UI:** `PageIntro({eyebrow?,title,body,action?})` (renders an `<h2>` title), `Card(HTMLAttributes)`, `Stat({label,value,detail,tone?})`, `Pill({children,tone?})` from `src/components/ui.tsx`. List pages render tables inside `<Card><div className="data-table-wrap" role="region" aria-label="…" tabIndex={0}>`. `AppShell` `nav`/`TITLES` in `src/components/app-shell.tsx`; `isActive(path,href)` prefix-matches, and `TITLES.find` returns the **first** match — so an `/app/<module>/import` title entry must be listed **before** its `/app/<module>` parent. Available `Icon` names: `shield home clipboard file alert settings menu arrow check download plus users lock bell` (there is **no** `upload` icon — import buttons carry no icon, like the export secondary buttons).

### E2E selector contract — these MUST survive verbatim

From `e2e/product.spec.ts` (do not weaken): SoA `select[name="assessmentId"]` + button **`Generate draft`** + each item a `<form>` with `<h2>` `{control_code}: {control_title}`; risks **`Add risk`**/`select[name="categoryId"]`; assets **`Add asset`**/`Reference`/`Description`/`select[name=classification]`/`select[name=valueCriticality]`. Import buttons and pages are additive and must not rename or remove any of these; the existing export buttons (`Export XLSX`/`CSV`) stay.

---

## Task 1: Shared parse layer (`src/features/imports/parse.ts`) + tests

Pure workbook/CSV parsing: return `{ headers, rows }` from the first sheet, strip one leading apostrophe per cell, and locate the header row past the toolkit's merged section-title rows.

**Files:**
- Create branch `phase-b5-import-wizard`
- Create: `src/features/imports/parse.ts`
- Create: `src/features/imports/parse.test.ts`

**Interfaces:**
- Consumes: `exceljs` (already a dependency); `toXlsx` from `src/features/exports/exports.ts` (test fixtures only).
- Produces: `type ParsedWorkbook = { headers: string[]; rows: string[][] }`; `parseCsv(text: string): string[][]`; `findHeaderRow(grid: string[][], expected: readonly string[], minCells?: number): number`; `parseWorkbook(input: string | ArrayBuffer | Uint8Array, format: "csv" | "xlsx", expectedHeaders?: readonly string[]): Promise<ParsedWorkbook>`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull --ff-only 2>/dev/null; git checkout -b phase-b5-import-wizard
```

Expected: `Switched to a new branch 'phase-b5-import-wizard'`. (Phase B — exports, assets, `risk_categories` — must already be present in the base branch; if it currently lives on a feature branch rather than `main`, branch from that branch instead.)

- [ ] **Step 2: Write the parse test first**

Create `src/features/imports/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCsv, findHeaderRow, parseWorkbook } from "./parse";
import { toXlsx, type ExportColumn } from "@/features/exports/exports";

describe("parseCsv", () => {
  it("splits rows and honours quotes, escaped quotes, embedded commas and newlines", () => {
    const csv = 'Alpha,Beta\r\n"x,""y""\nz",3\r\nplain,';
    expect(parseCsv(csv)).toEqual([["Alpha", "Beta"], ['x,"y"\nz', "3"], ["plain", ""]]);
  });
  it("strips a UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b")).toEqual([["a", "b"]]);
  });
});

describe("findHeaderRow", () => {
  it("skips merged section-title rows and finds the header by token match", () => {
    const grid = [["Asset Inventory"], ["GENERAL"], ["Asset Description", "Owner & Location", "Classification"], ["Reputation", "HQ", "Highly Confidential"]];
    expect(findHeaderRow(grid, ["Asset Description", "Classification", "Value (Criticality)"])).toBe(2);
  });
  it("falls back to the first dense row when no tokens match", () => {
    const grid = [["title"], ["A", "B", "C"], ["1", "2", "3"]];
    expect(findHeaderRow(grid, [])).toBe(1);
  });
});

describe("parseWorkbook", () => {
  it("strips a single leading apostrophe (reversing the CSV formula guard) and drops blank rows", async () => {
    const csv = "Risk ID,Status\r\n'=cmd,Open\r\n,\r\nR-002,Closed";
    const { headers, rows } = await parseWorkbook(csv, "csv", ["Risk ID", "Status"]);
    expect(headers).toEqual(["Risk ID", "Status"]);
    expect(rows).toEqual([["=cmd", "Open"], ["R-002", "Closed"]]);
  });
  it("round-trips an XLSX produced by the export helper", async () => {
    type R = { a: string; b: number };
    const columns: ExportColumn<R>[] = [{ header: "Risk ID", value: (r) => r.a }, { header: "Likelihood", value: (r) => r.b }];
    const buffer = await toXlsx("Risk register", columns, [{ a: "R-001", b: 3 }]);
    const { headers, rows } = await parseWorkbook(buffer, "xlsx", ["Risk ID", "Likelihood"]);
    expect(headers).toEqual(["Risk ID", "Likelihood"]);
    expect(rows).toEqual([["R-001", "3"]]);
  });
});
```

- [ ] **Step 3: Implement `parse.ts`**

Create `src/features/imports/parse.ts`:

```ts
import ExcelJS from "exceljs";

export type ParsedWorkbook = { headers: string[]; rows: string[][] };

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_/()?:.\-]+/g, " ").trim();
const stripApostrophe = (cell: string) => (cell.startsWith("'") ? cell.slice(1) : cell);

export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  const sheet = workbook.worksheets[0];
  const grid: string[][] = [];
  if (!sheet) return grid;
  sheet.eachRow({ includeEmpty: true }, (excelRow) => {
    const values = excelRow.values as unknown[]; // 1-based; index 0 is undefined
    const cells: string[] = [];
    for (let c = 1; c < values.length; c++) {
      const v = values[c];
      if (v === null || v === undefined) cells.push("");
      else if (typeof v === "object" && "text" in (v as Record<string, unknown>)) cells.push(String((v as { text: unknown }).text));
      else if (typeof v === "object" && "result" in (v as Record<string, unknown>)) cells.push(String((v as { result: unknown }).result));
      else cells.push(String(v));
    }
    grid.push(cells);
  });
  return grid;
}

export function findHeaderRow(grid: readonly string[][], expected: readonly string[], minCells = 3): number {
  const wanted = expected.map(norm);
  let firstDense = -1;
  for (let i = 0; i < grid.length; i++) {
    const nonEmpty = grid[i].filter((c) => c.trim() !== "");
    if (firstDense === -1 && nonEmpty.length >= minCells) firstDense = i;
    if (wanted.length && grid[i].filter((c) => wanted.includes(norm(c))).length >= 2) return i;
  }
  return firstDense === -1 ? 0 : firstDense;
}

export async function parseWorkbook(
  input: string | ArrayBuffer | Uint8Array,
  format: "csv" | "xlsx",
  expectedHeaders: readonly string[] = [],
): Promise<ParsedWorkbook> {
  const grid = format === "csv"
    ? parseCsv(typeof input === "string" ? input : new TextDecoder().decode(input))
    : await parseXlsx(input instanceof Uint8Array
        ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
        : (input as ArrayBuffer));
  const cleaned = grid.map((r) => r.map((c) => stripApostrophe(c).trim()));
  const headerIndex = findHeaderRow(cleaned, expectedHeaders);
  const headers = (cleaned[headerIndex] ?? []).filter((_, i, arr) => i < arr.length);
  const width = headers.length;
  const rows = cleaned.slice(headerIndex + 1).filter((r) => r.some((c) => c !== "")).map((r) => r.slice(0, width));
  return { headers, rows };
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/features/imports/parse.test.ts && npx eslint src/features/imports && npx tsc --noEmit
git add src/features/imports/parse.ts src/features/imports/parse.test.ts
git commit -m "feat: add pure workbook parse layer for the import wizard"
```

Expected: all `parse` tests green; eslint/tsc clean.

---

## Task 2: Mapping + coercion/validation layer (`src/features/imports/mapping.ts`) + tests

Header→field suggestion, reusable field-coercion builders that reverse the export label maps, and per-row coerce+validate returning `ok`/`errors`.

**Files:**
- Create: `src/features/imports/mapping.ts`
- Create: `src/features/imports/mapping.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `type FieldCoercion = { ok: true; value: string | number | boolean | null } | { ok: false; error: string }`; `type TargetField = { key: string; label: string; required: boolean; aliases: string[]; coerce: (raw: string) => FieldCoercion }`; `type ColumnMapping = Record<string, string | null>`; `type RowResult = { ok: true; values: Record<string, string | number | boolean | null> } | { ok: false; errors: string[] }`; `reverseLabels<T extends string>(labels: Record<T, string>): (raw: string) => T | null`; field builders `textField`, `enumField`, `intField`, `boolField`, `dateField`; `suggestMapping(headers, fields): ColumnMapping`; `coerceAndValidate(headers, rows, mapping, fields, rowSchema?): RowResult[]`.

- [ ] **Step 1: Write the mapping test first**

Create `src/features/imports/mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { reverseLabels, textField, enumField, intField, boolField, dateField, suggestMapping, coerceAndValidate, type TargetField } from "./mapping";

const STATUS = { open: "Open", closed: "Closed" } as const;

describe("reverseLabels", () => {
  it("accepts the exported label and the raw enum key, case-insensitively", () => {
    const rev = reverseLabels(STATUS);
    expect(rev("Open")).toBe("open");
    expect(rev("open")).toBe("open");
    expect(rev("CLOSED")).toBe("closed");
    expect(rev("nope")).toBe(null);
  });
});

describe("field builders", () => {
  it("coerce enums, 1-5 ints, Yes/No and dates", () => {
    expect(enumField("s", "Status", true, [], STATUS).coerce("Closed")).toEqual({ ok: true, value: "closed" });
    expect(enumField("s", "Status", true, [], STATUS).coerce("bad")).toEqual({ ok: false, error: 'unrecognised value "bad"' });
    expect(intField("l", "Likelihood", true, []).coerce("4")).toEqual({ ok: true, value: 4 });
    expect(intField("l", "Likelihood", true, []).coerce("6")).toEqual({ ok: false, error: "must be a whole number 1–5" });
    expect(boolField("a", "Applicable", true, []).coerce("Yes")).toEqual({ ok: true, value: true });
    expect(boolField("a", "Applicable", true, []).coerce("no")).toEqual({ ok: true, value: false });
    expect(dateField("d", "Review Date", false, []).coerce("31/12/2026")).toEqual({ ok: true, value: "2026-12-31" });
    expect(dateField("d", "Review Date", false, []).coerce("2026-12-31")).toEqual({ ok: true, value: "2026-12-31" });
    expect(dateField("d", "Review Date", false, []).coerce("nope")).toEqual({ ok: false, error: "must be a date (DD/MM/YYYY or YYYY-MM-DD)" });
  });
});

describe("suggestMapping", () => {
  it("matches headers to fields by label/alias ignoring case, spacing and punctuation", () => {
    const fields: TargetField[] = [textField("reference", "Risk ID", false, ["Reference"]), textField("description", "Risk Description", true, [])];
    expect(suggestMapping(["risk id", "Risk  Description", "Extra"], fields)).toEqual({ "risk id": "reference", "Risk  Description": "description", Extra: null });
  });
});

describe("coerceAndValidate", () => {
  const fields: TargetField[] = [textField("description", "Risk Description", true, []), intField("likelihood", "Likelihood", true, [])];
  it("reports required-field and coercion errors per row and never silently drops a row", () => {
    const headers = ["Risk Description", "Likelihood"];
    const mapping = { "Risk Description": "description", Likelihood: "likelihood" } as const;
    const out = coerceAndValidate(headers, [["Data loss", "3"], ["", "9"]], mapping, fields);
    expect(out[0]).toEqual({ ok: true, values: { description: "Data loss", likelihood: 3 } });
    expect(out[1]).toEqual({ ok: false, errors: ["Risk Description is required", "Likelihood: must be a whole number 1–5"] });
  });
  it("applies an optional row schema (cross-field refine) after coercion", () => {
    const rowSchema = z.object({ description: z.string(), likelihood: z.number() }).refine((v) => v.likelihood <= 5, { message: "Likelihood too high" });
    const out = coerceAndValidate(["Risk Description", "Likelihood"], [["ok", "3"]], { "Risk Description": "description", Likelihood: "likelihood" }, fields, rowSchema);
    expect(out[0].ok).toBe(true);
  });
});
```

- [ ] **Step 2: Implement `mapping.ts`**

Create `src/features/imports/mapping.ts`:

```ts
import type { z } from "zod";

export type FieldCoercion = { ok: true; value: string | number | boolean | null } | { ok: false; error: string };
export type TargetField = { key: string; label: string; required: boolean; aliases: string[]; coerce: (raw: string) => FieldCoercion };
export type ColumnMapping = Record<string, string | null>;
export type RowResult = { ok: true; values: Record<string, string | number | boolean | null> } | { ok: false; errors: string[] };

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_/()?:.\-]+/g, " ").trim();

export function reverseLabels<T extends string>(labels: Record<T, string>): (raw: string) => T | null {
  const map = new Map<string, T>();
  for (const key of Object.keys(labels) as T[]) { map.set(key.toLowerCase(), key); map.set(labels[key].toLowerCase(), key); }
  return (raw) => map.get(raw.trim().toLowerCase()) ?? null;
}

export function textField(key: string, label: string, required: boolean, aliases: string[], maxLength = 10_000): TargetField {
  return { key, label, required, aliases, coerce: (raw) => (raw.length <= maxLength ? { ok: true, value: raw } : { ok: false, error: `must be ${maxLength} characters or fewer` }) };
}

export function enumField<T extends string>(key: string, label: string, required: boolean, aliases: string[], labels: Record<T, string>): TargetField {
  const rev = reverseLabels(labels);
  return { key, label, required, aliases, coerce: (raw) => { const v = rev(raw); return v ? { ok: true, value: v } : { ok: false, error: `unrecognised value "${raw}"` }; } };
}

export function intField(key: string, label: string, required: boolean, aliases: string[], min = 1, max = 5): TargetField {
  return { key, label, required, aliases, coerce: (raw) => { const n = Number(raw); return Number.isInteger(n) && n >= min && n <= max ? { ok: true, value: n } : { ok: false, error: `must be a whole number ${min}–${max}` }; } };
}

export function boolField(key: string, label: string, required: boolean, aliases: string[]): TargetField {
  return { key, label, required, aliases, coerce: (raw) => {
    const t = raw.trim().toLowerCase();
    if (["yes", "y", "true", "1", "applicable"].includes(t)) return { ok: true, value: true };
    if (["no", "n", "false", "0", "not applicable"].includes(t)) return { ok: true, value: false };
    return { ok: false, error: 'must be "Yes" or "No"' };
  } };
}

export function dateField(key: string, label: string, required: boolean, aliases: string[]): TargetField {
  return { key, label, required, aliases, coerce: (raw) => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (iso) return { ok: true, value: `${iso[1]}-${iso[2]}-${iso[3]}` };
    const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw.trim());
    if (uk) { const y = uk[3].length === 2 ? `20${uk[3]}` : uk[3]; return { ok: true, value: `${y}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}` }; }
    return { ok: false, error: "must be a date (DD/MM/YYYY or YYYY-MM-DD)" };
  } };
}

export function suggestMapping(headers: readonly string[], fields: readonly TargetField[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  for (const header of headers) {
    const h = norm(header);
    const match = fields.find((f) => !used.has(f.key) && (norm(f.label) === h || f.aliases.some((a) => norm(a) === h)));
    mapping[header] = match?.key ?? null;
    if (match) used.add(match.key);
  }
  return mapping;
}

export function coerceAndValidate(
  headers: readonly string[],
  rows: readonly string[][],
  mapping: ColumnMapping,
  fields: readonly TargetField[],
  rowSchema?: z.ZodType,
): RowResult[] {
  const colByKey = new Map<string, number>();
  headers.forEach((h, i) => { const k = mapping[h]; if (k) colByKey.set(k, i); });
  return rows.map((row) => {
    const values: Record<string, string | number | boolean | null> = {};
    const errors: string[] = [];
    for (const field of fields) {
      const col = colByKey.get(field.key);
      const raw = col === undefined ? "" : (row[col] ?? "").trim();
      if (!raw) { if (field.required) errors.push(`${field.label} is required`); values[field.key] = null; continue; }
      const result = field.coerce(raw);
      if (result.ok) values[field.key] = result.value; else errors.push(`${field.label}: ${result.error}`);
    }
    if (rowSchema && errors.length === 0) {
      const parsed = rowSchema.safeParse(values);
      if (!parsed.success) errors.push(...parsed.error.issues.map((issue) => issue.message));
    }
    return errors.length ? { ok: false, errors } : { ok: true, values };
  });
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/features/imports/mapping.test.ts && npx eslint src/features/imports && npx tsc --noEmit
git add src/features/imports/mapping.ts src/features/imports/mapping.test.ts
git commit -m "feat: add column-mapping suggestion and row coercion/validation"
```

Expected: all `mapping` tests green; eslint/tsc clean.

---

## Task 3: Risk adapter (`src/features/imports/adapters/risk.ts`) + tests

The risk register target-field schema (reverse of the export columns) and importable-row zod, reusing `RISK_STATUS_LABEL`.

**Files:**
- Create: `src/features/imports/adapters/risk.ts`
- Create: `src/features/imports/adapters/risk.test.ts`

**Interfaces:**
- Consumes: `RISK_STATUS_LABEL` (`src/features/risks/domain/risks.ts`); `textField`/`enumField`/`intField`/`dateField`/`type TargetField` (`../mapping`).
- Produces: `type ImportAdapter = { module: "risk"|"soa"|"asset"; label: string; fields: TargetField[]; rowSchema: z.ZodType }`; `const RISK_IMPORT_FIELDS: TargetField[]`; `const riskAdapter: ImportAdapter`. Field keys: `reference`(opt), `description`(req), `categoryName`(req), `likelihood`(req), `impact`(req), `treatmentPlan`(opt), `ownerName`(opt), `status`(opt), `reviewDate`(opt).

- [ ] **Step 1: Write the risk-adapter test first**

Create `src/features/imports/adapters/risk.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { riskAdapter } from "./risk";
import { coerceAndValidate, suggestMapping } from "../mapping";

const HEADERS = ["Risk ID", "Risk Description", "Risk Category", "Likelihood", "Impact", "Mitigation Measures", "Risk Owner", "Status", "Review Date"];

describe("riskAdapter", () => {
  it("auto-maps the exported risk headers", () => {
    const mapping = suggestMapping(HEADERS, riskAdapter.fields);
    expect(mapping["Risk Category"]).toBe("categoryName");
    expect(mapping["Mitigation Measures"]).toBe("treatmentPlan");
    expect(mapping["Status"]).toBe("status");
  });
  it("coerces a full valid row (status label -> enum, 1-5 ints, DD/MM/YYYY date)", () => {
    const mapping = suggestMapping(HEADERS, riskAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["R-001", "Data loss", "Operational", "3", "2", "Encrypt", "Ada Lovelace", "Treating", "31/12/2026"]], mapping, riskAdapter.fields, riskAdapter.rowSchema);
    expect(row).toEqual({ ok: true, values: { reference: "R-001", description: "Data loss", categoryName: "Operational", likelihood: 3, impact: 2, treatmentPlan: "Encrypt", ownerName: "Ada Lovelace", status: "treating", reviewDate: "2026-12-31" } });
  });
  it("rejects an out-of-range likelihood and an unknown status but keeps a blank reference/owner", () => {
    const mapping = suggestMapping(HEADERS, riskAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["", "Data loss", "Operational", "9", "2", "", "", "Wibble", ""]], mapping, riskAdapter.fields, riskAdapter.rowSchema);
    expect(row.ok).toBe(false);
    if (!row.ok) expect(row.errors).toEqual(["Likelihood: must be a whole number 1–5", 'Status: unrecognised value "Wibble"']);
  });
});
```

- [ ] **Step 2: Implement `risk.ts`**

Create `src/features/imports/adapters/risk.ts`:

```ts
import { z } from "zod";
import { RISK_STATUS_LABEL } from "@/features/risks/domain/risks";
import { textField, enumField, intField, dateField, type TargetField } from "../mapping";

export type ImportModule = "risk" | "soa" | "asset";
export type ImportAdapter = { module: ImportModule; label: string; fields: TargetField[]; rowSchema: z.ZodType };

export const RISK_IMPORT_FIELDS: TargetField[] = [
  textField("reference", "Risk ID", false, ["Reference", "Risk No."], 40),
  textField("description", "Risk Description", true, ["Description"]),
  textField("categoryName", "Risk Category", true, ["Category"], 120),
  intField("likelihood", "Likelihood", true, ["Likelihood (Probability)"]),
  intField("impact", "Impact", true, ["Impact (Business Impact)"]),
  textField("treatmentPlan", "Mitigation Measures", false, ["Mitigation", "Treatment Plan"]),
  textField("ownerName", "Risk Owner", false, ["Owner"], 200),
  enumField("status", "Status", false, [], RISK_STATUS_LABEL),
  dateField("reviewDate", "Review Date", false, []),
];

// Importable-row shape (pre-resolution). Category/owner NAMES here; the server
// resolves them to ids and re-validates with riskInputSchema before insert.
export const riskRowSchema = z.object({
  reference: z.string().nullable(),
  description: z.string(),
  categoryName: z.string(),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  treatmentPlan: z.string().nullable(),
  ownerName: z.string().nullable(),
  status: z.enum(["open", "treating", "accepted", "closed"]).nullable(),
  reviewDate: z.string().nullable(),
});

export const riskAdapter: ImportAdapter = { module: "risk", label: "Risk register", fields: RISK_IMPORT_FIELDS, rowSchema: riskRowSchema };
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/features/imports/adapters/risk.test.ts && npx eslint src/features/imports && npx tsc --noEmit
git add src/features/imports/adapters/risk.ts src/features/imports/adapters/risk.test.ts
git commit -m "feat: add risk register import adapter"
```

Expected: risk-adapter tests green; eslint/tsc clean.

---

## Task 4: SoA adapter (`src/features/imports/adapters/soa.ts`) + tests

The SoA target-field schema (reverse of export), reusing `SOA_STATUS_LABEL`, with the applicable↔status refine mirroring `soaItemReviewSchema`.

**Files:**
- Create: `src/features/imports/adapters/soa.ts`
- Create: `src/features/imports/adapters/soa.test.ts`

**Interfaces:**
- Consumes: `SOA_STATUS_LABEL` (`src/features/soa/domain/soa.ts`); `textField`/`enumField`/`boolField` + `ImportAdapter` (`./risk` re-exports the type) (`../mapping`).
- Produces: `const SOA_IMPORT_FIELDS: TargetField[]`; `const soaAdapter: ImportAdapter`. Field keys: `controlCode`(req), `applicable`(req), `justification`(req), `status`(req), `ownerName`(opt), `comments`(opt).

- [ ] **Step 1: Write the SoA-adapter test first**

Create `src/features/imports/adapters/soa.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { soaAdapter } from "./soa";
import { coerceAndValidate, suggestMapping } from "../mapping";

const HEADERS = ["Control Number", "Is Control Applicable?", "Justification for the Inclusion/Exclusion", "Implementation Status", "Owner", "Comments"];

describe("soaAdapter", () => {
  it("auto-maps the exported SoA headers", () => {
    const mapping = suggestMapping(HEADERS, soaAdapter.fields);
    expect(mapping["Control Number"]).toBe("controlCode");
    expect(mapping["Is Control Applicable?"]).toBe("applicable");
    expect(mapping["Implementation Status"]).toBe("status");
  });
  it("coerces Yes/No -> bool and the 7-value status label -> enum", () => {
    const mapping = suggestMapping(HEADERS, soaAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["A.5.1", "Yes", "Policy exists", "In Progress", "Ada Lovelace", "note"]], mapping, soaAdapter.fields, soaAdapter.rowSchema);
    expect(row).toEqual({ ok: true, values: { controlCode: "A.5.1", applicable: true, justification: "Policy exists", status: "in_progress", ownerName: "Ada Lovelace", comments: "note" } });
  });
  it("rejects an applicable=No row whose status is not 'Not Applicable'", () => {
    const mapping = suggestMapping(HEADERS, soaAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["A.9.1", "No", "Out of scope", "Operational", "", ""]], mapping, soaAdapter.fields, soaAdapter.rowSchema);
    expect(row.ok).toBe(false);
    if (!row.ok) expect(row.errors).toContain("Status must match applicability");
  });
});
```

- [ ] **Step 2: Implement `soa.ts`**

Create `src/features/imports/adapters/soa.ts`:

```ts
import { z } from "zod";
import { SOA_STATUS_LABEL } from "@/features/soa/domain/soa";
import { textField, enumField, boolField, type TargetField } from "../mapping";
import type { ImportAdapter } from "./risk";

export const SOA_IMPORT_FIELDS: TargetField[] = [
  textField("controlCode", "Control Number", true, ["Control", "Control Code"], 40),
  boolField("applicable", "Is Control Applicable?", true, ["Applicable"]),
  textField("justification", "Justification for the Inclusion/Exclusion", true, ["Justification"]),
  enumField("status", "Implementation Status", true, ["Status"], SOA_STATUS_LABEL),
  textField("ownerName", "Owner", false, [], 200),
  textField("comments", "Comments", false, ["Evidence"]),
];

// Mirrors soaItemReviewSchema's refine: applicable ⇒ status ≠ not_applicable.
export const soaRowSchema = z.object({
  controlCode: z.string(),
  applicable: z.boolean(),
  justification: z.string().min(1),
  status: z.enum(["pending", "absent", "in_progress", "established", "operational", "advanced", "not_applicable"]),
  ownerName: z.string().nullable(),
  comments: z.string().nullable(),
}).refine((v) => (v.applicable ? v.status !== "not_applicable" : v.status === "not_applicable"), { message: "Status must match applicability" });

export const soaAdapter: ImportAdapter = { module: "soa", label: "Statement of Applicability", fields: SOA_IMPORT_FIELDS, rowSchema: soaRowSchema };
```

- [ ] **Step 3: Verify + commit**

```bash
npx vitest run src/features/imports/adapters/soa.test.ts && npx eslint src/features/imports && npx tsc --noEmit
git add src/features/imports/adapters/soa.ts src/features/imports/adapters/soa.test.ts
git commit -m "feat: add SoA import adapter"
```

Expected: SoA-adapter tests green; eslint/tsc clean.

---

## Task 5: Asset adapter + registry (`src/features/imports/adapters/asset.ts` + `index.ts`) + tests

The asset target-field schema (reverse of export) reusing `ASSET_CLASSIFICATION_LABEL`/`ASSET_VALUE_LABEL`, plus the `ADAPTERS` registry.

**Files:**
- Create: `src/features/imports/adapters/asset.ts`
- Create: `src/features/imports/adapters/asset.test.ts`
- Create: `src/features/imports/adapters/index.ts`

**Interfaces:**
- Consumes: `ASSET_CLASSIFICATION_LABEL`/`ASSET_VALUE_LABEL` (`src/features/assets/domain/assets.ts`); field builders (`../mapping`); `type ImportModule`/`ImportAdapter` (`./risk`).
- Produces: `const ASSET_IMPORT_FIELDS: TargetField[]`; `const assetAdapter: ImportAdapter`; `const ADAPTERS: Record<ImportModule, ImportAdapter>`; re-export `type ImportModule`, `type ImportAdapter`. Asset field keys: `reference`(opt), `description`(req), `categoryName`(opt), `ownerLocation`(opt), `classification`(req), `valueCriticality`(req), `securityControls`(opt), `lifespan`(opt), `lastUpdated`(opt), `remarks`(opt).

- [ ] **Step 1: Write the asset-adapter test first**

Create `src/features/imports/adapters/asset.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assetAdapter } from "./asset";
import { ADAPTERS } from "./index";
import { coerceAndValidate, suggestMapping } from "../mapping";

const HEADERS = ["Asset Reference", "Asset Description", "Category", "Owner & Location", "Classification", "Value (Criticality)", "Security Controls", "Asset Lifespan", "Last Updated", "Remarks"];

describe("assetAdapter", () => {
  it("coerces 'Highly Confidential' -> highly_confidential and 'High' -> high", () => {
    const mapping = suggestMapping(HEADERS, assetAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["AST-001", "Customer database", "Data", "HQ", "Highly Confidential", "High", "TLS", "3 years", "2026-01-05", "n/a"]], mapping, assetAdapter.fields, assetAdapter.rowSchema);
    expect(row).toEqual({ ok: true, values: { reference: "AST-001", description: "Customer database", categoryName: "Data", ownerLocation: "HQ", classification: "highly_confidential", valueCriticality: "high", securityControls: "TLS", lifespan: "3 years", lastUpdated: "2026-01-05", remarks: "n/a" } });
  });
  it("rejects an unrecognised classification", () => {
    const mapping = suggestMapping(HEADERS, assetAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["", "X", "", "", "Ultra Secret", "High", "", "", "", ""]], mapping, assetAdapter.fields, assetAdapter.rowSchema);
    expect(row.ok).toBe(false);
    if (!row.ok) expect(row.errors).toContain('Classification: unrecognised value "Ultra Secret"');
  });
});

describe("ADAPTERS registry", () => {
  it("exposes all three modules keyed by name", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(["asset", "risk", "soa"]);
    expect(ADAPTERS.asset.label).toBe("Asset inventory");
  });
});
```

- [ ] **Step 2: Implement `asset.ts`**

Create `src/features/imports/adapters/asset.ts`:

```ts
import { z } from "zod";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL } from "@/features/assets/domain/assets";
import { textField, enumField, dateField, type TargetField } from "../mapping";
import type { ImportAdapter } from "./risk";

export const ASSET_IMPORT_FIELDS: TargetField[] = [
  textField("reference", "Asset Reference", false, ["Reference"], 40),
  textField("description", "Asset Description", true, ["Description"], 200),
  textField("categoryName", "Category", false, [], 120),
  textField("ownerLocation", "Owner & Location", false, ["Owner", "Location"], 200),
  enumField("classification", "Classification", true, [], ASSET_CLASSIFICATION_LABEL),
  enumField("valueCriticality", "Value (Criticality)", true, ["Value", "Criticality"], ASSET_VALUE_LABEL),
  textField("securityControls", "Security Controls", false, []),
  textField("lifespan", "Asset Lifespan", false, ["Lifespan"], 120),
  dateField("lastUpdated", "Last Updated", false, []),
  textField("remarks", "Remarks", false, []),
];

export const assetRowSchema = z.object({
  reference: z.string().nullable(),
  description: z.string().min(1).max(200),
  categoryName: z.string().nullable(),
  ownerLocation: z.string().nullable(),
  classification: z.enum(["highly_confidential", "confidential", "internal_use_only", "public"]),
  valueCriticality: z.enum(["high", "medium", "low"]),
  securityControls: z.string().nullable(),
  lifespan: z.string().nullable(),
  lastUpdated: z.string().nullable(),
  remarks: z.string().nullable(),
});

export const assetAdapter: ImportAdapter = { module: "asset", label: "Asset inventory", fields: ASSET_IMPORT_FIELDS, rowSchema: assetRowSchema };
```

- [ ] **Step 3: Implement the registry `index.ts`**

Create `src/features/imports/adapters/index.ts`:

```ts
import { riskAdapter, type ImportAdapter, type ImportModule } from "./risk";
import { soaAdapter } from "./soa";
import { assetAdapter } from "./asset";

export type { ImportAdapter, ImportModule };
export const ADAPTERS: Record<ImportModule, ImportAdapter> = { risk: riskAdapter, soa: soaAdapter, asset: assetAdapter };
```

- [ ] **Step 4: Verify + commit**

```bash
npx vitest run src/features/imports && npx eslint src/features/imports && npx tsc --noEmit
git add src/features/imports/adapters/asset.ts src/features/imports/adapters/asset.test.ts src/features/imports/adapters/index.ts
git commit -m "feat: add asset import adapter and the module registry"
```

Expected: all `src/features/imports` tests green; eslint/tsc clean.

---

## Task 6: Server actions + shared `ImportWizard` client component

The server-only `analyseImportAction` (parse + suggest) and `runImportAction` (server-side re-validation, name→id resolution, RLS-scoped batch insert/update), plus the shared four-step wizard component all three pages reuse.

**Files:**
- Create: `src/app/app/imports/actions.ts`
- Create: `src/app/app/imports/import-wizard.tsx`

**Interfaces:**
- Consumes: `requireAppContext` (`@/lib/app-context`), `enforceRateLimit` (`@/lib/security/rate-limit`), `parseWorkbook` (`@/features/imports/parse`), `suggestMapping`/`coerceAndValidate`/`type ColumnMapping`/`type RowResult` (`@/features/imports/mapping`), `ADAPTERS`/`type ImportModule` (`@/features/imports/adapters`), `riskInputSchema`, `assetInputSchema`, `soaItemReviewSchema`, `Card` (`@/components/ui`).
- Produces: `type AnalyseResult = { headers: string[]; rows: string[][]; suggestion: Record<string, string> } | { error: string }`; `type ImportRunResult = { committed: boolean; total: number; valid: number; invalid: number; imported: number; updated: number; skipped: number; rowErrors: { row: number; errors: string[] }[]; notes: string[] }`; `analyseImportAction(formData: FormData): Promise<AnalyseResult>`; `runImportAction(input: { module: ImportModule; headers: string[]; rows: string[][]; mapping: Record<string, string>; commit: boolean; registerId?: string }): Promise<ImportRunResult>`; `function ImportWizard(props): JSX.Element`.

- [ ] **Step 1: Implement `actions.ts` — analyse + resolution helpers**

Create `src/app/app/imports/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { parseWorkbook } from "@/features/imports/parse";
import { coerceAndValidate, suggestMapping, type ColumnMapping, type RowResult } from "@/features/imports/mapping";
import { ADAPTERS, type ImportModule } from "@/features/imports/adapters";
import { riskInputSchema } from "@/features/risks/application/risk";
import { assetInputSchema } from "@/features/assets/application/asset";
import { soaItemReviewSchema } from "@/features/soa/application/review";

export type AnalyseResult = { headers: string[]; rows: string[][]; suggestion: Record<string, string> } | { error: string };
export type ImportRunResult = { committed: boolean; total: number; valid: number; invalid: number; imported: number; updated: number; skipped: number; rowErrors: { row: number; errors: string[] }[]; notes: string[] };

const MODULES = new Set<ImportModule>(["risk", "soa", "asset"]);

export async function analyseImportAction(formData: FormData): Promise<AnalyseResult> {
  await requireAppContext(); // auth gate; parsing needs no org data
  const module = String(formData.get("module")) as ImportModule;
  if (!MODULES.has(module)) return { error: "Unknown import type." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > 5_000_000) return { error: "Files must be 5 MB or smaller." };
  const format = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
  const adapter = ADAPTERS[module];
  try {
    const { headers, rows } = await parseWorkbook(await file.arrayBuffer(), format, adapter.fields.map((f) => f.label));
    if (!headers.length) return { error: "Could not find a header row in that file." };
    const suggestion = suggestMapping(headers, adapter.fields);
    const cleaned: Record<string, string> = {};
    for (const [header, key] of Object.entries(suggestion)) cleaned[header] = key ?? "";
    return { headers, rows: rows.slice(0, 500), suggestion: cleaned };
  } catch {
    return { error: "That file could not be read. Export an XLSX or CSV and try again." };
  }
}

// Case-insensitive name -> id resolver for the per-org category tables; creates a missing category.
async function categoryResolver(supabase: SupabaseClient, table: "risk_categories" | "asset_categories", organisationId: string) {
  const { data } = await supabase.from(table).select("id,name,position");
  const byName = new Map<string, string>();
  let maxPos = -1;
  for (const c of data ?? []) { byName.set(String(c.name).toLowerCase(), String(c.id)); maxPos = Math.max(maxPos, Number(c.position)); }
  return async (name: string): Promise<string | null> => {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    const existing = byName.get(key);
    if (existing) return existing;
    const { data: created } = await supabase.from(table).insert({ organisation_id: organisationId, name: name.trim(), position: ++maxPos }).select("id").single();
    if (created?.id) { byName.set(key, created.id); return created.id; }
    return null;
  };
}

async function memberResolver(supabase: SupabaseClient) {
  const { data } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  const byName = new Map<string, string>();
  for (const m of data ?? []) { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; if (p?.display_name) byName.set(String(p.display_name).toLowerCase(), String(m.user_id)); }
  return (name: string | null): string | null => (name ? byName.get(name.trim().toLowerCase()) ?? null : null);
}
```

- [ ] **Step 2: Implement `runImportAction` in the same file (append below Step 1)**

```ts
export async function runImportAction(input: { module: ImportModule; headers: string[]; rows: string[][]; mapping: Record<string, string>; commit: boolean; registerId?: string }): Promise<ImportRunResult> {
  const { supabase, user, organisation } = await requireAppContext();
  if (!MODULES.has(input.module)) return emptyResult(input.commit);
  if (input.commit) await enforceRateLimit(`import:${user.id}`, { limit: 10, windowMs: 60_000 });
  const adapter = ADAPTERS[input.module];
  const mapping: ColumnMapping = {};
  for (const [header, key] of Object.entries(input.mapping)) mapping[header] = key || null;
  const results = coerceAndValidate(input.headers, input.rows, mapping, adapter.fields, adapter.rowSchema);

  const rowErrors: { row: number; errors: string[] }[] = [];
  const notes: string[] = [];
  let imported = 0, updated = 0, skipped = 0;
  results.forEach((r, i) => { if (!r.ok) rowErrors.push({ row: i + 1, errors: r.errors }); });
  const valid = results.filter((r) => r.ok).length;
  const result: ImportRunResult = { committed: input.commit, total: results.length, valid, invalid: results.length - valid, imported: 0, updated: 0, skipped: 0, rowErrors, notes };
  if (!input.commit) { result.imported = input.module === "soa" ? 0 : valid; result.updated = input.module === "soa" ? valid : 0; return result; }

  if (input.module === "risk") {
    const resolveCategory = await categoryResolver(supabase, "risk_categories", organisation.id);
    const resolveMember = await memberResolver(supabase);
    const { count } = await supabase.from("risks").select("id", { count: "exact", head: true });
    let n = count ?? 0;
    for (const r of results) {
      if (!r.ok) continue;
      const v = r.values as Record<string, string | number | boolean | null>;
      const categoryId = await resolveCategory(String(v.categoryName));
      if (!categoryId) { skipped++; notes.push(`Could not resolve category "${v.categoryName}".`); continue; }
      const reference = (v.reference as string) || `R-${String(++n).padStart(3, "0")}`;
      const parsed = riskInputSchema.parse({
        organisationId: organisation.id, reference, title: String(v.description).slice(0, 200), description: String(v.description),
        categoryId, ownerId: resolveMember(v.ownerName as string | null), likelihood: v.likelihood, impact: v.impact,
        treatment: "mitigate", treatmentPlan: (v.treatmentPlan as string) ?? "", residualLikelihood: v.likelihood, residualImpact: v.impact,
        reviewDate: (v.reviewDate as string) ?? "", status: (v.status as string) ?? "open", evidence: "",
      });
      const { error } = await supabase.from("risks").insert({ organisation_id: organisation.id, reference: parsed.reference, title: parsed.title, description: parsed.description, category_id: parsed.categoryId, owner_id: parsed.ownerId || null, likelihood: parsed.likelihood, impact: parsed.impact, treatment: parsed.treatment, treatment_plan: parsed.treatmentPlan, residual_likelihood: parsed.residualLikelihood, residual_impact: parsed.residualImpact, review_date: parsed.reviewDate || null, status: parsed.status, evidence: parsed.evidence, created_by: user.id });
      if (error) { skipped++; notes.push(`Row ${reference}: ${error.message}`); } else imported++;
    }
    revalidatePath("/app/risks");
  } else if (input.module === "asset") {
    const resolveCategory = await categoryResolver(supabase, "asset_categories", organisation.id);
    const resolveMember = await memberResolver(supabase);
    const { count } = await supabase.from("assets").select("id", { count: "exact", head: true });
    let n = count ?? 0;
    for (const r of results) {
      if (!r.ok) continue;
      const v = r.values as Record<string, string | number | boolean | null>;
      const reference = (v.reference as string) || `AST-${String(++n).padStart(3, "0")}`;
      const parsed = assetInputSchema.parse({
        organisationId: organisation.id, reference, description: String(v.description), ownerLocation: (v.ownerLocation as string) ?? "",
        ownerId: resolveMember(v.ownerLocation as string | null) ?? "", classification: v.classification, valueCriticality: v.valueCriticality,
        categoryId: (v.categoryName ? await resolveCategory(String(v.categoryName)) : null) ?? "", securityControls: (v.securityControls as string) ?? "",
        lifespan: (v.lifespan as string) ?? "", lastUpdated: (v.lastUpdated as string) ?? "", remarks: (v.remarks as string) ?? "",
      });
      const { error } = await supabase.from("assets").insert({ organisation_id: organisation.id, reference: parsed.reference, description: parsed.description, owner_location: parsed.ownerLocation, owner_id: parsed.ownerId, classification: parsed.classification, value_criticality: parsed.valueCriticality, category_id: parsed.categoryId, security_controls: parsed.securityControls, lifespan: parsed.lifespan, last_updated: parsed.lastUpdated, remarks: parsed.remarks, created_by: user.id });
      if (error) { skipped++; notes.push(`Row ${reference}: ${error.message}`); } else imported++;
    }
    revalidatePath("/app/assets");
  } else { // soa — UPDATE matched control_code rows in the selected register
    let registerId = input.registerId;
    if (!registerId) { const { data: latest } = await supabase.from("soa_registers").select("id").order("updated_at", { ascending: false }).limit(1).maybeSingle(); registerId = latest?.id; }
    if (!registerId) { notes.push("No SoA register found to update."); return result; }
    const { data: items } = await supabase.from("soa_items").select("id,control_code").eq("soa_register_id", registerId);
    const byCode = new Map<string, string>(); for (const it of items ?? []) byCode.set(String(it.control_code).toLowerCase(), String(it.id));
    const resolveMember = await memberResolver(supabase);
    for (const r of results) {
      if (!r.ok) continue;
      const v = r.values as Record<string, string | number | boolean | null>;
      const itemId = byCode.get(String(v.controlCode).toLowerCase());
      if (!itemId) { skipped++; notes.push(`Control ${v.controlCode} is not in this register — skipped.`); continue; }
      const parsed = soaItemReviewSchema.parse({ itemId, status: v.status, applicable: v.applicable, justification: v.justification, evidence: (v.comments as string) ?? "" });
      const { error } = await supabase.from("soa_items").update({ status: parsed.status, applicable: parsed.applicable, justification: parsed.justification, evidence: parsed.evidence, owner_id: resolveMember(v.ownerName as string | null) }).eq("id", parsed.itemId);
      if (error) { skipped++; notes.push(`Control ${v.controlCode}: ${error.message}`); } else updated++;
    }
    revalidatePath("/app/soa");
  }
  return { ...result, imported, updated, skipped, notes };
}

function emptyResult(commit: boolean): ImportRunResult { return { committed: commit, total: 0, valid: 0, invalid: 0, imported: 0, updated: 0, skipped: 0, rowErrors: [], notes: [] }; }
```

- [ ] **Step 3: Implement the shared `ImportWizard` client component**

Create `src/app/app/imports/import-wizard.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import type { ImportModule } from "@/features/imports/adapters";
import { analyseImportAction, runImportAction, type AnalyseResult, type ImportRunResult } from "./actions";

type FieldDescriptor = { key: string; label: string; required: boolean };

export function ImportWizard({ module, fields, recordsHref, recordsLabel, registers }: { module: ImportModule; fields: FieldDescriptor[]; recordsHref: string; recordsLabel: string; registers?: { id: string; title: string }[] }) {
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [registerId, setRegisterId] = useState<string>(registers?.[0]?.id ?? "");
  const [preview, setPreview] = useState<ImportRunResult | null>(null);
  const [result, setResult] = useState<ImportRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function analyse(formData: FormData) {
    setError(null); setPreview(null); setResult(null);
    const res: AnalyseResult = await analyseImportAction(formData);
    if ("error" in res) { setError(res.error); return; }
    setHeaders(res.headers); setRows(res.rows); setMapping(res.suggestion);
  }
  function run(commit: boolean) {
    if (!headers) return;
    start(async () => {
      const res = await runImportAction({ module, headers, rows, mapping, commit, registerId: registerId || undefined });
      if (commit) setResult(res); else setPreview(res);
    });
  }

  const noun = module === "soa" ? "control update" : "row";
  return <>
    <Card style={{ padding: "22px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>1. Upload your workbook</h2>
      <form action={(fd) => start(async () => analyse(fd))} style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <input type="hidden" name="module" value={module} />
        {registers && registers.length > 0 && <label style={{ fontSize: "13px", fontWeight: 700 }}>Register<select value={registerId} onChange={(e) => setRegisterId(e.target.value)} style={{ display: "block" }} aria-label="Target SoA register">{registers.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>}
        <input name="file" type="file" accept=".xlsx,.csv" required aria-label="Workbook file (XLSX or CSV)" />
        <button className="button primary" disabled={pending}>Analyse file</button>
      </form>
      {error && <p role="alert" style={{ color: "var(--red)", fontSize: "13px", marginTop: "10px" }}>{error}</p>}
    </Card>

    {headers && <Card style={{ padding: "22px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>2. Map columns</h2>
      <div className="data-table-wrap" role="region" aria-label="Column mapping" tabIndex={0}>
        <table><thead><tr><th>File column</th><th>Maps to</th></tr></thead><tbody>
          {headers.map((h) => <tr key={h}><td>{h}</td><td>
            <select aria-label={`Map column ${h}`} value={mapping[h] ?? ""} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
              <option value="">Ignore this column</option>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>)}
            </select>
          </td></tr>)}
        </tbody></table>
      </div>
      <button className="button secondary" style={{ marginTop: "12px" }} disabled={pending} onClick={() => run(false)}>Preview {rows.length} {noun}{rows.length === 1 ? "" : "s"}</button>
    </Card>}

    {preview && <Card style={{ padding: "22px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>3. Preview &amp; validation</h2>
      <p style={{ fontSize: "13px", margin: "0 0 10px" }}>{preview.valid} valid, {preview.invalid} with errors. {module === "soa" ? `${preview.valid} matched controls will be updated.` : `${preview.valid} rows will be added.`}</p>
      {preview.rowErrors.length > 0 && <ul style={{ fontSize: "12px", color: "var(--red)", margin: "0 0 10px", paddingLeft: "18px" }}>{preview.rowErrors.slice(0, 50).map((e) => <li key={e.row}>Row {e.row}: {e.errors.join("; ")}</li>)}</ul>}
      {preview.valid > 0 && <form action={() => run(true)}><button className="button primary" disabled={pending}>4. Confirm import ({preview.valid})</button></form>}
    </Card>}

    {result && <Card style={{ padding: "22px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 6px" }}>Import complete</h2>
      <p style={{ fontSize: "13px", margin: "0 0 6px" }}>{module === "soa" ? `${result.updated} controls updated` : `${result.imported} rows added`}{result.skipped ? `, ${result.skipped} skipped` : ""}.</p>
      {result.notes.length > 0 && <ul style={{ fontSize: "12px", color: "#596273", margin: "0 0 10px", paddingLeft: "18px" }}>{result.notes.slice(0, 50).map((note, i) => <li key={i}>{note}</li>)}</ul>}
      <Link className="button secondary" href={recordsHref}>View {recordsLabel}</Link>
    </Card>}
  </>;
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx eslint src/app/app/imports src/features/imports && npx tsc --noEmit
git add src/app/app/imports
git commit -m "feat: add import server actions and the shared column-mapping wizard"
```

Expected: eslint/tsc clean. (No runtime test yet — exercised by the per-module e2e in Tasks 7–9.)

---

## Task 7: Risk import page + list-page button + e2e

**Files:**
- Create: `src/app/app/risks/import/page.tsx`
- Modify: `src/app/app/risks/page.tsx` (add an `Import` button to the `PageIntro` action)
- Modify: `src/components/app-shell.tsx` (register the import title)
- Modify: `e2e/product.spec.ts` (risk upload→map→preview→confirm + axe)

**Interfaces:**
- Consumes: `requireAppContext`, `ImportWizard`, `RISK_IMPORT_FIELDS` (`@/features/imports/adapters/risk`).
- Produces: route `/app/risks/import`.

- [ ] **Step 1: Write the risk import page (fragment)**

Create `src/app/app/risks/import/page.tsx`:

```tsx
import { PageIntro } from "@/components/ui";
import { requireAppContext } from "@/lib/app-context";
import { ImportWizard } from "@/app/app/imports/import-wizard";
import { RISK_IMPORT_FIELDS } from "@/features/imports/adapters/risk";

export default async function RiskImportPage() {
  await requireAppContext();
  const fields = RISK_IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }));
  return <>
    <PageIntro eyebrow="RISK" title="Import risk register" body="Upload your existing risk-register workbook, map its columns, preview the validation, then add the rows." />
    <ImportWizard module="risk" fields={fields} recordsHref="/app/risks" recordsLabel="risk register" />
  </>;
}
```

- [ ] **Step 2: Add the `Import` button to the risks list**

In `src/app/app/risks/page.tsx`, inside the `PageIntro` `action` span (which currently holds `Export XLSX`, `CSV`, `Add risk`), add before the `Add risk` link:

```tsx
      <Link className="button secondary" href="/app/risks/import">Import</Link>
```

(`Link` is already imported in this file.)

- [ ] **Step 3: Register the import title (before its parent)**

In `src/components/app-shell.tsx`, insert into the `TITLES` array **before** the `["/app/risks", "Risk register"]` entry:

```tsx
  ["/app/risks/import", "Import risk register"],
```

(Because `TITLES.find` returns the first prefix match, the more specific `/app/risks/import` entry must precede `/app/risks`.)

- [ ] **Step 4: Write the e2e (upload→map→preview→confirm + axe)**

In `e2e/product.spec.ts`, add a test that signs up + creates a workspace (reuse the existing helper pattern in the "an asset is added" test), then:

```ts
  await page.goto("/app/risks/import");
  await expect(page.getByRole("heading", { name: "Import risk register", level: 1 })).toBeVisible();
  const csv = ["Risk ID,Risk Description,Risk Category,Likelihood,Impact,Mitigation Measures,Risk Owner,Status,Review Date",
    "R-501,Imported laptop theft,Operational,3,4,Encrypt disks,,Treating,31/12/2026"].join("\n");
  await page.locator('input[name="file"]').setInputFiles({ name: "risks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Analyse file" }).click();
  await expect(page.getByLabel("Map column Risk Category")).toHaveValue("categoryName");
  await page.getByRole("button", { name: /Preview 1 row/ }).click();
  await expect(page.getByText("1 rows will be added")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: /Confirm import/ }).click();
  await expect(page.getByText(/1 rows added/)).toBeVisible();
  await page.goto("/app/risks");
  await expect(page.getByRole("link", { name: "Imported laptop theft" })).toBeVisible();
```

(`import { Buffer } from "node:buffer";` at the top of the spec if not already available.)

- [ ] **Step 5: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts -g "risk"
git add src/app/app/risks/import src/app/app/risks/page.tsx src/components/app-shell.tsx e2e/product.spec.ts
git commit -m "feat: add the risk register import wizard page and button"
```

Expected: risk import flow green on chromium + mobile; axe clean on `/app/risks/import`; a seeded `Operational` category resolves (or is created) and the imported risk appears.

---

## Task 8: SoA import page + list-page button + e2e

**Files:**
- Create: `src/app/app/soa/import/page.tsx`
- Modify: `src/app/app/soa/page.tsx` (add an `Import` button)
- Modify: `src/components/app-shell.tsx` (register the import title)
- Modify: `e2e/product.spec.ts` (SoA generate-draft → import updates a matched control)

**Interfaces:**
- Consumes: `requireAppContext`, `ImportWizard`, `SOA_IMPORT_FIELDS` (`@/features/imports/adapters/soa`); reads `soa_registers` for the register picker.
- Produces: route `/app/soa/import`.

- [ ] **Step 1: Write the SoA import page (with a register picker)**

Create `src/app/app/soa/import/page.tsx`:

```tsx
import { PageIntro, Card } from "@/components/ui";
import { requireAppContext } from "@/lib/app-context";
import { ImportWizard } from "@/app/app/imports/import-wizard";
import { SOA_IMPORT_FIELDS } from "@/features/imports/adapters/soa";

export default async function SoaImportPage() {
  const { supabase } = await requireAppContext();
  const { data: registers } = await supabase.from("soa_registers").select("id,title").order("updated_at", { ascending: false });
  const fields = SOA_IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }));
  return <>
    <PageIntro eyebrow="SOA" title="Import Statement of Applicability" body="Upload your SoA workbook to update applicability, status, justification and owner on controls that already exist in the selected register. Rows for unknown controls are reported, not added." />
    {registers?.length ? <ImportWizard module="soa" fields={fields} recordsHref="/app/soa" recordsLabel="Statement of Applicability" registers={registers} />
      : <Card style={{ padding: "22px" }}><p style={{ fontSize: "13px", color: "#596273" }}>Generate a SoA draft first — imports update existing controls rather than creating a register.</p></Card>}
  </>;
}
```

- [ ] **Step 2: Add the `Import` button to the SoA list**

In `src/app/app/soa/page.tsx`, inside the `PageIntro` `action` span (currently `Export XLSX`, `CSV`), add:

```tsx
      <Link className="button secondary" href="/app/soa/import">Import</Link>
```

(`Link` is already imported.)

- [ ] **Step 3: Register the import title (before its parent)**

In `src/components/app-shell.tsx`, insert into `TITLES` **before** `["/app/soa", "Statement of Applicability"]`:

```tsx
  ["/app/soa/import", "Import Statement of Applicability"],
```

- [ ] **Step 4: Write the e2e (generate a draft, then import an update to a real control)**

In `e2e/product.spec.ts`, add a test that signs up, creates a workspace, creates an assessment, generates a SoA draft, opens the draft to read a real `control_code`, then imports a CSV updating that control:

```ts
  // ...after Generate draft and landing on /app/soa/<id>:
  const firstHeading = await page.getByRole("heading", { level: 2 }).first().textContent();
  const code = (firstHeading ?? "").split(":")[0].trim(); // "{control_code}: {control_title}"
  await page.goto("/app/soa/import");
  const csv = ["Control Number,Is Control Applicable?,Justification for the Inclusion/Exclusion,Implementation Status,Owner,Comments",
    `${code},Yes,Imported justification,Operational,,Imported note`].join("\n");
  await page.locator('input[name="file"]').setInputFiles({ name: "soa.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Analyse file" }).click();
  await page.getByRole("button", { name: /Preview 1 control update/ }).click();
  await expect(page.getByText("1 matched controls will be updated")).toBeVisible();
  const soaAxe = await new AxeBuilder({ page }).analyze();
  expect(soaAxe.violations).toEqual([]);
  await page.getByRole("button", { name: /Confirm import/ }).click();
  await expect(page.getByText(/1 controls updated/)).toBeVisible();
```

- [ ] **Step 5: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts -g "SoA import"
git add src/app/app/soa/import src/app/app/soa/page.tsx src/components/app-shell.tsx e2e/product.spec.ts
git commit -m "feat: add the SoA import wizard that updates matched controls"
```

Expected: SoA import flow green; the matched control updates (not inserts); axe clean on `/app/soa/import`.

---

## Task 9: Asset import page + list-page button + e2e

**Files:**
- Create: `src/app/app/assets/import/page.tsx`
- Modify: `src/app/app/assets/page.tsx` (add an `Import` button)
- Modify: `src/components/app-shell.tsx` (register the import title)
- Modify: `e2e/product.spec.ts` (asset upload→map→preview→confirm + axe)

**Interfaces:**
- Consumes: `requireAppContext`, `ImportWizard`, `ASSET_IMPORT_FIELDS` (`@/features/imports/adapters/asset`).
- Produces: route `/app/assets/import`.

- [ ] **Step 1: Write the asset import page**

Create `src/app/app/assets/import/page.tsx`:

```tsx
import { PageIntro } from "@/components/ui";
import { requireAppContext } from "@/lib/app-context";
import { ImportWizard } from "@/app/app/imports/import-wizard";
import { ASSET_IMPORT_FIELDS } from "@/features/imports/adapters/asset";

export default async function AssetImportPage() {
  await requireAppContext();
  const fields = ASSET_IMPORT_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }));
  return <>
    <PageIntro eyebrow="ASSETS" title="Import asset inventory" body="Upload your asset workbook, map its columns, preview the validation, then add the assets. Categories are matched or created for you." />
    <ImportWizard module="asset" fields={fields} recordsHref="/app/assets" recordsLabel="asset inventory" />
  </>;
}
```

- [ ] **Step 2: Add the `Import` button to the assets list**

In `src/app/app/assets/page.tsx`, inside the `PageIntro` `action` span, add before `Add asset`:

```tsx
      <Link className="button secondary" href="/app/assets/import">Import</Link>
```

- [ ] **Step 3: Register the import title (before its parent)**

In `src/components/app-shell.tsx`, insert into `TITLES` **before** `["/app/assets", "Asset inventory"]`:

```tsx
  ["/app/assets/import", "Import asset inventory"],
```

- [ ] **Step 4: Write the e2e**

In `e2e/product.spec.ts`, add a test (sign-up + workspace as before) that imports two assets:

```ts
  await page.goto("/app/assets/import");
  await expect(page.getByRole("heading", { name: "Import asset inventory", level: 1 })).toBeVisible();
  const csv = ["Asset Reference,Asset Description,Category,Owner & Location,Classification,Value (Criticality),Security Controls,Asset Lifespan,Last Updated,Remarks",
    "AST-900,Imported CRM,Applications,HQ,Confidential,High,SSO,3 years,05/01/2026,",
    ",Imported backup vault,,Offsite,Highly Confidential,High,,,,"].join("\n");
  await page.locator('input[name="file"]').setInputFiles({ name: "assets.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Analyse file" }).click();
  await expect(page.getByLabel("Map column Classification")).toHaveValue("classification");
  await page.getByRole("button", { name: /Preview 2 rows/ }).click();
  await expect(page.getByText("2 rows will be added")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: /Confirm import/ }).click();
  await expect(page.getByText(/2 rows added/)).toBeVisible();
  await page.goto("/app/assets");
  await expect(page.getByRole("link", { name: "Imported CRM" })).toBeVisible();
```

- [ ] **Step 5: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts -g "asset import"
git add src/app/app/assets/import src/app/app/assets/page.tsx src/components/app-shell.tsx e2e/product.spec.ts
git commit -m "feat: add the asset inventory import wizard page and button"
```

Expected: asset import flow green (blank reference auto-generates `AST-###`; `Applications` category created); axe clean on `/app/assets/import`.

---

## Task 10: Export→import round-trip test (lossless)

Prove the pipeline reverses Phase B's export exactly: build each register's exported XLSX via the shared export helper, parse + coerce it, and assert the coerced values equal the source (for the mapped, non-derived fields).

**Files:**
- Create: `src/features/imports/roundtrip.test.ts`

**Interfaces:**
- Consumes: `toXlsx`/`toCsv`/`type ExportColumn` (`@/features/exports/exports`), `parseWorkbook` (`./parse`), `suggestMapping`/`coerceAndValidate` (`./mapping`), `riskAdapter`/`soaAdapter`/`assetAdapter` (`./adapters/index`), the domain label maps.

- [ ] **Step 1: Write the round-trip test**

Create `src/features/imports/roundtrip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toXlsx, toCsv, type ExportColumn } from "@/features/exports/exports";
import { parseWorkbook } from "./parse";
import { suggestMapping, coerceAndValidate } from "./mapping";
import { riskAdapter } from "./adapters/risk";
import { assetAdapter } from "./adapters/asset";
import { RISK_STATUS_LABEL } from "@/features/risks/domain/risks";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL } from "@/features/assets/domain/assets";

describe("risk export -> import round-trip", () => {
  it("re-imports every mapped field losslessly through XLSX", async () => {
    type R = { reference: string; description: string; category: string; likelihood: number; impact: number; plan: string; owner: string; status: keyof typeof RISK_STATUS_LABEL; review: string };
    const source: R = { reference: "R-001", description: "Data loss", category: "Operational", likelihood: 3, impact: 4, plan: "Encrypt", owner: "Ada Lovelace", status: "treating", review: "2026-12-31" };
    const columns: ExportColumn<R>[] = [
      { header: "Risk ID", value: (r) => r.reference }, { header: "Risk Description", value: (r) => r.description },
      { header: "Risk Category", value: (r) => r.category }, { header: "Likelihood", value: (r) => r.likelihood },
      { header: "Impact", value: (r) => r.impact }, { header: "Risk Rating", value: (r) => r.likelihood * r.impact },
      { header: "Mitigation Measures", value: (r) => r.plan }, { header: "Risk Owner", value: (r) => r.owner },
      { header: "Status", value: (r) => RISK_STATUS_LABEL[r.status] }, { header: "Review Date", value: (r) => r.review },
    ];
    const buffer = await toXlsx("Risk register", columns, [source]);
    const { headers, rows } = await parseWorkbook(buffer, "xlsx", riskAdapter.fields.map((f) => f.label));
    const [row] = coerceAndValidate(headers, rows, suggestMapping(headers, riskAdapter.fields), riskAdapter.fields, riskAdapter.rowSchema);
    expect(row).toEqual({ ok: true, values: { reference: "R-001", description: "Data loss", categoryName: "Operational", likelihood: 3, impact: 4, treatmentPlan: "Encrypt", ownerName: "Ada Lovelace", status: "treating", reviewDate: "2026-12-31" } });
  });
});

describe("asset export -> import round-trip", () => {
  it("survives the CSV formula-injection apostrophe guard", async () => {
    type A = { reference: string; description: string; category: string; ownerLocation: string; classification: keyof typeof ASSET_CLASSIFICATION_LABEL; value: keyof typeof ASSET_VALUE_LABEL };
    const source: A = { reference: "AST-001", description: "=Customer database", category: "Data", ownerLocation: "HQ", classification: "highly_confidential", value: "high" };
    const columns: ExportColumn<A>[] = [
      { header: "Asset Reference", value: (a) => a.reference }, { header: "Asset Description", value: (a) => a.description },
      { header: "Category", value: (a) => a.category }, { header: "Owner & Location", value: (a) => a.ownerLocation },
      { header: "Classification", value: (a) => ASSET_CLASSIFICATION_LABEL[a.classification] }, { header: "Value (Criticality)", value: (a) => ASSET_VALUE_LABEL[a.value] },
      { header: "Security Controls", value: () => "" }, { header: "Asset Lifespan", value: () => "" }, { header: "Last Updated", value: () => "" }, { header: "Remarks", value: () => "" },
    ];
    const csv = toCsv(columns, [source]); // the description exports as '=Customer database (guarded)
    const { headers, rows } = await parseWorkbook(csv, "csv", assetAdapter.fields.map((f) => f.label));
    const [row] = coerceAndValidate(headers, rows, suggestMapping(headers, assetAdapter.fields), assetAdapter.fields, assetAdapter.rowSchema);
    expect(row.ok).toBe(true);
    if (row.ok) { expect(row.values.description).toBe("=Customer database"); expect(row.values.classification).toBe("highly_confidential"); }
  });
});
```

- [ ] **Step 2: Verify + commit**

```bash
npx vitest run src/features/imports && npx tsc --noEmit
git add src/features/imports/roundtrip.test.ts
git commit -m "test: assert export→import round-trips losslessly for risk and asset"
```

Expected: round-trip tests green (the apostrophe guard is stripped on re-import; the derived `Risk Rating` column is correctly ignored by the mapping).

---

## Task 11: Full verification gate + finish the branch

**Files:** none (verification only), plus any minimal e2e reconciliation.

- [ ] **Step 1: Run the full domain + type gate**

```bash
npx eslint . && npx tsc --noEmit && npx vitest run && npx next build
```

Expected: eslint/tsc clean; vitest green (`parse`, `mapping`, three adapters, registry, round-trip suites, plus all pre-existing suites); `next build` succeeds (the client `ImportWizard` compiles; `exceljs` stays out of the client bundle because only the server action imports `parse.ts`).

- [ ] **Step 2: Run the pgTAP gate (unchanged schema)**

```bash
npx supabase test db
```

Expected: existing pgTAP files `001`–`014` still PASS. No new migration was added; do NOT run `db reset`. (If this task ever adds a table, it must ship split RLS + a `capture_audit_event` trigger + a four-verb cross-tenant attack test before merging — see Global Constraints.)

- [ ] **Step 3: Run the full application gate**

```bash
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test
```

Expected: Playwright all PASS on chromium **and** mobile, including the three import flows and their axe checks (`/app/risks/import`, `/app/soa/import`, `/app/assets/import`), and every pre-existing contract (SoA `Generate draft`, assets `Add asset`, risks `Add risk`, the six export downloads). If the privacy pre-commit hook blocks a commit with zero genuine findings, `git commit --no-verify` is permitted.

- [ ] **Step 4: Manual visual check**

With the dev server running, sign in and eyeball each wizard at desktop (1280×900) and mobile (390×844): the four progressively-revealed steps (upload → mapping table → preview with valid/invalid counts + per-row errors → confirm → result summary). Confirm the product design language matches Phase A (cards, `.button` classes, no invented colours), the mapping table scrolls inside its `data-table-wrap` on mobile with no page-level horizontal overflow, and the SoA register picker renders. Upload one of the founder's real workbooks (or a Phase B export) end-to-end.

- [ ] **Step 5: Finish the branch**

Use `superpowers:finishing-a-development-branch` to present merge/PR options. Do not merge without the user's decision.

---

## Self-review notes

- **Spec coverage:** Shared pipeline → Task 1 (`parseWorkbook`/`parseCsv`/`findHeaderRow` + apostrophe strip + header detection), Task 2 (`suggestMapping` + `coerceAndValidate` + `reverseLabels` + field builders). Per-module adapters → Tasks 3 (risk), 4 (SoA + applicable/status refine), 5 (asset + `ADAPTERS` registry). Import actions + wizard pages → Task 6 (`analyseImportAction`/`runImportAction` + resolution helpers + `ImportWizard`), Tasks 7/8/9 (thin `/app/{risks,soa,assets}/import` pages + list-page `Import` buttons + per-module e2e + axe). Round-trip → Task 10. Full gate + finish → Task 11. **11 tasks.**
- **v2 §10 gates baked in:** every write goes through `requireAppContext()` (RLS-scoped, never service role — Task 6); every row is re-validated server-side with `riskInputSchema`/`assetInputSchema`/`soaItemReviewSchema` after name→id resolution (Task 6); each new page has an e2e + axe assertion (Tasks 7–9); domain layers are test-first (Tasks 1–5, 10); copy is en-GB and original (page bodies reworded, not copied from the toolkit). No new tables, so no new pgTAP is required; the constraint for the hypothetical case is stated (Task 11 Step 2).
- **Single source of truth honoured:** coercion reverses the *export* label maps via `reverseLabels(RISK_STATUS_LABEL)` / `reverseLabels(SOA_STATUS_LABEL)` / `reverseLabels(ASSET_CLASSIFICATION_LABEL|ASSET_VALUE_LABEL)` — never a hand-written parallel enum. The `exports.ts` `CSV_FORMULA_INJECTION_PREFIX` apostrophe is stripped in `parseWorkbook` and the round-trip test (Task 10) proves losslessness; the derived `Risk Rating` export column has no matching field, so `suggestMapping` leaves it `null` and it is ignored.
- **SoA is update-only:** `runImportAction`'s `soa` branch matches `soa_items.control_code` in the chosen register and issues `.update(...)`, incrementing `updated`; unmatched codes increment `skipped` with a note; it never inserts. Risk/asset branches are additive, with the wizard preview showing "N rows will be added". The SoA e2e reads a real generated `control_code` off the draft page so the fixture always matches.
- **Purity/bundle boundary verified:** `src/features/imports/**` imports only `zod` + domain label maps (client-safe); `exceljs` is confined to `parse.ts`, imported only by the server action `analyseImportAction`; the client `ImportWizard` receives plain `{key,label,required}` descriptors (no `coerce` functions cross the server→client boundary). `next build` in Task 11 confirms this.
- **Presentation constraints:** wizard pages are fragments (PageIntro emits the section `<h2>`; AppShell owns the `<h1>`); step headings are `<h2>`; the mapping table and preview live in `Card`/`data-table-wrap role=region tabIndex=0`; every interactive control has an accessible name (`aria-label` per mapping select, file input, register picker); only `.button primary/secondary` + existing CSS vars are used. Import titles are inserted into `TITLES` **before** their `/app/<module>` parents (Tasks 7–9 Step 3) because `TITLES.find` returns the first prefix match.
- **Type-name consistency:** `ParsedWorkbook`/`parseWorkbook` (parse); `TargetField`/`FieldCoercion`/`ColumnMapping`/`RowResult`/`reverseLabels`/`suggestMapping`/`coerceAndValidate`/`textField`/`enumField`/`intField`/`boolField`/`dateField` (mapping); `ImportAdapter`/`ImportModule`/`ADAPTERS`/`RISK_IMPORT_FIELDS`/`SOA_IMPORT_FIELDS`/`ASSET_IMPORT_FIELDS` (adapters); `AnalyseResult`/`ImportRunResult`/`analyseImportAction`/`runImportAction`/`ImportWizard` (app/imports) — each defined once and consumed by exact name across tasks.
- **Deliberate signature deviation from the spec:** the spec sketches `coerceAndValidate(rows, mapping, fields, zodSchema)`; this plan uses `coerceAndValidate(headers, rows, mapping, fields, rowSchema?)` — `headers` is required to resolve each header→column, and `rowSchema` is the adapter's *importable-row* schema (pre-resolution: category/owner are names, not ids), because the module's own zod (`riskInputSchema` etc.) needs resolved uuids + `organisationId` and is therefore applied server-side in `runImportAction` after resolution. This satisfies both "validate each row with a zod schema" (per-row, in `coerceAndValidate`) and "re-validate every row server-side with the module's zod schema" (in the action).
- **Could NOT fully turn into a concrete task:** two spec lines were intentionally handled as pragmatic scope rather than new tasks: (1) asset "match owner by name if resolvable" — implemented as a best-effort `memberResolver(ownerLocation)` lookup (Task 6), since the toolkit's single "Owner & Location" free-text column has no reliable owner/location split; and (2) the spec's optional pgTAP "batch insert respects RLS/tenant" test — folded into the existing per-table attack tests (no new table is introduced, so the batch path exercises the same `risks`/`soa_items`/`assets` policies already proven by pgTAP `010`–`014`), per the spec's own "or rely on existing per-table attack tests" allowance. Neither omission drops functionality.
