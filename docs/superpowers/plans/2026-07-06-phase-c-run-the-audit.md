# Phase C — Run the Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the ISO 27001 internal audit inside ComplianceHub instead of spreadsheets — schedule audits, work a clause/control checklist, raise findings that become owned remediation tasks, track KPIs for management review, produce a leadership readiness report plus an audit evidence pack, and give an external auditor a time-boxed, login-free, read-only link.

**Architecture:** Four workstreams, each additive. C1 (audits) adds three tenant tables (`audits`, `audit_checklist_items`, `audit_findings`) following the canonical pattern in `202607020003_soa_risks_audit.sql` verbatim (`organisation_id` column, `is_organisation_member()` split RLS, composite `(id, organisation_id)` FK tenant guards, `capture_audit_event()` AFTER trigger), extends `evidence_links` with a nullable `audit_checklist_item_id`, and adds an `'audit'` value to `public.task_source` in its OWN isolated migration (committed before any insert uses it, per the Postgres enum-ordering rule). Findings/KPIs spawn remediation via the existing tasks engine (`supabase.from("tasks").insert({ source: "audit" })`) — no parallel task machinery. C2 (KPIs) adds a light flat `kpis` register. C3 (reporting) adds read-only aggregation pages/routes reusing the existing domain functions (`summariseSoaReadiness`, `riskBand`, `summariseEvidenceFreshness`) and the `exports` helper — no new tables. C4 (auditor access) adds a hashed-at-rest `auditor_access_tokens` table and a SINGLE token-gated `security definer` RPC `audit_view_for_token(raw_token)` — the one sanctioned elevated read for an unauthenticated visitor, org-scoped inside its body — feeding a PUBLIC `/audit-view/[token]` page outside the authenticated app group (its own minimal layout, no service-role client). Domain logic lives in `src/features/<area>/domain` with vitest tests written first; new `/app` pages are fragments in the Phase-A design language.

**Tech Stack:** Next.js 16 (App Router, server components + server actions), React 19, Tailwind v4 + the hand-authored design system in `src/app/globals.css`, Supabase (Postgres 15 + RLS + pgcrypto `extensions.digest`), zod v4, `pdfkit` (readiness report PDF, already a dependency), `exceljs` via `src/features/exports/exports.ts` (evidence pack), Playwright + `@axe-core/playwright`, vitest, pgTAP.

## Global Constraints

- **v2 §10 non-negotiables (every task):** RLS + pgTAP attack tests on EVERY new tenant table asserting ALL FOUR cross-tenant verbs (SELECT read-isolation, INSERT `42501`, UPDATE affects-no-rows, DELETE affects-no-rows) plus composite-FK rejection (`23503`); tenant-validation + `capture_audit_event()` audit triggers on every new table; **domain-first testing** (write the vitest/pgTAP assertion before the implementation); **e2e + axe (zero violations)** on every new page including the public `/audit-view`; **en-GB** copy throughout; **ORIGINAL content only** — reword the toolkit's checklist/methodology text in your own words, never copy cell text verbatim.
- **Auditor access security (C4):** the ONLY elevated read is the token-gated `security definer` RPC, org-scoped inside its body (every internal query filtered by the resolved `organisation_id`); NO service-role client anywhere in the public view; the token is stored **hashed** (`sha256` hex, never raw at rest); the raw token is shown to the owner **ONCE** at mint; expired / revoked / unknown tokens are refused (RPC returns `null`).
- **Migrations are additive.** Numbering continues from `202607020016`; this plan assigns `202607020017` … `202607020024` (one per migration task, in task order). The `'audit'` `task_source` value gets its OWN isolated migration (`202607020021`) committed before any code inserts it. pgTAP test files continue from `014`; this plan assigns `015` … `021`. Schema changes are tested against the **already-migrated local DB** — do NOT run `npx supabase db reset` (unreliable here due to dual Docker runtimes). Apply with `npx supabase migration up`, then run `npx supabase test db`.
- **Reuse tokens; never invent colours.** Real `Pill`/`Stat` tones: `blue`(default) `green` `low` `amber` `medium` `red` `high` `critical` `neutral`. Real `Icon` names: `shield home clipboard file alert settings menu arrow check download plus users lock bell`. Do not add CSS unless a step explicitly appends to `globals.css`.
- **Single landmark + single h1 per authenticated page.** `AppShell` renders the only `<main className="content">` and the only page-title `<h1>`. Every `/app` page returns a **fragment** (section/item headings are `<h2>`/`<h3>`); new titles register in `AppShell`'s `TITLES` array with `/X/new` and detail routes BEFORE their parent. The PUBLIC `/audit-view/[token]` page lives OUTSIDE `src/app/app/` with its own minimal read-only layout — it owns its own single `<main>` and its own `<h1>` (it does NOT borrow AppShell).
- **Environment (this machine):**
  - `pnpm` is **not** on `PATH`. Run every tool via `npx <tool>` or `./node_modules/.bin/<tool>`.
  - Playwright has `reuseExistingServer: true` (non-CI). **Before running Playwright, start the dev server yourself:** `./node_modules/.bin/next dev` (background) and wait for `http://127.0.0.1:3000`.
  - Local Supabase stack runs at `127.0.0.1:54321`. Apply new migrations with `npx supabase migration up`, then `npx supabase test db`.
  - Integration tests (`**/*.integration.test.{ts,tsx}`) are **excluded** from `npx vitest run` by `vitest.config.ts`.
- **Conventional commits, the configured Git author, NO co-author trailer.** The pre-commit privacy hook has known false positives; `git commit --no-verify` is permitted **only** when a commit is blocked with zero genuine findings.
- **Work in this working directory on the existing `phase-a-ui-uplift` branch** (or a fresh `phase-c-run-the-audit` branch created in Task 1). No separate worktree.

### Existing signatures this plan builds on (all verified against the codebase)

- Canonical DB primitives (`202607020001_foundation.sql`): `public.is_organisation_member(target_organisation_id uuid) returns boolean`; `public.reject_immutable_change()`; `public.memberships` has `primary key (organisation_id, user_id)` (the composite-FK target for `lead_auditor_id`/`responsible_id`); `public.invitations` stores `token_hash text not null unique` + `expires_at timestamptz`.
- `capture_audit_event()` (`202607020003_soa_risks_audit.sql:143`): `security definer set search_path = ''`; derives `org_id` from `row_data ->> 'organisation_id'` for any table NOT named in its `case tg_table_name` branch. **Every Phase C table carries an `organisation_id` column, so NO edit to this function is required** — it audits them via the `else` branch.
- `public.accept_invitation(raw_token text)` (`202607020001_foundation.sql`): the token-hash lookup pattern to mirror — `token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'), 'hex')`, filtered by `accepted_at is null and expires_at > now()`. `create_organisation_with_owner` / `create_soa_draft` (`202607020004`) show the `security definer set search_path='' … fully.qualified.names … using errcode='42501'` house style.
- Token minting (`src/features/organisations/application/organisation.ts:37-39`): `const token = randomBytes(32).toString("base64url"); const tokenHash = createHash("sha256").update(token).digest("hex"); const expiresAt = new Date(Date.now() + 7*24*60*60*1000).toISOString();` — the Node hash (`sha256` hex) matches the Postgres `encode(digest(...),'hex')` above. Reuse verbatim for auditor tokens (read-only, login-free).
- `public.tasks` (`202607020006_tasks.sql`): `source public.task_source not null default 'manual'` (enum values `manual, gap, evidence_expiry, policy_review, system`, plus `risk_treatment` from `202607020014`); `unique (id, organisation_id)`; `constraint tasks_owner_tenant_fk foreign key (organisation_id, owner_id) references public.memberships(organisation_id, user_id)`; RLS insert requires `created_by = (select auth.uid())`. Direct insert pattern: `supabase.from("tasks").insert({ organisation_id, title, detail, owner_id, due_on, source: "audit", control_id, created_by })`.
- `public.evidence_links` (`202607020007_evidence.sql:37-59`): carries `organisation_id`, composite tenant FKs, split RLS, an audit trigger, a **named** check `evidence_links_policy_deferred` and a **single unnamed** check auto-named `evidence_links_check` = `num_nonnulls(control_id, risk_id, task_id, policy_id) = 1`, plus per-target `unique (evidence_id, <col>)`.
- `public.controls` (`202607020005_control_library.sql:28`): the control library `control_id` targets.
- Reporting aggregates: `soaReadinessWeight(status)` / `summariseSoaReadiness(items)` (`src/features/soa/domain/readiness.ts`); `calculateRiskScore(l,i)` / `riskBand(score, config?)` / `DEFAULT_RISK_MATRIX_CONFIG` / `type RiskBand` (`src/features/risks/domain/risks.ts`); `summariseEvidenceFreshness(items)` / `type EvidenceStatus` (`src/features/evidence/domain/evidence.ts`); `type SoaStatus` + `SOA_STATUS_LABEL` (`src/features/soa/domain/soa.ts`).
- Exports (`src/features/exports/exports.ts`): `type ExportColumn<T> = { header: string; value: (row: T) => string | number | null }`; `toCsv<T>(columns, rows): string`; `toXlsx<T>(sheetName, columns, rows): Promise<Buffer>` (CSV-injection-guarded).
- Download route pattern (`src/app/api/app/soa/[snapshotId]/[format]/route.ts`): auth via `supabase.auth.getUser()`, then `new NextResponse(new Uint8Array(buffer), { headers: { "content-type": …, "content-disposition": 'attachment; filename="…"', "cache-control": "private, no-store" } })`. PDF via `generateSoaPdf` in `src/features/soa/application/export.ts` (uses `import PDFDocument from "pdfkit"`).
- `requireAppContext()` (`src/lib/app-context.ts`) → `{ supabase, user, membership:{organisation_id,role,...}, organisation:{id,name} }`. `enforceRateLimit(key, {limit,windowMs})` (`src/lib/security/rate-limit.ts`). `createSupabaseServerClient()` (`src/lib/supabase/server.ts`) — for a logged-out visitor it operates as the `anon` role (used by the public audit view).
- UI: `PageIntro({eyebrow?,title,body,action?})`, `Card(HTMLAttributes)`, `Stat({label,value,detail,tone?})`, `Pill({children,tone?})`, `Progress({value,tone?})`, `Ring({value,size?})` from `src/components/ui.tsx`; `Icon({name})` from `src/components/icons.tsx`. `AppShell` (`src/components/app-shell.tsx`) owns the `nav` array + `TITLES`. List pages return a fragment starting with `<PageIntro>`, load data via one `await Promise.all([...])`, render tables inside `<Card><div className="data-table-wrap" role="region" aria-label="…" tabIndex={0}>`. Public/read-only layout model: `src/app/(auth)/layout.tsx` (own `<main>`, inline styles, own brand mark).

---

## Workstream C1 — Internal audit module (Tasks 1–8)

### Task 1: `audits` table + `audit_status` enum + RLS + attack tests

Stand up the audit header entity following the canonical tenant-table pattern. `lead_auditor_id` uses a composite `(organisation_id, lead_auditor_id)` FK into `memberships` so a lead auditor must be a member of the same org.

**Files:**
- Create branch `phase-c-run-the-audit` (Step 1)
- Create: `supabase/migrations/202607020017_audits.sql`
- Create: `supabase/tests/database/015_audits.sql`

**Interfaces:**
- Consumes: `public.organisations`, `public.memberships`, `public.is_organisation_member`, `public.capture_audit_event` (all existing).
- Produces: enum `public.audit_status` (`planned`,`in_progress`,`reporting`,`closed`); table `public.audits(id, organisation_id, reference, title, scope, status, lead_auditor_id, planned_start, planned_end, framework, created_by, created_at, updated_at)` with `unique (organisation_id, reference)` and `unique (id, organisation_id)` (composite-FK target for Tasks 2–3 and C4).

- [ ] **Step 1: Create the branch**

```bash
git checkout -b phase-c-run-the-audit
```

Expected: `Switched to a new branch 'phase-c-run-the-audit'`. (If it already exists, `git checkout phase-c-run-the-audit`.)

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/202607020017_audits.sql`:

```sql
-- Phase C1: internal audit header. Mirrors the toolkit's Internal Audit Plan
-- (audit numbers 001-004 across auditable areas) as a first-class entity.
-- Status is a simple lifecycle (no workflow engine). lead_auditor_id must be a
-- member of the same organisation (composite tenant FK into memberships).

create type public.audit_status as enum ('planned', 'in_progress', 'reporting', 'closed');

create table public.audits (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  reference text not null check (char_length(reference) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  scope text not null default '' check (char_length(scope) <= 10000),
  status public.audit_status not null default 'planned',
  lead_auditor_id uuid,
  planned_start date,
  planned_end date,
  framework text not null default 'ISO 27001:2022' check (char_length(framework) between 1 and 120),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, reference),
  unique (id, organisation_id),
  constraint audits_lead_tenant_fk foreign key (organisation_id, lead_auditor_id)
    references public.memberships(organisation_id, user_id) on delete set null (lead_auditor_id)
);
create index audits_org_status_idx on public.audits(organisation_id, status);

create trigger audits_audit after insert or update or delete on public.audits
for each row execute function public.capture_audit_event();

alter table public.audits enable row level security;
create policy audits_members_select on public.audits for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy audits_members_insert on public.audits for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy audits_members_update on public.audits for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy audits_members_delete on public.audits for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.audits from anon, authenticated;
grant select, insert, update, delete on public.audits to authenticated;
```

- [ ] **Step 3: Write the pgTAP attack test (all four cross-tenant verbs + FK rejection)**

Create `supabase/tests/database/015_audits.sql`:

```sql
begin;
select plan(8);

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

