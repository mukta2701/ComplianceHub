# Phase B — Kill the Spreadsheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach and beat parity with the founder's ISO 27001:2022 toolkit workbooks so no compliance work is left in Excel: structured Risk Treatment Plans (that spawn tasks), a per-workspace risk category taxonomy and configurable RAG banding, the toolkit's 7-value SoA implementation status + per-control owner, a new asset inventory module linked to risks, and XLSX/CSV export for every register. Import (with column mapping) is deferred to Phase B.5.

**Architecture:** Each concern is an additive-then-backfill-then-drop migration (one per numbered file, continuing from `202607020009`) that follows the canonical tenant-table pattern in `202607020003_soa_risks_audit.sql` verbatim: `organisation_id` tenant column, `is_organisation_member(organisation_id)` split RLS (select/insert/update/delete), composite `(id, organisation_id)` FKs or a `validate_*_tenant` BEFORE trigger for cross-table integrity, a `capture_audit_event()` AFTER trigger, and immutability triggers where required. Domain logic (band thresholds, RTP roll-up, SoA readiness weighting, asset enums, export column schemas) lives in `src/features/<area>/domain` with vitest tests written first. Server actions in each feature's `actions.ts` reuse `requireAppContext()` and never bypass RLS. New `/app` pages are fragments in the Phase-A product design language (AppShell owns the single `<main>`+`<h1>`; pages reuse `PageIntro`/`Card`/`Pill`/`Stat` from `src/components/ui.tsx`). Export is one shared `src/features/exports/` helper feeding thin route handlers that mirror the existing SoA snapshot download route.

**Tech Stack:** Next.js 16 (App Router, server components + server actions), React 19, Tailwind v4 + the hand-authored design system in `src/app/globals.css`, Supabase (Postgres 15 + RLS), zod v4, `exceljs` (added in Task 12 for XLSX), Playwright + `@axe-core/playwright`, vitest, pgTAP.

## Global Constraints

- **v2 §10 non-negotiables (every task):** RLS + pgTAP attack tests on EVERY new tenant table (cross-tenant SELECT/INSERT/UPDATE/DELETE denial, tenant-validation/trigger rejection, audit-event capture); tenant-validation + audit triggers on every new table; **domain-first testing** (write the vitest/pgTAP assertion before the implementation); **e2e + axe (zero violations)** on every new page; **en-GB** copy throughout; **ORIGINAL content only** — do NOT copy toolkit cell text verbatim (classification/value help text must be reworded in your own words).
- **Migrations are additive → backfill → drop within one numbered file per concern.** Numbering continues from `202607020009`; this plan assigns `202607020010` … `202607020016` (one per migration task, in task order). Schema changes are tested against the **already-migrated local DB** — do NOT run `npx supabase db reset` (unreliable here due to dual Docker runtimes). Run pgTAP with `npx supabase test db` only.
- **Reuse tokens; never invent colours.** All colour comes from the existing CSS custom properties and `.pill`/`.stat-icon` tone classes. Real `Pill` tones: `blue`(default) `green` `low` `amber` `medium` `red` `high` `critical` `neutral`. Real `Stat` tones: `blue`(default) `green` `amber` `red`. Do not add CSS unless a step explicitly appends a helper to `globals.css`.
- **Single landmark + single h1 per page.** `AppShell` renders the only `<main className="content">` and the only page-title `<h1>`. Every `/app` page returns a **fragment** (no `<main>`, no page-title `<h1>`; section/item headings are `<h2>`/`<h3>`). New titles are registered in `AppShell`'s `TITLES` array.
- **Environment (this machine):**
  - `pnpm` is **not** on `PATH`. Run every tool via `npx <tool>` or `./node_modules/.bin/<tool>`. The `package.json` scripts and `playwright.config.ts`'s `webServer.command: "pnpm dev"` are not usable directly.
  - Playwright has `reuseExistingServer: true` (non-CI). **Before running Playwright, start the dev server yourself:** `./node_modules/.bin/next dev` (background) and wait for `http://127.0.0.1:3000`. Playwright then reuses it.
  - Local Supabase stack runs at `127.0.0.1:54321`. Apply new migrations with `npx supabase migration up` (NOT `db reset`), then run `npx supabase test db`.
  - Integration tests (`**/*.integration.test.{ts,tsx}`) are **excluded** from `npx vitest run` by `vitest.config.ts` — do not rely on them in the domain gate.
  - `.env.local` provides `CRON_SECRET` and `NEXT_PUBLIC_SITE_URL`.
- **Conventional commits, the configured Git author, NO co-author trailer.** The pre-commit privacy hook has known false positives; `git commit --no-verify` is permitted **only** when a commit is blocked with zero genuine findings.
- **Work in this working directory on a Phase-B branch** (created in Task 1). No separate worktree.

### Existing signatures this plan builds on (all verified against the codebase)

