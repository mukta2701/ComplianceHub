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