select lives_ok(
  $$ insert into public.audits (id, organisation_id, reference, title, created_by, lead_auditor_id)
     values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'AUD-001', 'Annual ISMS audit', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members plan an audit in their own tenant');
select throws_ok(
  $$ insert into public.audits (organisation_id, reference, title, created_by, lead_auditor_id)
     values ('20000000-0000-4000-8000-000000000001', 'AUD-002', 'x', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'the lead auditor must be a member of the audit organisation');
select throws_ok(
  $$ insert into public.audits (organisation_id, reference, title, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'forged', 'x', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot plan an audit in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.audits where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'audits are read-isolated per tenant');
select results_eq(
  $$ update public.audits set title = 'hijacked' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant update affects no rows');
select results_eq(
  $$ delete from public.audits where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant delete affects no rows');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.audits set status = 'in_progress' where id = '30000000-0000-4000-8000-000000000001' $$,
  'members progress their own audit');
select is(
  (select count(*) from public.audit_events where entity_type = 'audits' and organisation_id = '20000000-0000-4000-8000-000000000001'),
  2::bigint, 'audit inserts and updates are captured to the audit trail');

select * from finish();
rollback;
```

- [ ] **Step 4: Apply and test**

```bash
npx supabase migration up
npx supabase test db
```

Expected: `015_audits.sql .. ok`; all prior test files (`001`–`014`) still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607020017_audits.sql supabase/tests/database/015_audits.sql
git commit -m "feat: add the internal audit header entity with tenant-safe RLS"
```

---

### Task 2: `audit_checklist_items` table + `checklist_result` enum + attack tests

The toolkit's 9-column Internal Audit Checklist, one row per item. `audit_id` and `responsible_id` are composite tenant FKs; `control_id` links to the control library when the clause reference maps to a control.

**Files:**
- Create: `supabase/migrations/202607020018_audit_checklist_items.sql`
- Create: `supabase/tests/database/016_audit_checklist_items.sql`

**Interfaces:**
- Consumes: `public.audits` (Task 1), `public.controls`, `public.memberships`.
- Produces: enum `public.checklist_result` (`compliant`,`non_compliant`,`not_applicable`,`not_tested`); table `public.audit_checklist_items(id, organisation_id, audit_id, area, clause_reference, checklist_item, control_id, compliant, evidence_note, findings, responsible_id, reviewed_on, position, created_at, updated_at)` with `unique (id, organisation_id)` (target for the evidence link in Task 4) and `unique (audit_id, position)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020018_audit_checklist_items.sql`:

```sql
-- Phase C1: the audit checklist (toolkit's 9-column Internal Audit Checklist,
-- one row per item). clause_reference mixes main-clause numbers (5.2, 6.1.2)
-- and Annex A refs (A.8.1); control_id links to the control library where the
-- ref maps. compliant defaults to not_tested; a non_compliant item is where
-- findings are raised (Task 3).

create type public.checklist_result as enum ('compliant', 'non_compliant', 'not_applicable', 'not_tested');

create table public.audit_checklist_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  audit_id uuid not null,
  area text not null default '' check (char_length(area) <= 200),
  clause_reference text not null default '' check (char_length(clause_reference) <= 40),
  checklist_item text not null check (char_length(checklist_item) between 1 and 2000),
  control_id uuid references public.controls(id) on delete set null,
  compliant public.checklist_result not null default 'not_tested',
  evidence_note text not null default '' check (char_length(evidence_note) <= 10000),
  findings text not null default '' check (char_length(findings) <= 10000),
  responsible_id uuid,
  reviewed_on date,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (audit_id, position),
  constraint audit_checklist_items_audit_tenant_fk foreign key (audit_id, organisation_id)
    references public.audits(id, organisation_id) on delete cascade,
  constraint audit_checklist_items_responsible_tenant_fk foreign key (organisation_id, responsible_id)
    references public.memberships(organisation_id, user_id) on delete set null (responsible_id)
);
create index audit_checklist_items_audit_idx on public.audit_checklist_items(audit_id, position);

create trigger audit_checklist_items_audit after insert or update or delete on public.audit_checklist_items
for each row execute function public.capture_audit_event();

alter table public.audit_checklist_items enable row level security;
create policy audit_checklist_items_members_select on public.audit_checklist_items for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy audit_checklist_items_members_insert on public.audit_checklist_items for insert to authenticated
with check (public.is_organisation_member(organisation_id) and exists (
  select 1 from public.audits a where a.id = audit_id and a.organisation_id = organisation_id));
create policy audit_checklist_items_members_update on public.audit_checklist_items for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy audit_checklist_items_members_delete on public.audit_checklist_items for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.audit_checklist_items from anon, authenticated;
grant select, insert, update, delete on public.audit_checklist_items to authenticated;
```

- [ ] **Step 2: Write the pgTAP attack test**

Create `supabase/tests/database/016_audit_checklist_items.sql` — same two-tenant header as Task 1 (users `1…0001/0002`, orgs `2…0001/0002`, owner memberships), then one audit per tenant, then `plan(7)`:

```sql
insert into public.audits (id, organisation_id, reference, title, created_by) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'AUD-001', 'Audit A', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'AUD-001', 'Audit B', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.audit_checklist_items (organisation_id, audit_id, checklist_item, position)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Is the information security policy approved and current?', 0) $$,
  'members add checklist items to their own audit');
select throws_ok(
  $$ insert into public.audit_checklist_items (organisation_id, audit_id, checklist_item, position)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'x', 1) $$,
  '23503', null, 'a checklist item cannot attach to another tenant''s audit');
select throws_ok(
  $$ insert into public.audit_checklist_items (organisation_id, audit_id, checklist_item, position)
     values ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'forged', 0) $$,
  '42501', null, 'members cannot add items in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.audit_checklist_items where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'checklist items are read-isolated per tenant');
select results_eq(
  $$ update public.audit_checklist_items set compliant = 'compliant' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant checklist update affects no rows');
select results_eq(
  $$ delete from public.audit_checklist_items where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant checklist delete affects no rows');
select is((select count(*) from public.audit_events where entity_type = 'audit_checklist_items' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'checklist writes are audited per tenant');
```

- [ ] **Step 3: Apply and test**

```bash
npx supabase migration up
npx supabase test db
```

Expected: `016_audit_checklist_items.sql .. ok`; prior tests still green.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607020018_audit_checklist_items.sql supabase/tests/database/016_audit_checklist_items.sql
git commit -m "feat: add the audit checklist item register"
```

---

### Task 3: `audit_findings` table + `finding_severity`/`finding_status` enums + attack tests

Findings/non-conformities. `task_id` is a nullable composite FK to `tasks` (the spawned remediation task from Task 7). `checklist_item_id` optionally links a finding to the item that produced it.

**Files:**
- Create: `supabase/migrations/202607020019_audit_findings.sql`
- Create: `supabase/tests/database/017_audit_findings.sql`

**Interfaces:**
- Consumes: `public.audits`, `public.audit_checklist_items`, `public.tasks`.
- Produces: enums `public.finding_severity` (`observation`,`minor_nc`,`major_nc`), `public.finding_status` (`open`,`in_progress`,`closed`); table `public.audit_findings(id, organisation_id, audit_id, checklist_item_id, summary, severity, root_cause, corrective_action, task_id, status, created_at, updated_at, created_by)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020019_audit_findings.sql`:

```sql
-- Phase C1: audit findings / non-conformities. A finding with a corrective
-- action spawns a remediation task through the existing tasks engine
-- (source 'audit', added in 202607020021) and links it via task_id. Severity
-- distinguishes observations from minor/major non-conformities.

create type public.finding_severity as enum ('observation', 'minor_nc', 'major_nc');
create type public.finding_status as enum ('open', 'in_progress', 'closed');

create table public.audit_findings (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  audit_id uuid not null,
  checklist_item_id uuid,
  summary text not null check (char_length(summary) between 1 and 2000),
  severity public.finding_severity not null default 'observation',
  root_cause text not null default '' check (char_length(root_cause) <= 10000),
  corrective_action text not null default '' check (char_length(corrective_action) <= 10000),
  task_id uuid,
  status public.finding_status not null default 'open',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  constraint audit_findings_audit_tenant_fk foreign key (audit_id, organisation_id)
    references public.audits(id, organisation_id) on delete cascade,
  constraint audit_findings_item_tenant_fk foreign key (checklist_item_id, organisation_id)
    references public.audit_checklist_items(id, organisation_id) on delete set null (checklist_item_id),
  constraint audit_findings_task_tenant_fk foreign key (task_id, organisation_id)
    references public.tasks(id, organisation_id) on delete set null (task_id)
);
create index audit_findings_audit_idx on public.audit_findings(audit_id, status);

create trigger audit_findings_audit after insert or update or delete on public.audit_findings
for each row execute function public.capture_audit_event();

alter table public.audit_findings enable row level security;
create policy audit_findings_members_select on public.audit_findings for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy audit_findings_members_insert on public.audit_findings for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()) and exists (
  select 1 from public.audits a where a.id = audit_id and a.organisation_id = organisation_id));
create policy audit_findings_members_update on public.audit_findings for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy audit_findings_members_delete on public.audit_findings for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.audit_findings from anon, authenticated;
grant select, insert, update, delete on public.audit_findings to authenticated;
```

- [ ] **Step 2: Write the pgTAP attack test**

Create `supabase/tests/database/017_audit_findings.sql` — two-tenant header, one audit per tenant (`30…0001`/`30…0002` as in Task 2), then `plan(7)`:

```sql
insert into public.audits (id, organisation_id, reference, title, created_by) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'AUD-001', 'Audit A', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'AUD-001', 'Audit B', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.audit_findings (organisation_id, audit_id, summary, severity, created_by)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Access reviews are not evidenced', 'minor_nc', '10000000-0000-4000-8000-000000000001') $$,
  'members raise findings on their own audit');
select throws_ok(
  $$ insert into public.audit_findings (organisation_id, audit_id, summary, created_by)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'x', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a finding cannot attach to another tenant''s audit');
select throws_ok(
  $$ insert into public.audit_findings (organisation_id, audit_id, summary, created_by)
     values ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'forged', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot raise findings in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.audit_findings where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'findings are read-isolated per tenant');
select results_eq(
  $$ update public.audit_findings set status = 'closed' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant finding update affects no rows');
select results_eq(
  $$ delete from public.audit_findings where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant finding delete affects no rows');
select is((select count(*) from public.audit_events where entity_type = 'audit_findings' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'finding writes are audited per tenant');
```

- [ ] **Step 3: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020019_audit_findings.sql supabase/tests/database/017_audit_findings.sql
git commit -m "feat: add audit findings with severity, status, and task linkage"
```

Expected: `017_audit_findings.sql .. ok`; prior tests green.

---

### Task 4: Extend `evidence_links` with `audit_checklist_item_id` + attack test

**Decision (justified):** extend `evidence_links` rather than create a new `audit_evidence_links` table. `evidence_links` already carries `organisation_id`, composite tenant FKs, split RLS, and an audit trigger; adding a nullable `audit_checklist_item_id` with a composite tenant FK, widening the "exactly one target" check, and adding a per-target uniqueness constraint reuses all of that verbatim. A new table would duplicate the entire RLS/trigger apparatus for zero benefit and would fragment "evidence linked to X" queries. The only wrinkle is the unnamed check `evidence_links_check` (`num_nonnulls(control_id, risk_id, task_id, policy_id) = 1`), which we drop and re-add including the new column.

**Files:**
- Create: `supabase/migrations/202607020020_evidence_links_audit_item.sql`
- Create: `supabase/tests/database/018_evidence_audit_links.sql`

**Interfaces:**
- Consumes: `public.evidence_links`, `public.audit_checklist_items`, `public.evidence`.
- Produces: column `evidence_links.audit_checklist_item_id uuid` (nullable) with composite tenant FK, widened one-target check, `unique (evidence_id, audit_checklist_item_id)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020020_evidence_links_audit_item.sql`:

```sql
-- Phase C1: allow an evidence record to be linked to an audit checklist item.
-- evidence_links already models "evidence attached to exactly one of {control,
-- risk, task, policy}"; we add audit_checklist_item as a fifth target. The
-- one-target check is unnamed (auto-named evidence_links_check); drop and
-- re-add it widened. If a future Postgres names it differently, adjust the
-- drop to the name shown by \d public.evidence_links.

alter table public.evidence_links add column audit_checklist_item_id uuid;

alter table public.evidence_links
  add constraint evidence_links_audit_item_tenant_fk foreign key (audit_checklist_item_id, organisation_id)
    references public.audit_checklist_items(id, organisation_id) on delete cascade;

alter table public.evidence_links drop constraint if exists evidence_links_check;
alter table public.evidence_links
  add constraint evidence_links_one_target check (
    num_nonnulls(control_id, risk_id, task_id, policy_id, audit_checklist_item_id) = 1);

alter table public.evidence_links add constraint evidence_links_evidence_audit_item_key
  unique (evidence_id, audit_checklist_item_id);
```

- [ ] **Step 2: Write the pgTAP attack test**

Create `supabase/tests/database/018_evidence_audit_links.sql` — two-tenant header, then per-tenant an audit, a checklist item, and an evidence record; `plan(5)`:

```sql
insert into public.audits (id, organisation_id, reference, title, created_by) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'AUD-001', 'Audit A', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'AUD-001', 'Audit B', '10000000-0000-4000-8000-000000000002');
insert into public.audit_checklist_items (id, organisation_id, audit_id, checklist_item, position) values
  ('31000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Policy approved?', 0),
  ('31000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'Policy approved?', 0);
insert into public.evidence (id, organisation_id, title, kind, description, created_by) values
  ('32000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Signed policy', 'note', '', '10000000-0000-4000-8000-000000000001'),
  ('32000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Signed policy', 'note', '', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, audit_checklist_item_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members link evidence to a checklist item in their own tenant');
select throws_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, control_id, audit_checklist_item_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', (select id from public.controls limit 1), '31000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'a link must target exactly one of control/risk/task/policy/checklist-item');
select throws_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, audit_checklist_item_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'evidence cannot link to another tenant''s checklist item');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.evidence_links where audit_checklist_item_id = '31000000-0000-4000-8000-000000000001'), 0::bigint, 'evidence links are read-isolated per tenant');
select results_eq(
  $$ delete from public.evidence_links where audit_checklist_item_id = '31000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant evidence-link delete affects no rows');
```

- [ ] **Step 3: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020020_evidence_links_audit_item.sql supabase/tests/database/018_evidence_audit_links.sql
git commit -m "feat: allow evidence to be linked to audit checklist items"
```

Expected: `018_evidence_audit_links.sql .. ok`; `008_evidence.sql` still green (the widened check accepts every existing single-target link).

---

### Task 5: `'audit'` `task_source` value — isolated migration

Findings spawn remediation tasks through the existing engine. Per the Postgres enum-ordering rule (a value added by `ALTER TYPE` cannot be used in the same transaction), this value gets its own migration, committed before any insert (Task 7) uses it.

**Files:**
- Create: `supabase/migrations/202607020021_task_source_audit.sql`

**Interfaces:**
- Produces: `public.task_source` gains value `audit`.

- [ ] **Step 1: Write the enum-extension migration**

Create `supabase/migrations/202607020021_task_source_audit.sql`:

```sql
-- Phase C1: audit findings spawn remediation tasks via the existing tasks
-- engine. This adds the only new task source. Kept in its own migration so the
-- value is committed before any code inserts it (a freshly added enum value
-- cannot be used in the same transaction that adds it).

alter type public.task_source add value if not exists 'audit';
```

- [ ] **Step 2: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020021_task_source_audit.sql
git commit -m "feat: add an audit task source for corrective-action tasks"
```

Expected: migration applies; `007_tasks.sql` still green (the addition is backward-compatible).

---

### Task 6: Audits domain module + tests

Pure functions for the checklist completion %, finding severity summary, and status/label/tone maps. Domain-first: write the test, then the module.

**Files:**
- Create: `src/features/audits/domain/audits.ts`
- Create: `src/features/audits/domain/audits.test.ts`

**Interfaces:**
- Produces: `type AuditStatus`, `type ChecklistResult`, `type FindingSeverity`, `type FindingStatus`; label maps `AUDIT_STATUS_LABEL`, `CHECKLIST_RESULT_LABEL`, `FINDING_SEVERITY_LABEL`, `FINDING_STATUS_LABEL`; tone maps `AUDIT_STATUS_TONE`, `CHECKLIST_RESULT_TONE`, `FINDING_SEVERITY_TONE`, `FINDING_STATUS_TONE`; `checklistCompletion(items): { tested: number; total: number; percent: number }`; `summariseFindings(findings): { total: number; open: number; majorNc: number; minorNc: number; observations: number; openNonConformities: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/features/audits/domain/audits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AUDIT_STATUS_LABEL, CHECKLIST_RESULT_LABEL, checklistCompletion, summariseFindings } from "./audits";

describe("audit labels", () => {
  it("labels statuses and results in en-GB", () => {
    expect(AUDIT_STATUS_LABEL.in_progress).toBe("In progress");
    expect(CHECKLIST_RESULT_LABEL.non_compliant).toBe("Non-compliant");
    expect(CHECKLIST_RESULT_LABEL.not_tested).toBe("Not tested");
  });
});

describe("checklistCompletion", () => {
  it("counts anything other than not_tested as tested", () => {
    expect(checklistCompletion([])).toEqual({ tested: 0, total: 0, percent: 0 });
    expect(checklistCompletion([
      { compliant: "compliant" }, { compliant: "non_compliant" }, { compliant: "not_tested" }, { compliant: "not_applicable" },
    ])).toEqual({ tested: 3, total: 4, percent: 75 });
  });
});

describe("summariseFindings", () => {
  it("counts by severity and reports open non-conformities", () => {
    expect(summariseFindings([
      { severity: "major_nc", status: "open" },
      { severity: "minor_nc", status: "closed" },
      { severity: "observation", status: "open" },
      { severity: "major_nc", status: "in_progress" },
    ])).toEqual({ total: 4, open: 3, majorNc: 2, minorNc: 1, observations: 1, openNonConformities: 2 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/audits/domain/audits.test.ts`
Expected: FAIL — `Cannot find module './audits'`.

- [ ] **Step 3: Write the module**

Create `src/features/audits/domain/audits.ts`:

```ts
export type AuditStatus = "planned" | "in_progress" | "reporting" | "closed";
export type ChecklistResult = "compliant" | "non_compliant" | "not_applicable" | "not_tested";
export type FindingSeverity = "observation" | "minor_nc" | "major_nc";
export type FindingStatus = "open" | "in_progress" | "closed";

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = { planned: "Planned", in_progress: "In progress", reporting: "Reporting", closed: "Closed" };
export const AUDIT_STATUS_TONE: Record<AuditStatus, string> = { planned: "neutral", in_progress: "amber", reporting: "blue", closed: "green" };
export const CHECKLIST_RESULT_LABEL: Record<ChecklistResult, string> = { compliant: "Compliant", non_compliant: "Non-compliant", not_applicable: "Not applicable", not_tested: "Not tested" };
export const CHECKLIST_RESULT_TONE: Record<ChecklistResult, string> = { compliant: "green", non_compliant: "red", not_applicable: "neutral", not_tested: "amber" };
export const FINDING_SEVERITY_LABEL: Record<FindingSeverity, string> = { observation: "Observation", minor_nc: "Minor non-conformity", major_nc: "Major non-conformity" };
export const FINDING_SEVERITY_TONE: Record<FindingSeverity, string> = { observation: "neutral", minor_nc: "amber", major_nc: "critical" };
export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = { open: "Open", in_progress: "In progress", closed: "Closed" };
export const FINDING_STATUS_TONE: Record<FindingStatus, string> = { open: "red", in_progress: "amber", closed: "green" };

export function checklistCompletion(items: readonly { compliant: ChecklistResult }[]): { tested: number; total: number; percent: number } {
  const total = items.length;
  const tested = items.filter((i) => i.compliant !== "not_tested").length;
  return { tested, total, percent: total === 0 ? 0 : Math.round((tested / total) * 100) };
}

export function summariseFindings(findings: readonly { severity: FindingSeverity; status: FindingStatus }[]): { total: number; open: number; majorNc: number; minorNc: number; observations: number; openNonConformities: number } {
  return {
    total: findings.length,
    open: findings.filter((f) => f.status !== "closed").length,
    majorNc: findings.filter((f) => f.severity === "major_nc").length,
    minorNc: findings.filter((f) => f.severity === "minor_nc").length,
    observations: findings.filter((f) => f.severity === "observation").length,
    openNonConformities: findings.filter((f) => f.status !== "closed" && f.severity !== "observation").length,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/audits/domain/audits.test.ts`
Expected: PASS (3 suites).

- [ ] **Step 5: Commit**

```bash
git add src/features/audits/domain
git commit -m "feat: add the audit domain model, labels, and roll-ups"
```

---

### Task 7: Audits application schema + server actions (finding spawns a task)

The zod input schemas and the server actions: create an audit, add/update a checklist item, raise a finding (optionally spawning a corrective-action task via the tasks engine with `source: "audit"` and linking it back), update finding/audit status, and link evidence to a checklist item.

**Files:**
- Create: `src/features/audits/application/audit.ts`
- Create: `src/app/app/audits/actions.ts`

**Interfaces:**
- Consumes: `requireAppContext`, `enforceRateLimit`, `public.audits`, `public.audit_checklist_items`, `public.audit_findings`, `public.tasks` (source `audit`), `public.evidence_links`.
- Produces: `auditInputSchema` / `AuditInput`; `checklistItemInputSchema`; `findingInputSchema`; actions `createAuditAction`, `updateAuditStatusAction`, `addChecklistItemAction`, `updateChecklistItemAction`, `raiseFindingAction`, `updateFindingStatusAction`, `linkChecklistEvidenceAction`.

- [ ] **Step 1: Write the zod schemas**

Create `src/features/audits/application/audit.ts`:

```ts
import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => (v ? v : null));

export const auditInputSchema = z.object({
  organisationId: z.string().uuid(),
  reference: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  scope: z.string().max(10_000).default(""),
  leadAuditorId: optionalUuid,
  plannedStart: optionalDate,
  plannedEnd: optionalDate,
  framework: z.string().trim().min(1).max(120).default("ISO 27001:2022"),
});
export type AuditInput = z.infer<typeof auditInputSchema>;

export const checklistItemInputSchema = z.object({
  auditId: z.string().uuid(),
  area: z.string().max(200).default(""),
  clauseReference: z.string().max(40).default(""),
  checklistItem: z.string().trim().min(1).max(2000),
  controlId: optionalUuid,
  compliant: z.enum(["compliant", "non_compliant", "not_applicable", "not_tested"]).default("not_tested"),
  evidenceNote: z.string().max(10_000).default(""),
  findings: z.string().max(10_000).default(""),
  responsibleId: optionalUuid,
  reviewedOn: optionalDate,
});

export const findingInputSchema = z.object({
  auditId: z.string().uuid(),
  checklistItemId: optionalUuid,
  summary: z.string().trim().min(1).max(2000),
  severity: z.enum(["observation", "minor_nc", "major_nc"]).default("observation"),
  rootCause: z.string().max(10_000).default(""),
  correctiveAction: z.string().max(10_000).default(""),
  ownerId: optionalUuid,
  dueOn: optionalDate,
  spawnTask: z.union([z.literal("on"), z.literal("")]).optional().transform((v) => v === "on"),
});
```

- [ ] **Step 2: Write the server actions**

Create `src/app/app/audits/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { auditInputSchema, checklistItemInputSchema, findingInputSchema } from "@/features/audits/application/audit";

export async function createAuditAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`audit:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = auditInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data, error } = await supabase.from("audits").insert({
    organisation_id: organisation.id, reference: parsed.reference, title: parsed.title, scope: parsed.scope,
    lead_auditor_id: parsed.leadAuditorId, planned_start: parsed.plannedStart, planned_end: parsed.plannedEnd,
    framework: parsed.framework, created_by: user.id,
  }).select("id").single();
  if (error) throw new Error("Could not plan the audit");
  revalidatePath("/app/audits"); redirect(`/app/audits/${data.id}`);
}

export async function updateAuditStatusAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["planned", "in_progress", "reporting", "closed"].includes(status)) throw new Error("Invalid audit status");
  const { error } = await supabase.from("audits").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the audit status");
  revalidatePath(`/app/audits/${id}`);
}

export async function addChecklistItemAction(formData: FormData) {
  const { supabase, organisation } = await requireAppContext();
  const parsed = checklistItemInputSchema.parse(Object.fromEntries(formData));
  const { data: last } = await supabase.from("audit_checklist_items").select("position").eq("audit_id", parsed.auditId).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("audit_checklist_items").insert({
    organisation_id: organisation.id, audit_id: parsed.auditId, area: parsed.area, clause_reference: parsed.clauseReference,
    checklist_item: parsed.checklistItem, control_id: parsed.controlId, compliant: parsed.compliant,
    evidence_note: parsed.evidenceNote, findings: parsed.findings, responsible_id: parsed.responsibleId,
    reviewed_on: parsed.reviewedOn, position: (last?.position ?? -1) + 1,
  });
  if (error) throw new Error("Could not add the checklist item");
  revalidatePath(`/app/audits/${parsed.auditId}`);
}

export async function updateChecklistItemAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const id = String(formData.get("id"));
  const auditId = String(formData.get("auditId"));
  const compliant = String(formData.get("compliant"));
  if (!["compliant", "non_compliant", "not_applicable", "not_tested"].includes(compliant)) throw new Error("Invalid result");
  const { error } = await supabase.from("audit_checklist_items").update({
    compliant, evidence_note: String(formData.get("evidenceNote") ?? ""), findings: String(formData.get("findings") ?? ""),
    reviewed_on: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error("Could not update the checklist item");
  revalidatePath(`/app/audits/${auditId}`);
}

export async function raiseFindingAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const parsed = findingInputSchema.parse(Object.fromEntries(formData));
  const { data: finding, error } = await supabase.from("audit_findings").insert({
    organisation_id: organisation.id, audit_id: parsed.auditId, checklist_item_id: parsed.checklistItemId,
    summary: parsed.summary, severity: parsed.severity, root_cause: parsed.rootCause,
    corrective_action: parsed.correctiveAction, created_by: user.id,
  }).select("id").single();
  if (error) throw new Error("Could not raise the finding");
  // Spawn a corrective-action task through the existing tasks engine (source 'audit').
  if (parsed.spawnTask && parsed.correctiveAction) {
    const { data: task, error: taskError } = await supabase.from("tasks").insert({
      organisation_id: organisation.id, title: `Corrective action: ${parsed.summary}`.slice(0, 200),
      detail: parsed.correctiveAction, owner_id: parsed.ownerId, due_on: parsed.dueOn,
      source: "audit", created_by: user.id,
    }).select("id").single();
    if (taskError) throw new Error("Raised the finding but could not create its task");
    const { error: linkError } = await supabase.from("audit_findings").update({ task_id: task.id, status: "in_progress" }).eq("id", finding.id);
    if (linkError) throw new Error("Created the task but could not link it to the finding");
  }
  revalidatePath(`/app/audits/${parsed.auditId}`); revalidatePath("/app/tasks");
}

export async function updateFindingStatusAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const id = String(formData.get("id"));
  const auditId = String(formData.get("auditId"));
  const status = String(formData.get("status"));
  if (!["open", "in_progress", "closed"].includes(status)) throw new Error("Invalid finding status");
  const { error } = await supabase.from("audit_findings").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the finding");
  revalidatePath(`/app/audits/${auditId}`);
}

