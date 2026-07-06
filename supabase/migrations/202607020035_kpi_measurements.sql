-- Phase D/B8: KPI measurement history. Each row is one timestamped numeric
-- reading for a KPI, so the management review can see an indicator's trend over
-- time rather than a single free-text snapshot. Child of kpis via a composite
-- (kpi_id, organisation_id) tenant FK, so a reading can never point at another
-- tenant's KPI; RLS is split per verb and INSERT also pins created_by to the
-- caller, matching the canonical tenant-table pattern.

create table public.kpi_measurements (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  kpi_id uuid not null,
  value numeric not null,
  measured_on date not null default current_date,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (id, organisation_id),
  constraint kpi_measurements_kpi_tenant_fk foreign key (kpi_id, organisation_id)
    references public.kpis(id, organisation_id) on delete cascade
);
create index kpi_measurements_kpi_idx on public.kpi_measurements(kpi_id, measured_on);

create trigger kpi_measurements_audit after insert or update or delete on public.kpi_measurements
for each row execute function public.capture_audit_event();

alter table public.kpi_measurements enable row level security;
create policy kpi_measurements_members_select on public.kpi_measurements for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy kpi_measurements_members_insert on public.kpi_measurements for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy kpi_measurements_members_update on public.kpi_measurements for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy kpi_measurements_members_delete on public.kpi_measurements for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.kpi_measurements from anon, authenticated;
grant select, insert, update, delete on public.kpi_measurements to authenticated;
