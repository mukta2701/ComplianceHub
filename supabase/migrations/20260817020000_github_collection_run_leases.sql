-- Crash-safe, compare-and-set leases for GitHub shadow collection. Provider
-- ancestry is copied onto the run so every service mutation can prove the full
-- tenant/install/repository chain without trusting caller-supplied IDs alone.

alter table public.github_collection_runs
  add column provider_repository_id bigint,
  add column lease_token uuid not null default extensions.gen_random_uuid(),
  add column lease_expires_at timestamptz not null default (pg_catalog.now() + interval '2 minutes'),
  add column attempt integer not null default 1;

update public.github_collection_runs collection_run
set provider_repository_id = repository.provider_repository_id
from public.github_repositories repository
where repository.id = collection_run.repository_id
  and repository.organisation_id = collection_run.organisation_id
  and repository.installation_id = collection_run.installation_id;

alter table public.github_collection_runs
  alter column provider_repository_id set not null,
  add constraint github_collection_runs_provider_repository_positive
    check (provider_repository_id > 0),
  add constraint github_collection_runs_id_provider_ancestry_key
    unique (id, organisation_id, installation_id, repository_id, provider_repository_id),
  add constraint github_collection_runs_provider_repository_tenant_fk
    foreign key (repository_id, organisation_id, installation_id, provider_repository_id)
    references public.github_repositories(id, organisation_id, installation_id, provider_repository_id)
    on delete restrict,
  add constraint github_collection_runs_lease_lifecycle_check check (
    attempt > 0
    and lease_expires_at > started_at
    and (
      (status = 'running' and completed_at is null)
      or (status <> 'running' and completed_at is not null)
    )
  );

alter table public.github_collection_runs
  alter column lease_token drop default,
  alter column lease_expires_at drop default,
  alter column attempt drop default;

create index github_collection_runs_active_lease_idx
on public.github_collection_runs(lease_expires_at, id)
where status = 'running';

-- The service role can read safe work state, but all collection mutations now
-- go through the full-ancestry lease RPCs below.
revoke update (
  owner_login, name, full_name, html_url, visibility, default_branch, archived,
  last_seen_at, updated_at
) on public.github_repositories from service_role;
revoke insert (
  organisation_id, installation_id, repository_id, trigger_type, request_key,
  status, diagnostic_code, started_at, completed_at, observation_count,
  passed_count, failed_count, unknown_count, not_applicable_count
) on public.github_collection_runs from service_role;
revoke update (
  status, diagnostic_code, completed_at, observation_count, passed_count,
  failed_count, unknown_count, not_applicable_count
) on public.github_collection_runs from service_role;
revoke insert (
  organisation_id, installation_id, repository_id, provider_repository_id,
  collection_run_id, observation_key, check_id, rule_version, subject_type,
  subject_id, result, severity, title, explanation, remediation, observed_at,
  fresh_until, source_url, fingerprint, diagnostic_code
) on public.github_observations from service_role;