export async function linkChecklistEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const auditId = String(formData.get("auditId"));
  const { error } = await supabase.from("evidence_links").insert({
    organisation_id: organisation.id, evidence_id: String(formData.get("evidenceId")),
    audit_checklist_item_id: String(formData.get("checklistItemId")), created_by: user.id,
  });
  if (error) throw new Error("Could not link the evidence");
  revalidatePath(`/app/audits/${auditId}`);
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
git add src/features/audits/application src/app/app/audits/actions.ts
git commit -m "feat: add audit server actions with finding-to-task spawning"
```

Expected: eslint + tsc clean.

---

### Task 8: Audits pages (list / new / detail) + nav + e2e/axe

The list (`/app/audits`) with a stat row, the plan form (`/app/audits/new`), and the detail (`/app/audits/[id]`) with the checklist table, inline result controls, findings list, and a "raise corrective-action task" form. Register nav + titles. e2e proves plan-audit → work-a-checklist-item → raise-finding → corrective-action task appears in `/app/tasks`.

**Files:**
- Create: `src/app/app/audits/page.tsx`
- Create: `src/app/app/audits/new/page.tsx`
- Create: `src/app/app/audits/[id]/page.tsx`
- Modify: `src/components/app-shell.tsx` (nav + TITLES)
- Modify: `e2e/product.spec.ts` (audit flow + axe)

**Interfaces:**
- Consumes: `createAuditAction`, `updateAuditStatusAction`, `addChecklistItemAction`, `updateChecklistItemAction`, `raiseFindingAction`, `updateFindingStatusAction` (Task 7); `checklistCompletion`, `summariseFindings`, label/tone maps (Task 6).
- Produces: routes `/app/audits`, `/app/audits/new`, `/app/audits/[id]`; nav item **`Audits`**.

- [ ] **Step 1: Write the list page**

Create `src/app/app/audits/page.tsx`:

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { AUDIT_STATUS_LABEL, AUDIT_STATUS_TONE, summariseFindings, type AuditStatus, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";

export default async function AuditsPage() {
  const { supabase } = await requireAppContext();
  const [{ data: audits }, { data: findings }] = await Promise.all([
    supabase.from("audits").select("id,reference,title,status,planned_start,planned_end").order("reference"),
    supabase.from("audit_findings").select("severity,status"),
  ]);
  const rows = audits ?? [];
  const openAudits = rows.filter((a) => a.status !== "closed").length;
  const f = summariseFindings((findings ?? []).map((x) => ({ severity: x.severity as FindingSeverity, status: x.status as FindingStatus })));
  return <>
    <PageIntro eyebrow="AUDIT" title="Internal audits" body="Plan an audit, work the clause and control checklist, and turn findings into owned corrective actions." action={<Link className="button primary" href="/app/audits/new"><Icon name="plus" />Plan an audit</Link>} />
    <div className="stats-grid">
      <Stat label="OPEN AUDITS" value={openAudits} detail="not yet closed" />
      <Stat label="OPEN FINDINGS" value={f.open} detail="awaiting closure" tone="amber" />
      <Stat label="NON-CONFORMITIES" value={f.openNonConformities} detail="minor or major, still open" tone="red" />
    </div>
    <Card><div className="data-table-wrap" role="region" aria-label="Internal audits table" tabIndex={0}><table>
      <thead><tr><th>Ref</th><th>Audit</th><th>Status</th><th>Window</th></tr></thead>
      <tbody>
        {rows.map((a) => <tr key={a.id}>
          <td>{a.reference}</td>
          <td><Link href={`/app/audits/${a.id}`}><b>{a.title}</b></Link></td>
          <td><Pill tone={AUDIT_STATUS_TONE[a.status as AuditStatus]}>{AUDIT_STATUS_LABEL[a.status as AuditStatus]}</Pill></td>
          <td>{a.planned_start ?? "—"} → {a.planned_end ?? "—"}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={4} style={{ color: "#596273" }}>No audits yet. Plan your first internal audit to start the checklist.</td></tr>}
      </tbody>
    </table></div></Card>
  </>;
}
```

