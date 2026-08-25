-- Bind every new or retrying daily-digest reservation to the exact Slack
-- channel that the user-scoped application boundary already approved. The
-- application still rechecks the server-only webhook allow-policy immediately
-- before transport; this database boundary closes a selected-channel race.

revoke all on function public.reserve_daily_digest_delivery_server(uuid,uuid,date,text,jsonb)
  from public, anon, authenticated, service_role;
drop function public.reserve_daily_digest_delivery_server(uuid,uuid,date,text,jsonb);

create function public.reserve_daily_digest_delivery_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_expected_channel_id uuid,
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organisation_id::text || ':' || target_digest_on::text, 0)
  );

  select * into delivery
  from public.daily_digest_deliveries
  where organisation_id = target_organisation_id and digest_on = target_digest_on
  for update;

  -- Preserve the durable idempotency outcomes for a delivery that has already
  -- reached a terminal or ambiguous state. These paths create no new mutation.
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
  end if;

  -- The exact prevalidated channel must still be this organisation's selected,
  -- active Slack destination. Check it before setting audit identity or writing
  -- a delivery, attempt, or their generic audit events.
  select id into selected_channel_id
    from public.alert_channels
    where id = target_expected_channel_id
      and organisation_id = target_organisation_id
      and type = 'slack'
      and enabled
      and daily_digest_enabled
      and revoked_at is null
    for update;
  if selected_channel_id is null then
    return pg_catalog.jsonb_build_object('state','no_digest_channel');
  end if;

  if delivery.id is not null and delivery.channel_id <> target_expected_channel_id then
    return pg_catalog.jsonb_build_object('state','no_digest_channel');
  end if;

  -- Only paths that are about to mutate receive the verified actor identity for
  -- the generic audit triggers.
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', target_actor_id, 'role', 'authenticated')::text,
    true
  );

  if delivery.id is not null then
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

  insert into public.daily_digest_deliveries(
    organisation_id, digest_on, channel_id, fact_hash, message, attempted_by
  ) values (
    target_organisation_id, target_digest_on, target_expected_channel_id,
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

alter function public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)
  owner to postgres;
revoke all on function public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)
  to service_role;
