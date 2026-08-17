-- The authenticated Data API must never be able to manufacture an outgoing
-- payload or terminal Slack result. Only the Next server's service-role client
-- can invoke the actor-bound lifecycle functions below.
revoke all on function public.reserve_daily_digest_delivery(uuid,date,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_daily_digest_delivery(uuid,integer,text,text)
  from public, anon, authenticated, service_role;

drop function public.reserve_daily_digest_delivery(uuid,date,text,jsonb);
drop function public.finalize_daily_digest_delivery(uuid,integer,text,text);

alter table public.daily_digest_delivery_attempts
drop constraint daily_digest_attempt_outcome_check;
alter table public.daily_digest_delivery_attempts
add constraint daily_digest_attempt_outcome_check check (
  (outcome is null and finished_at is null and error_code is null)
  or (outcome = 'delivered' and finished_at is not null and error_code is null)
  or (outcome = 'failed' and finished_at is not null and error_code in ('SLACK_REJECTED','RATE_LIMITED','NO_DIGEST_CHANNEL'))
  or (outcome = 'unknown' and finished_at is not null and error_code = 'DELIVERY_UNKNOWN')
);

create or replace function public.reserve_daily_digest_delivery_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_digest_on date,
  target_fact_hash text,
  target_message jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_channel_id uuid;
  delivery public.daily_digest_deliveries;
  next_attempt integer;
begin
  if target_actor_id is null or not exists (
    select 1 from public.memberships
    where organisation_id = target_organisation_id
      and user_id = target_actor_id
      and role = 'owner'
  ) then
    raise exception 'daily digest action requires a workspace Owner' using errcode = '42501';
  end if;
  if target_digest_on is null
    or target_fact_hash is null
    or target_fact_hash !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(target_message) <> 'object'
    or pg_catalog.jsonb_typeof(target_message -> 'text') <> 'string'
    or pg_catalog.jsonb_typeof(target_message -> 'blocks') <> 'array'
    or pg_catalog.pg_column_size(target_message) > 32768
  then
    raise exception 'invalid daily digest reservation' using errcode = '22023';
  end if;

  -- The actor was proven from membership by this non-user-callable function;
  -- expose that identity only transaction-locally so generic audit triggers
  -- retain the verified OAuth actor rather than the service role.
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', target_actor_id, 'role', 'authenticated')::text,
    true
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organisation_id::text || ':' || target_digest_on::text, 0)
  );

  select * into delivery
  from public.daily_digest_deliveries
  where organisation_id = target_organisation_id and digest_on = target_digest_on
  for update;

  if found then
    if delivery.status = 'delivered' then
      return pg_catalog.jsonb_build_object('state','already_posted');
    end if;
    if delivery.status in ('reserved','unknown')
      or delivery.fact_hash <> target_fact_hash
      or delivery.attempt_count >= 10
    then
      return pg_catalog.jsonb_build_object('state','delivery_unknown');
    end if;
    if not exists (
      select 1 from public.alert_channels
      where id = delivery.channel_id
        and organisation_id = target_organisation_id
        and type = 'slack'
        and enabled
        and daily_digest_enabled
        and revoked_at is null
    ) then
      return pg_catalog.jsonb_build_object('state','no_digest_channel');
    end if;

    next_attempt := delivery.attempt_count + 1;
    update public.daily_digest_deliveries
    set status = 'reserved',
        attempt_count = next_attempt,
        error_code = null,
        delivered_at = null,
        last_attempted_at = pg_catalog.now()
    where id = delivery.id and status = 'failed' and attempt_count = delivery.attempt_count;
    if not found then
      return pg_catalog.jsonb_build_object('state','delivery_unknown');
    end if;
    insert into public.daily_digest_delivery_attempts(
      delivery_id, organisation_id, attempt_number, attempted_by
    ) values (delivery.id, target_organisation_id, next_attempt, target_actor_id);
    return pg_catalog.jsonb_build_object(
      'state','reserved', 'deliveryId',delivery.id, 'channelId',delivery.channel_id,
      'attemptNumber',next_attempt, 'message',delivery.message
    );
  end if;

  select id into selected_channel_id
  from public.alert_channels
  where organisation_id = target_organisation_id
    and type = 'slack'
    and enabled
    and daily_digest_enabled
    and revoked_at is null
  order by id
  limit 1;
  if selected_channel_id is null then
    return pg_catalog.jsonb_build_object('state','no_digest_channel');
  end if;

  insert into public.daily_digest_deliveries(
    organisation_id, digest_on, channel_id, fact_hash, message, attempted_by
  ) values (
    target_organisation_id, target_digest_on, selected_channel_id,
    target_fact_hash, target_message, target_actor_id
  ) returning * into delivery;
  insert into public.daily_digest_delivery_attempts(
    delivery_id, organisation_id, attempt_number, attempted_by
  ) values (delivery.id, target_organisation_id, 1, target_actor_id);

  return pg_catalog.jsonb_build_object(
    'state','reserved', 'deliveryId',delivery.id, 'channelId',delivery.channel_id,
    'attemptNumber',1, 'message',delivery.message
  );
end;
$$;

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
  if target_actor_id is null or not exists (
    select 1 from public.memberships
    where organisation_id = delivery.organisation_id
      and user_id = target_actor_id
      and role = 'owner'
  ) then
    raise exception 'daily digest action requires a workspace Owner' using errcode = '42501';
  end if;
  if target_attempt_number is null
    or target_outcome not in ('delivered','failed','unknown')
    or (target_outcome = 'delivered' and target_error_code is not null)
    or (target_outcome = 'failed' and target_error_code not in ('SLACK_REJECTED','RATE_LIMITED','NO_DIGEST_CHANNEL'))
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
    and status = 'reserved'
    and attempt_count = target_attempt_number;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'daily digest finalization compare-and-set failed' using errcode = '40001';
  end if;
  return true;
end;
$$;

revoke all on function public.reserve_daily_digest_delivery_server(uuid,uuid,date,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_daily_digest_delivery_server(uuid,uuid,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_daily_digest_delivery_server(uuid,uuid,date,text,jsonb)
  to service_role;
grant execute on function public.finalize_daily_digest_delivery_server(uuid,uuid,integer,text,text)
  to service_role;
