-- Wake only jobs whose own complete official run has a current, matching
-- approved mapping entry that can still be materialised. Historical receipts
-- are intentionally not consulted: they are ancestry, not standing consent.

create function public.github_materialisation_job_has_current_approval(
  target_organisation_id uuid,
  target_collection_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.github_collection_runs run
    join public.github_materialisation_jobs job
      on job.collection_run_id = run.id
     and job.organisation_id = run.organisation_id
    join public.github_effective_mapping_entry_decisions effective
      on effective.organisation_id = run.organisation_id
     and effective.status = 'approved'
    join public.github_mapping_packs pack
      on pack.id = effective.mapping_pack_id
     and pack.published_at is not null
     and pack.checksum = public.github_mapping_pack_checksum(pack.id)
    join public.github_mapping_entries entry
      on entry.id = effective.mapping_entry_id
     and entry.mapping_pack_id = pack.id
     and entry.check_id = effective.check_id
     and public.github_mapping_entry_digest(entry.id) = effective.entry_digest
    join public.github_observations observation
      on observation.organisation_id = run.organisation_id
     and observation.installation_id = run.installation_id
     and observation.repository_id = run.repository_id
     and observation.provider_repository_id = run.provider_repository_id
     and observation.collection_run_id = run.id
     and observation.check_id = entry.check_id
     and observation.rule_version = entry.rule_version
    where run.id = target_collection_run_id
      and run.organisation_id = target_organisation_id
      and run.run_mode = 'official'
      and run.status in ('succeeded', 'partial')
      and run.observation_count = 15
      and (
        select pg_catalog.count(*)
        from public.github_observations complete_observation
        where complete_observation.organisation_id = run.organisation_id
          and complete_observation.installation_id = run.installation_id
          and complete_observation.repository_id = run.repository_id
          and complete_observation.provider_repository_id = run.provider_repository_id
          and complete_observation.collection_run_id = run.id
      ) = 15
      and (
        select pg_catalog.count(distinct complete_observation.check_id)
        from public.github_observations complete_observation
        join public.github_mapping_entries complete_entry
          on complete_entry.mapping_pack_id = pack.id
         and complete_entry.check_id = complete_observation.check_id
         and complete_entry.rule_version = complete_observation.rule_version
        where complete_observation.organisation_id = run.organisation_id
          and complete_observation.installation_id = run.installation_id
          and complete_observation.repository_id = run.repository_id
          and complete_observation.provider_repository_id = run.provider_repository_id
          and complete_observation.collection_run_id = run.id
      ) = 15
      -- Official results are immutable and one-per-observation. A different
      -- selected pack cannot safely replay this run's already-written ledger;
      -- the next collection run is the boundary for changed mappings.
      and not exists (
        select 1
        from public.github_official_compliance_results prior_result
        where prior_result.organisation_id = run.organisation_id
          and prior_result.collection_run_id = run.id
          and (
            prior_result.mapping_pack_id <> pack.id
            or prior_result.mapping_version <> pack.version
            or prior_result.mapping_checksum <> pack.checksum
          )
      )
      and not exists (
        select 1
        from public.github_official_compliance_results result
        where result.organisation_id = run.organisation_id
          and result.collection_run_id = run.id
          and result.observation_id = observation.id
      )
  );
$$;

alter function public.github_materialisation_job_has_current_approval(uuid, uuid)
  owner to postgres;
revoke all on function public.github_materialisation_job_has_current_approval(uuid, uuid)
  from public, anon, authenticated, service_role;

