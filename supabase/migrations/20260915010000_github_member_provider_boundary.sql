drop policy if exists github_installations_members_select
on public.github_installations;
create policy github_installations_operators_select
on public.github_installations for select to authenticated
using ((select public.is_organisation_operator(organisation_id)));

drop policy if exists github_repositories_members_select
on public.github_repositories;
create policy github_repositories_operators_select
on public.github_repositories for select to authenticated
using ((select public.is_organisation_operator(organisation_id)));

drop policy if exists github_collection_runs_members_select
on public.github_collection_runs;
create policy github_collection_runs_operators_select
on public.github_collection_runs for select to authenticated
using ((select public.is_organisation_operator(organisation_id)));

drop policy if exists github_observations_members_select
on public.github_observations;
create policy github_observations_operators_select
on public.github_observations for select to authenticated
using ((select public.is_organisation_operator(organisation_id)));

drop policy if exists github_materialisation_jobs_members_read
on public.github_materialisation_jobs;
create policy github_materialisation_jobs_operators_select
on public.github_materialisation_jobs for select to authenticated
using ((select public.is_organisation_operator(organisation_id)));

create view public.github_official_repository_sources
with (security_barrier = true)
as
select
  repository.id,
  repository.organisation_id,
  repository.full_name,
  repository.html_url
from public.github_repositories repository
where public.is_organisation_member(repository.organisation_id)
  and exists (
    select 1
    from public.github_official_compliance_results result
    where result.organisation_id = repository.organisation_id
      and result.repository_id = repository.id
  );

alter view public.github_official_repository_sources owner to postgres;
revoke all on public.github_official_repository_sources
from public, anon, authenticated, service_role;
grant select on public.github_official_repository_sources to authenticated;

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

  if not public.is_organisation_operator(target_organisation_id) then
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
    join public.github_collection_runs run
      on run.id = job.collection_run_id
     and run.organisation_id = job.organisation_id
     and run.repository_id = job.repository_id
     and run.run_mode = 'official'
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
          and run.run_mode = 'official'
          and run.status <> 'running'
        order by run.completed_at desc, run.id desc
        limit 1
      ) collection on true
      left join lateral (
        select materialisation.id, materialisation.collection_run_id,
               materialisation.status, materialisation.attempt_count,
               materialisation.available_at, materialisation.exhausted_at
        from public.github_materialisation_jobs materialisation
        join public.github_collection_runs materialisation_run
          on materialisation_run.id = materialisation.collection_run_id
         and materialisation_run.organisation_id = materialisation.organisation_id
         and materialisation_run.repository_id = materialisation.repository_id
         and materialisation_run.run_mode = 'official'
        where collection.id is not null
          and materialisation.organisation_id = target_organisation_id
          and materialisation.repository_id = repository.id
          and materialisation.collection_run_id = collection.id
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
          join public.github_collection_runs result_run
            on result_run.id = result.collection_run_id
           and result_run.organisation_id = result.organisation_id
           and result_run.repository_id = result.repository_id
           and result_run.run_mode = 'official'
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
