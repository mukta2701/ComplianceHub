-- Milestone 1 Phase 6: durable connection incidents with deduplicated
-- Owner/Admin inbox notices and idempotent Slack alert queueing. Incident
-- and recovery payloads carry only safe identifiers, fixed diagnostic
-- classes and an authenticated application link. No provider content,
-- credentials, repository contents, stack traces or AWS identifiers.

create table public.github_connection_incidents (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  incident_key text not null check (char_length(incident_key) between 1 and 200),
  diagnostic_class text check (
    diagnostic_class is null
    or diagnostic_class in (
      'provider_rate_limited', 'provider_temporary_failure', 'installation_suspended',
      'installation_revoked', 'permission_mismatch', 'account_mismatch',
      'repository_unavailable', 'invalid_provider_response', 'internal_failure',
      'unspecified'
    )
  ),
  status text not null default 'open' check (status in ('open', 'resolved')),
  opened_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint github_connection_incidents_id_organisation_key unique (id, organisation_id),
  constraint github_connection_incidents_id_tenant_installation_key
    unique (id, organisation_id, installation_id),
  constraint github_connection_incidents_installation_tenant_fk
    foreign key (installation_id, organisation_id)
    references public.github_installations(id, organisation_id)
    on delete cascade,
  constraint github_connection_incidents_terminal_check check (
    (status = 'open' and resolved_at is null)
    or (status = 'resolved' and resolved_at is not null)
  )
);

create unique index github_connection_incidents_open_key
on public.github_connection_incidents (organisation_id, installation_id, incident_key)
where status = 'open';

create index github_connection_incidents_installation_status_idx
on public.github_connection_incidents (installation_id, status, last_observed_at desc);

alter table public.github_connection_incidents enable row level security;

create policy github_connection_incidents_members_select
on public.github_connection_incidents for select to authenticated
using ((select public.is_organisation_member(organisation_id)));

revoke all on public.github_connection_incidents from public, anon, authenticated, service_role;

grant select (
  id, organisation_id, installation_id, incident_key, diagnostic_class,
  status, opened_at, last_observed_at, resolved_at
) on public.github_connection_incidents to authenticated;

-- Service-only notice recorder: opens or refreshes one incident per
-- installation/diagnostic, resolves on verified recovery, and notifies
-- workspace Owners/Admins through idempotent inbox rows. Members are never
-- notified. Returns the incident identity, whether this call created new
-- notification work, and the newly notified user ids as JSON.
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
begin
  if target_organisation_id is null
    or target_installation_id is null
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
      notice_message := 'GitHub connection needs attention — ' || target_account_login
        || ': ' || open_key || '. Review: /app/integrations';
      insert into public.notifications(organisation_id, user_id, kind, subject_type, subject_id, message)
      select target_organisation_id, membership.user_id, notice_kind, 'github_installation',
        target_installation_id::text, notice_message
      from public.memberships membership
      where membership.organisation_id = target_organisation_id
        and membership.role in ('owner', 'admin')
      on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing;
      -- Gather the newly notified owners/admins explicitly: RETURNING into an
      -- array variable collects only one row and fails on several.
      select coalesce(pg_catalog.array_agg(notified.user_id), '{}') into notified_user_ids
      from (
        select membership.user_id
        from public.memberships membership
        join public.notifications notification
          on notification.organisation_id = membership.organisation_id
          and notification.user_id = membership.user_id
          and notification.kind = notice_kind
          and notification.subject_type = 'github_installation'
          and notification.subject_id = target_installation_id::text
          and notification.sweep_on = current_date
        where membership.organisation_id = target_organisation_id
          and membership.role in ('owner', 'admin')
      ) notified;
    end if;
  else
    with resolved as (
      update public.github_connection_incidents
      set status = 'resolved',
          resolved_at = pg_catalog.now()
      where organisation_id = target_organisation_id
        and installation_id = target_installation_id
        and status = 'open'
      returning id
    )
    select coalesce(pg_catalog.array_agg(resolved.id), '{}') into resolved_ids from resolved;
    resolved_count := coalesce(pg_catalog.array_length(resolved_ids, 1), 0);
    incident_id := resolved_ids[1];

    if resolved_count > 0 then
      is_new := true;
      notice_kind := 'github_connection_recovery';
      notice_message := 'GitHub connection recovered — ' || target_account_login
        || '. Review: /app/integrations';
      insert into public.notifications(organisation_id, user_id, kind, subject_type, subject_id, message)
      select target_organisation_id, membership.user_id, notice_kind, 'github_installation',
        target_installation_id::text, notice_message
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
          and notification.subject_id = target_installation_id::text
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