- [ ] **Step 2: Write the plan-an-audit page**

Create `src/app/app/audits/new/page.tsx`:

```tsx
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { createAuditAction } from "../actions";

export default async function NewAuditPage() {
  const { supabase } = await requireAppContext();
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  return <>
    <PageIntro eyebrow="AUDIT" title="Plan an audit" body="Define the scope and window. You will add checklist items and raise findings from the audit's page." />
    <form action={createAuditAction} className="card app-form">
      <div className="form-grid">
        <label>Reference<input name="reference" required maxLength={40} placeholder="AUD-001" /></label>
        <label>Title<input name="title" required maxLength={200} /></label>
        <label>Lead auditor<select name="leadAuditorId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Framework<input name="framework" maxLength={120} defaultValue="ISO 27001:2022" /></label>
        <label>Planned start<input name="plannedStart" type="date" /></label>
        <label>Planned end<input name="plannedEnd" type="date" /></label>
      </div>
      <label>Scope<textarea name="scope" maxLength={10000} placeholder="Which processes, departments, and controls this audit covers." /></label>
      <button className="button primary">Plan audit</button>
    </form>
  </>;
}
```

- [ ] **Step 3: Write the detail page (checklist + findings + raise-task)**

Create `src/app/app/audits/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { AUDIT_STATUS_LABEL, CHECKLIST_RESULT_LABEL, CHECKLIST_RESULT_TONE, FINDING_SEVERITY_LABEL, FINDING_SEVERITY_TONE, FINDING_STATUS_LABEL, FINDING_STATUS_TONE, checklistCompletion, summariseFindings, type AuditStatus, type ChecklistResult, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";
import { Card, PageIntro, Pill, Progress } from "@/components/ui";
import { updateAuditStatusAction, addChecklistItemAction, updateChecklistItemAction, raiseFindingAction, updateFindingStatusAction } from "../actions";

const RESULTS: ChecklistResult[] = ["not_tested", "compliant", "non_compliant", "not_applicable"];

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAppContext();
  const { data: audit } = await supabase.from("audits").select("id,reference,title,scope,status,framework,planned_start,planned_end").eq("id", id).maybeSingle();
  if (!audit) notFound();
  const [{ data: items }, { data: findings }, { data: members }] = await Promise.all([
    supabase.from("audit_checklist_items").select("id,area,clause_reference,checklist_item,compliant,evidence_note,findings").eq("audit_id", id).order("position"),
    supabase.from("audit_findings").select("id,summary,severity,status,corrective_action,task_id").eq("audit_id", id).order("created_at"),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
  ]);
  const rows = items ?? [];
  const completion = checklistCompletion(rows.map((i) => ({ compliant: i.compliant as ChecklistResult })));
  const f = summariseFindings((findings ?? []).map((x) => ({ severity: x.severity as FindingSeverity, status: x.status as FindingStatus })));
  const status = audit.status as AuditStatus;
  return <>
    <Link href="/app/audits" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to audits</Link>
    <PageIntro eyebrow={`AUDIT ${audit.reference} · ${audit.framework}`} title={audit.title} body={audit.scope || "No scope recorded yet."} action={
      <form action={updateAuditStatusAction} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input type="hidden" name="id" value={id} />
        <select name="status" defaultValue={status} aria-label="Audit status">{(["planned", "in_progress", "reporting", "closed"] as AuditStatus[]).map((s) => <option key={s} value={s}>{AUDIT_STATUS_LABEL[s]}</option>)}</select>
        <button className="button secondary">Update status</button>
      </form>
    } />

    <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>Checklist progress</h2>
      <Progress value={completion.percent} />
      <p style={{ fontSize: "12px", color: "#596273", margin: "8px 0 0" }}>{completion.tested} of {completion.total} items tested · {f.openNonConformities} open non-conformities</p>
    </Card>

    <Card style={{ padding: 0 }}><div className="data-table-wrap" role="region" aria-label="Audit checklist" tabIndex={0}><table>
      <thead><tr><th>Area / clause</th><th>Checklist item</th><th>Result</th><th>Evidence &amp; findings</th></tr></thead>
      <tbody>
        {rows.map((i) => <tr key={i.id}>
          <td>{i.area || "—"}<small>{i.clause_reference}</small></td>
          <td>{i.checklist_item}</td>
          <td><Pill tone={CHECKLIST_RESULT_TONE[i.compliant as ChecklistResult]}>{CHECKLIST_RESULT_LABEL[i.compliant as ChecklistResult]}</Pill></td>
          <td>
            <form action={updateChecklistItemAction} style={{ display: "grid", gap: "6px" }}>
              <input type="hidden" name="id" value={i.id} /><input type="hidden" name="auditId" value={id} />
              <select name="compliant" defaultValue={i.compliant} aria-label={`Result for ${i.checklist_item}`}>{RESULTS.map((r) => <option key={r} value={r}>{CHECKLIST_RESULT_LABEL[r]}</option>)}</select>
              <input name="evidenceNote" defaultValue={i.evidence_note} placeholder="Evidence" aria-label={`Evidence for ${i.checklist_item}`} />
              <input name="findings" defaultValue={i.findings} placeholder="Findings" aria-label={`Findings for ${i.checklist_item}`} />
              <button className="button secondary">Save</button>
            </form>
          </td>
        </tr>)}
        {!rows.length && <tr><td colSpan={4} style={{ color: "#596273" }}>No checklist items yet. Add the first one below.</td></tr>}
      </tbody>
    </table></div></Card>

    <Card style={{ padding: "18px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Add checklist item</h2>
      <form action={addChecklistItemAction} className="app-form">
        <input type="hidden" name="auditId" value={id} />
        <div className="form-grid">
          <label>Area / process<input name="area" maxLength={200} placeholder="e.g. Access control" /></label>
          <label>Clause reference<input name="clauseReference" maxLength={40} placeholder="e.g. A.8.1 or 6.1.2" /></label>
        </div>
        <label>Checklist item<input name="checklistItem" required maxLength={2000} placeholder="The question the auditor asks." /></label>
        <button className="button secondary">Add item</button>
      </form>
    </Card>

    <Card style={{ padding: "18px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Findings</h2>
      <ul style={{ listStyle: "none", margin: "0 0 14px", padding: 0, display: "grid", gap: "10px" }}>
        {(findings ?? []).map((x) => <li key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "start" }}>
          <div><Pill tone={FINDING_SEVERITY_TONE[x.severity as FindingSeverity]}>{FINDING_SEVERITY_LABEL[x.severity as FindingSeverity]}</Pill> {x.summary}{x.task_id && <small style={{ display: "block", color: "#596273" }}>Corrective-action task raised.</small>}</div>
          <form action={updateFindingStatusAction} style={{ display: "flex", gap: "6px" }}>
            <input type="hidden" name="id" value={x.id} /><input type="hidden" name="auditId" value={id} />
            <select name="status" defaultValue={x.status} aria-label={`Status of finding: ${x.summary}`}>{(["open", "in_progress", "closed"] as FindingStatus[]).map((s) => <option key={s} value={s}>{FINDING_STATUS_LABEL[s]}</option>)}</select>
            <button className="button secondary">Save</button>
          </form>
        </li>)}
        {!findings?.length && <li style={{ color: "#596273", fontSize: "13px" }}>No findings raised yet.</li>}
      </ul>
      <h3 style={{ fontSize: "14px", margin: "0 0 8px" }}>Raise a finding</h3>
      <form action={raiseFindingAction} className="app-form">
        <input type="hidden" name="auditId" value={id} />
        <label>Summary<input name="summary" required maxLength={2000} /></label>
        <div className="form-grid">
          <label>Severity<select name="severity" defaultValue="observation"><option value="observation">Observation</option><option value="minor_nc">Minor non-conformity</option><option value="major_nc">Major non-conformity</option></select></label>
          <label>Owner (for the task)<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
          <label>Due date<input name="dueOn" type="date" /></label>
        </div>
        <label>Corrective action<textarea name="correctiveAction" maxLength={10000} /></label>
        <label style={{ display: "flex", gap: "8px", alignItems: "center", fontWeight: 700 }}><input type="checkbox" name="spawnTask" style={{ width: "auto" }} />Raise a corrective-action task from this finding</label>
        <button className="button primary">Raise finding</button>
      </form>
    </Card>
  </>;
}
```

- [ ] **Step 4: Register nav + titles**

In `src/components/app-shell.tsx`:
- Add to `nav` after the `["/app/soa", "file", "SoA"]` line: `["/app/audits", "shield", "Audits"],` (`shield` is otherwise used only by the brand mark, not the nav).
- Add to `TITLES` before `["/app", "Dashboard"]`: `["/app/audits/new", "Plan an audit"], ["/app/audits", "Internal audits"],` (the `/new` route first so it wins the `find`; the detail route `/app/audits/[id]` inherits "Internal audits").

- [ ] **Step 5: Add the e2e (plan → checklist → finding → task) + axe**

In `e2e/product.spec.ts`, add a step that: opens **`Audits`** from the workspace nav; clicks **`Plan an audit`**; fills Reference + Title; submits; on the detail page adds a checklist item (fill **Checklist item**, click **`Add item`**); sets that row's result select to **`Non-compliant`** and clicks its **`Save`**; in "Raise a finding" fills Summary, sets Severity to **`Minor non-conformity`**, fills Corrective action, ticks **`Raise a corrective-action task from this finding`**, clicks **`Raise finding`**; asserts the finding is visible; navigates to **`Tasks`** and asserts a task titled `Corrective action: …` is present; asserts zero axe violations on `/app/audits` and on `/app/audits/<id>`.

- [ ] **Step 6: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
git add src/app/app/audits src/components/app-shell.tsx e2e/product.spec.ts
git commit -m "feat: add the audit list, plan form, and checklist/findings detail page"
```

Expected: audit flow green on chromium + mobile; the corrective-action task appears in `/app/tasks`; axe clean on both new pages; nav shows **Audits**.

---

## Workstream C2 — Management review / KPI log (Tasks 9–10)

### Task 9: `kpis` table + `measurement_type` enum + attack tests

The toolkit's flat KPI register (indicator, measurement type, threshold, observations, next steps). No computed scoring/RAG — the toolkit has none.

**Files:**
- Create: `supabase/migrations/202607020022_kpis.sql`
- Create: `supabase/tests/database/019_kpis.sql`

**Interfaces:**
- Consumes: `public.organisations`, `public.memberships`, `public.tasks`.
- Produces: enum `public.measurement_type` (`automatic`,`manual`,`external`); table `public.kpis(id, organisation_id, control_function, indicator, measurement_type, threshold, observations, next_steps, responsible_id, last_reviewed, task_id, created_by, created_at, updated_at)` with `unique (id, organisation_id)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020022_kpis.sql`:

```sql
-- Phase C2: management-review KPI log (toolkit's flat Performance Measurement
-- register). No numeric scoring or RAG (the toolkit has none). Next steps may
-- spawn a task via the existing engine; task_id links it back.

create type public.measurement_type as enum ('automatic', 'manual', 'external');

create table public.kpis (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  control_function text not null default '' check (char_length(control_function) <= 200),
  indicator text not null check (char_length(indicator) between 1 and 300),
  measurement_type public.measurement_type not null default 'manual',
  threshold text not null default '' check (char_length(threshold) <= 500),
  observations text not null default '' check (char_length(observations) <= 10000),
  next_steps text not null default '' check (char_length(next_steps) <= 10000),
  responsible_id uuid,
  last_reviewed date,
  task_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  constraint kpis_responsible_tenant_fk foreign key (organisation_id, responsible_id)
    references public.memberships(organisation_id, user_id) on delete set null (responsible_id),
  constraint kpis_task_tenant_fk foreign key (task_id, organisation_id)
    references public.tasks(id, organisation_id) on delete set null (task_id)
);
create index kpis_org_idx on public.kpis(organisation_id, last_reviewed);

create trigger kpis_audit after insert or update or delete on public.kpis
for each row execute function public.capture_audit_event();

alter table public.kpis enable row level security;
create policy kpis_members_select on public.kpis for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy kpis_members_insert on public.kpis for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy kpis_members_update on public.kpis for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy kpis_members_delete on public.kpis for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.kpis from anon, authenticated;
grant select, insert, update, delete on public.kpis to authenticated;
```

- [ ] **Step 2: Write the pgTAP attack test**

Create `supabase/tests/database/019_kpis.sql` — two-tenant header, then `plan(7)`:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.kpis (organisation_id, indicator, measurement_type, created_by, responsible_id)
     values ('20000000-0000-4000-8000-000000000001', 'Mean time to revoke leaver access', 'manual', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members log a KPI in their own tenant');
select throws_ok(
  $$ insert into public.kpis (organisation_id, indicator, created_by, responsible_id)
     values ('20000000-0000-4000-8000-000000000001', 'x', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'the responsible party must be a member of the KPI organisation');
select throws_ok(
  $$ insert into public.kpis (organisation_id, indicator, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'forged', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot log a KPI in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.kpis where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'KPIs are read-isolated per tenant');
select results_eq(
  $$ update public.kpis set indicator = 'hijacked' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant KPI update affects no rows');
select results_eq(
  $$ delete from public.kpis where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant KPI delete affects no rows');
select is((select count(*) from public.audit_events where entity_type = 'kpis' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'KPI writes are audited per tenant');
```