- `src/features/risks/domain/risks.ts`: `type RiskRating = 1|2|3|4|5`; `type RiskBand = "low"|"moderate"|"high"|"very_high"`; `calculateRiskScore(likelihood: number, impact: number): number` (throws `RangeError` outside 1–5); `riskBand(score: number): RiskBand` with hardcoded bands **1–4 low, 5–9 moderate, 10–14 high, 15–25 very_high**; `suggestRisksFromGaps(gaps)`. Test asserts `[riskBand(4),riskBand(5),riskBand(10),riskBand(15),riskBand(25)] === ["low","moderate","high","very_high","very_high"]` — **this must keep passing.**
- `src/features/soa/domain/soa.ts`: `type SoaStatus = "implemented"|"partial"|"planned"|"not_applicable"`; `createSoaDraft(assessmentId, responses): SoaDraft` maps answers via `suggestions = { yes:"implemented", partially:"partial", no:"planned", not_applicable:"not_applicable" }`; `createSoaSnapshot(...)`. Consumers of `SoaStatus`: `src/features/soa/application/review.ts` (`soaItemReviewSchema` status enum), `src/features/soa/application/export.ts` (`labels` record), `src/features/soa/application/demo-export.ts` (label record + sample rows).
- `src/features/tasks/domain/tasks.ts`: `type TaskStatus`, `isOverdue(task,today)`, `nextDueDate(dueOn,recurrence)`, `type TaskRecurrence`. **No `TaskSource` TS type exists** — task `source` is ONLY the Postgres enum `public.task_source` (`202607020006_tasks.sql:6`: `'manual','gap','evidence_expiry','policy_review','system'`) and is never zod-validated or user-supplied; server actions hard-code the literal. `SOURCE_LABEL` in `src/app/app/page.tsx:9` is a soft `Record<string,string>` display map.
- `src/app/app/tasks/actions.ts`: `createTaskAction`, `createGapTaskAction` (hard-codes `source:"gap"`, insert columns `organisation_id,title,detail,owner_id,due_on,source,control_id,created_by`), `acceptCalendarSeedAction`, `updateTaskStatusAction`. Task inserts require the owner to be an org member (composite FK `tasks_owner_tenant_fk` → `23503` on violation).
- `src/lib/app-context.ts`: `requireAppContext()` → `{ supabase, user, membership:{organisation_id,role,...}, organisation:{id,name} }`; redirects to `/sign-in` / `/app/onboarding`.
- `src/app/app/actions.ts` (shared `"use server"`): risk actions `createRiskAction`, `deleteRiskAction`, `updateRiskStatusAction`, `acceptRiskSuggestionAction`; SoA `createSoaAction`, `reviewSoaItemAction`, `finaliseSoaAction`. `createRiskAction` parses `riskInputSchema` (`src/features/risks/application/risk.ts`) and inserts `category` (free text) + `owner_id`.
- Canonical DB primitives (`202607020001_foundation.sql`): `public.is_organisation_member(target_organisation_id uuid) returns boolean`; `public.reject_immutable_change()` (raises `P0001`, message from `tg_argv[0]`); `public.capture_audit_event()` (derives `org_id` from the row's `organisation_id` column unless a `case tg_table_name` branch exists). `public.create_organisation_with_owner(name,slug)` (`202607020004`) inserts the org then the owner membership.
- UI: `PageIntro({eyebrow?,title,body,action?})`, `Card(HTMLAttributes)`, `Stat({label,value,detail,tone?})`, `Pill({children,tone?})`, `Ring({value,size?})`, `Progress({value,tone?})` from `src/components/ui.tsx`. `Icon({name})` from `src/components/icons.tsx` — available names: `shield home clipboard file alert settings menu arrow check download plus users lock bell`. Feature list pages import from `@/lib/app-context`, return a fragment starting with `<PageIntro>`, load data via one `await Promise.all([...])`, render tables inside `<Card><div className="data-table-wrap" role="region" aria-label="..." tabIndex={0}>`.
- Download route pattern (`src/app/api/app/soa/[snapshotId]/[format]/route.ts`): auth via `supabase.auth.getUser()`, then `new NextResponse(new Uint8Array(buffer), { headers: { "content-type": ..., "content-disposition": 'attachment; filename="..."', "cache-control": "private, no-store" } })`.

### E2E selector contract — these MUST survive verbatim

From `e2e/product.spec.ts` / `e2e/phase1.spec.ts` (do not weaken):
- **SoA:** `select[name="assessmentId"]`; button **`Generate draft`**; a link matching **`/N open task/`** (e.g. `/1 open task/`) whose ancestor `<form>` contains a heading; each SoA item is a `<form>` with an `<h2>` heading `{control_code}: {control_title}`. Tasks B6/B7 (SoA) MUST preserve all of these.
- **Risks:** link **`Accept as task`**; the from-gap form (`Title`/`Detail`/`Owner`/`Due date`/`Create task`). Tasks B2/B5 (risks) MUST preserve these.
- **Tasks:** table rows resolvable by title, per-row `combobox` + **`Save`**, **`New task`**, **`Add starter calendar`**, **`Overdue`** text. B4 adds a `risk_treatment` source label only.
- **Assessment:** **`New assessment`** button; detail page renders exactly 10 answer comboboxes (owned by the untouched `AssessmentResponseList`).

---

## Workstream B1 — Risk management deepening (Tasks 1–5)

### Task 1: `risk_categories` table + per-org seed + attack tests

Introduce the per-workspace risk category taxonomy. This is the first per-org **seeded** tenant table in the codebase (existing catalogues are global), so it establishes a backfill-existing-orgs + seed-on-org-create pattern reused by Task 8's asset categories.

**Files:**
- Create branch `phase-b-kill-the-spreadsheets`
- Create: `supabase/migrations/202607020010_risk_categories.sql`
- Create: `supabase/tests/database/010_risk_categories.sql`

**Interfaces:**
- Produces: table `public.risk_categories(id, organisation_id, name, position, created_at, updated_at)` with `unique (organisation_id, name)`, `unique (organisation_id, position)`, `unique (id, organisation_id)` (composite-FK target for Task 2); function `public.seed_default_risk_categories()` (AFTER INSERT trigger on `organisations`); split RLS `risk_categories_members_{select,insert,update,delete}`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull --ff-only 2>/dev/null; git checkout -b phase-b-kill-the-spreadsheets
```

Expected: `Switched to a new branch 'phase-b-kill-the-spreadsheets'`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/202607020010_risk_categories.sql`:

```sql
-- Phase B1: per-workspace risk category taxonomy. Replaces the free-text
-- risks.category (migrated in 202607020011). Seeded with the toolkit's 7
-- distinct categories (the toolkit lists "Third-Party/Vendor Risk" twice —
-- deduped here). Members may add/rename their own categories.

create table public.risk_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name),
  unique (organisation_id, position),
  unique (id, organisation_id)
);
create index risk_categories_org_idx on public.risk_categories(organisation_id, position);

-- Default taxonomy applied to every organisation.
create or replace function public.seed_default_risk_categories()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.risk_categories (organisation_id, name, position)
  select new.id, d.name, d.position
  from (values
    ('Data Security', 0), ('Physical Security', 1), ('Compliance', 2),
    ('Access Control', 3), ('Network Security', 4), ('Operational', 5),
    ('Third-Party/Vendor Risk', 6)
  ) as d(name, position);
  return new;
end;
$$;
create trigger organisations_seed_risk_categories after insert on public.organisations
for each row execute function public.seed_default_risk_categories();

-- Backfill every organisation that already exists.
insert into public.risk_categories (organisation_id, name, position)
select o.id, d.name, d.position
from public.organisations o
cross join (values
  ('Data Security', 0), ('Physical Security', 1), ('Compliance', 2),
  ('Access Control', 3), ('Network Security', 4), ('Operational', 5),
  ('Third-Party/Vendor Risk', 6)
) as d(name, position);

create trigger risk_categories_audit after insert or update or delete on public.risk_categories
for each row execute function public.capture_audit_event();

alter table public.risk_categories enable row level security;
create policy risk_categories_members_select on public.risk_categories for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy risk_categories_members_insert on public.risk_categories for insert to authenticated
with check (public.is_organisation_member(organisation_id));
create policy risk_categories_members_update on public.risk_categories for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy risk_categories_members_delete on public.risk_categories for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.risk_categories from anon, authenticated;
grant select, insert, update, delete on public.risk_categories to authenticated;
```

- [ ] **Step 3: Write the pgTAP attack test (assertions before you trust the migration)**

Create `supabase/tests/database/010_risk_categories.sql`:

```sql
begin;
select plan(7);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.risk_categories), 7::bigint, 'org creation seeds 7 default categories, visible to its member');
select is((select count(*) from public.risk_categories where name = 'Third-Party/Vendor Risk'), 1::bigint, 'the toolkit vendor duplicate is deduped to a single category');
select lives_ok(
  $$ insert into public.risk_categories (organisation_id, name, position) values ('20000000-0000-4000-8000-000000000001', 'Custom category', 7) $$,
  'members can add a category in their own tenant');
select throws_ok(
  $$ insert into public.risk_categories (organisation_id, name, position) values ('20000000-0000-4000-8000-000000000002', 'forged', 8) $$,
  '42501', null, 'members cannot add a category in another tenant');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'tenant B cannot read tenant A categories');
select results_eq(
  $$ delete from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant delete affects no rows');
select is(
  (select count(*) from public.audit_events where entity_type = 'risk_categories' and organisation_id = '20000000-0000-4000-8000-000000000002'),
  7::bigint, 'category seeding is audited per tenant');

select * from finish();
rollback;
```

- [ ] **Step 4: Apply and test**

```bash
npx supabase migration up
npx supabase test db
```

Expected: `010_risk_categories.sql .. ok` and all prior test files still pass. If `migration up` reports the migration already applied on a re-run, that is fine.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607020010_risk_categories.sql supabase/tests/database/010_risk_categories.sql
git commit -m "feat: add per-workspace risk category taxonomy with seeded defaults"
```

---

### Task 2: Migrate `risks.category` → `category_id` + wire the category dropdown

Replace the free-text category with a FK into `risk_categories`, preserving every existing value (unmatched free-text values become new categories so nothing is lost). Update the zod schema, the two risk-insert actions, and the risks UI.

**Files:**
- Create: `supabase/migrations/202607020011_risks_category_fk.sql`
- Modify: `src/features/risks/application/risk.ts`
- Modify: `src/app/app/actions.ts` (`createRiskAction`, `acceptRiskSuggestionAction`)
- Modify: `src/app/app/risks/new/page.tsx`
- Modify: `src/app/app/risks/page.tsx`
- Modify: `e2e/product.spec.ts` (only if the new-risk category field breaks an existing assertion — see Step 7)

**Interfaces:**
- Consumes: `public.risk_categories` (Task 1).
- Produces: `risks.category_id uuid references risk_categories(id)` (`risks.category` dropped); `riskInputSchema.categoryId: string (uuid)` replaces `.category`.

- [ ] **Step 1: Write the migration (additive → backfill → drop)**

Create `supabase/migrations/202607020011_risks_category_fk.sql`:

```sql
-- Phase B1: replace risks.category (free text) with a FK into risk_categories.
-- Backfill maps each existing free-text category to a seeded row by
-- case-insensitive name; any unmatched value becomes a new per-org category
-- so no data is lost, then the old column is dropped.

alter table public.risks add column category_id uuid;

-- Any free-text value that does not already match a seeded category becomes a
-- new category for that organisation (appended after existing positions).
insert into public.risk_categories (organisation_id, name, position)
select r.organisation_id, r.category,
  (select coalesce(max(rc.position), -1) + 1 + dense_rank() over (partition by r.organisation_id order by lower(r.category))
   from public.risk_categories rc where rc.organisation_id = r.organisation_id)
from (
  select distinct organisation_id, category from public.risks
) r
where not exists (
  select 1 from public.risk_categories rc
  where rc.organisation_id = r.organisation_id and lower(rc.name) = lower(r.category)
);

update public.risks r
set category_id = rc.id
from public.risk_categories rc
where rc.organisation_id = r.organisation_id and lower(rc.name) = lower(r.category);

alter table public.risks alter column category_id set not null;
alter table public.risks add constraint risks_category_tenant_fk
  foreign key (category_id, organisation_id)
  references public.risk_categories(id, organisation_id) on delete restrict;
alter table public.risks drop column category;
```

Note: `risk_categories` already exposes `unique (id, organisation_id)` (Task 1) so the composite FK is valid. `on delete restrict` prevents deleting an in-use category.

- [ ] **Step 2: Extend the pgTAP test to cover the FK**

Append to `supabase/tests/database/010_risk_categories.sql` (bump `plan(7)` → `plan(8)`, add before `finish()`, acting as tenant A after re-setting the JWT):

```sql
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.risks (organisation_id, reference, title, description, category_id, likelihood, impact, treatment, residual_likelihood, residual_impact, status, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'R-900', 'x', 'y',
       (select id from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000002' limit 1),
       3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a risk cannot reference another tenant''s category');
```

- [ ] **Step 3: Update the zod schema**

In `src/features/risks/application/risk.ts`, replace the `category` line:

```ts
  category: z.string().trim().min(1).max(120), ownerId: z.string().uuid().nullable().optional(),
```

with:

```ts
  categoryId: z.string().uuid(), ownerId: z.string().uuid().nullable().optional(),
```

- [ ] **Step 4: Update the risk-insert actions**

In `src/app/app/actions.ts` `createRiskAction`, change the insert's `category: parsed.category,` to `category_id: parsed.categoryId,`.

In `acceptRiskSuggestionAction`, the generated risk currently sets `category: category?.title ?? "Readiness"`. Replace that with a category lookup that reuses/creates a per-org "Readiness" category, then insert `category_id`. Change the action body's insert region to:

```ts
  const { data: readinessCat } = await supabase.from("risk_categories")
    .select("id").eq("name", "Readiness").maybeSingle();
  let categoryId = readinessCat?.id ?? null;
  if (!categoryId) {
    const { data: maxPos } = await supabase.from("risk_categories").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: created } = await supabase.from("risk_categories")
      .insert({ organisation_id: organisation.id, name: "Readiness", position: (maxPos?.position ?? -1) + 1 })
      .select("id").single();
    categoryId = created?.id ?? null;
  }
```

and in that action's `supabase.from("risks").insert({ ... })` replace `category: category?.title ?? "Readiness",` with `category_id: categoryId,`. (The `category` variable derived from `catalogue_categories` is now unused — delete its declaration to satisfy eslint.)

- [ ] **Step 5: Add the category dropdown to the new-risk form**

`src/app/app/risks/new/page.tsx` is currently a non-async component. Convert it to async, load categories, and render a `<select name="categoryId">`. Replace the whole file with:

```tsx
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { createRiskAction } from "../../actions";

export default async function NewRiskPage() {
  const { supabase } = await requireAppContext();
  const [{ data: categories }, { data: members }] = await Promise.all([
    supabase.from("risk_categories").select("id,name").order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
  ]);
  return <>
    <PageIntro eyebrow="RISK" title="Add risk" body="Score inherent and residual exposure on the documented 5×5 matrix." />
    <form action={createRiskAction} className="card app-form">
      <label>Reference<input name="reference" required maxLength={40} placeholder="R-001" /></label>
      <label>Title<input name="title" required maxLength={200} /></label>
      <label>Description<textarea name="description" required maxLength={10000} /></label>
      <div className="form-grid">
        <label>Category<select name="categoryId" required defaultValue="">{[<option key="" value="" disabled>Select a category</option>, ...(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)]}</select></label>
        <label>Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Likelihood<select name="likelihood" defaultValue="3">{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Impact<select name="impact" defaultValue="3">{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Treatment<select name="treatment" defaultValue="mitigate"><option value="mitigate">Mitigate</option><option value="avoid">Avoid</option><option value="transfer">Transfer</option><option value="accept">Accept</option></select></label>
        <label>Residual likelihood<select name="residualLikelihood" defaultValue="2">{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Residual impact<select name="residualImpact" defaultValue="2">{[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Status<select name="status" defaultValue="open"><option value="open">Open</option><option value="treating">Treating</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select></label>
        <label>Review date<input name="reviewDate" type="date" /></label>
      </div>
      <label>Treatment plan<textarea name="treatmentPlan" maxLength={10000} /></label>
      <button className="button primary">Save risk</button>
    </form>
  </>;
}
```

(If the current `risks/new/page.tsx` already renders these fields with different markup, keep every existing field `name` and only add the `categoryId` select — the field `name`s above are the contract with `riskInputSchema`.)

- [ ] **Step 6: Show the category name in the risks list**

In `src/app/app/risks/page.tsx`, the risks `.select(...)` currently reads `category`. Change it to read the joined category name: replace `,category,` in the select string with `,category_id,risk_categories(name),` and, where the row renders `{r.category}` (the `<small>{r.category}</small>` in the risk cell), replace with:

```tsx
<small>{(Array.isArray(r.risk_categories) ? r.risk_categories[0] : r.risk_categories)?.name ?? "—"}</small>
```

- [ ] **Step 7: Verify**

```bash
npx supabase migration up && npx supabase test db
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
```

Expected: pgTAP green (incl. the new cross-tenant-category assertion); eslint/tsc clean; `product.spec.ts` green on chromium + mobile. If `product.spec.ts` submits the new-risk form and now fails because `categoryId` is required with no default, add a category selection to that test step (the spec creates risks via the gap path or the form — pick the selected category by visible option text). Adjust the **spec** minimally; do not make `categoryId` optional.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/202607020011_risks_category_fk.sql supabase/tests/database/010_risk_categories.sql src/features/risks/application/risk.ts src/app/app/actions.ts src/app/app/risks e2e/product.spec.ts
git commit -m "feat: replace free-text risk category with a controlled taxonomy FK"
```

---

### Task 3: `risk_matrix_config` + configurable `riskBand(score, config)`

Add per-workspace RAG thresholds and rewrite the band domain function to read them, with a default that reproduces today's behaviour exactly.

**Files:**
- Create: `supabase/migrations/202607020012_risk_matrix_config.sql`
- Create: `supabase/tests/database/011_risk_matrix_config.sql`
- Modify: `src/features/risks/domain/risks.ts`
- Modify: `src/features/risks/domain/risks.test.ts`
- Create: `src/app/app/risks/config-actions.ts`
- Modify: `src/app/app/risks/page.tsx`

**Interfaces:**
- Produces: table `public.risk_matrix_config(id, organisation_id unique, low_max, moderate_max, high_max, appetite_threshold?, updated_by, timestamps)`; `type RiskMatrixConfig = { lowMax:number; moderateMax:number; highMax:number; appetite:number|null }`; `const DEFAULT_RISK_MATRIX_CONFIG`; `riskBand(score: number, config?: RiskMatrixConfig): RiskBand`; `exceedsAppetite(score, config): boolean`; `RISK_BAND_LABEL: Record<RiskBand,string>`; server action `updateRiskMatrixConfigAction(formData)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020012_risk_matrix_config.sql`:

```sql
-- Phase B1: per-workspace RAG banding over the 1..25 risk score, plus an
-- optional risk-appetite threshold. One row per organisation, created on
-- demand (the domain falls back to DEFAULT_RISK_MATRIX_CONFIG when absent).

create table public.risk_matrix_config (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  low_max smallint not null default 4 check (low_max between 1 and 23),
  moderate_max smallint not null default 9 check (moderate_max between 2 and 24),
  high_max smallint not null default 14 check (high_max between 3 and 24),
  appetite_threshold smallint check (appetite_threshold between 1 and 25),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id),
  check (low_max < moderate_max and moderate_max < high_max)
);

create trigger risk_matrix_config_audit after insert or update or delete on public.risk_matrix_config
for each row execute function public.capture_audit_event();

alter table public.risk_matrix_config enable row level security;
create policy risk_matrix_config_members_select on public.risk_matrix_config for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy risk_matrix_config_members_insert on public.risk_matrix_config for insert to authenticated
with check (public.is_organisation_member(organisation_id) and updated_by = (select auth.uid()));
create policy risk_matrix_config_members_update on public.risk_matrix_config for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy risk_matrix_config_members_delete on public.risk_matrix_config for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.risk_matrix_config from anon, authenticated;
grant select, insert, update, delete on public.risk_matrix_config to authenticated;
```

- [ ] **Step 2: Write the pgTAP attack test**

Create `supabase/tests/database/011_risk_matrix_config.sql` — same two-tenant header as Task 1 (users `1…0001/0002`, orgs `2…0001/0002`, memberships), then `plan(5)`:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.risk_matrix_config (organisation_id, low_max, moderate_max, high_max, updated_by)
     values ('20000000-0000-4000-8000-000000000001', 4, 9, 14, '10000000-0000-4000-8000-000000000001') $$,
  'members can create their own config');
select throws_ok(
  $$ insert into public.risk_matrix_config (organisation_id, low_max, moderate_max, high_max, updated_by)
     values ('20000000-0000-4000-8000-000000000001', 9, 4, 14, '10000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'thresholds must be strictly increasing');
select throws_ok(
  $$ insert into public.risk_matrix_config (organisation_id, low_max, moderate_max, high_max, updated_by)
     values ('20000000-0000-4000-8000-000000000002', 4, 9, 14, '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot create config for another tenant');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.risk_matrix_config where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'config is read-isolated per tenant');
select is((select count(*) from public.audit_events where entity_type = 'risk_matrix_config'), 1::bigint, 'config writes are audited');
```

- [ ] **Step 3: Rewrite the band domain (test first)**

In `src/features/risks/domain/risks.test.ts`, ADD a describe block (keep the existing `riskBand` assertions untouched — they call `riskBand(score)` with one arg and must still pass):

```ts
import { DEFAULT_RISK_MATRIX_CONFIG, exceedsAppetite, riskBand } from "./risks";

describe("configurable riskBand", () => {
  it("default config reproduces the legacy bands", () => {
    expect([riskBand(4), riskBand(5), riskBand(10), riskBand(15), riskBand(25)]).toEqual(["low", "moderate", "high", "very_high", "very_high"]);
  });
  it("honours custom thresholds", () => {
    const config = { lowMax: 2, moderateMax: 6, highMax: 12, appetite: 8 };
    expect([riskBand(2, config), riskBand(3, config), riskBand(7, config), riskBand(13, config)]).toEqual(["low", "moderate", "high", "very_high"]);
  });
  it("flags scores above appetite", () => {
    expect(exceedsAppetite(9, { ...DEFAULT_RISK_MATRIX_CONFIG, appetite: 8 })).toBe(true);
    expect(exceedsAppetite(8, { ...DEFAULT_RISK_MATRIX_CONFIG, appetite: 8 })).toBe(false);
    expect(exceedsAppetite(25, DEFAULT_RISK_MATRIX_CONFIG)).toBe(false); // null appetite ⇒ never exceeded
  });
});
```

Then in `src/features/risks/domain/risks.ts`, replace the current `riskBand` function with:

```ts
export type RiskMatrixConfig = { lowMax: number; moderateMax: number; highMax: number; appetite: number | null };
export const DEFAULT_RISK_MATRIX_CONFIG: RiskMatrixConfig = { lowMax: 4, moderateMax: 9, highMax: 14, appetite: null };
export const RISK_BAND_LABEL: Record<RiskBand, string> = { low: "Low", moderate: "Medium", high: "High", very_high: "Critical" };

export function riskBand(score: number, config: RiskMatrixConfig = DEFAULT_RISK_MATRIX_CONFIG): RiskBand {
  if (!Number.isInteger(score) || score < 1 || score > 25) throw new RangeError("Risk score must be between 1 and 25");
  if (score <= config.lowMax) return "low";
  if (score <= config.moderateMax) return "moderate";
  if (score <= config.highMax) return "high";
  return "very_high";
}

export function exceedsAppetite(score: number, config: RiskMatrixConfig): boolean {
  return config.appetite !== null && score > config.appetite;
}
```

- [ ] **Step 4: Add the config server action**

Create `src/app/app/risks/config-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAppContext } from "@/lib/app-context";

const configSchema = z.object({
  lowMax: z.coerce.number().int().min(1).max(23),
  moderateMax: z.coerce.number().int().min(2).max(24),
  highMax: z.coerce.number().int().min(3).max(24),
  appetite: z.union([z.coerce.number().int().min(1).max(25), z.literal("")]).transform((v) => (v === "" ? null : v)),
}).refine((v) => v.lowMax < v.moderateMax && v.moderateMax < v.highMax, { message: "Thresholds must increase" });

export async function updateRiskMatrixConfigAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const parsed = configSchema.parse(Object.fromEntries(formData));
  const { error } = await supabase.from("risk_matrix_config").upsert({
    organisation_id: organisation.id, low_max: parsed.lowMax, moderate_max: parsed.moderateMax,
    high_max: parsed.highMax, appetite_threshold: parsed.appetite, updated_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "organisation_id" });
  if (error) throw new Error("Could not update the risk matrix configuration");
  revalidatePath("/app/risks");
}
```

- [ ] **Step 5: Read config + render RAG bands and a config editor in the risks list**

In `src/app/app/risks/page.tsx`:
- Add imports: `import { calculateRiskScore, riskBand, exceedsAppetite, RISK_BAND_LABEL, DEFAULT_RISK_MATRIX_CONFIG, type RiskMatrixConfig } from "@/features/risks/domain/risks";` and `import { updateRiskMatrixConfigAction } from "./config-actions";`.
- Add a config read to the `Promise.all`: `supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").maybeSingle()`.
- After destructuring, build the config: `const config: RiskMatrixConfig = cfg ? { lowMax: cfg.low_max, moderateMax: cfg.moderate_max, highMax: cfg.high_max, appetite: cfg.appetite_threshold } : DEFAULT_RISK_MATRIX_CONFIG;`
- Keep `BAND_TONE` but ensure it maps every band key: `const BAND_TONE: Record<string, string> = { low: "green", moderate: "amber", high: "red", very_high: "critical" };`
- Replace each inherent/residual score cell with a labelled RAG pill using the config, e.g.:

```tsx
{(() => { const inherent = calculateRiskScore(r.likelihood, r.impact); const band = riskBand(inherent, config); return <Pill tone={exceedsAppetite(inherent, config) ? "critical" : (BAND_TONE[band] ?? "neutral")}>{inherent} · {RISK_BAND_LABEL[band]}</Pill>; })()}
```

- Add a compact config editor `<Card>` above the table:

```tsx
<Card style={{ padding: "18px", marginBottom: "16px" }}>
  <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>RAG band thresholds</h2>
  <p style={{ fontSize: "12px", color: "#596273", margin: "0 0 12px" }}>Set the top of each band on the 1–25 scale. Scores above your appetite are flagged Critical.</p>
  <form action={updateRiskMatrixConfigAction} style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "end" }}>
    <label style={{ fontSize: "12px", fontWeight: 700 }}>Low ≤<input name="lowMax" type="number" min={1} max={23} defaultValue={config.lowMax} style={{ display: "block", width: "72px" }} /></label>
    <label style={{ fontSize: "12px", fontWeight: 700 }}>Medium ≤<input name="moderateMax" type="number" min={2} max={24} defaultValue={config.moderateMax} style={{ display: "block", width: "72px" }} /></label>
    <label style={{ fontSize: "12px", fontWeight: 700 }}>High ≤<input name="highMax" type="number" min={3} max={24} defaultValue={config.highMax} style={{ display: "block", width: "72px" }} /></label>
    <label style={{ fontSize: "12px", fontWeight: 700 }}>Appetite<input name="appetite" type="number" min={1} max={25} defaultValue={config.appetite ?? ""} style={{ display: "block", width: "72px" }} /></label>
    <button className="button secondary">Save thresholds</button>
  </form>
</Card>
```

- [ ] **Step 6: Verify**

```bash
npx supabase migration up && npx supabase test db
npx eslint . && npx tsc --noEmit && npx vitest run src/features/risks
npx playwright test e2e/product.spec.ts
```

Expected: pgTAP `011` green; the legacy `riskBand` test AND the new configurable tests pass; product spec still green (risks page renders RAG pills + the threshold form).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202607020012_risk_matrix_config.sql supabase/tests/database/011_risk_matrix_config.sql src/features/risks/domain src/app/app/risks
git commit -m "feat: add configurable RAG band thresholds and risk appetite"
```

---

### Task 4: `risk_treatment_plans` table + `rtp_status` enum + `risk_treatment` task source

Create the RTP entity (mirroring the toolkit's separate Risk Treatment Plan sheet) with composite-FK tenant integrity, and extend the task-source enum so RTPs can spawn tasks in Task 5.

**Files:**
- Create: `supabase/migrations/202607020013_risk_treatment_plans.sql`
- Create: `supabase/migrations/202607020014_task_source_risk_treatment.sql`
- Create: `supabase/tests/database/012_risk_treatment_plans.sql`

**Interfaces:**
- Produces: enum `public.rtp_status` (`planned`,`in_progress`,`completed`,`cancelled`); table `public.risk_treatment_plans(id, organisation_id, risk_id, reference, summary, treatment_measures, control_id?, assigned_lead_id?, target_completion?, actual_completion?, status, created_by, timestamps)` with `unique (organisation_id, reference)`; `public.task_source` gains value `risk_treatment`.

- [ ] **Step 1: Write the RTP migration**

Create `supabase/migrations/202607020013_risk_treatment_plans.sql`:

```sql
-- Phase B1: Risk Treatment Plans — the toolkit models treatment as a separate
-- sheet (RTP Ref -> Risk No., Target/Actual Completion). First-class linked
-- entity; may spawn a task (source 'risk_treatment') via the tasks engine.

create type public.rtp_status as enum ('planned', 'in_progress', 'completed', 'cancelled');

create table public.risk_treatment_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  risk_id uuid not null,
  reference text not null check (char_length(reference) between 1 and 40),
  summary text not null default '' check (char_length(summary) <= 2000),
  treatment_measures text not null default '' check (char_length(treatment_measures) <= 10000),
  control_id uuid references public.controls(id) on delete set null,
  assigned_lead_id uuid,
  target_completion date,
  actual_completion date,
  status public.rtp_status not null default 'planned',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, reference),
  unique (id, organisation_id),
  constraint rtp_risk_tenant_fk foreign key (risk_id, organisation_id)
    references public.risks(id, organisation_id) on delete cascade,
  constraint rtp_lead_tenant_fk foreign key (organisation_id, assigned_lead_id)
    references public.memberships(organisation_id, user_id) on delete set null (assigned_lead_id)
);
create index rtp_org_risk_idx on public.risk_treatment_plans(organisation_id, risk_id);

create trigger risk_treatment_plans_audit after insert or update or delete on public.risk_treatment_plans
for each row execute function public.capture_audit_event();

alter table public.risk_treatment_plans enable row level security;
create policy rtp_members_select on public.risk_treatment_plans for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy rtp_members_insert on public.risk_treatment_plans for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy rtp_members_update on public.risk_treatment_plans for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy rtp_members_delete on public.risk_treatment_plans for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.risk_treatment_plans from anon, authenticated;
grant select, insert, update, delete on public.risk_treatment_plans to authenticated;
```

- [ ] **Step 2: Write the enum-extension migration (kept separate)**

Create `supabase/migrations/202607020014_task_source_risk_treatment.sql`:

```sql
-- Phase B1: RTPs spawn tasks via the existing tasks engine. This adds the only
-- new task source. Kept in its own migration so the value is committed before
-- any code inserts it (a freshly added enum value cannot be used in the same
-- transaction that adds it).

alter type public.task_source add value if not exists 'risk_treatment';
```

- [ ] **Step 3: Write the pgTAP attack test**

Create `supabase/tests/database/012_risk_treatment_plans.sql` — two-tenant header (users/orgs/memberships as in Task 1), plus one risk per tenant, then `plan(6)`:

```sql
insert into public.risk_categories (organisation_id, name, position) values
  ('20000000-0000-4000-8000-000000000001', 'Data Security', 0),
  ('20000000-0000-4000-8000-000000000002', 'Data Security', 0);
insert into public.risks (id, organisation_id, reference, title, description, category_id, likelihood, impact, treatment, residual_likelihood, residual_impact, status, created_by) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'R-001', 'Risk A', 'desc', (select id from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000001'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'R-001', 'Risk B', 'desc', (select id from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000002'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.risk_treatment_plans (organisation_id, risk_id, reference, created_by, assigned_lead_id)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'RTP-001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members create an RTP for their own risk');
select throws_ok(
  $$ insert into public.risk_treatment_plans (organisation_id, risk_id, reference, created_by)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'RTP-002', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'an RTP cannot link a risk from another tenant');
select throws_ok(
  $$ insert into public.risk_treatment_plans (organisation_id, risk_id, reference, created_by, assigned_lead_id)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'RTP-003', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'the assigned lead must be an organisation member');
select throws_ok(
  $$ insert into public.risk_treatment_plans (organisation_id, risk_id, reference, created_by)
     values ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'RTP-004', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot create an RTP in another tenant');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.risk_treatment_plans where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'RTPs are read-isolated per tenant');
select is((select count(*) from public.audit_events where entity_type = 'risk_treatment_plans' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'RTP writes are audited');
```

- [ ] **Step 4: Apply and test**

```bash
npx supabase migration up
npx supabase test db
```

Expected: `012_risk_treatment_plans.sql .. ok`; `007_tasks.sql` still green (enum extension is backward-compatible).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607020013_risk_treatment_plans.sql supabase/migrations/202607020014_task_source_risk_treatment.sql supabase/tests/database/012_risk_treatment_plans.sql
git commit -m "feat: add risk treatment plans and a risk_treatment task source"
```

---

### Task 5: RTP domain, server actions (spawns a task), and the risk detail page

Add the RTP roll-up domain fn, the RTP server actions (create with optional task spawn via the existing engine, update status, delete), and a NEW `/app/risks/[id]` detail page that surfaces facts + an RTP section. Also register the `risk_treatment` label on the dashboard source map.

**Files:**
- Create: `src/features/risks/domain/rtp.ts`
- Create: `src/features/risks/domain/rtp.test.ts`
- Create: `src/features/risks/application/rtp.ts`
- Create: `src/app/app/risks/[id]/page.tsx`
- Create: `src/app/app/risks/rtp-actions.ts`
- Modify: `src/app/app/risks/page.tsx` (link each risk row to its detail page)
- Modify: `src/app/app/page.tsx` (add `risk_treatment` to `SOURCE_LABEL`)
- Modify: `e2e/product.spec.ts` (add: create RTP → task spawned)

**Interfaces:**
- Consumes: `risk_treatment_plans`, `risks`, `tasks` (source `risk_treatment`), `requireAppContext`.
- Produces: `type RtpStatus`; `summariseRtpProgress(plans): { total; completed; open; allComplete }`; `rtpInputSchema`; actions `createRtpAction`, `updateRtpStatusAction`, `deleteRtpAction`.

- [ ] **Step 1: Write the RTP domain test then the domain**

Create `src/features/risks/domain/rtp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summariseRtpProgress } from "./rtp";

describe("summariseRtpProgress", () => {
  it("reports zero for no plans and never claims completion", () => {
    expect(summariseRtpProgress([])).toEqual({ total: 0, completed: 0, open: 0, allComplete: false });
  });
  it("counts completed/cancelled as closed and flags all-complete", () => {
    expect(summariseRtpProgress([{ status: "completed" }, { status: "cancelled" }])).toEqual({ total: 2, completed: 1, open: 0, allComplete: true });
  });
  it("reports open work while any plan is planned or in progress", () => {
    expect(summariseRtpProgress([{ status: "completed" }, { status: "in_progress" }])).toEqual({ total: 2, completed: 1, open: 1, allComplete: false });
  });
});
```

Create `src/features/risks/domain/rtp.ts`:

```ts
export type RtpStatus = "planned" | "in_progress" | "completed" | "cancelled";
export const RTP_STATUS_LABEL: Record<RtpStatus, string> = { planned: "Planned", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
export const RTP_STATUS_TONE: Record<RtpStatus, string> = { planned: "neutral", in_progress: "amber", completed: "green", cancelled: "neutral" };

export function summariseRtpProgress(plans: readonly { status: RtpStatus }[]): { total: number; completed: number; open: number; allComplete: boolean } {
  const total = plans.length;
  const completed = plans.filter((p) => p.status === "completed").length;
  const cancelled = plans.filter((p) => p.status === "cancelled").length;
  const open = total - completed - cancelled;
  return { total, completed, open, allComplete: total > 0 && open === 0 };
}
```

- [ ] **Step 2: Write the RTP zod schema**

Create `src/features/risks/application/rtp.ts`:

```ts
import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => (v ? v : null));

export const rtpInputSchema = z.object({
  organisationId: z.string().uuid(),
  riskId: z.string().uuid(),
  reference: z.string().trim().min(1).max(40),
  summary: z.string().max(2000).default(""),
  treatmentMeasures: z.string().max(10_000).default(""),
  controlId: optionalUuid,
  assignedLeadId: optionalUuid,
  targetCompletion: optionalDate,
  status: z.enum(["planned", "in_progress", "completed", "cancelled"]).default("planned"),
  spawnTask: z.union([z.literal("on"), z.literal("")]).optional().transform((v) => v === "on"),
});
export type RtpInput = z.infer<typeof rtpInputSchema>;
```

- [ ] **Step 3: Write the RTP server actions (create spawns a task)**

Create `src/app/app/risks/rtp-actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { rtpInputSchema } from "@/features/risks/application/rtp";

export async function createRtpAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`rtp:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = rtpInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("risk_treatment_plans").insert({
    organisation_id: organisation.id, risk_id: parsed.riskId, reference: parsed.reference, summary: parsed.summary,
    treatment_measures: parsed.treatmentMeasures, control_id: parsed.controlId, assigned_lead_id: parsed.assignedLeadId,
    target_completion: parsed.targetCompletion, status: parsed.status, created_by: user.id,
  });
  if (error) throw new Error("Could not save the treatment plan");
  // Optionally spawn a task through the existing tasks engine (source risk_treatment).
  if (parsed.spawnTask) {
    const { error: taskError } = await supabase.from("tasks").insert({
      organisation_id: organisation.id, title: `Treatment plan ${parsed.reference}`,
      detail: parsed.treatmentMeasures || parsed.summary, owner_id: parsed.assignedLeadId,
      due_on: parsed.targetCompletion, source: "risk_treatment", control_id: parsed.controlId,
      risk_id: parsed.riskId, created_by: user.id,
    });
    if (taskError) throw new Error("Saved the plan but could not create its task");
  }
  revalidatePath(`/app/risks/${parsed.riskId}`); revalidatePath("/app/tasks");
  redirect(`/app/risks/${parsed.riskId}`);
}

export async function updateRtpStatusAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const status = String(formData.get("status"));
  if (!["planned", "in_progress", "completed", "cancelled"].includes(status)) throw new Error("Invalid RTP status");
  const riskId = String(formData.get("riskId"));
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "completed") patch.actual_completion = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("risk_treatment_plans").update(patch).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not update the treatment plan");
  revalidatePath(`/app/risks/${riskId}`);
}

export async function deleteRtpAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const riskId = String(formData.get("riskId"));
  await supabase.from("risk_treatment_plans").delete().eq("id", String(formData.get("id")));
  revalidatePath(`/app/risks/${riskId}`);
}
```

- [ ] **Step 4: Create the risk detail page with the RTP section**

Create `src/app/app/risks/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { calculateRiskScore, riskBand, RISK_BAND_LABEL, DEFAULT_RISK_MATRIX_CONFIG, type RiskMatrixConfig } from "@/features/risks/domain/risks";
import { summariseRtpProgress, RTP_STATUS_LABEL, RTP_STATUS_TONE, type RtpStatus } from "@/features/risks/domain/rtp";
import { Card, PageIntro, Pill } from "@/components/ui";
import { createRtpAction, updateRtpStatusAction, deleteRtpAction } from "../rtp-actions";

export default async function RiskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAppContext();
  const { data: risk } = await supabase.from("risks").select("id,reference,title,description,likelihood,impact,residual_likelihood,residual_impact,status,review_date,treatment,treatment_plan,risk_categories(name)").eq("id", id).maybeSingle();
  if (!risk) notFound();
  const [{ data: plans }, { data: cfg }, { data: members }, { data: controls }] = await Promise.all([
    supabase.from("risk_treatment_plans").select("id,reference,summary,treatment_measures,status,target_completion,actual_completion,assigned_lead_id,profiles:assigned_lead_id(display_name)").eq("risk_id", id).order("reference"),
    supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").maybeSingle(),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
    supabase.from("controls").select("id,code,title").order("position"),
  ]);
  const config: RiskMatrixConfig = cfg ? { lowMax: cfg.low_max, moderateMax: cfg.moderate_max, highMax: cfg.high_max, appetite: cfg.appetite_threshold } : DEFAULT_RISK_MATRIX_CONFIG;
  const category = Array.isArray(risk.risk_categories) ? risk.risk_categories[0] : risk.risk_categories;
  const inherent = calculateRiskScore(risk.likelihood, risk.impact);
  const residual = calculateRiskScore(risk.residual_likelihood, risk.residual_impact);
  const progress = summariseRtpProgress((plans ?? []).map((p) => ({ status: p.status as RtpStatus })));
  const nextRef = `RTP-${String((plans?.length ?? 0) + 1).padStart(3, "0")}`;
  return <>
    <Link href="/app/risks" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to risks</Link>
    <PageIntro eyebrow={`RISK ${risk.reference}`} title={risk.title} body={risk.description} />
    <Card style={{ padding: "22px" }}><dl className="fact-grid">
      <div><dt>Category</dt><dd>{category?.name ?? "—"}</dd></div>
      <div><dt>Inherent</dt><dd>{inherent} · {RISK_BAND_LABEL[riskBand(inherent, config)]}</dd></div>
      <div><dt>Residual</dt><dd>{residual} · {RISK_BAND_LABEL[riskBand(residual, config)]}</dd></div>
      <div><dt>Status</dt><dd style={{ textTransform: "capitalize" }}>{risk.status}</dd></div>
      <div><dt>Treatment</dt><dd style={{ textTransform: "capitalize" }}>{risk.treatment}</dd></div>
      <div><dt>Review date</dt><dd>{risk.review_date ?? "—"}</dd></div>
    </dl></Card>
    <Card style={{ padding: "22px", marginTop: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div><h2 style={{ fontSize: "15px", margin: 0 }}>Treatment plans</h2><p style={{ fontSize: "12px", color: "#596273", margin: "3px 0 0" }}>{progress.total} plan(s) · {progress.open} open{progress.allComplete ? " · all complete" : ""}</p></div>
        {progress.allComplete && <Pill tone="green">All plans complete</Pill>}
      </div>
      <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gap: "10px" }}>
        {plans?.map((p) => { const lead = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles; return <li key={p.id} className="card" style={{ padding: "14px", display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <span><b>{p.reference}</b>{p.summary && <> — {p.summary}</>}<small style={{ display: "block", color: "#596273" }}>Lead: {lead?.display_name ?? "Unassigned"}{p.target_completion ? ` · target ${p.target_completion}` : ""}{p.actual_completion ? ` · done ${p.actual_completion}` : ""}</small></span>
          <span style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Pill tone={RTP_STATUS_TONE[p.status as RtpStatus]}>{RTP_STATUS_LABEL[p.status as RtpStatus]}</Pill>
            <form action={updateRtpStatusAction} style={{ display: "flex", gap: "6px", alignItems: "center" }}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="riskId" value={id} /><select name="status" defaultValue={p.status} aria-label={`Status for ${p.reference}`}><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Save</button></form>
            <form action={deleteRtpAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="riskId" value={id} /><button style={{ color: "var(--red)", border: 0, background: "none" }} aria-label={`Delete ${p.reference}`}>Delete</button></form>
          </span>
        </li>; })}
        {!plans?.length && <li style={{ color: "#596273", fontSize: "13px" }}>No treatment plans yet.</li>}
      </ul>
      <form action={createRtpAction} className="app-form" style={{ marginTop: "16px", padding: "16px", borderTop: "1px solid #edf0f4" }}>
        <input type="hidden" name="riskId" value={id} />
        <h3 style={{ fontSize: "13px", margin: 0 }}>Add a treatment plan</h3>
        <div className="form-grid">
          <label>Reference<input name="reference" required maxLength={40} defaultValue={nextRef} /></label>
          <label>Assigned lead<select name="assignedLeadId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
          <label>Control reference<select name="controlId" defaultValue=""><option value="">None</option>{controls?.map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title}</option>)}</select></label>
          <label>Target completion<input name="targetCompletion" type="date" /></label>
        </div>
        <label>Summary<input name="summary" maxLength={2000} /></label>
        <label>Treatment measures<textarea name="treatmentMeasures" maxLength={10000} /></label>
        <label style={{ display: "flex", gap: "8px", alignItems: "center", flexDirection: "row" }}><input type="checkbox" name="spawnTask" value="on" style={{ width: "auto", margin: 0 }} />Also create an owned, dated task for this plan</label>
        <button className="button primary">Add treatment plan</button>
      </form>
    </Card>
  </>;
}
```

- [ ] **Step 5: Link risk rows to the detail page + register the source label**

In `src/app/app/risks/page.tsx`, make the risk title cell link to the detail page: wrap the `<b>{r.title}</b>` in `<Link href={`/app/risks/${r.id}`}>…</Link>`.

In `src/app/app/page.tsx`, add `risk_treatment: "From a treatment plan"` to the `SOURCE_LABEL` record (line ~9) so overdue RTP tasks are labelled on the dashboard needs-attention queue.

- [ ] **Step 6: Register the risk detail title in AppShell**

In `src/components/app-shell.tsx`, add to `TITLES` (before the trailing `["/app", "Dashboard"]`): `["/app/risks", "Risk register"]` already exists and matches `/app/risks/<id>` via `isActive`'s `startsWith`, so no change is needed — confirm the detail page's `<h1>` reads "Risk register". (No edit if already present.)

- [ ] **Step 7: Add the e2e (create RTP → task spawned)**

In `e2e/product.spec.ts`, after the risk-creation flow, add a step that opens a risk's detail page, fills the RTP form (Reference, tick "Also create… task", set Target completion + Assigned lead), submits, and asserts (a) the RTP row appears and (b) `/app/tasks` shows a task titled `Treatment plan RTP-001`. Assert zero axe violations on `/app/risks/<id>`:

```ts
import AxeBuilder from "@axe-core/playwright";
// … navigate to the created risk's detail page …
await page.getByLabel("Reference").fill("RTP-001");
await page.getByLabel(/create an owned, dated task/).check();
await page.getByLabel("Target completion").fill("2026-12-31");
await page.getByRole("button", { name: "Add treatment plan" }).click();
await expect(page.getByText("RTP-001")).toBeVisible();
const axe = await new AxeBuilder({ page }).analyze();
expect(axe.violations).toEqual([]);
await page.goto("/app/tasks");
await expect(page.getByText("Treatment plan RTP-001")).toBeVisible();
```

- [ ] **Step 8: Verify**

```bash
npx eslint . && npx tsc --noEmit && npx vitest run src/features/risks
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
```

Expected: RTP domain tests pass; product spec green on chromium + mobile including the RTP→task flow and axe.

- [ ] **Step 9: Commit**

```bash
git add src/features/risks src/app/app/risks src/app/app/page.tsx src/components/app-shell.tsx e2e/product.spec.ts
git commit -m "feat: add risk treatment plans that spawn tasks and a risk detail page"
```

---

## Workstream B2 — SoA upgrade (Tasks 6–7)

### Task 6: 7-value `soa_implementation_status` enum + `owner_id` migration

Replace the 4-value `soa_status` with the toolkit's 7 values, migrating existing rows by the documented mapping, and add a per-control owner.

**Files:**
- Create: `supabase/migrations/202607020015_soa_implementation_status.sql`
- Create: `supabase/tests/database/013_soa_implementation_status.sql`

**Interfaces:**
- Produces: enum `public.soa_implementation_status` (`pending`,`absent`,`in_progress`,`established`,`operational`,`advanced`,`not_applicable`); `soa_items.status` retyped (mapping: `implemented→operational`, `partial→in_progress`, `planned→pending`, `not_applicable→not_applicable`); `soa_items.owner_id uuid` (member-tenant composite FK); old `soa_status` type dropped; the applicable/not-applicable check re-added as `soa_items_applicable_status_check`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020015_soa_implementation_status.sql`:

```sql
-- Phase B2: adopt the toolkit's 7-value implementation status and add a
-- per-control owner. Mapping old -> new (reversible, documented):
--   implemented -> operational, partial -> in_progress,
--   planned -> pending, not_applicable -> not_applicable.

create type public.soa_implementation_status as enum
  ('pending', 'absent', 'in_progress', 'established', 'operational', 'advanced', 'not_applicable');

-- Drop the table-level applicable/status check (name is server-generated, so
-- discover it by definition) and the column default before retyping.
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'public.soa_items'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%applicable%not_applicable%';
  if cname is not null then execute format('alter table public.soa_items drop constraint %I', cname); end if;
end $$;
alter table public.soa_items alter column status drop default;

alter table public.soa_items alter column status type public.soa_implementation_status using (
  case status::text
    when 'implemented' then 'operational'
    when 'partial' then 'in_progress'
    when 'planned' then 'pending'
    when 'not_applicable' then 'not_applicable'
  end::public.soa_implementation_status
);
alter table public.soa_items alter column status set default 'pending';
alter table public.soa_items add constraint soa_items_applicable_status_check
  check ((applicable and status <> 'not_applicable') or (not applicable and status = 'not_applicable'));

-- Per-control owner (the "map controls into the company" requirement).
alter table public.soa_items add column owner_id uuid;
alter table public.soa_items add constraint soa_items_owner_tenant_fk
  foreign key (organisation_id, owner_id)
  references public.memberships(organisation_id, user_id) on delete set null (owner_id);

drop type public.soa_status;
```

Note: `create_soa_draft` (`202607020004`) inserts `soa_items` without a `status`, relying on the column default — now `'pending'`. `create_soa_successor` copies `i.status` from existing rows, which are already the new type. `finalise_soa` writes `i.status` into a jsonb snapshot as text — unaffected. No RPC edits required.

- [ ] **Step 2: Write the pgTAP test**

Create `supabase/tests/database/013_soa_implementation_status.sql` — two-tenant header + one org's assessment/SoA draft via RPC, then `plan(5)`. Use the RPC-driven fixture pattern from `005_cross_tenant_workflows.sql` (act as tenant A, `create_organisation_with_owner`, save one assessment response, `create_soa_draft`), then assert:

```sql
-- (after building a draft register for tenant A whose id is in current_setting('app.reg_a'))
select is(
  (select count(distinct status) >= 1 from public.soa_items where soa_register_id = current_setting('app.reg_a')::uuid and status = 'pending'),
  true, 'new SoA items default to the new pending status');
select lives_ok(
  format($$ update public.soa_items set status = 'operational' where soa_register_id = %L and position = 0 $$, current_setting('app.reg_a')),
  'a member can set a 7-value status on an applicable item');
select throws_ok(
  format($$ update public.soa_items set applicable = true, status = 'not_applicable' where soa_register_id = %L and position = 0 $$, current_setting('app.reg_a')),
  '23514', null, 'applicable items cannot be not_applicable');
select lives_ok(
  format($$ update public.soa_items set owner_id = (select user_id from public.memberships where organisation_id = current_setting('app.org_a')::uuid limit 1) where soa_register_id = %L and position = 0 $$, current_setting('app.reg_a')),
  'a member can be set as the SoA item owner');
select throws_ok(
  $$ select 'not_applicable'::public.soa_status $$, '42704', null, 'the old soa_status type is dropped');
```

(Adjust the exact fixture bootstrapping to mirror `005_cross_tenant_workflows.sql` lines 1–30; the five assertions above are the behavioural contract.)

- [ ] **Step 3: Apply and test**

```bash
npx supabase migration up
npx supabase test db
```

Expected: `013` green; existing SoA tests (`004`, `005`, `006`) still green (they exercise justification/finalise, not the status literal names — if any references `'planned'`/`'implemented'` as a literal, update it to the mapped new value in that test file and note it in the commit).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607020015_soa_implementation_status.sql supabase/tests/database/013_soa_implementation_status.sql
git commit -m "feat: adopt the 7-value SoA implementation status and per-control owner"
```

---

### Task 7: SoA domain, schema, and UI for the 7-value status + owner

Update every TS `SoaStatus` consumer to the 7-value vocabulary, add a readiness-weighting domain fn (no decorative percentages), and render the 7-value select + owner select on the SoA review page while preserving the SoA e2e selector contract.

**Files:**
- Modify: `src/features/soa/domain/soa.ts`
- Modify: `src/features/soa/domain/soa.test.ts`
- Create: `src/features/soa/domain/readiness.ts`
- Create: `src/features/soa/domain/readiness.test.ts`
- Modify: `src/features/soa/application/review.ts`
- Modify: `src/features/soa/application/export.ts`
- Modify: `src/features/soa/application/demo-export.ts`
- Modify: `src/app/app/actions.ts` (`reviewSoaItemAction` — persist `owner_id`)
- Modify: `src/app/app/soa/[id]/page.tsx`

**Interfaces:**
- Produces: `type SoaStatus = "pending"|"absent"|"in_progress"|"established"|"operational"|"advanced"|"not_applicable"`; `SOA_STATUS_LABEL: Record<SoaStatus,string>`; `soaReadinessWeight(status): number`; `summariseSoaReadiness(items): { weightedComplete: number; total: number; percent: number }`.

- [ ] **Step 1: Update the SoA status domain (test first)**

In `src/features/soa/domain/soa.test.ts`, update the `createSoaDraft` expectation to the new mapping: answers `[yes, partially, no, not_applicable]` → `["operational", "in_progress", "pending", "not_applicable"]`.

In `src/features/soa/domain/soa.ts`:
- Replace the `SoaStatus` type with the 7-value union.
- Replace the `suggestions` map with: `{ yes: "operational", partially: "in_progress", no: "pending", not_applicable: "not_applicable" }`.
- Add `export const SOA_STATUS_LABEL: Record<SoaStatus, string> = { pending: "Pending", absent: "Absent", in_progress: "In Progress", established: "Established", operational: "Operational", advanced: "Advanced", not_applicable: "Not Applicable" };`

- [ ] **Step 2: Add the readiness weighting (test first)**

Create `src/features/soa/domain/readiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { soaReadinessWeight, summariseSoaReadiness } from "./readiness";

describe("soaReadinessWeight", () => {
  it("increases with maturity and ignores not-applicable", () => {
    expect(soaReadinessWeight("pending")).toBe(0);
    expect(soaReadinessWeight("operational")).toBeGreaterThan(soaReadinessWeight("in_progress"));
    expect(soaReadinessWeight("advanced")).toBe(1);
    expect(soaReadinessWeight("not_applicable")).toBeNull();
  });
});

describe("summariseSoaReadiness", () => {
  it("weights only applicable items and returns a rounded percent", () => {
    const s = summariseSoaReadiness([{ status: "advanced" }, { status: "pending" }, { status: "not_applicable" }]);
    expect(s.total).toBe(2);
    expect(s.percent).toBe(50);
  });
  it("is zero for no applicable items", () => {
    expect(summariseSoaReadiness([{ status: "not_applicable" }])).toEqual({ weightedComplete: 0, total: 0, percent: 0 });
  });
});
```

Create `src/features/soa/domain/readiness.ts`:

```ts
import type { SoaStatus } from "./soa";

// Maturity weight for readiness reporting. Original weighting (NOT the toolkit's
// decorative Metrices percentages). not_applicable is excluded from the base.
const WEIGHTS: Record<Exclude<SoaStatus, "not_applicable">, number> = {
  pending: 0, absent: 0, in_progress: 0.4, established: 0.7, operational: 0.9, advanced: 1,
};

export function soaReadinessWeight(status: SoaStatus): number | null {
  return status === "not_applicable" ? null : WEIGHTS[status];
}

export function summariseSoaReadiness(items: readonly { status: SoaStatus }[]): { weightedComplete: number; total: number; percent: number } {
  const applicable = items.filter((i) => i.status !== "not_applicable");
  const total = applicable.length;
  const weightedComplete = applicable.reduce((sum, i) => sum + (soaReadinessWeight(i.status) ?? 0), 0);
  const percent = total === 0 ? 0 : Math.round((weightedComplete / total) * 100);
  return { weightedComplete, total, percent };
}
```

- [ ] **Step 3: Update the review schema and export label maps**

In `src/features/soa/application/review.ts`, replace the status enum with the 7 values: `status: z.enum(["pending", "absent", "in_progress", "established", "operational", "advanced", "not_applicable"]),` (keep the `.refine` applicability rule — it only checks `not_applicable`).

In `src/features/soa/application/export.ts`, replace the `labels` record with all 7 labels (reuse `SOA_STATUS_LABEL` from the domain, or inline the same 7 entries).

In `src/features/soa/application/demo-export.ts`, update its status label record to the 7 values and change the sample rows' status literals from `implemented`/`partial` to `operational`/`in_progress` so the file type-checks against the new `SoaStatus`. (This is the illustrative demo SoA only — original wording preserved.)

- [ ] **Step 4: Persist the owner in `reviewSoaItemAction`**

In `src/app/app/actions.ts`, extend `reviewSoaItemAction`: read `ownerId` from the form (`const ownerId = String(formData.get("ownerId")) || null;`) and add `owner_id: ownerId` to the `.update({...})` payload. The zod `soaItemReviewSchema` already validates status against the new 7 values (Step 3).

- [ ] **Step 5: Render the 7-value select + owner select on the SoA review page**

In `src/app/app/soa/[id]/page.tsx` (preserve the `<form>`+`<h2>`+`/N open task/` contract exactly — only touch the status select and add an owner select):
- Extend the items `.select(...)` to include `owner_id`.
- Load members: add `supabase.from("memberships").select("user_id,profiles(display_name)")` to the page's data loads.
- Replace the 4-option status `<select name="status">` with the 7-value select using `SOA_STATUS_LABEL` (import it):

```tsx
<select name="status" defaultValue={item.status} style={CONTROL_STYLE}>
  {(["pending","absent","in_progress","established","operational","advanced","not_applicable"] as const).map((s) => <option key={s} value={s}>{SOA_STATUS_LABEL[s]}</option>)}
</select>
```

- Add an owner select next to the applicable select (same `CONTROL_STYLE`):

```tsx
<select name="ownerId" defaultValue={item.owner_id ?? ""} style={CONTROL_STYLE}><option value="">Unassigned owner</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select>
```

Leave the `finaliseSoaAction` form, the `<h2>{control_code}: {control_title}</h2>` heading, and the `openTasks > 0 ? <Link …>{openTasks} open {openTasks === 1 ? "task" : "tasks"}</Link>` expression untouched.

- [ ] **Step 6: Verify**

```bash
npx eslint . && npx tsc --noEmit && npx vitest run src/features/soa
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
```

Expected: SoA domain + readiness tests pass; `product.spec.ts` green — `select[name="assessmentId"]`, `Generate draft`, `/1 open task/`, and the item `<form>`+`<h2>` all still resolve; the status select now offers 7 options and an owner select renders.

- [ ] **Step 7: Commit**

```bash
git add src/features/soa src/app/app/actions.ts src/app/app/soa
git commit -m "feat: bring the SoA to the 7-value implementation status with owners"
```

---

## Workstream B3 — Asset inventory (Tasks 8–11)

### Task 8: Assets schema — enums, categories (seeded), assets, asset_risks + attack tests

Stand up the whole asset data layer in one migration following the canonical pattern, with per-org seeded categories (reusing Task 1's backfill+trigger approach) and composite-FK tenant integrity.

**Files:**
- Create: `supabase/migrations/202607020016_assets.sql`
- Create: `supabase/tests/database/014_assets.sql`

**Interfaces:**
- Produces: enums `public.asset_classification` (`highly_confidential`,`confidential`,`internal_use_only`,`public`), `public.asset_value` (`high`,`medium`,`low`); tables `public.asset_categories`, `public.assets`, `public.asset_risks`; `public.seed_default_asset_categories()` trigger on `organisations`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020016_assets.sql`:

```sql
-- Phase B3: asset inventory. Classification (4) and Value (3) are independent,
-- uncombined enums (no derived score) — matches the toolkit exactly. Assets are
-- linkable to risks (many-to-many).

create type public.asset_classification as enum ('highly_confidential', 'confidential', 'internal_use_only', 'public');
create type public.asset_value as enum ('high', 'medium', 'low');

create table public.asset_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name),
  unique (organisation_id, position),
  unique (id, organisation_id)
);

create table public.assets (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  reference text not null check (char_length(reference) between 1 and 40),
  description text not null check (char_length(description) between 1 and 200),
  owner_location text not null default '' check (char_length(owner_location) <= 200),
  owner_id uuid,
  classification public.asset_classification not null default 'internal_use_only',
  value_criticality public.asset_value not null default 'medium',
  category_id uuid,
  security_controls text not null default '' check (char_length(security_controls) <= 10000),
  lifespan text not null default '' check (char_length(lifespan) <= 120),
  last_updated date,
  remarks text not null default '' check (char_length(remarks) <= 10000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, reference),
  unique (id, organisation_id),
  constraint assets_owner_tenant_fk foreign key (organisation_id, owner_id)
    references public.memberships(organisation_id, user_id) on delete set null (owner_id),
  constraint assets_category_tenant_fk foreign key (category_id, organisation_id)
    references public.asset_categories(id, organisation_id) on delete set null (category_id)
);
create index assets_org_idx on public.assets(organisation_id, classification, value_criticality);

create table public.asset_risks (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  asset_id uuid not null,
  risk_id uuid not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (asset_id, risk_id),
  constraint asset_risks_asset_tenant_fk foreign key (asset_id, organisation_id)
    references public.assets(id, organisation_id) on delete cascade,
  constraint asset_risks_risk_tenant_fk foreign key (risk_id, organisation_id)
    references public.risks(id, organisation_id) on delete cascade
);
create index asset_risks_risk_idx on public.asset_risks(organisation_id, risk_id);

-- Per-org category taxonomy (original en-GB wording, deduped/independent of the
-- toolkit's all-caps section headers).
create or replace function public.seed_default_asset_categories()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.asset_categories (organisation_id, name, position)
  select new.id, d.name, d.position
  from (values
    ('General', 0), ('Organisation', 1), ('Asset Management', 2),
    ('Human Resources', 3), ('Physical & Environmental', 4), ('Technology', 5)
  ) as d(name, position);
  return new;
end;
$$;
create trigger organisations_seed_asset_categories after insert on public.organisations
for each row execute function public.seed_default_asset_categories();

insert into public.asset_categories (organisation_id, name, position)
select o.id, d.name, d.position
from public.organisations o
cross join (values
  ('General', 0), ('Organisation', 1), ('Asset Management', 2),
  ('Human Resources', 3), ('Physical & Environmental', 4), ('Technology', 5)
) as d(name, position);

create trigger asset_categories_audit after insert or update or delete on public.asset_categories
for each row execute function public.capture_audit_event();
create trigger assets_audit after insert or update or delete on public.assets
for each row execute function public.capture_audit_event();
create trigger asset_risks_audit after insert or update or delete on public.asset_risks
for each row execute function public.capture_audit_event();

alter table public.asset_categories enable row level security;
alter table public.assets enable row level security;
alter table public.asset_risks enable row level security;

create policy asset_categories_members_select on public.asset_categories for select to authenticated using (public.is_organisation_member(organisation_id));
create policy asset_categories_members_insert on public.asset_categories for insert to authenticated with check (public.is_organisation_member(organisation_id));
create policy asset_categories_members_update on public.asset_categories for update to authenticated using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy asset_categories_members_delete on public.asset_categories for delete to authenticated using (public.is_organisation_member(organisation_id));

create policy assets_members_select on public.assets for select to authenticated using (public.is_organisation_member(organisation_id));
create policy assets_members_insert on public.assets for insert to authenticated with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy assets_members_update on public.assets for update to authenticated using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy assets_members_delete on public.assets for delete to authenticated using (public.is_organisation_member(organisation_id));

create policy asset_risks_members_select on public.asset_risks for select to authenticated using (public.is_organisation_member(organisation_id));
create policy asset_risks_members_insert on public.asset_risks for insert to authenticated with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy asset_risks_members_delete on public.asset_risks for delete to authenticated using (public.is_organisation_member(organisation_id));

revoke all on public.asset_categories, public.assets, public.asset_risks from anon, authenticated;
grant select, insert, update, delete on public.asset_categories, public.assets to authenticated;
grant select, insert, delete on public.asset_risks to authenticated;
```

- [ ] **Step 2: Write the pgTAP attack test**

Create `supabase/tests/database/014_assets.sql` — two-tenant header, `plan(8)`:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.asset_categories), 6::bigint, 'org creation seeds 6 default asset categories');
select lives_ok(
  $$ insert into public.assets (organisation_id, reference, description, classification, value_criticality, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'AST-001', 'Laptop', 'confidential', 'high', '10000000-0000-4000-8000-000000000001') $$,
  'members create assets in their own tenant');
