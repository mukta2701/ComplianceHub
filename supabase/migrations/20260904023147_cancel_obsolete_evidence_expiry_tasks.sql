-- Evidence replacement tasks are human work. Once evidence reaches a terminal
-- state, that work is no longer actionable; its history remains in the task
-- and audit ledgers with a cancelled status.
create or replace function public.cancel_terminal_evidence_expiry_tasks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.tasks
  set status = 'cancelled',
      updated_at = pg_catalog.statement_timestamp()
  where organisation_id = new.organisation_id
    and evidence_id = new.id
    and source = 'evidence_expiry'
    and status in ('open', 'in_progress');

  return new;
end;
$$;

revoke all on function public.cancel_terminal_evidence_expiry_tasks()
from public, anon, authenticated, service_role;

drop trigger if exists evidence_cancel_terminal_expiry_tasks on public.evidence;
create trigger evidence_cancel_terminal_expiry_tasks
after update of status on public.evidence
for each row
when (
  old.status is distinct from new.status
  and new.status in ('superseded', 'withdrawn')
)
execute function public.cancel_terminal_evidence_expiry_tasks();

-- GitHub provenance-backed evidence is refreshed by the scanner, not by a
-- person. Cancel any generic replacement tasks raised before this distinction
-- was enforced. The existing tasks_audit trigger records every cancellation.
update public.tasks as task
set status = 'cancelled',
    updated_at = pg_catalog.statement_timestamp()
where task.source = 'evidence_expiry'
  and task.status in ('open', 'in_progress')
  and exists (
    select 1
    from public.github_evidence_provenance as provenance
    where provenance.evidence_id = task.evidence_id
      and provenance.organisation_id = task.organisation_id
  );
