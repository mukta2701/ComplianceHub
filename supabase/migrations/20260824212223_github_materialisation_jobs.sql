-- Durable, tenant-safe handoff from terminal GitHub collection to the reviewed
-- materialiser. Collection completion remains independent: this queue records
-- the exact terminal run transactionally and recovery claims old work fairly.

create table public.github_materialisation_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  repository_id uuid not null,
  provider_repository_id bigint not null check (provider_repository_id > 0),
  collection_run_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'awaiting_approval', 'retryable', 'completed', 'exhausted')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 25),
  available_at timestamptz not null default pg_catalog.now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  exhausted_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint github_materialisation_jobs_collection_run_key unique (collection_run_id),
  constraint github_materialisation_jobs_id_organisation_key unique (id, organisation_id),
  constraint github_materialisation_jobs_run_ancestry_fk
    foreign key (collection_run_id, organisation_id, installation_id, repository_id, provider_repository_id)
    references public.github_collection_runs(id, organisation_id, installation_id, repository_id, provider_repository_id)
    on delete cascade,
  constraint github_materialisation_jobs_lease_check check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  ),
  constraint github_materialisation_jobs_completion_check check (
    (status = 'completed' and completed_at is not null and exhausted_at is null and lease_token is null)
    or (status = 'exhausted' and completed_at is null and exhausted_at is not null and lease_token is null)
    or (status not in ('completed', 'exhausted') and completed_at is null and exhausted_at is null)
  )
);

create index github_materialisation_jobs_claim_idx
on public.github_materialisation_jobs(status, available_at, created_at, organisation_id, id)
where status in ('pending', 'retryable');

create index github_materialisation_jobs_organisation_idx
on public.github_materialisation_jobs(organisation_id, created_at, id);

create index github_materialisation_jobs_exhausted_idx
on public.github_materialisation_jobs(created_at, organisation_id, id)
where status = 'exhausted';

create or replace function public.enqueue_github_materialisation_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('succeeded', 'partial')
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
revoke all on function public.enqueue_github_materialisation_job() from public, anon, authenticated, service_role;

create trigger github_collection_runs_enqueue_materialisation
after insert or update of status on public.github_collection_runs
for each row execute function public.enqueue_github_materialisation_job();

insert into public.github_materialisation_jobs(
  organisation_id, installation_id, repository_id,
  provider_repository_id, collection_run_id, created_at, updated_at
)
select run.organisation_id, run.installation_id, run.repository_id,
       run.provider_repository_id, run.id,
       pg_catalog.coalesce(run.completed_at, pg_catalog.now()), pg_catalog.now()
from public.github_collection_runs run
where run.status in ('succeeded', 'partial')
on conflict (collection_run_id) do nothing;

-- Approval insertion and awaiting finalisation serialize per organisation.
-- Both paths acquire this advisory lock before a job-row lock, preventing the
-- approval wake trigger and finaliser from taking the same locks in reverse.
create or replace function public.lock_github_materialisation_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-materialisation-approval:' || new.organisation_id::text, 0)
  );
  return new;
end;
$$;

alter function public.lock_github_materialisation_approval() owner to postgres;
revoke all on function public.lock_github_materialisation_approval() from public, anon, authenticated, service_role;

create trigger github_mapping_approvals_lock_materialisation
before insert on public.github_mapping_approvals
for each row execute function public.lock_github_materialisation_approval();

create or replace function public.wake_github_materialisation_jobs_on_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.github_materialisation_jobs job
  set status = 'pending',
      available_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where job.organisation_id = new.organisation_id
    and job.status = 'awaiting_approval'
    and new.revoked_at is null;
  return new;
end;
$$;

alter function public.wake_github_materialisation_jobs_on_approval() owner to postgres;
revoke all on function public.wake_github_materialisation_jobs_on_approval() from public, anon, authenticated, service_role;

