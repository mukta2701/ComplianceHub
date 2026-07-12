-- Active monitoring (Phase 1): findings raised when a monitored source fails a
-- compliance check. Modelled on audit_findings, but monitoring-scoped and written
-- by the service-role cron rather than a member. A finding is keyed by
-- (organisation_id, check_id, subject_id): re-polling the same failing check
-- upserts instead of duplicating, and a check that flips back to passing lets the
-- cron re-open (raise detected_at) or resolve the existing row. Severity carries
-- the monitor scale (low..critical); a finding may spawn a remediation task
-- through the shared tasks engine and link it via task_id. capture_audit_event
-- records every insert/update/delete automatically.

create type public.monitor_severity as enum ('low', 'medium', 'high', 'critical');
create type public.monitor_finding_status as enum ('open', 'acknowledged', 'resolved');

create table public.monitoring_findings (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  source_id uuid,
  check_id text not null check (char_length(check_id) between 1 and 120),
  control_ref text not null default '' check (char_length(control_ref) <= 40),
  subject_type text not null check (char_length(subject_type) between 1 and 80),
  subject_id text not null check (char_length(subject_id) between 1 and 200),
  severity public.monitor_severity not null default 'medium',
  title text not null check (char_length(title) between 1 and 300),
  detail text not null default '' check (char_length(detail) <= 4000),
  status public.monitor_finding_status not null default 'open',
  task_id uuid,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (id, organisation_id),
  constraint monitoring_findings_dedup_key unique (organisation_id, check_id, subject_id),
  constraint monitoring_findings_source_tenant_fk foreign key (source_id, organisation_id)
    references public.monitor_sources(id, organisation_id) on delete set null (source_id),
  constraint monitoring_findings_task_tenant_fk foreign key (task_id, organisation_id)
    references public.tasks(id, organisation_id) on delete set null (task_id)
);
create index monitoring_findings_org_status_idx on public.monitoring_findings(organisation_id, status);

create trigger monitoring_findings_audit after insert or update or delete on public.monitoring_findings
for each row execute function public.capture_audit_event();

alter table public.monitoring_findings enable row level security;
-- Members read their org's findings; owners acknowledge / resolve / attach a task.
-- Inserts and auto-resolutions come from the service-role cron only.
create policy monitoring_findings_members_select on public.monitoring_findings for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy monitoring_findings_owner_update on public.monitoring_findings for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id));

revoke all on public.monitoring_findings from anon, authenticated;
grant select on public.monitoring_findings to authenticated;
grant update (status, resolved_at, task_id) on public.monitoring_findings to authenticated;

-- The monitor cron raises, re-opens and auto-resolves findings.
grant select, insert, update on public.monitoring_findings to service_role;
