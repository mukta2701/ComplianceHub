-- Close the remaining Phase 5A ownership, privacy, and query-plan gaps without
-- changing the collection or materialisation lifecycle.

create index github_materialisation_jobs_exhausted_attention_idx
on public.github_materialisation_jobs(organisation_id, exhausted_at, id)
where status = 'exhausted' and exhausted_at is not null;

create index github_repositories_control_room_selected_idx
on public.github_repositories(organisation_id, full_name collate "C", id)
where selected;

create or replace function public.retry_github_materialisation_job_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_job_id uuid,
  target_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.github_materialisation_jobs;
  changed_job_id uuid;
begin
  if target_organisation_id is null
    or target_actor_id is null
    or target_job_id is null
    or target_reason is null
    or target_reason not in (
      'configuration_corrected',
      'provider_recovered',
      'owner_reviewed'
    )
  then
    raise exception 'materialisation retry reason is invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
  ) then
    raise exception 'materialisation retry requires a current workspace Owner'
      using errcode = '42501';
  end if;

  select job.*
  into job_row
  from public.github_materialisation_jobs job
  where job.id = target_job_id
    and job.organisation_id = target_organisation_id
    and job.status = 'exhausted'
    and job.lease_token is null
    and job.lease_expires_at is null
    and job.lease_attempt_incremented is null
  for update;

  if not found then
    return false;
  end if;

  perform 1
  from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for update;

  if not found then
    raise exception 'materialisation retry requires a current workspace Owner'
      using errcode = '42501';
  end if;

  update public.github_materialisation_jobs job
  set status = 'pending',
      attempt_count = 0,
      available_at = pg_catalog.now(),
      lease_token = null,
      lease_expires_at = null,
      lease_attempt_incremented = null,
      completed_at = null,
      exhausted_at = null,
      updated_at = pg_catalog.now()
  where job.id = job_row.id
    and job.organisation_id = target_organisation_id
    and job.status = 'exhausted'
    and job.lease_token is null
    and job.lease_expires_at is null
    and job.lease_attempt_incremented is null
  returning job.id into changed_job_id;

  if changed_job_id is null then
    return false;
  end if;

  insert into public.audit_events(
    organisation_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    target_organisation_id,
    target_actor_id,
    'github.materialisation_retry',
    'github_materialisation_job',
    job_row.id::text,
    pg_catalog.jsonb_build_object(
      'reason_code', target_reason,
      'previous_attempt_count', job_row.attempt_count
    )
  );

  return true;
end;
$$;

alter function public.retry_github_materialisation_job_server(uuid,uuid,uuid,text) owner to postgres;
revoke all on function public.retry_github_materialisation_job_server(uuid,uuid,uuid,text)
from public, anon, authenticated, service_role;
grant execute on function public.retry_github_materialisation_job_server(uuid,uuid,uuid,text)
to service_role;

-- The exact authenticated membership row is locked strongly enough to block a
-- concurrent role update until repository selection and its audit trigger have
-- committed. Scheduled service-role collection paths remain unchanged.
create or replace function public.set_github_repository_selected(
  target_repository_id uuid,
  target_selected boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  actor_role public.membership_role;
  target_organisation_id uuid;
  target_installation_id uuid;
  repository_row public.github_repositories;
  selected_count integer;
begin
  if target_repository_id is null or target_selected is null then
    raise exception 'repository selection requires a workspace Owner' using errcode = '42501';
  end if;

  actor_id := (select auth.uid());

  select organisation_id, installation_id
  into target_organisation_id, target_installation_id
  from public.github_repositories
  where id = target_repository_id;

  if target_organisation_id is null or actor_id is null then
    raise exception 'repository selection requires a workspace Owner' using errcode = '42501';
  end if;

  select membership.role
  into actor_role
  from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = actor_id
  for update;

  if not found or actor_role <> 'owner' then
    raise exception 'repository selection requires a workspace Owner' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_installation_id::text, 0)
  );

  select * into repository_row
  from public.github_repositories
  where id = target_repository_id
    and organisation_id = target_organisation_id
    and installation_id = target_installation_id
  for update;

  if not found then
    raise exception 'repository selection requires a workspace Owner' using errcode = '42501';
  end if;

  if not repository_row.available and target_selected then
    raise exception 'an unavailable GitHub repository cannot be selected'
      using errcode = '23514';
  end if;

  if not repository_row.selected and target_selected then
    select pg_catalog.count(*) into selected_count
    from public.github_repositories repository
    where repository.installation_id = target_installation_id
      and repository.organisation_id = target_organisation_id
      and repository.selected;

    if selected_count >= 100 then
      raise exception 'a GitHub installation may select at most 100 repositories'
        using errcode = '23514';
    end if;
  end if;

  if repository_row.selected is distinct from target_selected then
    update public.github_repositories repository
    set selected = target_selected
    where repository.id = target_repository_id
      and repository.organisation_id = target_organisation_id;
  end if;

  return true;
end;
$$;

alter function public.set_github_repository_selected(uuid,boolean) owner to postgres;
revoke all on function public.set_github_repository_selected(uuid,boolean)
from public, anon, authenticated, service_role;
grant execute on function public.set_github_repository_selected(uuid,boolean)
to authenticated;