- [ ] **Step 3: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020022_kpis.sql supabase/tests/database/019_kpis.sql
git commit -m "feat: add the management-review KPI register"
```

Expected: `019_kpis.sql .. ok`; prior tests green.

---

### Task 10: KPI domain + actions + page + nav + e2e/axe

Domain (measurement-type labels + a "needs review" staleness heuristic), zod schema, server actions (create/update, raise task from next steps), the list-with-inline-add page, nav, and e2e/axe.

**Files:**
- Create: `src/features/kpis/domain/kpis.ts`
- Create: `src/features/kpis/domain/kpis.test.ts`
- Create: `src/features/kpis/application/kpi.ts`
- Create: `src/app/app/kpis/actions.ts`
- Create: `src/app/app/kpis/page.tsx`
- Modify: `src/components/app-shell.tsx` (nav + TITLES)
- Modify: `e2e/product.spec.ts` (KPI create + raise task + axe)

**Interfaces:**
- Produces: `type MeasurementType`; `MEASUREMENT_TYPE_LABEL`; `needsReview(lastReviewed, today, maxAgeDays?): boolean`; `kpiInputSchema`; actions `createKpiAction`, `updateKpiAction`, `raiseKpiTaskAction`; route `/app/kpis`; nav item **`KPIs`**.

- [ ] **Step 1: Write the domain test then the module**

Create `src/features/kpis/domain/kpis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MEASUREMENT_TYPE_LABEL, needsReview } from "./kpis";

describe("measurement type labels", () => {
  it("labels every measurement type in en-GB", () => {
    expect(MEASUREMENT_TYPE_LABEL.automatic).toBe("Automatic");
    expect(MEASUREMENT_TYPE_LABEL.external).toBe("External");
  });
});

describe("needsReview", () => {
  it("flags never-reviewed and stale KPIs, not recent ones", () => {
    expect(needsReview(null, "2026-07-06")).toBe(true);
    expect(needsReview("2026-01-01", "2026-07-06")).toBe(true); // > 90 days
    expect(needsReview("2026-06-01", "2026-07-06")).toBe(false);
  });
});
```

Create `src/features/kpis/domain/kpis.ts`:

```ts
export type MeasurementType = "automatic" | "manual" | "external";
export const MEASUREMENT_TYPE_LABEL: Record<MeasurementType, string> = { automatic: "Automatic", manual: "Manual", external: "External" };
export const MEASUREMENT_TYPE_TONE: Record<MeasurementType, string> = { automatic: "green", manual: "blue", external: "amber" };
export const KPI_REVIEW_MAX_AGE_DAYS = 90;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function needsReview(lastReviewed: string | null, today: string, maxAgeDays: number = KPI_REVIEW_MAX_AGE_DAYS): boolean {
  if (!ISO_DATE.test(today)) throw new RangeError("today must be an ISO date (YYYY-MM-DD)");
  if (lastReviewed === null) return true;
  if (!ISO_DATE.test(lastReviewed)) throw new RangeError("lastReviewed must be an ISO date (YYYY-MM-DD)");
  const ageMs = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastReviewed}T00:00:00Z`);
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/features/kpis/domain/kpis.test.ts`
Expected: PASS (2 suites).

- [ ] **Step 3: Write the zod schema + actions**

Create `src/features/kpis/application/kpi.ts`:

```ts
import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => (v ? v : null));

export const kpiInputSchema = z.object({
  organisationId: z.string().uuid(),
  controlFunction: z.string().max(200).default(""),
  indicator: z.string().trim().min(1).max(300),
  measurementType: z.enum(["automatic", "manual", "external"]).default("manual"),
  threshold: z.string().max(500).default(""),
  observations: z.string().max(10_000).default(""),
  nextSteps: z.string().max(10_000).default(""),
  responsibleId: optionalUuid,
  lastReviewed: optionalDate,
});
export type KpiInput = z.infer<typeof kpiInputSchema>;
```

Create `src/app/app/kpis/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { kpiInputSchema } from "@/features/kpis/application/kpi";

function toRow(parsed: ReturnType<typeof kpiInputSchema.parse>, organisationId: string) {
  return {
    organisation_id: organisationId, control_function: parsed.controlFunction, indicator: parsed.indicator,
    measurement_type: parsed.measurementType, threshold: parsed.threshold, observations: parsed.observations,
    next_steps: parsed.nextSteps, responsible_id: parsed.responsibleId, last_reviewed: parsed.lastReviewed,
  };
}

export async function createKpiAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`kpi:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = kpiInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("kpis").insert({ ...toRow(parsed, organisation.id), created_by: user.id });
  if (error) throw new Error("Could not save the KPI");
  revalidatePath("/app/kpis");
}

