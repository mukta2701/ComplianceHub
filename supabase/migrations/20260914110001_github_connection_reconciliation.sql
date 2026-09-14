create type public.github_connection_health as enum (
  'healthy',
  'retrying',
  'partially_unavailable',
  'owner_action_required',
  'disconnected'
);

alter table public.github_installations
  add column health public.github_connection_health not null default 'retrying',
  add column last_reconciliation_attempt_at timestamptz,
  add column last_successful_reconciliation_at timestamptz,
  add column consecutive_reconciliation_failures integer not null default 0,
  add column next_reconciliation_at timestamptz default now(),
  add column health_diagnostic_code text,
  add column reconciliation_locked_by uuid,
  add column reconciliation_locked_until timestamptz,
  add column reconciliation_version bigint not null default 1,
  add constraint github_installations_reconciliation_failure_count_check check (
    consecutive_reconciliation_failures >= 0
  ),
  add constraint github_installations_health_diagnostic_check check (
    health_diagnostic_code is null
    or health_diagnostic_code in (
      'provider_rate_limited', 'provider_temporary_failure',
      'installation_suspended', 'installation_revoked', 'permission_mismatch',
      'account_mismatch', 'repository_unavailable',
      'invalid_provider_response', 'internal_failure'
    )
  ),
  add constraint github_installations_reconciliation_lease_check check (
    (reconciliation_locked_by is null and reconciliation_locked_until is null)
    or (reconciliation_locked_by is not null and reconciliation_locked_until is not null)
  ),
  add constraint github_installations_reconciliation_version_check check (
    reconciliation_version between 1 and 9007199254740991
  );

create index github_installations_reconciliation_due_idx
on public.github_installations(next_reconciliation_at, id)
where next_reconciliation_at is not null;

create table public.github_connection_reconciliation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  reconciliation_version bigint not null default 1,
  trigger text not null check (trigger in ('initial', 'scheduled', 'webhook')),
  request_key text not null check (char_length(request_key) between 1 and 200),
  status text not null default 'running' check (
    status in (
      'running', 'success', 'partial', 'temporary_failure',
      'action_required', 'disconnected', 'cancelled'
    )
  ),
  diagnostic_code text check (
    diagnostic_code is null
    or diagnostic_code in (
      'provider_rate_limited', 'provider_temporary_failure',
      'installation_suspended', 'installation_revoked', 'permission_mismatch',
      'account_mismatch', 'repository_unavailable',
      'invalid_provider_response', 'internal_failure'
    )
  ),
  incident_transition text check (
    incident_transition is null
    or incident_transition in ('none', 'opened', 'remained_open', 'recovered')
  ),
  started_at timestamptz not null default now(),
  last_attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  attempt_count integer not null default 1 check (attempt_count >= 1),
  repository_count integer not null default 0 check (repository_count >= 0),
  available_repository_count integer not null default 0 check (available_repository_count >= 0),
  unavailable_repository_count integer not null default 0 check (unavailable_repository_count >= 0),
  constraint github_connection_reconciliation_runs_id_organisation_key
    unique (id, organisation_id),
  constraint github_connection_reconciliation_runs_id_full_ancestry_key
    unique (id, organisation_id, installation_id),
  constraint github_connection_reconciliation_runs_installation_request_key
    unique (installation_id, request_key),
  constraint github_connection_reconciliation_runs_installation_tenant_fk
    foreign key (installation_id, organisation_id)
    references public.github_installations(id, organisation_id)
    on delete restrict,
  constraint github_connection_reconciliation_runs_lifecycle_check check (
    (
      status = 'running'
      and completed_at is null
      and diagnostic_code is null
      and incident_transition is null
    )
    or (
      status = 'success'
      and completed_at is not null
      and diagnostic_code is null
      and incident_transition is not null
    )
    or (
      status = 'cancelled'
      and completed_at is not null
      and diagnostic_code is null
      and incident_transition = 'none'
    )
    or (
      status not in ('running', 'success', 'cancelled')
      and completed_at is not null
      and diagnostic_code is not null
      and incident_transition is not null
    )
  ),
  constraint github_connection_reconciliation_runs_count_check check (
    repository_count = available_repository_count + unavailable_repository_count
  ),
  constraint github_connection_reconciliation_runs_version_check check (
    reconciliation_version between 1 and 9007199254740991
  ),
  constraint github_connection_reconciliation_runs_timestamp_check check (
    last_attempted_at >= started_at
    and (completed_at is null or completed_at >= last_attempted_at)
  )
);

