-- A process can stop after reserving a Slack delivery but before it records the
-- network outcome. Once such an attempt is 15 minutes old, conservatively mark
-- it unknown: Slack may have accepted it, so it must never enter the retry path.

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
    select delivery.id, delivery.attempt_count
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
    if changed <> 1 then
      raise exception 'abandoned daily digest attempt history is inconsistent'
        using errcode = 'P0001';
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
