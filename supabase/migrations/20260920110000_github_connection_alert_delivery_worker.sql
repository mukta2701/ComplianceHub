-- Connection-only Slack delivery queue for the bounded GitHub reconciliation
-- worker. The legacy enqueue-and-claim function remains available during the
-- rollout; new callers queue work here and claim it through the restricted
-- connection-only worker function below.

create or replace function public.queue_github_connection_alert_delivery(
  target_organisation_id uuid,
  target_channel_id uuid,
  target_installation_id uuid,
  target_kind text,
  target_diagnostic_code text,
  safe_payload jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  notice_idempotency_key text;
  notice_scope_key text;
begin
  if target_organisation_id is null
     or target_channel_id is null
     or target_installation_id is null
     or target_kind is null
     or target_kind not in ('incident', 'recovery')
     or (target_diagnostic_code is not null and target_diagnostic_code not in (
       'provider_rate_limited', 'provider_temporary_failure', 'installation_suspended',
       'installation_revoked', 'permission_mismatch', 'account_mismatch',
       'repository_unavailable', 'invalid_provider_response', 'internal_failure'
     ))
     or safe_payload is null
     or pg_catalog.jsonb_typeof(safe_payload) is distinct from 'object'
     or safe_payload <> pg_catalog.jsonb_build_object(
       'type', safe_payload -> 'type',
       'severity', safe_payload -> 'severity',
       'title', safe_payload -> 'title',
       'controlRef', safe_payload -> 'controlRef',
       'subjectId', safe_payload -> 'subjectId',
       'detail', safe_payload -> 'detail'
     )
     or safe_payload ->> 'type' is distinct from 'connection_health'
     or safe_payload ->> 'severity' is null
     or safe_payload ->> 'severity' not in ('low', 'medium', 'high', 'critical')
     or pg_catalog.jsonb_typeof(safe_payload -> 'title') is distinct from 'string'
     or pg_catalog.char_length(safe_payload ->> 'title') not between 1 and 240
     or (safe_payload ->> 'title') ~ '[\r\n]'
     or pg_catalog.jsonb_typeof(safe_payload -> 'controlRef') is distinct from 'string'
     or pg_catalog.char_length(safe_payload ->> 'controlRef') not between 1 and 80
     or (safe_payload ->> 'controlRef') ~ '[\r\n]'
     or pg_catalog.jsonb_typeof(safe_payload -> 'subjectId') is distinct from 'string'
     or pg_catalog.char_length(safe_payload ->> 'subjectId') not between 1 and 255
     or (safe_payload ->> 'subjectId') ~ '[\r\n]'
     or pg_catalog.jsonb_typeof(safe_payload -> 'detail') is distinct from 'string'
     or pg_catalog.char_length(safe_payload ->> 'detail') not between 1 and 500
     or (safe_payload ->> 'detail') ~ '[\r\n]'
  then
    raise exception using
      errcode = '22023', message = 'Connection alert delivery input is invalid';
  end if;

  perform 1
  from public.github_installations as installation
  where installation.id = target_installation_id
    and installation.organisation_id = target_organisation_id;
  if not found then
    raise exception using
      errcode = '42501', message = 'GitHub installation belongs to another workspace';
  end if;

  perform 1
  from public.alert_channels as channel
  where channel.id = target_channel_id
    and channel.organisation_id = target_organisation_id
    and channel.type = 'slack'
    and channel.enabled
    and channel.revoked_at is null
    and array_position(array['low','medium','high','critical'], safe_payload ->> 'severity')
      >= array_position(array['low','medium','high','critical'], channel.min_severity::text)
  for share;
  if not found then
    raise exception using
      errcode = 'P0001', message = 'Slack alert channel is unavailable';
  end if;

  notice_idempotency_key := pg_catalog.encode(
    extensions.digest(
      'github-connection:' || target_installation_id::text || ':' || target_kind || ':'
        || coalesce(target_diagnostic_code, 'none'),
      'sha256'
    ),
    'hex'
  );
  notice_scope_key := 'github-connection:' || notice_idempotency_key;

  insert into public.alert_deliveries(
    organisation_id, channel_id, kind, subject_type, subject_id,
    installation_id, scope_key, idempotency_key, safe_payload, delivery_on
  ) values (
    target_organisation_id, target_channel_id,
    'github_connection_health', 'github_installation', target_installation_id::text,
    target_installation_id, notice_scope_key, notice_idempotency_key,
    safe_payload, current_date
  )
  on conflict (organisation_id, channel_id, kind, scope_key, delivery_on)
    do nothing;

  return found;
end;
$$;

alter function public.queue_github_connection_alert_delivery(
  uuid, uuid, uuid, text, text, jsonb
) owner to postgres;
revoke all on function public.queue_github_connection_alert_delivery(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.queue_github_connection_alert_delivery(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

create or replace function public.claim_github_connection_alert_delivery(worker_id text)
returns table (
  delivery_id uuid,
  organisation_id uuid,
  channel_id uuid,
  lock_token uuid,
  attempt_count integer,
  safe_payload jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_delivery record;
  claimed_lock_token uuid := extensions.gen_random_uuid();
  stale_delivery record;
begin
  if worker_id is null or worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception using
      errcode = '22023', message = 'Alert delivery worker identity is invalid';
  end if;

  for stale_delivery in
    with selected_stale as (
      select delivery.id
      from public.alert_deliveries as delivery
      where delivery.status = 'running'
        and delivery.kind = 'github_connection_health'
        and delivery.subject_type = 'github_installation'
        and delivery.installation_id is not null
        and delivery.safe_payload ->> 'type' = 'connection_health'
        and delivery.locked_at
          <= pg_catalog.clock_timestamp() - interval '5 minutes'
      order by delivery.locked_at, delivery.id
      for update of delivery skip locked
      limit 25
    )
    update public.alert_deliveries as delivery
    set status = case when delivery.attempt_count >= 5 then 'terminal' else 'failed' end,
        locked_at = null, locked_by = null, lock_token = null,
        next_attempt_at = pg_catalog.clock_timestamp(),
        terminal_at = case when delivery.attempt_count >= 5
          then pg_catalog.clock_timestamp() else null end,
        safe_error = case when delivery.attempt_count >= 5
          then 'Alert delivery could not be completed.'
          else 'Alert delivery failed. Retry scheduled.' end,
        updated_at = pg_catalog.clock_timestamp()
    from selected_stale
    where delivery.id = selected_stale.id
    returning delivery.organisation_id, delivery.channel_id,
              delivery.attempt_count, delivery.status
  loop
    if stale_delivery.attempt_count >= 5 then
      insert into public.notifications(
        organisation_id, user_id, kind, subject_type, subject_id,
        message, sweep_on
      )
      select stale_delivery.organisation_id, membership.user_id,
             'alert_delivery_failed', 'alert_channel',
             stale_delivery.channel_id::text,
             'Slack alert delivery could not be completed. Check the connection in Settings.',
             current_date
      from public.memberships as membership
      where membership.organisation_id = stale_delivery.organisation_id
        and membership.role in ('owner', 'admin')
      on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing;
    end if;
  end loop;

  select delivery.* into selected_delivery
  from public.alert_deliveries as delivery
  join public.alert_channels as channel
    on channel.id = delivery.channel_id
   and channel.organisation_id = delivery.organisation_id
   and channel.type = 'slack'
   and channel.enabled
   and channel.revoked_at is null
  where delivery.status in ('queued', 'failed')
    and delivery.kind = 'github_connection_health'
    and delivery.subject_type = 'github_installation'
    and delivery.installation_id is not null
    and delivery.safe_payload ->> 'type' = 'connection_health'
    and array_position(array['low','medium','high','critical'], delivery.safe_payload ->> 'severity')
      >= array_position(array['low','medium','high','critical'], channel.min_severity::text)
    and delivery.attempt_count < 5
    and delivery.next_attempt_at <= pg_catalog.clock_timestamp()
  order by delivery.next_attempt_at, delivery.created_at, delivery.id
  for update of delivery skip locked
  limit 1;
  if not found then return; end if;

  update public.alert_deliveries as delivery
  set status = 'running', attempt_count = delivery.attempt_count + 1,
      locked_at = pg_catalog.clock_timestamp(), locked_by = worker_id,
      lock_token = claimed_lock_token,
      last_attempt_at = pg_catalog.clock_timestamp(), safe_error = null,
      updated_at = pg_catalog.clock_timestamp()
  where delivery.id = selected_delivery.id;

  return query select selected_delivery.id, selected_delivery.organisation_id,
    selected_delivery.channel_id, claimed_lock_token,
    selected_delivery.attempt_count + 1, selected_delivery.safe_payload;
end;
$$;

alter function public.claim_github_connection_alert_delivery(text) owner to postgres;
revoke all on function public.claim_github_connection_alert_delivery(text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_github_connection_alert_delivery(text)
  to service_role;
