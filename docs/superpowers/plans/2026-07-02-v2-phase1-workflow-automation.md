# ComplianceHub v2 Phase 1 — Workflow Automation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v2 Phase 1 workflow automation core: the framework-agnostic control library (§3a), the tasks & remediation engine (§4.1), the evidence vault (§4.2), and scheduled automation + notifications (§4.3), per `docs/superpowers/specs/2026-07-02-compliancehub-v2-design.md`.

**Architecture:** Modular monolith on Next.js App Router + Supabase. Each module lives in `src/features/<module>/domain|application` with framework-independent, test-first domain logic. Every tenant table carries `organisation_id`, is protected by RLS with composite-FK tenant consistency, has audit triggers, and gets pgTAP cross-tenant attack tests. The daily sweep is a pure domain planner driven by a cron route authenticated with `CRON_SECRET`.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Supabase (Postgres + RLS + Storage), zod v4, vitest, Playwright + axe, pgTAP (`supabase test db`).

## Global Constraints

- `pnpm` is available. In a new worktree run `pnpm install --frozen-lockfile` before the baseline gate; do not assume the main worktree's `node_modules` is shared. Use the repository scripts (`pnpm verify`, `pnpm test:e2e`) where present, and use `pnpm exec <tool>` for focused runs. `playwright.config.ts` launches the app with `pnpm dev`, so keep pnpm on `PATH` for e2e.
- Database tests need the local Supabase stack: `npx supabase start` (once), then `npx supabase db reset` (applies all migrations) before `npx supabase test db`.
- Every new tenant table: `organisation_id` column, RLS enabled, policies via `public.is_organisation_member(...)`, explicit narrow grants (`revoke all ... from anon, authenticated` first), composite tenant FKs, audit trigger via `public.capture_audit_event()`, and pgTAP attack tests in `supabase/tests/database/`.
- Immutable things get `public.reject_immutable_change('message')` statement triggers (pattern: migration `202607020004`).
- No destructive changes to shipped tables — additive `alter table` only.
- Migrations are numbered SQL: next free numbers are `202607020005` … `202607020008`.
- zod v4 idioms as in `src/features/risks/application/risk.ts` (e.g. `z.iso.date()`, `z.coerce.number()`).
- Domain logic is dependency-free TypeScript in `src/features/<module>/domain`, test-first with vitest, style per `src/features/risks/domain/risks.ts`.
- UI follows the existing dense server-component style (see `src/app/app/risks/page.tsx`), en-GB copy, Tailwind utility classes.
- Content (task catalogue titles etc.) must be original per `docs/content-methodology.md` — no ISO text reproduction.
- **Spec deviation (deliberate, approved by self-consistency):** the recurrence enum adds `semiannually` beyond the spec's list because the spec's own starter calendar requires a semi-annual backup-restore test.
- `tasks.policy_id` and `evidence_links.policy_id` are present for the Phase 2 link shape but constrained to `NULL` in Phase 1. Phase 2 must replace those deferred checks with composite tenant FKs when `public.policies` exists; arbitrary unvalidated policy UUIDs are never accepted.
- Commit after each task with the conventional-commit message shown. Do not add a synthetic co-author trailer; preserve the actual Git author configured for the worktree.

---

### Task 1: Framework-agnostic control library (§3a) — migration + pgTAP

The §3a model generalises what migration `202607020004` already shipped: `control_catalogue_versions`/`control_catalogue_controls` (93 original controls) become the ISO 27001:2022 framework's *requirements*; a new shared `controls` library is seeded 1:1 and mapped. Requirements reuse the `control_catalogue_controls` UUIDs so existing `assessment_control_mappings.control_id` values double as `requirement_id`s — no rewrite of shipped data.

**Files:**
- Create: `supabase/migrations/202607020005_control_library.sql`
- Test: `supabase/tests/database/006_control_library.sql`

**Interfaces:**
- Consumes: `public.control_catalogue_controls` rows for catalogue version `'40000000-0000-4000-8000-000000000001'` (93 rows, codes `5.1`–`8.34`), `public.reject_immutable_change()`.
- Produces: tables `public.frameworks`, `public.requirements`, `public.controls` (columns `id uuid`, `code text` `CH-001`…`CH-093`, `title`, `description`, `position`), `public.requirement_control_mappings(requirement_id, control_id)`. Framework row id `'50000000-0000-4000-8000-000000000001'`. Later tasks reference `public.controls(id)` from `tasks.control_id` and `evidence_links.control_id`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/006_control_library.sql`:

```sql
begin;
select plan(8);

select is((select count(*) from public.frameworks where slug = 'iso-27001' and version = '2022'), 1::bigint, 'ISO 27001:2022 framework is seeded');
select is((select count(*) from public.requirements r join public.frameworks f on f.id = r.framework_id where f.slug = 'iso-27001'), 93::bigint, 'all 93 catalogue controls became requirements');
select is((select count(*) from public.controls), 93::bigint, 'shared control library is seeded 1:1');
select is((select count(*) from public.requirement_control_mappings), 93::bigint, 'every requirement maps to a control');
select is(
  (select count(*) from public.requirements r where not exists (select 1 from public.control_catalogue_controls c where c.id = r.id)),
  0::bigint, 'requirement ids reuse control catalogue ids'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select results_eq($$ select count(*) from public.controls $$, $$ values (93::bigint) $$, 'authenticated users can read the control library');
select throws_ok($$ insert into public.controls (code, title, position) values ('CH-999', 'Forged control', 999) $$, '42501', null, 'clients cannot write to the control library');
reset role;
select throws_ok($$ update public.frameworks set title = 'tampered' $$, 'P0001', 'framework catalogues are immutable', 'frameworks are immutable');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase db reset && npx supabase test db`
Expected: `006_control_library` FAILs (relation `public.frameworks` does not exist). If the local stack is not running, run `npx supabase start` first.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/202607020005_control_library.sql`:

```sql
-- §3a framework-agnostic control library. The existing control catalogue
-- (202607020004) becomes the ISO 27001:2022 framework's requirements;
-- evidence, tasks, and policies attach to the shared controls library.

create table public.frameworks (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  version text not null,
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '',
  control_catalogue_version_id uuid references public.control_catalogue_versions(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (slug, version)
);

create table public.requirements (
  id uuid primary key default extensions.gen_random_uuid(),
  framework_id uuid not null references public.frameworks(id) on delete restrict,
  code text not null,
  title text not null check (char_length(title) between 3 and 200),
  description text not null default '',
  position integer not null check (position > 0),
  unique (framework_id, code),
  unique (framework_id, position)
);

create table public.controls (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code ~ '^CH-[0-9]{3}$'),
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '',
  position integer not null unique check (position > 0)
);

create table public.requirement_control_mappings (
  requirement_id uuid not null references public.requirements(id) on delete restrict,
  control_id uuid not null references public.controls(id) on delete restrict,
  rationale text not null default '',
  primary key (requirement_id, control_id)
);

insert into public.frameworks (id, slug, version, title, description, control_catalogue_version_id, published_at)
values ('50000000-0000-4000-8000-000000000001', 'iso-27001', '2022',
  'ISO/IEC 27001:2022 alignment',
  'Readiness framework aligned to the themes of ISO/IEC 27001:2022 using independently written control descriptions.',
  '40000000-0000-4000-8000-000000000001', now());

-- Requirements reuse the control catalogue UUIDs so assessment_control_mappings
-- rows can be joined onto requirements without data migration.
insert into public.requirements (id, framework_id, code, title, position)
select c.id, '50000000-0000-4000-8000-000000000001', c.code, c.title, c.position
from public.control_catalogue_controls c
where c.catalogue_version_id = '40000000-0000-4000-8000-000000000001';

-- Phase 1 seeds the shared library 1:1 from the ISO requirements; later
-- frameworks map onto these same controls (consolidation is a content task).
insert into public.controls (code, title, position)
select 'CH-' || lpad(c.position::text, 3, '0'), c.title, c.position
from public.control_catalogue_controls c
where c.catalogue_version_id = '40000000-0000-4000-8000-000000000001';

insert into public.requirement_control_mappings (requirement_id, control_id, rationale)
select r.id, k.id, 'Direct one-to-one seed from the 2022 catalogue.'
from public.requirements r
join public.controls k on k.position = r.position
where r.framework_id = '50000000-0000-4000-8000-000000000001';

create trigger frameworks_immutable before update or delete on public.frameworks
for each statement execute function public.reject_immutable_change('framework catalogues are immutable');
create trigger requirements_immutable before update or delete on public.requirements
for each statement execute function public.reject_immutable_change('framework requirements are immutable');
create trigger controls_immutable before update or delete on public.controls
for each statement execute function public.reject_immutable_change('shared controls are immutable');
create trigger requirement_control_mappings_immutable before update or delete on public.requirement_control_mappings
for each statement execute function public.reject_immutable_change('requirement control mappings are immutable');

alter table public.frameworks enable row level security;
alter table public.requirements enable row level security;
alter table public.controls enable row level security;
alter table public.requirement_control_mappings enable row level security;
create policy frameworks_read on public.frameworks for select to authenticated using (published_at is not null);
create policy requirements_read on public.requirements for select to authenticated
using (exists (select 1 from public.frameworks f where f.id = framework_id and f.published_at is not null));
create policy controls_read on public.controls for select to authenticated using (true);
create policy requirement_control_mappings_read on public.requirement_control_mappings for select to authenticated using (true);

revoke all on public.frameworks, public.requirements, public.controls, public.requirement_control_mappings from anon, authenticated;
grant select on public.frameworks, public.requirements, public.controls, public.requirement_control_mappings to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db`
Expected: all test files PASS, including `006_control_library` (8/8).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607020005_control_library.sql supabase/tests/database/006_control_library.sql
git commit -m "feat: add framework-agnostic control library (frameworks, requirements, shared controls)"
```

---

### Task 2: Tasks domain logic (§4.1) — recurrence, overdue, gap suggestions

**Files:**
- Create: `src/features/tasks/domain/tasks.ts`
- Test: `src/features/tasks/domain/tasks.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain).
- Produces:
  - `type TaskStatus = "open" | "in_progress" | "done" | "cancelled"`
  - `type TaskRecurrence = "weekly" | "monthly" | "quarterly" | "semiannually" | "annually"`
  - `type GapForTask = Readonly<{ questionId: string; category: string; prompt: string; remediation: string }>`
  - `nextDueDate(dueOn: string, recurrence: TaskRecurrence): string` — ISO date in, ISO date out, month-end clamped
  - `isOverdue(task: { status: TaskStatus; dueOn: string | null }, today: string): boolean`
  - `suggestTasksFromGaps(gaps: readonly GapForTask[]): { sourceQuestionId: string; title: string; detail: string; source: "gap" }[]`

- [ ] **Step 1: Write the failing tests**

Create `src/features/tasks/domain/tasks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isOverdue, nextDueDate, suggestTasksFromGaps } from "./tasks";

describe("nextDueDate", () => {
  it("advances by each supported recurrence interval", () => {
    expect(nextDueDate("2026-07-02", "weekly")).toBe("2026-07-09");
    expect(nextDueDate("2026-07-02", "monthly")).toBe("2026-08-02");
    expect(nextDueDate("2026-07-02", "quarterly")).toBe("2026-10-02");
    expect(nextDueDate("2026-07-02", "semiannually")).toBe("2027-01-02");
    expect(nextDueDate("2026-07-02", "annually")).toBe("2027-07-02");
  });
  it("clamps to the last day of shorter months", () => {
    expect(nextDueDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDueDate("2026-08-31", "monthly")).toBe("2026-09-30");
  });
  it("crosses year boundaries for weekly recurrence", () => {
    expect(nextDueDate("2026-12-28", "weekly")).toBe("2027-01-04");
  });
  it("rejects non-ISO dates", () => {
    expect(() => nextDueDate("02/07/2026", "weekly")).toThrow(/ISO date/);
  });
});

describe("isOverdue", () => {
  it("flags only actionable tasks with a past due date", () => {
    expect(isOverdue({ status: "open", dueOn: "2026-07-01" }, "2026-07-02")).toBe(true);
    expect(isOverdue({ status: "in_progress", dueOn: "2026-07-01" }, "2026-07-02")).toBe(true);
    expect(isOverdue({ status: "open", dueOn: "2026-07-02" }, "2026-07-02")).toBe(false);
    expect(isOverdue({ status: "done", dueOn: "2026-07-01" }, "2026-07-02")).toBe(false);
    expect(isOverdue({ status: "open", dueOn: null }, "2026-07-02")).toBe(false);
  });
});

describe("suggestTasksFromGaps", () => {
  it("turns gaps into pre-filled task suggestions without persisting", () => {
    const suggestions = suggestTasksFromGaps([
      { questionId: "q1", category: "Access control", prompt: "Access reviews happen", remediation: "Establish access reviews" },
    ]);
    expect(suggestions).toEqual([
      { sourceQuestionId: "q1", title: "Close gap: Access reviews happen", detail: "Establish access reviews", source: "gap" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/domain/tasks.test.ts`
