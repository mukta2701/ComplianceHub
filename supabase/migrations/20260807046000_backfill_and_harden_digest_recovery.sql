-- Deployments that accepted a reservation before per-attempt history existed
-- may have a reserved delivery with no matching attempt row. Backfill the live
-- attempt idempotently, then keep recovery conservative if future inconsistent
-- legacy data is encountered: synthesize unknown history instead of rolling
-- back the entire recovery batch and leaving every later row blocked.

insert into public.daily_digest_delivery_attempts(
  delivery_id,
  organisation_id,
  attempt_number,
  attempted_by,
  started_at
)
select
  delivery.id,
  delivery.organisation_id,
  delivery.attempt_count,
  delivery.attempted_by,
  delivery.last_attempted_at
from public.daily_digest_deliveries delivery
where delivery.status = 'reserved'
  and not exists (
    select 1
    from public.daily_digest_delivery_attempts attempt
    where attempt.delivery_id = delivery.id
      and attempt.attempt_number = delivery.attempt_count
  )
on conflict (delivery_id, attempt_number) do nothing;

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

    update public.daily_digest_deliveries
    set status = 'unknown',
        error_code = 'DELIVERY_UNKNOWN',
        delivered_at = null
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
