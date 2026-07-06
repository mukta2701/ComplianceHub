# Phase D — Policies + Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out ComplianceHub's one-stop ISMS build with two workstreams. **D1 Policy management:** author policies with an approval lifecycle and per-employee acceptance tracking; a *material* edit bumps the version, invalidates prior acceptances (version-stamped) and notifies members to re-accept; policies attach as first-class evidence. **D2 Ticketing integrations:** push a remediation task to Jira or GitHub Issues as a pre-filled ticket, and poll its status/assignee back on a schedule. Exit criterion: policies can be published, accepted, re-accepted on material edit, and evidenced; a task can be pushed to a connected tracker (proven with a FAKE provider) and its status synced back.

**Architecture:** Two additive workstreams. **D1** adds two tenant tables — `policies` and `policy_acceptances` — following the canonical pattern in `202607020017_audits.sql` verbatim (`organisation_id` column, `is_organisation_member()` split RLS, composite `(id, organisation_id)` FK tenant guards, `capture_audit_event()` AFTER trigger), *enables* the already-present `evidence_links.policy_id` (drop its named deferral check, add the composite tenant FK — the one-target check already counts `policy_id`), and adds ONE `security definer` RPC `notify_policy_reaccept(target_policy_id, note)` — a sanctioned, org-scoped elevated write that posts to the existing `notifications` table (which has no `authenticated` INSERT grant), mirroring Phase C's `audit_view_for_token` precedent. The material-edit rule and acceptance roll-ups live as pure functions in `src/features/policies/domain`; server actions bump the version, version-stamp acceptances, and call the RPC. **D2** adds an owner-only `integration_connections` table (RLS via `is_organisation_owner`, like `auditor_access_tokens`) holding provider config + tokens (never sent to the client), and a member-visible `task_tickets` table. A pure `TicketProvider` interface (`src/features/integrations/domain/provider.ts`) with a deterministic FAKE implementation proves the in-app flow; thin `jira`/`github` adapters implement the same interface against real REST shapes but are never network-tested; a provider registry returns the FAKE unless `INTEGRATIONS_LIVE=1`. Push is a server action; poll-sync is a `CRON_SECRET`-gated `POST /api/cron/integrations-sync` route using the service-role client tenant-scoped per row (like the daily sweep). New `/app` pages are Phase-A fragments (single main + single h1).

**Tech Stack:** Next.js 16 (App Router, server components + server actions), React 19, Tailwind v4 + the hand-authored design system in `src/app/globals.css`, Supabase (Postgres 15 + RLS + pgcrypto `extensions.digest`), zod v4, Playwright + `@axe-core/playwright`, vitest, pgTAP. No new runtime dependency.

## Global Constraints

- **v2 §10 non-negotiables (every task):** RLS + pgTAP attack tests on EVERY new tenant table asserting ALL FOUR cross-tenant verbs (SELECT read-isolation, INSERT `42501`, UPDATE affects-no-rows, DELETE affects-no-rows) plus composite-FK rejection (`23503`); tenant + `capture_audit_event()` audit triggers on every new table; **domain-first testing** (write the vitest/pgTAP assertion before the implementation); **e2e + axe (zero violations)** on every new page; **en-GB** copy throughout; **ORIGINAL content only** — reword any toolkit policy/methodology text in your own words, never copy verbatim.
- **Security:** integration OAuth/access tokens live in `integration_connections` under **owner-only RLS** and are **NEVER sent to the client** (pages select `id,provider,label,config,connected_by,created_at,revoked_at` — never `access_token`/`refresh_token`). No service-role client in any request path — the ONLY service-role user is the poll cron (`/api/cron/integrations-sync`), tenant-scoped per row and `CRON_SECRET`-gated, exactly like `src/app/api/cron/daily/route.ts`. The re-accept notification is posted by the `security definer` RPC (org-scoped inside its body), NOT by a request-path service client. Real Jira/GitHub connection needs the user's OAuth-app client id/secret in env vars — those steps are **user-dependent** and must NOT hardcode secrets. Push/poll in-app logic is tested with the FAKE provider only (no live network in tests).
- **"use server" build rule (RECURRING LESSON):** a `"use server"` file may export ONLY async functions — NEVER a plain const, type, class, or interface (this fails at BUILD, not vitest). All constants/interfaces/classes (`TicketProvider`, `fakeTicketProvider`, label/tone maps, mapping functions, the registry) live in NON-`"use server"` modules under `src/features/…/domain` or `src/features/…/application`; only `actions.ts` route files carry `"use server"`.
- **Migrations are additive.** Numbering continues from `202607020024`; this plan assigns `202607020025` … `202607020031` in task order. pgTAP test files continue from `021`; this plan assigns `022` … `027`. Schema changes are tested against the **already-migrated local DB** — do NOT run `npx supabase db reset` (unreliable here: dual Docker runtimes). Apply with `npx supabase migration up`, then run `npx supabase test db` (no `db reset`).
- **Reuse tokens; never invent colours.** Real `Pill`/`Stat` tones: `blue` (default) `green` (alias `low`) `amber` (alias `medium`) `red` (alias `high`) `critical` `neutral`. Real `Icon` names: `shield home clipboard file alert settings menu arrow check download plus users lock bell`. Do not add CSS unless a step explicitly appends to `globals.css`.
- **Single landmark + single h1 per authenticated page.** `AppShell` renders the only `<main className="content">` and the only page-title `<h1>`. Every `/app` page returns a **fragment** (section headings are `<h2>`/`<h3>`); new titles register in `AppShell`'s `TITLES` array with `/X/new` and detail routes BEFORE their parent (first prefix match wins).
- **Environment (this machine):**
  - `pnpm` is **not** on `PATH`. Run every tool via `npx <tool>` or `./node_modules/.bin/<tool>`.
  - Playwright has `reuseExistingServer: true` (non-CI). **Before running Playwright, start the dev server yourself:** `./node_modules/.bin/next dev` (background) and wait for `http://127.0.0.1:3000`. Do NOT set `INTEGRATIONS_LIVE` — the FAKE provider is the tested path.
  - Local Supabase stack runs at `127.0.0.1:54321`. Apply new migrations with `npx supabase migration up`, then `npx supabase test db`.
  - Integration tests (`**/*.integration.test.{ts,tsx}`) are **excluded** from `npx vitest run` by `vitest.config.ts`.
- **Conventional commits, the configured Git author, NO co-author trailer.** The pre-commit privacy hook has known false positives; `git commit --no-verify` is permitted **only** when a commit is blocked with zero genuine findings.
- **Work in this working directory on the existing `phase-a-ui-uplift` branch** (or a fresh `phase-d-policies-integrations` branch created in Task 1). No separate worktree.

### Existing signatures this plan builds on (all verified against the codebase)

- Canonical DB primitives (`202607020001_foundation.sql`): `public.is_organisation_member(target_organisation_id uuid) returns boolean` (`:56`), `public.is_organisation_owner(target_organisation_id uuid) returns boolean` (`:64`, `role = 'owner'`), both `stable security definer set search_path=''`. `public.memberships` has `primary key (organisation_id, user_id)` — the composite-FK target.
- `capture_audit_event()` (`202607020003_soa_risks_audit.sql`): `security definer set search_path=''`; derives `org_id` from `row_data ->> 'organisation_id'` for any table not special-cased. **Every Phase D table carries `organisation_id`, so NO edit to this function is required.**
- Owner-only RLS pattern (`202607020023_auditor_access_tokens.sql`): all four verbs gate on `public.is_organisation_owner(organisation_id)`; INSERT additionally requires `created_by = (select auth.uid())`; `revoke all … from anon, authenticated; grant select, insert, update, delete … to authenticated;`.
- `public.evidence_links` (`202607020007_evidence.sql:37-59`, widened by `202607020020`): carries `policy_id uuid` (currently forced null by the **named** check `evidence_links_policy_deferred check (policy_id is null)`); the one-target check is `evidence_links_one_target check (num_nonnulls(control_id, risk_id, task_id, policy_id, audit_checklist_item_id) = 1)` — **it already counts `policy_id`, so it needs NO change**; `unique (evidence_id, policy_id)` **already exists**; composite tenant FK `evidence_links_evidence_tenant_fk`; split RLS (SELECT/INSERT/DELETE only — no UPDATE policy); audit trigger. `grant select, insert, delete on public.evidence_links to authenticated;`.
- `linkEvidenceAction` (`src/app/app/evidence/actions.ts`): parses `target` = `"control:<id>"|"risk:<id>"|"task:<id>"`, whitelists `kind`, inserts `evidence_links` with the matching `*_id`. Extend to `policy`.
- `public.notifications` (`202607020008_notifications.sql`): columns `id bigint identity, organisation_id, user_id, kind text(1..80), subject_type text(1..80), subject_id text(<=128), message text(1..500), sweep_on date default current_date, read_at, created_at`; dedup `unique (user_id, kind, subject_type, subject_id, sweep_on)`; audit trigger; RLS = SELECT/UPDATE own rows only; **NO `authenticated` INSERT grant** (only the service-role sweep inserts, `src/app/api/cron/daily/route.ts:73-81`). "Types" are free strings (`evidence_expiring`, `task_overdue`, …), not an enum.
- `public.tasks` (`202607020006_tasks.sql`): `unique (id, organisation_id)`; `source public.task_source` (values `manual, gap, evidence_expiry, policy_review, system, risk_treatment, audit`); `constraint tasks_owner_tenant_fk foreign key (organisation_id, owner_id) references public.memberships(organisation_id, user_id)`; RLS insert requires `created_by = (select auth.uid())`.
- Daily-sweep cron (`src/app/api/cron/daily/route.ts`): `authorised(request)` compares `request.headers.get("authorization")` to `Bearer ${process.env.CRON_SECRET}` with `timingSafeEqual`; `const supabase = createSupabaseServiceClient();`; iterates rows across orgs (each row carries `organisation_id`); `export const dynamic = "force-dynamic";`; exports both `GET` and `POST`. Service-role grants are added per-table in a dedicated migration (`202607020009_service_role_automation_grants.sql`) — **new tables the cron touches need explicit grants**.
- `createSupabaseServiceClient()` (`src/lib/supabase/service.ts`) — `import "server-only"`, bypasses RLS, cron-only. `createSupabaseServerClient()` (`src/lib/supabase/server.ts`) — RLS-scoped request client.
- `requireAppContext()` (`src/lib/app-context.ts`) → `{ supabase, user, membership: { organisation_id, role, organisations }, organisation: { id: string; name: string } }`. `enforceRateLimit(key: string, options: { limit: number; windowMs: number })` (`src/lib/security/rate-limit.ts`) throws on breach.
- UI (`src/components/ui.tsx`): `PageIntro({ eyebrow?, title, body, action? })`, `Card(HTMLAttributes)` → `<section className="card …">`, `Stat({ label, value, detail, tone? })`, `Pill({ children, tone? })`, `Progress({ value, tone? })`, `Ring({ value, size? })`. `Icon({ name })` (`src/components/icons.tsx`). `AppShell` (`src/components/app-shell.tsx`): `nav` = `[href, icon, label]` tuples (`:9-23`); `TITLES` = `[hrefPrefix, title]` first-match-wins (`:25-33`). List pages = fragment starting with `<PageIntro>`, load via one `Promise.all`, render tables in `<Card><div className="data-table-wrap" role="region" aria-label="…" tabIndex={0}><table>`. Create forms = `<form action={…} className="card app-form"><div className="form-grid"><label>…<input name="…"/></label></div><button className="button primary">…</button></form>`.
- Tasks detail (`src/app/app/tasks/[id]/page.tsx`): fragment; awaits `params: Promise<{ id: string }>`; `requireAppContext`; `notFound()` when absent; a `facts: Array<[string, React.ReactNode]>` `<dl className="fact-grid">`; the status form is `<form action={updateTaskStatusAction} className="card" …>`. `Pill` is already imported. Tasks actions (`src/app/app/tasks/actions.ts`, `"use server"`) follow: `requireAppContext` → validate → `supabase.from("tasks").update({…}).eq("id", id)` → `revalidatePath`.
- e2e (`e2e/product.spec.ts`): `import AxeBuilder from "@axe-core/playwright";`; axe idiom `const axe = await new AxeBuilder({ page }).analyze(); expect(axe.violations).toEqual([]);`. Specs are `e2e/*.spec.ts`, projects `chromium` + `mobile`, `baseURL http://127.0.0.1:3000`.

---

## Workstream D1 — Policy management (Tasks 1–8)