export async function updateKpiAction(formData: FormData) {
  const { supabase, organisation } = await requireAppContext();
  const id = String(formData.get("id"));
  const parsed = kpiInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("kpis").update({ ...toRow(parsed, organisation.id), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the KPI");
  revalidatePath("/app/kpis");
}

export async function raiseKpiTaskAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const id = String(formData.get("id"));
  const indicator = String(formData.get("indicator"));
  const nextSteps = String(formData.get("nextSteps"));
  const ownerId = String(formData.get("ownerId") || "") || null;
  const { data: task, error } = await supabase.from("tasks").insert({
    organisation_id: organisation.id, title: `KPI follow-up: ${indicator}`.slice(0, 200),
    detail: nextSteps, owner_id: ownerId, source: "manual", created_by: user.id,
  }).select("id").single();
  if (error) throw new Error("Could not raise the task");
  await supabase.from("kpis").update({ task_id: task.id }).eq("id", id);
  revalidatePath("/app/kpis"); revalidatePath("/app/tasks");
}
```

Note: KPI follow-ups are ordinary management-review actions, so they use the existing `source: "manual"` — the `'audit'` source is reserved for corrective actions from findings.

- [ ] **Step 4: Write the KPI page**

Create `src/app/app/kpis/page.tsx`:

```tsx
import { requireAppContext } from "@/lib/app-context";
import { MEASUREMENT_TYPE_LABEL, MEASUREMENT_TYPE_TONE, needsReview, type MeasurementType } from "@/features/kpis/domain/kpis";
import { Card, PageIntro, Pill } from "@/components/ui";
import { createKpiAction, raiseKpiTaskAction } from "./actions";

export default async function KpisPage() {
  const { supabase } = await requireAppContext();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: kpis }, { data: members }] = await Promise.all([
    supabase.from("kpis").select("id,control_function,indicator,measurement_type,threshold,observations,next_steps,last_reviewed,task_id").order("indicator"),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
  ]);
  const rows = kpis ?? [];
  return <>
    <PageIntro eyebrow="MANAGEMENT REVIEW" title="Performance measures" body="The KPIs your management review discusses — indicator, measurement type, target, and the next steps that become tasks." />
    <Card style={{ padding: 0, marginBottom: "16px" }}><div className="data-table-wrap" role="region" aria-label="KPI register" tabIndex={0}><table>
      <thead><tr><th>Function</th><th>Indicator</th><th>Type</th><th>Target</th><th>Reviewed</th><th>Next steps</th></tr></thead>
      <tbody>
        {rows.map((k) => <tr key={k.id}>
          <td>{k.control_function || "—"}</td>
          <td><b>{k.indicator}</b></td>
          <td><Pill tone={MEASUREMENT_TYPE_TONE[k.measurement_type as MeasurementType]}>{MEASUREMENT_TYPE_LABEL[k.measurement_type as MeasurementType]}</Pill></td>
          <td>{k.threshold || "—"}</td>
          <td>{needsReview(k.last_reviewed, today) ? <Pill tone="amber">Needs review</Pill> : k.last_reviewed}</td>
          <td>{k.next_steps || "—"}{k.next_steps && !k.task_id && <form action={raiseKpiTaskAction} style={{ marginTop: "6px", display: "flex", gap: "6px" }}><input type="hidden" name="id" value={k.id} /><input type="hidden" name="indicator" value={k.indicator} /><input type="hidden" name="nextSteps" value={k.next_steps} /><select name="ownerId" defaultValue="" aria-label={`Task owner for ${k.indicator}`}><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select><button className="button secondary">Raise task</button></form>}{k.task_id && <small style={{ display: "block", color: "#596273" }}>Task raised.</small>}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={6} style={{ color: "#596273" }}>No KPIs yet. Add your first performance measure below.</td></tr>}
      </tbody>
    </table></div></Card>
    <Card style={{ padding: "18px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Add a KPI</h2>
      <form action={createKpiAction} className="app-form">
        <div className="form-grid">
          <label>Control / function<input name="controlFunction" maxLength={200} /></label>
          <label>Indicator<input name="indicator" required maxLength={300} /></label>
          <label>Measurement type<select name="measurementType" defaultValue="manual"><option value="automatic">Automatic</option><option value="manual">Manual</option><option value="external">External</option></select></label>
          <label>Target / threshold<input name="threshold" maxLength={500} /></label>
          <label>Responsible party<select name="responsibleId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
          <label>Last reviewed<input name="lastReviewed" type="date" /></label>
        </div>
        <label>Observations<textarea name="observations" maxLength={10000} /></label>
        <label>Next steps<textarea name="nextSteps" maxLength={10000} /></label>
        <button className="button primary">Add KPI</button>
      </form>
    </Card>
  </>;
}
```

- [ ] **Step 5: Register nav + titles**

In `src/components/app-shell.tsx`:
- Add to `nav` after the `["/app/audits", "shield", "Audits"]` line: `["/app/kpis", "check", "KPIs"],`.
- Add to `TITLES` before `["/app", "Dashboard"]`: `["/app/kpis", "Performance measures"],`.

- [ ] **Step 6: Add the e2e (KPI create + raise task) + axe**

In `e2e/product.spec.ts`, add a step: open **`KPIs`** from the nav; in "Add a KPI" fill Indicator + Next steps, submit; assert the KPI row is visible; click its **`Raise task`**; navigate to **`Tasks`** and assert a task titled `KPI follow-up: …` is present; assert zero axe violations on `/app/kpis`.

- [ ] **Step 7: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit && npx vitest run src/features/kpis
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
git add src/features/kpis src/app/app/kpis src/components/app-shell.tsx e2e/product.spec.ts
git commit -m "feat: add the KPI register with next-steps task raising"
```

Expected: KPI domain tests pass; create + raise-task flow green; axe clean on `/app/kpis`; nav shows **KPIs**.

---

## Workstream C3 — Reporting (Tasks 11–13)

### Task 11: Readiness report domain + `/app/reports/readiness` page + nav

A shared domain module `buildReadinessReport` that folds the existing SoA/risk/evidence aggregates into one leadership view — reused by both the authenticated page (this task) and the public audit view (Task 17). No new tables.

**Files:**
- Create: `src/features/reports/domain/readiness-report.ts`
- Create: `src/features/reports/domain/readiness-report.test.ts`
- Create: `src/app/app/reports/readiness/page.tsx`
- Modify: `src/components/app-shell.tsx` (nav + TITLES)
- Modify: `e2e/product.spec.ts` (open readiness report + axe)

**Interfaces:**
- Consumes: `summariseSoaReadiness`, `type SoaStatus`; `calculateRiskScore`, `riskBand`, `DEFAULT_RISK_MATRIX_CONFIG`, `type RiskBand`, `type RiskMatrixConfig`; `summariseEvidenceFreshness`, `type EvidenceStatus`.
- Produces: `type ReadinessReportInput`; `type ReadinessReport`; `buildReadinessReport(input): ReadinessReport`; route `/app/reports/readiness`; nav item **`Reports`**.

- [ ] **Step 1: Write the domain test then the module**

Create `src/features/reports/domain/readiness-report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildReadinessReport } from "./readiness-report";

describe("buildReadinessReport", () => {
  it("folds SoA, risk, evidence, task and audit aggregates into one view", () => {
    const report = buildReadinessReport({
      soa: [{ status: "operational" }, { status: "not_applicable" }, { status: "pending" }],
      risks: [{ likelihood: 5, impact: 5 }, { likelihood: 1, impact: 1 }],
      tasks: { open: 4, overdue: 1 },
      evidence: [{ status: "current" }, { status: "expired" }, { status: "superseded" }],
      audits: [{ status: "in_progress" }, { status: "closed" }],
      openNonConformities: 2,
    });
    expect(report.soaPercent).toBe(45); // (0.9 + 0) / 2 applicable
    expect(report.riskBands).toEqual({ low: 1, moderate: 0, high: 0, very_high: 1 });
    expect(report.tasksOpen).toBe(4);
    expect(report.tasksOverdue).toBe(1);
    expect(report.evidence).toEqual({ total: 2, expiring: 0, expired: 1 });
    expect(report.openAudits).toBe(1);
    expect(report.openNonConformities).toBe(2);
  });
});
```

Create `src/features/reports/domain/readiness-report.ts`:

```ts
import { summariseSoaReadiness } from "@/features/soa/domain/readiness";
import type { SoaStatus } from "@/features/soa/domain/soa";
import { calculateRiskScore, riskBand, DEFAULT_RISK_MATRIX_CONFIG, type RiskBand, type RiskMatrixConfig } from "@/features/risks/domain/risks";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";

export type ReadinessReportInput = {
  soa: readonly { status: SoaStatus }[];
  risks: readonly { likelihood: number; impact: number }[];
  tasks: { open: number; overdue: number };
  evidence: readonly { status: EvidenceStatus }[];
  audits: readonly { status: string }[];
  openNonConformities: number;
  config?: RiskMatrixConfig;
};

export type ReadinessReport = {
  soaPercent: number;
  soaTotal: number;
  riskBands: Record<RiskBand, number>;
  tasksOpen: number;
  tasksOverdue: number;
  evidence: { total: number; expiring: number; expired: number };
  openAudits: number;
  openNonConformities: number;
};

export function buildReadinessReport(input: ReadinessReportInput): ReadinessReport {
  const soa = summariseSoaReadiness(input.soa);
  const config = input.config ?? DEFAULT_RISK_MATRIX_CONFIG;
  const riskBands: Record<RiskBand, number> = { low: 0, moderate: 0, high: 0, very_high: 0 };
  for (const r of input.risks) riskBands[riskBand(calculateRiskScore(r.likelihood, r.impact), config)] += 1;
  return {
    soaPercent: soa.percent, soaTotal: soa.total, riskBands,
    tasksOpen: input.tasks.open, tasksOverdue: input.tasks.overdue,
    evidence: summariseEvidenceFreshness(input.evidence),
    openAudits: input.audits.filter((a) => a.status !== "closed").length,
    openNonConformities: input.openNonConformities,
  };
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/features/reports/domain/readiness-report.test.ts`
Expected: PASS.

- [ ] **Step 3: Write a shared data loader (reused by the PDF route and the page)**

Create `src/features/reports/application/load-readiness.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReadinessReportInput } from "@/features/reports/domain/readiness-report";
import type { SoaStatus } from "@/features/soa/domain/soa";
import type { EvidenceStatus } from "@/features/evidence/domain/evidence";

// Loads the RLS-scoped raw arrays the readiness report aggregates. Every query
// is filtered by the caller's RLS context — no organisation_id is passed in.
export async function loadReadinessInput(supabase: SupabaseClient): Promise<ReadinessReportInput> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: register } = await supabase.from("soa_registers").select("id").order("version", { ascending: false }).limit(1).maybeSingle();
  const [soa, risks, evidence, audits, findings, openTasks, overdueTasks] = await Promise.all([
    register ? supabase.from("soa_items").select("status").eq("soa_register_id", register.id) : Promise.resolve({ data: [] as { status: string }[] }),
    supabase.from("risks").select("likelihood,impact"),
    supabase.from("evidence").select("status"),
    supabase.from("audits").select("status"),
    supabase.from("audit_findings").select("id").neq("status", "closed").neq("severity", "observation"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]).not("due_on", "is", null).lt("due_on", today),
  ]);
  return {
    soa: (soa.data ?? []).map((s) => ({ status: s.status as SoaStatus })),
    risks: (risks.data ?? []).map((r) => ({ likelihood: r.likelihood, impact: r.impact })),
    evidence: (evidence.data ?? []).map((e) => ({ status: e.status as EvidenceStatus })),
    audits: (audits.data ?? []).map((a) => ({ status: a.status as string })),
    openNonConformities: (findings.data ?? []).length,
    tasks: { open: openTasks.count ?? 0, overdue: overdueTasks.count ?? 0 },
  };
}
```

- [ ] **Step 4: Write the readiness report page**

Create `src/app/app/reports/readiness/page.tsx`:

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { loadReadinessInput } from "@/features/reports/application/load-readiness";
import { buildReadinessReport } from "@/features/reports/domain/readiness-report";
import { RISK_BAND_LABEL, type RiskBand } from "@/features/risks/domain/risks";
import { Card, PageIntro, Ring, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";

const BAND_TONE: Record<RiskBand, string> = { low: "green", moderate: "amber", high: "red", very_high: "critical" };

export default async function ReadinessReportPage() {
  const { supabase, organisation } = await requireAppContext();
  const report = buildReadinessReport(await loadReadinessInput(supabase));
  return <>
    <PageIntro eyebrow="REPORT" title="Leadership readiness report" body={`A management-review snapshot for ${organisation.name}.`} action={<Link className="button secondary" href="/api/app/reports/readiness/pdf"><Icon name="download" />Download PDF</Link>} />
    <div className="stats-grid" style={{ alignItems: "center" }}>
      <Card className="stat" style={{ justifyContent: "center" }}><Ring value={report.soaPercent} /></Card>
      <Stat label="OPEN TASKS" value={report.tasksOpen} detail={`${report.tasksOverdue} overdue`} tone={report.tasksOverdue > 0 ? "red" : "blue"} />
      <Stat label="EVIDENCE HEALTH" value={report.evidence.total} detail={`${report.evidence.expiring} expiring · ${report.evidence.expired} expired`} tone={report.evidence.expired > 0 ? "red" : "green"} />
      <Stat label="OPEN NON-CONFORMITIES" value={report.openNonConformities} detail={`${report.openAudits} open audits`} tone={report.openNonConformities > 0 ? "amber" : "green"} />
    </div>
    <Card style={{ padding: "22px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 12px" }}>Risk posture</h2>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {(Object.keys(report.riskBands) as RiskBand[]).map((band) => <div key={band} style={{ minWidth: "120px" }}><Stat label={RISK_BAND_LABEL[band].toUpperCase()} value={report.riskBands[band]} detail="risks" tone={BAND_TONE[band] === "critical" ? "red" : BAND_TONE[band]} /></div>)}
      </div>
    </Card>
  </>;
}
```

- [ ] **Step 5: Register nav + title**

In `src/components/app-shell.tsx`:
- Add to `nav` after the `["/app/kpis", "check", "KPIs"]` line: `["/app/reports/readiness", "file", "Reports"],`.
- Add to `TITLES` before `["/app", "Dashboard"]`: `["/app/reports/readiness", "Readiness report"],`.

- [ ] **Step 6: Add the e2e (open report) + axe**

In `e2e/product.spec.ts`, add a step: open **`Reports`** from the nav; assert the **`Leadership readiness report`** heading and the SoA readiness ring are visible; assert zero axe violations on `/app/reports/readiness`.

- [ ] **Step 7: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit && npx vitest run src/features/reports
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
git add src/features/reports src/app/app/reports src/components/app-shell.tsx e2e/product.spec.ts
git commit -m "feat: add the leadership readiness report page"
```

Expected: readiness domain test passes; report page renders; axe clean; nav shows **Reports**.

---

### Task 12: Readiness report PDF route

A print/PDF export mirroring the SoA snapshot download route, using `pdfkit` (same library as `generateSoaPdf`). Route `GET /api/app/reports/readiness/pdf`, RLS-scoped via the authenticated server client.

**Files:**
- Create: `src/features/reports/application/readiness-pdf.ts`
- Create: `src/app/api/app/reports/readiness/pdf/route.ts`

**Interfaces:**
- Consumes: `loadReadinessInput`, `buildReadinessReport`, `RISK_BAND_LABEL`, `createSupabaseServerClient`.
- Produces: `generateReadinessPdf(report, organisationName): Promise<Buffer>`; route handler returning `application/pdf`.

- [ ] **Step 1: Write the PDF generator**

Create `src/features/reports/application/readiness-pdf.ts`:

```ts
import PDFDocument from "pdfkit";
import { RISK_BAND_LABEL, type RiskBand } from "@/features/risks/domain/risks";
import type { ReadinessReport } from "@/features/reports/domain/readiness-report";

export function generateReadinessPdf(report: ReadinessReport, organisationName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Readiness report — ${organisationName}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(20).text("Leadership readiness report").moveDown(0.3);
    doc.fontSize(10).text(`Organisation: ${organisationName}`).text(`Generated: ${new Date().toISOString().slice(0, 10)}`).moveDown();
    doc.fontSize(12).text(`Framework coverage: ${report.soaPercent}% (${report.soaTotal} applicable controls)`);
    doc.text(`Tasks: ${report.tasksOpen} open, ${report.tasksOverdue} overdue`);
    doc.text(`Evidence: ${report.evidence.total} live, ${report.evidence.expiring} expiring, ${report.evidence.expired} expired`);
    doc.text(`Audits: ${report.openAudits} open, ${report.openNonConformities} open non-conformities`).moveDown();
    doc.fontSize(13).text("Risk posture").fontSize(11);
    for (const band of Object.keys(report.riskBands) as RiskBand[]) doc.text(`${RISK_BAND_LABEL[band]}: ${report.riskBands[band]}`);
    doc.end();
  });
}
```

- [ ] **Step 2: Write the route handler**

Create `src/app/api/app/reports/readiness/pdf/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadReadinessInput } from "@/features/reports/application/load-readiness";
import { buildReadinessReport } from "@/features/reports/domain/readiness-report";
import { generateReadinessPdf } from "@/features/reports/application/readiness-pdf";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { data: membership } = await supabase.from("memberships").select("organisations(name)").limit(1).maybeSingle();
  const organisation = membership ? (Array.isArray(membership.organisations) ? membership.organisations[0] : membership.organisations) : null;
  const report = buildReadinessReport(await loadReadinessInput(supabase));
  const buffer = await generateReadinessPdf(report, organisation?.name ?? "Your workspace");
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "content-type": "application/pdf",
    "content-disposition": 'attachment; filename="readiness-report.pdf"',
    "cache-control": "private, no-store",
  } });
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
curl -sf -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/app/reports/readiness/pdf
git add src/features/reports/application/readiness-pdf.ts src/app/api/app/reports/readiness
git commit -m "feat: add a downloadable PDF of the readiness report"
```

Expected: eslint/tsc clean; the `curl` returns `401` when unauthenticated (route is auth-gated) — confirming the guard. The download button on the report page (Task 11) serves the PDF for a signed-in user.

---

### Task 13: Audit evidence pack export route

For a selected audit, a bundled XLSX/CSV of the checklist + findings using the `exports` helper. Route `GET /api/app/audits/[id]/pack?format=xlsx|csv`, RLS-scoped.

**Files:**
- Create: `src/app/api/app/audits/[id]/pack/route.ts`
- Modify: `src/app/app/audits/[id]/page.tsx` (add the download links)

**Interfaces:**
- Consumes: `toCsv`, `toXlsx`, `type ExportColumn`; `CHECKLIST_RESULT_LABEL`, `FINDING_SEVERITY_LABEL`, `FINDING_STATUS_LABEL`; `createSupabaseServerClient`.
- Produces: route handler serving `text/csv` or the XLSX MIME type.

- [ ] **Step 1: Write the route handler**

Create `src/app/api/app/audits/[id]/pack/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCsv, toXlsx, type ExportColumn } from "@/features/exports/exports";
import { CHECKLIST_RESULT_LABEL, FINDING_SEVERITY_LABEL, FINDING_STATUS_LABEL, type ChecklistResult, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";

type PackRow = { section: string; ref: string; item: string; result: string; detail: string };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const { data: audit } = await supabase.from("audits").select("reference,title").eq("id", id).maybeSingle();
  if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [{ data: items }, { data: findings }] = await Promise.all([
    supabase.from("audit_checklist_items").select("area,clause_reference,checklist_item,compliant,evidence_note,findings").eq("audit_id", id).order("position"),
    supabase.from("audit_findings").select("summary,severity,status,corrective_action").eq("audit_id", id).order("created_at"),
  ]);
  const rows: PackRow[] = [
    ...(items ?? []).map((i) => ({ section: "Checklist", ref: `${i.area} ${i.clause_reference}`.trim(), item: i.checklist_item, result: CHECKLIST_RESULT_LABEL[i.compliant as ChecklistResult], detail: [i.evidence_note, i.findings].filter(Boolean).join(" — ") })),
    ...(findings ?? []).map((f) => ({ section: "Finding", ref: FINDING_SEVERITY_LABEL[f.severity as FindingSeverity], item: f.summary, result: FINDING_STATUS_LABEL[f.status as FindingStatus], detail: f.corrective_action })),
  ];
  const columns: ExportColumn<PackRow>[] = [
    { header: "Section", value: (r) => r.section }, { header: "Reference", value: (r) => r.ref },
    { header: "Item", value: (r) => r.item }, { header: "Result", value: (r) => r.result }, { header: "Detail", value: (r) => r.detail },
  ];
  const filename = `audit-pack-${audit.reference}`;
  if (format === "csv") {
    return new NextResponse(toCsv(columns, rows), { headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.csv"`, "cache-control": "private, no-store" } });
  }
  const buffer = await toXlsx("Audit pack", columns, rows);
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${filename}.xlsx"`, "cache-control": "private, no-store" } });
}
```

- [ ] **Step 2: Add the download links to the audit detail page**

In `src/app/app/audits/[id]/page.tsx`, add below the checklist-progress `<Card>` (before the checklist table):

```tsx
<div style={{ display: "flex", gap: "8px", margin: "0 0 16px" }}>
  <Link className="button secondary" href={`/api/app/audits/${id}/pack?format=xlsx`}>Evidence pack (XLSX)</Link>
  <Link className="button secondary" href={`/api/app/audits/${id}/pack?format=csv`}>Evidence pack (CSV)</Link>
</div>
```

(`Link` is already imported in that file.)

- [ ] **Step 3: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
curl -sf -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/api/app/audits/00000000-0000-4000-8000-000000000000/pack?format=csv"
git add src/app/api/app/audits src/app/app/audits/[id]/page.tsx
git commit -m "feat: export an audit evidence pack as XLSX or CSV"
```

Expected: eslint/tsc clean; the `curl` returns `401` unauthenticated. Signed-in, the buttons download the pack.

---

## Workstream C4 — Auditor access (time-boxed read-only link) (Tasks 14–17)

### Task 14: `auditor_access_tokens` table (hashed, expiry, revoke) + owner-only RLS + attack tests

Owners mint a hashed-at-rest token scoped to their org (optionally to one audit) with an `expires_at`. Only owners may create/list/revoke; the token itself is validated server-side (Task 15), never via RLS.

**Files:**
- Create: `supabase/migrations/202607020023_auditor_access_tokens.sql`
- Create: `supabase/tests/database/020_auditor_access_tokens.sql`

**Interfaces:**
- Consumes: `public.organisations`, `public.memberships`, `public.audits`.
- Produces: table `public.auditor_access_tokens(id, organisation_id, token_hash, label, audit_id, framework, expires_at, created_by, created_at, revoked_at)` with `token_hash text not null unique`; owner-only split RLS.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020023_auditor_access_tokens.sql`:

```sql
-- Phase C4: time-boxed, read-only auditor share links. The raw token is NEVER
-- stored — only its sha256 hex hash (mirrors public.invitations.token_hash).
-- Only organisation owners may create / list / revoke. The token itself is
-- validated by the security-definer RPC in 202607020024, not by RLS (an
-- unauthenticated visitor has no RLS identity).

create table public.auditor_access_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  token_hash text not null unique,
  label text not null default '' check (char_length(label) <= 160),
  audit_id uuid,
  framework text not null default 'ISO 27001:2022' check (char_length(framework) between 1 and 120),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint auditor_tokens_audit_tenant_fk foreign key (audit_id, organisation_id)
    references public.audits(id, organisation_id) on delete cascade
);
create index auditor_access_tokens_org_idx on public.auditor_access_tokens(organisation_id, expires_at);

create trigger auditor_access_tokens_audit after insert or update or delete on public.auditor_access_tokens
for each row execute function public.capture_audit_event();

