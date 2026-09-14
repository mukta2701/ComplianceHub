-- Durable Slack delivery and native connection health notifications. Provider
-- exceptions and webhook credentials never cross this boundary: callers submit
-- only fixed failure codes or the bounded monitoring payload defined below.

create table public.alert_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  channel_id uuid not null,
  connection_id uuid,
  target_id uuid,
  kind text not null,
  subject_type text not null,
  subject_id text not null,
  scope_key text not null,
  idempotency_key text not null,
  safe_payload jsonb not null,
  delivery_on date not null default current_date,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  lock_token uuid,
  delivered_at timestamptz,
  terminal_at timestamptz,
  safe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alert_deliveries_channel_tenant_fk
    foreign key (channel_id, organisation_id)
    references public.alert_channels(id, organisation_id) on delete cascade,
  constraint alert_deliveries_connection_tenant_fk
    foreign key (connection_id, organisation_id)
    references public.integration_connections(id, organisation_id) on delete cascade,
  constraint alert_deliveries_target_tenant_fk
    foreign key (target_id, organisation_id)
    references public.integration_connection_targets(id, organisation_id) on delete cascade,
  constraint alert_deliveries_kind_check check (
    (kind = 'monitoring_finding' and subject_type = 'monitoring_finding'
      and connection_id is null and target_id is null
      and safe_payload ->> 'type' = 'monitoring_finding')
    or
    (kind = 'connection_health' and subject_type = 'integration_connection'
      and connection_id is not null and target_id is null
      and safe_payload ->> 'type' = 'connection_health')
    or
    (kind = 'connection_health' and subject_type = 'integration_connection_target'
      and connection_id is not null and target_id is not null
      and safe_payload ->> 'type' = 'connection_health')
  ),
  constraint alert_deliveries_subject_check check (
    pg_catalog.char_length(subject_id) between 1 and 512
    and subject_id !~ '[\r\n]'
    and pg_catalog.char_length(scope_key) between 1 and 96
    and scope_key !~ '[\r\n]'
    and idempotency_key ~ '^[0-9a-f]{64}$'
  ),
  constraint alert_deliveries_safe_payload_check check ((
    pg_catalog.jsonb_typeof(safe_payload) = 'object'
    and safe_payload = pg_catalog.jsonb_build_object(
      'type', safe_payload -> 'type',
      'severity', safe_payload -> 'severity',
      'title', safe_payload -> 'title',
      'controlRef', safe_payload -> 'controlRef',
      'subjectId', safe_payload -> 'subjectId',
      'detail', safe_payload -> 'detail'
    )
    and safe_payload ->> 'type' in ('monitoring_finding', 'connection_health')
    and safe_payload ->> 'severity' in ('low', 'medium', 'high', 'critical')
    and pg_catalog.jsonb_typeof(safe_payload -> 'title') = 'string'
    and pg_catalog.char_length(safe_payload ->> 'title') between 1 and 240
    and (safe_payload ->> 'title') !~ '[\r\n]'
    and pg_catalog.jsonb_typeof(safe_payload -> 'controlRef') = 'string'
    and pg_catalog.char_length(safe_payload ->> 'controlRef') between 1 and 80
    and (safe_payload ->> 'controlRef') !~ '[\r\n]'
    and pg_catalog.jsonb_typeof(safe_payload -> 'subjectId') = 'string'
    and pg_catalog.char_length(safe_payload ->> 'subjectId') between 1 and 255
    and (safe_payload ->> 'subjectId') !~ '[\r\n]'
    and pg_catalog.jsonb_typeof(safe_payload -> 'detail') = 'string'
    and pg_catalog.char_length(safe_payload ->> 'detail') between 1 and 500
    and (safe_payload ->> 'detail') !~ '[\r\n]'
  ) is true),
  constraint alert_deliveries_attempt_count_check check (
    attempt_count between 0 and 5
  ),
  constraint alert_deliveries_safe_error_check check (
    safe_error is null or safe_error in (
      'Alert delivery failed. Retry scheduled.',
      'Alert delivery could not be completed.'
    )
  ),
  constraint alert_deliveries_state_check check (
    (status = 'queued' and attempt_count = 0
      and locked_at is null and locked_by is null and lock_token is null
      and delivered_at is null and terminal_at is null and safe_error is null)
    or
    (status = 'running' and attempt_count between 1 and 5
      and locked_at is not null and locked_by is not null and lock_token is not null
      and delivered_at is null and terminal_at is null and safe_error is null)
    or
    (status = 'failed' and attempt_count between 1 and 4
      and locked_at is null and locked_by is null and lock_token is null
      and delivered_at is null and terminal_at is null
      and safe_error = 'Alert delivery failed. Retry scheduled.')
    or
    (status = 'delivered' and attempt_count between 1 and 5
      and locked_at is null and locked_by is null and lock_token is null
      and delivered_at is not null and terminal_at is null and safe_error is null)
    or
    (status = 'terminal' and attempt_count = 5
      and locked_at is null and locked_by is null and lock_token is null
      and delivered_at is null and terminal_at is not null
      and safe_error = 'Alert delivery could not be completed.')
    or
    (status = 'cancelled' and attempt_count between 0 and 5
      and locked_at is null and locked_by is null and lock_token is null
      and delivered_at is null and terminal_at is not null and safe_error is null)
  )
);

