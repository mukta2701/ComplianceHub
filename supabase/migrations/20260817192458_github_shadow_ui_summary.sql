-- Keep the newest run and the most recent completed collection independent:
-- an in-progress recheck must not hide the timestamp used for freshness.
create or replace view public.github_repository_shadow_summaries
with (security_invoker = true)
as
select
  repository.id as repository_id,
  repository.organisation_id,
  repository.installation_id,
  repository.provider_repository_id,
  repository.owner_login,
  repository.name,
  repository.full_name,
  repository.html_url,
  repository.visibility,
  repository.default_branch,
  repository.archived,
  repository.selected,
  repository.available,
  repository.removed_at,
  repository.last_seen_at,
  latest_run.id as latest_run_id,
  latest_run.trigger_type as latest_trigger_type,
  latest_run.status as latest_status,
  latest_run.diagnostic_code as latest_diagnostic_code,
  latest_run.started_at as latest_started_at,
  latest_run.completed_at as latest_completed_at,
  latest_run.observation_count as latest_observation_count,
  latest_run.passed_count as latest_passed_count,
  latest_run.failed_count as latest_failed_count,
  latest_run.unknown_count as latest_unknown_count,
  latest_run.not_applicable_count as latest_not_applicable_count,
  completed_run.last_completed_collection_at
from public.github_repositories repository
left join lateral (
  select
    collection_run.id,
    collection_run.trigger_type,
    collection_run.status,
    collection_run.diagnostic_code,
    collection_run.started_at,
    collection_run.completed_at,
    collection_run.observation_count,
    collection_run.passed_count,
    collection_run.failed_count,
    collection_run.unknown_count,
    collection_run.not_applicable_count
  from public.github_collection_runs collection_run
  where collection_run.repository_id = repository.id
    and collection_run.organisation_id = repository.organisation_id
    and collection_run.installation_id = repository.installation_id
  order by collection_run.started_at desc, collection_run.id desc
  limit 1
) latest_run on true
left join lateral (
  select pg_catalog.max(collection_run.completed_at) as last_completed_collection_at
  from public.github_collection_runs collection_run
  where collection_run.repository_id = repository.id
    and collection_run.organisation_id = repository.organisation_id
    and collection_run.installation_id = repository.installation_id
    and collection_run.status in ('succeeded', 'partial')
) completed_run on true;

revoke all on public.github_repository_shadow_summaries
from public, anon, authenticated, service_role;
grant select on public.github_repository_shadow_summaries to authenticated;
grant select on public.github_repository_shadow_summaries to service_role;