create or replace function public.reserve_github_collection_run_server(
  target_organisation_id uuid,
  target_installation_id uuid,
  target_repository_id uuid,
  target_provider_repository_id bigint,
  target_trigger_type text,
  target_request_key text,
  target_lease_seconds integer
)
returns table (
  run_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt integer,
  acquisition_state text,
  status public.github_collection_status,
  organisation_id uuid,
  installation_id uuid,
  repository_id uuid,
  provider_repository_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.github_collection_runs;
  new_lease uuid := extensions.gen_random_uuid();
  new_expiry timestamptz;
  inserted boolean := false;
begin
  if target_organisation_id is null
    or target_installation_id is null
    or target_repository_id is null
    or target_provider_repository_id is null
    or target_provider_repository_id <= 0
    or target_trigger_type not in ('initial', 'scheduled', 'manual', 'webhook')
    or target_request_key is null
    or pg_catalog.char_length(target_request_key) not between 1 and 200
    or target_lease_seconds not between 30 and 240
  then
    raise exception 'invalid GitHub collection reservation' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.github_repositories repository
    join public.github_installations installation
      on installation.id = repository.installation_id
     and installation.organisation_id = repository.organisation_id
    where repository.id = target_repository_id
      and repository.organisation_id = target_organisation_id
      and repository.installation_id = target_installation_id
      and repository.provider_repository_id = target_provider_repository_id
      and repository.selected
      and repository.available
      and installation.status = 'active'
      and installation.permissions_ok
  ) then
    raise exception 'GitHub collection target is unavailable' using errcode = 'P0001';
  end if;

  new_expiry := pg_catalog.now() + pg_catalog.make_interval(secs => target_lease_seconds);
  insert into public.github_collection_runs (
    organisation_id, installation_id, repository_id, provider_repository_id,
    trigger_type, request_key, status, lease_token, lease_expires_at, attempt
  ) values (
    target_organisation_id, target_installation_id, target_repository_id,
    target_provider_repository_id, target_trigger_type, target_request_key,
    'running', new_lease, new_expiry, 1
  )
  on conflict on constraint github_collection_runs_repository_request_key do nothing
  returning * into candidate;
  inserted := found;

  if not inserted then
    select collection_run.* into candidate
    from public.github_collection_runs collection_run
    where collection_run.repository_id = target_repository_id
      and collection_run.request_key = target_request_key
    for update;
    if not found
      or candidate.organisation_id <> target_organisation_id
      or candidate.installation_id <> target_installation_id
      or candidate.provider_repository_id <> target_provider_repository_id
      or candidate.trigger_type <> target_trigger_type
    then
      raise exception 'GitHub collection reservation ancestry mismatch' using errcode = 'P0001';
    end if;

    if candidate.status <> 'running' then
      return query select candidate.id, candidate.lease_token, candidate.lease_expires_at,
        candidate.attempt, 'completed_duplicate'::text, candidate.status,
        candidate.organisation_id, candidate.installation_id, candidate.repository_id,
        candidate.provider_repository_id;
      return;
    end if;

    if candidate.lease_expires_at > pg_catalog.now() then
      return query select candidate.id, candidate.lease_token, candidate.lease_expires_at,
        candidate.attempt, 'active_duplicate'::text, candidate.status,
        candidate.organisation_id, candidate.installation_id, candidate.repository_id,
        candidate.provider_repository_id;
      return;
    end if;

    update public.github_collection_runs collection_run
    set lease_token = new_lease,
        lease_expires_at = new_expiry,
        attempt = candidate.attempt + 1
    where collection_run.id = candidate.id
      and collection_run.organisation_id = candidate.organisation_id
      and collection_run.installation_id = candidate.installation_id
      and collection_run.repository_id = candidate.repository_id
      and collection_run.provider_repository_id = candidate.provider_repository_id
      and collection_run.status = 'running'
      and collection_run.lease_token = candidate.lease_token
      and collection_run.lease_expires_at = candidate.lease_expires_at
      and collection_run.attempt = candidate.attempt
    returning * into candidate;
    if not found then
      raise exception 'GitHub collection lease changed concurrently' using errcode = '40001';
    end if;

    return query select candidate.id, candidate.lease_token, candidate.lease_expires_at,
      candidate.attempt, 'reclaimed'::text, candidate.status,
      candidate.organisation_id, candidate.installation_id, candidate.repository_id,
      candidate.provider_repository_id;
    return;
  end if;

  return query select candidate.id, candidate.lease_token, candidate.lease_expires_at,
    candidate.attempt, 'acquired'::text, candidate.status,
    candidate.organisation_id, candidate.installation_id, candidate.repository_id,
    candidate.provider_repository_id;
end;
$$;

alter function public.reserve_github_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer) owner to postgres;
revoke all on function public.reserve_github_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_github_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)
  to service_role;

