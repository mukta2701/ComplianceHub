-- Atomically create and link a KPI follow-up task. The application-side
-- preflight is useful for friendly errors, but this row lock is the authority:
-- concurrent raises serialize on the KPI and cannot leave an orphan task.
create or replace function public.raise_kpi_task(
  target_organisation_id uuid,
  target_kpi_id uuid,
  target_owner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  kpi_row public.kpis;
  created_task_id uuid;
begin
  if (select auth.uid()) is null
     or not public.is_organisation_member(target_organisation_id) then
    raise exception 'KPI not found in active workspace' using errcode = '42501';
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
  into kpi_row
  from public.kpis
  where id = target_kpi_id
    and organisation_id = target_organisation_id
  for update;

  if not found then
    raise exception 'KPI not found in active workspace' using errcode = '42501';
  end if;
  if kpi_row.task_id is not null then
    raise exception 'This KPI already has a follow-up task' using errcode = '23505';
  end if;

  insert into public.tasks (
    organisation_id, title, detail, owner_id, source, created_by
  ) values (
    target_organisation_id,
    left('KPI follow-up: ' || kpi_row.indicator, 200),
    kpi_row.next_steps,
    target_owner_id,
    'manual',
    (select auth.uid())
  )
  returning id into created_task_id;

  update public.kpis
  set task_id = created_task_id,
      updated_at = pg_catalog.now()
  where id = target_kpi_id
    and organisation_id = target_organisation_id
    and task_id is null;

  if not found then
    raise exception 'KPI follow-up task could not be linked' using errcode = '40001';
  end if;

  return created_task_id;
end;
$$;

revoke all on function public.raise_kpi_task(uuid, uuid, uuid) from public;
grant execute on function public.raise_kpi_task(uuid, uuid, uuid) to authenticated;