### Task 1: `policies` table + `policy_status` enum + RLS + attack tests

Stand up the policy entity following the canonical tenant-table pattern. `owner_id`/`approved_by` are composite `(organisation_id, …)` FKs into `memberships`. `version` starts at 1 and is bumped by a material edit (Task 6). `unique (id, organisation_id)` is the composite-FK target for Task 2 and the evidence link in Task 3.

**Files:**
- Create branch `phase-d-policies-integrations` (Step 1)
- Create: `supabase/migrations/202607020025_policies.sql`
- Create: `supabase/tests/database/022_policies.sql`

**Interfaces:**
- Consumes: `public.organisations`, `public.memberships`, `public.profiles`, `public.is_organisation_member`, `public.capture_audit_event` (all existing).
- Produces: enum `public.policy_status` (`draft`,`in_review`,`approved`,`archived`); table `public.policies(id, organisation_id, reference, title, body, version, status, owner_id, approved_by, approved_at, review_due, created_by, created_at, updated_at)` with `unique (organisation_id, reference)` and `unique (id, organisation_id)`.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b phase-d-policies-integrations
```

Expected: `Switched to a new branch 'phase-d-policies-integrations'`. (If it already exists, `git checkout phase-d-policies-integrations`.)

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/202607020025_policies.sql`:

```sql
-- Phase D1: policy register. A policy has an approval lifecycle (draft ->
-- in_review -> approved -> archived) and a version that a MATERIAL edit bumps
-- (server-side, Task 6). owner_id / approved_by are members of the same org
-- (composite tenant FKs into memberships). unique (id, organisation_id) is the
-- composite-FK target for policy_acceptances and evidence_links.policy_id.

create type public.policy_status as enum ('draft', 'in_review', 'approved', 'archived');

create table public.policies (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  reference text not null check (char_length(reference) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 100000),
  version integer not null default 1 check (version >= 1),
  status public.policy_status not null default 'draft',
  owner_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  review_due date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, reference),
  unique (id, organisation_id),
  constraint policies_owner_tenant_fk foreign key (organisation_id, owner_id)
    references public.memberships(organisation_id, user_id) on delete set null (owner_id),
  constraint policies_approver_tenant_fk foreign key (organisation_id, approved_by)
    references public.memberships(organisation_id, user_id) on delete set null (approved_by)
);
create index policies_org_status_idx on public.policies(organisation_id, status);

create trigger policies_audit after insert or update or delete on public.policies
for each row execute function public.capture_audit_event();

alter table public.policies enable row level security;
create policy policies_members_select on public.policies for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy policies_members_insert on public.policies for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy policies_members_update on public.policies for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy policies_members_delete on public.policies for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.policies from anon, authenticated;
grant select, insert, update, delete on public.policies to authenticated;
```

- [ ] **Step 3: Write the pgTAP attack test (all four cross-tenant verbs + FK rejection)**

Create `supabase/tests/database/022_policies.sql`:

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
  $$ insert into public.policies (id, organisation_id, reference, title, body, owner_id, created_by)
     values ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'POL-001', 'Information security policy', 'The organisation protects the confidentiality, integrity and availability of information.', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members author a policy in their own tenant');