create or replace function public.save_github_observations_server(
  target_run_id uuid,
  target_organisation_id uuid,
  target_installation_id uuid,
  target_repository_id uuid,
  target_provider_repository_id bigint,
  target_lease_token uuid,
  target_attempt integer,
  target_observations jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  collection_run public.github_collection_runs;
  repository public.github_repositories;
  expected_check_ids constant text[] := array[
    'github.repository.visibility', 'github.repository.archived',
    'github.branch.force_pushes', 'github.branch.deletions',
    'github.branch.approving_reviews', 'github.branch.stale_approvals',
    'github.branch.code_owner_reviews', 'github.branch.status_checks',
    'github.dependabot.high_critical', 'github.code_scanning.high_critical',
    'github.secret_scanning.enabled', 'github.secret_scanning.push_protection',
    'github.secret_scanning.open_alerts', 'github.workflow.security',
    'github.administration.outside_collaborator_admins'
  ];
  actual_check_ids text[];
  persisted_count integer;
begin
  select run.* into collection_run
  from public.github_collection_runs run
  where run.id = target_run_id
    and run.organisation_id = target_organisation_id
    and run.installation_id = target_installation_id
    and run.repository_id = target_repository_id
    and run.provider_repository_id = target_provider_repository_id
  for update;
  if not found
    or collection_run.status <> 'running'
    or collection_run.lease_token <> target_lease_token
    or collection_run.attempt <> target_attempt
    or collection_run.lease_expires_at <= pg_catalog.now()
  then
    return -1;
  end if;
  if pg_catalog.jsonb_typeof(target_observations) <> 'array'
    or pg_catalog.jsonb_array_length(target_observations) <> pg_catalog.array_length(expected_check_ids, 1)
  then
    raise exception 'invalid GitHub observation set' using errcode = '22023';
  end if;

  select repository_row.* into repository
  from public.github_repositories repository_row
  where repository_row.id = target_repository_id
    and repository_row.organisation_id = target_organisation_id
    and repository_row.installation_id = target_installation_id
    and repository_row.provider_repository_id = target_provider_repository_id;
  if not found then return -1; end if;

  select pg_catalog.array_agg(item.check_id order by item.check_id)
  into actual_check_ids
  from (
    select element->>'check_id' as check_id
    from pg_catalog.jsonb_array_elements(target_observations) element
    group by element->>'check_id'
  ) item;
  if actual_check_ids is distinct from (
    select pg_catalog.array_agg(check_id order by check_id)
    from pg_catalog.unnest(expected_check_ids) check_id
  ) then
    raise exception 'invalid GitHub observation check set' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(target_observations) element
    where element->>'rule_version' <> 'github-repository-v1'
      or element->>'subject_type' <> 'github_repository'
      or element->>'subject_id' <> repository.owner_login || '/' || repository.name
      or element->>'source_url' <> repository.html_url
      or element->>'observation_key' <>
        repository.owner_login || '/' || repository.name || '/' ||
        (element->>'check_id') || '/github-repository-v1'
  ) then
    raise exception 'invalid GitHub observation ancestry' using errcode = '22023';
  end if;

  insert into public.github_observations (
    organisation_id, installation_id, repository_id, provider_repository_id,
    collection_run_id, observation_key, check_id, rule_version, subject_type,
    subject_id, result, severity, title, explanation, remediation, observed_at,
    fresh_until, source_url, fingerprint, diagnostic_code
  )
  select
    target_organisation_id, target_installation_id, target_repository_id,
    target_provider_repository_id, target_run_id,
    item.observation_key, item.check_id, item.rule_version, item.subject_type,
    item.subject_id, item.result::public.github_observation_result, item.severity,
    item.title, item.explanation, item.remediation, item.observed_at,
    item.fresh_until, item.source_url, item.fingerprint, item.diagnostic_code
  from pg_catalog.jsonb_to_recordset(target_observations) as item(
    observation_key text, check_id text, rule_version text, subject_type text,
    subject_id text, result text, severity text, title text, explanation text,
    remediation text, observed_at timestamptz, fresh_until timestamptz,
    source_url text, fingerprint text, diagnostic_code text
  )
  on conflict (collection_run_id, observation_key) do nothing;

  select pg_catalog.count(*)::integer into persisted_count
  from public.github_observations observation
  where observation.collection_run_id = target_run_id
    and observation.organisation_id = target_organisation_id
    and observation.installation_id = target_installation_id
    and observation.repository_id = target_repository_id
    and observation.provider_repository_id = target_provider_repository_id;
  return persisted_count;
end;
$$;

