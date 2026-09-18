-- Milestone 1 Phase 3: durable connection-health state and reconciliation ledger.
-- Connection health is tenant-scoped operational truth only. It never creates
-- compliance outcomes, evidence, findings, tasks or readiness scores.

alter table public.github_installations
  add column health text not null default 'healthy'
    check (health in ('healthy', 'retrying', 'partially_unavailable', 'owner_action_required', 'disconnected')),
  add column last_reconciliation_attempt_at timestamptz,
  add column last_successful_reconciliation_at timestamptz,
  add column consecutive_reconciliation_failures integer not null default 0
    check (consecutive_reconciliation_failures >= 0),
  add column next_reconciliation_at timestamptz,
  add column health_diagnostic_code text
    check (health_diagnostic_code in (
      'provider_rate_limited', 'provider_temporary_failure', 'installation_suspended',
      'installation_revoked', 'permission_mismatch', 'account_mismatch',
      'repository_unavailable', 'invalid_provider_response', 'internal_failure'
    )),
  add column reconciliation_locked_by uuid,
  add column reconciliation_locked_until timestamptz;

create index github_installations_reconciliation_due_idx
on public.github_installations (status, health, next_reconciliation_at, reconciliation_locked_until);

grant select (
  health, last_reconciliation_attempt_at, last_successful_reconciliation_at,
  consecutive_reconciliation_failures, next_reconciliation_at, health_diagnostic_code
) on public.github_installations to authenticated;

create table public.github_connection_reconciliation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  trigger text not null check (trigger in ('initial', 'scheduled', 'webhook')),
  request_key text not null check (char_length(request_key) between 1 and 200),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  diagnostic_code text
    check (diagnostic_code in (
      'provider_rate_limited', 'provider_temporary_failure', 'installation_suspended',
      'installation_revoked', 'permission_mismatch', 'account_mismatch',
      'repository_unavailable', 'invalid_provider_response', 'internal_failure'
    )),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  repositories_seen integer not null default 0 check (repositories_seen >= 0),
  repositories_unavailable integer not null default 0 check (repositories_unavailable >= 0),
  locked_by uuid,
  locked_until timestamptz,
  constraint github_connection_runs_id_organisation_key unique (id, organisation_id),
  constraint github_connection_runs_id_tenant_installation_key
    unique (id, organisation_id, installation_id),
  constraint github_connection_runs_installation_request_key unique (installation_id, request_key),
  constraint github_connection_runs_installation_tenant_fk
    foreign key (installation_id, organisation_id)
    references public.github_installations(id, organisation_id)
    on delete cascade,
  constraint github_connection_runs_terminal_check check (
    (status = 'running' and completed_at is null)
    or (status in ('succeeded', 'partial', 'failed') and completed_at is not null)
  )
);

create index github_connection_runs_installation_started_idx
on public.github_connection_reconciliation_runs (installation_id, started_at desc);

alter table public.github_connection_reconciliation_runs enable row level security;

create policy github_connection_runs_members_select
on public.github_connection_reconciliation_runs for select to authenticated
using ((select public.is_organisation_member(organisation_id)));

revoke all on public.github_connection_reconciliation_runs from public, anon, authenticated, service_role;

grant select (
  id, organisation_id, installation_id, trigger, status,
  diagnostic_code, started_at, completed_at, repositories_seen, repositories_unavailable
) on public.github_connection_reconciliation_runs to authenticated;

-- Service-only due-claim: returns newly opened runs for one worker. Skips
-- disconnected installations, satisfied schedules and live leases without
-- blocking (SKIP LOCKED). The per-minute request key makes a repeated claim
-- idempotent: only the first claim opens work.
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
  installation_row public.github_installations;
  run_request_key text;
  opened_run_id uuid;
  opened_run_ids uuid[] := '{}';
