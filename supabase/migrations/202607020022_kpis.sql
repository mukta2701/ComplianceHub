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