create index github_connection_reconciliation_runs_installation_time_idx
on public.github_connection_reconciliation_runs(
  installation_id, organisation_id, started_at desc, id
);
create index github_connection_reconciliation_runs_running_idx
on public.github_connection_reconciliation_runs(installation_id, started_at desc, id)
where status = 'running';
create index github_connection_reconciliation_runs_installation_version_idx
on public.github_connection_reconciliation_runs(
  installation_id, organisation_id, reconciliation_version desc
);

alter table public.github_connection_reconciliation_runs enable row level security;

create policy github_connection_reconciliation_runs_operators_select
on public.github_connection_reconciliation_runs for select to authenticated
using (
  exists (
    select 1
    from public.memberships membership
    where membership.organisation_id = github_connection_reconciliation_runs.organisation_id
      and membership.user_id = (select auth.uid())
      and membership.role in ('owner', 'admin')
  )
);

revoke all on public.github_connection_reconciliation_runs
from public, anon, authenticated, service_role;

grant select (
  id, organisation_id, installation_id, trigger, status, diagnostic_code,
  incident_transition, started_at, last_attempted_at, completed_at,
  attempt_count, repository_count, available_repository_count,
  unavailable_repository_count
) on public.github_connection_reconciliation_runs to authenticated;

create view public.github_connection_health_summaries
with (security_barrier = true)
as
select
  installation.id,
  installation.organisation_id,
  installation.account_login,
  installation.account_type,
  installation.repository_selection,
  installation.health,
  installation.last_reconciliation_attempt_at,
  installation.last_successful_reconciliation_at,
  installation.consecutive_reconciliation_failures,
  installation.next_reconciliation_at,
  installation.health_diagnostic_code,
  installation.created_at,
  installation.updated_at
from public.github_installations installation
where exists (
  select 1
  from public.memberships membership
  where membership.organisation_id = installation.organisation_id
    and membership.user_id = (select auth.uid())
    and membership.role in ('owner', 'admin')
);

alter view public.github_connection_health_summaries owner to postgres;
revoke all on public.github_connection_health_summaries
from public, anon, authenticated, service_role;
grant select on public.github_connection_health_summaries to authenticated;

create or replace function public.schedule_github_reconciliation_after_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.github_installations
  set reconciliation_version = reconciliation_version + 1,
      next_reconciliation_at = pg_catalog.now(),
      reconciliation_locked_by = null,
      reconciliation_locked_until = null
  where id = new.id
    and organisation_id = new.organisation_id;
  return null;
end;
$$;

alter function public.schedule_github_reconciliation_after_claim() owner to postgres;
revoke all on function public.schedule_github_reconciliation_after_claim()
from public, anon, authenticated, service_role;

create trigger github_installations_00_schedule_reconciliation
after update of connected_by, permissions on public.github_installations
for each row execute function public.schedule_github_reconciliation_after_claim();

create or replace function public.claim_github_webhook_deliveries_server(
  target_limit integer
)
returns setof public.github_webhook_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  claimed_delivery public.github_webhook_deliveries;
  resolved_installation public.github_installations;
  resolved_repository_id uuid;
begin
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'webhook claim limit must be between 1 and 100'
      using errcode = '22023';
  end if;

  for candidate in
    select delivery.id
    from public.github_webhook_deliveries delivery
    where delivery.event_name not in (
        'installation', 'installation_repositories', 'repository'
      )
      and delivery.attempt_count < 10
      and (
        delivery.status in ('queued', 'failed')
        or (
          delivery.status = 'processing'
          and delivery.last_attempted_at < pg_catalog.now() - interval '15 minutes'
        )
      )
    order by delivery.received_at, delivery.id
    limit target_limit
    for update skip locked
  loop
    resolved_installation := null;
    select * into resolved_installation
    from public.github_installations installation
    where installation.provider_installation_id = (
      select delivery.provider_installation_id
      from public.github_webhook_deliveries delivery
      where delivery.id = candidate.id
    )
      and installation.status = 'active'
      and installation.permissions_ok;

    resolved_repository_id := null;
    if found then
      select repository.id into resolved_repository_id
      from public.github_repositories repository
      where repository.installation_id = resolved_installation.id
        and repository.organisation_id = resolved_installation.organisation_id
        and repository.selected
        and repository.available
        and repository.provider_repository_id = (
          select delivery.provider_repository_id
          from public.github_webhook_deliveries delivery
          where delivery.id = candidate.id
        );
    end if;

    update public.github_webhook_deliveries delivery
    set organisation_id = resolved_installation.organisation_id,
        installation_id = resolved_installation.id,
        repository_id = resolved_repository_id,
        status = 'processing',
        attempt_count = delivery.attempt_count + 1,
        diagnostic_code = null,
        last_attempted_at = pg_catalog.now(),
        processed_at = null
    where delivery.id = candidate.id
    returning delivery.* into claimed_delivery;

    return next claimed_delivery;
  end loop;