-- Owner-only management. is_organisation_member gates the tenant; the owner
-- role check restricts to owners (mirrors inviteMember's owner-only rule).
alter table public.auditor_access_tokens enable row level security;
create policy auditor_tokens_owner_select on public.auditor_access_tokens for select to authenticated
using (exists (select 1 from public.memberships m where m.organisation_id = auditor_access_tokens.organisation_id and m.user_id = (select auth.uid()) and m.role = 'owner'));
create policy auditor_tokens_owner_insert on public.auditor_access_tokens for insert to authenticated
with check (created_by = (select auth.uid()) and exists (select 1 from public.memberships m where m.organisation_id = auditor_access_tokens.organisation_id and m.user_id = (select auth.uid()) and m.role = 'owner'));
create policy auditor_tokens_owner_update on public.auditor_access_tokens for update to authenticated
using (exists (select 1 from public.memberships m where m.organisation_id = auditor_access_tokens.organisation_id and m.user_id = (select auth.uid()) and m.role = 'owner'))
with check (exists (select 1 from public.memberships m where m.organisation_id = auditor_access_tokens.organisation_id and m.user_id = (select auth.uid()) and m.role = 'owner'));
create policy auditor_tokens_owner_delete on public.auditor_access_tokens for delete to authenticated
using (exists (select 1 from public.memberships m where m.organisation_id = auditor_access_tokens.organisation_id and m.user_id = (select auth.uid()) and m.role = 'owner'));

revoke all on public.auditor_access_tokens from anon, authenticated;
grant select, insert, update, delete on public.auditor_access_tokens to authenticated;
```

- [ ] **Step 2: Write the pgTAP attack test (owner-only + cross-tenant)**

Create `supabase/tests/database/020_auditor_access_tokens.sql` — a THREE-user header (owner A `1…0001`, owner B `1…0002`, member A `1…0003`), orgs A/B, memberships (A/0001 owner, B/0002 owner, A/0003 member), then `plan(8)`:

```sql
begin;
select plan(8);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.auditor_access_tokens (id, organisation_id, token_hash, label, expires_at, created_by)
     values ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'hash-a', 'External auditor', now() + interval '7 days', '10000000-0000-4000-8000-000000000001') $$,
  'owners mint tokens in their own tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.auditor_access_tokens (organisation_id, token_hash, expires_at, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'hash-m', now() + interval '7 days', '10000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'non-owner members cannot mint tokens');
select is((select count(*) from public.auditor_access_tokens where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'non-owner members cannot list tokens');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.auditor_access_tokens (organisation_id, token_hash, expires_at, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'hash-b', now() + interval '7 days', '10000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'owners of another tenant cannot mint tokens for tenant A');
select is((select count(*) from public.auditor_access_tokens where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'owners of another tenant cannot list tenant A tokens');
select results_eq(
  $$ update public.auditor_access_tokens set revoked_at = now() where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant revoke affects no rows');
select results_eq(
  $$ delete from public.auditor_access_tokens where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.auditor_access_tokens set revoked_at = now() where id = '40000000-0000-4000-8000-000000000001' $$,
  'owners revoke their own tokens');

select * from finish();
rollback;
```

- [ ] **Step 3: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020023_auditor_access_tokens.sql supabase/tests/database/020_auditor_access_tokens.sql
git commit -m "feat: add hashed, owner-managed auditor access tokens"
```

Expected: `020_auditor_access_tokens.sql .. ok`; prior tests green.

---

### Task 15: `audit_view_for_token(raw_token)` security-definer RPC + pgTAP proof

The ONE sanctioned elevated read: a `security definer` RPC that hashes the raw token, looks it up (refusing expired/revoked/unknown), resolves the token's `organisation_id` (+ scoped `audit_id`), and returns a jsonb payload built ENTIRELY from queries filtered by that resolved org. Granted to `anon` (an unauthenticated visitor). It is NOT the service-role client.

**Files:**
- Create: `supabase/migrations/202607020024_audit_view_for_token.sql`
- Create: `supabase/tests/database/021_audit_view_for_token.sql`

**Interfaces:**
- Consumes: `public.auditor_access_tokens`, `public.organisations`, `public.soa_registers`, `public.soa_items`, `public.risks`, `public.tasks`, `public.evidence`, `public.audits`, `public.audit_checklist_items`, `public.audit_findings`.
- Produces: `public.audit_view_for_token(raw_token text) returns jsonb` (returns `null` for expired/revoked/unknown), granted to `anon, authenticated`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020024_audit_view_for_token.sql`:

```sql
-- Phase C4: the ONLY elevated read for an unauthenticated auditor. Token-gated,
-- org-scoped inside the body (every query filtered by the resolved
-- organisation_id), returns no other tenant's data by construction. security
-- definer because an anon visitor has no RLS identity; this is NOT the
-- service-role client. Hashing mirrors public.accept_invitation. Refuses
-- expired / revoked / unknown tokens by returning null.

create or replace function public.audit_view_for_token(raw_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  token_row public.auditor_access_tokens;
  target_org uuid;
  latest_register uuid;
begin
  select * into token_row from public.auditor_access_tokens
  where token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'), 'hex')
    and revoked_at is null and expires_at > now();
  if not found then
    return null;
  end if;
  target_org := token_row.organisation_id;
  select id into latest_register from public.soa_registers
    where organisation_id = target_org order by version desc limit 1;
  return jsonb_build_object(
    'organisationName', (select name from public.organisations where id = target_org),
    'framework', token_row.framework,
    'generatedAt', now(),
    'soa', coalesce((select jsonb_agg(jsonb_build_object('status', i.status))
        from public.soa_items i where i.soa_register_id = latest_register), '[]'::jsonb),
    'risks', coalesce((select jsonb_agg(jsonb_build_object('likelihood', r.likelihood, 'impact', r.impact))
        from public.risks r where r.organisation_id = target_org), '[]'::jsonb),
    'tasks', jsonb_build_object(
        'open', (select count(*) from public.tasks t where t.organisation_id = target_org and t.status in ('open','in_progress')),
        'overdue', (select count(*) from public.tasks t where t.organisation_id = target_org and t.status in ('open','in_progress') and t.due_on is not null and t.due_on < current_date)),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('status', e.status))
        from public.evidence e where e.organisation_id = target_org), '[]'::jsonb),
    'audits', coalesce((select jsonb_agg(jsonb_build_object('status', a.status))
        from public.audits a where a.organisation_id = target_org), '[]'::jsonb),
    'openNonConformities', (select count(*) from public.audit_findings f
        where f.organisation_id = target_org and f.status <> 'closed' and f.severity in ('minor_nc','major_nc')),
    'audit', case when token_row.audit_id is null then null else (
      select jsonb_build_object(
        'reference', a.reference, 'title', a.title, 'status', a.status, 'scope', a.scope,
        'checklist', coalesce((select jsonb_agg(jsonb_build_object(
            'area', c.area, 'clauseReference', c.clause_reference, 'checklistItem', c.checklist_item,
            'compliant', c.compliant, 'evidenceNote', c.evidence_note) order by c.position)
          from public.audit_checklist_items c where c.audit_id = a.id), '[]'::jsonb),
        'findings', coalesce((select jsonb_agg(jsonb_build_object('summary', f.summary, 'severity', f.severity, 'status', f.status) order by f.created_at)
          from public.audit_findings f where f.audit_id = a.id), '[]'::jsonb))
      from public.audits a where a.id = token_row.audit_id and a.organisation_id = target_org) end
  );
end;
$$;

revoke all on function public.audit_view_for_token(text) from public;
grant usage on schema public to anon;
grant execute on function public.audit_view_for_token(text) to anon, authenticated;
```

- [ ] **Step 2: Write the pgTAP proof (scoped + refuses expired/revoked/unknown)**

Create `supabase/tests/database/021_audit_view_for_token.sql` — two-tenant header, then a risk in each tenant plus three tokens for org A (valid, expired, revoked); `plan(6)`. Hashes are computed with the same digest the RPC uses:

```sql
insert into public.risk_categories (organisation_id, name, position) values
  ('20000000-0000-4000-8000-000000000001', 'Data Security', 0),
  ('20000000-0000-4000-8000-000000000002', 'Data Security', 0);
insert into public.risks (organisation_id, reference, title, description, category_id, likelihood, impact, treatment, residual_likelihood, residual_impact, status, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'R-001', 'Risk A', 'd', (select id from public.risk_categories where organisation_id='20000000-0000-4000-8000-000000000001'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'R-001', 'Risk B1', 'd', (select id from public.risk_categories where organisation_id='20000000-0000-4000-8000-000000000002'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000002', 'R-002', 'Risk B2', 'd', (select id from public.risk_categories where organisation_id='20000000-0000-4000-8000-000000000002'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000002');
insert into public.auditor_access_tokens (organisation_id, token_hash, expires_at, revoked_at, created_by) values
  ('20000000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('valid-token-a','UTF8'),'sha256'),'hex'), now() + interval '7 days', null, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('expired-token-a','UTF8'),'sha256'),'hex'), now() - interval '1 day', null, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('revoked-token-a','UTF8'),'sha256'),'hex'), now() + interval '7 days', now(), '10000000-0000-4000-8000-000000000001');

set local role anon;
select isnt(public.audit_view_for_token('valid-token-a'), null, 'a valid token returns a payload');
select is(public.audit_view_for_token('valid-token-a') ->> 'organisationName', 'Tenant A', 'the payload is scoped to the token''s organisation');
select is(jsonb_array_length(public.audit_view_for_token('valid-token-a') -> 'risks'), 1, 'the payload contains only the token org''s data (1 risk, not tenant B''s 2)');
select is(public.audit_view_for_token('expired-token-a'), null, 'an expired token is refused');
select is(public.audit_view_for_token('revoked-token-a'), null, 'a revoked token is refused');
select is(public.audit_view_for_token('never-issued'), null, 'an unknown token is refused');
```

- [ ] **Step 3: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020024_audit_view_for_token.sql supabase/tests/database/021_audit_view_for_token.sql
git commit -m "feat: add the token-gated, org-scoped auditor view RPC"
```

Expected: `021_audit_view_for_token.sql .. ok` (all 6 assertions); prior tests green.

---

### Task 16: Public `/audit-view/[token]` page (outside the app group, read-only)

An unauthenticated, read-only page OUTSIDE `src/app/app/`, with its own minimal layout. It calls ONLY `supabase.rpc("audit_view_for_token", { raw_token })` (via the standard server client, which is the `anon` role for a logged-out visitor) — NO service-role client — and reuses `buildReadinessReport` for the aggregates.

**Files:**
- Create: `src/app/audit-view/layout.tsx`
- Create: `src/app/audit-view/[token]/page.tsx`
- Modify: `e2e/product.spec.ts` (open a minted link in a fresh no-auth context; confirm an expired/revoked token is refused)

**Interfaces:**
- Consumes: `createSupabaseServerClient`, `audit_view_for_token` RPC (Task 15), `buildReadinessReport`, `RISK_BAND_LABEL`, `CHECKLIST_RESULT_LABEL`, `FINDING_SEVERITY_LABEL`, `FINDING_STATUS_LABEL`.
- Produces: public route `/audit-view/[token]`.

- [ ] **Step 1: Write the minimal read-only layout**

Create `src/app/audit-view/layout.tsx` (own `<main>` + its own `<h1>` is provided by the page's content; no AppShell, no nav):

```tsx
export default function AuditViewLayout({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: "100vh", background: "linear-gradient(180deg,#eef2fb 0%,#f7f8fa 42%)", padding: "48px 24px" }}>
    <div style={{ width: "100%", maxWidth: "960px", margin: "0 auto" }}>
      <div className="brand" style={{ marginBottom: "24px" }}><span className="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6Z"/><path d="m9 12 2 2 4-4"/></svg></span>ComplianceHub</div>
      {children}
      <footer style={{ marginTop: "32px", fontSize: "12px", color: "#596273" }}>Read-only auditor view. ComplianceHub supports readiness management; it does not provide ISO certification or legal advice.</footer>
    </div>
  </main>;
}
```

- [ ] **Step 2: Write the public page**

Create `src/app/audit-view/[token]/page.tsx`:

```tsx
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildReadinessReport } from "@/features/reports/domain/readiness-report";
import { RISK_BAND_LABEL, type RiskBand } from "@/features/risks/domain/risks";
import { CHECKLIST_RESULT_LABEL, FINDING_SEVERITY_LABEL, FINDING_STATUS_LABEL, type ChecklistResult, type FindingSeverity, type FindingStatus } from "@/features/audits/domain/audits";
import type { SoaStatus } from "@/features/soa/domain/soa";
import type { EvidenceStatus } from "@/features/evidence/domain/evidence";
import { Card, Pill, Ring, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

type Payload = {
  organisationName: string; framework: string;
  soa: { status: SoaStatus }[]; risks: { likelihood: number; impact: number }[];
  tasks: { open: number; overdue: number }; evidence: { status: EvidenceStatus }[];
  audits: { status: string }[]; openNonConformities: number;
  audit: null | { reference: string; title: string; status: string; scope: string;
    checklist: { area: string; clauseReference: string; checklistItem: string; compliant: ChecklistResult; evidenceNote: string }[];
    findings: { summary: string; severity: FindingSeverity; status: FindingStatus }[] };
};

export default async function AuditViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient(); // anon role for a logged-out visitor
  const { data } = await supabase.rpc("audit_view_for_token", { raw_token: token });
  if (!data) {
    return <Card style={{ padding: "24px" }} role="alert"><h1 style={{ fontSize: "20px", margin: "0 0 8px" }}>Link unavailable</h1><p>This auditor link is invalid, has expired, or has been revoked. Ask your contact to issue a new one.</p></Card>;
  }
  const payload = data as Payload;
  const report = buildReadinessReport({ ...payload, config: undefined });
  const BAND_TONE: Record<RiskBand, string> = { low: "green", moderate: "amber", high: "red", very_high: "critical" };
  return <>
    <h1 style={{ fontSize: "24px", margin: "0 0 4px" }}>{payload.organisationName} — readiness</h1>
    <p style={{ color: "#596273", margin: "0 0 20px" }}>{payload.framework} · read-only auditor view</p>
    <div className="stats-grid" style={{ alignItems: "center" }}>
      <Card className="stat" style={{ justifyContent: "center" }}><Ring value={report.soaPercent} /></Card>
      <Stat label="OPEN TASKS" value={report.tasksOpen} detail={`${report.tasksOverdue} overdue`} tone={report.tasksOverdue > 0 ? "red" : "blue"} />
      <Stat label="EVIDENCE HEALTH" value={report.evidence.total} detail={`${report.evidence.expiring} expiring · ${report.evidence.expired} expired`} tone={report.evidence.expired > 0 ? "red" : "green"} />
      <Stat label="OPEN NON-CONFORMITIES" value={report.openNonConformities} detail={`${report.openAudits} open audits`} tone={report.openNonConformities > 0 ? "amber" : "green"} />
    </div>
    <Card style={{ padding: "22px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 12px" }}>Risk posture</h2>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {(Object.keys(report.riskBands) as RiskBand[]).map((band) => <div key={band} style={{ minWidth: "120px" }}><Stat label={RISK_BAND_LABEL[band].toUpperCase()} value={report.riskBands[band]} detail="risks" tone={BAND_TONE[band] === "critical" ? "red" : BAND_TONE[band]} /></div>)}
      </div>
    </Card>
    {payload.audit && <Card style={{ padding: "22px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>{payload.audit.reference}: {payload.audit.title}</h2>
      <p style={{ color: "#596273", fontSize: "13px", margin: "0 0 12px" }}>{payload.audit.scope}</p>
      <div className="data-table-wrap" role="region" aria-label="Audit checklist" tabIndex={0}><table>
        <thead><tr><th>Area / clause</th><th>Item</th><th>Result</th></tr></thead>
        <tbody>{payload.audit.checklist.map((c, idx) => <tr key={idx}><td>{c.area}<small>{c.clauseReference}</small></td><td>{c.checklistItem}</td><td>{CHECKLIST_RESULT_LABEL[c.compliant]}</td></tr>)}</tbody>
      </table></div>
      <h3 style={{ fontSize: "14px", margin: "16px 0 8px" }}>Findings</h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
        {payload.audit.findings.map((f, idx) => <li key={idx}><Pill tone={f.severity === "major_nc" ? "critical" : f.severity === "minor_nc" ? "amber" : "neutral"}>{FINDING_SEVERITY_LABEL[f.severity]}</Pill> {f.summary} <small style={{ color: "#596273" }}>({FINDING_STATUS_LABEL[f.status]})</small></li>)}
        {!payload.audit.findings.length && <li style={{ color: "#596273", fontSize: "13px" }}>No findings recorded.</li>}
      </ul>
    </Card>}
  </>;
}
```

- [ ] **Step 3: Add the e2e (fresh no-auth context + refusal)**

In `e2e/product.spec.ts`, after Task 17's mint step is wired (this step's assertions depend on a minted token — sequence this e2e addition after Task 17, or capture the token from the share panel in the same spec), add: open the minted `/audit-view/<token>` URL in a **fresh `browser.newContext()`** (no storage state, so unauthenticated); assert the `{org} — readiness` `<h1>` and the SoA ring are visible; assert zero axe violations; then open `/audit-view/expired-or-bogus-token` and assert the **`Link unavailable`** message renders.

- [ ] **Step 4: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/audit-view/bogus  # 200, renders "Link unavailable"
git add src/app/audit-view
git commit -m "feat: add the public read-only auditor view"
```

Expected: eslint/tsc clean; a bogus token renders the "Link unavailable" card (HTTP 200, no data leak); no service-role client anywhere under `src/app/audit-view`.

---

### Task 17: Owner "Share with auditor" mint / list / revoke UI

An owner-only panel on the audit detail page to mint a token (showing the raw link ONCE), list active/expired/revoked tokens, and revoke. Reuses the invitation hashing/expiry approach; read-only + login-free.

**Files:**
- Create: `src/features/audits/application/auditor-token.ts`
- Create: `src/app/app/audits/[id]/share-actions.ts`
- Modify: `src/app/app/audits/[id]/page.tsx` (render the panel)
- Modify: `e2e/product.spec.ts` (mint a link; capture it for Task 16's e2e; revoke)

**Interfaces:**
- Consumes: `requireAppContext`, `enforceRateLimit`, `randomBytes`/`createHash` (node:crypto), `public.auditor_access_tokens`.
- Produces: `mintAuditorToken(input): { rawToken: string; tokenHash: string; expiresAt: string }`; actions `mintAuditorTokenAction`, `revokeAuditorTokenAction`; the share panel.

- [ ] **Step 1: Write the mint helper (mirrors inviteMember)**

Create `src/features/audits/application/auditor-token.ts`:

```ts
import { randomBytes, createHash } from "node:crypto";

// Read-only, login-free auditor token. Mirrors inviteMember's hashing/expiry:
// the raw token is returned to the caller ONCE and never stored; only its
// sha256 hex hash is persisted (matches public.audit_view_for_token's lookup).
export function mintAuditorToken(input: { expiresInDays: number }): { rawToken: string; tokenHash: string; expiresAt: string } {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  return { rawToken, tokenHash, expiresAt };
}
```

- [ ] **Step 2: Write the share server actions**

Create `src/app/app/audits/[id]/share-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { mintAuditorToken } from "@/features/audits/application/auditor-token";

export async function mintAuditorTokenAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`auditor-token:${user.id}`, { limit: 10, windowMs: 60 * 60_000 });
  const auditId = String(formData.get("auditId"));
  const scope = String(formData.get("scope") || "org"); // 'org' | 'audit'
  const days = Math.min(90, Math.max(1, Number(formData.get("expiresInDays") || 14)));
  const { rawToken, tokenHash, expiresAt } = mintAuditorToken({ expiresInDays: days });
  const { error } = await supabase.from("auditor_access_tokens").insert({
    organisation_id: organisation.id, token_hash: tokenHash, label: String(formData.get("label") || "External auditor").slice(0, 160),
    audit_id: scope === "audit" ? auditId : null, expires_at: expiresAt, created_by: user.id,
  });
  if (error) throw new Error("Could not create the auditor link");
  // The raw token is shown to the owner ONCE via the redirect param; never re-derivable.
  revalidatePath(`/app/audits/${auditId}?link=${encodeURIComponent(rawToken)}`);
  return { rawToken };
}

export async function revokeAuditorTokenAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const auditId = String(formData.get("auditId"));
  const { error } = await supabase.from("auditor_access_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not revoke the auditor link");
  revalidatePath(`/app/audits/${auditId}`);
}
```

Note: server actions cannot reliably surface a return value to the page, so the raw link is passed through the `?link=` search param on redirect and rendered ONCE (Step 3). It is never stored and never recoverable after this render.

- [ ] **Step 3: Render the share panel on the audit detail page**

In `src/app/app/audits/[id]/page.tsx`: (a) change the signature to also read `searchParams` — `{ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ link?: string }> }` and `const { link } = await searchParams;`; (b) add to the `Promise.all` a tokens read `supabase.from("auditor_access_tokens").select("id,label,expires_at,revoked_at,audit_id").order("created_at", { ascending: false })`; (c) import the share actions and append this panel at the end of the fragment:

```tsx
<Card style={{ padding: "18px", marginTop: "16px" }}>
  <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Share with an auditor</h2>
  <p style={{ fontSize: "12px", color: "#596273", margin: "0 0 12px" }}>Create a time-boxed, read-only link. It needs no login and expires automatically. Copy it now — it is shown only once.</p>
  {link && <Card role="status" style={{ padding: "12px", background: "#eef7ee", borderColor: "#bfe0bf", marginBottom: "12px" }}><b>New link (copy now):</b> <code style={{ wordBreak: "break-all" }}>{`/audit-view/${link}`}</code></Card>}
  <form action={mintAuditorTokenAction} style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "end", marginBottom: "14px" }}>
    <input type="hidden" name="auditId" value={id} />
    <label style={{ fontSize: "12px", fontWeight: 700 }}>Label<input name="label" defaultValue="External auditor" maxLength={160} style={{ display: "block" }} /></label>
    <label style={{ fontSize: "12px", fontWeight: 700 }}>Scope<select name="scope" defaultValue="audit" style={{ display: "block" }}><option value="audit">This audit</option><option value="org">Whole readiness view</option></select></label>
    <label style={{ fontSize: "12px", fontWeight: 700 }}>Expires (days)<input name="expiresInDays" type="number" min={1} max={90} defaultValue={14} style={{ display: "block", width: "88px" }} /></label>
    <button className="button primary">Create link</button>
  </form>
  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
    {(tokens ?? []).map((t) => { const state = t.revoked_at ? "Revoked" : new Date(t.expires_at) < new Date() ? "Expired" : "Active"; return <li key={t.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "13px" }}><span>{t.label} · <Pill tone={state === "Active" ? "green" : "neutral"}>{state}</Pill> <small style={{ color: "#596273" }}>expires {new Date(t.expires_at).toISOString().slice(0, 10)}</small></span>{!t.revoked_at && <form action={revokeAuditorTokenAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="auditId" value={id} /><button style={{ color: "var(--red)", border: 0, background: "none", fontWeight: 700 }}>Revoke</button></form>}</li>; })}
    {!tokens?.length && <li style={{ color: "#596273", fontSize: "13px" }}>No auditor links yet.</li>}
  </ul>
