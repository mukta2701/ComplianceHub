-- Repair the already-installed finalisation function after the historical
-- migration was applied with schema-qualified least/greatest calls. Those
-- names resolve incorrectly on PostgreSQL, where the built-in
-- functions are exposed as plain least/greatest. This successor deliberately
-- redefines only the existing function; no rows are rewritten.

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
  active_approval_exists boolean := false;
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
    select exists (
      select 1
      from public.github_mapping_approvals approval
      join public.github_mapping_packs pack on pack.id = approval.mapping_pack_id
      where approval.organisation_id = job_row.organisation_id
        and approval.revoked_at is null
        and pack.published_at is not null
    ) into active_approval_exists;

    update public.github_materialisation_jobs job
    set status = case when active_approval_exists then 'pending' else 'awaiting_approval' end,
        attempt_count = case
          when job_row.lease_attempt_incremented then greatest(job.attempt_count - 1, 0)
          else job.attempt_count
        end,
        available_at = case when active_approval_exists then pg_catalog.now() else 'infinity'::timestamptz end,
        lease_token = null,
        lease_expires_at = null,
        lease_attempt_incremented = null,
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
    update public.github_materialisation_jobs job
    set status = 'completed',
        attempt_count = effective_attempt_count,
        lease_token = null,
        lease_expires_at = null,
        lease_attempt_incremented = null,
        completed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where job.id = job_row.id;
  end if;
  return true;
end;
$$;

alter function public.finalize_github_materialisation_job_server(uuid, uuid, integer, text) owner to postgres;
revoke all on function public.finalize_github_materialisation_job_server(uuid, uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.finalize_github_materialisation_job_server(uuid, uuid, integer, text) to service_role;