begin
  if target_worker_id is null
    or target_limit is null
    or target_limit < 1
    or target_limit > 100
    or target_now is null
  then
    raise exception 'invalid connection reconciliation claim' using errcode = '22023';
  end if;

  for installation_row in
    select installation.*
    from public.github_installations installation
    where installation.status = 'active'
      and installation.health <> 'disconnected'
      and (installation.next_reconciliation_at is null or installation.next_reconciliation_at <= target_now)
      and (installation.reconciliation_locked_until is null or installation.reconciliation_locked_until < target_now)
    order by installation.next_reconciliation_at nulls first, installation.updated_at
    limit target_limit
    for update skip locked
  loop
    run_request_key := 'scheduled:' || installation_row.id::text || ':'
      || pg_catalog.floor(pg_catalog.date_part('epoch', target_now) / 60)::bigint::text;

    insert into public.github_connection_reconciliation_runs(
      organisation_id, installation_id, trigger, request_key, status,
      started_at, locked_by, locked_until
    ) values (
      installation_row.organisation_id,
      installation_row.id,
      'scheduled',
      run_request_key,
      'running',
      target_now,
      target_worker_id,
      target_now + interval '5 minutes'
    )
    on conflict (installation_id, request_key) do nothing
    returning id into opened_run_id;

    if found then
      update public.github_installations
      set reconciliation_locked_by = target_worker_id,
          reconciliation_locked_until = target_now + interval '5 minutes'
      where id = installation_row.id;
      opened_run_ids := opened_run_ids || opened_run_id;
    end if;
  end loop;

  return query
  select run.*
  from public.github_connection_reconciliation_runs run
  where run.id = any (opened_run_ids);
end;
$$;