-- An all-rejected run has no materialisation work, but must leave the parked
-- queue: complete it without a worker lease or retry attempt. This is safe only
-- when every exact current check is explicitly rejected and no official row
-- already exists for the run.
create function public.github_materialisation_job_is_fully_rejected(
  target_organisation_id uuid,
  target_collection_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.github_collection_runs run
    join public.github_materialisation_jobs job
      on job.collection_run_id = run.id
     and job.organisation_id = run.organisation_id
    join public.github_effective_mapping_entry_decisions effective
      on effective.organisation_id = run.organisation_id
     and effective.status = 'rejected'
    join public.github_mapping_packs pack
      on pack.id = effective.mapping_pack_id
     and pack.published_at is not null
     and pack.checksum = public.github_mapping_pack_checksum(pack.id)
    join public.github_mapping_entries entry
      on entry.id = effective.mapping_entry_id
     and entry.mapping_pack_id = pack.id
     and entry.check_id = effective.check_id
     and public.github_mapping_entry_digest(entry.id) = effective.entry_digest
    where run.id = target_collection_run_id
      and run.organisation_id = target_organisation_id
      and run.run_mode = 'official'
      and run.status in ('succeeded', 'partial')
      and run.observation_count = 15
      and (
        select pg_catalog.count(*) from public.github_observations complete_observation
        where complete_observation.organisation_id = run.organisation_id
          and complete_observation.installation_id = run.installation_id
          and complete_observation.repository_id = run.repository_id
          and complete_observation.provider_repository_id = run.provider_repository_id
          and complete_observation.collection_run_id = run.id
      ) = 15
      and (
        select pg_catalog.count(distinct complete_observation.check_id)
        from public.github_observations complete_observation
        join public.github_mapping_entries complete_entry
          on complete_entry.mapping_pack_id = pack.id
         and complete_entry.check_id = complete_observation.check_id
         and complete_entry.rule_version = complete_observation.rule_version
        where complete_observation.organisation_id = run.organisation_id
          and complete_observation.installation_id = run.installation_id
          and complete_observation.repository_id = run.repository_id
          and complete_observation.provider_repository_id = run.provider_repository_id
          and complete_observation.collection_run_id = run.id
      ) = 15
      and not exists (
        select 1
        from public.github_observations observation
        join public.github_mapping_entries selected_entry
          on selected_entry.mapping_pack_id = pack.id
         and selected_entry.check_id = observation.check_id
         and selected_entry.rule_version = observation.rule_version
        left join public.github_effective_mapping_entry_decisions current_decision
          on current_decision.organisation_id = run.organisation_id
         and current_decision.mapping_pack_id = pack.id
         and current_decision.mapping_entry_id = selected_entry.id
         and current_decision.entry_digest = public.github_mapping_entry_digest(selected_entry.id)
        where observation.organisation_id = run.organisation_id
          and observation.installation_id = run.installation_id
          and observation.repository_id = run.repository_id
          and observation.provider_repository_id = run.provider_repository_id
          and observation.collection_run_id = run.id
          and current_decision.status is distinct from 'rejected'
      )
      and not exists (
        select 1 from public.github_official_compliance_results prior_result
        where prior_result.organisation_id = run.organisation_id
          and prior_result.collection_run_id = run.id
      )
  );
$$;

alter function public.github_materialisation_job_is_fully_rejected(uuid, uuid)
  owner to postgres;
revoke all on function public.github_materialisation_job_is_fully_rejected(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Entry decisions and pack selections are written by RPCs that already hold
-- the review lock. Acquire the remaining locks in the same order as the
-- materialiser (review -> approval -> materialisation), before touching jobs.
create function public.lock_github_entry_materialisation_wake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-mapping-approval:' || new.organisation_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-materialisation-approval:' || new.organisation_id::text, 0)
  );
  return new;
end;
$$;

alter function public.lock_github_entry_materialisation_wake() owner to postgres;
revoke all on function public.lock_github_entry_materialisation_wake()
  from public, anon, authenticated, service_role;

create trigger github_mapping_entry_decisions_lock_materialisation
before insert on public.github_mapping_entry_decisions
for each row execute function public.lock_github_entry_materialisation_wake();

create trigger github_mapping_pack_selections_lock_materialisation
before insert or update on public.github_mapping_pack_selections
for each row execute function public.lock_github_entry_materialisation_wake();

