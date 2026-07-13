-- Complete a recurring task and create its next occurrence as one transaction.
-- SECURITY INVOKER is intentional: the authenticated caller must satisfy the
-- existing tasks SELECT/UPDATE/INSERT RLS policies for both rows.
create or replace function public.complete_recurring_task(
  target_task_id uuid,
  next_due_on date
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_task public.tasks;
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

  if next_due_on is null or next_due_on <= source_task.due_on then
    raise exception 'Next due date must follow the current due date' using errcode = '22023';
  end if;

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
    next_due_on,
    source_task.recurrence,
    source_task.source,
    source_task.control_id,
    source_task.risk_id,
    (select auth.uid())
  );

  return true;
end;
$$;

revoke all on function public.complete_recurring_task(uuid, date) from public;
revoke all on function public.complete_recurring_task(uuid, date) from anon;
revoke all on function public.complete_recurring_task(uuid, date) from service_role;
grant execute on function public.complete_recurring_task(uuid, date) to authenticated;
