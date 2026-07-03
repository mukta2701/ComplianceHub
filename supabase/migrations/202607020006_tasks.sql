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
