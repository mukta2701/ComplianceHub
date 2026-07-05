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
