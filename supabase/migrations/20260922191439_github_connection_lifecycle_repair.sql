-- Repair GitHub installation lifecycle transitions without rewriting the
-- already-applied claim or reconciliation migrations.

create or replace function public.claim_github_installation_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_provider_installation_id bigint,
  target_account_id bigint,
  target_account_login text,
  target_account_type text,
  target_repository_selection text,
  target_permissions jsonb,
  target_permissions_ok boolean,
  target_repositories jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_installation public.github_installations;
  installation_exists boolean;
  reconnecting boolean := false;
  claimed_installation_id uuid;
  repository_value jsonb;
  repository_count integer;
  distinct_repository_count integer;
begin
  if target_organisation_id is null
    or target_actor_id is null
    or target_provider_installation_id is null
    or target_provider_installation_id <= 0
    or target_account_id is null
    or target_account_id <= 0
    or target_repository_selection <> 'selected'
    or target_permissions_ok is not true
    or pg_catalog.jsonb_typeof(target_permissions) <> 'object'
    or pg_catalog.jsonb_typeof(target_repositories) <> 'array'
  then
    raise exception 'invalid verified GitHub installation claim' using errcode = '22023';
  end if;

  perform 1
  from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for update;

  if not found then
    raise exception 'GitHub installation claim requires a current workspace Owner'
      using errcode = '42501';
  end if;

  repository_count := pg_catalog.jsonb_array_length(target_repositories);
  if repository_count > 10000 then
    raise exception 'a verified GitHub installation claim may contain at most 10000 repositories'
      using errcode = '23514';
  end if;

  for repository_value in
    select value from pg_catalog.jsonb_array_elements(target_repositories)
  loop
    if pg_catalog.jsonb_typeof(repository_value) <> 'object'
      or not (repository_value ?& array[
        'id', 'owner', 'name', 'fullName', 'htmlUrl', 'visibility', 'archived', 'defaultBranch'
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
      or repository_value ->> 'fullName' <> (repository_value ->> 'owner') || '/' || (repository_value ->> 'name')
      or repository_value ->> 'htmlUrl' <> 'https://github.com/' || (repository_value ->> 'fullName')
      or repository_value ->> 'visibility' not in ('public', 'private', 'internal')
    then
      raise exception 'invalid canonical GitHub repository inventory' using errcode = '22023';
    end if;
  end loop;

  select count(distinct (value ->> 'id'))
  into distinct_repository_count
  from pg_catalog.jsonb_array_elements(target_repositories);
  if distinct_repository_count <> repository_count then
    raise exception 'GitHub repository inventory contains duplicate provider ids'
      using errcode = '22023';
  end if;

  select count(distinct pg_catalog.lower(value ->> 'fullName'))
  into distinct_repository_count
  from pg_catalog.jsonb_array_elements(target_repositories);
  if distinct_repository_count <> repository_count then
    raise exception 'GitHub repository inventory contains duplicate canonical names'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'github-installation:' || target_provider_installation_id::text,
      0
    )
  );

  select * into existing_installation
  from public.github_installations
  where provider_installation_id = target_provider_installation_id
  for update;

  installation_exists := found;

  if installation_exists and existing_installation.organisation_id <> target_organisation_id then
    raise exception 'GitHub installation is already claimed by another workspace'
      using errcode = '42501';
  end if;

  perform 1
  from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for update;

  if not found then
    raise exception 'GitHub installation claim requires a current workspace Owner'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', target_actor_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  if installation_exists then
    reconnecting := existing_installation.health = 'disconnected';

    update public.github_installations
    set account_id = target_account_id,
        account_login = target_account_login,
        account_type = target_account_type,
        repository_selection = target_repository_selection,
        status = 'active',
        connected_by = target_actor_id,
        permissions = target_permissions,
        permissions_ok = true,
        revoked_at = null,
        health = case when reconnecting then 'retrying' else health end,
        consecutive_reconciliation_failures = case when reconnecting then 0
          else consecutive_reconciliation_failures end,
        next_reconciliation_at = case when reconnecting then pg_catalog.now()
          else next_reconciliation_at end,
        health_diagnostic_code = case when reconnecting then null
          else health_diagnostic_code end,
        reconciliation_locked_by = case when reconnecting then null
          else reconciliation_locked_by end,
        reconciliation_locked_until = case when reconnecting then null
          else reconciliation_locked_until end
    where id = existing_installation.id
    returning id into claimed_installation_id;

    if reconnecting then
      update public.github_repositories
      set selected = false
      where installation_id = existing_installation.id
        and organisation_id = target_organisation_id;
    end if;
  else
    insert into public.github_installations(
      organisation_id, provider_installation_id, account_id, account_login,
      account_type, repository_selection, status, connected_by, permissions,
      permissions_ok
    ) values (
      target_organisation_id, target_provider_installation_id, target_account_id,
      target_account_login, target_account_type, target_repository_selection,
      'active', target_actor_id, target_permissions, true
    ) returning id into claimed_installation_id;
  end if;

  for repository_value in
    select value from pg_catalog.jsonb_array_elements(target_repositories)
  loop
    insert into public.github_repositories(
      organisation_id, installation_id, provider_repository_id, owner_login,
      name, full_name, html_url, visibility, default_branch, archived,
      available, removed_at, last_seen_at
    ) values (
      target_organisation_id,
      claimed_installation_id,
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
  where repository.installation_id = claimed_installation_id
    and repository.organisation_id = target_organisation_id
    and repository.available
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(target_repositories) inventory(value)
      where (inventory.value ->> 'id')::bigint = repository.provider_repository_id
    );

  return claimed_installation_id;