Expected: FAIL — cannot resolve `./tasks`.

- [ ] **Step 3: Write the implementation**

Create `src/features/tasks/domain/tasks.ts`:

```ts
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";
export type TaskRecurrence = "weekly" | "monthly" | "quarterly" | "semiannually" | "annually";
export type GapForTask = Readonly<{ questionId: string; category: string; prompt: string; remediation: string }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS: Record<Exclude<TaskRecurrence, "weekly">, number> = { monthly: 1, quarterly: 3, semiannually: 6, annually: 12 };

function addMonthsClamped(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const daysInTarget = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, daysInTarget));
  return first.toISOString().slice(0, 10);
}

export function nextDueDate(dueOn: string, recurrence: TaskRecurrence): string {
  if (!ISO_DATE.test(dueOn)) throw new RangeError("Due date must be an ISO date (YYYY-MM-DD)");
  if (recurrence === "weekly") {
    const [year, month, day] = dueOn.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  }
  return addMonthsClamped(dueOn, MONTHS[recurrence]);
}

export function isOverdue(task: { status: TaskStatus; dueOn: string | null }, today: string): boolean {
  if (!ISO_DATE.test(today)) throw new RangeError("Today must be an ISO date (YYYY-MM-DD)");
  return (task.status === "open" || task.status === "in_progress") && task.dueOn !== null && task.dueOn < today;
}

export function suggestTasksFromGaps(gaps: readonly GapForTask[]) {
  return gaps.map((gap) => ({
    sourceQuestionId: gap.questionId,
    title: `Close gap: ${gap.prompt}`,
    detail: gap.remediation,
    source: "gap" as const,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/domain/tasks.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/domain/tasks.ts src/features/tasks/domain/tasks.test.ts
git commit -m "feat: add tasks domain logic (recurrence, overdue, gap suggestions)"
```

---

### Task 3: Tasks + starter calendar catalogue — migration + pgTAP

**Files:**
- Create: `supabase/migrations/202607020006_tasks.sql`
- Test: `supabase/tests/database/007_tasks.sql`