alter table public.alert_deliveries
  add column installation_id uuid;

alter table public.alert_deliveries
  add constraint alert_deliveries_installation_tenant_fk
    foreign key (installation_id, organisation_id)
    references public.github_installations(id, organisation_id)
    on delete cascade;

alter table public.alert_deliveries
  drop constraint alert_deliveries_kind_check;

alter table public.alert_deliveries
  add constraint alert_deliveries_kind_check check (
    (kind = 'monitoring_finding' and subject_type = 'monitoring_finding'
      and connection_id is null and target_id is null and installation_id is null
      and safe_payload ->> 'type' = 'monitoring_finding')
    or
    (kind = 'connection_health' and subject_type = 'integration_connection'
      and connection_id is not null and target_id is null and installation_id is null
      and safe_payload ->> 'type' = 'connection_health')
    or
    (kind = 'connection_health' and subject_type = 'integration_connection_target'
      and connection_id is not null and target_id is not null and installation_id is null
      and safe_payload ->> 'type' = 'connection_health')
    or
    (kind = 'github_connection_health' and subject_type = 'github_installation'
      and installation_id is not null and connection_id is null and target_id is null
      and safe_payload ->> 'type' = 'connection_health')
  );

-- Service-only Slack queue for connection notices. Idempotent per
-- installation/kind/diagnostic/day; honours the channel severity floor.
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
  stored_delivery_id uuid;
  claimed_lock_token uuid := extensions.gen_random_uuid();
  notice_idempotency_key text;
  notice_scope_key text;
begin
  if worker_id is null or worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
     or target_kind not in ('incident', 'recovery')
     or (target_diagnostic_code is not null and target_diagnostic_code not in (
       'provider_rate_limited', 'provider_temporary_failure', 'installation_suspended',
       'installation_revoked', 'permission_mismatch', 'account_mismatch',
       'repository_unavailable', 'invalid_provider_response', 'internal_failure'
     ))
     or safe_payload ->> 'type' is distinct from 'connection_health'
     or safe_payload ->> 'severity' not in ('low', 'medium', 'high', 'critical') then
    raise exception using
      errcode = '22023', message = 'Connection alert delivery input is invalid';
  end if;

  perform 1
  from public.github_installations installation
  where installation.id = target_installation_id
    and installation.organisation_id = target_organisation_id;
  if not found then
    raise exception using
      errcode = '42501', message = 'GitHub installation belongs to another workspace';
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
    target_installation_id, notice_scope_key, notice_idempotency_key, safe_payload, current_date
  )
  on conflict (organisation_id, channel_id, kind, scope_key, delivery_on)
    do nothing;

  select delivery.id into stored_delivery_id
  from public.alert_deliveries as delivery
  where delivery.organisation_id = target_organisation_id
    and delivery.channel_id = target_channel_id
    and delivery.kind = 'github_connection_health'
    and delivery.scope_key = notice_scope_key
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

revoke all on function public.enqueue_github_connection_alert_delivery(uuid, uuid, uuid, text, text, jsonb, text)
from public, anon, authenticated, service_role;
grant execute on function public.enqueue_github_connection_alert_delivery(uuid, uuid, uuid, text, text, jsonb, text)
to service_role;