select throws_ok(
  $$ insert into public.policies (organisation_id, reference, title, created_by, owner_id)
     values ('20000000-0000-4000-8000-000000000001', 'POL-002', 'x', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'the policy owner must be a member of the policy organisation');
select throws_ok(
  $$ insert into public.policies (organisation_id, reference, title, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'forged', 'x', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot author a policy in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.policies where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'policies are read-isolated per tenant');
select results_eq(
  $$ update public.policies set title = 'hijacked' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant policy update affects no rows');
select results_eq(
  $$ delete from public.policies where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant policy delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.policies set status = 'approved', version = 2 where id = '50000000-0000-4000-8000-000000000001' $$,
  'members progress their own policy');
select is(
  (select count(*) from public.audit_events where entity_type = 'policies' and organisation_id = '20000000-0000-4000-8000-000000000001'),
  2::bigint, 'policy inserts and updates are captured to the audit trail');

select * from finish();
rollback;
```

- [ ] **Step 4: Apply and test**

```bash
npx supabase migration up
npx supabase test db
```

Expected: `022_policies.sql .. ok`; all prior test files (`001`–`021`) still pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607020025_policies.sql supabase/tests/database/022_policies.sql
git commit -m "feat: add the policy register with tenant-safe RLS and versioning"
```

---

### Task 2: `policy_acceptances` table + attack tests

One row per member per policy, version-stamped. A member accepts a policy at the current `version`; the roster (Task 4/7) compares `accepted_version` to the policy's current version, so a material edit (which bumps the version) makes prior acceptances read as "needs to re-accept" without deleting anything. `policy_id`/`user_id` are composite tenant FKs; `unique (policy_id, user_id)` makes accept idempotent (upsert).

**Files:**
- Create: `supabase/migrations/202607020026_policy_acceptances.sql`
- Create: `supabase/tests/database/023_policy_acceptances.sql`

**Interfaces:**
- Consumes: `public.policies` (Task 1), `public.memberships`.
- Produces: table `public.policy_acceptances(id, organisation_id, policy_id, user_id, accepted_version, accepted_at, created_at)` with `unique (policy_id, user_id)` and `unique (id, organisation_id)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020026_policy_acceptances.sql`:

```sql
-- Phase D1: per-member policy acceptance, version-stamped. accepted_version
-- records which version the member acknowledged; the roster compares it to the
-- policy's live version, so a material edit (version bump) invalidates prior
-- acceptances by construction (no delete). A member may only record their OWN
-- acceptance (user_id = auth.uid()); re-accept is an upsert on (policy_id, user_id).

create table public.policy_acceptances (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  policy_id uuid not null,
  user_id uuid not null,
  accepted_version integer not null check (accepted_version >= 1),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (policy_id, user_id),
  constraint policy_acceptances_policy_tenant_fk foreign key (policy_id, organisation_id)
    references public.policies(id, organisation_id) on delete cascade,
  constraint policy_acceptances_user_tenant_fk foreign key (organisation_id, user_id)
    references public.memberships(organisation_id, user_id) on delete cascade
);
create index policy_acceptances_policy_idx on public.policy_acceptances(policy_id);

create trigger policy_acceptances_audit after insert or update or delete on public.policy_acceptances
for each row execute function public.capture_audit_event();

alter table public.policy_acceptances enable row level security;
create policy policy_acceptances_members_select on public.policy_acceptances for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy policy_acceptances_members_insert on public.policy_acceptances for insert to authenticated
with check (public.is_organisation_member(organisation_id) and user_id = (select auth.uid()));
create policy policy_acceptances_members_update on public.policy_acceptances for update to authenticated
using (public.is_organisation_member(organisation_id) and user_id = (select auth.uid()))
with check (public.is_organisation_member(organisation_id) and user_id = (select auth.uid()));
create policy policy_acceptances_members_delete on public.policy_acceptances for delete to authenticated
using (public.is_organisation_member(organisation_id) and user_id = (select auth.uid()));

revoke all on public.policy_acceptances from anon, authenticated;
grant select, insert, update, delete on public.policy_acceptances to authenticated;
```

- [ ] **Step 2: Write the pgTAP attack test**

Create `supabase/tests/database/023_policy_acceptances.sql` — same two-tenant header as Task 1 (users `1…0001/0002`, orgs `2…0001/0002`, owner memberships), then a policy per tenant, then `plan(7)`:

```sql
insert into public.policies (id, organisation_id, reference, title, body, created_by) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'POL-001', 'Policy A', 'body', '10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'POL-001', 'Policy B', 'body', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.policy_acceptances (organisation_id, policy_id, user_id, accepted_version)
     values ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1) $$,
  'members record their own acceptance of a policy in their tenant');
select throws_ok(
  $$ insert into public.policy_acceptances (organisation_id, policy_id, user_id, accepted_version)
     values ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 1) $$,
  '23503', null, 'a member cannot accept another tenant''s policy');
select throws_ok(
  $$ insert into public.policy_acceptances (organisation_id, policy_id, user_id, accepted_version)
     values ('20000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 1) $$,
  '42501', null, 'members cannot record acceptances in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.policy_acceptances where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'acceptances are read-isolated per tenant');
select results_eq(
  $$ update public.policy_acceptances set accepted_version = 99 where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant acceptance update affects no rows');
select results_eq(
  $$ delete from public.policy_acceptances where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant acceptance delete affects no rows');
select is((select count(*) from public.audit_events where entity_type = 'policy_acceptances' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'acceptance writes are audited per tenant');
```

- [ ] **Step 3: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020026_policy_acceptances.sql supabase/tests/database/023_policy_acceptances.sql
git commit -m "feat: add version-stamped per-member policy acceptances"
```

Expected: `023_policy_acceptances.sql .. ok`; prior tests green.

---

### Task 3: Enable `evidence_links.policy_id` (drop deferral + add composite FK) + attack test

**Decision (justified):** the `evidence_links` table already models policy-as-evidence — `policy_id uuid` exists, the one-target check `evidence_links_one_target` already counts `policy_id`, and `unique (evidence_id, policy_id)` already exists. The column was only *deferred* by the **named** check `evidence_links_policy_deferred check (policy_id is null)` and lacks its tenant FK. So this migration is minimal: drop the named deferral check (drop by its explicit name — trivial) and add the composite tenant FK `(policy_id, organisation_id) → policies(id, organisation_id)`. The one-target check needs NO change.

**Files:**
- Create: `supabase/migrations/202607020027_evidence_links_policy_enable.sql`
- Create: `supabase/tests/database/024_evidence_policy_links.sql`

**Interfaces:**
- Consumes: `public.evidence_links`, `public.policies` (Task 1), `public.evidence`.
- Produces: `evidence_links.policy_id` becomes insertable, with composite tenant FK `evidence_links_policy_tenant_fk`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020027_evidence_links_policy_enable.sql`:

```sql
-- Phase D1: enable evidence -> policy links. evidence_links.policy_id already
-- exists and is already counted by the one-target check evidence_links_one_target
-- (widened in 202607020020); unique (evidence_id, policy_id) already exists too.
-- policy_id was only held null by the named check evidence_links_policy_deferred,
-- and it lacked a tenant FK. Drop the deferral and add the composite tenant FK.

alter table public.evidence_links drop constraint if exists evidence_links_policy_deferred;

alter table public.evidence_links
  add constraint evidence_links_policy_tenant_fk foreign key (policy_id, organisation_id)
    references public.policies(id, organisation_id) on delete cascade;
```

- [ ] **Step 2: Write the pgTAP attack test**

Create `supabase/tests/database/024_evidence_policy_links.sql` — two-tenant header, then per-tenant a policy and an evidence record; `plan(5)`:

```sql
insert into public.policies (id, organisation_id, reference, title, body, created_by) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'POL-001', 'Policy A', 'body', '10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'POL-001', 'Policy B', 'body', '10000000-0000-4000-8000-000000000002');
insert into public.evidence (id, organisation_id, title, kind, description, created_by) values
  ('52000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Signed policy', 'note', '', '10000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Signed policy', 'note', '', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, policy_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members link evidence to a policy in their own tenant');
select throws_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, control_id, policy_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', (select id from public.controls limit 1), '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'a link must target exactly one of control/risk/task/policy/checklist-item');
select throws_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, policy_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'evidence cannot link to another tenant''s policy');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.evidence_links where policy_id = '50000000-0000-4000-8000-000000000001'), 0::bigint, 'policy evidence links are read-isolated per tenant');
select results_eq(
  $$ delete from public.evidence_links where policy_id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant policy-evidence-link delete affects no rows');
```

- [ ] **Step 3: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020027_evidence_links_policy_enable.sql supabase/tests/database/024_evidence_policy_links.sql
git commit -m "feat: enable policies to be linked as evidence"
```

Expected: `024_evidence_policy_links.sql .. ok`; `008_evidence.sql` still green (existing single-target links unaffected).

---

### Task 4: Policies domain module + tests

Pure functions for status labels/tones, the material-edit rule (normalise-then-compare `body`), and the acceptance roll-up (accepted-at-current-version / member count). Domain-first: write the test, then the module.

**Files:**
- Create: `src/features/policies/domain/policies.ts`
- Create: `src/features/policies/domain/policies.test.ts`

**Interfaces:**
- Produces: `type PolicyStatus`; `POLICY_STATUS_LABEL`, `POLICY_STATUS_TONE`; `normalisePolicyBody(body): string`; `isMaterialPolicyEdit(previousBody, nextBody): boolean`; `summarisePolicyAcceptances(currentVersion, acceptances, memberCount): { acceptedCurrent: number; total: number; percent: number; outstanding: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/features/policies/domain/policies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { POLICY_STATUS_LABEL, isMaterialPolicyEdit, normalisePolicyBody, summarisePolicyAcceptances } from "./policies";

describe("policy status labels", () => {
  it("labels every status in en-GB", () => {
    expect(POLICY_STATUS_LABEL.in_review).toBe("In review");
    expect(POLICY_STATUS_LABEL.approved).toBe("Approved");
    expect(POLICY_STATUS_LABEL.archived).toBe("Archived");
  });
});

describe("isMaterialPolicyEdit", () => {
  it("treats whitespace-only differences as non-material and text changes as material", () => {
    expect(isMaterialPolicyEdit("We protect data.", "We protect data.")).toBe(false);
    expect(isMaterialPolicyEdit("We protect data.", "  We   protect data.\n")).toBe(false);
    expect(isMaterialPolicyEdit("We protect data.", "We protect all data.")).toBe(true);
  });
});

describe("summarisePolicyAcceptances", () => {
  it("counts acceptances at the current version against the member roster", () => {
    expect(summarisePolicyAcceptances(2, [], 4)).toEqual({ acceptedCurrent: 0, total: 4, percent: 0, outstanding: 4 });
    expect(summarisePolicyAcceptances(2, [
      { accepted_version: 2 }, { accepted_version: 1 }, { accepted_version: 2 },
    ], 4)).toEqual({ acceptedCurrent: 2, total: 4, percent: 50, outstanding: 2 });
    expect(summarisePolicyAcceptances(1, [], 0)).toEqual({ acceptedCurrent: 0, total: 0, percent: 0, outstanding: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/policies/domain/policies.test.ts`
Expected: FAIL — `Cannot find module './policies'`.

- [ ] **Step 3: Write the module**

Create `src/features/policies/domain/policies.ts`:

```ts
export type PolicyStatus = "draft" | "in_review" | "approved" | "archived";

export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = {
  draft: "Draft", in_review: "In review", approved: "Approved", archived: "Archived",
};
export const POLICY_STATUS_TONE: Record<PolicyStatus, string> = {
  draft: "neutral", in_review: "amber", approved: "green", archived: "neutral",
};

// A material edit is any change to the policy text once whitespace is normalised.
// Fixing the review date or re-approving is NOT a body change, so it never bumps
// the version (Task 6 only calls isMaterialPolicyEdit when body is submitted).
export function normalisePolicyBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}
export function isMaterialPolicyEdit(previousBody: string, nextBody: string): boolean {
  return normalisePolicyBody(previousBody) !== normalisePolicyBody(nextBody);
}

export function summarisePolicyAcceptances(
  currentVersion: number,
  acceptances: readonly { accepted_version: number }[],
  memberCount: number,
): { acceptedCurrent: number; total: number; percent: number; outstanding: number } {
  const acceptedCurrent = acceptances.filter((a) => a.accepted_version === currentVersion).length;
  const total = memberCount;
  return {
    acceptedCurrent,
    total,
    percent: total === 0 ? 0 : Math.round((acceptedCurrent / total) * 100),
    outstanding: Math.max(0, total - acceptedCurrent),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/policies/domain/policies.test.ts`
Expected: PASS (3 suites).

- [ ] **Step 5: Commit**

```bash
git add src/features/policies/domain
git commit -m "feat: add the policy domain model, labels, and acceptance roll-up"
```

---

### Task 5: `notify_policy_reaccept(target_policy_id, note)` security-definer RPC + pgTAP proof

The re-accept notification must be posted from a request path (the update action, Task 6), but `notifications` has no `authenticated` INSERT grant and request paths may not use the service-role client. Resolution: ONE `security definer` RPC — org-scoped inside its body — that posts to the existing `notifications` table (reusing the engine, not parallel machinery), mirroring Phase C's `audit_view_for_token` precedent. Granted to `authenticated`; it inserts one notification per member of the policy's org, guarded by `is_organisation_member`.

**Files:**
- Create: `supabase/migrations/202607020028_notify_policy_reaccept.sql`
- Create: `supabase/tests/database/025_notify_policy_reaccept.sql`

**Interfaces:**
- Consumes: `public.policies`, `public.memberships`, `public.notifications`, `public.is_organisation_member`.
- Produces: `public.notify_policy_reaccept(target_policy_id uuid, note text) returns integer` (count of notifications posted), granted to `authenticated`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020028_notify_policy_reaccept.sql`:

```sql
-- Phase D1: post a "please re-accept" notification to every member of a policy's
-- organisation after a material edit. notifications has NO authenticated INSERT
-- grant (only the daily sweep's service role writes it), and request paths must
-- not use the service-role client. So this is a single security-definer RPC,
-- org-scoped inside its body (mirrors public.audit_view_for_token): it refuses
-- callers who are not members of the policy's org (42501) and dedups per day via
-- the notifications unique key. The definer (migration role) bypasses the missing
-- INSERT grant; the org scope keeps it tenant-safe.

create or replace function public.notify_policy_reaccept(target_policy_id uuid, note text default '')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  target_org uuid;
  policy_ref text;
  posted integer;
begin
  select organisation_id, reference into target_org, policy_ref
    from public.policies where id = target_policy_id;
  if target_org is null then
    return 0;
  end if;
  if not public.is_organisation_member(target_org) then
    raise exception 'not a member of the policy organisation' using errcode = '42501';
  end if;
  with recipients as (
    insert into public.notifications (organisation_id, user_id, kind, subject_type, subject_id, message, sweep_on)
    select target_org, m.user_id, 'policy_reaccept', 'policies', target_policy_id::text,
           pg_catalog.left('Policy ' || policy_ref || ' changed — please review and re-accept. ' || note, 500),
           current_date
    from public.memberships m
    where m.organisation_id = target_org
    on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing
    returning 1)
  select count(*)::integer into posted from recipients;
  return posted;
end;
$$;

revoke all on function public.notify_policy_reaccept(uuid, text) from public;
grant execute on function public.notify_policy_reaccept(uuid, text) to authenticated;
```

- [ ] **Step 2: Write the pgTAP proof (posts to members; refuses non-members)**

Create `supabase/tests/database/025_notify_policy_reaccept.sql` — a THREE-user header (owner A `1…0001`, owner B `1…0002`, member A `1…0003`), orgs A/B, memberships (A/0001 owner, A/0003 member, B/0002 owner), a policy in org A, then `plan(4)`:

```sql
insert into public.policies (id, organisation_id, reference, title, body, created_by) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'POL-001', 'Policy A', 'body', '10000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.notify_policy_reaccept('50000000-0000-4000-8000-000000000001', 'v2'), 2, 'a member notifies both members of the policy organisation');
select is((select count(*) from public.notifications where subject_id = '50000000-0000-4000-8000-000000000001' and kind = 'policy_reaccept'), 2::bigint, 'one re-accept notification is posted per org member');

-- Owner B (another tenant) is refused.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.notify_policy_reaccept('50000000-0000-4000-8000-000000000001', 'x') $$,
  '42501', null, 'a non-member of the policy organisation cannot post re-accept notifications');

-- Members of org A can each read only their own notification (RLS).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.notifications where subject_id = '50000000-0000-4000-8000-000000000001'), 1::bigint, 'each member sees only their own re-accept notification');
```

- [ ] **Step 3: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020028_notify_policy_reaccept.sql supabase/tests/database/025_notify_policy_reaccept.sql
git commit -m "feat: add the org-scoped policy re-accept notification RPC"
```

Expected: `025_notify_policy_reaccept.sql .. ok` (4 assertions); prior tests green.

---

### Task 6: Policies application schema + server actions (create / update[material bump + notify] / approve / accept)

The zod schemas and the server actions. `updatePolicyAction` reads the current row, and if the submitted `body` is a material change it bumps `version`, stamps the new version, and calls `notify_policy_reaccept`; a non-material edit (title/review date) leaves the version untouched. `approvePolicyAction` is owner-gated in the action. `acceptPolicyAction` upserts the caller's acceptance at the current version.

**Files:**
- Create: `src/features/policies/application/policy.ts`
- Create: `src/app/app/policies/actions.ts`

**Interfaces:**
- Consumes: `requireAppContext`, `enforceRateLimit`, `isMaterialPolicyEdit` (Task 4), `public.policies`, `public.policy_acceptances`, `notify_policy_reaccept` RPC (Task 5).
- Produces: `policyInputSchema` / `PolicyInput`; actions `createPolicyAction`, `updatePolicyAction`, `approvePolicyAction`, `acceptPolicyAction`.

- [ ] **Step 1: Write the zod schema**

Create `src/features/policies/application/policy.ts`:

```ts
import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => (v ? v : null));

export const policyInputSchema = z.object({
  organisationId: z.string().uuid(),
  reference: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(100_000).default(""),
  ownerId: optionalUuid,
  reviewDue: optionalDate,
});
export type PolicyInput = z.infer<typeof policyInputSchema>;
```

- [ ] **Step 2: Write the server actions**

Create `src/app/app/policies/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { policyInputSchema } from "@/features/policies/application/policy";
import { isMaterialPolicyEdit } from "@/features/policies/domain/policies";

export async function createPolicyAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`policy:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = policyInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data, error } = await supabase.from("policies").insert({
    organisation_id: organisation.id, reference: parsed.reference, title: parsed.title, body: parsed.body,
    owner_id: parsed.ownerId, review_due: parsed.reviewDue, created_by: user.id,
  }).select("id").single();
  if (error) throw new Error("Could not create the policy");
  revalidatePath("/app/policies"); redirect(`/app/policies/${data.id}`);
}

export async function updatePolicyAction(formData: FormData) {
  const { supabase, organisation } = await requireAppContext();
  const id = String(formData.get("id"));
  const parsed = policyInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data: current, error: readError } = await supabase.from("policies").select("body,version").eq("id", id).single();
  if (readError || !current) throw new Error("Policy not found");
  const material = isMaterialPolicyEdit(current.body ?? "", parsed.body);
  const nextVersion = material ? current.version + 1 : current.version;
  const { error } = await supabase.from("policies").update({
    reference: parsed.reference, title: parsed.title, body: parsed.body, owner_id: parsed.ownerId,
    review_due: parsed.reviewDue, version: nextVersion, updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error("Could not update the policy");
  // A material edit invalidates prior acceptances (they were stamped at an older
  // version) and asks members to re-accept via the org-scoped RPC.
  if (material) {
    const { error: notifyError } = await supabase.rpc("notify_policy_reaccept", { target_policy_id: id, note: `Now at version ${nextVersion}.` });
    if (notifyError) throw new Error("Updated the policy but could not notify members to re-accept");
  }
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function approvePolicyAction(formData: FormData) {
  const { supabase, user, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can approve policies");
  const id = String(formData.get("id"));
  const { error } = await supabase.from("policies").update({
    status: "approved", approved_by: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw new Error("Could not approve the policy");
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function setPolicyStatusAction(formData: FormData) {
  const { supabase, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can change a policy's status");
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["draft", "in_review", "approved", "archived"].includes(status)) throw new Error("Invalid policy status");
  const { error } = await supabase.from("policies").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the policy status");
  revalidatePath(`/app/policies/${id}`); revalidatePath("/app/policies");
}

export async function acceptPolicyAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const id = String(formData.get("id"));
  const version = Number(formData.get("version"));
  if (!Number.isInteger(version) || version < 1) throw new Error("Invalid policy version");
  const { error } = await supabase.from("policy_acceptances").upsert({
    organisation_id: organisation.id, policy_id: id, user_id: user.id, accepted_version: version, accepted_at: new Date().toISOString(),
  }, { onConflict: "policy_id,user_id" });
  if (error) throw new Error("Could not record your acceptance");
  revalidatePath(`/app/policies/${id}`);
}
```

- [ ] **Step 3: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
git add src/features/policies/application src/app/app/policies/actions.ts
git commit -m "feat: add policy server actions with material-edit version bump and re-accept"
```

Expected: eslint + tsc clean.

---

### Task 7: Policies pages (list / new / detail) + nav + e2e/axe

The list (`/app/policies`) with acceptance %, the author form (`/app/policies/new`), and the detail (`/app/policies/[id]`) with the body, owner approval/status controls, an accept button for the signed-in member, and the acceptance roster. Register nav + titles. e2e proves author → approve → accept → material edit bumps the version and posts a re-accept notification → the roster reflects it.

**Files:**
- Create: `src/app/app/policies/page.tsx`
- Create: `src/app/app/policies/new/page.tsx`
- Create: `src/app/app/policies/[id]/page.tsx`
- Modify: `src/components/app-shell.tsx` (nav + TITLES)
- Modify: `e2e/product.spec.ts` (policy flow + axe)

**Interfaces:**
- Consumes: `createPolicyAction`, `updatePolicyAction`, `approvePolicyAction`, `setPolicyStatusAction`, `acceptPolicyAction` (Task 6); `POLICY_STATUS_LABEL`, `POLICY_STATUS_TONE`, `summarisePolicyAcceptances`, `type PolicyStatus` (Task 4).
- Produces: routes `/app/policies`, `/app/policies/new`, `/app/policies/[id]`; nav item **`Policies`**.

- [ ] **Step 1: Write the list page**

Create `src/app/app/policies/page.tsx`:

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { POLICY_STATUS_LABEL, POLICY_STATUS_TONE, summarisePolicyAcceptances, type PolicyStatus } from "@/features/policies/domain/policies";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";

export default async function PoliciesPage() {
  const { supabase } = await requireAppContext();
  const [{ data: policies }, { data: acceptances }, { count: memberCount }] = await Promise.all([
    supabase.from("policies").select("id,reference,title,status,version,review_due").order("reference"),
    supabase.from("policy_acceptances").select("policy_id,accepted_version"),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }),
  ]);
  const rows = policies ?? [];
  const members = memberCount ?? 0;
  const approved = rows.filter((p) => p.status === "approved").length;
  const byPolicy = new Map<string, { accepted_version: number }[]>();
  for (const a of acceptances ?? []) byPolicy.set(a.policy_id, [...(byPolicy.get(a.policy_id) ?? []), { accepted_version: a.accepted_version }]);
  return <>
    <PageIntro eyebrow="POLICIES" title="Policy library" body="Author policies, approve them, and track who has accepted the current version." action={<Link className="button primary" href="/app/policies/new"><Icon name="plus" />New policy</Link>} />
    <div className="stats-grid">
      <Stat label="POLICIES" value={rows.length} detail="in the library" />
      <Stat label="APPROVED" value={approved} detail="published to members" tone="green" />
      <Stat label="MEMBERS" value={members} detail="in this workspace" />
    </div>
    <Card style={{ padding: 0 }}><div className="data-table-wrap" role="region" aria-label="Policy library table" tabIndex={0}><table>
      <thead><tr><th>Ref</th><th>Policy</th><th>Status</th><th>Version</th><th>Acceptance</th></tr></thead>
      <tbody>
        {rows.map((p) => {
          const summary = summarisePolicyAcceptances(p.version, byPolicy.get(p.id) ?? [], members);
          return <tr key={p.id}>
            <td>{p.reference}</td>
            <td><Link href={`/app/policies/${p.id}`}><b>{p.title}</b></Link></td>
            <td><Pill tone={POLICY_STATUS_TONE[p.status as PolicyStatus]}>{POLICY_STATUS_LABEL[p.status as PolicyStatus]}</Pill></td>
            <td>v{p.version}</td>
            <td>{summary.acceptedCurrent}/{summary.total} ({summary.percent}%)</td>
          </tr>;
        })}
        {!rows.length && <tr><td colSpan={5} style={{ color: "#596273" }}>No policies yet. Author your first policy to start tracking acceptance.</td></tr>}
      </tbody>
    </table></div></Card>
  </>;
}
```

- [ ] **Step 2: Write the author page**

Create `src/app/app/policies/new/page.tsx`:

```tsx
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { createPolicyAction } from "../actions";

export default async function NewPolicyPage() {
  const { supabase } = await requireAppContext();
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  return <>
    <PageIntro eyebrow="POLICIES" title="Author a policy" body="Write the policy content. You approve it and members accept it from the policy's page." />
    <form action={createPolicyAction} className="card app-form">
      <div className="form-grid">
        <label>Reference<input name="reference" required maxLength={40} placeholder="POL-001" /></label>
        <label>Title<input name="title" required maxLength={200} /></label>
        <label>Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Review due<input name="reviewDue" type="date" /></label>
      </div>
      <label>Policy content<textarea name="body" maxLength={100000} rows={10} placeholder="The policy statement, scope, and responsibilities." /></label>
      <button className="button primary">Create policy</button>
    </form>
  </>;
}
```

- [ ] **Step 3: Write the detail page (body + approval + accept + roster)**

Create `src/app/app/policies/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { POLICY_STATUS_LABEL, POLICY_STATUS_TONE, summarisePolicyAcceptances, type PolicyStatus } from "@/features/policies/domain/policies";
import { Card, PageIntro, Pill, Progress } from "@/components/ui";
import { updatePolicyAction, approvePolicyAction, setPolicyStatusAction, acceptPolicyAction } from "../actions";

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, membership } = await requireAppContext();
  const { data: policy } = await supabase.from("policies").select("id,reference,title,body,version,status,review_due,owner_id").eq("id", id).maybeSingle();
  if (!policy) notFound();
  const [{ data: acceptances }, { data: members }] = await Promise.all([
    supabase.from("policy_acceptances").select("user_id,accepted_version,accepted_at,profiles(display_name)").eq("policy_id", id),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
  ]);
  const roster = members ?? [];
  const summary = summarisePolicyAcceptances(policy.version, (acceptances ?? []).map((a) => ({ accepted_version: a.accepted_version })), roster.length);
  const status = policy.status as PolicyStatus;
  const isOwner = membership.role === "owner";
  const myAcceptance = (acceptances ?? []).find((a) => a.user_id === user.id);
  const acceptedCurrent = myAcceptance?.accepted_version === policy.version;
  const acceptedByUser = new Map((acceptances ?? []).map((a) => [a.user_id, a.accepted_version]));
  return <>
    <Link href="/app/policies" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to policies</Link>
    <PageIntro eyebrow={`POLICY ${policy.reference} · v${policy.version}`} title={policy.title} body={policy.review_due ? `Next review due ${policy.review_due}.` : "No review date set."} action={<Pill tone={POLICY_STATUS_TONE[status]}>{POLICY_STATUS_LABEL[status]}</Pill>} />

    <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>Acceptance</h2>
      <Progress value={summary.percent} />
      <p style={{ fontSize: "12px", color: "#596273", margin: "8px 0 0" }}>{summary.acceptedCurrent} of {summary.total} members have accepted version {policy.version} · {summary.outstanding} outstanding</p>
      <form action={acceptPolicyAction} style={{ marginTop: "12px" }}>
        <input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={policy.version} />
        <button className="button primary" disabled={acceptedCurrent}>{acceptedCurrent ? "You have accepted the current version" : "I accept this policy"}</button>
      </form>
    </Card>

    <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Policy content</h2>
      <p style={{ whiteSpace: "pre-wrap", margin: "0 0 16px" }}>{policy.body || "No content yet."}</p>
      <h3 style={{ fontSize: "14px", margin: "0 0 8px" }}>Edit policy</h3>
      <form action={updatePolicyAction} className="app-form">
        <input type="hidden" name="id" value={id} />
        <div className="form-grid">
          <label>Reference<input name="reference" required maxLength={40} defaultValue={policy.reference} /></label>
          <label>Title<input name="title" required maxLength={200} defaultValue={policy.title} /></label>
          <label>Review due<input name="reviewDue" type="date" defaultValue={policy.review_due ?? ""} /></label>
        </div>
        <label>Policy content<textarea name="body" maxLength={100000} rows={8} defaultValue={policy.body} /></label>
        <p style={{ fontSize: "12px", color: "#596273", margin: 0 }}>Changing the content bumps the version and asks members to re-accept.</p>
        <button className="button secondary">Save changes</button>
      </form>
    </Card>

    {isOwner && <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Approval</h2>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        <form action={approvePolicyAction}><input type="hidden" name="id" value={id} /><button className="button primary" disabled={status === "approved"}>Approve policy</button></form>
        <form action={setPolicyStatusAction} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <input type="hidden" name="id" value={id} />
          <select name="status" defaultValue={status} aria-label="Policy status">{(["draft", "in_review", "approved", "archived"] as PolicyStatus[]).map((s) => <option key={s} value={s}>{POLICY_STATUS_LABEL[s]}</option>)}</select>
          <button className="button secondary">Set status</button>
        </form>
      </div>
    </Card>}

    <Card style={{ padding: "18px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Acceptance roster</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
        {roster.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; const v = acceptedByUser.get(m.user_id); const current = v === policy.version; return <li key={m.user_id} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}><span>{p?.display_name ?? m.user_id}</span>{current ? <Pill tone="green">Accepted v{v}</Pill> : v ? <Pill tone="amber">Re-accept (accepted v{v})</Pill> : <Pill tone="neutral">Not accepted</Pill>}</li>; })}
        {!roster.length && <li style={{ color: "#596273", fontSize: "13px" }}>No members yet.</li>}
      </ul>
    </Card>
  </>;
}
```

- [ ] **Step 4: Register nav + titles**

In `src/components/app-shell.tsx`:
- Add to `nav` after the `["/app/soa", "file", "SoA"]` line: `["/app/policies", "file", "Policies"],`.
- Add to `TITLES` before `["/app", "Dashboard"]`: `["/app/policies/new", "Author a policy"], ["/app/policies", "Policy library"],` (the `/new` route first so it wins the `find`; the detail route `/app/policies/[id]` inherits "Policy library").

- [ ] **Step 5: Add the e2e (author → approve → accept → material edit → roster) + axe**

In `e2e/product.spec.ts`, add a step that: opens **`Policies`** from the workspace nav; clicks **`New policy`**; fills Reference + Title + Policy content; submits; on the detail page clicks **`Approve policy`** (the signed-in user is the workspace owner); clicks **`I accept this policy`** and asserts the button now reads **`You have accepted the current version`**; asserts the roster shows **`Accepted v1`**; edits the **Policy content** textarea to different text and clicks **`Save changes`**; asserts the version eyebrow now reads **`v2`** and the roster shows **`Re-accept (accepted v1)`**; opens **`Notifications`** from the nav and asserts a **re-accept** notification is present; asserts zero axe violations on `/app/policies` and on `/app/policies/<id>`.

- [ ] **Step 6: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
git add src/app/app/policies src/components/app-shell.tsx e2e/product.spec.ts
git commit -m "feat: add the policy library, author form, and approval/acceptance detail page"
```

Expected: policy flow green on chromium + mobile; version bumps to v2 on the content edit; a re-accept notification appears; axe clean on both new pages; nav shows **Policies**.

---

### Task 8: Link a policy as evidence (extend `linkEvidenceAction` + policy detail affordance)

Reuse the existing evidence-link machinery: extend `linkEvidenceAction` to accept a `policy:<id>` target, surface policies in the evidence page's link select, and add a "link existing evidence" affordance on the policy detail page.

**Files:**
- Modify: `src/app/app/evidence/actions.ts` (extend `linkEvidenceAction`)
- Modify: `src/app/app/evidence/page.tsx` (load policies + add them to the link select)
- Modify: `src/app/app/policies/[id]/page.tsx` (linked-evidence list + link form)
- Create: `src/app/app/policies/[id]/evidence-actions.ts`
- Modify: `e2e/product.spec.ts` (link a policy as evidence + axe)

**Interfaces:**
- Consumes: `requireAppContext`, `public.evidence_links` (policy target enabled in Task 3), `public.evidence`, `public.policies`.
- Produces: `linkEvidenceAction` accepts `policy:<id>`; `linkPolicyEvidenceAction(formData)`; policy detail evidence panel.

- [ ] **Step 1: Extend `linkEvidenceAction`**

In `src/app/app/evidence/actions.ts`, change the whitelist and the insert in `linkEvidenceAction`:

```ts
export async function linkEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const evidenceId = String(formData.get("evidenceId"));
  const target = String(formData.get("target")); // "control:<id>" | "risk:<id>" | "task:<id>" | "policy:<id>"
  const [kind, id] = target.split(":");
  if (!id || !["control", "risk", "task", "policy"].includes(kind)) throw new Error("Invalid link target");
  const { error } = await supabase.from("evidence_links").insert({
    organisation_id: organisation.id, evidence_id: evidenceId,
    control_id: kind === "control" ? id : null, risk_id: kind === "risk" ? id : null,
    task_id: kind === "task" ? id : null, policy_id: kind === "policy" ? id : null,
    created_by: user.id,
  });
  if (error) throw new Error("Could not link evidence");
  revalidatePath("/app/evidence");
}
```

- [ ] **Step 2: Surface policies in the evidence page's link select**

In `src/app/app/evidence/page.tsx`: (a) add `supabase.from("policies").select("id,reference,title").order("reference")` to the page's `Promise.all` (bind it to `policies`); (b) in the per-item link `<select name="target">`, append a policies `<optgroup>` after the controls options:

```tsx
<optgroup label="Policies">{policies?.map((p) => <option key={p.id} value={`policy:${p.id}`}>{p.reference}: {p.title}</option>)}</optgroup>
```

(The existing controls options stay; the `select`'s `aria-label` remains valid.)

- [ ] **Step 3: Add the policy-side link action + panel**

Create `src/app/app/policies/[id]/evidence-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";

export async function linkPolicyEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const policyId = String(formData.get("policyId"));
  const evidenceId = String(formData.get("evidenceId"));
  if (!evidenceId) throw new Error("Choose an evidence record to link");
  const { error } = await supabase.from("evidence_links").insert({
    organisation_id: organisation.id, evidence_id: evidenceId, policy_id: policyId, created_by: user.id,
  });
  if (error) throw new Error("Could not link the evidence");
  revalidatePath(`/app/policies/${policyId}`);
}

export async function unlinkPolicyEvidenceAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const policyId = String(formData.get("policyId"));
  await supabase.from("evidence_links").delete().eq("id", String(formData.get("linkId")));
  revalidatePath(`/app/policies/${policyId}`);
}
```

In `src/app/app/policies/[id]/page.tsx`: (a) import the actions — `import { linkPolicyEvidenceAction, unlinkPolicyEvidenceAction } from "./evidence-actions";`; (b) add to the `Promise.all` two reads — `supabase.from("evidence_links").select("id,evidence(id,title)").eq("policy_id", id)` (bind `links`) and `supabase.from("evidence").select("id,title").order("title")` (bind `evidenceOptions`); (c) append this panel at the end of the fragment:

```tsx
<Card style={{ padding: "18px", marginTop: "16px" }}>
  <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Evidence</h2>
  <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "grid", gap: "6px" }}>
    {(links ?? []).map((l) => { const e = Array.isArray(l.evidence) ? l.evidence[0] : l.evidence; return <li key={l.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}><span>{e?.title ?? "Evidence"}</span><form action={unlinkPolicyEvidenceAction}><input type="hidden" name="policyId" value={id} /><input type="hidden" name="linkId" value={l.id} /><button aria-label="Remove evidence link" style={{ border: 0, background: "none", color: "#8b94a2" }}>×</button></form></li>; })}
    {!links?.length && <li style={{ color: "#596273", fontSize: "13px" }}>No evidence linked yet.</li>}
  </ul>
  <form action={linkPolicyEvidenceAction} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
    <input type="hidden" name="policyId" value={id} />
    <select name="evidenceId" defaultValue="" aria-label="Link evidence to this policy"><option value="" disabled>Link evidence…</option>{evidenceOptions?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>
    <button className="button secondary">Link</button>
  </form>
</Card>
```

- [ ] **Step 4: Add the e2e (link a policy as evidence) + axe**

In `e2e/product.spec.ts`, extend the policy flow: on the policy detail page, in the **Evidence** panel select an existing evidence record from **`Link evidence…`** and click **`Link`**; assert the evidence title now appears in the panel's list; re-assert zero axe violations on `/app/policies/<id>`. (Assumes an evidence record exists from the earlier evidence e2e; if none, author one via `/app/evidence/new` first.)

- [ ] **Step 5: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000
npx playwright test e2e/product.spec.ts
git add src/app/app/evidence/actions.ts src/app/app/evidence/page.tsx src/app/app/policies/[id] e2e/product.spec.ts
git commit -m "feat: allow policies to be attached as evidence"
```

Expected: eslint/tsc clean; linking a policy as evidence works from both the evidence page and the policy page; axe clean.

---

## Workstream D2 — Ticketing integrations (Tasks 9–16)

### Task 9: `integration_provider` enum + `integration_connections` table (owner-only RLS) + attack tests

Owner-managed connections hold the provider, a label, `config` (project key / repo), and the access/refresh tokens. Owner-only RLS mirrors `auditor_access_tokens` (all four verbs gate on `is_organisation_owner`). `unique (id, organisation_id)` is the composite-FK target for `task_tickets` (Task 10). Tokens are NEVER selected by pages (see Global Constraints).

**Files:**
- Create: `supabase/migrations/202607020029_integration_connections.sql`
- Create: `supabase/tests/database/026_integration_connections.sql`

**Interfaces:**
- Consumes: `public.organisations`, `public.memberships`, `public.is_organisation_owner`, `public.capture_audit_event`.
- Produces: enum `public.integration_provider` (`jira`,`github`); table `public.integration_connections(id, organisation_id, provider, label, config, access_token, refresh_token, connected_by, created_at, revoked_at)` with `unique (id, organisation_id)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020029_integration_connections.sql`:

```sql
-- Phase D2: owner-managed ticketing connections (Jira / GitHub). Owner-only RLS
-- (mirrors auditor_access_tokens): only organisation owners create / list /
-- revoke connections. config holds provider settings (Jira project key + base
-- URL, or GitHub owner + repo); access_token/refresh_token are dev/env for now
-- (Vault at go-live) and are NEVER selected by client-facing pages. unique
-- (id, organisation_id) is the composite-FK target for task_tickets.

create type public.integration_provider as enum ('jira', 'github');

create table public.integration_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider public.integration_provider not null,
  label text not null default '' check (char_length(label) <= 160),
  config jsonb not null default '{}'::jsonb,
  access_token text,
  refresh_token text,
  connected_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organisation_id),
  constraint integration_connections_connector_tenant_fk foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id) on delete cascade
);
create index integration_connections_org_idx on public.integration_connections(organisation_id) where revoked_at is null;

create trigger integration_connections_audit after insert or update or delete on public.integration_connections
for each row execute function public.capture_audit_event();

alter table public.integration_connections enable row level security;
create policy integration_connections_owner_select on public.integration_connections for select to authenticated
using (public.is_organisation_owner(organisation_id));
create policy integration_connections_owner_insert on public.integration_connections for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and connected_by = (select auth.uid()));
create policy integration_connections_owner_update on public.integration_connections for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id));
create policy integration_connections_owner_delete on public.integration_connections for delete to authenticated
using (public.is_organisation_owner(organisation_id));

revoke all on public.integration_connections from anon, authenticated;
grant select, insert, update, delete on public.integration_connections to authenticated;
```

- [ ] **Step 2: Write the pgTAP attack test (owner-only + cross-tenant)**

Create `supabase/tests/database/026_integration_connections.sql` — a THREE-user header (owner A `1…0001`, owner B `1…0002`, member A `1…0003`), orgs A/B, memberships (A/0001 owner, B/0002 owner, A/0003 member), then `plan(8)`:

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
  $$ insert into public.integration_connections (id, organisation_id, provider, label, connected_by)
     values ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'jira', 'Engineering Jira', '10000000-0000-4000-8000-000000000001') $$,
  'owners create connections in their own tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.integration_connections (organisation_id, provider, connected_by)
     values ('20000000-0000-4000-8000-000000000001', 'github', '10000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'non-owner members cannot create connections');
select is((select count(*) from public.integration_connections where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'non-owner members cannot list connections (tokens stay hidden)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.integration_connections (organisation_id, provider, connected_by)
     values ('20000000-0000-4000-8000-000000000001', 'jira', '10000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'owners of another tenant cannot create connections in tenant A');
select is((select count(*) from public.integration_connections where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'connections are read-isolated per tenant');
select results_eq(
  $$ update public.integration_connections set revoked_at = now() where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant revoke affects no rows');
select results_eq(
  $$ delete from public.integration_connections where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.integration_connections set revoked_at = now() where id = '60000000-0000-4000-8000-000000000001' $$,
  'owners revoke their own connections');

select * from finish();
rollback;
```

- [ ] **Step 3: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020029_integration_connections.sql supabase/tests/database/026_integration_connections.sql
git commit -m "feat: add owner-only ticketing integration connections"
```

Expected: `026_integration_connections.sql .. ok` (8 assertions); prior tests green.

---

### Task 10: `task_tickets` table + attack tests

One row per task per connection recording the external ticket. `task_id`/`connection_id` are composite tenant FKs; `unique (task_id, connection_id)` prevents duplicate tickets. Member-visible split RLS (so all members see the status chip); only the token-holding path (Task 13) writes. `unique (id, organisation_id)` completes the composite-FK convention.

**Files:**
- Create: `supabase/migrations/202607020030_task_tickets.sql`
- Create: `supabase/tests/database/027_task_tickets.sql`

**Interfaces:**
- Consumes: `public.tasks`, `public.integration_connections` (Task 9).
- Produces: table `public.task_tickets(id, organisation_id, task_id, connection_id, provider, external_id, external_url, external_status, external_assignee, last_synced_at, created_by, created_at, updated_at)` with `unique (task_id, connection_id)` and `unique (id, organisation_id)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202607020030_task_tickets.sql`:

```sql
-- Phase D2: the link between a task and its external tracker ticket. Written by
-- the push action (Task 13) and updated by the poll cron (Task 15). Members see
-- the ticket status chip (split member RLS), while the connection that holds the
-- token stays owner-only (Task 9). task_id / connection_id are composite tenant
-- FKs. unique (task_id, connection_id) prevents duplicate tickets per tracker.

create table public.task_tickets (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  task_id uuid not null,
  connection_id uuid not null,
  provider public.integration_provider not null,
  external_id text not null check (char_length(external_id) between 1 and 200),
  external_url text not null default '' check (char_length(external_url) <= 2000),
  external_status text not null default '' check (char_length(external_status) <= 120),
  external_assignee text check (char_length(external_assignee) <= 200),
  last_synced_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (task_id, connection_id),
  constraint task_tickets_task_tenant_fk foreign key (task_id, organisation_id)
    references public.tasks(id, organisation_id) on delete cascade,
  constraint task_tickets_connection_tenant_fk foreign key (connection_id, organisation_id)
    references public.integration_connections(id, organisation_id) on delete cascade
);
create index task_tickets_org_sync_idx on public.task_tickets(organisation_id, last_synced_at);

create trigger task_tickets_audit after insert or update or delete on public.task_tickets
for each row execute function public.capture_audit_event();

alter table public.task_tickets enable row level security;
create policy task_tickets_members_select on public.task_tickets for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy task_tickets_members_insert on public.task_tickets for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy task_tickets_members_update on public.task_tickets for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy task_tickets_members_delete on public.task_tickets for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.task_tickets from anon, authenticated;
grant select, insert, update, delete on public.task_tickets to authenticated;
```

- [ ] **Step 2: Write the pgTAP attack test**

Create `supabase/tests/database/027_task_tickets.sql` — two-tenant header (as Task 1), then per-tenant a task and an owner connection, then `plan(7)`:

```sql
insert into public.tasks (id, organisation_id, title, source, created_by) values
  ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Fix access reviews', 'manual', '10000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Fix access reviews', 'manual', '10000000-0000-4000-8000-000000000002');
insert into public.integration_connections (id, organisation_id, provider, label, connected_by) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'jira', 'Jira A', '10000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'jira', 'Jira B', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.task_tickets (organisation_id, task_id, connection_id, provider, external_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'jira', 'ENG-1', '10000000-0000-4000-8000-000000000001') $$,
  'members record a ticket for their own task');
select throws_ok(
  $$ insert into public.task_tickets (organisation_id, task_id, connection_id, provider, external_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', 'jira', 'ENG-2', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a ticket cannot attach to another tenant''s task');
select throws_ok(
  $$ insert into public.task_tickets (organisation_id, task_id, connection_id, provider, external_id, created_by)
     values ('20000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 'jira', 'forged', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot record tickets in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.task_tickets where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'tickets are read-isolated per tenant');
select results_eq(
  $$ update public.task_tickets set external_status = 'Done' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant ticket update affects no rows');
select results_eq(
  $$ delete from public.task_tickets where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant ticket delete affects no rows');
select is((select count(*) from public.audit_events where entity_type = 'task_tickets' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'ticket writes are audited per tenant');
```

- [ ] **Step 3: Apply, test, commit**

```bash
npx supabase migration up && npx supabase test db
git add supabase/migrations/202607020030_task_tickets.sql supabase/tests/database/027_task_tickets.sql
git commit -m "feat: add the task-to-external-ticket link table"
```

Expected: `027_task_tickets.sql .. ok`; prior tests green.

---

### Task 11: `TicketProvider` interface + FAKE provider + mapping/due-logic domain + tests

The provider abstraction and all pure in-app logic. **These modules are NOT `"use server"`** (they export interfaces/consts/classes). The FAKE provider is deterministic — `createTicket` returns status `"To Do"`, `fetchTicket` returns status `"In Progress"` — so the push→poll transition is observable across separate requests without shared state. Domain-first: write the test, then the modules.

**Files:**
- Create: `src/features/integrations/domain/provider.ts`
- Create: `src/features/integrations/domain/mapping.ts`
- Create: `src/features/integrations/domain/integrations.test.ts`

**Interfaces:**
- Produces: `type IntegrationProvider`; types `TicketConnection`, `CreateTicketInput`, `CreatedTicket`, `FetchedTicket`; `interface TicketProvider`; `fakeTicketProvider: TicketProvider`; `buildTicketPayload(task): CreateTicketInput`; `isTicketSyncDue(ticket, nowIso, maxAgeMinutes?): boolean`; `ticketStatusTone(status): string`.

- [ ] **Step 1: Write the failing test**

Create `src/features/integrations/domain/integrations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fakeTicketProvider } from "./provider";
import { buildTicketPayload, isTicketSyncDue, ticketStatusTone } from "./mapping";

const conn = { id: "c1", provider: "jira" as const, config: { projectKey: "ENG" }, accessToken: "t" };

describe("fakeTicketProvider round-trip", () => {
  it("creates a To Do ticket and fetches it as In Progress deterministically", async () => {
    const created = await fakeTicketProvider.createTicket(conn, { title: "Fix access reviews", body: "detail" });
    expect(created.externalId).toMatch(/^FAKE-/);
    expect(created.status).toBe("To Do");
    expect(created.url).toContain(created.externalId);
    const fetched = await fakeTicketProvider.fetchTicket(conn, created.externalId);
    expect(fetched.status).toBe("In Progress");
    expect(fetched.assignee).toBe("auto-bot");
  });
});

describe("buildTicketPayload", () => {
  it("pre-fills the title and a body from the task's fields", () => {
    const payload = buildTicketPayload({ title: "Rotate keys", detail: "Rotate the signing keys.", source: "audit", controlCode: "A.8.24" });
    expect(payload.title).toBe("Rotate keys");
    expect(payload.body).toContain("Rotate the signing keys.");
    expect(payload.body).toContain("A.8.24");
    expect(payload.body).toContain("ComplianceHub");
  });
});

describe("isTicketSyncDue", () => {
  it("is due when never synced or older than the window", () => {
    expect(isTicketSyncDue({ lastSyncedAt: null }, "2026-07-06T12:00:00Z")).toBe(true);
    expect(isTicketSyncDue({ lastSyncedAt: "2026-07-06T11:00:00Z" }, "2026-07-06T12:00:00Z")).toBe(true);
    expect(isTicketSyncDue({ lastSyncedAt: "2026-07-06T11:50:00Z" }, "2026-07-06T12:00:00Z")).toBe(false);
  });
});

describe("ticketStatusTone", () => {
  it("maps common tracker statuses to design tones", () => {
    expect(ticketStatusTone("Done")).toBe("green");
    expect(ticketStatusTone("In Progress")).toBe("amber");
    expect(ticketStatusTone("To Do")).toBe("neutral");
    expect(ticketStatusTone("something else")).toBe("blue");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/integrations/domain/integrations.test.ts`
Expected: FAIL — `Cannot find module './provider'`.

- [ ] **Step 3: Write the provider interface + fake**

Create `src/features/integrations/domain/provider.ts`:

```ts
export type IntegrationProvider = "jira" | "github";

export type TicketConnection = {
  id: string;
  provider: IntegrationProvider;
  config: Record<string, unknown>;
  accessToken: string;
};
export type CreateTicketInput = { title: string; body: string };
export type CreatedTicket = { externalId: string; url: string; status: string };
export type FetchedTicket = { status: string; assignee: string | null; url: string };

export interface TicketProvider {
  createTicket(connection: TicketConnection, input: CreateTicketInput): Promise<CreatedTicket>;
  fetchTicket(connection: TicketConnection, externalId: string): Promise<FetchedTicket>;
}

// Deterministic in-memory-free fake: createTicket always yields "To Do", fetch
// always yields "In Progress", so a push then a poll (separate requests, no
// shared state) produce an observable status transition in tests and e2e.
function stableId(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return `FAKE-${hash.toString(36).toUpperCase()}`;
}

export const fakeTicketProvider: TicketProvider = {
  async createTicket(connection, input) {
    const externalId = stableId(input.title);
    return { externalId, url: `https://tracker.local/${connection.provider}/${externalId}`, status: "To Do" };
  },
  async fetchTicket(connection, externalId) {
    return { status: "In Progress", assignee: "auto-bot", url: `https://tracker.local/${connection.provider}/${externalId}` };
  },
};
```

- [ ] **Step 4: Write the mapping/due-logic module**

Create `src/features/integrations/domain/mapping.ts`:

```ts
import type { CreateTicketInput } from "./provider";

export const TICKET_SYNC_MAX_AGE_MINUTES = 30;

export function buildTicketPayload(task: {
  title: string; detail?: string | null; source?: string | null; controlCode?: string | null;
}): CreateTicketInput {
  const lines = [
    task.detail?.trim() || "No further detail was recorded.",
    "",
    task.controlCode ? `Linked control: ${task.controlCode}` : null,
    task.source ? `Source: ${task.source}` : null,
    "Raised from ComplianceHub.",
  ].filter((l): l is string => l !== null);
  return { title: task.title.slice(0, 200), body: lines.join("\n") };
}

export function isTicketSyncDue(
  ticket: { lastSyncedAt: string | null },
  nowIso: string,
  maxAgeMinutes: number = TICKET_SYNC_MAX_AGE_MINUTES,
): boolean {
  if (ticket.lastSyncedAt === null) return true;
  const ageMs = Date.parse(nowIso) - Date.parse(ticket.lastSyncedAt);
  return ageMs >= maxAgeMinutes * 60 * 1000;
}

export function ticketStatusTone(status: string): string {
  const s = status.trim().toLowerCase();
  if (s === "done" || s === "closed" || s === "resolved") return "green";
  if (s === "in progress" || s === "in review") return "amber";
  if (s === "to do" || s === "open" || s === "backlog") return "neutral";
  return "blue";
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/features/integrations/domain/integrations.test.ts`
Expected: PASS (4 suites).

- [ ] **Step 6: Commit**

```bash
git add src/features/integrations/domain
git commit -m "feat: add the ticket provider interface, fake provider, and pure mapping logic"
```

---

### Task 12: `jira` + `github` adapters + provider registry

Thin adapters that implement `TicketProvider` against the real REST shapes (Jira `/rest/api/3/issue`, GitHub `/repos/{owner}/{repo}/issues`) using the connection's token. **They are NOT `"use server"` and NOT exercised by any test** — the fake proves the flow. The registry returns the fake unless `INTEGRATIONS_LIVE === "1"` (live connections are a documented user step).

**Files:**
- Create: `src/features/integrations/application/jira.ts`
- Create: `src/features/integrations/application/github.ts`
- Create: `src/features/integrations/application/registry.ts`

**Interfaces:**
- Consumes: `TicketProvider`, `TicketConnection`, `fakeTicketProvider` (Task 11), `IntegrationProvider`.
- Produces: `jiraProvider: TicketProvider`; `githubProvider: TicketProvider`; `resolveTicketProvider(provider): TicketProvider`.

- [ ] **Step 1: Write the Jira adapter**

Create `src/features/integrations/application/jira.ts`:

```ts
import type { TicketProvider, TicketConnection, CreateTicketInput } from "@/features/integrations/domain/provider";

// Thin Jira Cloud adapter. config = { baseUrl, projectKey }. Requires a real
// OAuth access token in connection.accessToken (user go-live step). Not network-
// tested — the fake provider proves the in-app flow.
function baseUrl(conn: TicketConnection): string {
  return String((conn.config as { baseUrl?: string }).baseUrl ?? "").replace(/\/+$/, "");
}

export const jiraProvider: TicketProvider = {
  async createTicket(conn: TicketConnection, input: CreateTicketInput) {
    const projectKey = String((conn.config as { projectKey?: string }).projectKey ?? "");
    const res = await fetch(`${baseUrl(conn)}/rest/api/3/issue`, {
      method: "POST",
      headers: { authorization: `Bearer ${conn.accessToken}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey }, summary: input.title, issuetype: { name: "Task" },
          description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: input.body }] }] },
        },
      }),
    });
    if (!res.ok) throw new Error(`Jira createTicket failed: ${res.status}`);
    const data = (await res.json()) as { id: string; key: string };
    return { externalId: data.key, url: `${baseUrl(conn)}/browse/${data.key}`, status: "To Do" };
  },
  async fetchTicket(conn: TicketConnection, externalId: string) {
    const res = await fetch(`${baseUrl(conn)}/rest/api/3/issue/${encodeURIComponent(externalId)}?fields=status,assignee`, {
      headers: { authorization: `Bearer ${conn.accessToken}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Jira fetchTicket failed: ${res.status}`);
    const data = (await res.json()) as { fields: { status?: { name?: string }; assignee?: { displayName?: string } | null } };
    return {
      status: data.fields.status?.name ?? "Unknown",
      assignee: data.fields.assignee?.displayName ?? null,
      url: `${baseUrl(conn)}/browse/${externalId}`,
    };
  },
};
```

- [ ] **Step 2: Write the GitHub adapter**

Create `src/features/integrations/application/github.ts`:

```ts
import type { TicketProvider, TicketConnection, CreateTicketInput } from "@/features/integrations/domain/provider";

// Thin GitHub Issues adapter. config = { owner, repo }. Requires a real token in
// connection.accessToken (user go-live step). Not network-tested.
function repoPath(conn: TicketConnection): string {
  const c = conn.config as { owner?: string; repo?: string };
  return `${String(c.owner ?? "")}/${String(c.repo ?? "")}`;
}

export const githubProvider: TicketProvider = {
  async createTicket(conn: TicketConnection, input: CreateTicketInput) {
    const res = await fetch(`https://api.github.com/repos/${repoPath(conn)}/issues`, {
      method: "POST",
      headers: { authorization: `Bearer ${conn.accessToken}`, accept: "application/vnd.github+json", "content-type": "application/json" },
      body: JSON.stringify({ title: input.title, body: input.body }),
    });
    if (!res.ok) throw new Error(`GitHub createTicket failed: ${res.status}`);
    const data = (await res.json()) as { number: number; html_url: string; state: string };
    return { externalId: String(data.number), url: data.html_url, status: data.state === "open" ? "To Do" : "Done" };
  },
  async fetchTicket(conn: TicketConnection, externalId: string) {
    const res = await fetch(`https://api.github.com/repos/${repoPath(conn)}/issues/${encodeURIComponent(externalId)}`, {
      headers: { authorization: `Bearer ${conn.accessToken}`, accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub fetchTicket failed: ${res.status}`);
    const data = (await res.json()) as { html_url: string; state: string; assignee?: { login?: string } | null };
    return { status: data.state === "open" ? "In Progress" : "Done", assignee: data.assignee?.login ?? null, url: data.html_url };
  },
};
```

- [ ] **Step 3: Write the registry**

Create `src/features/integrations/application/registry.ts`:

```ts
import type { TicketProvider, IntegrationProvider } from "@/features/integrations/domain/provider";
import { fakeTicketProvider } from "@/features/integrations/domain/provider";
import { jiraProvider } from "./jira";
import { githubProvider } from "./github";

// The fake provider is the default (dev + tests). Real Jira/GitHub calls are
// opt-in via INTEGRATIONS_LIVE=1, which requires the user's OAuth-app tokens on
// the connection (documented go-live step). This keeps live network out of tests.
export function resolveTicketProvider(provider: IntegrationProvider): TicketProvider {
  if (process.env.INTEGRATIONS_LIVE === "1") return provider === "jira" ? jiraProvider : githubProvider;
  return fakeTicketProvider;
}
```

- [ ] **Step 4: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
git commit -am "feat: add thin Jira and GitHub adapters behind a fake-by-default registry"
```

Expected: eslint/tsc clean (adapters compile; no test runs them).

---

### Task 13: Push-task action + "Send to tracker" control + ticket status chip on the task detail page

The push action pre-fills a ticket from the task and stores a `task_tickets` row via the resolved provider (fake in dev). The task detail page gains a "Send to tracker" form (shown only when an owner connection is readable and no ticket exists) and a ticket status chip.

**Files:**
- Create: `src/app/app/tasks/[id]/tracker-actions.ts`
- Modify: `src/app/app/tasks/[id]/page.tsx` (chip + send control)

**Interfaces:**
- Consumes: `requireAppContext`, `enforceRateLimit`, `resolveTicketProvider` (Task 12), `buildTicketPayload`, `ticketStatusTone` (Task 11); `public.integration_connections`, `public.task_tickets`, `public.tasks`.
- Produces: `pushTaskToTrackerAction(formData)`; the task-detail tracker UI.

- [ ] **Step 1: Write the push action**

Create `src/app/app/tasks/[id]/tracker-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { resolveTicketProvider } from "@/features/integrations/application/registry";
import { buildTicketPayload } from "@/features/integrations/domain/mapping";
import type { IntegrationProvider } from "@/features/integrations/domain/provider";

export async function pushTaskToTrackerAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`ticket-push:${user.id}`, { limit: 20, windowMs: 60_000 });
  const taskId = String(formData.get("taskId"));
  const connectionId = String(formData.get("connectionId"));
  // Connection is owner-only RLS; a non-owner sees no rows here and cannot push.
  const { data: connection, error: connError } = await supabase.from("integration_connections")
    .select("id,provider,config,access_token").eq("id", connectionId).is("revoked_at", null).maybeSingle();
  if (connError || !connection) throw new Error("Connection not found or revoked");
  const { data: task, error: taskError } = await supabase.from("tasks")
    .select("id,title,detail,source,controls(code)").eq("id", taskId).maybeSingle();
  if (taskError || !task) throw new Error("Task not found");
  const control = Array.isArray(task.controls) ? task.controls[0] : task.controls;
  const payload = buildTicketPayload({ title: task.title, detail: task.detail, source: task.source, controlCode: control?.code ?? null });
  const provider = resolveTicketProvider(connection.provider as IntegrationProvider);
  const created = await provider.createTicket(
    { id: connection.id, provider: connection.provider as IntegrationProvider, config: connection.config as Record<string, unknown>, accessToken: connection.access_token ?? "" },
    payload,
  );
  const { error } = await supabase.from("task_tickets").insert({
    organisation_id: organisation.id, task_id: taskId, connection_id: connectionId, provider: connection.provider,
    external_id: created.externalId, external_url: created.url, external_status: created.status,
    last_synced_at: new Date().toISOString(), created_by: user.id,
  });
  if (error) throw new Error("Created the ticket but could not record it");
  revalidatePath(`/app/tasks/${taskId}`);
}
```

- [ ] **Step 2: Load the connection + ticket on the task detail page and render the tracker UI**

In `src/app/app/tasks/[id]/page.tsx`: (a) import `import { pushTaskToTrackerAction } from "./tracker-actions";` and `import { ticketStatusTone } from "@/features/integrations/domain/mapping";` (`Pill` and `Card` are already imported); (b) after the task load, add to a `Promise.all` (or two awaits) a ticket read and a connections read:

```tsx
const [{ data: ticket }, { data: connections }] = await Promise.all([
  supabase.from("task_tickets").select("external_id,external_url,external_status,external_assignee,last_synced_at").eq("task_id", id).maybeSingle(),
  supabase.from("integration_connections").select("id,provider,label").is("revoked_at", null).order("created_at"),
]);
```

(c) add a **Tracker** row to the `facts` array (`facts.push([...])` or inline) rendering the chip when a ticket exists:

```tsx
["Tracker", ticket
  ? <a href={ticket.external_url} target="_blank" rel="noreferrer"><Pill tone={ticketStatusTone(ticket.external_status)}>{ticket.external_id}: {ticket.external_status}</Pill></a>
  : <span style={{ color: "#596273" }}>Not pushed</span>],
```

(d) after the status form, render the send control when a connection exists and no ticket has been pushed:

```tsx
{!ticket && (connections?.length ?? 0) > 0 && <form action={pushTaskToTrackerAction} className="card" style={{ padding: "18px", marginTop: "16px", display: "flex", gap: "10px", alignItems: "center" }}>
  <input type="hidden" name="taskId" value={task.id} />
  <label style={{ fontWeight: 700, fontSize: "12px" }}>Send to tracker
    <select name="connectionId" defaultValue={connections![0].id} style={{ marginLeft: "6px" }}>{connections!.map((c) => <option key={c.id} value={c.id}>{c.label || c.provider}</option>)}</select>
  </label>
  <button className="button primary">Send to tracker</button>
</form>}
```

- [ ] **Step 3: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
git add src/app/app/tasks/[id]/tracker-actions.ts src/app/app/tasks/[id]/page.tsx
git commit -m "feat: push a task to a connected tracker and show its ticket status"
```

Expected: eslint/tsc clean. (The e2e that exercises this runs in Task 16, after the settings page can create a connection.)

---

### Task 14: Integrations settings page (add dev connection / list / revoke) + nav

An owner-only `/app/integrations` page: a connect checklist (with the user-dependent go-live steps documented), a form to add a dev connection (provider + label + config + token), a list of connections, and a revoke control. Tokens are never rendered.

**Files:**
- Create: `src/features/integrations/application/connection.ts`
- Create: `src/app/app/integrations/actions.ts`
- Create: `src/app/app/integrations/page.tsx`
- Modify: `src/components/app-shell.tsx` (nav + TITLES)

**Interfaces:**
- Consumes: `requireAppContext`, `enforceRateLimit`, `public.integration_connections`.
- Produces: `connectionInputSchema`; actions `addConnectionAction`, `revokeConnectionAction`; route `/app/integrations`; nav item **`Integrations`**.

- [ ] **Step 1: Write the zod schema**

Create `src/features/integrations/application/connection.ts`:

```ts
import { z } from "zod";

export const connectionInputSchema = z.object({
  provider: z.enum(["jira", "github"]),
  label: z.string().trim().max(160).default(""),
  // Jira: baseUrl + projectKey. GitHub: owner + repo. All optional at dev time.
  baseUrl: z.string().max(300).default(""),
  projectKey: z.string().max(80).default(""),
  owner: z.string().max(120).default(""),
  repo: z.string().max(120).default(""),
  accessToken: z.string().max(4000).default(""),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;
```

- [ ] **Step 2: Write the server actions**

Create `src/app/app/integrations/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { connectionInputSchema } from "@/features/integrations/application/connection";

export async function addConnectionAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can add integrations");
  await enforceRateLimit(`connection:${user.id}`, { limit: 10, windowMs: 60_000 });
  const parsed = connectionInputSchema.parse(Object.fromEntries(formData));
  const config = parsed.provider === "jira"
    ? { baseUrl: parsed.baseUrl, projectKey: parsed.projectKey }
    : { owner: parsed.owner, repo: parsed.repo };
  const { error } = await supabase.from("integration_connections").insert({
    organisation_id: organisation.id, provider: parsed.provider, label: parsed.label || parsed.provider,
    config, access_token: parsed.accessToken || null, connected_by: user.id,
  });
  if (error) throw new Error("Could not add the connection");
  revalidatePath("/app/integrations");
}

export async function revokeConnectionAction(formData: FormData) {
  const { supabase, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can revoke integrations");
  const { error } = await supabase.from("integration_connections").update({ revoked_at: new Date().toISOString() }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not revoke the connection");
  revalidatePath("/app/integrations");
}
```

- [ ] **Step 3: Write the page**

Create `src/app/app/integrations/page.tsx`:

```tsx
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { addConnectionAction, revokeConnectionAction } from "./actions";

export default async function IntegrationsPage() {
  const { supabase, membership } = await requireAppContext();
  // Tokens are NEVER selected here — only non-secret columns.
  const { data: connections } = await supabase.from("integration_connections")
    .select("id,provider,label,config,created_at,revoked_at").order("created_at", { ascending: false });
  const isOwner = membership.role === "owner";
  return <>
    <PageIntro eyebrow="INTEGRATIONS" title="Ticketing integrations" body="Connect Jira or GitHub Issues, then push remediation tasks as tickets and sync their status back." />
    {!isOwner && <Card style={{ padding: "18px" }} role="note"><p>Only workspace owners can manage integrations.</p></Card>}
    {isOwner && <>
      <Card style={{ padding: "18px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>Go-live checklist</h2>
        <ol style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#4a5163", display: "grid", gap: "4px" }}>
          <li>Register an OAuth app with your provider (Jira or GitHub) and note the client id and secret.</li>
          <li>Set the provider client id/secret and <code>INTEGRATIONS_LIVE=1</code> in the server environment.</li>
          <li>Add the connection below with a valid access token; tokens are stored owner-only and never shown again.</li>
          <li>Enable the poll cron (<code>/api/cron/integrations-sync</code>) with a Vercel cron and <code>CRON_SECRET</code>.</li>
          <li>Production only: move tokens to Supabase Vault or an encrypted column.</li>
        </ol>
        <p style={{ fontSize: "12px", color: "#596273", margin: "8px 0 0" }}>Until <code>INTEGRATIONS_LIVE=1</code> is set, connections use a built-in sandbox tracker so you can trial the flow safely.</p>
      </Card>
      <Card style={{ padding: "18px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Add a connection</h2>
        <form action={addConnectionAction} className="app-form">
          <div className="form-grid">
            <label>Provider<select name="provider" defaultValue="jira"><option value="jira">Jira</option><option value="github">GitHub Issues</option></select></label>
            <label>Label<input name="label" maxLength={160} placeholder="Engineering Jira" /></label>
            <label>Jira base URL<input name="baseUrl" maxLength={300} placeholder="https://acme.atlassian.net" /></label>
            <label>Jira project key<input name="projectKey" maxLength={80} placeholder="ENG" /></label>
            <label>GitHub owner<input name="owner" maxLength={120} placeholder="acme" /></label>
            <label>GitHub repo<input name="repo" maxLength={120} placeholder="isms" /></label>
          </div>
          <label>Access token (optional in sandbox)<input name="accessToken" maxLength={4000} type="password" autoComplete="off" /></label>
          <button className="button primary">Add connection</button>
        </form>
      </Card>
      <Card style={{ padding: "18px" }}>
        <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Connections</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
          {(connections ?? []).map((c) => <li key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}>
            <span><b>{c.label || c.provider}</b> · {c.provider} {c.revoked_at ? <Pill tone="neutral">Revoked</Pill> : <Pill tone="green">Active</Pill>}</span>
            {!c.revoked_at && <form action={revokeConnectionAction}><input type="hidden" name="id" value={c.id} /><button style={{ color: "var(--red)", border: 0, background: "none", fontWeight: 700 }}>Revoke</button></form>}
          </li>)}
          {!connections?.length && <li style={{ color: "#596273" }}>No connections yet. Add one above to start pushing tasks as tickets.</li>}
        </ul>
      </Card>
    </>}
  </>;
}
```

- [ ] **Step 4: Register nav + title**

In `src/components/app-shell.tsx`:
- Add to `nav` after the `["/app/settings", "settings", "Settings"]` line: `["/app/integrations", "lock", "Integrations"],`.
- Add to `TITLES` before `["/app", "Dashboard"]`: `["/app/integrations", "Ticketing integrations"],`.

- [ ] **Step 5: Verify + commit**

```bash
npx eslint . && npx tsc --noEmit
git add src/features/integrations/application/connection.ts src/app/app/integrations src/components/app-shell.tsx
git commit -m "feat: add the owner integrations settings page with a connect checklist"
```

Expected: eslint/tsc clean; nav shows **Integrations**.

---

### Task 15: Poll-sync cron route + service-role grants migration

A `CRON_SECRET`-gated `POST /api/cron/integrations-sync` route that, per active ticket that is due (`isTicketSyncDue`), fetches the provider status and updates `external_status`/`external_assignee`/`last_synced_at`. Service-role, tenant-scoped per row (each row carries `organisation_id`), exactly like the daily sweep. The new tables need explicit service-role grants (per the `202607020009` convention).

**Files:**
- Create: `supabase/migrations/202607020031_integration_service_role_grants.sql`
- Create: `src/app/api/cron/integrations-sync/route.ts`
- Create: `src/app/api/cron/integrations-sync/route.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServiceClient`, `resolveTicketProvider` (Task 12), `isTicketSyncDue` (Task 11); `public.task_tickets`, `public.integration_connections`.
- Produces: grants on `task_tickets`/`integration_connections` to `service_role`; route handler + an auth-guard unit test.

- [ ] **Step 1: Write the service-role grants migration**

Create `supabase/migrations/202607020031_integration_service_role_grants.sql`:

```sql
-- Phase D2: the poll cron (/api/cron/integrations-sync) is the only service-role
-- consumer of the integration tables. Grant ONLY what it performs, matching the
-- least-privilege convention of 202607020009: read connections (for the token +
-- config), read + update tickets (status/assignee/last_synced_at). No insert or
-- delete — pushes happen in the request path (Task 13), never in the cron.

grant select on public.integration_connections to service_role;
grant select, update on public.task_tickets to service_role;
```

- [ ] **Step 2: Write the route**

Create `src/app/api/cron/integrations-sync/route.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveTicketProvider } from "@/features/integrations/application/registry";
import { isTicketSyncDue } from "@/features/integrations/domain/mapping";
import type { IntegrationProvider } from "@/features/integrations/domain/provider";

export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sync(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const { data: tickets, error } = await supabase.from("task_tickets")
    .select("id,organisation_id,connection_id,provider,external_id,last_synced_at,integration_connections(config,access_token,revoked_at)");
  if (error) throw error;
  let synced = 0;
  for (const ticket of tickets ?? []) {
    if (!isTicketSyncDue({ lastSyncedAt: ticket.last_synced_at }, nowIso)) continue;
    const conn = Array.isArray(ticket.integration_connections) ? ticket.integration_connections[0] : ticket.integration_connections;
    if (!conn || conn.revoked_at) continue;
    const provider = resolveTicketProvider(ticket.provider as IntegrationProvider);
    const fetched = await provider.fetchTicket(
      { id: ticket.connection_id, provider: ticket.provider as IntegrationProvider, config: (conn.config ?? {}) as Record<string, unknown>, accessToken: conn.access_token ?? "" },
      ticket.external_id,
    );
    // Tenant-scoped update: filtered by this row's organisation_id.
    const { error: updateError } = await supabase.from("task_tickets").update({
      external_status: fetched.status, external_assignee: fetched.assignee, external_url: fetched.url,
      last_synced_at: nowIso, updated_at: nowIso,
    }).eq("id", ticket.id).eq("organisation_id", ticket.organisation_id);
    if (updateError) throw updateError;
    synced += 1;
  }
  return NextResponse.json({ synced });
}

export async function GET(request: Request) { return sync(request); }
export async function POST(request: Request) { return sync(request); }
```

- [ ] **Step 3: Write the auth-guard unit test**

Create `src/app/api/cron/integrations-sync/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

describe("integrations-sync auth guard", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => { process.env.CRON_SECRET = "test-secret"; });
  afterEach(() => { process.env.CRON_SECRET = original; });

  it("rejects a request without the bearer secret", async () => {
    const res = await POST(new Request("http://localhost/api/cron/integrations-sync", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("rejects a request with a wrong secret", async () => {
    const res = await POST(new Request("http://localhost/api/cron/integrations-sync", { method: "POST", headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 4: Apply, verify, commit**

```bash
npx supabase migration up && npx supabase test db
npx eslint . && npx tsc --noEmit && npx vitest run src/app/api/cron/integrations-sync/route.test.ts
git add supabase/migrations/202607020031_integration_service_role_grants.sql src/app/api/cron/integrations-sync
git commit -m "feat: add the CRON_SECRET-gated integrations poll-sync route"
```

Expected: migration applies; pgTAP `001`–`027` green; the two guard assertions pass; eslint/tsc clean.

---

### Task 16: Integrations e2e (push → ticket → simulated poll) + axe

Prove the whole D2 flow with the FAKE provider (default dev): create a dev connection, push a task, see the "To Do" chip, POST the poll cron with the bearer secret, and see the chip flip to "In Progress". Axe on the new page and the task detail with the tracker UI.

**Files:**
- Modify: `e2e/product.spec.ts` (integrations flow + axe)

**Interfaces:**
- Consumes: `/app/integrations`, the task detail tracker UI (Task 13), `POST /api/cron/integrations-sync` (Task 15).
- Produces: an end-to-end assertion of push→poll.

- [ ] **Step 1: Add the integrations e2e**

In `e2e/product.spec.ts`, add a step (the signed-in user is the workspace owner) that:
1. Opens **`Integrations`** from the nav; asserts the **`Ticketing integrations`** heading; in "Add a connection" keeps Provider **`Jira`**, fills **Label** = `Sandbox Jira`, submits; asserts the connection lists as **`Active`**.
2. Runs the axe idiom on `/app/integrations`: `const axe = await new AxeBuilder({ page }).analyze(); expect(axe.violations).toEqual([]);`.
3. Navigates to an existing task's detail page (`/app/tasks/<id>` — reuse a task created earlier in the spec, e.g. the corrective-action or KPI task); in the **Send to tracker** form keeps the connection selected and clicks **`Send to tracker`**; asserts a ticket chip containing **`FAKE-`** and **`To Do`** is visible and the "Send to tracker" form is gone.
4. Simulates a poll: `const res = await page.request.post("/api/cron/integrations-sync", { headers: { authorization: \`Bearer ${process.env.CRON_SECRET}\` } }); expect(res.ok()).toBeTruthy();` then `await page.reload();` and asserts the chip now shows **`In Progress`**.
5. Runs the axe idiom on the task detail page.
6. Back on `/app/integrations`, clicks **`Revoke`** for the sandbox connection and asserts it now shows **`Revoked`**.

Note: `CRON_SECRET` must be set in the dev server's environment (it already is — the daily sweep uses it). If Playwright's `page.request` does not inherit it, read it in the spec from `process.env.CRON_SECRET` and skip step 4's assertion with a clear message if unset (do NOT hardcode a secret).

- [ ] **Step 2: Run + commit**

```bash
./node_modules/.bin/next dev &   # wait for http://127.0.0.1:3000 (do NOT set INTEGRATIONS_LIVE)
npx playwright test e2e/product.spec.ts
git add e2e/product.spec.ts
git commit -m "test: prove push-to-tracker and poll-sync end to end with the fake provider"
```

Expected: the integrations flow is green on chromium + mobile; the chip transitions To Do → In Progress after the simulated poll; axe clean on `/app/integrations` and the task detail page.

---

## Final — Task 17: Full gate + finish

Run the entire test gate green, confirm the security invariants, then finish the branch.

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

Expected: eslint clean; tsc clean; all vitest suites pass (including `policies` and `integrations` domains + the cron guard); pgTAP files `001`–`027` all `.. ok`; `next build` succeeds; Playwright green on chromium + mobile including the policy flow (author → approve → accept → material edit → re-accept notification → roster) and the integrations flow (connect → push → poll → revoke) with zero axe violations on every new page.

- [ ] **Step 2: Confirm the security invariants by inspection**

- [ ] `grep -rn "access_token\|refresh_token" src/app` returns NO page/component select of those columns (only `src/app/app/tasks/[id]/tracker-actions.ts` and the cron route read `access_token`, server-side, never rendered).
- [ ] `grep -rn "createSupabaseServiceClient" src/app` shows service-role use ONLY in `src/app/api/cron/daily/route.ts` and `src/app/api/cron/integrations-sync/route.ts` (and the evidence compensation path) — never in a policy/integration page or non-cron action.
- [ ] `grep -rn "notify_policy_reaccept" src` shows exactly one call site (`src/app/app/policies/actions.ts`); the RPC body filters by the policy's `organisation_id` and refuses non-members.
- [ ] `grep -rln "\"use server\"" src/features/integrations` returns nothing (interfaces/consts/adapters/registry are plain modules); `next build` did not fail on a `"use server"` non-async export.
- [ ] `grep -rn "INTEGRATIONS_LIVE" src` shows the flag is read ONLY in `registry.ts`; tests and the e2e never set it (fake provider proves the flow); no secret is hardcoded anywhere.

- [ ] **Step 3: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to choose merge / PR / cleanup. If committing directly: ensure every task's commit is present, the working tree is clean (`git status`), and the branch is ready.

```bash
git status
git log --oneline main..HEAD
```

Expected: clean tree; one commit per task (~16 feature/test commits) on `phase-d-policies-integrations`.

---

## Self-Review

**1. Spec coverage** (checked against `2026-07-06-phase-d-policies-integrations-design.md`):
- D1 `policies` (+`policy_status`) + split RLS + tenant/audit triggers + all-4-verb attack tests → Task 1. ✓
- D1 `policy_acceptances` (version-stamped, `unique (policy_id, user_id)`) + attack tests → Task 2. ✓
- D1 evidence-as-policy enablement: drop the named `evidence_links_policy_deferred`, add composite `(policy_id, organisation_id)` FK; one-target check already counts `policy_id` (no change) + attack test → Task 3. ✓
- D1 policies domain (status labels/tones, material-edit rule, acceptance summary) + tests → Task 4. ✓
- D1 material-edit re-accept notification via the existing notifications engine — realised as the org-scoped `notify_policy_reaccept` security-definer RPC (the table has no `authenticated` INSERT grant; request paths can't use service-role) + pgTAP → Task 5; wired into `updatePolicyAction` (bumps version, calls RPC) → Task 6. ✓
- D1 policies actions (create/update[material bump + notify]/approve/accept) → Task 6; pages (list/new/detail with approval + accept + roster) + nav + e2e/axe → Task 7. ✓
- D1 link-policy-as-evidence wiring (extend `linkEvidenceAction`, evidence page select, policy detail panel) → Task 8. ✓
- D2 `integration_provider` enum + `integration_connections` (owner-only RLS) + attack tests → Task 9; `task_tickets` (member RLS) + attack tests → Task 10. ✓
- D2 `TicketProvider` interface + FAKE + push mapping + poll due-logic + status mapping + tests → Task 11; jira + github adapters (thin, real REST shape, not network-tested) + registry → Task 12. ✓
- D2 push-task action + "Send to tracker" UI + ticket status chip → Task 13; integrations settings page (add dev connection/list/revoke) + nav + connect checklist → Task 14. ✓
- D2 poll-sync cron `POST /api/cron/integrations-sync` (CRON_SECRET-gated, service-role tenant-scoped) + service-role grants migration + pure due-logic (tested in Task 11) + auth-guard test → Task 15; e2e (FAKE provider) push→ticket→simulated-poll + axe → Task 16. ✓
- Full gate + finish → Task 17. ✓
- Testing per v2 §10 (pgTAP all 4 verbs, domain-first, e2e + axe, en-GB, original content) → embedded per task. ✓
- User-dependency callouts (real OAuth app client id/secret + `INTEGRATIONS_LIVE`; enabling the poll cron in prod; Vault token storage) → surfaced as the go-live checklist on the integrations page (Task 14) and marked user-dependent throughout; not hardcoded. ✓
- Non-goals respected: no live-network integration tests (fake only), no write-back beyond status/assignee, no third tracker, no policy e-signature workflow, no AI, no marketplace. ✓

**2. Placeholder scan:** No "TBD"/"similar to Task N"/bare "write tests" — every code step carries real SQL/TS. The e2e steps (Tasks 7, 8, 16) name exact labels/selectors and the axe idiom, matching the exemplar's e2e granularity, and reference `e2e/product.spec.ts` as the file to extend (not omitted code). Migration/pgTAP numbers are concrete and sequential.

**3. Type-name consistency:** `PolicyStatus` defined once (Task 4), imported unchanged in Tasks 7. `policyInputSchema`/`PolicyInput` (Task 6) consumed by Tasks 7. `isMaterialPolicyEdit`/`summarisePolicyAcceptances` (Task 4) consumed by Tasks 6/7. `IntegrationProvider`, `TicketConnection`, `CreateTicketInput`, `CreatedTicket`, `FetchedTicket`, `TicketProvider`, `fakeTicketProvider` defined once (Task 11) and consumed unchanged in Tasks 12, 13, 15. `buildTicketPayload`/`isTicketSyncDue`/`ticketStatusTone` (Task 11) consumed in Tasks 13, 15. `resolveTicketProvider` (Task 12) consumed in Tasks 13, 15. `connectionInputSchema` (Task 14) used only there. RPC name `notify_policy_reaccept` is identical across the migration (Task 5), its call site (Task 6), and the invariant check (Task 17). Migration numbers `025`–`031` and pgTAP files `022`–`027` are sequential and non-colliding with existing `…024`/`021`. Enum/column names match between each migration, its pgTAP fixture, and the TS that reads it (`external_status`, `accepted_version`, `access_token` never selected by pages, etc.).