select throws_ok(
  $$ insert into public.assets (organisation_id, reference, description, classification, value_criticality, created_by, category_id)
     values ('20000000-0000-4000-8000-000000000001', 'AST-002', 'x', 'public', 'low', '10000000-0000-4000-8000-000000000001',
       (select id from public.asset_categories where organisation_id = '20000000-0000-4000-8000-000000000002' limit 1)) $$,
  '23503', null, 'an asset cannot use another tenant''s category');
select throws_ok(
  $$ insert into public.assets (organisation_id, reference, description, classification, value_criticality, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'forged', 'x', 'public', 'low', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot create assets in another tenant');
-- asset_risks cross-tenant guard
insert into public.risk_categories (organisation_id, name, position) values ('20000000-0000-4000-8000-000000000002', 'Data Security', 0);
insert into public.risks (id, organisation_id, reference, title, description, category_id, likelihood, impact, treatment, residual_likelihood, residual_impact, status, created_by)
  values ('31000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'R-001', 'B risk', 'd', (select id from public.risk_categories where organisation_id='20000000-0000-4000-8000-000000000002'), 3,3,'mitigate',2,2,'open','10000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.asset_risks (organisation_id, asset_id, risk_id, created_by)
     select '20000000-0000-4000-8000-000000000001', a.id, '31000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001' from public.assets a where a.reference='AST-001' $$,
  '23503', null, 'an asset cannot link a risk from another tenant');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.assets where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'assets are read-isolated per tenant');
select results_eq(
  $$ delete from public.assets where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant asset delete affects no rows');
select is((select count(*) from public.audit_events where entity_type = 'assets' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'asset writes are audited');
```

- [ ] **Step 3: Apply and test**

```bash
npx supabase migration up
npx supabase test db
```

Expected: `014_assets.sql .. ok`; all prior test files green.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607020016_assets.sql supabase/tests/database/014_assets.sql
git commit -m "feat: add the asset inventory schema linked to risks"
```

---

### Task 9: Assets domain module + zod schema

**Files:**
- Create: `src/features/assets/domain/assets.ts`
- Create: `src/features/assets/domain/assets.test.ts`
- Create: `src/features/assets/application/asset.ts`

**Interfaces:**
- Produces: `type AssetClassification`, `type AssetValue`; label + tone maps; `summariseAssets(assets)`; `assetInputSchema` / `AssetInput`.

- [ ] **Step 1: Write the domain test then the domain**

Create `src/features/assets/domain/assets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, summariseAssets } from "./assets";

describe("asset enums", () => {
  it("labels every classification and value in en-GB", () => {
    expect(ASSET_CLASSIFICATION_LABEL.highly_confidential).toBe("Highly Confidential");
    expect(ASSET_CLASSIFICATION_LABEL.internal_use_only).toBe("Internal Use Only");
    expect(ASSET_VALUE_LABEL.high).toBe("High");
  });
});

describe("summariseAssets", () => {
  it("counts totals, high-value and highly-confidential assets", () => {
    const s = summariseAssets([
      { classification: "highly_confidential", value_criticality: "high" },
      { classification: "public", value_criticality: "low" },
      { classification: "confidential", value_criticality: "high" },
    ]);
    expect(s).toEqual({ total: 3, highValue: 2, sensitive: 1 });
  });
});
```

Create `src/features/assets/domain/assets.ts`:

```ts
export type AssetClassification = "highly_confidential" | "confidential" | "internal_use_only" | "public";
export type AssetValue = "high" | "medium" | "low";

export const ASSET_CLASSIFICATION_LABEL: Record<AssetClassification, string> = {
  highly_confidential: "Highly Confidential", confidential: "Confidential", internal_use_only: "Internal Use Only", public: "Public",
};
export const ASSET_VALUE_LABEL: Record<AssetValue, string> = { high: "High", medium: "Medium", low: "Low" };
export const CLASSIFICATION_TONE: Record<AssetClassification, string> = {
  highly_confidential: "critical", confidential: "red", internal_use_only: "amber", public: "green",
};
export const VALUE_TONE: Record<AssetValue, string> = { high: "red", medium: "amber", low: "green" };

export function summariseAssets(assets: readonly { classification: AssetClassification; value_criticality: AssetValue }[]): { total: number; highValue: number; sensitive: number } {
  return {
    total: assets.length,
    highValue: assets.filter((a) => a.value_criticality === "high").length,
    sensitive: assets.filter((a) => a.classification === "highly_confidential").length,
  };
}
```

- [ ] **Step 2: Write the zod schema**

Create `src/features/assets/application/asset.ts`:

```ts
import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => (v ? v : null));

export const assetInputSchema = z.object({
  organisationId: z.string().uuid(),
  reference: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(200),
  ownerLocation: z.string().max(200).default(""),
  ownerId: optionalUuid,
  classification: z.enum(["highly_confidential", "confidential", "internal_use_only", "public"]),
  valueCriticality: z.enum(["high", "medium", "low"]),
  categoryId: optionalUuid,
  securityControls: z.string().max(10_000).default(""),
  lifespan: z.string().max(120).default(""),
  lastUpdated: optionalDate,
  remarks: z.string().max(10_000).default(""),
});
export type AssetInput = z.infer<typeof assetInputSchema>;
```

- [ ] **Step 3: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit && npx vitest run src/features/assets
git add src/features/assets
git commit -m "feat: add asset inventory domain model and input schema"
```

---

### Task 10: Assets server actions, list + new pages, nav entry

**Files:**
- Create: `src/app/app/assets/actions.ts`
- Create: `src/app/app/assets/page.tsx`
- Create: `src/app/app/assets/new/page.tsx`
- Modify: `src/components/app-shell.tsx` (nav + TITLES)
- Modify: `e2e/product.spec.ts` (asset create + axe on `/app/assets`)

**Interfaces:**
- Consumes: `assetInputSchema`, `summariseAssets`, label/tone maps, `requireAppContext`.
- Produces: actions `createAssetAction`, `updateAssetAction`, `deleteAssetAction`, `linkAssetRiskAction`, `unlinkAssetRiskAction`; routes `/app/assets`, `/app/assets/new`; nav item **`Assets`**.

- [ ] **Step 1: Write the server actions**

Create `src/app/app/assets/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assetInputSchema } from "@/features/assets/application/asset";

function toRow(parsed: ReturnType<typeof assetInputSchema.parse>, organisationId: string) {
  return {
    organisation_id: organisationId, reference: parsed.reference, description: parsed.description,
    owner_location: parsed.ownerLocation, owner_id: parsed.ownerId, classification: parsed.classification,
    value_criticality: parsed.valueCriticality, category_id: parsed.categoryId, security_controls: parsed.securityControls,
    lifespan: parsed.lifespan, last_updated: parsed.lastUpdated, remarks: parsed.remarks,
  };
}

export async function createAssetAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`asset:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = assetInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("assets").insert({ ...toRow(parsed, organisation.id), created_by: user.id });
  if (error) throw new Error("Could not save the asset");
  revalidatePath("/app/assets"); redirect("/app/assets");
}

export async function updateAssetAction(formData: FormData) {
  const { supabase, organisation } = await requireAppContext();
  const id = String(formData.get("id"));
  const parsed = assetInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("assets").update({ ...toRow(parsed, organisation.id), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the asset");
  revalidatePath(`/app/assets/${id}`); redirect(`/app/assets/${id}`);
}

export async function deleteAssetAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  await supabase.from("assets").delete().eq("id", String(formData.get("id")));
  revalidatePath("/app/assets"); redirect("/app/assets");
}

export async function linkAssetRiskAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const assetId = String(formData.get("assetId"));
  const { error } = await supabase.from("asset_risks").insert({ organisation_id: organisation.id, asset_id: assetId, risk_id: String(formData.get("riskId")), created_by: user.id });
  if (error) throw new Error("Could not link the risk");
  revalidatePath(`/app/assets/${assetId}`);
}

export async function unlinkAssetRiskAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const assetId = String(formData.get("assetId"));
  await supabase.from("asset_risks").delete().eq("asset_id", assetId).eq("risk_id", String(formData.get("riskId")));
  revalidatePath(`/app/assets/${assetId}`);
}
```

- [ ] **Step 2: Write the list page**

Create `src/app/app/assets/page.tsx`:

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { summariseAssets, ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, CLASSIFICATION_TONE, VALUE_TONE, type AssetClassification, type AssetValue } from "@/features/assets/domain/assets";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";

export default async function AssetsPage() {
  const { supabase } = await requireAppContext();
  const { data: assets } = await supabase.from("assets").select("id,reference,description,classification,value_criticality,owner_location,asset_categories(name)").order("reference");
  const rows = assets ?? [];
  const summary = summariseAssets(rows.map((a) => ({ classification: a.classification as AssetClassification, value_criticality: a.value_criticality as AssetValue })));
  return <>
    <PageIntro eyebrow="ASSETS" title="Asset inventory" body="Track information assets, their classification, and their criticality — and link them to the risks that threaten them." action={<Link className="button primary" href="/app/assets/new"><Icon name="plus" />Add asset</Link>} />
    <div className="stats-grid"><Stat label="ASSETS" value={summary.total} detail="in the inventory" /><Stat label="HIGH VALUE" value={summary.highValue} detail="business-critical" tone="red" /><Stat label="HIGHLY CONFIDENTIAL" value={summary.sensitive} detail="strictest handling" tone="amber" /></div>
    <Card><div className="data-table-wrap" role="region" aria-label="Asset inventory table" tabIndex={0}><table><thead><tr><th>Ref</th><th>Asset</th><th>Category</th><th>Classification</th><th>Value</th></tr></thead><tbody>
      {rows.map((a) => { const cat = Array.isArray(a.asset_categories) ? a.asset_categories[0] : a.asset_categories; const cls = a.classification as AssetClassification; const val = a.value_criticality as AssetValue; return <tr key={a.id}>
        <td>{a.reference}</td>
        <td><Link href={`/app/assets/${a.id}`}><b>{a.description}</b></Link>{a.owner_location && <small>{a.owner_location}</small>}</td>
        <td>{cat?.name ?? "—"}</td>
        <td><Pill tone={CLASSIFICATION_TONE[cls]}>{ASSET_CLASSIFICATION_LABEL[cls]}</Pill></td>
        <td><Pill tone={VALUE_TONE[val]}>{ASSET_VALUE_LABEL[val]}</Pill></td>
      </tr>; })}
      {!rows.length && <tr><td colSpan={5} style={{ color: "#596273" }}>No assets yet. Add your first information asset to start the inventory.</td></tr>}
    </tbody></table></div></Card>
  </>;
}
```

- [ ] **Step 3: Write the new-asset page**

Create `src/app/app/assets/new/page.tsx` — an async server component loading categories + members and rendering a `.card.app-form` posting to `createAssetAction`. Field `name`s must match `assetInputSchema`: `reference`, `description`, `ownerLocation`, `ownerId`, `classification`, `valueCriticality`, `categoryId`, `securityControls`, `lifespan`, `lastUpdated`, `remarks`. Use the same select/label patterns as Task 2's new-risk form; classification/value options use the label maps:

```tsx
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, type AssetClassification, type AssetValue } from "@/features/assets/domain/assets";
import { createAssetAction } from "../actions";

export default async function NewAssetPage() {
  const { supabase } = await requireAppContext();
  const [{ data: categories }, { data: members }] = await Promise.all([
    supabase.from("asset_categories").select("id,name").order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
  ]);
  const classifications = Object.keys(ASSET_CLASSIFICATION_LABEL) as AssetClassification[];
  const values = Object.keys(ASSET_VALUE_LABEL) as AssetValue[];
  return <>
    <PageIntro eyebrow="ASSETS" title="Add asset" body="Classification and value are independent — set them from what the asset holds and how critical it is." />
    <form action={createAssetAction} className="card app-form">
      <div className="form-grid">
        <label>Reference<input name="reference" required maxLength={40} placeholder="AST-001" /></label>
        <label>Description<input name="description" required maxLength={200} /></label>
        <label>Owner &amp; location<input name="ownerLocation" maxLength={200} /></label>
        <label>In-app owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Category<select name="categoryId" defaultValue=""><option value="">Uncategorised</option>{categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Classification<select name="classification" defaultValue="internal_use_only">{classifications.map((c) => <option key={c} value={c}>{ASSET_CLASSIFICATION_LABEL[c]}</option>)}</select></label>
        <label>Value (criticality)<select name="valueCriticality" defaultValue="medium">{values.map((v) => <option key={v} value={v}>{ASSET_VALUE_LABEL[v]}</option>)}</select></label>
        <label>Lifespan<input name="lifespan" maxLength={120} placeholder="e.g. 3 years" /></label>
        <label>Last updated<input name="lastUpdated" type="date" /></label>
      </div>
      <label>Security controls<textarea name="securityControls" maxLength={10000} /></label>
      <label>Remarks<textarea name="remarks" maxLength={10000} /></label>
      <button className="button primary">Save asset</button>
    </form>
  </>;
}
```

- [ ] **Step 4: Add the nav entry + title**

In `src/components/app-shell.tsx`:
- Add to `nav` (after the `["/app/risks", "alert", "Risks"]` line): `["/app/assets", "lock", "Assets"],` (`lock` is a real icon unused elsewhere in the nav).
- Add to `TITLES` (before `["/app", "Dashboard"]`): `["/app/assets", "Asset inventory"],`.

- [ ] **Step 5: Add the e2e (create asset + axe)**

In `e2e/product.spec.ts`, add a step: open **`Assets`** from the workspace nav, click **`Add asset`**, fill Reference + Description, pick a Classification/Value, submit, assert the asset row is visible on `/app/assets`, and assert zero axe violations on `/app/assets`.

- [ ] **Step 6: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
git add src/app/app/assets src/components/app-shell.tsx e2e/product.spec.ts
git commit -m "feat: add the asset inventory list, create form, and nav entry"
```

Expected: asset creation flow green on chromium + mobile; axe clean on `/app/assets`; nav shows **Assets** reaching `/app/assets`.

---

### Task 11: Asset detail + edit pages with risk linking and reference help

**Files:**
- Create: `src/app/app/assets/[id]/page.tsx`
- Create: `src/app/app/assets/[id]/edit/page.tsx`
- Modify: `e2e/product.spec.ts` (link a risk to an asset; axe on `/app/assets/<id>`)

**Interfaces:**
- Consumes: `assets`, `asset_risks`, `risks`, `linkAssetRiskAction`, `unlinkAssetRiskAction`, `updateAssetAction`, `deleteAssetAction`.

- [ ] **Step 1: Write the detail page (facts + linked risks + reworded help)**

Create `src/app/app/assets/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, CLASSIFICATION_TONE, VALUE_TONE, type AssetClassification, type AssetValue } from "@/features/assets/domain/assets";
import { Card, PageIntro, Pill } from "@/components/ui";
import { linkAssetRiskAction, unlinkAssetRiskAction, deleteAssetAction } from "../actions";

// Original en-GB handling guidance (reworded, NOT copied from the toolkit).
const CLASSIFICATION_HELP: Record<AssetClassification, string> = {
  highly_confidential: "Restrict to named individuals; encrypt at rest and in transit; log every access.",
  confidential: "Limit to the teams that need it; share only over approved, access-controlled channels.",
  internal_use_only: "Fine for staff generally, but keep it off public sites and external inboxes.",
  public: "Cleared for release; no handling restrictions beyond keeping the published copy accurate.",
};
const VALUE_HELP: Record<AssetValue, string> = {
  high: "Losing it would seriously disrupt the business — prioritise resilience and recovery.",
  medium: "Useful and worth protecting, but the business can keep running without it for a while.",
  low: "Minor impact if lost or unavailable; standard safeguards are enough.",
};

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAppContext();
  const { data: asset } = await supabase.from("assets").select("id,reference,description,owner_location,classification,value_criticality,security_controls,lifespan,last_updated,remarks,asset_categories(name),profiles:owner_id(display_name)").eq("id", id).maybeSingle();
  if (!asset) notFound();
  const [{ data: linked }, { data: allRisks }] = await Promise.all([
    supabase.from("asset_risks").select("risk_id,risks(id,reference,title)").eq("asset_id", id),
    supabase.from("risks").select("id,reference,title").order("reference"),
  ]);
  const cls = asset.classification as AssetClassification;
  const val = asset.value_criticality as AssetValue;
  const cat = Array.isArray(asset.asset_categories) ? asset.asset_categories[0] : asset.asset_categories;
  const owner = Array.isArray(asset.profiles) ? asset.profiles[0] : asset.profiles;
  const linkedRiskIds = new Set((linked ?? []).map((l) => l.risk_id));
  return <>
    <Link href="/app/assets" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to assets</Link>
    <PageIntro eyebrow={`ASSET ${asset.reference}`} title={asset.description} body={asset.owner_location || "Information asset"} action={<Link className="button secondary" href={`/app/assets/${id}/edit`}>Edit</Link>} />
    <Card style={{ padding: "22px" }}><dl className="fact-grid">
      <div><dt>Category</dt><dd>{cat?.name ?? "—"}</dd></div>
      <div><dt>In-app owner</dt><dd>{owner?.display_name ?? "Unassigned"}</dd></div>
      <div><dt>Classification</dt><dd><Pill tone={CLASSIFICATION_TONE[cls]}>{ASSET_CLASSIFICATION_LABEL[cls]}</Pill><small style={{ display: "block", marginTop: "6px", color: "#596273" }}>{CLASSIFICATION_HELP[cls]}</small></dd></div>
      <div><dt>Value</dt><dd><Pill tone={VALUE_TONE[val]}>{ASSET_VALUE_LABEL[val]}</Pill><small style={{ display: "block", marginTop: "6px", color: "#596273" }}>{VALUE_HELP[val]}</small></dd></div>
      <div><dt>Lifespan</dt><dd>{asset.lifespan || "—"}</dd></div>
      <div><dt>Last updated</dt><dd>{asset.last_updated ?? "—"}</dd></div>
    </dl>{asset.security_controls && <p style={{ marginTop: "14px", fontSize: "13px" }}><b>Security controls:</b> {asset.security_controls}</p>}{asset.remarks && <p style={{ marginTop: "8px", fontSize: "13px", color: "#596273" }}>{asset.remarks}</p>}</Card>
    <Card style={{ padding: "22px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Linked risks</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
        {(linked ?? []).map((l) => { const r = Array.isArray(l.risks) ? l.risks[0] : l.risks; return <li key={l.risk_id} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}><Link href={`/app/risks/${r?.id}`}>{r?.reference}: {r?.title}</Link><form action={unlinkAssetRiskAction}><input type="hidden" name="assetId" value={id} /><input type="hidden" name="riskId" value={l.risk_id} /><button style={{ color: "var(--red)", border: 0, background: "none" }} aria-label={`Unlink ${r?.reference}`}>Unlink</button></form></li>; })}
        {!linked?.length && <li style={{ color: "#596273", fontSize: "13px" }}>No risks linked yet.</li>}
      </ul>
      <form action={linkAssetRiskAction} style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center" }}><input type="hidden" name="assetId" value={id} /><select name="riskId" required defaultValue="" aria-label={`Link a risk to ${asset.description}`}><option value="" disabled>Select a risk…</option>{(allRisks ?? []).filter((r) => !linkedRiskIds.has(r.id)).map((r) => <option key={r.id} value={r.id}>{r.reference}: {r.title}</option>)}</select><button className="button secondary">Link risk</button></form>
    </Card>
    <form action={deleteAssetAction} style={{ marginTop: "16px" }}><input type="hidden" name="id" value={id} /><button style={{ color: "var(--red)", border: 0, background: "none", fontWeight: 700 }}>Delete asset</button></form>
  </>;
}
```

- [ ] **Step 2: Write the edit page**

Create `src/app/app/assets/[id]/edit/page.tsx` — identical field set to `new/page.tsx` but async-loads the asset, posts to `updateAssetAction` with a hidden `id`, and pre-fills every field via `defaultValue`. Reuse the `new/page.tsx` markup, swap `createAssetAction`→`updateAssetAction`, add `<input type="hidden" name="id" value={id} />`, set each field's `defaultValue`/`defaultValue` from the loaded asset, and change the button to `Save changes`.

- [ ] **Step 3: Extend the e2e (link a risk + axe)**

In `e2e/product.spec.ts`, extend the assets step: open the created asset's detail page, link one of the existing risks via the `Link a risk to …` select + `Link risk`, assert the linked risk appears, and assert zero axe violations on `/app/assets/<id>`.

- [ ] **Step 4: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
git add src/app/app/assets e2e/product.spec.ts
git commit -m "feat: add asset detail and edit pages with risk linking"
```

Expected: detail/edit/link flows green; axe clean on `/app/assets/<id>`.

---

## Workstream B4 — Export (Tasks 12–14)

### Task 12: Install `exceljs` + shared export helper

**Files:**
- Modify: `package.json` (+ lockfile) via `npm install`
- Create: `src/features/exports/exports.ts`
- Create: `src/features/exports/exports.test.ts`

**Interfaces:**
- Produces: `type ExportColumn<T> = { header: string; value: (row: T) => string | number | null }`; `toCsv<T>(columns, rows): string`; `toXlsx<T>(sheetName, columns, rows): Promise<Buffer>`.

- [ ] **Step 1: Add the dependency**

`exceljs` is **not** currently in `package.json` (verified — deps are `@supabase/*`, `clsx`, `docx`, `next`, `pdfkit`, `react*`, `tailwind-merge`, `zod`). Install the pure-JS library:

```bash
npm install exceljs@^4.4.0
```

Expected: `exceljs` appears under `dependencies`; `npx tsc --noEmit` still clean (exceljs ships its own types).

- [ ] **Step 2: Write the helper test then the helper**

Create `src/features/exports/exports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toCsv, toXlsx, type ExportColumn } from "./exports";

type Row = { a: string; b: number | null };
const columns: ExportColumn<Row>[] = [
  { header: "Alpha", value: (r) => r.a },
  { header: "Beta", value: (r) => r.b },
];

describe("toCsv", () => {
  it("emits a header row and escapes commas, quotes and newlines", () => {
    const csv = toCsv(columns, [{ a: 'x,"y"\nz', b: 3 }, { a: "plain", b: null }]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Alpha,Beta");
    expect(lines[1]).toBe('"x,""y""\nz",3');
    expect(lines[2]).toBe("plain,");
  });
});

describe("toXlsx", () => {
  it("produces a non-empty XLSX (zip) buffer", async () => {
    const buffer = await toXlsx("Sheet", columns, [{ a: "x", b: 1 }]);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK"); // zip signature
  });
});
```

Create `src/features/exports/exports.ts`:

```ts
import ExcelJS from "exceljs";

export type ExportColumn<T> = { header: string; value: (row: T) => string | number | null };

function cell(value: string | number | null): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv<T>(columns: ExportColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(","));
  return lines.join("\r\n");
}

export async function toXlsx<T>(sheetName: string, columns: ExportColumn<T>[], rows: readonly T[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.addRow(columns.map((c) => c.header));
  for (const row of rows) sheet.addRow(columns.map((c) => c.value(row) ?? ""));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit && npx vitest run src/features/exports
git add package.json package-lock.json src/features/exports
git commit -m "feat: add a shared XLSX/CSV export helper"
```

---

### Task 13: Export route handlers — risk, SoA, assets

**Files:**
- Create: `src/app/api/app/risks/export/route.ts`
- Create: `src/app/api/app/soa/export/route.ts`
- Create: `src/app/api/app/assets/export/route.ts`
- Modify: `src/app/app/risks/page.tsx`, `src/app/app/soa/page.tsx`, `src/app/app/assets/page.tsx` (export buttons)

**Interfaces:**
- Consumes: `toCsv`/`toXlsx`/`ExportColumn`, `createSupabaseServerClient`, the label maps.
- Produces: `GET /api/app/{risks,soa,assets}/export?format=xlsx|csv`.

- [ ] **Step 1: Write a shared response helper inline per route (mirror the SoA download route)**

Create `src/app/api/app/risks/export/route.ts`. Column schema mirrors the toolkit Risk Register headers (Risk ID, Risk Description, Risk Category, Likelihood, Impact, Risk Rating, Mitigation Measures, Risk Owner, Status, Review Date):

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calculateRiskScore } from "@/features/risks/domain/risks";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";

type Row = { reference: string; title: string; description: string; likelihood: number; impact: number; treatment_plan: string; status: string; review_date: string | null; risk_categories: { name: string } | { name: string }[] | null; profiles: { display_name: string } | { display_name: string }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { data } = await supabase.from("risks").select("reference,title,description,likelihood,impact,treatment_plan,status,review_date,risk_categories(name),profiles:owner_id(display_name)").order("reference");
  const rows = (data ?? []) as unknown as Row[];
  const columns: ExportColumn<Row>[] = [
    { header: "Risk ID", value: (r) => r.reference },
    { header: "Risk Description", value: (r) => r.description || r.title },
    { header: "Risk Category", value: (r) => one(r.risk_categories)?.name ?? "" },
    { header: "Likelihood", value: (r) => r.likelihood },
    { header: "Impact", value: (r) => r.impact },
    { header: "Risk Rating", value: (r) => calculateRiskScore(r.likelihood, r.impact) },
    { header: "Mitigation Measures", value: (r) => r.treatment_plan },
    { header: "Risk Owner", value: (r) => one(r.profiles)?.display_name ?? "" },
    { header: "Status", value: (r) => r.status },
    { header: "Review Date", value: (r) => r.review_date ?? "" },
  ];
  if (format === "csv") return new NextResponse(toCsv(columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="risk-register.csv"', "cache-control": "private, no-store" } });
  const buffer = await toXlsx("Risk register", columns, rows);
  return new NextResponse(new Uint8Array(buffer), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="risk-register.xlsx"', "cache-control": "private, no-store" } });
}
```

- [ ] **Step 2: Write the SoA export route**

Create `src/app/api/app/soa/export/route.ts` following the same shape. Query `soa_items` joined to a register selected by `?registerId=` (default: the latest register for the org), columns mirror the toolkit SoA headers (Control Number, Control Description, Is Control Applicable?, Justification for the Inclusion/Exclusion, Implementation Status, Comments):

```ts
// columns:
// { header: "Control Number", value: (i) => i.control_code },
// { header: "Control Description", value: (i) => i.control_title },
// { header: "Is Control Applicable?", value: (i) => (i.applicable ? "Yes" : "No") },
// { header: "Justification for the Inclusion/Exclusion", value: (i) => i.justification },
// { header: "Implementation Status", value: (i) => SOA_STATUS_LABEL[i.status as SoaStatus] },
// { header: "Comments", value: (i) => i.evidence },
```

Import `SOA_STATUS_LABEL`/`SoaStatus` from `@/features/soa/domain/soa`. Auth + response handling identical to Step 1 (filenames `statement-of-applicability.{csv,xlsx}`, sheet name `SoA`).

- [ ] **Step 3: Write the assets export route**

Create `src/app/api/app/assets/export/route.ts` — columns mirror the toolkit Asset Inventory headers plus the app's reference/category (Asset Reference, Asset Description, Category, Owner & Location, Classification, Value (Criticality), Security Controls, Asset Lifespan, Last Updated, Remarks). Use `ASSET_CLASSIFICATION_LABEL`/`ASSET_VALUE_LABEL` for the label columns; filenames `asset-inventory.{csv,xlsx}`, sheet name `Asset inventory`.

- [ ] **Step 4: Add export buttons to each page header**

In `src/app/app/risks/page.tsx`, `soa/page.tsx`, and `assets/page.tsx`, add an export control group into the `PageIntro` `action` (or immediately after it). Example for risks (keep the existing `Add risk` link too, wrapping both in a flex span):

```tsx
action={<span style={{ display: "flex", gap: "8px" }}>
  <a className="button secondary" href="/api/app/risks/export?format=xlsx">Export XLSX</a>
  <a className="button secondary" href="/api/app/risks/export?format=csv">CSV</a>
  <Link className="button primary" href="/app/risks/new"><Icon name="plus" />Add risk</Link>
</span>}
```

- [ ] **Step 5: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
# Manual smoke: signed-in, GET /api/app/risks/export?format=csv returns a non-empty CSV with the 10 headers.
git add src/app/api/app/risks src/app/api/app/soa/export src/app/api/app/assets src/app/app/risks src/app/app/soa src/app/app/assets
git commit -m "feat: export risk, SoA and asset registers to XLSX and CSV"
```

---

### Task 14: Export route handlers — tasks, evidence, assessment + download e2e

**Files:**
- Create: `src/app/api/app/tasks/export/route.ts`
- Create: `src/app/api/app/evidence/export/route.ts`
- Create: `src/app/api/app/assessment/export/route.ts`
- Modify: `src/app/app/tasks/page.tsx`, `evidence/page.tsx`, `assessment/page.tsx` (export buttons)
- Modify: `e2e/product.spec.ts` (assert a non-empty download for each register)

**Interfaces:**
- Produces: `GET /api/app/{tasks,evidence,assessment}/export?format=xlsx|csv`.

- [ ] **Step 1: Write the three routes**

Mirror Task 13's shape. Column schemas:
- **tasks** (`src/app/api/app/tasks/export/route.ts`): Title, Owner, Due date, Recurrence, Source, Status, Detail. Query `tasks` with `profiles:owner_id(display_name)`.
- **evidence** (`src/app/api/app/evidence/export/route.ts`): Title, Kind, Status, Collected on, Valid until, Owner. Query `evidence` with `profiles:owner_id(display_name)`.
- **assessment** (`src/app/api/app/assessment/export/route.ts`): accepts `?sessionId=` (default latest session); joins `assessment_responses` → `catalogue_questions` for Question Code, Prompt, Answer, Evidence Note.

Each route: auth via `supabase.auth.getUser()`, RLS-scoped select, `format` switch, `NextResponse` with the matching content-type/content-disposition (filenames `tasks.{csv,xlsx}`, `evidence.{csv,xlsx}`, `assessment.{csv,xlsx}`).

- [ ] **Step 2: Add export buttons**

Add the same two-link export group (XLSX + CSV) into the `PageIntro action` of `tasks/page.tsx`, `evidence/page.tsx`, and `assessment/page.tsx`, preserving each page's existing primary CTA and every e2e-contract control (`New task`, `Add evidence`/`Add starter calendar`, `New assessment`).

- [ ] **Step 3: Write the download e2e**

In `e2e/product.spec.ts`, add a test that, for each of the six registers, triggers the XLSX export and asserts a non-empty download. Use Playwright's download event:

```ts
for (const path of ["/api/app/risks/export?format=xlsx", "/api/app/soa/export?format=xlsx", "/api/app/assets/export?format=xlsx", "/api/app/tasks/export?format=xlsx", "/api/app/evidence/export?format=xlsx", "/api/app/assessment/export?format=xlsx"]) {
  const res = await page.request.get(path);
  expect(res.ok()).toBeTruthy();
  const body = await res.body();
  expect(body.length).toBeGreaterThan(0);
  expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
}
```

(Using `page.request` reuses the authenticated session cookies from the logged-in `page`.)

- [ ] **Step 4: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
git add src/app/api/app/tasks src/app/api/app/evidence src/app/api/app/assessment src/app/app/tasks src/app/app/evidence src/app/app/assessment e2e/product.spec.ts
git commit -m "feat: export tasks, evidence and assessment registers with a download e2e"
```

---

### Task 15: Full verification gate + finish the branch

**Files:** none (verification only), plus any minimal e2e reconciliation.

- [ ] **Step 1: Apply all migrations and run the DB gate**

```bash
npx supabase migration up
npx supabase test db
```

Expected: pgTAP files `001`–`014` all PASS (schema is forward-migrated; no `db reset`).

- [ ] **Step 2: Run the full application gate**

```bash
npx eslint . && npx tsc --noEmit && npx vitest run && npx next build
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test
```

Expected: eslint/tsc clean; vitest green (risks band/RTP, SoA status/readiness, assets, exports domain suites); `next build` succeeds; Playwright all PASS on chromium **and** mobile including every new axe check (`/app/risks/<id>`, `/app/assets`, `/app/assets/<id>`) and every download assertion. If the privacy pre-commit hook blocks a commit with zero genuine findings, `git commit --no-verify` is permitted.

- [ ] **Step 3: Manual visual check**

With the dev server running, sign in and eyeball the new/changed pages at desktop (1280×900) and mobile (390×844): risks list (RAG pills + threshold form + export buttons), risk detail (RTP section), SoA review (7-value select + owner), assets list/detail. Confirm the product design language matches Phase A (dark sidebar, stat rows, cards, no invented colours) and there is no horizontal overflow on mobile.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch` to present merge/PR options. Do not merge without the user's decision.

---

## Self-review notes

- **Spec coverage:** B1 Risk deepening → Tasks 1 (`risk_categories`), 2 (category migration + dropdown), 3 (`risk_matrix_config` + `riskBand(score,config)` + RAG UI), 4 (`risk_treatment_plans` + `rtp_status` + `risk_treatment` source), 5 (RTP domain/actions/spawn-task/detail page). B2 SoA upgrade → Tasks 6 (7-value enum migration + `owner_id`), 7 (domain/schema/readiness/UI). B3 Asset inventory → Tasks 8 (schema+attack tests), 9 (domain), 10 (actions/list/new/nav), 11 (detail/edit/link/help). B4 Export → Tasks 12 (helper + `exceljs`), 13 (risk/SoA/assets routes), 14 (tasks/evidence/assessment routes + download e2e). Cross-cutting gate → Task 15. **15 tasks.**
- **v2 §10 gates baked in:** every new tenant table (`risk_categories`, `risk_matrix_config`, `risk_treatment_plans`, `asset_categories`, `assets`, `asset_risks`) has split RLS + a `capture_audit_event` trigger + composite-FK/validate tenant integrity + a pgTAP attack test (010–014); every new page has an e2e + axe assertion; domain fns are test-first; copy is en-GB; classification/value help text is reworded (Task 11), not copied.
- **Behaviour preservation verified:** `riskBand`'s default config `{lowMax:4,moderateMax:9,highMax:14}` reproduces the existing test `[4,5,10,15,25] → [low,moderate,high,very_high,very_high]` (Task 3 keeps the legacy single-arg test and adds config tests). SoA migration mapping is `implemented→operational, partial→in_progress, planned→pending, not_applicable→not_applicable` (Task 6), and `create_soa_draft`'s default-driven insert is preserved by setting the new default `'pending'`.
- **E2E contract preservation flagged where it bites:** SoA `select[name="assessmentId"]`/`Generate draft`/`/N open task/`/item `<form>`+`<h2>` called out in Tasks 6–7; risks `Accept as task`/from-gap form called out in Task 2; tasks selector + the new `risk_treatment` source label in Tasks 4–5; assessment `New assessment`/10-combobox untouched.
- **Type-name consistency:** `RiskMatrixConfig`/`DEFAULT_RISK_MATRIX_CONFIG`/`RISK_BAND_LABEL` (risks domain), `RtpStatus`/`summariseRtpProgress` (rtp domain), `SoaStatus`(7)/`SOA_STATUS_LABEL`/`soaReadinessWeight` (soa domain), `AssetClassification`/`AssetValue`/`assetInputSchema` (assets), `ExportColumn`/`toCsv`/`toXlsx` (exports) are each defined once and consumed by exact name across tasks.
- **Migration numbering:** sequential `202607020010`–`202607020016` (0010 risk_categories, 0011 risks.category FK, 0012 risk_matrix_config, 0013 risk_treatment_plans, 0014 task_source value, 0015 soa status, 0016 assets); pgTAP `010`–`014`. The enum-value addition is isolated in 0014 so it is committed before any runtime insert uses it.
- **Could NOT fully turn into a concrete task:** none of Phase B's four workstreams were dropped. The one deliberately-bounded area is the **risk-appetite/RAG config editability** — the spec says "editable per-workspace RAG band configuration"; Task 3 delivers the table, domain, read path, AND a compact inline threshold editor on the risks page (rather than a separate settings screen), which satisfies "configurable" without expanding scope. Import/column-mapping is explicitly Phase B.5 and is out of scope by the spec.