**Interfaces:**
- Consumes: `public.controls(id)` (Task 1), `public.risks`, `public.memberships`, `public.capture_audit_event()`, `public.is_organisation_member()`.
- Produces: enums `public.task_status`, `public.task_source`, `public.task_recurrence`; table `public.tasks` with `unique (id, organisation_id)` (needed by Task 6's `evidence_links`); table `public.task_catalogue_versions` + `public.task_catalogue_items` seeded with the starter compliance calendar; `public.risks` gains `unique (id, organisation_id)`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/007_tasks.sql`:

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
insert into public.tasks (id, organisation_id, title, created_by) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Tenant A task', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Tenant B task', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq($$ select title from public.tasks $$, $$ values ('Tenant A task'::text) $$, 'members only see their own tenant tasks');
select throws_ok(
  $$ insert into public.tasks (organisation_id, title, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'forged', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot create tasks in another tenant');
select throws_ok(
  $$ insert into public.tasks (organisation_id, title, created_by, owner_id)
     values ('20000000-0000-4000-8000-000000000001', 'bad owner', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'task owner must be an organisation member');
select throws_ok($$ delete from public.tasks where title = 'Tenant A task' $$, '42501', null, 'tasks are cancelled, never deleted by clients');
select is((select count(*) from public.task_catalogue_items), 3::bigint, 'starter calendar catalogue is readable and seeded');
reset role;
select throws_ok($$ update public.task_catalogue_items set title = 'tampered' $$, 'P0001', 'task catalogue items are immutable', 'task catalogue is immutable');
select is(
  (select count(*) from public.audit_events where entity_type = 'tasks' and organisation_id = '20000000-0000-4000-8000-000000000001'),
  1::bigint, 'task writes are audited');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase db reset && npx supabase test db`
Expected: `007_tasks` FAILs (relation `public.tasks` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/202607020006_tasks.sql`:

```sql
-- §4.1 tasks & remediation engine, plus the starter compliance calendar
-- catalogue. Recurrence regeneration happens in the application layer at
-- completion time; the daily sweep only raises notifications.

create type public.task_status as enum ('open', 'in_progress', 'done', 'cancelled');
create type public.task_source as enum ('manual', 'gap', 'evidence_expiry', 'policy_review', 'system');
create type public.task_recurrence as enum ('weekly', 'monthly', 'quarterly', 'semiannually', 'annually');

alter table public.risks add constraint risks_id_org_key unique (id, organisation_id);

create table public.tasks (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  detail text not null default '' check (char_length(detail) <= 10000),
  status public.task_status not null default 'open',
  owner_id uuid references public.profiles(id) on delete set null,
  due_on date,
  recurrence public.task_recurrence,
  source public.task_source not null default 'manual',
  control_id uuid references public.controls(id) on delete restrict,
  risk_id uuid,
  policy_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  constraint tasks_owner_tenant_fk foreign key (organisation_id, owner_id)
    references public.memberships(organisation_id, user_id) on delete set null (owner_id),
  constraint tasks_risk_tenant_fk foreign key (risk_id, organisation_id)
    references public.risks(id, organisation_id) on delete set null (risk_id),
  constraint tasks_policy_deferred check (policy_id is null)
);
create index tasks_org_status_due_idx on public.tasks(organisation_id, status, due_on);

create table public.task_catalogue_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  version text not null unique,
  title text not null,
  published_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.task_catalogue_items (
  id uuid primary key default extensions.gen_random_uuid(),
  catalogue_version_id uuid not null references public.task_catalogue_versions(id) on delete restrict,
  title text not null check (char_length(title) between 3 and 200),
  detail text not null default '',
  recurrence public.task_recurrence not null,
  position integer not null check (position > 0),
  unique (catalogue_version_id, position)
);

insert into public.task_catalogue_versions (id, version, title, published_at)
values ('70000000-0000-4000-8000-000000000001', '2026.1', 'ComplianceHub starter compliance calendar', now());
insert into public.task_catalogue_items (catalogue_version_id, title, detail, recurrence, position) values
  ('70000000-0000-4000-8000-000000000001', 'Review user access rights', 'Confirm joiners, movers, and leavers hold only the access their role needs; record the outcome.', 'quarterly', 1),
  ('70000000-0000-4000-8000-000000000001', 'Review security policies', 'Check each approved policy is still accurate, assign updates where practice has drifted.', 'annually', 2),
  ('70000000-0000-4000-8000-000000000001', 'Test backup restoration', 'Restore a representative backup and record whether recovery objectives were met.', 'semiannually', 3);

create trigger task_catalogue_versions_immutable before update or delete on public.task_catalogue_versions
for each statement execute function public.reject_immutable_change('task catalogue versions are immutable');
create trigger task_catalogue_items_immutable before update or delete on public.task_catalogue_items
for each statement execute function public.reject_immutable_change('task catalogue items are immutable');

create trigger tasks_audit after insert or update or delete on public.tasks
for each row execute function public.capture_audit_event();

alter table public.tasks enable row level security;
alter table public.task_catalogue_versions enable row level security;
alter table public.task_catalogue_items enable row level security;
create policy tasks_members_select on public.tasks for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy tasks_members_insert on public.tasks for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy tasks_members_update on public.tasks for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy task_catalogue_versions_read on public.task_catalogue_versions for select to authenticated
using (published_at is not null);
create policy task_catalogue_items_read on public.task_catalogue_items for select to authenticated
using (exists (select 1 from public.task_catalogue_versions v where v.id = catalogue_version_id and v.published_at is not null));

revoke all on public.tasks, public.task_catalogue_versions, public.task_catalogue_items from anon, authenticated;
grant select, insert, update on public.tasks to authenticated;
grant select on public.task_catalogue_versions, public.task_catalogue_items to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db`
Expected: all files PASS, including `007_tasks` (7/7).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607020006_tasks.sql supabase/tests/database/007_tasks.sql
git commit -m "feat: add tasks table, tenant RLS, and starter compliance calendar catalogue"
```

---

### Task 4: Tasks application layer + UI

**Files:**
- Create: `src/features/tasks/application/task.ts`
- Test: `src/features/tasks/application/task.test.ts`
- Create: `src/app/app/tasks/actions.ts`
- Create: `src/app/app/tasks/page.tsx`
- Create: `src/app/app/tasks/new/page.tsx`
- Create: `src/app/app/tasks/from-gap/page.tsx`
- Create: `src/app/app/tasks/[id]/page.tsx`
- Modify: `src/app/app/layout.tsx` (nav: add Tasks link)
- Modify: `src/app/app/risks/page.tsx` (gap suggestions: add "Accept as task" alongside "Accept as risk")
- Modify: `src/app/app/soa/page.tsx` (per-control linked-task widget)
- Modify: `src/app/app/page.tsx` (dashboard: Open tasks tile)

**Interfaces:**
- Consumes: `nextDueDate`, `TaskRecurrence`, `TaskStatus` from `@/features/tasks/domain/tasks`; `requireAppContext` from `@/lib/app-context`; `enforceRateLimit` from `@/lib/security/rate-limit`; tables `tasks`, `task_catalogue_items`, `assessment_control_mappings`, `requirement_control_mappings`.
- Produces: `taskInputSchema` (zod); server actions `createTaskAction`, `createGapTaskAction`, `updateTaskStatusAction`, `acceptCalendarSeedAction` in `src/app/app/tasks/actions.ts`; routes `/app/tasks`, `/app/tasks/from-gap`, and `/app/tasks/[id]`.

- [ ] **Step 1: Write the failing schema test**

Create `src/features/tasks/application/task.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { taskInputSchema } from "./task";

describe("taskInputSchema", () => {
  it("accepts a minimal manual task", () => {
    const parsed = taskInputSchema.parse({
      organisationId: "5b60cbd6-9f6f-4b1e-9a3f-1af1c9a1a111", title: "Review firewall rules",
    });
    expect(parsed.status).toBe("open");
    expect(parsed.detail).toBe("");
  });
  it("rejects an unknown recurrence and a blank title", () => {
    expect(() => taskInputSchema.parse({ organisationId: "5b60cbd6-9f6f-4b1e-9a3f-1af1c9a1a111", title: " ", recurrence: "daily" })).toThrow();
  });
  it("normalises empty optional fields", () => {
    const parsed = taskInputSchema.parse({
      organisationId: "5b60cbd6-9f6f-4b1e-9a3f-1af1c9a1a111", title: "T", dueOn: "", ownerId: "", controlId: "", riskId: "", recurrence: "",
    });
    expect(parsed.dueOn).toBeNull();
    expect(parsed.ownerId).toBeNull();
    expect(parsed.recurrence).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/application/task.test.ts`
Expected: FAIL — cannot resolve `./task`.

- [ ] **Step 3: Write the schema**

Create `src/features/tasks/application/task.ts`:

```ts
import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional()
  .transform((value) => (value ? value : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional()
  .transform((value) => (value ? value : null));

export const taskInputSchema = z.object({
  organisationId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  detail: z.string().max(10_000).default(""),
  status: z.enum(["open", "in_progress", "done", "cancelled"]).default("open"),
  ownerId: optionalUuid,
  dueOn: optionalDate,
  recurrence: z.union([z.enum(["weekly", "monthly", "quarterly", "semiannually", "annually"]), z.literal("")]).optional()
    .transform((value) => (value ? value : null)),
  controlId: optionalUuid,
  riskId: optionalUuid,
});
export const gapTaskInputSchema = taskInputSchema.refine((value) => value.ownerId !== null && value.dueOn !== null, {
  message: "Gap tasks require an owner and due date",
});
export type TaskInput = z.infer<typeof taskInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/tasks/application/task.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the server actions**

Create `src/app/app/tasks/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { gapTaskInputSchema, taskInputSchema } from "@/features/tasks/application/task";
import { nextDueDate, type TaskRecurrence } from "@/features/tasks/domain/tasks";

const today = () => new Date().toISOString().slice(0, 10);

export async function createTaskAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`task:${user.id}`, { limit: 30, windowMs: 60_000 });
  const parsed = taskInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { error } = await supabase.from("tasks").insert({
    organisation_id: organisation.id, title: parsed.title, detail: parsed.detail, status: parsed.status,
    owner_id: parsed.ownerId, due_on: parsed.dueOn, recurrence: parsed.recurrence, source: "manual",
    control_id: parsed.controlId, risk_id: parsed.riskId, created_by: user.id,
  });
  if (error) throw new Error("Could not save task");
  revalidatePath("/app/tasks"); redirect("/app/tasks");
}

export async function updateTaskStatusAction(formData: FormData) {
  const { supabase, user } = await requireAppContext();
  const status = String(formData.get("status"));
  if (!["open", "in_progress", "done", "cancelled"].includes(status)) throw new Error("Invalid task status");
  const id = String(formData.get("id"));
  const { data: task, error: readError } = await supabase.from("tasks")
    .select("id,organisation_id,title,detail,owner_id,due_on,recurrence,source,control_id,risk_id,status").eq("id", id).single();
  if (readError || !task) throw new Error("Task not found");
  const { error } = await supabase.from("tasks").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update task");
  if (status === "done" && task.status !== "done" && task.recurrence && task.due_on) {
    await supabase.from("tasks").insert({
      organisation_id: task.organisation_id, title: task.title, detail: task.detail, owner_id: task.owner_id,
      due_on: nextDueDate(task.due_on, task.recurrence as TaskRecurrence), recurrence: task.recurrence,
      source: task.source, control_id: task.control_id, risk_id: task.risk_id, created_by: user.id,
    });
  }
  revalidatePath("/app/tasks"); revalidatePath("/app");
}

export async function createGapTaskAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`task:${user.id}`, { limit: 30, windowMs: 60_000 });
  const questionId = String(formData.get("questionId"));
  const parsed = gapTaskInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  const { data: question } = await supabase.from("catalogue_questions").select("prompt,remediation").eq("id", questionId).single();
  if (!question) throw new Error("Suggestion not found");
  const { data: acm } = await supabase.from("assessment_control_mappings").select("control_id").eq("catalogue_question_id", questionId).limit(1).maybeSingle();
  let controlId: string | null = null;
  if (acm) {
    const { data: rcm } = await supabase.from("requirement_control_mappings").select("control_id").eq("requirement_id", acm.control_id).limit(1).maybeSingle();
    controlId = rcm?.control_id ?? null;
  }
  const { error } = await supabase.from("tasks").insert({
    organisation_id: organisation.id, title: parsed.title, detail: parsed.detail,
    owner_id: parsed.ownerId, due_on: parsed.dueOn, source: "gap", control_id: controlId, created_by: user.id,
  });
  if (error) throw new Error("Could not accept task suggestion");
  revalidatePath("/app/tasks"); revalidatePath("/app/risks"); redirect("/app/tasks");
}

export async function acceptCalendarSeedAction() {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`task-seed:${user.id}`, { limit: 3, windowMs: 60_000 });
  const { data: items } = await supabase.from("task_catalogue_items").select("title,detail,recurrence").order("position");
  if (!items?.length) throw new Error("No starter calendar is available");
  const { error } = await supabase.from("tasks").insert(items.map((item) => ({
    organisation_id: organisation.id, title: item.title, detail: item.detail, source: "system" as const,
    recurrence: item.recurrence, due_on: nextDueDate(today(), item.recurrence as TaskRecurrence), created_by: user.id,
  })));
  if (error) throw new Error("Could not add the starter calendar");
  revalidatePath("/app/tasks"); redirect("/app/tasks");
}
```

- [ ] **Step 6: Write the tasks pages**

Create `src/app/app/tasks/page.tsx`:

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { acceptCalendarSeedAction, updateTaskStatusAction } from "./actions";

const FILTERS = ["all", "open", "in_progress", "done", "cancelled", "overdue"] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = "all" } = await searchParams;
  const { supabase } = await requireAppContext();
  let query = supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,profiles:owner_id(display_name)").order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  if (filter !== "all" && filter !== "overdue") query = query.eq("status", filter);
  const { data } = await query;
  const today = new Date().toISOString().slice(0, 10);
  const tasks = (data ?? []).filter((t) => filter !== "overdue" || isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today));
  return <main className="mx-auto max-w-6xl px-6 py-10">
    <div className="flex justify-between"><div><h1 className="text-3xl font-bold">Tasks</h1><p className="mt-2 text-slate-600">Owned, dated remediation work driving your readiness.</p></div><Link href="/app/tasks/new" className="rounded bg-blue-600 px-4 py-2 text-white">New task</Link></div>
    <nav aria-label="Task filters" className="mt-6 flex gap-2 text-sm">{FILTERS.map((f) => <Link key={f} href={`/app/tasks?filter=${f}`} aria-current={filter === f ? "page" : undefined} className={`rounded-full border px-3 py-1 capitalize ${filter === f ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300"}`}>{f.replace("_", " ")}</Link>)}</nav>
    {!data?.length && <section className="mt-8 rounded-xl border border-blue-200 bg-blue-50 p-5"><h2 className="font-semibold">Start with the compliance calendar</h2><p className="mt-1 text-sm text-slate-600">Add recurring access reviews, policy reviews, and backup restore tests in one click.</p><form action={acceptCalendarSeedAction}><button className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm text-white">Add starter calendar</button></form></section>}
    <div className="mt-8 overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{["Task", "Owner", "Due", "Recurs", "Source", "Status"].map((h) => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>
      {tasks.map((t) => { const owner = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles; const overdue = isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today); return <tr key={t.id} className="border-t">
        <td className="p-3"><b>{t.title}</b>{t.detail && <><br /><span className="text-slate-500">{t.detail}</span></>}</td>
        <td className="p-3">{owner?.display_name ?? "Unassigned"}</td>
        <td className="p-3">{t.due_on ?? "—"}{overdue && <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Overdue</span>}</td>
        <td className="p-3 capitalize">{t.recurrence ?? "—"}</td><td className="p-3 capitalize">{t.source.replaceAll("_", " ")}</td>
        <td className="p-3"><form action={updateTaskStatusAction}><input type="hidden" name="id" value={t.id} /><select name="status" defaultValue={t.status} aria-label={`Status for ${t.title}`} className="rounded border px-2 py-1"><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select><button className="ml-2 text-blue-700">Save</button></form></td>
      </tr>; })}
      {!tasks.length && <tr><td className="p-4 text-slate-500" colSpan={6}>No tasks match this filter.</td></tr>}
    </tbody></table></div>
  </main>;
}
```

Create `src/app/app/tasks/new/page.tsx`:

```tsx
import { requireAppContext } from "@/lib/app-context";
import { createTaskAction } from "../actions";

export default async function NewTaskPage() {
  const { supabase } = await requireAppContext();
  const [{ data: members }, { data: controls }, { data: risks }] = await Promise.all([
    supabase.from("memberships").select("user_id,profiles(display_name)"),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("risks").select("id,reference,title").neq("status", "closed").order("reference"),
  ]);
  return <main className="mx-auto max-w-3xl px-6 py-10"><h1 className="text-3xl font-bold">New task</h1>
    <form action={createTaskAction} className="mt-8 space-y-4 rounded-xl border bg-white p-6">
      <label className="block text-sm font-medium">Title<input name="title" required maxLength={200} className="mt-1 w-full rounded border p-2" /></label>
      <label className="block text-sm font-medium">Detail<textarea name="detail" maxLength={10000} className="mt-1 w-full rounded border p-2" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Owner<select name="ownerId" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label className="block text-sm font-medium">Due date<input name="dueOn" type="date" className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm font-medium">Recurrence<select name="recurrence" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">One-off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></label>
        <label className="block text-sm font-medium">Linked control<select name="controlId" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">None</option>{controls?.map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title}</option>)}</select></label>
        <label className="block text-sm font-medium">Linked risk<select name="riskId" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">None</option>{risks?.map((r) => <option key={r.id} value={r.id}>{r.reference}: {r.title}</option>)}</select></label>
      </div>
      <button className="rounded bg-blue-600 px-4 py-2 text-white">Create task</button>
    </form>
  </main>;
}
```

- [ ] **Step 7: Wire navigation, gap suggestions, and dashboard tile**

In `src/app/app/layout.tsx`, extend the nav (keep existing links, insert after Risks):

```tsx
<nav aria-label="Workspace" className="flex max-w-[55vw] gap-3 overflow-x-auto text-xs md:max-w-none md:gap-5 md:text-sm"><Link href="/app/assessment">Assessment</Link><Link href="/app/soa">SoA</Link><Link href="/app/risks">Risks</Link><Link href="/app/tasks">Tasks</Link><Link href="/app/activity">Activity</Link><Link href="/app/settings">Settings</Link></nav>
```

In `src/app/app/risks/page.tsx`, replace the immediate task mutation with a link to the pre-filled confirmation route. This preserves the one-click suggestion while requiring the owner and date needed by the Phase 1 exit criterion:

```tsx
{gaps?.map(g=>{const q=Array.isArray(g.catalogue_questions)?g.catalogue_questions[0]:g.catalogue_questions;return <div key={`${g.session_id}-${g.question_id}`} className="mt-3 flex justify-between gap-4"><span>{q?.code}: {q?.prompt}</span><span className="flex shrink-0 gap-4"><form action={acceptRiskSuggestionAction}><input type="hidden" name="questionId" value={g.question_id}/><input type="hidden" name="sessionId" value={g.session_id}/><button className="text-blue-700">Accept as risk</button></form><Link className="text-blue-700" href={`/app/tasks/from-gap?questionId=${g.question_id}`}>Accept as task</Link></span></div>})}
```

Create `src/app/app/tasks/from-gap/page.tsx`. Read and validate `questionId`, load the catalogue question and its mapped shared control, and render a form posting to `createGapTaskAction`. Pre-fill readonly `title` (`Close gap: …`) and `detail` from the remediation, include hidden `questionId`, and require an `ownerId` membership select and `dueOn` date input. A missing or inaccessible question calls `notFound()`.

Create `src/app/app/tasks/[id]/page.tsx`. Load the RLS-scoped task with owner, control, risk, and linked evidence; render status, owner, due date, recurrence, source, detail, and links. Change every task title in `/app/tasks` to link to this detail route. On `src/app/app/risks/page.tsx`, query open tasks by `risk_id` and render a compact “Linked tasks” list in each risk row. On `src/app/app/soa/page.tsx`, map each requirement through `requirement_control_mappings`, query tasks by shared `control_id`, and show an open-task count/link beside each control.

In `src/app/app/page.tsx`, add an open-tasks count to the `Promise.all` and a fourth tile (change `sm:grid-cols-3` to `sm:grid-cols-2 lg:grid-cols-4`):

```tsx
const [{ count: assessments }, { count: risks }, { count: snapshots }, { count: openTasks }, { data: activity }] = await Promise.all([
  supabase.from("assessment_sessions").select("id", { count: "exact", head: true }),
  supabase.from("risks").select("id", { count: "exact", head: true }).neq("status", "closed"),
  supabase.from("soa_snapshots").select("id", { count: "exact", head: true }),
  supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
  supabase.from("audit_events").select("id,action,entity_type,occurred_at").order("occurred_at", { ascending: false }).limit(5),
]);
```

and in the tiles array add `["Open tasks", openTasks, "/app/tasks"]`.

- [ ] **Step 8: Add focused tests for owned, dated gap creation and task widgets**

Extend `task.test.ts` with a `gapTaskInputSchema` test that rejects a missing owner or due date and accepts both. Add Playwright assertions in Task 13 that the gap link opens a pre-filled form, requires owner/date, creates a `source=gap` task, and that the task appears on its linked SoA control and risk when linked.

- [ ] **Step 9: Verify build, lint, and tests**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: no errors, all vitest suites pass.

- [ ] **Step 10: Commit**

```bash
git add src/features/tasks src/app/app/tasks src/app/app/layout.tsx src/app/app/risks/page.tsx src/app/app/soa/page.tsx src/app/app/page.tsx
git commit -m "feat: add tasks workflow (create, recur, gap-to-task, starter calendar, dashboard tile)"
```

---

### Task 5: Evidence domain logic (§4.2) — status derivation

**Files:**
- Create: `src/features/evidence/domain/evidence.ts`
- Test: `src/features/evidence/domain/evidence.test.ts`

**Interfaces:**
- Consumes: nothing (pure domain).
- Produces:
  - `type EvidenceStatus = "current" | "expiring" | "expired" | "superseded" | "withdrawn"`
  - `type EvidenceKind = "file" | "link" | "note"`
  - `EXPIRY_WARNING_DAYS = 30`
  - `deriveEvidenceStatus(validUntil: string | null, today: string): "current" | "expiring" | "expired"`
  - `summariseEvidenceFreshness(items: readonly { status: EvidenceStatus }[]): { total: number; expiring: number; expired: number }`

- [ ] **Step 1: Write the failing tests**

Create `src/features/evidence/domain/evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveEvidenceStatus, summariseEvidenceFreshness } from "./evidence";

describe("deriveEvidenceStatus", () => {
  it("treats evidence without an expiry as always current", () => {
    expect(deriveEvidenceStatus(null, "2026-07-02")).toBe("current");
  });
  it("marks evidence expiring within the 30-day window", () => {
    expect(deriveEvidenceStatus("2026-08-01", "2026-07-02")).toBe("expiring");
    expect(deriveEvidenceStatus("2026-07-02", "2026-07-02")).toBe("expiring");
  });
  it("marks evidence current outside the window and expired past it", () => {
    expect(deriveEvidenceStatus("2026-08-02", "2026-07-02")).toBe("current");
    expect(deriveEvidenceStatus("2026-07-01", "2026-07-02")).toBe("expired");
  });
  it("rejects malformed dates", () => {
    expect(() => deriveEvidenceStatus("01/07/2026", "2026-07-02")).toThrow(/ISO date/);
  });
});

describe("summariseEvidenceFreshness", () => {
  it("counts totals and stale items, ignoring superseded and withdrawn", () => {
    expect(summariseEvidenceFreshness([
      { status: "current" }, { status: "expiring" }, { status: "expired" }, { status: "superseded" }, { status: "withdrawn" },
    ])).toEqual({ total: 3, expiring: 1, expired: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/evidence/domain/evidence.test.ts`
Expected: FAIL — cannot resolve `./evidence`.

- [ ] **Step 3: Write the implementation**

Create `src/features/evidence/domain/evidence.ts`:

```ts
export type EvidenceStatus = "current" | "expiring" | "expired" | "superseded" | "withdrawn";
export type EvidenceKind = "file" | "link" | "note";
export const EXPIRY_WARNING_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function deriveEvidenceStatus(validUntil: string | null, today: string): "current" | "expiring" | "expired" {
  if (!ISO_DATE.test(today) || (validUntil !== null && !ISO_DATE.test(validUntil))) {
    throw new RangeError("Dates must be ISO dates (YYYY-MM-DD)");
  }
  if (validUntil === null) return "current";
  if (validUntil < today) return "expired";
  if (validUntil <= addDays(today, EXPIRY_WARNING_DAYS)) return "expiring";
  return "current";
}

export function summariseEvidenceFreshness(items: readonly { status: EvidenceStatus }[]) {
  const live = items.filter((item) => item.status !== "superseded" && item.status !== "withdrawn");
  return {
    total: live.length,
    expiring: live.filter((item) => item.status === "expiring").length,
    expired: live.filter((item) => item.status === "expired").length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/evidence/domain/evidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/evidence/domain
git commit -m "feat: add evidence domain logic (status derivation, freshness summary)"
```

---

### Task 6: Evidence vault — migration, storage bucket, pgTAP

**Files:**
- Create: `supabase/migrations/202607020007_evidence.sql`
- Test: `supabase/tests/database/008_evidence.sql`

**Interfaces:**
- Consumes: `public.controls(id)` (Task 1), `public.tasks` `unique (id, organisation_id)` (Task 3), `public.risks` `unique (id, organisation_id)` (Task 3), `public.task_recurrence` enum (reused for `review_interval`).
- Produces: enums `public.evidence_kind`, `public.evidence_status`; tables `public.evidence` (immutable except guarded `status` transitions; never deleted) and `public.evidence_links` (exactly one of `control_id`/`risk_id`/`task_id`); `public.tasks.evidence_id` column; private storage bucket `evidence` with per-org-prefix policies (path convention `<organisation_id>/<uuid>/<filename>`, 25 MB, fixed mime allowlist).

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/008_evidence.sql`:

```sql
begin;
select plan(9);

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
insert into public.evidence (id, organisation_id, title, kind, url, created_by) values
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'MFA policy screenshot link', 'link', 'https://example.test/mfa', '10000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Tenant B evidence', 'link', 'https://example.test/b', '10000000-0000-4000-8000-000000000002');

select throws_ok(
  $$ insert into public.evidence (organisation_id, title, kind, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'file without path', 'file', '10000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'file evidence requires a storage path');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq($$ select title from public.evidence $$, $$ values ('MFA policy screenshot link'::text) $$, 'members only see their own tenant evidence');
select throws_ok(
  $$ update public.evidence set title = 'tampered' where id = '80000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'evidence core fields are immutable to clients');
select lives_ok(
  $$ update public.evidence set status = 'withdrawn' where id = '80000000-0000-4000-8000-000000000001' $$,
  'members can withdraw their evidence');
select throws_ok(
  $$ update public.evidence set status = 'current' where id = '80000000-0000-4000-8000-000000000001' $$,
  'P0001', null, 'withdrawn evidence cannot be resurrected');
select throws_ok($$ delete from public.evidence $$, '42501', null, 'clients can never delete evidence');
select throws_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'an evidence link must target exactly one entity');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('evidence', '20000000-0000-4000-8000-000000000002/upload.pdf') $$,
  '42501', null, 'members cannot upload into another tenant storage prefix');
reset role;
select is(
  (select count(*) from public.audit_events where entity_type = 'evidence' and organisation_id = '20000000-0000-4000-8000-000000000001'),
  2::bigint, 'evidence writes are audited');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase db reset && npx supabase test db`
Expected: `008_evidence` FAILs (relation `public.evidence` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/202607020007_evidence.sql`:

```sql
-- §4.2 evidence vault. Evidence records are immutable after creation apart
-- from guarded status transitions; superseding evidence creates a new record.
-- Files live in the private `evidence` bucket under an organisation prefix.

create type public.evidence_kind as enum ('file', 'link', 'note');
create type public.evidence_status as enum ('current', 'expiring', 'expired', 'superseded', 'withdrawn');

create table public.evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  kind public.evidence_kind not null,
  storage_path text check (storage_path is null or char_length(storage_path) <= 1024),
  url text check (url is null or url ~ '^https?://'),
  description text not null default '' check (char_length(description) <= 10000),
  owner_id uuid references public.profiles(id) on delete set null,
  collected_on date not null default current_date,
  valid_until date,
  review_interval public.task_recurrence,
  status public.evidence_status not null default 'current',
  replaces_evidence_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (id, organisation_id),
  constraint evidence_owner_tenant_fk foreign key (organisation_id, owner_id)
    references public.memberships(organisation_id, user_id) on delete set null (owner_id),
  constraint evidence_replaces_tenant_fk foreign key (replaces_evidence_id, organisation_id)
    references public.evidence(id, organisation_id) on delete restrict,
  check (
    (kind = 'file' and storage_path is not null and url is null)
    or (kind = 'link' and url is not null and storage_path is null)
    or (kind = 'note' and storage_path is null and url is null)
  )
);
create index evidence_org_status_idx on public.evidence(organisation_id, status, valid_until);

create table public.evidence_links (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  evidence_id uuid not null,
  control_id uuid references public.controls(id) on delete restrict,
  risk_id uuid,
  task_id uuid,
  policy_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint evidence_links_evidence_tenant_fk foreign key (evidence_id, organisation_id)
    references public.evidence(id, organisation_id) on delete cascade,
  constraint evidence_links_risk_tenant_fk foreign key (risk_id, organisation_id)
    references public.risks(id, organisation_id) on delete cascade,
  constraint evidence_links_task_tenant_fk foreign key (task_id, organisation_id)
    references public.tasks(id, organisation_id) on delete cascade,
  constraint evidence_links_policy_deferred check (policy_id is null),
  check (num_nonnulls(control_id, risk_id, task_id, policy_id) = 1),
  unique (evidence_id, control_id),
  unique (evidence_id, risk_id),
  unique (evidence_id, task_id),
  unique (evidence_id, policy_id)
);

alter table public.tasks add column evidence_id uuid;
alter table public.tasks add constraint tasks_evidence_tenant_fk foreign key (evidence_id, organisation_id)
  references public.evidence(id, organisation_id) on delete set null (evidence_id);
alter table public.tasks add constraint tasks_evidence_source_key
  unique (organisation_id, evidence_id, source);

-- Immutable core: only status may change, and only along the audit-honest
-- lifecycle (fresh -> stale by the sweep; anything live -> superseded/withdrawn).
create or replace function public.evidence_guard_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'evidence records are immutable except for status';
  end if;
  if new.status = old.status then return new; end if;
  if old.status in ('superseded', 'withdrawn') then
    raise exception 'superseded or withdrawn evidence cannot change status';
  end if;
  if new.status not in ('expiring', 'expired', 'superseded', 'withdrawn') then
    raise exception 'invalid evidence status transition';
  end if;
  return new;
end $$;
create trigger evidence_guard_update before update on public.evidence
for each row execute function public.evidence_guard_update();
create trigger evidence_no_delete before delete on public.evidence
for each statement execute function public.reject_immutable_change('evidence is never deleted; supersede or withdraw it');

create trigger evidence_audit after insert or update on public.evidence
for each row execute function public.capture_audit_event();
create trigger evidence_links_audit after insert or update or delete on public.evidence_links
for each row execute function public.capture_audit_event();

alter table public.evidence enable row level security;
alter table public.evidence_links enable row level security;
create policy evidence_members_select on public.evidence for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy evidence_members_insert on public.evidence for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy evidence_members_update on public.evidence for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy evidence_links_members_select on public.evidence_links for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy evidence_links_members_insert on public.evidence_links for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy evidence_links_members_delete on public.evidence_links for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.evidence, public.evidence_links from anon, authenticated;
grant select, insert on public.evidence to authenticated;
grant update (status) on public.evidence to authenticated;
grant select, insert, delete on public.evidence_links to authenticated;

-- Private storage bucket; path convention: <organisation_id>/<uuid>/<filename>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 26214400, array[
  'application/pdf', 'image/png', 'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain'
]);
create policy evidence_objects_members_select on storage.objects for select to authenticated
using (bucket_id = 'evidence' and public.is_organisation_member(((storage.foldername(name))[1])::uuid));
create policy evidence_objects_members_insert on storage.objects for insert to authenticated
with check (bucket_id = 'evidence' and public.is_organisation_member(((storage.foldername(name))[1])::uuid));
-- No update/delete policies: uploaded files are immutable to clients.

-- DB-atomic creation + supersession. RLS still applies because this is a
-- SECURITY INVOKER function. The application validates the JSON shape first.
create or replace function public.create_evidence_record(payload jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare created_id uuid;
begin
  insert into public.evidence (
    organisation_id, title, kind, storage_path, url, description, owner_id,
    collected_on, valid_until, review_interval, status, replaces_evidence_id, created_by
  ) values (
    (payload->>'organisation_id')::uuid, payload->>'title', (payload->>'kind')::public.evidence_kind,
    nullif(payload->>'storage_path',''), nullif(payload->>'url',''), coalesce(payload->>'description',''),
    nullif(payload->>'owner_id','')::uuid, (payload->>'collected_on')::date,
    nullif(payload->>'valid_until','')::date, nullif(payload->>'review_interval','')::public.task_recurrence,
    (payload->>'status')::public.evidence_status, nullif(payload->>'replaces_evidence_id','')::uuid,
    (select auth.uid())
  ) returning id into created_id;
  if nullif(payload->>'replaces_evidence_id','') is not null then
    update public.evidence set status = 'superseded'
    where id = (payload->>'replaces_evidence_id')::uuid
      and organisation_id = (payload->>'organisation_id')::uuid;
    if not found then raise exception 'replacement evidence not found'; end if;
  end if;
  return created_id;
end $$;
revoke all on function public.create_evidence_record(jsonb) from public;
grant execute on function public.create_evidence_record(jsonb) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db`
Expected: all files PASS, including `008_evidence` (9/9).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607020007_evidence.sql supabase/tests/database/008_evidence.sql
git commit -m "feat: add evidence vault schema, guarded immutability, and private storage bucket"
```

---

### Task 7: Evidence application layer + UI

**Files:**
- Create: `src/features/evidence/application/evidence.ts`
- Test: `src/features/evidence/application/evidence.test.ts`
- Create: `src/app/app/evidence/actions.ts`
- Create: `src/app/app/evidence/page.tsx`
- Create: `src/app/app/evidence/new/page.tsx`
- Create: `src/lib/supabase/service.ts` (needed for failed-upload compensation; reused by Task 10)
- Modify: `src/app/app/layout.tsx` (nav: add Evidence link after Tasks)
- Modify: `src/app/app/soa/page.tsx` (per-control evidence count and freshness)
- Modify: `src/app/app/risks/page.tsx` (linked evidence count and freshness)

**Interfaces:**
- Consumes: `deriveEvidenceStatus`, `EvidenceKind` from `@/features/evidence/domain/evidence`; `requireAppContext`; `enforceRateLimit`; tables `evidence`, `evidence_links`, `controls`, `risks`, `tasks`; storage bucket `evidence`.
- Produces: `evidenceInputSchema`, `ALLOWED_EVIDENCE_MIME_TYPES`, `MAX_EVIDENCE_FILE_BYTES` (application); server actions `createEvidenceAction`, `linkEvidenceAction`, `unlinkEvidenceAction`, `withdrawEvidenceAction`, `downloadEvidenceAction`; route `/app/evidence`.
- Persistence invariant: creation and optional supersession use `create_evidence_record(jsonb)` as one DB transaction. If a file upload succeeds but the RPC fails, the server-only service client removes the orphaned object before returning an error.

- [ ] **Step 1: Write the failing schema test**

Create `src/features/evidence/application/evidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALLOWED_EVIDENCE_MIME_TYPES, MAX_EVIDENCE_FILE_BYTES, evidenceInputSchema } from "./evidence";

describe("evidenceInputSchema", () => {
  it("accepts link evidence with a URL and rejects link evidence without one", () => {
    const parsed = evidenceInputSchema.parse({
      organisationId: "5b60cbd6-9f6f-4b1e-9a3f-1af1c9a1a111", title: "SSO configuration", kind: "link", url: "https://example.test/sso",
    });
    expect(parsed.url).toBe("https://example.test/sso");
    expect(() => evidenceInputSchema.parse({ organisationId: "5b60cbd6-9f6f-4b1e-9a3f-1af1c9a1a111", title: "T", kind: "link", url: "" })).toThrow();
  });
  it("accepts note evidence and normalises empty optionals", () => {
    const parsed = evidenceInputSchema.parse({
      organisationId: "5b60cbd6-9f6f-4b1e-9a3f-1af1c9a1a111", title: "Access review note", kind: "note", validUntil: "", ownerId: "", reviewInterval: "",
    });
    expect(parsed.validUntil).toBeNull();
    expect(parsed.reviewInterval).toBeNull();
  });
  it("publishes the upload constraints used by the storage bucket", () => {
    expect(MAX_EVIDENCE_FILE_BYTES).toBe(26214400);
    expect(ALLOWED_EVIDENCE_MIME_TYPES).toContain("application/pdf");
  });
  it("removes an uploaded object when the atomic evidence RPC fails", async () => {
    const removed: string[] = [];
    await expect(persistEvidenceWithCompensation({ storagePath: "org/id/file.pdf" }, {
      createRecord: async () => { throw new Error("db failed"); },
      removeUpload: async (path) => { removed.push(path); },
    })).rejects.toThrow("db failed");
    expect(removed).toEqual(["org/id/file.pdf"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/evidence/application/evidence.test.ts`
Expected: FAIL — cannot resolve `./evidence`.

- [ ] **Step 3: Write the application module**

Create `src/features/evidence/application/evidence.ts`:

```ts
import { z } from "zod";

export const MAX_EVIDENCE_FILE_BYTES = 26_214_400; // 25 MB, mirrors the bucket limit
export const ALLOWED_EVIDENCE_MIME_TYPES = [
  "application/pdf", "image/png", "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv", "text/plain",
] as const;

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional()
  .transform((value) => (value ? value : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional()
  .transform((value) => (value ? value : null));

export const evidenceInputSchema = z.object({
  organisationId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["file", "link", "note"]),
  url: z.union([z.url(), z.literal("")]).optional().transform((value) => (value ? value : null)),
  description: z.string().max(10_000).default(""),
  ownerId: optionalUuid,
  collectedOn: optionalDate,
  validUntil: optionalDate,
  reviewInterval: z.union([z.enum(["weekly", "monthly", "quarterly", "semiannually", "annually"]), z.literal("")]).optional()
    .transform((value) => (value ? value : null)),
  replacesEvidenceId: optionalUuid,
}).refine((value) => value.kind !== "link" || value.url !== null, { message: "Link evidence requires a URL" });
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;

export async function persistEvidenceWithCompensation(
  payload: Record<string, unknown> & { storagePath: string | null },
  deps: { createRecord: (payload: Record<string, unknown>) => Promise<string>; removeUpload: (path: string) => Promise<void> },
) {
  try { return await deps.createRecord(payload); }
  catch (error) {
    if (payload.storagePath) await deps.removeUpload(payload.storagePath);
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/evidence/application/evidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the server-only service client and server actions**

Create `src/lib/supabase/service.ts` now using the implementation shown in Task 10. Keep its `server-only` import. Task 10 reuses this file rather than creating it later.

Create `src/app/app/evidence/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ALLOWED_EVIDENCE_MIME_TYPES, MAX_EVIDENCE_FILE_BYTES, evidenceInputSchema, persistEvidenceWithCompensation } from "@/features/evidence/application/evidence";
import { deriveEvidenceStatus } from "@/features/evidence/domain/evidence";

export async function createEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`evidence:${user.id}`, { limit: 20, windowMs: 60_000 });
  const parsed = evidenceInputSchema.parse({ ...Object.fromEntries(formData), organisationId: organisation.id });
  let storagePath: string | null = null;
  if (parsed.kind === "file") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) redirect("/app/evidence/new?message=Choose%20a%20file%20to%20upload.");
    if (file.size > MAX_EVIDENCE_FILE_BYTES) redirect("/app/evidence/new?message=Files%20must%20be%2025%20MB%20or%20smaller.");
    if (!(ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) redirect("/app/evidence/new?message=That%20file%20type%20is%20not%20supported.");
    storagePath = `${organisation.id}/${crypto.randomUUID()}/${file.name.replace(/[^\w.\-]+/g, "_").slice(-120)}`;
    const { error: uploadError } = await supabase.storage.from("evidence").upload(storagePath, file, { contentType: file.type });
    if (uploadError) redirect("/app/evidence/new?message=Could%20not%20upload%20the%20file.");
  }
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    organisation_id: organisation.id, title: parsed.title, kind: parsed.kind, storage_path: storagePath,
    url: parsed.kind === "link" ? parsed.url : null, description: parsed.description, owner_id: parsed.ownerId,
    collected_on: parsed.collectedOn ?? today, valid_until: parsed.validUntil, review_interval: parsed.reviewInterval,
    status: deriveEvidenceStatus(parsed.validUntil, today), replaces_evidence_id: parsed.replacesEvidenceId,
  };
  await persistEvidenceWithCompensation({ ...payload, storagePath }, {
    createRecord: async (record) => {
      const { data, error } = await supabase.rpc("create_evidence_record", { payload: record });
      if (error) throw error; return data as string;
    },
    removeUpload: async (path) => {
      const { error } = await createSupabaseServiceClient().storage.from("evidence").remove([path]);
      if (error) throw new AggregateError([error], "Evidence save and upload compensation both failed");
    },
  });
  revalidatePath("/app/evidence"); redirect("/app/evidence");
}

export async function linkEvidenceAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  const evidenceId = String(formData.get("evidenceId"));
  const target = String(formData.get("target")); // "control:<id>" | "risk:<id>" | "task:<id>"
  const [kind, id] = target.split(":");
  if (!id || !["control", "risk", "task"].includes(kind)) throw new Error("Invalid link target");
  const { error } = await supabase.from("evidence_links").insert({
    organisation_id: organisation.id, evidence_id: evidenceId,
    control_id: kind === "control" ? id : null, risk_id: kind === "risk" ? id : null, task_id: kind === "task" ? id : null,
    created_by: user.id,
  });
  if (error) throw new Error("Could not link evidence");
  revalidatePath("/app/evidence");
}

export async function unlinkEvidenceAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  await supabase.from("evidence_links").delete().eq("id", String(formData.get("linkId")));
  revalidatePath("/app/evidence");
}

export async function withdrawEvidenceAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const { error } = await supabase.from("evidence").update({ status: "withdrawn" }).eq("id", String(formData.get("id")));
  if (error) throw new Error("Could not withdraw evidence");
  revalidatePath("/app/evidence");
}

export async function downloadEvidenceAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  const { data: item } = await supabase.from("evidence").select("storage_path").eq("id", String(formData.get("id"))).single();
  if (!item?.storage_path) throw new Error("Evidence file not found");
  const { data, error } = await supabase.storage.from("evidence").createSignedUrl(item.storage_path, 60);
  if (error || !data) throw new Error("Could not create a download link");
  redirect(data.signedUrl);
}
```

- [ ] **Step 6: Write the evidence pages**

Create `src/app/app/evidence/page.tsx`:

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { downloadEvidenceAction, linkEvidenceAction, unlinkEvidenceAction, withdrawEvidenceAction } from "./actions";

const TONE: Record<string, string> = { current: "bg-emerald-100 text-emerald-800", expiring: "bg-amber-100 text-amber-800", expired: "bg-red-100 text-red-700", superseded: "bg-slate-200 text-slate-600", withdrawn: "bg-slate-200 text-slate-600" };

export default async function EvidencePage() {
  const { supabase } = await requireAppContext();
  const [{ data: items }, { data: controls }] = await Promise.all([
    supabase.from("evidence").select("id,title,kind,url,storage_path,status,collected_on,valid_until,evidence_links(id,control_id,risk_id,task_id,controls(code,title),risks(reference),tasks(title))").order("created_at", { ascending: false }),
    supabase.from("controls").select("id,code,title").order("position"),
  ]);
  return <main className="mx-auto max-w-6xl px-6 py-10">
    <div className="flex justify-between"><div><h1 className="text-3xl font-bold">Evidence vault</h1><p className="mt-2 text-slate-600">Attach proof to controls, risks, and tasks — freshness is tracked daily.</p></div><Link href="/app/evidence/new" className="rounded bg-blue-600 px-4 py-2 text-white">Add evidence</Link></div>
    <div className="mt-8 space-y-4">{items?.map((item) => <section key={item.id} className="rounded-xl border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">{item.title}</h2><p className="text-sm text-slate-500">Collected {item.collected_on}{item.valid_until && ` · valid until ${item.valid_until}`}</p></div>
        <div className="flex items-center gap-3"><span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${TONE[item.status]}`}>{item.status}</span>
          {item.kind === "link" && item.url && <a className="text-sm text-blue-700" href={item.url} rel="noreferrer" target="_blank">Open link</a>}
          {item.kind === "file" && <form action={downloadEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="text-sm text-blue-700">Download</button></form>}
          {(item.status === "current" || item.status === "expiring" || item.status === "expired") && <><Link className="text-sm text-blue-700" href={`/app/evidence/new?replaces=${item.id}`}>Supersede</Link><form action={withdrawEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="text-sm text-red-700">Withdraw</button></form></>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {item.evidence_links?.map((link) => { const c = Array.isArray(link.controls) ? link.controls[0] : link.controls; const r = Array.isArray(link.risks) ? link.risks[0] : link.risks; const t = Array.isArray(link.tasks) ? link.tasks[0] : link.tasks; return <span key={link.id} className="inline-flex items-center gap-1 rounded-full border px-3 py-1">{c ? `${c.code}: ${c.title}` : r ? `Risk ${r.reference}` : `Task: ${t?.title}`}<form action={unlinkEvidenceAction}><input type="hidden" name="linkId" value={link.id} /><button aria-label="Remove link" className="text-slate-400">×</button></form></span>; })}
        <form action={linkEvidenceAction} className="inline-flex items-center gap-2"><input type="hidden" name="evidenceId" value={item.id} /><select name="target" defaultValue="" aria-label={`Link ${item.title} to a control`} className="rounded border px-2 py-1"><option value="" disabled>Link to control…</option>{controls?.map((c) => <option key={c.id} value={`control:${c.id}`}>{c.code}: {c.title}</option>)}</select><button className="text-blue-700">Link</button></form>
      </div>
    </section>)}
    {!items?.length && <p className="mt-8 rounded-xl border bg-white p-6 text-slate-500">No evidence yet. Add your first item to start tracking freshness.</p>}
    </div>
  </main>;
}
```

Create `src/app/app/evidence/new/page.tsx`:

```tsx
import { requireAppContext } from "@/lib/app-context";
import { createEvidenceAction } from "../actions";

export default async function NewEvidencePage({ searchParams }: { searchParams: Promise<{ replaces?: string; message?: string }> }) {
  const { replaces, message } = await searchParams;
  const { supabase } = await requireAppContext();
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  return <main className="mx-auto max-w-3xl px-6 py-10"><h1 className="text-3xl font-bold">Add evidence</h1>
    {message && <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{message}</p>}
    <form action={createEvidenceAction} className="mt-8 space-y-4 rounded-xl border bg-white p-6">
      {replaces && <input type="hidden" name="replacesEvidenceId" value={replaces} />}
      <label className="block text-sm font-medium">Title<input name="title" required maxLength={200} className="mt-1 w-full rounded border p-2" /></label>
      <label className="block text-sm font-medium">Kind<select name="kind" defaultValue="file" className="mt-1 w-full rounded border p-2"><option value="file">File upload</option><option value="link">Link</option><option value="note">Note</option></select></label>
      <label className="block text-sm font-medium">File (PDF, PNG, JPG, DOCX, XLSX, CSV, TXT — max 25 MB)<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" className="mt-1 w-full rounded border p-2" /></label>
      <label className="block text-sm font-medium">URL (for link evidence)<input name="url" type="url" placeholder="https://" className="mt-1 w-full rounded border p-2" /></label>
      <label className="block text-sm font-medium">Description<textarea name="description" maxLength={10000} className="mt-1 w-full rounded border p-2" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Owner<select name="ownerId" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label className="block text-sm font-medium">Collected on<input name="collectedOn" type="date" className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm font-medium">Valid until<input name="validUntil" type="date" className="mt-1 w-full rounded border p-2" /></label>
        <label className="block text-sm font-medium">Review interval<select name="reviewInterval" defaultValue="" className="mt-1 w-full rounded border p-2"><option value="">None</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></label>
      </div>
      <button className="rounded bg-blue-600 px-4 py-2 text-white">Save evidence</button>
    </form>
  </main>;
}
```

- [ ] **Step 7: Add the nav link**

Add Evidence after Tasks. Then extend `src/app/app/soa/page.tsx`: map each displayed requirement through `requirement_control_mappings`, query its linked evidence, call `summariseEvidenceFreshness`, and render “N items, M expiring in 14 days” beside the control. Apply the same summary to each risk row in `src/app/app/risks/page.tsx`. Add assertions for zero/current/expiring/expired combinations; Task 13 verifies the text after linking evidence.

In `src/app/app/layout.tsx`, insert `<Link href="/app/evidence">Evidence</Link>` immediately after the Tasks link added in Task 4.

- [ ] **Step 8: Verify build, lint, and tests**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: no errors, all suites pass.

- [ ] **Step 9: Commit**

```bash
git add src/features/evidence/application src/lib/supabase/service.ts src/app/app/evidence src/app/app/layout.tsx src/app/app/soa/page.tsx src/app/app/risks/page.tsx
git commit -m "feat: add evidence vault workflows (upload, link, supersede, withdraw, signed downloads)"
```

---

### Task 8: Notifications — migration + pgTAP

**Files:**
- Create: `supabase/migrations/202607020008_notifications.sql`
- Test: `supabase/tests/database/009_notifications.sql`

**Interfaces:**
- Consumes: `public.memberships`, `public.capture_audit_event()`.
- Produces: `public.notifications` table — clients can only read their own rows and mark them read; only the service role inserts. A full unique constraint on `(user_id, kind, subject_type, subject_id, sweep_on)` makes same-day retries/concurrent sweeps safely idempotent and is directly targetable by PostgREST `onConflict`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/009_notifications.sql`:

```sql
begin;
select plan(6);

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
insert into public.notifications (organisation_id, user_id, kind, subject_type, subject_id, message) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'task_overdue', 'tasks', 'abc', 'Task is overdue'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'task_overdue', 'tasks', 'def', 'Task is overdue');

select throws_ok(
  $$ insert into public.notifications (organisation_id, user_id, kind, subject_type, subject_id, message)
     values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'task_overdue', 'tasks', 'abc', 'duplicate unread') $$,
  '23505', null, 'same-day notifications deduplicate per user and subject');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.notifications), 1::bigint, 'users only see their own notifications');
select throws_ok(
  $$ insert into public.notifications (organisation_id, user_id, kind, subject_type, subject_id, message)
     values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'task_overdue', 'tasks', 'zzz', 'forged') $$,
  '42501', null, 'clients cannot create notifications');
select lives_ok($$ update public.notifications set read_at = now() $$, 'users can mark their notifications read');
select throws_ok($$ delete from public.notifications $$, '42501', null, 'clients cannot delete notifications');
reset role;
select is((select count(*) from public.audit_events where entity_type = 'notifications' and action = 'update'), 1::bigint, 'marking a notification read is audited');

select * from finish();
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx supabase db reset && npx supabase test db`
Expected: `009_notifications` FAILs (relation `public.notifications` does not exist).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/202607020008_notifications.sql`:

```sql
-- §4.3 in-app notifications. Written only by the daily sweep (service role);
-- users read their own rows and mark them read. Email digests are deferred.

create table public.notifications (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 80),
  subject_type text not null check (char_length(subject_type) between 1 and 80),
  subject_id text not null check (char_length(subject_id) <= 128),
  message text not null check (char_length(message) between 1 and 500),
  sweep_on date not null default current_date,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_membership_fk foreign key (organisation_id, user_id)
    references public.memberships(organisation_id, user_id) on delete cascade
);
create index notifications_user_unread_idx on public.notifications(user_id) where read_at is null;
alter table public.notifications add constraint notifications_dedup_day_key
  unique (user_id, kind, subject_type, subject_id, sweep_on);

create trigger notifications_audit after insert or update on public.notifications
for each row execute function public.capture_audit_event();

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npx supabase test db`
Expected: all files PASS, including `009_notifications` (6/6).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202607020008_notifications.sql supabase/tests/database/009_notifications.sql
git commit -m "feat: add in-app notifications with unread dedup and self-only access"
```

---

### Task 9: Daily sweep domain logic (§4.3)

**Files:**
- Create: `src/features/automation/domain/sweep.ts`
- Test: `src/features/automation/domain/sweep.test.ts`

**Interfaces:**
- Consumes: `deriveEvidenceStatus` from `@/features/evidence/domain/evidence`; `isOverdue`, `TaskStatus` from `@/features/tasks/domain/tasks`.
- Produces (all pure — the application layer in Task 10 persists the results):
  - `type SweepEvidence = Readonly<{ id: string; organisationId: string; title: string; ownerId: string | null; status: "current" | "expiring"; validUntil: string | null }>`
  - `type SweepTask = Readonly<{ id: string; organisationId: string; title: string; ownerId: string | null; status: TaskStatus; dueOn: string | null }>`
  - `planEvidenceTransitions(evidence: readonly SweepEvidence[], today: string): { evidenceId: string; organisationId: string; title: string; ownerId: string | null; to: "expiring" | "expired" }[]`
  - `planExpiryTasks(evidence: readonly SweepEvidence[], openExpiryTaskEvidenceIds: readonly string[], today: string): { organisationId: string; evidenceId: string; title: string; ownerId: string | null; dueOn: string | null }[]`
  - `planOverdueTaskAlerts(tasks: readonly SweepTask[], today: string): { organisationId: string; taskId: string; title: string; ownerId: string | null }[]`

- [ ] **Step 1: Write the failing tests**

Create `src/features/automation/domain/sweep.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planEvidenceTransitions, planExpiryTasks, planOverdueTaskAlerts } from "./sweep";

const evidence = (over: Partial<Parameters<typeof planEvidenceTransitions>[0][number]>) => ({
  id: "e1", organisationId: "org1", title: "Backup report", ownerId: "u1", status: "current" as const, validUntil: "2026-07-20", ...over,
});

describe("planEvidenceTransitions", () => {
  it("moves evidence into expiring and expired as dates pass, and is idempotent", () => {
    expect(planEvidenceTransitions([evidence({})], "2026-07-02")).toEqual([
      { evidenceId: "e1", organisationId: "org1", title: "Backup report", ownerId: "u1", to: "expiring" },
    ]);
    expect(planEvidenceTransitions([evidence({ status: "expiring" })], "2026-07-02")).toEqual([]);
    expect(planEvidenceTransitions([evidence({ status: "expiring", validUntil: "2026-07-01" })], "2026-07-02")).toEqual([
      { evidenceId: "e1", organisationId: "org1", title: "Backup report", ownerId: "u1", to: "expired" },
    ]);
  });
  it("ignores evidence without an expiry date", () => {
    expect(planEvidenceTransitions([evidence({ validUntil: null })], "2026-07-02")).toEqual([]);
  });
});

describe("planExpiryTasks", () => {
  it("creates one linked task per stale evidence item lacking an open expiry task", () => {
    const items = [evidence({}), evidence({ id: "e2", title: "Old cert", status: "expiring", validUntil: "2026-06-01" })];
    expect(planExpiryTasks(items, ["e1"], "2026-07-02")).toEqual([
      { organisationId: "org1", evidenceId: "e2", title: "Replace stale evidence: Old cert", ownerId: "u1", dueOn: "2026-06-01" },
    ]);
  });
  it("creates nothing when evidence is fresh or already has an open task", () => {
    expect(planExpiryTasks([evidence({ validUntil: "2026-12-01" })], [], "2026-07-02")).toEqual([]);
    expect(planExpiryTasks([evidence({})], ["e1"], "2026-07-02")).toEqual([]);
  });
});

describe("planOverdueTaskAlerts", () => {
  it("alerts on actionable overdue tasks only", () => {
    const tasks = [
      { id: "t1", organisationId: "org1", title: "Fix firewall", ownerId: "u1", status: "open" as const, dueOn: "2026-07-01" },
      { id: "t2", organisationId: "org1", title: "Done already", ownerId: "u1", status: "done" as const, dueOn: "2026-07-01" },
      { id: "t3", organisationId: "org1", title: "No date", ownerId: null, status: "open" as const, dueOn: null },
    ];
    expect(planOverdueTaskAlerts(tasks, "2026-07-02")).toEqual([
      { organisationId: "org1", taskId: "t1", title: "Fix firewall", ownerId: "u1" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/automation/domain/sweep.test.ts`
Expected: FAIL — cannot resolve `./sweep`.

- [ ] **Step 3: Write the implementation**

Create `src/features/automation/domain/sweep.ts`:

```ts
import { deriveEvidenceStatus } from "../../evidence/domain/evidence";
import { isOverdue, type TaskStatus } from "../../tasks/domain/tasks";

export type SweepEvidence = Readonly<{
  id: string; organisationId: string; title: string; ownerId: string | null;
  status: "current" | "expiring"; validUntil: string | null;
}>;
export type SweepTask = Readonly<{
  id: string; organisationId: string; title: string; ownerId: string | null;
  status: TaskStatus; dueOn: string | null;
}>;

export function planEvidenceTransitions(evidence: readonly SweepEvidence[], today: string) {
  return evidence.flatMap((item) => {
    const derived = deriveEvidenceStatus(item.validUntil, today);
    if (derived === "current" || derived === item.status) return [];
    return [{ evidenceId: item.id, organisationId: item.organisationId, title: item.title, ownerId: item.ownerId, to: derived }];
  });
}

export function planExpiryTasks(
  evidence: readonly SweepEvidence[], openExpiryTaskEvidenceIds: readonly string[], today: string,
) {
  const covered = new Set(openExpiryTaskEvidenceIds);
  return evidence
    .filter((item) => !covered.has(item.id) && deriveEvidenceStatus(item.validUntil, today) !== "current")
    .map((item) => ({
      organisationId: item.organisationId, evidenceId: item.id,
      title: `Replace stale evidence: ${item.title}`.slice(0, 200), ownerId: item.ownerId, dueOn: item.validUntil,
    }));
}

export function planOverdueTaskAlerts(tasks: readonly SweepTask[], today: string) {
  return tasks
    .filter((task) => isOverdue({ status: task.status, dueOn: task.dueOn }, today))
    .map((task) => ({ organisationId: task.organisationId, taskId: task.id, title: task.title, ownerId: task.ownerId }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/automation/domain/sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/automation/domain
git commit -m "feat: add daily sweep planning domain logic"
```

---

### Task 10: Daily sweep application + service client + cron route

**Files:**
- Reuse: `src/lib/supabase/service.ts` (created in Task 7)
- Create: `src/features/automation/application/daily-sweep.ts`
- Test: `src/features/automation/application/daily-sweep.test.ts`
- Create: `src/app/api/cron/daily/route.ts`
- Test: `src/app/api/cron/daily/route.test.ts`
- Create: `vercel.json`

**Interfaces:**
- Consumes: sweep planners from `@/features/automation/domain/sweep`; `createClient` from `@supabase/supabase-js`; env vars `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`.
- Produces: `createSupabaseServiceClient()` (server-only; never imported by client components); `runDailySweep(deps: SweepDependencies): Promise<SweepSummary>` where `SweepSummary = { evidenceExpiring: number; evidenceExpired: number; tasksCreated: number; notificationsCreated: number }`; `GET`/`POST /api/cron/daily` returning the summary as JSON.

- [ ] **Step 1: Write the failing application test**

Create `src/features/automation/application/daily-sweep.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runDailySweep, type SweepDependencies } from "./daily-sweep";

function makeDeps(overrides: Partial<SweepDependencies> = {}): SweepDependencies & {
  statusUpdates: [string, string][]; createdTasks: unknown[]; createdNotifications: { userId: string; kind: string }[];
} {
  const statusUpdates: [string, string][] = [];
  const createdTasks: unknown[] = [];
  const createdNotifications: { userId: string; kind: string }[] = [];
  return {
    statusUpdates, createdTasks, createdNotifications,
    today: "2026-07-02",
    listActiveEvidence: async () => [
      { id: "e1", organisationId: "org1", title: "Backup report", ownerId: "u1", status: "current", validUntil: "2026-07-20" },
      { id: "e2", organisationId: "org1", title: "Old cert", ownerId: null, status: "expiring", validUntil: "2026-06-01" },
    ],
    updateEvidenceStatus: async (id, status) => { statusUpdates.push([id, status]); },
    listOpenExpiryTaskEvidenceIds: async () => ["e1"],
    createTask: async (task) => { createdTasks.push(task); return true; },
    listOverdueTasks: async () => [
      { id: "t1", organisationId: "org1", title: "Fix firewall", ownerId: "u1", status: "open", dueOn: "2026-07-01" },
      { id: "t2", organisationId: "org1", title: "Unowned", ownerId: null, status: "open", dueOn: "2026-07-01" },
    ],
    listOrganisationOwners: async () => ["owner1"],
    createNotification: async (notification) => { createdNotifications.push({ userId: notification.userId, kind: notification.kind }); return true; },
    ...overrides,
  };
}

describe("runDailySweep", () => {
  it("applies transitions, raises expiry tasks, and notifies owners (falling back to org owners)", async () => {
    const deps = makeDeps();
    const summary = await runDailySweep(deps);
    expect(deps.statusUpdates).toEqual([["e1", "expiring"], ["e2", "expired"]]);
    expect(deps.createdTasks).toHaveLength(1);
    expect(deps.createdNotifications).toEqual([
      { userId: "u1", kind: "evidence_expiring" },   // e1 transition -> owner
      { userId: "owner1", kind: "evidence_expired" }, // e2 has no owner -> org owners
      { userId: "u1", kind: "task_overdue" },
      { userId: "owner1", kind: "task_overdue" },     // unowned task -> org owners
    ]);
    expect(summary).toEqual({ evidenceExpiring: 1, evidenceExpired: 1, tasksCreated: 1, notificationsCreated: 4 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/automation/application/daily-sweep.test.ts`
Expected: FAIL — cannot resolve `./daily-sweep`.

- [ ] **Step 3: Write the sweep application layer**

Create `src/features/automation/application/daily-sweep.ts`:

```ts
import {
  planEvidenceTransitions, planExpiryTasks, planOverdueTaskAlerts,
  type SweepEvidence, type SweepTask,
} from "../domain/sweep";

export type NewExpiryTask = { organisationId: string; evidenceId: string; title: string; ownerId: string | null; dueOn: string | null };
export type NewNotification = { organisationId: string; userId: string; kind: string; subjectType: string; subjectId: string; message: string; sweepOn: string };
export type SweepSummary = { evidenceExpiring: number; evidenceExpired: number; tasksCreated: number; notificationsCreated: number };

export type SweepDependencies = {
  today: string;
  listActiveEvidence: () => Promise<SweepEvidence[]>;
  updateEvidenceStatus: (id: string, status: "expiring" | "expired") => Promise<void>;
  listOpenExpiryTaskEvidenceIds: () => Promise<string[]>;
  createTask: (task: NewExpiryTask) => Promise<boolean>;
  listOverdueTasks: () => Promise<SweepTask[]>;
  listOrganisationOwners: (organisationId: string) => Promise<string[]>;
  createNotification: (notification: NewNotification) => Promise<boolean>;
};

async function recipients(ownerId: string | null, organisationId: string, deps: SweepDependencies): Promise<string[]> {
  return ownerId ? [ownerId] : deps.listOrganisationOwners(organisationId);
}

export async function runDailySweep(deps: SweepDependencies): Promise<SweepSummary> {
  const summary: SweepSummary = { evidenceExpiring: 0, evidenceExpired: 0, tasksCreated: 0, notificationsCreated: 0 };
  const evidence = await deps.listActiveEvidence();

  for (const transition of planEvidenceTransitions(evidence, deps.today)) {
    await deps.updateEvidenceStatus(transition.evidenceId, transition.to);
    summary[transition.to === "expiring" ? "evidenceExpiring" : "evidenceExpired"] += 1;
    for (const userId of await recipients(transition.ownerId, transition.organisationId, deps)) {
      const inserted = await deps.createNotification({
        organisationId: transition.organisationId, userId, kind: `evidence_${transition.to}`,
        subjectType: "evidence", subjectId: transition.evidenceId,
        message: `Evidence "${transition.title}" is ${transition.to === "expiring" ? "expiring soon" : "expired"}.`.slice(0, 500), sweepOn: deps.today,
      });
      if (inserted) summary.notificationsCreated += 1;
    }
  }

  const openExpiryIds = await deps.listOpenExpiryTaskEvidenceIds();
  for (const task of planExpiryTasks(evidence, openExpiryIds, deps.today)) {
    if (await deps.createTask(task)) summary.tasksCreated += 1;
  }

  for (const alert of planOverdueTaskAlerts(await deps.listOverdueTasks(), deps.today)) {
    for (const userId of await recipients(alert.ownerId, alert.organisationId, deps)) {
      const inserted = await deps.createNotification({
        organisationId: alert.organisationId, userId, kind: "task_overdue",
        subjectType: "tasks", subjectId: alert.taskId,
        message: `Task "${alert.title}" is overdue.`.slice(0, 500), sweepOn: deps.today,
      });
      if (inserted) summary.notificationsCreated += 1;
    }
  }
  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/automation/application/daily-sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the service client and cron route**

Task 7 already created `src/lib/supabase/service.ts`; verify it remains server-only and matches:

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS. Only ever import from server-side
// automation code (cron routes); never from anything reachable by the browser.
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service environment variables are not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
```

Create `src/app/api/cron/daily/route.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { runDailySweep, type SweepDependencies } from "@/features/automation/application/daily-sweep";
import type { SweepEvidence, SweepTask } from "@/features/automation/domain/sweep";

export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sweep(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const deps: SweepDependencies = {
    today,
    listActiveEvidence: async () => {
      const { data, error } = await supabase.from("evidence")
        .select("id,organisation_id,title,owner_id,status,valid_until")
        .in("status", ["current", "expiring"]).not("valid_until", "is", null);
      if (error) throw error;
      return (data ?? []).map((row): SweepEvidence => ({
        id: row.id, organisationId: row.organisation_id, title: row.title, ownerId: row.owner_id,
        status: row.status as "current" | "expiring", validUntil: row.valid_until,
      }));
    },
    updateEvidenceStatus: async (id, status) => {
      const { error } = await supabase.from("evidence").update({ status }).eq("id", id);
      if (error) throw error;
    },
    listOpenExpiryTaskEvidenceIds: async () => {
      const { data, error } = await supabase.from("tasks").select("evidence_id")
        .eq("source", "evidence_expiry").in("status", ["open", "in_progress"]).not("evidence_id", "is", null);
      if (error) throw error;
      return (data ?? []).map((row) => row.evidence_id as string);
    },
    createTask: async (task) => {
      const { data: owner, error: ownerError } = await supabase.from("memberships")
        .select("user_id").eq("organisation_id", task.organisationId).eq("role", "owner").limit(1).single();
      if (ownerError) throw ownerError;
      const { data, error } = await supabase.from("tasks").upsert({
        organisation_id: task.organisationId, title: task.title,
        detail: "Raised automatically because linked evidence is expiring or expired.",
        source: "evidence_expiry", owner_id: task.ownerId, due_on: task.dueOn,
        evidence_id: task.evidenceId, created_by: owner.user_id,
      }, { onConflict: "organisation_id,evidence_id,source", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      return Boolean(data?.length);
    },
    listOverdueTasks: async () => {
      const { data, error } = await supabase.from("tasks")
        .select("id,organisation_id,title,owner_id,status,due_on")
        .in("status", ["open", "in_progress"]).lt("due_on", today);
      if (error) throw error;
      return (data ?? []).map((row): SweepTask => ({
        id: row.id, organisationId: row.organisation_id, title: row.title, ownerId: row.owner_id,
        status: row.status, dueOn: row.due_on,
      }));
    },
    listOrganisationOwners: async (organisationId) => {
      const { data, error } = await supabase.from("memberships")
        .select("user_id").eq("organisation_id", organisationId).eq("role", "owner");
      if (error) throw error;
      return (data ?? []).map((row) => row.user_id);
    },
    createNotification: async (notification) => {
      // The full day-scoped constraint makes retries and concurrent runs idempotent.
      const { data, error } = await supabase.from("notifications").upsert({
        organisation_id: notification.organisationId, user_id: notification.userId, kind: notification.kind,
        subject_type: notification.subjectType, subject_id: notification.subjectId, message: notification.message, sweep_on: notification.sweepOn,
      }, { onConflict: "user_id,kind,subject_type,subject_id,sweep_on", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      return Boolean(data?.length);
    },
  };
  const summary = await runDailySweep(deps);
  return NextResponse.json(summary);
}

export async function GET(request: Request) { return sweep(request); } // Vercel Cron sends GET
export async function POST(request: Request) { return sweep(request); }
```

Create `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/daily", "schedule": "0 6 * * *" }]
}
```

- [ ] **Step 6: Verify build, lint, tests, and deterministic cron integration**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: no errors.

Add `src/app/api/cron/daily/route.test.ts`. Seed one current evidence row whose `valid_until` is yesterday and one overdue open task, invoke the exported route with the correct bearer token, and assert that evidence becomes `expired`, exactly one `evidence_expiry` task is created, and owner notifications exist. Invoke the route twice concurrently with `Promise.all` and assert the task and same-day notification counts remain one. Call with a wrong token and assert 401. Use the local service-role client only in this server-side test and remove the seeded tenant in `afterAll`.

Run: `npx vitest run src/app/api/cron/daily/route.test.ts`
Expected: PASS, proving state movement and concurrency-safe idempotency rather than only an all-zero smoke response.

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase/service.ts src/features/automation/application src/app/api/cron/daily vercel.json
git commit -m "feat: add daily automation sweep with CRON_SECRET-authenticated cron route"
```

---

### Task 11: Needs-attention dashboard queue + notifications UI

**Files:**
- Create: `src/app/app/notifications/page.tsx`
- Create: `src/app/app/notifications/actions.ts`
- Modify: `src/app/app/page.tsx` (needs-attention section, evidence tile)
- Modify: `src/app/app/layout.tsx` (header notifications link with unread count)

**Interfaces:**
- Consumes: `notifications`, `tasks`, `controls`, `evidence`, and `evidence_links`; `isOverdue` from tasks domain.
- Produces: `markNotificationReadAction`, `markAllNotificationsReadAction`; `/app/notifications` route.

- [ ] **Step 1: Write the notifications actions**

Create `src/app/app/notifications/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";

export async function markNotificationReadAction(formData: FormData) {
  const { supabase } = await requireAppContext();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", Number(formData.get("id")));
  revalidatePath("/app/notifications"); revalidatePath("/app", "layout");
}

export async function markAllNotificationsReadAction() {
  const { supabase } = await requireAppContext();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  revalidatePath("/app/notifications"); revalidatePath("/app", "layout");
}
```

- [ ] **Step 2: Write the notifications page**

Create `src/app/app/notifications/page.tsx`:

```tsx
import { requireAppContext } from "@/lib/app-context";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

export default async function NotificationsPage() {
  const { supabase } = await requireAppContext();
  const { data } = await supabase.from("notifications").select("id,kind,message,read_at,created_at").order("created_at", { ascending: false }).limit(100);
  const unread = data?.filter((n) => !n.read_at) ?? [];
  return <main className="mx-auto max-w-4xl px-6 py-10">
    <div className="flex justify-between"><h1 className="text-3xl font-bold">Notifications</h1>
      {unread.length > 0 && <form action={markAllNotificationsReadAction}><button className="rounded border border-slate-300 px-3 py-2 text-sm">Mark all read</button></form>}</div>
    <div className="mt-8 divide-y rounded-xl border bg-white">
      {data?.length ? data.map((n) => <div key={n.id} className="flex items-center justify-between gap-4 p-4 text-sm">
        <p className={n.read_at ? "text-slate-500" : "font-medium"}>{n.message}<span className="ml-2 text-xs text-slate-400">{new Date(n.created_at).toLocaleString("en-GB")}</span></p>
        {!n.read_at && <form action={markNotificationReadAction}><input type="hidden" name="id" value={n.id} /><button className="text-blue-700">Mark read</button></form>}
      </div>) : <p className="p-4 text-slate-500">Nothing needs your attention. The daily sweep will post here when something changes.</p>}
    </div>
  </main>;
}
```

- [ ] **Step 3: Add the unread-count link to the header**

In `src/app/app/layout.tsx`, after fetching the user, query the unread count and render a Notifications link next to the sign-out form (RLS already scopes rows to the signed-in user):

```tsx
const { count: unread } = await supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
```

```tsx
<div className="flex items-center gap-3">
  <Link href="/app/notifications" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Notifications{unread ? <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">{unread}</span> : null}</Link>
  <form action={signOutAction}><button className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Sign out</button></form>
</div>
```

- [ ] **Step 4: Add the needs-attention queue and evidence tile to the dashboard**

In `src/app/app/page.tsx`, extend the `Promise.all` with evidence counts and control-linked attention data (tiles grid becomes `sm:grid-cols-2 lg:grid-cols-5` including Task 4's Open tasks tile):

```tsx
const today = new Date().toISOString().slice(0, 10);
const [{ count: assessments }, { count: risks }, { count: snapshots }, { count: openTasks }, { count: liveEvidence }, { data: controls }, { data: activity }] = await Promise.all([
  supabase.from("assessment_sessions").select("id", { count: "exact", head: true }),
  supabase.from("risks").select("id", { count: "exact", head: true }).neq("status", "closed"),
  supabase.from("soa_snapshots").select("id", { count: "exact", head: true }),
  supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
  supabase.from("evidence").select("id", { count: "exact", head: true }).in("status", ["current", "expiring", "expired"]),
  supabase.from("controls").select("id,code,title,evidence_links(evidence_id,evidence(status)),tasks(id,status,due_on)"),
  supabase.from("audit_events").select("id,action,entity_type,occurred_at").order("occurred_at", { ascending: false }).limit(5),
]);
```

Derive `attentionControls` from that RLS-scoped result. Include a control when it has at least one linked evidence item and every linked item is `expired`/`withdrawn`/`superseded`, or when it has an `open`/`in_progress` task with `due_on < today`. Do not list stale evidence or overdue tasks without their control context. Add tile `["Evidence items", liveEvidence, "/app/evidence"]` and, between the tiles and Recent activity, render at most five control-centric rows:

```tsx
{attentionControls.length > 0 && <section className="mt-10 rounded-xl border border-amber-200 bg-amber-50 p-5">
  <h2 className="text-xl font-semibold">Needs attention</h2>
  <ul className="mt-3 space-y-2 text-sm">
    {attentionControls.slice(0, 5).map((control) => <li key={control.id}><Link className="text-blue-700 underline" href={`/app/soa?control=${control.id}`}>{control.code}: {control.title}</Link> <span className="text-slate-500">{control.reason}</span></li>)}
  </ul>
</section>}
```

- [ ] **Step 5: Verify build, lint, and tests**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/app/notifications src/app/app/page.tsx src/app/app/layout.tsx
git commit -m "feat: add needs-attention dashboard queue and in-app notifications UI"
```

---

### Task 12: Demo-mode tasks and evidence pages

**Files:**
- Create: `src/app/demo/tasks/page.tsx`
- Create: `src/app/demo/evidence/page.tsx`
- Modify: `src/components/demo-shell.tsx` (nav entries)

**Interfaces:**
- Consumes: `DemoShell` layout (applied by `src/app/demo/layout.tsx`), `PageIntro`, `Card`, `Pill`, `Stat` from `@/components/ui`.
- Produces: static sample-data pages `/demo/tasks` and `/demo/evidence` demonstrating the full loop (overdue task, expiring evidence, needs-attention state).

- [ ] **Step 1: Add nav entries**

In `src/components/demo-shell.tsx`, extend the `nav` array after the risk register entry:

```ts
const nav = [
  ["/demo/dashboard", "home", "Dashboard"],
  ["/demo/assessment", "clipboard", "Gap assessment"],
  ["/demo/soa", "file", "Statement of Applicability"],
  ["/demo/risks", "alert", "Risk register"],
  ["/demo/tasks", "check", "Tasks"],
  ["/demo/evidence", "file", "Evidence vault"],
  ["/demo/settings", "settings", "Settings"],
] as const;
```

(If the `Icon` component has no `check` name, reuse `clipboard` — check `src/components/icons.tsx` first.)

- [ ] **Step 2: Write the demo tasks page**

Create `src/app/demo/tasks/page.tsx` (sample data mirrors the starter calendar plus one overdue item):

```tsx
import { Card, PageIntro, Pill, Stat } from "@/components/ui";

const tasks = [
  { title: "Review user access rights", owner: "Priya Shah", due: "2026-07-15", recurs: "Quarterly", source: "System", status: "Open", overdue: false },
  { title: "Close gap: Access rights are reviewed and removed promptly", owner: "Noah Adams", due: "2026-06-20", recurs: "—", source: "Gap", status: "In progress", overdue: true },
  { title: "Test backup restoration", owner: "Priya Shah", due: "2026-11-02", recurs: "Semi-annually", source: "System", status: "Open", overdue: false },
  { title: "Replace stale evidence: Access review minutes Q1", owner: "Noah Adams", due: "2026-06-30", recurs: "—", source: "Evidence expiry", status: "Open", overdue: true },
];

export default function DemoTasksPage() {
  return <>
    <PageIntro eyebrow="Remediation" title="Tasks" body="Owned, dated work generated from gaps, evidence expiry, and your compliance calendar." />
    <div className="stat-grid"><Stat label="Open tasks" value={3} detail="Across all sources" /><Stat label="Overdue" value={2} detail="Flagged by the daily sweep" tone="red" /><Stat label="Recurring" value={2} detail="Regenerate on completion" tone="green" /></div>
    <Card><table className="table"><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Recurs</th><th>Source</th><th>Status</th></tr></thead><tbody>
      {tasks.map((t) => <tr key={t.title}><td><b>{t.title}</b></td><td>{t.owner}</td><td>{t.due}{t.overdue && <Pill tone="red">Overdue</Pill>}</td><td>{t.recurs}</td><td>{t.source}</td><td><Pill tone={t.status === "Open" ? "blue" : "amber"}>{t.status}</Pill></td></tr>)}
    </tbody></table></Card>
  </>;
}
```

- [ ] **Step 3: Write the demo evidence page**

Create `src/app/demo/evidence/page.tsx`:

```tsx
import { Card, PageIntro, Pill, Stat } from "@/components/ui";

const evidence = [
  { title: "MFA enforcement report", kind: "File", linked: "CH-082: Strong authentication methods", until: "2027-01-15", status: "Current", tone: "green" },
  { title: "Access review minutes Q2", kind: "File", linked: "CH-016: Access entitlement reviews", until: "2026-07-20", status: "Expiring", tone: "amber" },
  { title: "Access review minutes Q1", kind: "File", linked: "CH-016: Access entitlement reviews", until: "2026-06-30", status: "Expired", tone: "red" },
  { title: "Supplier security clause register", kind: "Link", linked: "CH-020: Security clauses in supplier contracts", until: "—", status: "Current", tone: "green" },
];

export default function DemoEvidencePage() {
  return <>
    <PageIntro eyebrow="Evidence" title="Evidence vault" body="Immutable proof attached to controls — freshness is re-checked by the daily sweep, and stale items raise tasks automatically." />
    <div className="stat-grid"><Stat label="Evidence items" value={4} detail="Files, links, and notes" /><Stat label="Expiring soon" value={1} detail="Within 30 days" tone="amber" /><Stat label="Expired" value={1} detail="Replacement task raised" tone="red" /></div>
    <Card><table className="table"><thead><tr><th>Evidence</th><th>Kind</th><th>Linked control</th><th>Valid until</th><th>Status</th></tr></thead><tbody>
      {evidence.map((e) => <tr key={e.title}><td><b>{e.title}</b></td><td>{e.kind}</td><td>{e.linked}</td><td>{e.until}</td><td><Pill tone={e.tone}>{e.status}</Pill></td></tr>)}
    </tbody></table></Card>
  </>;
}
```

Before committing, open `src/app/demo/risks/page.tsx` and match its actual table/list markup conventions (class names like `table` are illustrative — reuse whatever the existing demo pages use so styling holds).

- [ ] **Step 4: Verify build and lint**

Run: `npx tsc --noEmit && npx eslint . && npx next build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/demo/tasks src/app/demo/evidence src/components/demo-shell.tsx
git commit -m "feat: add demo-mode tasks and evidence vault pages"
```

---

### Task 13: End-to-end journeys, accessibility gate, full verification

**Files:**
- Create: `e2e/phase1.spec.ts`

**Interfaces:**
- Consumes: routes and actions from Tasks 4, 7, 11, 12; existing sign-up journey pattern in `e2e/product.spec.ts`.
- Produces: Playwright coverage for the Phase 1 exit criteria.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/phase1.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("demo exposes the workflow automation modules", async ({ page }) => {
  await page.goto("/demo/tasks");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByText("Overdue").first()).toBeVisible();
  await page.goto("/demo/evidence");
  await expect(page.getByRole("heading", { name: "Evidence vault" })).toBeVisible();
  await expect(page.getByText("Expired").first()).toBeVisible();
});

test("demo tasks and evidence pages have no detectable accessibility violations", async ({ page }) => {
  await page.goto("/demo/tasks");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto("/demo/evidence");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a user runs the workflow loop: calendar, task, evidence, dashboard", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `phase1-${suffix}@example.test`;
  const password = "Test-only-passphrase-2026";

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Phase One Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/sign-in/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Organisation name").fill(`Phase1 Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Starter calendar -> three recurring tasks
  await page.getByRole("link", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Add starter calendar" }).click();
  await expect(page.getByText("Review user access rights")).toBeVisible();
  await expect(page.getByText("Test backup restoration")).toBeVisible();

  // Manual task with a due date
  await page.getByRole("link", { name: "New task" }).click();
  await page.getByLabel("Title").fill("Document incident reporting route");
  await page.getByLabel("Due date").fill("2026-08-01");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Document incident reporting route")).toBeVisible();

  // Complete it
  const row = page.getByRole("row", { name: /Document incident reporting route/ });
  await row.getByRole("combobox").selectOption("done");
  await row.getByRole("button", { name: "Save" }).click();

  // Link evidence to a control and see freshness
  await page.getByRole("link", { name: "Evidence", exact: true }).click();
  await page.getByRole("link", { name: "Add evidence" }).click();
  await page.getByLabel("Title").fill("Access review minutes");
  await page.getByLabel("Kind").selectOption("link");
  await page.getByLabel(/^URL/).fill("https://example.test/minutes");
  await page.getByLabel("Valid until").fill("2027-07-01");
  await page.getByRole("button", { name: "Save evidence" }).click();
  await expect(page.getByText("Access review minutes")).toBeVisible();
  await expect(page.getByText("current", { exact: true })).toBeVisible();
  const linkTarget = page.getByLabel(/Link Access review minutes to a control/);
  await linkTarget.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expect(page.getByText(/CH-001/)).toBeVisible();

  // Dashboard reflects the loop; authed pages pass axe
  await page.goto("/app");
  await expect(page.getByText("Open tasks")).toBeVisible();
  await expect(page.getByText("Evidence items")).toBeVisible();
  await page.goto("/app/tasks");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto("/app/evidence");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
```

- [ ] **Step 2: Cover the two Phase 1 exit paths omitted by the basic journey**

Extend the authenticated test before its accessibility assertions:

1. Start and complete an assessment with at least one negative answer so the existing gap query produces a suggestion. From `/app/risks`, follow **Accept as task**, assert the title/detail are pre-filled, select the signed-in owner, set a due date, submit, and assert the new task detail shows source `gap`, the owner, due date, and linked control. Return to the SoA and risk views and assert their linked-task widgets contain the task.
2. Create a second evidence item linked to that control with `valid_until` set to yesterday. Invoke `POST /api/cron/daily` with the test server's `CRON_SECRET`, then assert the evidence is `expired`, a single automatic expiry task exists, and a notification appears. Invoke the cron a second time and assert no duplicate task or same-day notification appears. Keep the route-level concurrent test from Task 10 as the race-condition proof.

Use deterministic dates derived from the test clock, not fixed future dates. The test may use a server-only Supabase service client for fixture setup, but user-visible assertions must go through the browser.

- [ ] **Step 3: Run the new e2e spec**

Run: `npx playwright test e2e/phase1.spec.ts`
Expected: PASS (local Supabase stack must be running; check `playwright.config.ts` for how the dev server is launched). Fix any selector drift against the real pages — adjust the spec, not the accessibility of the pages.

- [ ] **Step 4: Run the full verification suite**

Run: `npx eslint . && npx tsc --noEmit && npx vitest run && npx next build && npx supabase db reset && npx supabase test db && npx playwright test`
Expected: everything green. This is the Phase 1 exit gate — a gap becomes an owned task, evidence attaches and ages, the sweep moves statuses (verified in Task 10 step 6), all RLS-tested.

- [ ] **Step 5: Commit**

```bash
git add e2e/phase1.spec.ts
git commit -m "test: add Phase 1 workflow-loop e2e journey and accessibility gates"
```

---

### Task 14: Documentation updates

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/deployment.md`
- Modify: `README.md` (feature list, if it enumerates modules)

**Interfaces:**
- Consumes: everything shipped above.
- Produces: docs describing the four new modules and cron deployment.

- [ ] **Step 1: Update the docs**

Read each file first and match its structure. Cover, concisely:
- `docs/architecture.md`: new features `tasks`, `evidence`, `automation`; the §3a control library tables (`frameworks`, `requirements`, `controls`, `requirement_control_mappings`) and how requirements reuse control-catalogue UUIDs; the evidence storage bucket and its path convention; the notifications model; the daily sweep design (planners pure in domain, persistence injected, cron route with `CRON_SECRET`).
- `docs/deployment.md`: `vercel.json` cron entry, `CRON_SECRET` must be set in Vercel env, Vercel Cron calls `GET /api/cron/daily` with `Authorization: Bearer <CRON_SECRET>`; manual invocation via curl for dev.
- `README.md`: add Tasks, Evidence vault, and Automation to the feature list if such a list exists.

- [ ] **Step 2: Verify docs build nothing is broken**

Run: `npx eslint .`
Expected: clean (docs are markdown; this is just a regression guard).

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md docs/deployment.md README.md
git commit -m "docs: document Phase 1 workflow automation modules and cron deployment"
```

---

## Spec coverage checklist (self-review record)

- §3a control library → Task 1 (schema + ISO population + migration of existing refs via UUID reuse).
- §4.1 tasks table, gap-to-task, recurrence-at-completion, calendar seed, `/app/tasks` UI + dashboard widgets → Tasks 2, 3, 4.
- §4.2 evidence table, links join, storage bucket (25 MB, type allowlist, signed URLs, per-org prefix), never-hard-deleted with supersede/withdraw, and per-control freshness on the SoA/control views → Tasks 5, 6, 7, 11.
- §4.3 cron route with `CRON_SECRET`, idempotent daily sweep (expiring/expired transitions, expiry tasks if none open, overdue notifications, needs-attention queue), notifications table, in-app bell → Tasks 8, 9, 10, 11.
- §10 cross-cutting: RLS + attack tests every table (Tasks 1, 3, 6, 8), audit triggers on all mutable tables, domain-first vitest, e2e + axe + demo mode (Tasks 12, 13), numbered migrations, original content (Task 3 catalogue items).
- Phase 1 exit criteria → verified in Task 13 step 3 and Task 10 step 6.
