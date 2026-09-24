-- Give each new GitHub connection incident and recovery its own durable alert
-- identity. The existing public function signatures remain unchanged.

create or replace function public.record_github_connection_notice_server(
  target_organisation_id uuid,
  target_installation_id uuid,
  target_kind text,
  target_diagnostic_code text,
  target_account_login text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  installation_organisation_id uuid;
  open_key text;
  incident_id uuid;
  is_new boolean := false;
  resolved_count integer := 0;
  resolved_ids uuid[];
  notified_user_ids uuid[] := '{}';
  notice_message text;
  notice_kind text;
  notice_subject_id text;
begin
  if target_organisation_id is null
    or target_installation_id is null
    or target_kind is null
    or target_kind not in ('incident', 'recovery')
    or (target_diagnostic_code is not null and target_diagnostic_code not in (
      'provider_rate_limited', 'provider_temporary_failure', 'installation_suspended',
      'installation_revoked', 'permission_mismatch', 'account_mismatch',
      'repository_unavailable', 'invalid_provider_response', 'internal_failure'
    ))
    or target_account_login is null
    or target_account_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$'
  then
    raise exception 'invalid GitHub connection notice' using errcode = '22023';
  end if;

  select installation.organisation_id into installation_organisation_id
  from public.github_installations installation
  where installation.id = target_installation_id;

  if not found or installation_organisation_id <> target_organisation_id then
    raise exception 'GitHub installation belongs to another workspace'
      using errcode = '42501';
  end if;

  open_key := coalesce(target_diagnostic_code, 'unspecified');

  if target_kind = 'incident' then
    insert into public.github_connection_incidents(
      organisation_id, installation_id, incident_key, diagnostic_class, status,
      opened_at, last_observed_at
    ) values (
      target_organisation_id, target_installation_id, open_key,
      target_diagnostic_code, 'open', pg_catalog.now(), pg_catalog.now()
    )
    on conflict (organisation_id, installation_id, incident_key)
      where status = 'open'
      do update set last_observed_at = pg_catalog.now()
    returning id, (xmax = 0) into incident_id, is_new;

    if is_new then
      notice_kind := 'github_connection_incident';
      notice_subject_id := incident_id::text;
      notice_message := case
          when target_diagnostic_code = 'provider_rate_limited'
            then 'GitHub monitoring delayed for '
          when target_diagnostic_code = 'repository_unavailable'
            then 'GitHub monitoring is incomplete for '
          else 'GitHub monitoring paused for '
        end || target_account_login || '. ' ||
        case target_diagnostic_code
          when 'provider_rate_limited' then
            'GitHub is temporarily limiting requests. ComplianceHub will try again. No action is needed now.'
          when 'provider_temporary_failure' then
            'ComplianceHub could not reach GitHub. It will try again.'
          when 'installation_suspended' then
            'The GitHub App is suspended. ComplianceHub cannot check the selected repositories. A workspace Owner must reactivate the App in GitHub.'
          when 'installation_revoked' then
            'GitHub access was removed. A workspace Owner must reconnect the App.'
          when 'permission_mismatch' then
            'The GitHub App is missing the required read-only permissions. A workspace Owner must review the App permissions in GitHub.'
          when 'account_mismatch' then
            'The App is connected to a different GitHub organisation. A workspace Owner must review the Connection.'
          when 'repository_unavailable' then
            'A selected repository is not available to the GitHub App. A workspace Owner must review repository access.'
          when 'invalid_provider_response' then
            'ComplianceHub could not read GitHub''s response. It will try again.'
          when 'internal_failure' then
            'ComplianceHub could not complete the GitHub check. A workspace Owner must review the Connection.'
          else
            'ComplianceHub cannot verify GitHub access. A workspace Owner must review the Connection.'
        end || ' Open Settings > Connections.';
      insert into public.notifications(organisation_id, user_id, kind, subject_type, subject_id, message)
      select target_organisation_id, membership.user_id, notice_kind, 'github_installation',
        notice_subject_id, notice_message
      from public.memberships membership
      where membership.organisation_id = target_organisation_id
        and membership.role in ('owner', 'admin')
      on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing;
      select coalesce(pg_catalog.array_agg(notified.user_id), '{}') into notified_user_ids
      from (
        select membership.user_id
        from public.memberships membership
        join public.notifications notification
          on notification.organisation_id = membership.organisation_id
          and notification.user_id = membership.user_id
          and notification.kind = notice_kind
          and notification.subject_type = 'github_installation'
          and notification.subject_id = notice_subject_id
          and notification.sweep_on = current_date
        where membership.organisation_id = target_organisation_id
          and membership.role in ('owner', 'admin')
      ) notified;
    end if;
  else
    with resolved as (
      update public.github_connection_incidents
      set status = 'resolved', resolved_at = pg_catalog.now()
      where organisation_id = target_organisation_id
        and installation_id = target_installation_id
        and status = 'open'
      returning id, opened_at
    )
    select coalesce(pg_catalog.array_agg(resolved.id order by resolved.opened_at asc, resolved.id asc), '{}')
      into resolved_ids from resolved;
    resolved_count := coalesce(pg_catalog.array_length(resolved_ids, 1), 0);
    incident_id := resolved_ids[1];

    if resolved_count > 0 then
      is_new := true;
      notice_kind := 'github_connection_recovery';
      notice_subject_id := incident_id::text;
      notice_message := 'GitHub monitoring restored for ' || target_account_login
        || '. GitHub access was verified again. Checks can resume. No action is needed. Open Settings > Connections.';
      insert into public.notifications(organisation_id, user_id, kind, subject_type, subject_id, message)
      select target_organisation_id, membership.user_id, notice_kind, 'github_installation',
        notice_subject_id, notice_message
      from public.memberships membership
      where membership.organisation_id = target_organisation_id
        and membership.role in ('owner', 'admin')
      on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing;
      select coalesce(pg_catalog.array_agg(notified.user_id), '{}') into notified_user_ids
      from (
        select membership.user_id
        from public.memberships membership
        join public.notifications notification
          on notification.organisation_id = membership.organisation_id
          and notification.user_id = membership.user_id
          and notification.kind = notice_kind
          and notification.subject_type = 'github_installation'
          and notification.subject_id = notice_subject_id
          and notification.sweep_on = current_date
        where membership.organisation_id = target_organisation_id
          and membership.role in ('owner', 'admin')
      ) notified;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'incident_id', incident_id,
    'is_new', is_new,
    'notified_user_ids', coalesce(to_jsonb(notified_user_ids), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.record_github_connection_notice_server(uuid, uuid, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.record_github_connection_notice_server(uuid, uuid, text, text, text)
to service_role;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- One queue implementation handles new projector calls and both legacy entry
-- points. A supplied incident UUID is authoritative; public wrappers resolve a
-- stable matching incident when older callers omit it.
create or replace function private.queue_github_connection_alert_delivery_for_incident(
  target_organisation_id uuid,
  target_channel_id uuid,
  target_installation_id uuid,
  target_kind text,
  target_diagnostic_code text,
  safe_payload jsonb,
  target_incident_id uuid
)
returns table (delivery_id uuid, inserted boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  incident_row public.github_connection_incidents%rowtype;
  has_incident boolean := false;
  legacy_hash text;
  notice_idempotency_key text;
  notice_scope_key text;
  stable_delivery_on date;
  incident_lifecycle_end timestamptz;
  stored_delivery_id uuid;
  did_insert boolean := false;
  legacy_resolved_incident boolean := false;
  legacy_stale_recovery boolean := false;
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
    raise exception using errcode = '22023', message = 'Connection alert delivery input is invalid';
  end if;

  perform 1 from public.github_installations installation
  where installation.id = target_installation_id
    and installation.organisation_id = target_organisation_id;
  if not found then
    raise exception using errcode = '42501', message = 'GitHub installation belongs to another workspace';
  end if;

  perform 1 from public.alert_channels channel
  where channel.id = target_channel_id
    and channel.organisation_id = target_organisation_id
    and channel.type = 'slack'
    and channel.enabled
    and channel.revoked_at is null
    and array_position(array['low','medium','high','critical'], safe_payload ->> 'severity')
      >= array_position(array['low','medium','high','critical'], channel.min_severity::text)
  for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'Slack alert channel is unavailable';
  end if;

  if target_incident_id is not null then
    select incident.* into incident_row
    from public.github_connection_incidents incident
    where incident.id = target_incident_id
      and incident.organisation_id = target_organisation_id
      and incident.installation_id = target_installation_id
      and ((target_kind = 'incident'
            and incident.status = 'open'
            and incident.diagnostic_class is not distinct from target_diagnostic_code)
        or (target_kind = 'recovery'
            and incident.status = 'resolved'
            and target_diagnostic_code is null));
    has_incident := found;
    if not has_incident then
      raise exception using errcode = '42501', message = 'GitHub connection incident does not match';
    end if;
  elsif target_kind = 'incident' then
    select incident.* into incident_row
    from public.github_connection_incidents incident
    where incident.organisation_id = target_organisation_id
      and incident.installation_id = target_installation_id
      and incident.status = 'open'
      and incident.diagnostic_class is not distinct from target_diagnostic_code
    order by incident.opened_at asc, incident.id asc
    limit 1;
    has_incident := found;
    if not has_incident then
      -- A legacy retry may arrive after recovery. Associate it with the most
      -- recent resolved incident of the same diagnostic so it can reuse its
      -- historical row instead of creating a daily-key duplicate.
      select incident.* into incident_row
      from public.github_connection_incidents incident
      where incident.organisation_id = target_organisation_id
        and incident.installation_id = target_installation_id
        and incident.status = 'resolved'
        and incident.diagnostic_class is not distinct from target_diagnostic_code
      order by incident.resolved_at desc, incident.opened_at desc, incident.id asc
      limit 1;
      has_incident := found;
      legacy_resolved_incident := found;
    end if;
  else
    select incident.* into incident_row
    from public.github_connection_incidents incident
    where incident.organisation_id = target_organisation_id
      and incident.installation_id = target_installation_id
      and incident.status = 'resolved'
    order by incident.resolved_at desc, incident.opened_at asc, incident.id asc
    limit 1;
    has_incident := found;
    if has_incident then
      select min(next_incident.opened_at) into incident_lifecycle_end
      from public.github_connection_incidents next_incident
      where next_incident.organisation_id = target_organisation_id
        and next_incident.installation_id = target_installation_id
        and next_incident.opened_at > incident_row.resolved_at;
      legacy_stale_recovery := target_incident_id is null
        and incident_lifecycle_end is not null;
    end if;
  end if;

  if has_incident and target_kind = 'incident' and incident_row.resolved_at is not null then
    select min(next_incident.opened_at) into incident_lifecycle_end
    from public.github_connection_incidents next_incident
    where next_incident.organisation_id = target_organisation_id
      and next_incident.installation_id = target_installation_id
      and next_incident.opened_at > incident_row.resolved_at;
  end if;

  legacy_hash := pg_catalog.encode(extensions.digest(
    'github-connection:' || target_installation_id::text || ':' || target_kind || ':'
      || coalesce(target_diagnostic_code, 'none'), 'sha256'), 'hex');

  if has_incident then
    stable_delivery_on := case when target_kind = 'incident'
      then (incident_row.opened_at at time zone 'UTC')::date
      else (incident_row.resolved_at at time zone 'UTC')::date end;
    notice_scope_key := 'github-connection:' || incident_row.id::text || ':' || target_kind;
    notice_idempotency_key := pg_catalog.encode(extensions.digest(
      'github-connection:' || incident_row.id::text || ':' || target_kind || ':'
        || coalesce(target_diagnostic_code, 'none'), 'sha256'), 'hex');

    -- Reuse a same-lifecycle row written by the former daily-key implementation.
    -- All statuses remain intact, including its retry counter and backoff.
    select delivery.id into stored_delivery_id
    from public.alert_deliveries delivery
    where delivery.organisation_id = target_organisation_id
      and delivery.channel_id = target_channel_id
      and delivery.kind = 'github_connection_health'
      and delivery.installation_id = target_installation_id
      and delivery.scope_key = 'github-connection:' || legacy_hash
      and delivery.idempotency_key = legacy_hash
      and delivery.created_at >= case when target_kind = 'recovery'
        then incident_row.resolved_at else incident_row.opened_at end
      and (incident_lifecycle_end is null or delivery.created_at < incident_lifecycle_end)
    order by case delivery.status
        when 'delivered' then 0 when 'running' then 1 when 'terminal' then 2
        when 'cancelled' then 3 else 4 end,
      delivery.created_at, delivery.id
    limit 1;
    if found then
      return query select stored_delivery_id, false;
      return;
    end if;

    -- Do not create an alert for an older lifecycle after a later incident has
    -- started when no matching historical row exists. A delayed first incident
    -- enqueue remains compatible when it is still the latest lifecycle.
    if legacy_stale_recovery
       or (legacy_resolved_incident and incident_lifecycle_end is not null) then
      return query select null::uuid, false;
      return;
    end if;
  else
    stable_delivery_on := current_date;
    notice_scope_key := 'github-connection:' || legacy_hash;
    notice_idempotency_key := legacy_hash;
  end if;

  insert into public.alert_deliveries(
    organisation_id, channel_id, kind, subject_type, subject_id,
    installation_id, scope_key, idempotency_key, safe_payload, delivery_on
  ) values (
    target_organisation_id, target_channel_id,
    'github_connection_health', 'github_installation', target_installation_id::text,
    target_installation_id, notice_scope_key, notice_idempotency_key,
    safe_payload, stable_delivery_on
  )
  on conflict do nothing
  returning id into stored_delivery_id;
  did_insert := found;

  if stored_delivery_id is null then
    select delivery.id into stored_delivery_id
    from public.alert_deliveries delivery
    where delivery.organisation_id = target_organisation_id
      and delivery.channel_id = target_channel_id
      and delivery.kind = 'github_connection_health'
      and delivery.scope_key = notice_scope_key
      and delivery.delivery_on = stable_delivery_on;
  end if;

  if stored_delivery_id is null then
    raise exception using errcode = '23505', message = 'Connection alert identity conflicts with existing history';
  end if;
  return query select stored_delivery_id, did_insert;
end;
$$;

alter function private.queue_github_connection_alert_delivery_for_incident(uuid, uuid, uuid, text, text, jsonb, uuid)
owner to postgres;
revoke all on function private.queue_github_connection_alert_delivery_for_incident(uuid, uuid, uuid, text, text, jsonb, uuid)
from public, anon, authenticated, service_role;

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
  queued record;
begin
  select * into queued from private.queue_github_connection_alert_delivery_for_incident(
    target_organisation_id, target_channel_id, target_installation_id,
    target_kind, target_diagnostic_code, safe_payload, null
  );
  return coalesce(queued.inserted, false);
end;
$$;

alter function public.queue_github_connection_alert_delivery(uuid, uuid, uuid, text, text, jsonb)
owner to postgres;
revoke all on function public.queue_github_connection_alert_delivery(uuid, uuid, uuid, text, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.queue_github_connection_alert_delivery(uuid, uuid, uuid, text, text, jsonb)
to service_role;

create or replace function public.enqueue_github_connection_alert_delivery(
  target_organisation_id uuid,
  target_channel_id uuid,
  target_installation_id uuid,
  target_kind text,
  target_diagnostic_code text,
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
  queued_delivery_id uuid;
  claimable_delivery_id uuid;
  claimed_lock_token uuid := extensions.gen_random_uuid();
begin
  if worker_id is null or worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception using errcode = '22023', message = 'Connection alert delivery input is invalid';
  end if;

  select queued.delivery_id into queued_delivery_id
  from private.queue_github_connection_alert_delivery_for_incident(
    target_organisation_id, target_channel_id, target_installation_id,
    target_kind, target_diagnostic_code, safe_payload, null
  ) queued;

  select delivery.id into claimable_delivery_id
  from public.alert_deliveries delivery
  where delivery.id = queued_delivery_id
    and delivery.status in ('queued', 'failed')
    and delivery.attempt_count < 5
    and delivery.next_attempt_at <= pg_catalog.clock_timestamp()
  for update skip locked;
  if not found then return; end if;

  update public.alert_deliveries delivery
  set status = 'running', attempt_count = delivery.attempt_count + 1,
      locked_at = pg_catalog.clock_timestamp(), locked_by = worker_id,
      lock_token = claimed_lock_token, last_attempt_at = pg_catalog.clock_timestamp(),
      safe_error = null, updated_at = pg_catalog.clock_timestamp()
  where delivery.id = claimable_delivery_id;

  return query select claimable_delivery_id, claimed_lock_token;
end;
$$;

alter function public.enqueue_github_connection_alert_delivery(uuid, uuid, uuid, text, text, jsonb, text)
owner to postgres;
revoke all on function public.enqueue_github_connection_alert_delivery(uuid, uuid, uuid, text, text, jsonb, text)
from public, anon, authenticated, service_role;
grant execute on function public.enqueue_github_connection_alert_delivery(uuid, uuid, uuid, text, text, jsonb, text)
to service_role;

create or replace function public.project_github_connection_notice_server(
  target_organisation_id uuid,
  target_installation_id uuid,
  target_kind text,
  target_diagnostic_code text,
  target_account_login text,
  target_channel_id uuid,
  safe_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  installation_organisation_id uuid;
  installation_status text;
  installation_health text;
  recorded jsonb;
  recorded_incident_id uuid;
  slack_queued boolean := false;
begin
  if target_organisation_id is null
    or target_installation_id is null
    or target_kind is null
    or target_kind not in ('incident', 'recovery')
    or (target_diagnostic_code is not null and target_diagnostic_code not in (
      'provider_rate_limited', 'provider_temporary_failure', 'installation_suspended',
      'installation_revoked', 'permission_mismatch', 'account_mismatch',
      'repository_unavailable', 'invalid_provider_response', 'internal_failure'
    ))
    or target_account_login is null
    or target_account_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$'
  then
    raise exception 'invalid GitHub connection notice' using errcode = '22023';
  end if;

  select installation.organisation_id, installation.status, installation.health
  into installation_organisation_id, installation_status, installation_health
  from public.github_installations installation
  where installation.id = target_installation_id
  for update;

  if not found or installation_organisation_id is distinct from target_organisation_id then
    raise exception 'GitHub installation belongs to another workspace'
      using errcode = '42501';
  end if;

  if (target_kind = 'recovery'
      and (installation_status <> 'active' or installation_health <> 'healthy'))
    or (target_kind = 'incident' and installation_health = 'healthy')
  then
    return pg_catalog.jsonb_build_object(
      'incident_id', null, 'is_new', false,
      'notified_user_ids', '[]'::jsonb, 'slack_queued', false
    );
  end if;

  recorded := public.record_github_connection_notice_server(
    target_organisation_id, target_installation_id, target_kind,
    target_diagnostic_code, target_account_login
  );

  if coalesce((recorded ->> 'is_new')::boolean, false)
     and target_channel_id is not null then
    recorded_incident_id := (recorded ->> 'incident_id')::uuid;
    if recorded_incident_id is null then
      raise exception using errcode = '22023', message = 'Recorded connection incident has no identity';
    end if;
    select queued.inserted into slack_queued
    from private.queue_github_connection_alert_delivery_for_incident(
      target_organisation_id, target_channel_id, target_installation_id,
      target_kind, target_diagnostic_code, safe_payload, recorded_incident_id
    ) queued;
  end if;

  return recorded || pg_catalog.jsonb_build_object('slack_queued', slack_queued);
end;
$$;

alter function public.project_github_connection_notice_server(uuid, uuid, text, text, text, uuid, jsonb)
owner to postgres;
revoke all on function public.project_github_connection_notice_server(uuid, uuid, text, text, text, uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.project_github_connection_notice_server(uuid, uuid, text, text, text, uuid, jsonb)
to service_role;