alter function public.save_github_observations_server(uuid,uuid,uuid,uuid,bigint,uuid,integer,jsonb) owner to postgres;
revoke all on function public.save_github_observations_server(uuid,uuid,uuid,uuid,bigint,uuid,integer,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_github_observations_server(uuid,uuid,uuid,uuid,bigint,uuid,integer,jsonb)
  to service_role;

create or replace function public.finalise_github_collection_run_server(
  target_run_id uuid,
  target_organisation_id uuid,
  target_installation_id uuid,
  target_repository_id uuid,
  target_provider_repository_id bigint,
  target_lease_token uuid,
  target_attempt integer,
  target_status text,
  target_diagnostic_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  persisted_count integer;
  pass_count integer;
  compliance_fail_count integer;
  unknown_result_count integer;
  not_applicable_result_count integer;
  changed integer;
begin
  if target_status not in ('succeeded', 'partial', 'failed', 'rate_limited')
    or (target_status in ('succeeded', 'partial') and target_diagnostic_code is not null)
    or (target_status in ('failed', 'rate_limited') and target_diagnostic_code not in (
      'permission_denied', 'feature_unavailable', 'not_found', 'rate_limited',
      'provider_unavailable', 'invalid_response'
    ))
    or (target_status = 'rate_limited' and target_diagnostic_code <> 'rate_limited')
  then
    raise exception 'invalid GitHub collection outcome' using errcode = '22023';
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where observation.result = 'pass')::integer,
    pg_catalog.count(*) filter (where observation.result = 'fail')::integer,
    pg_catalog.count(*) filter (where observation.result = 'unknown')::integer,
    pg_catalog.count(*) filter (where observation.result = 'not_applicable')::integer
  into persisted_count, pass_count, compliance_fail_count, unknown_result_count, not_applicable_result_count
  from public.github_observations observation
  where observation.collection_run_id = target_run_id
    and observation.organisation_id = target_organisation_id
    and observation.installation_id = target_installation_id
    and observation.repository_id = target_repository_id
    and observation.provider_repository_id = target_provider_repository_id;

  if target_status in ('succeeded', 'partial') and persisted_count <> 15 then
    return false;
  end if;
  if target_status in ('succeeded', 'partial') then
    target_status := case when unknown_result_count > 0 then 'partial' else 'succeeded' end;
  end if;

  update public.github_collection_runs collection_run
  set status = target_status::public.github_collection_status,
      diagnostic_code = target_diagnostic_code,
      completed_at = pg_catalog.now(),
      observation_count = persisted_count,
      passed_count = pass_count,
      failed_count = compliance_fail_count,
      unknown_count = unknown_result_count,
      not_applicable_count = not_applicable_result_count
  where collection_run.id = target_run_id
    and collection_run.organisation_id = target_organisation_id
    and collection_run.installation_id = target_installation_id
    and collection_run.repository_id = target_repository_id
    and collection_run.provider_repository_id = target_provider_repository_id
    and collection_run.status = 'running'
    and collection_run.lease_token = target_lease_token
    and collection_run.attempt = target_attempt
    and collection_run.lease_expires_at > pg_catalog.now();
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

alter function public.finalise_github_collection_run_server(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text) owner to postgres;
revoke all on function public.finalise_github_collection_run_server(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalise_github_collection_run_server(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text)
  to service_role;

create or replace function public.refresh_github_repository_server(
  target_run_id uuid,
  target_organisation_id uuid,
  target_installation_id uuid,
  target_repository_id uuid,
  target_provider_repository_id bigint,
  target_lease_token uuid,
  target_attempt integer,
  target_owner_login text,
  target_name text,
  target_html_url text,
  target_visibility text,
  target_default_branch text,
  target_archived boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  collection_run public.github_collection_runs;
  changed integer;
begin
  select run.* into collection_run
  from public.github_collection_runs run
  where run.id = target_run_id
    and run.organisation_id = target_organisation_id
    and run.installation_id = target_installation_id
    and run.repository_id = target_repository_id
    and run.provider_repository_id = target_provider_repository_id
  for update;
  if not found
    or collection_run.status <> 'running'
    or collection_run.lease_token <> target_lease_token
    or collection_run.attempt <> target_attempt
    or collection_run.lease_expires_at <= pg_catalog.now()
  then
    return false;
  end if;

  update public.github_repositories repository
  set owner_login = target_owner_login,
      name = target_name,
      full_name = target_owner_login || '/' || target_name,
      html_url = target_html_url,
      visibility = target_visibility,
      default_branch = target_default_branch,
      archived = target_archived,
      last_seen_at = pg_catalog.now()
  from public.github_installations installation
  where repository.id = target_repository_id
    and repository.organisation_id = target_organisation_id
    and repository.installation_id = target_installation_id
    and repository.provider_repository_id = target_provider_repository_id
    and repository.selected
    and repository.available
    and installation.id = repository.installation_id
    and installation.organisation_id = repository.organisation_id
    and installation.status = 'active'
    and installation.permissions_ok;
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;

  update public.github_collection_runs run
  set lease_expires_at = greatest(
    run.lease_expires_at,
    pg_catalog.now() + interval '120 seconds'
  )
  where run.id = target_run_id
    and run.organisation_id = target_organisation_id
    and run.installation_id = target_installation_id
    and run.repository_id = target_repository_id
    and run.provider_repository_id = target_provider_repository_id
    and run.status = 'running'
    and run.lease_token = target_lease_token
    and run.attempt = target_attempt;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'GitHub repository refresh lease changed concurrently' using errcode = '40001';
  end if;
  return true;
end;
$$;

alter function public.refresh_github_repository_server(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text,text,text,text,boolean) owner to postgres;
revoke all on function public.refresh_github_repository_server(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text,text,text,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.refresh_github_repository_server(uuid,uuid,uuid,uuid,bigint,uuid,integer,text,text,text,text,text,boolean)
  to service_role;
