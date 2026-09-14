-- Complete the legacy attempt-history backfill for every delivery state.  A
-- terminal parent without its immutable current attempt is just as incomplete
-- as an abandoned reservation, and would otherwise remain unauditable.
insert into public.daily_digest_delivery_attempts(
  delivery_id,
  organisation_id,
  attempt_number,
  attempted_by,
  started_at,
  finished_at,
  outcome,
  error_code
)
select
  delivery.id,
  delivery.organisation_id,
  delivery.attempt_count,
  delivery.attempted_by,
  delivery.last_attempted_at,
  case
    when delivery.status = 'reserved' then null
    else coalesce(delivery.delivered_at, delivery.last_attempted_at, delivery.reserved_at)
  end,
  case
    when delivery.status = 'reserved' then null
    else delivery.status
  end,
  case
    when delivery.status = 'failed' then
      case
        when delivery.error_code in ('SLACK_REJECTED','RATE_LIMITED','NO_DIGEST_CHANNEL','INTERNAL_ERROR')
          then delivery.error_code
        else 'INTERNAL_ERROR'
      end
    when delivery.status = 'unknown' then 'DELIVERY_UNKNOWN'
    else null
  end
from public.daily_digest_deliveries delivery
where not exists (
  select 1
  from public.daily_digest_delivery_attempts attempt
  where attempt.delivery_id = delivery.id
    and attempt.attempt_number = delivery.attempt_count
)
on conflict (delivery_id, attempt_number) do nothing;

-- Recovery first closes an open current attempt as unknown. If immutable
-- legacy history is already terminal, reconcile the parent to that exact
-- outcome instead of overwriting the attempt or creating contradictory state.
create or replace function public.expire_abandoned_daily_digest_deliveries_server(
  target_organisation_id uuid,
  target_digest_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  stale_delivery record;
  changed integer;
  recovered integer := 0;
  current_outcome public.daily_digest_delivery_status;
  current_error_code text;
  current_finished_at timestamptz;
begin
  for stale_delivery in
    select
      delivery.id,
      delivery.organisation_id,
      delivery.attempt_count,
      delivery.attempted_by,
      delivery.last_attempted_at
    from public.daily_digest_deliveries delivery
    where delivery.status = 'reserved'
      and delivery.last_attempted_at < pg_catalog.now() - interval '15 minutes'
      and (target_organisation_id is null or delivery.organisation_id = target_organisation_id)
      and (target_digest_on is null or delivery.digest_on = target_digest_on)
    order by delivery.last_attempted_at, delivery.id
    limit 100
    for update skip locked
  loop
    update public.daily_digest_delivery_attempts
    set outcome = 'unknown',
        error_code = 'DELIVERY_UNKNOWN',
        finished_at = pg_catalog.now()
    where delivery_id = stale_delivery.id
      and attempt_number = stale_delivery.attempt_count
      and outcome is null;
    get diagnostics changed = row_count;

    if changed = 0 then
      insert into public.daily_digest_delivery_attempts(
        delivery_id,
        organisation_id,
        attempt_number,
        attempted_by,
        started_at,
        finished_at,
        outcome,
        error_code
      ) values (
        stale_delivery.id,
        stale_delivery.organisation_id,
        stale_delivery.attempt_count,
        stale_delivery.attempted_by,
        stale_delivery.last_attempted_at,
        pg_catalog.now(),
        'unknown',
        'DELIVERY_UNKNOWN'
      ) on conflict (delivery_id, attempt_number) do nothing;
    end if;

    select attempt.outcome, attempt.error_code, attempt.finished_at
    into current_outcome, current_error_code, current_finished_at
    from public.daily_digest_delivery_attempts attempt
    where attempt.delivery_id = stale_delivery.id
      and attempt.attempt_number = stale_delivery.attempt_count;

    if current_outcome not in ('delivered','failed','unknown')
      or current_finished_at is null
    then
      raise exception 'daily digest recovery found invalid current attempt history'
        using errcode = 'P0001';
    end if;

    update public.daily_digest_deliveries
    set status = current_outcome,
        error_code = current_error_code,
        delivered_at = case
          when current_outcome = 'delivered' then current_finished_at
          else null
        end
    where id = stale_delivery.id
      and status = 'reserved'
      and attempt_count = stale_delivery.attempt_count;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'abandoned daily digest delivery changed concurrently'
        using errcode = '40001';
    end if;

    recovered := recovered + 1;
  end loop;

  return recovered;
end;
$$;

alter function public.expire_abandoned_daily_digest_deliveries_server(uuid,date) owner to postgres;
revoke all on function public.expire_abandoned_daily_digest_deliveries_server(uuid,date)
  from public, anon, authenticated;
grant execute on function public.expire_abandoned_daily_digest_deliveries_server(uuid,date)
  to service_role;
