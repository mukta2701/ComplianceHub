-- Atomically create and link a monitoring remediation task. The finding row is
-- locked before the duplicate check so concurrent owner clicks cannot leave an
-- orphan task or overwrite the winning link.
create or replace function public.raise_monitoring_finding_task(
  target_organisation_id uuid,
  target_finding_id uuid,
  target_owner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  finding_row public.monitoring_findings;
  created_task_id uuid;
begin
  if (select auth.uid()) is null
     or not public.is_organisation_owner(target_organisation_id) then
    raise exception 'Finding not found in active workspace' using errcode = '42501';
  end if;

  if target_owner_id is not null and not exists (
    select 1
    from public.memberships
    where organisation_id = target_organisation_id
      and user_id = target_owner_id
  ) then
    raise exception 'task owner must belong to the active workspace' using errcode = '42501';
  end if;

  select *
  into finding_row
  from public.monitoring_findings
  where id = target_finding_id
    and organisation_id = target_organisation_id
    and status in ('open', 'acknowledged')
  for update;

  if not found then
    raise exception 'Finding not found in active workspace' using errcode = '42501';
  end if;
  if finding_row.task_id is not null then
    raise exception 'This finding already has a remediation task' using errcode = '23505';
  end if;

  insert into public.tasks (
    organisation_id, title, detail, owner_id, source, created_by
  ) values (
    target_organisation_id,
    left('Remediate: ' || finding_row.title, 200),
    finding_row.detail || E'\n\nControl ' || finding_row.control_ref || ' · ' || finding_row.subject_id || '. Raised from continuous monitoring.',
    target_owner_id,
    'system',
    (select auth.uid())
  )
  returning id into created_task_id;

  update public.monitoring_findings
  set task_id = created_task_id,
      status = 'acknowledged'
  where id = target_finding_id
    and organisation_id = target_organisation_id
    and task_id is null;

  if not found then
    raise exception 'Monitoring remediation task could not be linked' using errcode = '40001';
  end if;

  return created_task_id;
end;
$$;

revoke all on function public.raise_monitoring_finding_task(uuid, uuid, uuid) from public;
grant execute on function public.raise_monitoring_finding_task(uuid, uuid, uuid) to authenticated;