</Card>
```

Add the imports at the top of the file: `import { mintAuditorTokenAction, revokeAuditorTokenAction } from "./share-actions";` (`Pill` and `Card` are already imported).

- [ ] **Step 4: Add the e2e (mint → open → revoke)**

In `e2e/product.spec.ts`, on the audit detail page: fill the share **Label**, keep Scope **`This audit`**, click **`Create link`**; read the rendered `/audit-view/<token>` `code`; use it for Task 16's fresh-context assertion (open it unauthenticated, see the read-only report); then back in the authenticated context click **`Revoke`** for that link and re-open the same URL in a fresh context, asserting the **`Link unavailable`** message. Assert zero axe violations on `/app/audits/<id>` including the share panel.

- [ ] **Step 5: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
git add src/features/audits/application/auditor-token.ts src/app/app/audits/[id] e2e/product.spec.ts
git commit -m "feat: let owners mint, list, and revoke read-only auditor links"
```

Expected: mint → open (unauth read-only) → revoke → refusal all green; axe clean on the audit detail page with the share panel.

---

## Final — Task 18: Full gate + finish

Run the entire test gate green, then finish the branch.

**Files:** none (verification + integration only).

- [ ] **Step 1: Run the full gate**

```bash
npx eslint .
npx tsc --noEmit
npx vitest run
npx supabase migration up && npx supabase test db
./node_modules/.bin/next build
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test
```

Expected: eslint clean; tsc clean; all vitest suites pass (including `audits`, `kpis`, `reports` domains); pgTAP files `001`–`021` all `.. ok`; `next build` succeeds; Playwright green on chromium + mobile including the audit flow, KPI flow, readiness report, and the public `/audit-view` (mint → open unauth → revoke → refusal) with zero axe violations on every new page.

- [ ] **Step 2: Confirm the security invariants by inspection**

- [ ] `grep -rn "service_role\|SERVICE_ROLE\|createServiceClient" src/app/audit-view` returns nothing (no service-role client in the public view).
- [ ] `grep -rn "audit_view_for_token" src` shows exactly one call site (`src/app/audit-view/[token]/page.tsx`).
- [ ] `supabase/migrations/202607020024_audit_view_for_token.sql` is the only place `security definer` is added in Phase C, and its body filters every query by `target_org`.
- [ ] `auditor_access_tokens` is never inserted with a raw token (only `token_hash`); the raw token appears only in the mint helper's return and the one-time `?link=` render.

- [ ] **Step 3: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to choose merge / PR / cleanup. If committing directly: ensure every task's commit is present, the working tree is clean (`git status`), and the branch is ready.

```bash
git status
git log --oneline main..HEAD
```

Expected: clean tree; one commit per task (~17 feature commits) on `phase-c-run-the-audit`.

---

## Self-Review

**1. Spec coverage** (checked against `2026-07-06-phase-c-run-the-audit-design.md`):
- C1 `audits` / `audit_checklist_items` / `audit_findings` tables + enums (`audit_status`/`checklist_result`/`finding_severity`/`finding_status`) + split RLS + tenant/audit triggers + all-4-verb attack tests → Tasks 1, 2, 3. ✓
- Evidence-per-item link (decision: extend `evidence_links`, justified) → Task 4. ✓
- `'audit'` `task_source` isolated migration committed before use → Task 5 (before Task 7's insert). ✓
- Audits domain (status roll-up, checklist %, finding severity) → Task 6; actions (finding→task) → Task 7; pages (list/new/detail with checklist + findings) + nav → Task 8. ✓
- C2 `kpis` table (+`measurement_type`) + attack tests → Task 9; domain/actions/page/nav + next-steps→task → Task 10. ✓
- C3 readiness report page reusing aggregate domain fns → Task 11; readiness PDF route → Task 12; audit evidence pack export → Task 13. ✓
- C4 `auditor_access_tokens` (hashed/expiry/revoke) + owner-only RLS + attack tests → Task 14; `audit_view_for_token` RPC + pgTAP proving org-scope + refusal of expired/revoked/unknown → Task 15; public `/audit-view/[token]` (outside app group, no service-role) → Task 16; owner mint/list/revoke UI → Task 17. ✓
- Full gate + finish → Task 18. ✓
- Testing per v2 §10 (pgTAP all 4 verbs, domain-first, e2e + axe incl. public view, en-GB, original content) → embedded in each task. ✓
- Non-goals respected: no new membership role, no workflow engine, no computed KPI RAG, no recurring-audit automation, no AI. ✓

**2. Placeholder scan:** No "TBD"/"add validation"/"similar to Task N"/bare "write tests" — every code step carries real SQL/TS; near-duplicate UI (edit-style panels) is spelled out inline. The two e2e steps that reference `e2e/product.spec.ts` describe exact selectors/labels to add (matching the exemplar's e2e granularity), not code omissions.

**3. Type consistency:** `AuditStatus`/`ChecklistResult`/`FindingSeverity`/`FindingStatus`/`MeasurementType` defined once (Tasks 6, 10) and imported unchanged; `ReadinessReportInput`/`ReadinessReport`/`buildReadinessReport` defined in Task 11, consumed unchanged in Tasks 12, 16; `loadReadinessInput` (Task 11) reused in Task 12; the token hash (`sha256` hex) is identical across `mintAuditorToken` (Node, Task 17), `audit_view_for_token` (Postgres `encode(digest(...),'hex')`, Task 15), and the pgTAP fixtures (Task 15); the RPC payload shape (`soa`/`risks`/`tasks`/`evidence`/`audits`/`openNonConformities`/`audit`) matches the public page's `Payload` type (Task 16) and `ReadinessReportInput`. Migration numbers `017`–`024` and pgTAP files `015`–`021` are sequential and non-colliding with the existing `…016`/`014`.