end;
$$;

alter function public.claim_github_installation_server(
  uuid, uuid, bigint, bigint, text, text, text, jsonb, boolean, jsonb
) owner to postgres;
revoke all on function public.claim_github_installation_server(
  uuid, uuid, bigint, bigint, text, text, text, jsonb, boolean, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.claim_github_installation_server(
  uuid, uuid, bigint, bigint, text, text, text, jsonb, boolean, jsonb
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
  observed_run public.github_connection_reconciliation_runs;
  locked_at timestamptz;
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

  -- Discover the installation without locking the run. The global lock order
  -- is installation first, then run, matching the due-claim transaction.
  select * into observed_run
  from public.github_connection_reconciliation_runs
  where id = target_run_id;

  if not found then
    raise exception 'connection reconciliation lease mismatch' using errcode = '22023';
  end if;

  select * into installation_row
  from public.github_installations
  where id = observed_run.installation_id
    and organisation_id = observed_run.organisation_id
  for update;

  if not found then
    raise exception 'connection reconciliation lease mismatch' using errcode = '22023';
  end if;

  select * into run_row
  from public.github_connection_reconciliation_runs
  where id = target_run_id
  for update;

  if not found then
    raise exception 'connection reconciliation lease mismatch' using errcode = '22023';
  end if;

  locked_at := pg_catalog.clock_timestamp();

  if run_row.status <> 'running'
    or run_row.installation_id is distinct from installation_row.id
    or run_row.organisation_id is distinct from installation_row.organisation_id
    or installation_row.status <> 'active'
    or installation_row.health = 'disconnected'
    or run_row.locked_by is distinct from target_worker_id
    or run_row.locked_until is null
    or installation_row.reconciliation_locked_by is distinct from target_worker_id
    or installation_row.reconciliation_locked_until is null
    or installation_row.reconciliation_locked_until is distinct from run_row.locked_until
    or run_row.locked_until <= locked_at
    or installation_row.reconciliation_locked_until <= locked_at
  then
    raise exception 'connection reconciliation lease mismatch' using errcode = '22023';
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

  if target_outcome = 'success' then
    select case when exists (
      select 1
      from public.github_connection_incidents incident
      where incident.organisation_id = installation_row.organisation_id
        and incident.installation_id = installation_row.id
        and incident.status = 'open'
    ) then 'recovered' else 'none' end
    into incident_signal;
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

alter function public.finalize_github_connection_reconciliation_server(uuid, uuid, text, text, timestamptz, jsonb)
owner to postgres;
revoke all on function public.finalize_github_connection_reconciliation_server(uuid, uuid, text, text, timestamptz, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.finalize_github_connection_reconciliation_server(uuid, uuid, text, text, timestamptz, jsonb)
to service_role;