create unique index alert_deliveries_scope_day_dedup
on public.alert_deliveries(
  organisation_id, channel_id, kind, scope_key, delivery_on
);

create unique index alert_deliveries_idempotency_day_dedup
on public.alert_deliveries(
  organisation_id, channel_id, idempotency_key, delivery_on
);

create index alert_deliveries_due_idx
on public.alert_deliveries(next_attempt_at, created_at, id)
where status in ('queued', 'failed') and attempt_count < 5;

create index alert_deliveries_stale_lease_idx
on public.alert_deliveries(locked_at, id)
where status = 'running';

create index alert_deliveries_retention_idx
on public.alert_deliveries(
  coalesce(delivered_at, terminal_at), id
)
where status in ('delivered', 'terminal', 'cancelled');

create index alert_deliveries_operator_history_idx
on public.alert_deliveries(organisation_id, created_at desc, id);

create trigger alert_deliveries_audit
after insert or update or delete on public.alert_deliveries
for each row execute function public.capture_audit_event();

alter table public.alert_deliveries enable row level security;

create policy alert_deliveries_operator_select
on public.alert_deliveries for select to authenticated
using (public.is_organisation_operator(organisation_id));

revoke all on public.alert_deliveries from public, anon, authenticated;
grant select on public.alert_deliveries to authenticated;
grant select on public.alert_deliveries to service_role;

-- Pausing or revoking a channel is also a durable queue lifecycle event. The
-- trigger is definer-owned because browser operators may update only the safe
-- channel columns and have no direct alert-delivery mutation privilege.
create function public.cancel_alert_deliveries_for_channel()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (old.enabled and not new.enabled)
     or (old.revoked_at is null and new.revoked_at is not null) then
    update public.alert_deliveries as delivery
    set status = 'cancelled', locked_at = null, locked_by = null,
        lock_token = null, terminal_at = pg_catalog.clock_timestamp(),
        safe_error = null, updated_at = pg_catalog.clock_timestamp()
    where delivery.organisation_id = new.organisation_id
      and delivery.channel_id = new.id
      and delivery.status in ('queued', 'failed', 'running');
  end if;
  return new;
end;
$$;

alter function public.cancel_alert_deliveries_for_channel() owner to postgres;
revoke all on function public.cancel_alert_deliveries_for_channel()
  from public, anon, authenticated, service_role;

create trigger alert_channels_cancel_queued_deliveries
after update of enabled, revoked_at on public.alert_channels
for each row execute function public.cancel_alert_deliveries_for_channel();