create trigger github_mapping_approvals_wake_materialisation
after insert on public.github_mapping_approvals
for each row execute function public.wake_github_materialisation_jobs_on_approval();

create or replace function public.claim_github_materialisation_jobs_server(
  target_limit integer,
  target_collection_run_ids uuid[] default null
)
returns table (
  job_id uuid,
  lease_token uuid,
  attempt_count integer,
  collection_run_id uuid,
  organisation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'materialisation claim limit must be between 1 and 100'
      using errcode = '22023';
  end if;
  if target_collection_run_ids is not null and (
    pg_catalog.cardinality(target_collection_run_ids) < 1
    or pg_catalog.cardinality(target_collection_run_ids) > 100
    or pg_catalog.array_position(target_collection_run_ids, null) is not null
    or exists (
      select 1 from pg_catalog.unnest(target_collection_run_ids) value
      group by value having pg_catalog.count(*) > 1
    )
  ) then
    raise exception 'materialisation run targets are invalid'
      using errcode = '22023';
  end if;

  with candidates as (
    select job.id
    from public.github_materialisation_jobs job
    where job.status in ('pending', 'retryable')
      and job.attempt_count >= 25
      and (job.lease_token is null or job.lease_expires_at <= pg_catalog.now())
      and (target_collection_run_ids is null or job.collection_run_id = any(target_collection_run_ids))
    order by job.created_at, job.organisation_id, job.id
    limit target_limit
    for update skip locked
  )
  update public.github_materialisation_jobs job
  set status = 'exhausted',
      lease_token = null,
      lease_expires_at = null,
      exhausted_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  from candidates
  where job.id = candidates.id;

  return query
  with ranked as materialized (
    select job.id,
           pg_catalog.row_number() over (
             partition by job.organisation_id
             order by job.created_at, job.id
           ) as tenant_position,
           job.created_at,
           job.organisation_id
    from public.github_materialisation_jobs job
    where (
        (target_collection_run_ids is null
          and job.status in ('pending', 'retryable')
          and job.available_at <= pg_catalog.now())
        or (target_collection_run_ids is not null
          and job.status in ('pending', 'retryable', 'awaiting_approval'))
      )
      and (job.status = 'awaiting_approval' or job.attempt_count < 25)
      and (job.lease_token is null or job.lease_expires_at <= pg_catalog.now())
      and (target_collection_run_ids is null or job.collection_run_id = any(target_collection_run_ids))
  ), candidates as (
    select job.id
    from public.github_materialisation_jobs job
    join ranked on ranked.id = job.id
    order by ranked.tenant_position, ranked.created_at, ranked.organisation_id, job.id
    limit target_limit
    for update of job skip locked
  ), claimed as (
    update public.github_materialisation_jobs job
    set lease_token = extensions.gen_random_uuid(),
        lease_expires_at = pg_catalog.now() + interval '5 minutes',
        attempt_count = case
          when job.status = 'awaiting_approval' then pg_catalog.greatest(job.attempt_count, 1)
          else job.attempt_count + 1
        end,
        updated_at = pg_catalog.now()
    from candidates
    where job.id = candidates.id
    returning job.id, job.lease_token, job.attempt_count,
              job.collection_run_id, job.organisation_id
  )
  select claimed.id, claimed.lease_token, claimed.attempt_count,
         claimed.collection_run_id, claimed.organisation_id
  from claimed
  order by claimed.id;
end;
$$;

alter function public.claim_github_materialisation_jobs_server(integer, uuid[]) owner to postgres;
revoke all on function public.claim_github_materialisation_jobs_server(integer, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.claim_github_materialisation_jobs_server(integer, uuid[]) to service_role;

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
begin
  if target_job_id is null or target_lease_token is null
     or target_attempt_count is null or target_attempt_count < 1
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
        attempt_count = pg_catalog.greatest(job.attempt_count - 1, 0),
        available_at = case when active_approval_exists then pg_catalog.now() else 'infinity'::timestamptz end,
        lease_token = null,
        lease_expires_at = null,
        updated_at = pg_catalog.now()
    where job.id = job_row.id;
  elsif target_outcome = 'retryable' and job_row.attempt_count >= 25 then
    update public.github_materialisation_jobs job
    set status = 'exhausted',
        lease_token = null,
        lease_expires_at = null,
        exhausted_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where job.id = job_row.id;
  elsif target_outcome = 'retryable' then
    update public.github_materialisation_jobs job
    set status = 'retryable',
        available_at = pg_catalog.now() + pg_catalog.make_interval(
          secs => pg_catalog.least(
            3600::double precision,
            pg_catalog.power(2::double precision, pg_catalog.least(job.attempt_count, 12)::double precision)
          )
        ),
        lease_token = null,
        lease_expires_at = null,
        updated_at = pg_catalog.now()
    where job.id = job_row.id;
  else
    update public.github_materialisation_jobs job
    set status = 'completed',
        lease_token = null,
        lease_expires_at = null,
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

create or replace function public.inspect_github_materialisation_jobs_server(
  target_limit integer,
  target_collection_run_ids uuid[] default null
)
returns table (
  collection_run_id uuid,
  status text,
  lease_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'materialisation inspection limit must be between 1 and 100'
      using errcode = '22023';
  end if;
  if target_collection_run_ids is not null and (
    pg_catalog.cardinality(target_collection_run_ids) < 1
    or pg_catalog.cardinality(target_collection_run_ids) > 100
    or pg_catalog.array_position(target_collection_run_ids, null) is not null
    or exists (
      select 1 from pg_catalog.unnest(target_collection_run_ids) value
      group by value having pg_catalog.count(*) > 1
    )
  ) then
    raise exception 'materialisation inspection targets are invalid'
      using errcode = '22023';
  end if;

  with candidates as (
    select job.id
    from public.github_materialisation_jobs job
    where job.status in ('pending', 'retryable')
      and job.attempt_count >= 25
      and (job.lease_token is null or job.lease_expires_at <= pg_catalog.now())
      and (target_collection_run_ids is null or job.collection_run_id = any(target_collection_run_ids))
    order by job.created_at, job.organisation_id, job.id
    limit target_limit
    for update skip locked
  )
  update public.github_materialisation_jobs job
  set status = 'exhausted',
      lease_token = null,
      lease_expires_at = null,
      exhausted_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  from candidates
  where job.id = candidates.id;

  if target_collection_run_ids is not null then
    return query
    select job.collection_run_id, job.status,
           job.lease_token is not null and job.lease_expires_at > pg_catalog.now()
    from public.github_materialisation_jobs job
    where job.collection_run_id = any(target_collection_run_ids)
    order by job.collection_run_id
    limit target_limit;
  else
    return query
    with ranked as materialized (
      select job.collection_run_id, job.status, job.organisation_id, job.created_at,
             pg_catalog.row_number() over (
               partition by job.organisation_id order by job.created_at, job.id
             ) as tenant_position
      from public.github_materialisation_jobs job
      where job.status = 'exhausted'
    )
    select ranked.collection_run_id, ranked.status, false
    from ranked
    order by ranked.tenant_position, ranked.created_at, ranked.organisation_id, ranked.collection_run_id
    limit target_limit;
  end if;
end;
$$;

alter function public.inspect_github_materialisation_jobs_server(integer, uuid[]) owner to postgres;
revoke all on function public.inspect_github_materialisation_jobs_server(integer, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.inspect_github_materialisation_jobs_server(integer, uuid[]) to service_role;

alter table public.github_materialisation_jobs enable row level security;

create policy github_materialisation_jobs_members_read
on public.github_materialisation_jobs for select to authenticated
using ((select public.is_organisation_member(organisation_id)));

revoke all on public.github_materialisation_jobs from public, anon, authenticated, service_role;
grant select on public.github_materialisation_jobs to authenticated, service_role;