end;
$$;

alter function public.claim_github_webhook_deliveries_server(integer) owner to postgres;
revoke all on function public.claim_github_webhook_deliveries_server(integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_github_webhook_deliveries_server(integer)
to service_role;

create or replace function public.claim_github_connection_webhook_deliveries_server(
  target_limit integer
)
returns setof public.github_webhook_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  claimed_delivery public.github_webhook_deliveries;
  resolved_installation public.github_installations;
  resolved_repository_id uuid;
  installation_found boolean;
  schedule_installation boolean;
  scheduled_at timestamptz;
begin
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'connection webhook claim limit must be between 1 and 100'
      using errcode = '22023';
  end if;

  for candidate in
    select delivery.id, delivery.attempt_count
    from public.github_webhook_deliveries delivery
    where delivery.event_name in (
        'installation', 'installation_repositories', 'repository'
      )
      and delivery.attempt_count < 10
      and (
        delivery.status in ('queued', 'failed')
        or (
          delivery.status = 'processing'
          and delivery.last_attempted_at < pg_catalog.now() - interval '15 minutes'
        )
      )
    order by delivery.received_at, delivery.id
    limit target_limit
    for update skip locked
  loop
    scheduled_at := pg_catalog.clock_timestamp();
    resolved_installation := null;
    select installation.* into resolved_installation
    from public.github_installations installation
    join public.github_webhook_deliveries delivery
      on delivery.provider_installation_id = installation.provider_installation_id
    where delivery.id = candidate.id
    for update of installation;
    installation_found := found;
    schedule_installation := false;

    if installation_found then
      select (
        (
          resolved_installation.status = 'active'
          and resolved_installation.permissions_ok
          and resolved_installation.health not in (
            'owner_action_required', 'disconnected'
          )
        )
        or exists (
          select 1
          from public.github_connection_reconciliation_runs run
          where run.installation_id = resolved_installation.id
            and run.organisation_id = resolved_installation.organisation_id
            and run.status = 'running'
        )
      ) into schedule_installation;
    end if;

    resolved_repository_id := null;
    if schedule_installation then
      select repository.id into resolved_repository_id
      from public.github_repositories repository
      where repository.installation_id = resolved_installation.id
        and repository.organisation_id = resolved_installation.organisation_id
        and repository.selected
        and repository.available
        and repository.provider_repository_id = (
          select delivery.provider_repository_id
          from public.github_webhook_deliveries delivery
          where delivery.id = candidate.id
        );

      if candidate.attempt_count = 0 then
        update public.github_installations installation
        set reconciliation_version = installation.reconciliation_version + 1,
            next_reconciliation_at = least(
              coalesce(installation.next_reconciliation_at, scheduled_at),
              scheduled_at
            )
        where installation.id = resolved_installation.id
          and installation.organisation_id = resolved_installation.organisation_id;
      end if;
    end if;

    update public.github_webhook_deliveries delivery
    set organisation_id = case when schedule_installation
          then resolved_installation.organisation_id else null end,
        installation_id = case when schedule_installation
          then resolved_installation.id else null end,
        repository_id = resolved_repository_id,
        status = 'processing',
        attempt_count = delivery.attempt_count + 1,
        diagnostic_code = null,
        last_attempted_at = scheduled_at,
        processed_at = null
    where delivery.id = candidate.id
    returning delivery.* into claimed_delivery;

    return next claimed_delivery;
  end loop;
end;
$$;

alter function public.claim_github_connection_webhook_deliveries_server(integer)
owner to postgres;
revoke all on function public.claim_github_connection_webhook_deliveries_server(integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_github_connection_webhook_deliveries_server(integer)
to service_role;

create or replace function public.claim_due_github_connection_reconciliations_server(
  target_worker_id uuid,
  target_limit integer,
  target_now timestamptz
)
returns setof public.github_connection_reconciliation_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  claimed_run public.github_connection_reconciliation_runs;
  request_key_value text;
  claim_version bigint;
begin
  if target_worker_id is null or target_now is null then
    raise exception 'reconciliation claim requires a worker and time'
      using errcode = '22023';
  end if;
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'reconciliation claim limit must be between 1 and 100'
      using errcode = '22023';
  end if;

  for candidate in
    select installation.id, installation.organisation_id,
           installation.next_reconciliation_at,
           installation.last_reconciliation_attempt_at,
           installation.reconciliation_version,
           installation.status,
           installation.permissions_ok,
           coalesce((
             select max(previous_run.reconciliation_version)
             from public.github_connection_reconciliation_runs previous_run
             where previous_run.installation_id = installation.id
               and previous_run.organisation_id = installation.organisation_id
           ), 0) as latest_run_version
    from public.github_installations installation
    where installation.next_reconciliation_at is not null
      and installation.next_reconciliation_at <= target_now
      and (
        installation.reconciliation_locked_until is null
        or installation.reconciliation_locked_until <= target_now
      )
      and (
        (installation.status = 'active' and installation.permissions_ok)
        or installation.reconciliation_version > coalesce((
          select max(previous_run.reconciliation_version)
          from public.github_connection_reconciliation_runs previous_run
          where previous_run.installation_id = installation.id
            and previous_run.organisation_id = installation.organisation_id
        ), 0)
        or exists (
          select 1
          from public.github_connection_reconciliation_runs running_run
          where running_run.installation_id = installation.id
            and running_run.organisation_id = installation.organisation_id
            and running_run.status = 'running'
        )
      )
    order by installation.next_reconciliation_at, installation.id
    limit target_limit
    for update skip locked
  loop
    claimed_run := null;

    select run.* into claimed_run
    from public.github_connection_reconciliation_runs run
    where run.installation_id = candidate.id
      and run.organisation_id = candidate.organisation_id
      and run.status = 'running'
    order by run.started_at desc, run.id
    limit 1
    for update;

    if found then
      update public.github_connection_reconciliation_runs run
      set attempt_count = run.attempt_count + 1,
          last_attempted_at = target_now
      where run.id = claimed_run.id
        and run.organisation_id = claimed_run.organisation_id
        and run.installation_id = claimed_run.installation_id
      returning run.* into claimed_run;
    else
      claim_version := candidate.reconciliation_version;
      if claim_version <= candidate.latest_run_version then
        update public.github_installations installation
        set reconciliation_version = installation.reconciliation_version + 1
        where installation.id = candidate.id
          and installation.organisation_id = candidate.organisation_id
        returning installation.reconciliation_version into claim_version;
      end if;

      request_key_value := 'v1:' || pg_catalog.encode(
        extensions.digest(
          candidate.id::text || ':' || claim_version::text,
          'sha256'
        ),
        'hex'
      );

      insert into public.github_connection_reconciliation_runs(
        organisation_id, installation_id, reconciliation_version, trigger, request_key,
        started_at, last_attempted_at
      ) values (
        candidate.organisation_id,
        candidate.id,
        claim_version,
        case when candidate.last_reconciliation_attempt_at is null
          then 'initial' else 'scheduled' end,
        request_key_value,
        target_now,
        target_now
      )
      on conflict (installation_id, request_key) do nothing
      returning * into claimed_run;

      if claimed_run.id is null then
        select run.* into claimed_run
        from public.github_connection_reconciliation_runs run
        where run.installation_id = candidate.id
          and run.request_key = request_key_value
          and run.status = 'running'
        for update;
      end if;
    end if;

    if claimed_run.id is not null then
      update public.github_installations
      set last_reconciliation_attempt_at = target_now,
          reconciliation_locked_by = target_worker_id,
          reconciliation_locked_until = target_now + interval '5 minutes'
      where id = candidate.id
        and organisation_id = candidate.organisation_id;

      return next claimed_run;
    end if;
  end loop;
end;
$$;

alter function public.claim_due_github_connection_reconciliations_server(
  uuid, integer, timestamptz
) owner to postgres;
revoke all on function public.claim_due_github_connection_reconciliations_server(
  uuid, integer, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.claim_due_github_connection_reconciliations_server(
  uuid, integer, timestamptz
) to service_role;

create or replace function public.finalize_github_connection_reconciliation_server(
  target_run_id uuid,
  target_worker_id uuid,
  target_outcome text,
  target_diagnostic_code text,
  target_next_attempt_at timestamptz,
  target_repository_snapshot jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.github_connection_reconciliation_runs;
  installation_row public.github_installations;
  repository_value jsonb;
  repository_snapshot_count integer;
  distinct_repository_count integer;
  next_failure_count integer;
  retry_floor timestamptz;
  effective_next_attempt_at timestamptz;
  next_health public.github_connection_health;
  prior_incident_open boolean;
  next_incident_open boolean;
  transition text;
  completed_time timestamptz;
  has_newer_occurrence boolean;
  superseded_success boolean;
  repository_total integer;
  repository_available integer;
  repository_unavailable integer;
begin
  if target_run_id is null or target_worker_id is null then
    return 'not_finalized';
  end if;

  select * into run_row
  from public.github_connection_reconciliation_runs
  where id = target_run_id;

  if not found then
    return 'not_finalized';
  end if;

  if run_row.status <> 'running' then
    if run_row.status = target_outcome
      and run_row.diagnostic_code is not distinct from target_diagnostic_code
    then
      return run_row.incident_transition;
    end if;
    return 'not_finalized';
  end if;

  select * into installation_row
  from public.github_installations
  where id = run_row.installation_id
    and organisation_id = run_row.organisation_id
  for update;

  if not found then
    return 'not_finalized';
  end if;

  select * into run_row
  from public.github_connection_reconciliation_runs
  where id = target_run_id
    and installation_id = installation_row.id
    and organisation_id = installation_row.organisation_id
  for update;

  if not found then
    return 'not_finalized';
  end if;

  if run_row.status <> 'running' then
    if run_row.status = target_outcome
      and run_row.diagnostic_code is not distinct from target_diagnostic_code
    then
      return run_row.incident_transition;
    end if;
    return 'not_finalized';
  end if;

  completed_time := greatest(pg_catalog.clock_timestamp(), run_row.last_attempted_at);
  has_newer_occurrence := installation_row.reconciliation_version
    > run_row.reconciliation_version;
  superseded_success := has_newer_occurrence and target_outcome = 'success';

  if installation_row.reconciliation_locked_by is distinct from target_worker_id
    or installation_row.reconciliation_locked_until is null
    or installation_row.reconciliation_locked_until <= pg_catalog.now()
  then
    return 'not_finalized';
  end if;

  if target_outcome is null
    or target_outcome not in (
      'success', 'partial', 'temporary_failure', 'action_required', 'disconnected'
    )
    or target_repository_snapshot is null
    or pg_catalog.jsonb_typeof(target_repository_snapshot) <> 'array'
  then
    raise exception 'invalid connection reconciliation outcome' using errcode = '22023';
  end if;

  if (target_outcome = 'success' and target_diagnostic_code is not null)
    or (target_outcome = 'partial' and target_diagnostic_code <> 'repository_unavailable')
    or (
      target_outcome = 'temporary_failure'
      and target_diagnostic_code not in (
        'provider_rate_limited', 'provider_temporary_failure',
        'invalid_provider_response', 'internal_failure'
      )
    )
    or (
      target_outcome = 'action_required'
      and target_diagnostic_code not in (
        'installation_suspended', 'permission_mismatch', 'account_mismatch'
      )
    )
    or (target_outcome = 'disconnected' and target_diagnostic_code <> 'installation_revoked')
    or (
      target_outcome in ('success', 'partial', 'temporary_failure')
      and target_next_attempt_at is null
    )
    or (
      target_outcome in ('action_required', 'disconnected')
      and target_next_attempt_at is not null
    )
  then
    raise exception 'invalid connection reconciliation outcome' using errcode = '22023';
  end if;

  repository_snapshot_count := pg_catalog.jsonb_array_length(target_repository_snapshot);
  if repository_snapshot_count > 10000 then
    raise exception 'a connection reconciliation may contain at most 10000 repositories'
      using errcode = '23514';
  end if;

  if target_outcome in ('success', 'partial') then
    for repository_value in
      select value from pg_catalog.jsonb_array_elements(target_repository_snapshot)
    loop
      if pg_catalog.jsonb_typeof(repository_value) <> 'object'
        or not (repository_value ?& array[
          'id', 'owner', 'name', 'fullName', 'htmlUrl',
          'visibility', 'archived', 'defaultBranch'
        ])
        or pg_catalog.jsonb_typeof(repository_value -> 'id') <> 'number'
        or pg_catalog.jsonb_typeof(repository_value -> 'owner') <> 'string'
        or pg_catalog.jsonb_typeof(repository_value -> 'name') <> 'string'
        or pg_catalog.jsonb_typeof(repository_value -> 'fullName') <> 'string'
        or pg_catalog.jsonb_typeof(repository_value -> 'htmlUrl') <> 'string'
        or pg_catalog.jsonb_typeof(repository_value -> 'visibility') <> 'string'
        or pg_catalog.jsonb_typeof(repository_value -> 'archived') <> 'boolean'
        or pg_catalog.jsonb_typeof(repository_value -> 'defaultBranch') <> 'string'
        or (repository_value ->> 'id') !~ '^[1-9][0-9]*$'
        or (repository_value ->> 'id')::numeric > 9007199254740991
        or (repository_value ->> 'owner') !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
        or pg_catalog.lower(repository_value ->> 'owner') <> pg_catalog.lower(installation_row.account_login)
        or pg_catalog.char_length(repository_value ->> 'name') > 100
        or (repository_value ->> 'name') !~ '^[A-Za-z0-9_.-]+$'
        or repository_value ->> 'name' in ('.', '..')
        or repository_value ->> 'fullName' <> (repository_value ->> 'owner') || '/' || (repository_value ->> 'name')
        or repository_value ->> 'htmlUrl' <> 'https://github.com/' || (repository_value ->> 'fullName')
        or repository_value ->> 'visibility' not in ('public', 'private', 'internal')
        or pg_catalog.char_length(repository_value ->> 'defaultBranch') not between 1 and 255
        or repository_value ->> 'defaultBranch' ~ '[[:cntrl:]]'
      then
        raise exception 'invalid canonical GitHub repository reconciliation snapshot'
          using errcode = '22023';
      end if;
    end loop;

    select pg_catalog.count(distinct (value ->> 'id'))
    into distinct_repository_count
    from pg_catalog.jsonb_array_elements(target_repository_snapshot);
    if distinct_repository_count <> repository_snapshot_count then
      raise exception 'GitHub reconciliation snapshot contains duplicate provider ids'
        using errcode = '22023';
    end if;

    select pg_catalog.count(distinct pg_catalog.lower(value ->> 'fullName'))
    into distinct_repository_count
    from pg_catalog.jsonb_array_elements(target_repository_snapshot);
    if distinct_repository_count <> repository_snapshot_count then
      raise exception 'GitHub reconciliation snapshot contains duplicate canonical names'
        using errcode = '22023';
    end if;
  end if;

  prior_incident_open := installation_row.health in (
    'partially_unavailable', 'owner_action_required', 'disconnected'
  ) or (
    installation_row.health = 'retrying'
    and installation_row.consecutive_reconciliation_failures >= 3
  );
  next_failure_count := case
    when superseded_success then installation_row.consecutive_reconciliation_failures
    when target_outcome = 'success' then 0
    else installation_row.consecutive_reconciliation_failures + 1
  end;
  next_incident_open := case
    when superseded_success then prior_incident_open
    else (
      (prior_incident_open and target_outcome <> 'success')
      or target_outcome in ('partial', 'action_required', 'disconnected')
      or (target_outcome = 'temporary_failure' and next_failure_count >= 3)
    )
  end;
  transition := case
    when next_incident_open and prior_incident_open then 'remained_open'
    when next_incident_open then 'opened'
    when prior_incident_open then 'recovered'
    else 'none'
  end;

  next_health := case target_outcome
    when 'success' then 'healthy'::public.github_connection_health
    when 'partial' then 'partially_unavailable'::public.github_connection_health
    when 'temporary_failure' then 'retrying'::public.github_connection_health
    when 'action_required' then 'owner_action_required'::public.github_connection_health
    else 'disconnected'::public.github_connection_health
  end;

  effective_next_attempt_at := target_next_attempt_at;
  if target_outcome = 'temporary_failure' then
    retry_floor := run_row.last_attempted_at + case
      when installation_row.consecutive_reconciliation_failures = 0 then interval '1 minute'
      when installation_row.consecutive_reconciliation_failures = 1 then interval '5 minutes'
      else interval '15 minutes'
    end;
    effective_next_attempt_at := case
      when target_diagnostic_code = 'provider_rate_limited'
        then greatest(target_next_attempt_at, retry_floor)
      else retry_floor
    end;
  end if;

  if target_outcome in ('success', 'partial') and not superseded_success then
    for repository_value in
      select value
      from pg_catalog.jsonb_array_elements(target_repository_snapshot)
      order by (value ->> 'id')::bigint
    loop
      insert into public.github_repositories(
        organisation_id, installation_id, provider_repository_id, owner_login,
        name, full_name, html_url, visibility, default_branch, archived,
        available, removed_at, last_seen_at
      ) values (
        run_row.organisation_id,
        run_row.installation_id,
        (repository_value ->> 'id')::bigint,
        repository_value ->> 'owner',
        repository_value ->> 'name',
        repository_value ->> 'fullName',
        repository_value ->> 'htmlUrl',
        repository_value ->> 'visibility',
        repository_value ->> 'defaultBranch',
        (repository_value ->> 'archived')::boolean,
        true,
        null,
        run_row.last_attempted_at
      )
      on conflict (installation_id, provider_repository_id) do update
      set owner_login = excluded.owner_login,
          name = excluded.name,
          full_name = excluded.full_name,
          html_url = excluded.html_url,
          visibility = excluded.visibility,
          default_branch = excluded.default_branch,
          archived = excluded.archived,
          available = true,
          removed_at = null,
          last_seen_at = excluded.last_seen_at;
    end loop;

    update public.github_repositories repository
    set available = false,
        removed_at = coalesce(repository.removed_at, run_row.last_attempted_at)
    where repository.installation_id = run_row.installation_id
      and repository.organisation_id = run_row.organisation_id
      and repository.available
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(target_repository_snapshot) inventory(value)
        where (inventory.value ->> 'id')::bigint = repository.provider_repository_id
      );
  elsif target_outcome in ('action_required', 'disconnected') then
    update public.github_repositories repository
    set available = false,
        removed_at = coalesce(repository.removed_at, run_row.last_attempted_at)
    where repository.installation_id = run_row.installation_id
      and repository.organisation_id = run_row.organisation_id
      and repository.available;
  end if;

  update public.github_installations installation
  set health = case when superseded_success then installation.health else next_health end,
      last_successful_reconciliation_at = case
        when target_outcome = 'success' and not superseded_success
        then run_row.last_attempted_at
        else installation.last_successful_reconciliation_at
      end,
      consecutive_reconciliation_failures = next_failure_count,
      next_reconciliation_at = case
        when has_newer_occurrence and target_outcome = 'temporary_failure'
          then greatest(installation.next_reconciliation_at, effective_next_attempt_at)
        when has_newer_occurrence
          then installation.next_reconciliation_at
        else effective_next_attempt_at
      end,
      health_diagnostic_code = case when superseded_success
        then installation.health_diagnostic_code else target_diagnostic_code end,
      reconciliation_locked_by = null,
      reconciliation_locked_until = null,
      status = case
        when superseded_success then installation.status
        when target_outcome in ('success', 'partial') then 'active'::public.github_installation_status
        when target_outcome = 'action_required' and target_diagnostic_code = 'installation_suspended' then 'suspended'::public.github_installation_status
        when target_outcome = 'action_required' then 'needs_attention'::public.github_installation_status
        when target_outcome = 'disconnected' then 'revoked'::public.github_installation_status
        else installation.status
      end,
      permissions_ok = case
        when superseded_success then installation.permissions_ok
        when target_outcome in ('success', 'partial') then true
        when target_outcome in ('action_required', 'disconnected') then false
        else installation.permissions_ok
      end,
      revoked_at = case
        when superseded_success then installation.revoked_at
        when target_outcome = 'disconnected' then run_row.last_attempted_at
        when target_outcome in ('success', 'partial', 'action_required') then null
        else installation.revoked_at
      end
  where installation.id = run_row.installation_id
    and installation.organisation_id = run_row.organisation_id
    and installation.reconciliation_locked_by = target_worker_id;

  if not found then
    return 'not_finalized';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where available)::integer,
         pg_catalog.count(*) filter (where not available)::integer
  into repository_total, repository_available, repository_unavailable
  from public.github_repositories
  where installation_id = run_row.installation_id
    and organisation_id = run_row.organisation_id;

  update public.github_connection_reconciliation_runs run
  set status = target_outcome,
      diagnostic_code = target_diagnostic_code,
      incident_transition = transition,
      completed_at = completed_time,
      repository_count = repository_total,
      available_repository_count = repository_available,
      unavailable_repository_count = repository_unavailable
  where run.id = run_row.id
    and run.organisation_id = run_row.organisation_id
    and run.installation_id = run_row.installation_id
    and run.status = 'running';

  if not found then
    raise exception 'connection reconciliation finalization lost run ownership'
      using errcode = '40001';
  end if;

  return transition;
end;
$$;

alter function public.finalize_github_connection_reconciliation_server(
  uuid, uuid, text, text, timestamptz, jsonb
) owner to postgres;
revoke all on function public.finalize_github_connection_reconciliation_server(
  uuid, uuid, text, text, timestamptz, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_github_connection_reconciliation_server(
  uuid, uuid, text, text, timestamptz, jsonb
) to service_role;

create or replace function public.disconnect_github_installation(
  target_installation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  installation_row public.github_installations;
  active_run_id uuid;
  actor_id uuid := (select auth.uid());
  disconnected_at timestamptz := pg_catalog.clock_timestamp();
begin
  if target_installation_id is null or actor_id is null then
    raise exception 'GitHub disconnect requires a current workspace Owner'
      using errcode = '42501';
  end if;

  select installation.* into installation_row
  from public.github_installations installation
  where installation.id = target_installation_id
    and exists (
      select 1
      from public.memberships membership
      where membership.organisation_id = installation.organisation_id
        and membership.user_id = actor_id
        and membership.role = 'owner'
    )
  for update;

  if not found then
    raise exception 'GitHub disconnect requires a current workspace Owner'
      using errcode = '42501';
  end if;

  if installation_row.health = 'disconnected' then
    return false;
  end if;

  select run.id into active_run_id
  from public.github_connection_reconciliation_runs run
  where run.installation_id = installation_row.id
    and run.organisation_id = installation_row.organisation_id
    and run.status = 'running'
  order by run.last_attempted_at desc, run.id
  limit 1
  for update;

  update public.github_installations
  set health = 'disconnected',
      next_reconciliation_at = null,
      health_diagnostic_code = null,
      reconciliation_locked_by = null,
      reconciliation_locked_until = null
  where id = installation_row.id
    and organisation_id = installation_row.organisation_id;

  update public.github_repositories repository
  set available = false,
      selected = false,
      removed_at = coalesce(repository.removed_at, disconnected_at)
  where repository.installation_id = installation_row.id
    and repository.organisation_id = installation_row.organisation_id
    and (repository.available or repository.selected);

  if active_run_id is not null then
    update public.github_connection_reconciliation_runs run
    set status = 'cancelled',
        diagnostic_code = null,
        incident_transition = 'none',
        completed_at = greatest(disconnected_at, run.last_attempted_at),
        repository_count = (
          select pg_catalog.count(*)::integer
          from public.github_repositories repository
          where repository.installation_id = installation_row.id
            and repository.organisation_id = installation_row.organisation_id
        ),
        available_repository_count = (
          select pg_catalog.count(*)::integer
          from public.github_repositories repository
          where repository.installation_id = installation_row.id
            and repository.organisation_id = installation_row.organisation_id
            and repository.available
        ),
        unavailable_repository_count = (
          select pg_catalog.count(*)::integer
          from public.github_repositories repository
          where repository.installation_id = installation_row.id
            and repository.organisation_id = installation_row.organisation_id
            and not repository.available
        )
    where run.id = active_run_id
      and run.organisation_id = installation_row.organisation_id
      and run.installation_id = installation_row.id
      and run.status = 'running';
  end if;

  return true;
end;
$$;

alter function public.disconnect_github_installation(uuid) owner to postgres;
revoke all on function public.disconnect_github_installation(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.disconnect_github_installation(uuid)
to authenticated;