-- Internal fixed-copy helper. No API role, including service_role, can invoke it
-- directly; it is reached only from the postgres-owned health functions below.
create function public.queue_native_connection_failure_alerts(
  target_organisation_id uuid,
  target_connection_id uuid,
  target_target_id uuid,
  target_provider public.integration_provider,
  failure_code text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  safe_failure_message text;
  provider_label text;
  alert_title text;
  notification_message text;
  health_subject_type text;
  health_subject_id text;
  health_scope_key text;
  health_idempotency_key text;
  active_connection record;
begin
  safe_failure_message := case failure_code
    when 'provider_unavailable' then 'Provider is temporarily unavailable. Try again shortly.'
    when 'rate_limited' then 'Provider rate limit reached. Retry scheduled.'
    when 'invalid_response' then 'Provider returned an invalid response. Retry scheduled.'
    when 'configuration_error' then 'Connection settings need attention.'
    when 'unexpected_error' then 'Synchronization failed unexpectedly. Retry scheduled.'
    else null
  end;
  if safe_failure_message is null then
    raise exception using
      errcode = '22023', message = 'Synchronization failure is invalid';
  end if;

  select connection.id, connection.organisation_id, connection.provider
  into active_connection
  from public.integration_connections as connection
  where connection.id = target_connection_id
    and connection.organisation_id = target_organisation_id
    and connection.provider = target_provider
    and connection.connection_mode = 'jira_oauth'
    and connection.enabled
    and connection.revoked_at is null;
  if not found then return; end if;

  provider_label := case target_provider
    when 'github' then 'GitHub'
    when 'jira' then 'Jira'
    else 'Provider'
  end;

  if target_target_id is null then
    update public.integration_connections as connection
    set health = 'needs_attention'::public.integration_connection_health,
        last_sync_attempt_at = pg_catalog.clock_timestamp(),
        last_error = safe_failure_message
    where connection.id = target_connection_id
      and connection.organisation_id = target_organisation_id
      and connection.provider = target_provider
      and connection.enabled
      and connection.revoked_at is null;
    health_subject_type := 'integration_connection';
    health_subject_id := target_connection_id::text;
    health_scope_key := 'connection:' || target_connection_id::text;
    alert_title := provider_label || ' connection needs attention';
  else
    update public.integration_connection_targets as target
    set health = 'needs_attention'::public.integration_connection_health,
        last_sync_attempt_at = pg_catalog.clock_timestamp(),
        last_error = safe_failure_message
    where target.id = target_target_id
      and target.organisation_id = target_organisation_id
      and target.connection_id = target_connection_id
      and target.provider = target_provider
      and target.enabled
      and target.revoked_at is null;
    if not found then return; end if;
    health_subject_type := 'integration_connection_target';
    health_subject_id := target_target_id::text;
    health_scope_key := 'target:' || target_target_id::text;
    alert_title := provider_label || ' target needs attention';
  end if;

  notification_message := alert_title || '. Open Connections to review it.';
  insert into public.notifications(
    organisation_id, user_id, kind, subject_type, subject_id,
    message, sweep_on
  )
  select target_organisation_id, membership.user_id,
         'connection_health', health_subject_type, health_subject_id,
         notification_message, current_date
  from public.memberships as membership
  where membership.organisation_id = target_organisation_id
    and membership.role in ('owner', 'admin')
  on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing;

  health_idempotency_key := pg_catalog.encode(
    extensions.digest(
      'connection_health:' || health_scope_key,
      'sha256'
    ),
    'hex'
  );
  insert into public.alert_deliveries(
    organisation_id, channel_id, connection_id, target_id,
    kind, subject_type, subject_id, scope_key, idempotency_key,
    safe_payload, delivery_on
  )
  select target_organisation_id, channel.id, target_connection_id, target_target_id,
         'connection_health', health_subject_type, health_subject_id,
         health_scope_key, health_idempotency_key,
         pg_catalog.jsonb_build_object(
           'type', 'connection_health',
           'severity', 'high',
           'title', alert_title,
           'controlRef', 'Connection health',
           'subjectId', provider_label,
           'detail', safe_failure_message
         ),
         current_date
  from public.alert_channels as channel
  where channel.organisation_id = target_organisation_id
    and channel.type = 'slack'
    and channel.enabled
    and channel.revoked_at is null
    and channel.min_severity in ('low', 'medium', 'high')
  on conflict (organisation_id, channel_id, kind, scope_key, delivery_on)
    do nothing;
end;
$$;

alter function public.queue_native_connection_failure_alerts(
  uuid, uuid, uuid, public.integration_provider, text
) owner to postgres;
revoke all on function public.queue_native_connection_failure_alerts(
  uuid, uuid, uuid, public.integration_provider, text
) from public, anon, authenticated, service_role;

create function public.record_native_monitor_source_failure(
  target_source_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_record record;
begin
  select source.organisation_id, source.integration_connection_id as connection_id,
         source.integration_connection_target_id as target_id,
         source.provider
  into source_record
  from public.monitor_sources as source
  join public.integration_connections as connection
    on connection.id = source.integration_connection_id
   and connection.organisation_id = source.organisation_id
   and connection.provider = source.provider
   and connection.enabled
   and connection.revoked_at is null
  join public.integration_connection_targets as target
    on target.id = source.integration_connection_target_id
   and target.organisation_id = source.organisation_id
   and target.connection_id = connection.id
   and target.provider = source.provider
   and target.enabled
   and target.revoked_at is null
  where source.id = target_source_id
    and source.connection_mode = 'jira_oauth'
    and source.enabled
    and source.revoked_at is null;
  if not found then
    raise exception using
      errcode = 'P0001', message = 'Native monitoring source is unavailable';
  end if;

  perform public.queue_native_connection_failure_alerts(
    source_record.organisation_id,
    source_record.connection_id,
    source_record.target_id,
    source_record.provider,
    'provider_unavailable'
  );
  return true;
end;
$$;

alter function public.record_native_monitor_source_failure(uuid) owner to postgres;
revoke all on function public.record_native_monitor_source_failure(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_native_monitor_source_failure(uuid)
  to service_role;

create function public.enqueue_and_claim_monitoring_alert_delivery(
  target_organisation_id uuid,
  target_channel_id uuid,
  target_subject_id text,
  safe_payload jsonb,
  worker_id text
)
returns table (delivery_id uuid, lock_token uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_delivery_id uuid;
  claimed_lock_token uuid := extensions.gen_random_uuid();
  finding_scope_key text;
  finding_idempotency_key text;
begin
  if worker_id is null or worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or target_subject_id is null
     or pg_catalog.char_length(target_subject_id) not between 1 and 512
     or target_subject_id ~ '[\r\n]'
     or safe_payload ->> 'type' is distinct from 'monitoring_finding' then
    raise exception using
      errcode = '22023', message = 'Alert delivery input is invalid';
  end if;
  perform 1 from public.alert_channels as channel
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

  finding_idempotency_key := pg_catalog.encode(
    extensions.digest(
      'monitoring_finding:' || target_subject_id,
      'sha256'
    ),
    'hex'
  );
  finding_scope_key := 'finding:' || finding_idempotency_key;
  insert into public.alert_deliveries(
    organisation_id, channel_id, kind, subject_type, subject_id,
    scope_key, idempotency_key, safe_payload, delivery_on
  ) values (
    target_organisation_id, target_channel_id,
    'monitoring_finding', 'monitoring_finding', target_subject_id,
    finding_scope_key, finding_idempotency_key, safe_payload, current_date
  )
  on conflict (organisation_id, channel_id, kind, scope_key, delivery_on)
    do nothing;

  select delivery.id into stored_delivery_id
  from public.alert_deliveries as delivery
  where delivery.organisation_id = target_organisation_id
    and delivery.channel_id = target_channel_id
    and delivery.kind = 'monitoring_finding'
    and delivery.scope_key = finding_scope_key
    and delivery.delivery_on = current_date
    and delivery.status in ('queued', 'failed')
    and delivery.attempt_count < 5
    and delivery.next_attempt_at <= pg_catalog.clock_timestamp()
  for update skip locked;
  if not found then return; end if;

  update public.alert_deliveries as delivery
  set status = 'running', attempt_count = delivery.attempt_count + 1,
      locked_at = pg_catalog.clock_timestamp(), locked_by = worker_id,
      lock_token = claimed_lock_token, last_attempt_at = pg_catalog.clock_timestamp(),
      safe_error = null, updated_at = pg_catalog.clock_timestamp()
  where delivery.id = stored_delivery_id;

  return query select stored_delivery_id, claimed_lock_token;
end;
$$;

alter function public.enqueue_and_claim_monitoring_alert_delivery(
  uuid, uuid, text, jsonb, text
) owner to postgres;
revoke all on function public.enqueue_and_claim_monitoring_alert_delivery(
  uuid, uuid, text, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_and_claim_monitoring_alert_delivery(
  uuid, uuid, text, jsonb, text
) to service_role;

create function public.claim_alert_delivery(worker_id text)
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
    and array_position(array['low','medium','high','critical'], delivery.safe_payload ->> 'severity')
      >= array_position(array['low','medium','high','critical'], channel.min_severity::text)
    and (delivery.connection_id is null or exists (
      select 1 from public.integration_connections connection
      where connection.id = delivery.connection_id and connection.organisation_id = delivery.organisation_id
        and connection.connection_mode = 'jira_oauth' and connection.enabled and connection.revoked_at is null
    ))
    and (delivery.target_id is null or exists (
      select 1 from public.integration_connection_targets target
      where target.id = delivery.target_id and target.connection_id = delivery.connection_id
        and target.organisation_id = delivery.organisation_id and target.enabled and target.revoked_at is null
    ))
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

alter function public.claim_alert_delivery(text) owner to postgres;
revoke all on function public.claim_alert_delivery(text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_alert_delivery(text) to service_role;

create function public.complete_alert_delivery(
  target_delivery_id uuid,
  claimed_lock_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.alert_deliveries as delivery
  set status = 'delivered', locked_at = null, locked_by = null,
      lock_token = null, delivered_at = pg_catalog.clock_timestamp(),
      safe_error = null, updated_at = pg_catalog.clock_timestamp()
  where delivery.id = target_delivery_id
    and delivery.status = 'running'
    and delivery.lock_token = claimed_lock_token;
  return found;
end;
$$;

alter function public.complete_alert_delivery(uuid, uuid) owner to postgres;
revoke all on function public.complete_alert_delivery(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_alert_delivery(uuid, uuid)
  to service_role;

create function public.fail_alert_delivery(
  target_delivery_id uuid,
  claimed_lock_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_delivery record;
  retry_delay_seconds integer;
begin
  select delivery.* into selected_delivery
  from public.alert_deliveries as delivery
  where delivery.id = target_delivery_id
    and delivery.status = 'running'
    and delivery.lock_token = claimed_lock_token
  for update;
  if not found then return false; end if;

  if selected_delivery.attempt_count >= 5 then
    update public.alert_deliveries as delivery
    set status = 'terminal', locked_at = null, locked_by = null,
        lock_token = null, terminal_at = pg_catalog.clock_timestamp(),
        safe_error = 'Alert delivery could not be completed.',
        updated_at = pg_catalog.clock_timestamp()
    where delivery.id = target_delivery_id;

    insert into public.notifications(
      organisation_id, user_id, kind, subject_type, subject_id,
      message, sweep_on
    )
    select selected_delivery.organisation_id, membership.user_id,
           'alert_delivery_failed', 'alert_channel',
           selected_delivery.channel_id::text,
           'Slack alert delivery could not be completed. Check the connection in Settings.',
           current_date
    from public.memberships as membership
    where membership.organisation_id = selected_delivery.organisation_id
      and membership.role in ('owner', 'admin')
    on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing;
  else
    retry_delay_seconds := least(
      3600,
      (60 * pg_catalog.power(2::numeric, selected_delivery.attempt_count - 1))::integer
    );
    update public.alert_deliveries as delivery
    set status = 'failed', locked_at = null, locked_by = null,
        lock_token = null,
        next_attempt_at = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => retry_delay_seconds),
        safe_error = 'Alert delivery failed. Retry scheduled.',
        updated_at = pg_catalog.clock_timestamp()
    where delivery.id = target_delivery_id;
  end if;
  return true;
end;
$$;

alter function public.fail_alert_delivery(uuid, uuid) owner to postgres;
revoke all on function public.fail_alert_delivery(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_alert_delivery(uuid, uuid)
  to service_role;
