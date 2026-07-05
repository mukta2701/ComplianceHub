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