create function public.wake_github_materialisation_jobs_for_organisation(
  target_organisation_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.github_materialisation_jobs job
  set status = 'completed',
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where job.organisation_id = target_organisation_id
    and job.status in ('pending', 'awaiting_approval')
    and job.lease_token is null
    and public.github_materialisation_job_is_fully_rejected(
      job.organisation_id, job.collection_run_id
    );

  -- A completed job can enter a new processing cycle when a new exact
  -- approval arrives. `attempt_count` is the bounded budget for that cycle,
  -- not a lifetime audit total; awaiting/rejected and unrelated events do not
  -- reset it.
  update public.github_materialisation_jobs job
  set status = 'pending',
      available_at = pg_catalog.now(),
      completed_at = null,
      attempt_count = case when job.status = 'completed' then 0 else job.attempt_count end,
      updated_at = pg_catalog.now()
  where job.organisation_id = target_organisation_id
    and job.status in ('awaiting_approval', 'completed')
    and public.github_materialisation_job_has_current_approval(
      job.organisation_id, job.collection_run_id
    );
$$;

alter function public.wake_github_materialisation_jobs_for_organisation(uuid) owner to postgres;
revoke all on function public.wake_github_materialisation_jobs_for_organisation(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.wake_github_materialisation_jobs_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.wake_github_materialisation_jobs_for_organisation(new.organisation_id);
  return new;
end;
$$;

alter function public.wake_github_materialisation_jobs_on_approval() owner to postgres;
revoke all on function public.wake_github_materialisation_jobs_on_approval()
  from public, anon, authenticated, service_role;

create trigger github_mapping_entry_decisions_wake_materialisation
after insert on public.github_mapping_entry_decisions
for each row execute function public.wake_github_materialisation_jobs_on_approval();

create trigger github_mapping_pack_selections_wake_materialisation
after insert or update of mapping_pack_id on public.github_mapping_pack_selections
for each row execute function public.wake_github_materialisation_jobs_on_approval();

-- Finalisation is a second line of defence for approvals racing an in-flight
-- materialisation. The same advisory lock serialises this check with decision,
-- selection, and legacy-approval wakeups; lease-token/attempt CAS stays intact.
create or replace function public.finalize_github_materialisation_job_server(
  target_job_id uuid,
  target_lease_token uuid,
  target_attempt_count integer,
  target_outcome text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organisation_id uuid;
  job_row public.github_materialisation_jobs;
  current_approval_pending boolean := false;
  all_entries_rejected boolean := false;
  effective_attempt_count integer;
begin
  if target_job_id is null or target_lease_token is null
     or target_attempt_count is null or target_attempt_count < 0
     or target_outcome not in ('completed', 'awaiting_approval', 'retryable') then
    return false;
  end if;

  select job.organisation_id into target_organisation_id
  from public.github_materialisation_jobs job
  where job.id = target_job_id;
  if not found then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-materialisation-approval:' || target_organisation_id::text, 0)
  );

  select job.* into job_row
  from public.github_materialisation_jobs job
  where job.id = target_job_id
    and job.organisation_id = target_organisation_id
    and job.lease_token = target_lease_token
    and job.attempt_count = target_attempt_count
    and job.status not in ('completed', 'exhausted')
  for update;
  if not found then return false; end if;

  effective_attempt_count := least(
    job_row.attempt_count + case when job_row.lease_attempt_incremented then 0 else 1 end,
    25
  );

  if target_outcome = 'awaiting_approval' then
    current_approval_pending := public.github_materialisation_job_has_current_approval(
      job_row.organisation_id, job_row.collection_run_id
    );
    all_entries_rejected := public.github_materialisation_job_is_fully_rejected(
      job_row.organisation_id, job_row.collection_run_id
    );

    update public.github_materialisation_jobs job
    set status = case
          when current_approval_pending then 'pending'
          when all_entries_rejected then 'completed'
          else 'awaiting_approval'
        end,
        attempt_count = case
          when job_row.lease_attempt_incremented then greatest(job.attempt_count - 1, 0)
          else job.attempt_count
        end,
        available_at = case
          when current_approval_pending then pg_catalog.now()
          when all_entries_rejected then job.available_at
          else 'infinity'::timestamptz
        end,
        lease_token = null,
        lease_expires_at = null,
        lease_attempt_incremented = null,
        completed_at = case when all_entries_rejected then pg_catalog.now() else null end,
        updated_at = pg_catalog.now()
    where job.id = job_row.id;
  elsif target_outcome = 'retryable' and effective_attempt_count >= 25 then
    update public.github_materialisation_jobs job
    set status = 'exhausted',
        attempt_count = effective_attempt_count,
        lease_token = null,
        lease_expires_at = null,
        lease_attempt_incremented = null,
        exhausted_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where job.id = job_row.id;
  elsif target_outcome = 'retryable' then
    update public.github_materialisation_jobs job
    set status = 'retryable',
        attempt_count = effective_attempt_count,
        available_at = pg_catalog.now() + pg_catalog.make_interval(
          secs => least(
            3600::double precision,
            pg_catalog.power(2::double precision, least(effective_attempt_count, 12)::double precision)
          )
        ),
        lease_token = null,
        lease_expires_at = null,
        lease_attempt_incremented = null,
        updated_at = pg_catalog.now()
    where job.id = job_row.id;
  else
    current_approval_pending := public.github_materialisation_job_has_current_approval(
      job_row.organisation_id, job_row.collection_run_id
    );

    update public.github_materialisation_jobs job
    set status = case when current_approval_pending then 'pending' else 'completed' end,
        attempt_count = case
          when current_approval_pending then 0
          else effective_attempt_count
        end,
        available_at = case when current_approval_pending then pg_catalog.now() else job.available_at end,
        lease_token = null,
        lease_expires_at = null,
        lease_attempt_incremented = null,
        completed_at = case when current_approval_pending then null else pg_catalog.now() end,
        updated_at = pg_catalog.now()
    where job.id = job_row.id;
  end if;
  return true;
end;
$$;

alter function public.finalize_github_materialisation_job_server(uuid, uuid, integer, text)
  owner to postgres;
revoke all on function public.finalize_github_materialisation_job_server(uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_github_materialisation_job_server(uuid, uuid, integer, text)
  to service_role;
