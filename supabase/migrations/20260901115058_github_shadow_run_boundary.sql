-- Persist whether a GitHub collection is allowed to enter the official
-- materialisation queue. Existing and historical collection behavior remains
-- official; the dedicated shadow RPC is the only service boundary that can
-- create a shadow run.

alter table public.github_collection_runs
  add column run_mode text not null default 'official',
  add constraint github_collection_runs_mode_check
    check (run_mode in ('official', 'shadow'));

revoke insert (run_mode), update (run_mode)
on public.github_collection_runs from service_role;

create or replace function public.protect_github_collection_run_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.run_mode is distinct from new.run_mode then
    raise exception 'GitHub collection run mode is immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

alter function public.protect_github_collection_run_mode() owner to postgres;
revoke all on function public.protect_github_collection_run_mode()
  from public, anon, authenticated, service_role;

create trigger github_collection_runs_protect_mode
before update of run_mode on public.github_collection_runs
for each row execute function public.protect_github_collection_run_mode();

create or replace function public.reserve_github_collection_run_with_mode_server(
  target_organisation_id uuid,
  target_installation_id uuid,
  target_repository_id uuid,
  target_provider_repository_id bigint,
  target_trigger_type text,
  target_request_key text,
  target_lease_seconds integer,
  target_run_mode text
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
  provider_repository_id bigint,
  run_mode text
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
    or target_run_mode not in ('official', 'shadow')
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
    trigger_type, request_key, status, lease_token, lease_expires_at, attempt,
    run_mode
  ) values (
    target_organisation_id, target_installation_id, target_repository_id,
    target_provider_repository_id, target_trigger_type, target_request_key,
    'running', new_lease, new_expiry, 1, target_run_mode
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
    if candidate.run_mode <> target_run_mode then
      raise exception 'GitHub collection reservation mode mismatch' using errcode = 'P0001';
    end if;

    if candidate.status <> 'running' then
      return query select candidate.id, candidate.lease_token, candidate.lease_expires_at,
        candidate.attempt, 'completed_duplicate'::text, candidate.status,
        candidate.organisation_id, candidate.installation_id, candidate.repository_id,
        candidate.provider_repository_id, candidate.run_mode;
      return;
    end if;

    if candidate.lease_expires_at > pg_catalog.now() then
      return query select candidate.id, candidate.lease_token, candidate.lease_expires_at,
        candidate.attempt, 'active_duplicate'::text, candidate.status,
        candidate.organisation_id, candidate.installation_id, candidate.repository_id,
        candidate.provider_repository_id, candidate.run_mode;
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
      and collection_run.run_mode = target_run_mode
    returning * into candidate;
    if not found then
      raise exception 'GitHub collection lease changed concurrently' using errcode = '40001';
    end if;

    return query select candidate.id, candidate.lease_token, candidate.lease_expires_at,
      candidate.attempt, 'reclaimed'::text, candidate.status,
      candidate.organisation_id, candidate.installation_id, candidate.repository_id,
      candidate.provider_repository_id, candidate.run_mode;
    return;
  end if;

  return query select candidate.id, candidate.lease_token, candidate.lease_expires_at,
    candidate.attempt, 'acquired'::text, candidate.status,
    candidate.organisation_id, candidate.installation_id, candidate.repository_id,
    candidate.provider_repository_id, candidate.run_mode;
end;
$$;

alter function public.reserve_github_collection_run_with_mode_server(uuid,uuid,uuid,bigint,text,text,integer,text)
  owner to postgres;
revoke all on function public.reserve_github_collection_run_with_mode_server(uuid,uuid,uuid,bigint,text,text,integer,text)
  from public, anon, authenticated, service_role;

drop function if exists public.reserve_github_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer);

create function public.reserve_github_collection_run_server(
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
  provider_repository_id bigint,
  run_mode text
)
language sql
security definer
set search_path = ''
as $$
  select *
  from public.reserve_github_collection_run_with_mode_server(
    target_organisation_id, target_installation_id, target_repository_id,
    target_provider_repository_id, target_trigger_type, target_request_key,
    target_lease_seconds, 'official'
  );
$$;

alter function public.reserve_github_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)
  owner to postgres;
revoke all on function public.reserve_github_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_github_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)
  to service_role;

create or replace function public.reserve_github_shadow_collection_run_server(
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
  provider_repository_id bigint,
  run_mode text
)
language sql
security definer
set search_path = ''
as $$
  select *
  from public.reserve_github_collection_run_with_mode_server(
    target_organisation_id, target_installation_id, target_repository_id,
    target_provider_repository_id, target_trigger_type, target_request_key,
    target_lease_seconds, 'shadow'
  );
$$;

alter function public.reserve_github_shadow_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)
  owner to postgres;
revoke all on function public.reserve_github_shadow_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_github_shadow_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)
  to service_role;

create or replace function public.enqueue_github_materialisation_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.run_mode = 'official'
     and new.status in ('succeeded', 'partial')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.github_materialisation_jobs(
      organisation_id, installation_id, repository_id,
      provider_repository_id, collection_run_id
    ) values (
      new.organisation_id, new.installation_id, new.repository_id,
      new.provider_repository_id, new.id
    ) on conflict (collection_run_id) do nothing;
  end if;
  return new;
end;
$$;

alter function public.enqueue_github_materialisation_job() owner to postgres;
revoke all on function public.enqueue_github_materialisation_job()
  from public, anon, authenticated, service_role;
