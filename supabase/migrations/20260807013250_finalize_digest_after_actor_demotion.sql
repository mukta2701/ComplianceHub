-- A database preflight can fail before Slack is contacted. Persist that as a
-- confirmed, retryable failure rather than an ambiguous external outcome.
alter table public.daily_digest_delivery_attempts
drop constraint daily_digest_attempt_outcome_check;
alter table public.daily_digest_delivery_attempts
add constraint daily_digest_attempt_outcome_check check (
  (outcome is null and finished_at is null and error_code is null)
  or (outcome = 'delivered' and finished_at is not null and error_code is null)
  or (outcome = 'failed' and finished_at is not null and error_code in ('SLACK_REJECTED','RATE_LIMITED','NO_DIGEST_CHANNEL','INTERNAL_ERROR'))
  or (outcome = 'unknown' and finished_at is not null and error_code = 'DELIVERY_UNKNOWN')
);

-- Authorization happens when the attempt is reserved. Finalization occurs only
-- after (or immediately before) the external side effect and must remain able
-- to record its confirmed result if the actor is demoted in the meantime. The
-- immutable delivery actor and exact open attempt are the finalization proof.
create or replace function public.finalize_daily_digest_delivery_server(
  target_delivery_id uuid,
  target_actor_id uuid,
  target_attempt_number integer,
  target_outcome text,
  target_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.daily_digest_deliveries;
  changed integer;
begin
  select * into delivery from public.daily_digest_deliveries
  where id = target_delivery_id for update;
  if not found then return false; end if;
  if target_actor_id is null or delivery.attempted_by <> target_actor_id then
    return false;
  end if;
  if target_attempt_number is null
    or target_outcome not in ('delivered','failed','unknown')
    or (target_outcome = 'delivered' and target_error_code is not null)
    or (target_outcome = 'failed' and target_error_code not in ('SLACK_REJECTED','RATE_LIMITED','NO_DIGEST_CHANNEL','INTERNAL_ERROR'))
    or (target_outcome = 'unknown' and target_error_code <> 'DELIVERY_UNKNOWN')
  then
    raise exception 'invalid daily digest outcome' using errcode = '22023';
  end if;
  if delivery.status <> 'reserved' or delivery.attempt_count <> target_attempt_number then
    return false;
  end if;
  if not exists (
    select 1 from public.daily_digest_delivery_attempts
    where delivery_id = target_delivery_id
      and attempt_number = target_attempt_number
      and attempted_by = target_actor_id
      and outcome is null
      and finished_at is null
  ) then
    return false;
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', target_actor_id, 'role', 'authenticated')::text,
    true
  );
  update public.daily_digest_delivery_attempts
  set outcome = target_outcome::public.daily_digest_delivery_status,
      error_code = target_error_code,
      finished_at = pg_catalog.now()
  where delivery_id = target_delivery_id
    and attempt_number = target_attempt_number
    and attempted_by = target_actor_id
    and outcome is null
    and finished_at is null;
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;

  update public.daily_digest_deliveries
  set status = target_outcome::public.daily_digest_delivery_status,
      error_code = target_error_code,
      last_attempted_at = pg_catalog.now(),
      delivered_at = case when target_outcome = 'delivered' then pg_catalog.now() else null end
  where id = target_delivery_id
    and attempted_by = target_actor_id
    and status = 'reserved'
    and attempt_count = target_attempt_number;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'daily digest finalization compare-and-set failed' using errcode = '40001';
  end if;
  return true;
end;
$$;

revoke all on function public.finalize_daily_digest_delivery_server(uuid,uuid,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_daily_digest_delivery_server(uuid,uuid,integer,text,text)
  to service_role;
