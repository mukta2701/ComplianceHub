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
