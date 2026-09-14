-- Persist authoritative reconciliation transitions as durable GitHub installation
-- incidents and acknowledgements through the existing in-app/Slack foundations.
-- The finalization trigger is the sole mutating authority. The service RPC
-- below only validates and acknowledges the exact finalized run with 0/0.

create table public.github_connection_incidents (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  incident_key text not null check (incident_key ~ '^[0-9a-f]{64}$'),
  diagnostic_code text not null check (diagnostic_code in (
    'provider_rate_limited', 'provider_temporary_failure',
    'installation_suspended', 'installation_revoked', 'permission_mismatch',
    'account_mismatch', 'repository_unavailable',
    'invalid_provider_response', 'internal_failure'
  )),
  health public.github_connection_health not null check (
    health in ('retrying', 'partially_unavailable', 'owner_action_required', 'disconnected')
  ),
  opened_at timestamptz not null,
  last_observed_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_connection_incidents_id_organisation_key
    unique (id, organisation_id),
  constraint github_connection_incidents_installation_tenant_fk
    foreign key (installation_id, organisation_id)
    references public.github_installations(id, organisation_id)
    on delete restrict,
  constraint github_connection_incidents_timestamps_check check (
    last_observed_at >= opened_at
    and (resolved_at is null or resolved_at >= last_observed_at)
  )
);

create unique index github_connection_incidents_one_open_episode
on public.github_connection_incidents(installation_id)
where resolved_at is null;

create index github_connection_incidents_installation_history_idx
on public.github_connection_incidents(
  installation_id, organisation_id, opened_at desc, id
);

create index github_connection_incidents_stable_key_idx
on public.github_connection_incidents(
  organisation_id, incident_key, opened_at desc, id
);

create trigger github_connection_incidents_audit
after insert or update or delete on public.github_connection_incidents
for each row execute function public.capture_audit_event();

alter table public.github_connection_incidents enable row level security;

create policy github_connection_incidents_operators_select
on public.github_connection_incidents for select to authenticated
using (
  exists (
    select 1
    from public.memberships membership
    where membership.organisation_id = github_connection_incidents.organisation_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
  )
);

revoke all on public.github_connection_incidents
from public, anon, authenticated, service_role;
grant select (
  id, organisation_id, installation_id, incident_key, diagnostic_code, health,
  opened_at, last_observed_at, resolved_at, created_at, updated_at
) on public.github_connection_incidents to authenticated;

alter table public.alert_deliveries
  add column github_installation_id uuid,
  add constraint alert_deliveries_github_installation_tenant_fk
    foreign key (github_installation_id, organisation_id)
    references public.github_installations(id, organisation_id)
    on delete restrict;

alter table public.alert_deliveries
  drop constraint alert_deliveries_kind_check,
  add constraint alert_deliveries_kind_check check (
    (kind = 'monitoring_finding' and subject_type = 'monitoring_finding'
      and connection_id is null and target_id is null
      and github_installation_id is null
      and safe_payload ->> 'type' = 'monitoring_finding')
    or
    (kind = 'connection_health' and subject_type = 'integration_connection'
      and connection_id is not null and target_id is null
      and github_installation_id is null
      and safe_payload ->> 'type' = 'connection_health')
    or
    (kind = 'connection_health' and subject_type = 'integration_connection_target'
      and connection_id is not null and target_id is not null
      and github_installation_id is null
      and safe_payload ->> 'type' = 'connection_health')
    or
    (kind = 'connection_health' and subject_type = 'github_installation'
      and connection_id is null and target_id is null
      and github_installation_id is not null
      and safe_payload ->> 'type' = 'connection_health')
  );

