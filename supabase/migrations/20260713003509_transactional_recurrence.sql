-- Complete a recurring task and create its next occurrence as one transaction.
-- SECURITY INVOKER is intentional: the authenticated caller must satisfy the
-- existing tasks SELECT/UPDATE/INSERT RLS policies for both rows.
-- Remove the superseded two-argument draft when this idempotent migration is
-- reapplied to a development database. The public API accepts no caller date.
drop function if exists public.complete_recurring_task(uuid, date);

create or replace function public.complete_recurring_task(target_task_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_task public.tasks;
  successor_due_on date;
begin
  select task.*
  into source_task
  from public.tasks as task
  where task.id = target_task_id
  for update;

  if not found or source_task.status = 'done' then
    return false;
  end if;

  if source_task.recurrence is null or source_task.due_on is null then
    raise exception 'Task is not recurring' using errcode = '22023';
  end if;

  successor_due_on := case source_task.recurrence
    when 'weekly' then source_task.due_on + 7
    when 'monthly' then (source_task.due_on + interval '1 month')::date
    when 'quarterly' then (source_task.due_on + interval '3 months')::date
    when 'semiannually' then (source_task.due_on + interval '6 months')::date
    when 'annually' then (source_task.due_on + interval '1 year')::date
  end;

  update public.tasks
  set status = 'done', updated_at = pg_catalog.now()
  where id = source_task.id;

  insert into public.tasks (
    organisation_id, title, detail, owner_id, due_on, recurrence, source,
    control_id, risk_id, created_by
  ) values (
    source_task.organisation_id,
    source_task.title,
    source_task.detail,
    source_task.owner_id,
    successor_due_on,
    source_task.recurrence,
    source_task.source,
    source_task.control_id,
    source_task.risk_id,
    (select auth.uid())
  );

  return true;
end;
$$;

revoke all on function public.complete_recurring_task(uuid) from public;
revoke all on function public.complete_recurring_task(uuid) from anon;
revoke all on function public.complete_recurring_task(uuid) from service_role;
grant execute on function public.complete_recurring_task(uuid) to authenticated;
