-- Completion and the first successor are one transaction. Reopening the source
-- must not erase the fact that its next occurrence already exists.
alter table public.tasks add column recurrence_generated_at timestamptz;
-- Legacy occurrences have no trustworthy successor lineage. Leave them unknown:
-- the guarantee starts with completions recorded after this migration.

create or replace function public.complete_recurring_task(target_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_task public.tasks;
  successor_due_on date;
  target_organisation_id uuid;
begin
  select task.organisation_id
  into target_organisation_id
  from public.tasks as task
  where task.id = target_task_id and public.is_organisation_member(task.organisation_id);

  if not found then
    return false;
  end if;
  perform 1 from public.memberships
  where organisation_id = target_organisation_id and user_id = (select auth.uid())
    and role in ('owner', 'admin') for share;
  if not found then
    raise exception 'only workspace operators can complete recurring tasks'
      using errcode = '42501';
  end if;

  select task.*
  into source_task
  from public.tasks as task
  where task.id = target_task_id
  for update;

  if not found then
    return false;
  end if;
  if source_task.organisation_id <> target_organisation_id
    or not public.is_organisation_operator(source_task.organisation_id) then
    raise exception 'only workspace operators can complete recurring tasks' using errcode = '42501';
  end if;
  if source_task.status = 'done' then
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

  if source_task.recurrence_generated_at is not null then
    return true;
  end if;

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
  update public.tasks set recurrence_generated_at = pg_catalog.now() where id = source_task.id;
  return true;
end;
$$;


-- A policy review occurrence is identified by its scheduled date, not by the
-- mutable task deadline. Preserve old tasks; legacy undated tasks use a sentinel.
alter table public.tasks add column policy_review_due_on date;
update public.tasks as task set policy_review_due_on = coalesce(task.due_on, policy.review_due, '-infinity'::date)
from public.policies as policy
where task.policy_id = policy.id and task.organisation_id = policy.organisation_id and task.source = 'policy_review';
alter table public.tasks drop constraint tasks_policy_source_key;
-- Retain the former uniqueness contract for other policy-linked task sources.
create unique index tasks_other_policy_source_key on public.tasks (organisation_id, policy_id, source)
where source <> 'policy_review';
alter table public.tasks add constraint tasks_policy_review_cycle_key
  unique (organisation_id, policy_id, source, policy_review_due_on);

create function public.preserve_task_occurrence_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    if old.recurrence_generated_at is not null and new.recurrence_generated_at is distinct from old.recurrence_generated_at then
      raise exception 'A generated recurring occurrence cannot be reset' using errcode = '22023';
    end if;
    if new.policy_review_due_on is distinct from old.policy_review_due_on then
      raise exception 'A policy review cycle cannot be changed' using errcode = '22023';
    end if;
  elsif new.source = 'policy_review' and new.policy_id is not null then
    new.policy_review_due_on := coalesce(new.policy_review_due_on, new.due_on,
      (select policy.review_due from public.policies as policy where policy.id = new.policy_id and policy.organisation_id = new.organisation_id), '-infinity'::date);
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_task_occurrence_identity() from public, anon, authenticated, service_role;
create trigger preserve_task_occurrence_identity before insert or update on public.tasks
for each row execute function public.preserve_task_occurrence_identity();

-- System occurrence markers cannot be forged through ordinary table writes.
-- Retain all pre-existing user columns and RLS; only these new system fields
-- are excluded. The cron service may supply the policy date on insertion.
revoke insert, update on public.tasks from authenticated, service_role;
do $$
declare writable_columns text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into writable_columns
  from pg_attribute where attrelid = 'public.tasks'::regclass and attnum > 0 and not attisdropped
    and attname not in ('recurrence_generated_at', 'policy_review_due_on');
  execute format('grant insert (%s), update (%s) on public.tasks to authenticated, service_role', writable_columns, writable_columns);
end;
$$;
grant insert (policy_review_due_on) on public.tasks to service_role;
revoke all on function public.complete_recurring_task(uuid) from public, anon, service_role;
grant execute on function public.complete_recurring_task(uuid) to authenticated;
