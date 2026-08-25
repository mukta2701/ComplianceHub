-- Trustworthy operator seams for the GitHub compliance control room. This
-- migration does not alter collection or materialisation lifecycle semantics.

create index github_collection_runs_control_room_latest_idx
on public.github_collection_runs(organisation_id, repository_id, completed_at desc, id desc)
where status <> 'running';

create index github_materialisation_jobs_control_room_latest_idx
on public.github_materialisation_jobs(organisation_id, repository_id, created_at desc, id desc);

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
    or target_reason <> pg_catalog.btrim(target_reason)
    or pg_catalog.char_length(target_reason) not between 1 and 500
    or target_reason ~ '[<>[:cntrl:]]'
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
      'reason', target_reason,
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

-- Human repository selection is deliberately narrower than scheduled server
-- collection: only a current workspace Owner may change scope.
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
  target_organisation_id uuid;
  target_installation_id uuid;
  repository_row public.github_repositories;
  selected_count integer;
begin
  if target_repository_id is null or target_selected is null then
    raise exception 'repository selection requires a workspace Owner' using errcode = '42501';
  end if;

  select organisation_id, installation_id
  into target_organisation_id, target_installation_id
  from public.github_repositories
  where id = target_repository_id;

  if target_organisation_id is null
    or not public.is_organisation_owner(target_organisation_id)
  then
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

  if not found or not public.is_organisation_owner(target_organisation_id) then
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

create or replace function public.get_github_compliance_control_room_v1(
  target_organisation_id uuid,
  target_offset integer default 0,
  target_limit integer default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  response jsonb;
begin
  if target_organisation_id is null
    or target_offset is null or target_offset < 0 or target_offset > 10000
    or target_limit is null or target_limit < 1 or target_limit > 20
  then
    raise exception 'control-room pagination is invalid' using errcode = '22023';
  end if;

  if not public.is_organisation_member(target_organisation_id) then
    return null;
  end if;

  with parameters as materialized (
    select pg_catalog.statement_timestamp() as as_of
  ),
  active_approval as materialized (
    select approval.mapping_pack_id, pack.version, pack.checksum, approval.approved_at
    from public.github_mapping_approvals approval
    join public.github_mapping_packs pack
      on pack.id = approval.mapping_pack_id
     and pack.published_at is not null
    where approval.organisation_id = target_organisation_id
      and approval.revoked_at is null
    order by approval.approved_at desc, approval.id desc
    limit 1
  ),
  repository_total as materialized (
    select pg_catalog.count(*)::integer as total
    from public.github_repositories repository
    where repository.organisation_id = target_organisation_id
      and repository.selected
  ),
  repository_page as materialized (
    select repository.*
    from public.github_repositories repository
    where repository.organisation_id = target_organisation_id
      and repository.selected
    order by repository.full_name collate "C", repository.id
    offset target_offset
    limit target_limit
  ),
  exhausted_jobs as materialized (
    select job.id, job.repository_id, job.collection_run_id,
           job.attempt_count, job.exhausted_at,
           pg_catalog.count(*) over ()::integer as total
    from public.github_materialisation_jobs job
    where job.organisation_id = target_organisation_id
      and job.status = 'exhausted'
      and job.exhausted_at is not null
    order by job.exhausted_at, job.id
    limit 20
  )
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'workspaceId', target_organisation_id,
    'asOf', parameters.as_of,
    'approval', (
      select pg_catalog.jsonb_build_object(
        'mappingPackId', approval.mapping_pack_id,
        'version', approval.version,
        'checksum', approval.checksum,
        'approvedAt', approval.approved_at,
        'revoked', false
      )
      from active_approval approval
    ),
    'pagination', pg_catalog.jsonb_build_object(
      'offset', target_offset,
      'limit', target_limit,
      'total', repository_total.total,
      'truncated', target_offset + least(target_limit, greatest(repository_total.total - target_offset, 0)) < repository_total.total
    ),
    'repositories', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', repository.id,
        'name', repository.full_name,
        'url', repository.html_url,
        'visibility', repository.visibility,
        'defaultBranch', repository.default_branch,
        'archived', repository.archived,
        'available', repository.available,
        'latestCollection', case when collection.id is null then null else pg_catalog.jsonb_build_object(
          'id', collection.id,
          'status', collection.status,
          'completedAt', collection.completed_at
        ) end,
        'latestMaterialisationJob', case when job.id is null then null else pg_catalog.jsonb_build_object(
          'id', job.id,
          'collectionRunId', job.collection_run_id,
          'status', job.status,
          'attempts', job.attempt_count,
          'availableAt', case when pg_catalog.isfinite(job.available_at) then job.available_at else null end,
          'exhaustedAt', job.exhausted_at
        ) end,
        'officialResults', coalesce(results.items, '[]'::jsonb)
      ) order by repository.full_name collate "C", repository.id)
      from repository_page repository
      left join lateral (
        select run.id, run.status, run.completed_at
        from public.github_collection_runs run
        where run.organisation_id = target_organisation_id
          and run.repository_id = repository.id
          and run.status <> 'running'
        order by run.completed_at desc, run.id desc
        limit 1
      ) collection on true
      left join lateral (
        select materialisation.id, materialisation.collection_run_id,
               materialisation.status, materialisation.attempt_count,
               materialisation.available_at, materialisation.exhausted_at
        from public.github_materialisation_jobs materialisation
        where materialisation.organisation_id = target_organisation_id
          and materialisation.repository_id = repository.id
        order by materialisation.created_at desc, materialisation.id desc
        limit 1
      ) job on true
      left join lateral (
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', latest.id,
          'checkId', latest.check_id,
          'outcome', latest.outcome,
          'severity', latest.failure_severity,
          'summary', latest.catalogue_summary,
          'observedAt', latest.observed_at,
          'freshUntil', latest.fresh_until,
          'materialisedAt', latest.materialised_at,
          'ruleVersion', latest.rule_version,
          'mappingPackId', latest.mapping_pack_id,
          'mappingVersion', latest.mapping_version,
          'mappingChecksum', latest.mapping_checksum,
          'evidenceId', latest.evidence_id,
          'findingId', latest.finding_id
        ) order by latest.check_id collate "C", latest.id) as items
        from (
          select distinct on (result.check_id) result.*
          from public.github_official_compliance_results result
          where result.organisation_id = target_organisation_id
            and result.provider_repository_id = repository.provider_repository_id
          order by result.check_id, result.observed_at desc, result.id desc
          limit 20
        ) latest
      ) results on true
    ), '[]'::jsonb),
    'exhaustedAttention', pg_catalog.jsonb_build_object(
      'total', coalesce((select pg_catalog.max(exhausted.total) from exhausted_jobs exhausted), 0),
      'truncated', coalesce((select pg_catalog.max(exhausted.total) from exhausted_jobs exhausted), 0) > 20,
      'items', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'jobId', exhausted.id,
          'repositoryId', exhausted.repository_id,
          'collectionRunId', exhausted.collection_run_id,
          'attempts', exhausted.attempt_count,
          'exhaustedAt', exhausted.exhausted_at
        ) order by exhausted.exhausted_at, exhausted.id)
        from exhausted_jobs exhausted
      ), '[]'::jsonb)
    )
  ) into response
  from parameters
  cross join repository_total;

  return response;
end;
$$;

alter function public.get_github_compliance_control_room_v1(uuid,integer,integer) owner to postgres;
revoke all on function public.get_github_compliance_control_room_v1(uuid,integer,integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_github_compliance_control_room_v1(uuid,integer,integer)
to authenticated;