revoke all on function public.claim_due_github_connection_reconciliations_server(uuid, integer, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.claim_due_github_connection_reconciliations_server(uuid, integer, timestamptz)
to service_role;

-- Service-only finaliser: compare-and-set lease ownership, then update
-- installation/repository truth atomically. Never deletes history and never
-- writes compliance records. Returns the incident signal for the transition:
-- 'opened', 'remained_open', 'recovered' or 'none'.
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
  new_health text;
  new_failures integer;
  run_status text;
  incident_signal text;
  repository_value jsonb;
  repository_count integer;
  distinct_repository_count integer;
  unavailable_count integer := 0;
begin
  if target_run_id is null
    or target_worker_id is null
    or target_outcome not in ('success', 'partial', 'temporary_failure', 'action_required', 'disconnected')
    or (target_diagnostic_code is not null and target_diagnostic_code not in (
      'provider_rate_limited', 'provider_temporary_failure', 'installation_suspended',
      'installation_revoked', 'permission_mismatch', 'account_mismatch',
      'repository_unavailable', 'invalid_provider_response', 'internal_failure'
    ))
    or (target_outcome in ('success', 'partial')
      and (target_repository_snapshot is null or pg_catalog.jsonb_typeof(target_repository_snapshot) <> 'array'))
    or (target_repository_snapshot is not null and pg_catalog.jsonb_typeof(target_repository_snapshot) <> 'array')
  then
    raise exception 'invalid connection reconciliation finalisation' using errcode = '22023';
  end if;

  select * into run_row
  from public.github_connection_reconciliation_runs
  where id = target_run_id
  for update;

  if not found
    or run_row.status <> 'running'
    or run_row.locked_by is distinct from target_worker_id
    or run_row.locked_until is null
    or run_row.locked_until < pg_catalog.now()
  then
    raise exception 'connection reconciliation lease mismatch' using errcode = '22023';
  end if;

  select * into installation_row
  from public.github_installations
  where id = run_row.installation_id
  for update;

  if not found then
    raise exception 'connection reconciliation installation missing' using errcode = '22023';
  end if;

  if target_repository_snapshot is not null then
    for repository_value in
      select value from pg_catalog.jsonb_array_elements(target_repository_snapshot)
    loop
      if pg_catalog.jsonb_typeof(repository_value) <> 'object'
        or not (repository_value ?& array[
          'id', 'owner', 'name', 'fullName', 'htmlUrl', 'visibility', 'archived', 'defaultBranch'
        ])
        or pg_catalog.jsonb_typeof(repository_value -> 'id') <> 'number'
        or (repository_value ->> 'id') !~ '^[1-9][0-9]*$'
        or pg_catalog.jsonb_typeof(repository_value -> 'owner') <> 'string'
        or pg_catalog.jsonb_typeof(repository_value -> 'name') <> 'string'
        or repository_value ->> 'fullName' <> (repository_value ->> 'owner') || '/' || (repository_value ->> 'name')
        or repository_value ->> 'htmlUrl' <> 'https://github.com/' || (repository_value ->> 'fullName')
        or repository_value ->> 'visibility' not in ('public', 'private', 'internal')
        or pg_catalog.jsonb_typeof(repository_value -> 'archived') <> 'boolean'
        or pg_catalog.jsonb_typeof(repository_value -> 'defaultBranch') <> 'string'
      then
        raise exception 'invalid connection repository snapshot' using errcode = '22023';
      end if;
    end loop;

    select pg_catalog.jsonb_array_length(target_repository_snapshot) into repository_count;
    select count(distinct (value ->> 'id')) into distinct_repository_count
    from pg_catalog.jsonb_array_elements(target_repository_snapshot);
    if distinct_repository_count <> repository_count then
      raise exception 'connection repository snapshot contains duplicate provider ids'
        using errcode = '22023';
    end if;
  end if;

  new_health := case target_outcome
    when 'success' then 'healthy'
    when 'partial' then 'partially_unavailable'
    when 'temporary_failure' then 'retrying'
    when 'action_required' then 'owner_action_required'
    else 'disconnected'
  end;
  new_failures := case when target_outcome = 'success' then 0
    else installation_row.consecutive_reconciliation_failures + 1 end;
  run_status := case target_outcome
    when 'success' then 'succeeded'
    when 'partial' then 'partial'
    else 'failed'
  end;

  if new_health = 'healthy' then
    incident_signal := case when installation_row.health in ('partially_unavailable', 'owner_action_required')
      then 'recovered' else 'none' end;
  elsif new_health = 'retrying' then
    incident_signal := 'none';
  elsif installation_row.health in ('healthy', 'retrying') then
    incident_signal := 'opened';
  else
    incident_signal := 'remained_open';
  end if;

  update public.github_installations
  set health = new_health,
      last_reconciliation_attempt_at = pg_catalog.now(),
      last_successful_reconciliation_at = case when target_outcome = 'success'
        then pg_catalog.now() else last_successful_reconciliation_at end,
      consecutive_reconciliation_failures = new_failures,
      next_reconciliation_at = target_next_attempt_at,
      health_diagnostic_code = target_diagnostic_code,
      reconciliation_locked_by = null,
      reconciliation_locked_until = null
  where id = installation_row.id;

  if target_repository_snapshot is not null then
    for repository_value in
      select value from pg_catalog.jsonb_array_elements(target_repository_snapshot)
    loop
      insert into public.github_repositories(
        organisation_id, installation_id, provider_repository_id, owner_login,
        name, full_name, html_url, visibility, default_branch, archived,
        available, removed_at, last_seen_at
      ) values (
        installation_row.organisation_id,
        installation_row.id,
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
        pg_catalog.now()
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
        removed_at = pg_catalog.now()
    where repository.installation_id = installation_row.id
      and repository.organisation_id = installation_row.organisation_id
      and repository.available
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(target_repository_snapshot) inventory(value)
        where (inventory.value ->> 'id')::bigint = repository.provider_repository_id
      );

    select pg_catalog.count(*) into unavailable_count
    from public.github_repositories
    where installation_id = installation_row.id
      and organisation_id = installation_row.organisation_id
      and not available;
  end if;

  update public.github_connection_reconciliation_runs
  set status = run_status,
      diagnostic_code = target_diagnostic_code,
      completed_at = pg_catalog.now(),
      repositories_seen = coalesce(repository_count, 0),
      repositories_unavailable = unavailable_count,
      locked_by = null,
      locked_until = null
  where id = run_row.id;

  return incident_signal;
end;
$$;

revoke all on function public.finalize_github_connection_reconciliation_server(uuid, uuid, text, text, timestamptz, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.finalize_github_connection_reconciliation_server(uuid, uuid, text, text, timestamptz, jsonb)
to service_role;

-- Authenticated Owner-only lifecycle command: marks the workspace installation
-- disconnected, stops future claims and retires every repository without
-- deleting history. Never calls GitHub and never implies provider revocation.
create or replace function public.disconnect_github_installation(target_installation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  installation_organisation_id uuid;
begin
  if target_installation_id is null then
    raise exception 'GitHub disconnection requires a current workspace Owner'
      using errcode = '42501';
  end if;

  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'GitHub disconnection requires a current workspace Owner'
      using errcode = '42501';
  end if;

  select installation.organisation_id into installation_organisation_id
  from public.github_installations installation
  where installation.id = target_installation_id
    and exists (
      select 1
      from public.memberships membership
      where membership.organisation_id = installation.organisation_id
        and membership.user_id = actor_id
        and membership.role = 'owner'
    );

  if not found then
    raise exception 'GitHub disconnection requires a current workspace Owner'
      using errcode = '42501';
  end if;

  update public.github_installations
  set health = 'disconnected',
      next_reconciliation_at = null,
      reconciliation_locked_by = null,
      reconciliation_locked_until = null
  where id = target_installation_id;

  update public.github_repositories
  set available = false,
      removed_at = coalesce(removed_at, pg_catalog.now()),
      selected = false
  where installation_id = target_installation_id
    and organisation_id = installation_organisation_id;

  return true;
end;
$$;

revoke all on function public.disconnect_github_installation(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.disconnect_github_installation(uuid)
to authenticated;