create or replace function public.github_connection_notice_payload(
  target_account_login text,
  target_kind text,
  target_health public.github_connection_health,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  alert_title text;
  state_label text;
  safe_detail text;
  occurred_label text;
begin
  if target_account_login is null
    or target_account_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
    or target_kind not in ('incident', 'recovery')
    or target_occurred_at is null
    or (target_kind = 'recovery' and target_health <> 'healthy')
    or (target_kind = 'incident' and target_health = 'healthy')
  then
    raise exception using
      errcode = '22023', message = 'GitHub connection alert input is invalid';
  end if;

  occurred_label := pg_catalog.to_char(
    target_occurred_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  if target_kind = 'recovery' then
    alert_title := 'GitHub connection recovered';
    state_label := 'GitHub connection';
    safe_detail := 'GitHub access was verified again. Observed at '
      || occurred_label || '. Open /app/integrations.';
  else
    alert_title := 'GitHub connection needs attention';
    state_label := 'GitHub connection';
    safe_detail := case target_health
      when 'retrying' then 'GitHub access could not be verified after repeated attempts.'
      when 'partially_unavailable' then 'GitHub access is partly unavailable.'
      when 'owner_action_required' then 'Owner action is required.'
      when 'disconnected' then 'GitHub is disconnected.'
      else null
    end || ' Observed at ' || occurred_label || '. Open /app/integrations.';
  end if;

  return pg_catalog.jsonb_build_object(
    'type', 'connection_health',
    'severity', 'high',
    'title', alert_title,
    'controlRef', state_label,
    'subjectId', target_account_login,
    'detail', safe_detail
  );
end;
$$;

alter function public.github_connection_notice_payload(
  text, text, public.github_connection_health, timestamptz
) owner to postgres;
revoke all on function public.github_connection_notice_payload(
  text, text, public.github_connection_health, timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.project_github_connection_notice_from_run(
  target_run_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  run_row public.github_connection_reconciliation_runs;
  installation_row public.github_installations;
  incident_row public.github_connection_incidents;
  notice_kind text;
  notification_kind text;
  notification_message text;
  safe_payload jsonb;
  safe_scope_key text;
  safe_idempotency_key text;
  in_app_count integer := 0;
  slack_count integer := 0;
begin
  select * into run_row
  from public.github_connection_reconciliation_runs
  where id = target_run_id
  for update;
  if not found
    or run_row.status = 'running'
    or run_row.incident_transition is null
    or run_row.incident_transition = 'none'
    or run_row.effective_health is null
  then
    return pg_catalog.jsonb_build_object('inAppQueued', 0, 'slackQueued', 0);
  end if;

  select * into installation_row
  from public.github_installations
  where id = run_row.installation_id
    and organisation_id = run_row.organisation_id
  for update;
  if not found then
    raise exception 'GitHub connection alert ancestry is invalid' using errcode = '23503';
  end if;

  notice_kind := case when run_row.incident_transition = 'recovered'
    then 'recovery' else 'incident' end;

  if notice_kind = 'incident' then
    select * into incident_row
    from public.github_connection_incidents incident
    where incident.installation_id = run_row.installation_id
      and incident.organisation_id = run_row.organisation_id
      and incident.resolved_at is null
    for update;
    if found then
      update public.github_connection_incidents incident
      set last_observed_at = greatest(incident.last_observed_at, run_row.last_attempted_at),
          diagnostic_code = coalesce(run_row.diagnostic_code, incident.diagnostic_code),
          health = run_row.effective_health,
          updated_at = pg_catalog.clock_timestamp()
      where incident.id = incident_row.id
      returning * into incident_row;
    elsif run_row.diagnostic_code is null then
      return pg_catalog.jsonb_build_object('inAppQueued', 0, 'slackQueued', 0);
    else
      insert into public.github_connection_incidents(
        organisation_id, installation_id, incident_key, diagnostic_code,
        health, opened_at, last_observed_at
      ) values (
        run_row.organisation_id,
        run_row.installation_id,
        pg_catalog.encode(extensions.digest(
          run_row.installation_id::text || ':' || run_row.id::text,
          'sha256'
        ), 'hex'),
        run_row.diagnostic_code,
        run_row.effective_health,
        run_row.last_attempted_at,
        run_row.last_attempted_at
      ) returning * into incident_row;
    end if;
    if run_row.incident_transition <> 'opened' then
      return pg_catalog.jsonb_build_object('inAppQueued', 0, 'slackQueued', 0);
    end if;
  else
    select * into incident_row
    from public.github_connection_incidents incident
    where incident.installation_id = run_row.installation_id
      and incident.organisation_id = run_row.organisation_id
      and incident.resolved_at is null
    order by incident.last_observed_at desc, incident.id
    limit 1
    for update;
    if not found then
      return pg_catalog.jsonb_build_object('inAppQueued', 0, 'slackQueued', 0);
    end if;
    update public.github_connection_incidents incident
    set last_observed_at = greatest(incident.last_observed_at, run_row.last_attempted_at),
        resolved_at = greatest(incident.last_observed_at, run_row.last_attempted_at),
        updated_at = pg_catalog.clock_timestamp()
    where incident.id = incident_row.id
    returning * into incident_row;
  end if;

  safe_payload := public.github_connection_notice_payload(
    installation_row.account_login,
    notice_kind,
    run_row.effective_health,
    run_row.last_attempted_at
  );
  notification_kind := case notice_kind
    when 'incident' then 'github_connection_incident'
    else 'github_connection_recovery'
  end;
  notification_message := (safe_payload ->> 'title') || '. '
    || (safe_payload ->> 'detail');

  with inserted as (
    insert into public.notifications(
      organisation_id, user_id, kind, subject_type, subject_id,
      message, sweep_on
    )
    select run_row.organisation_id, membership.user_id,
           notification_kind, 'github_installation', incident_row.id::text,
           notification_message, run_row.last_attempted_at::date
    from public.memberships membership
    where membership.organisation_id = run_row.organisation_id
      and membership.role in ('owner', 'admin')
    on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing
    returning 1
  )
  select pg_catalog.count(*)::integer into in_app_count from inserted;

  safe_scope_key := 'github:' || incident_row.id::text || ':' || notice_kind;
  safe_idempotency_key := pg_catalog.encode(
    extensions.digest('github_connection:' || safe_scope_key, 'sha256'),
    'hex'
  );
  with inserted as (
    insert into public.alert_deliveries(
      organisation_id, channel_id, github_installation_id,
      kind, subject_type, subject_id, scope_key, idempotency_key,
      safe_payload, delivery_on
    )
    select run_row.organisation_id, channel.id, run_row.installation_id,
           'connection_health', 'github_installation', run_row.installation_id::text,
           safe_scope_key, safe_idempotency_key,
           safe_payload, run_row.last_attempted_at::date
    from public.alert_channels channel
    where channel.organisation_id = run_row.organisation_id
      and channel.type = 'slack'
      and channel.enabled
      and channel.revoked_at is null
      and channel.min_severity in ('low', 'medium', 'high')
    on conflict (organisation_id, channel_id, kind, scope_key, delivery_on)
      do nothing
    returning 1
  )
  select pg_catalog.count(*)::integer into slack_count from inserted;

  return pg_catalog.jsonb_build_object(
    'inAppQueued', in_app_count,
    'slackQueued', slack_count
  );
end;
$$;

alter function public.project_github_connection_notice_from_run(uuid)
  owner to postgres;
revoke all on function public.project_github_connection_notice_from_run(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.project_github_connection_notice_after_finalization()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status = 'running'
    and new.status <> 'running'
    and new.incident_transition in ('opened', 'remained_open', 'recovered')
  then
    perform public.project_github_connection_notice_from_run(new.id);
  end if;
  return new;
end;
$$;

alter function public.project_github_connection_notice_after_finalization()
  owner to postgres;
revoke all on function public.project_github_connection_notice_after_finalization()
  from public, anon, authenticated, service_role;

create trigger github_connection_reconciliation_runs_project_notice
after update of status, incident_transition
on public.github_connection_reconciliation_runs
for each row execute function public.project_github_connection_notice_after_finalization();

create or replace function public.project_github_connection_notice_server(
  target_run_id uuid,
  target_organisation_id uuid,
  target_installation_id uuid,
  target_account_login text,
  target_kind text,
  target_health text,
  target_diagnostic_code text,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if target_run_id is null
    or target_organisation_id is null
    or target_installation_id is null
    or target_account_login is null
    or target_kind not in ('incident', 'recovery')
    or target_health not in (
      'healthy', 'retrying', 'partially_unavailable',
      'owner_action_required', 'disconnected'
    )
    or target_occurred_at is null
  then
    raise exception using
      errcode = '22023', message = 'GitHub connection alert input is invalid';
  end if;

  if not exists (
    select 1
    from public.github_connection_reconciliation_runs run
    join public.github_installations installation
      on installation.id = run.installation_id
     and installation.organisation_id = run.organisation_id
    where run.id = target_run_id
      and run.organisation_id = target_organisation_id
      and run.installation_id = target_installation_id
      and installation.account_login = target_account_login
      and run.last_attempted_at = target_occurred_at
      and run.status <> 'running'
      and run.effective_health::text = target_health
      and run.diagnostic_code is not distinct from target_diagnostic_code
      and (
        (target_kind = 'incident' and run.incident_transition in ('opened', 'remained_open'))
        or (target_kind = 'recovery' and run.incident_transition = 'recovered')
      )
  ) then
    raise exception using
      errcode = '22023', message = 'GitHub connection alert input is invalid';
  end if;

  return pg_catalog.jsonb_build_object('inAppQueued', 0, 'slackQueued', 0);
end;
$$;

alter function public.project_github_connection_notice_server(
  uuid, uuid, uuid, text, text, text, text, timestamptz
) owner to postgres;
revoke all on function public.project_github_connection_notice_server(
  uuid, uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.project_github_connection_notice_server(
  uuid, uuid, uuid, text, text, text, text, timestamptz
) to service_role;
