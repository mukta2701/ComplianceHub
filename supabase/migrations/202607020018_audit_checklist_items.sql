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
