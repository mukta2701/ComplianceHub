-- The v1 bundle is deliberately left untouched for rolling deploys.  This
-- successor evaluates the legacy bundle and the verified GitHub projection in
-- one statement, so all facts share the statement snapshot.
create function public.get_mcp_prior_delivered_digest_baseline(
  target_organisation_id uuid,
  target_local_date date
)
returns table(local_date date, delivered_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select delivery.digest_on as local_date, delivery.delivered_at
  from public.daily_digest_deliveries as delivery
  where target_organisation_id is not null
    and target_local_date is not null
    and delivery.organisation_id = target_organisation_id
    and delivery.digest_on < target_local_date
    and delivery.status = 'delivered'
    and delivery.delivered_at is not null
    and delivery.delivered_at < pg_catalog.now()
    and exists (
      select 1
      from public.memberships as membership
      where membership.organisation_id = target_organisation_id
        and membership.user_id = (select auth.uid())
    )
  order by delivery.digest_on desc, delivery.delivered_at desc, delivery.id desc
  limit 1;
$$;

alter function public.get_mcp_prior_delivered_digest_baseline(uuid,date) owner to postgres;
revoke all on function public.get_mcp_prior_delivered_digest_baseline(uuid,date)
from public, anon, authenticated, service_role;
grant execute on function public.get_mcp_prior_delivered_digest_baseline(uuid,date)
to authenticated;

create function public.get_mcp_compliance_bundle_v2(
  target_organisation_id uuid,
  target_local_date date,
  attention_limit integer default 20,
  monitoring_limit integer default 20,
  github_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with
parameters as materialized (
  select pg_catalog.now() as as_of,
         greatest(1, least(coalesce(github_limit, 20), 20)) as github_limit
  where target_organisation_id is not null and target_local_date is not null
),
base_bundle as materialized (
  select public.get_mcp_compliance_bundle(
    target_organisation_id, target_local_date, attention_limit, monitoring_limit
  ) as value
  from parameters
),
caller as materialized (
  select membership.role::text as role
  from public.memberships as membership
  cross join base_bundle
  where base_bundle.value is not null
    and membership.organisation_id = target_organisation_id
    and membership.user_id = (select auth.uid())
),
active_approval as materialized (
  select approval.id as approval_id,
         pack.id as mapping_pack_id,
         pack.version as mapping_version,
         pack.checksum as mapping_checksum
  from public.github_mapping_approvals as approval
  join public.github_mapping_packs as pack
    on pack.id = approval.mapping_pack_id
   and pack.published_at is not null
   and pack.checksum is not null
  cross join caller
  where approval.organisation_id = target_organisation_id
    and approval.revoked_at is null
),
latest_official as materialized (
  select result.*,
         row_number() over (partition by result.provider_repository_id, result.check_id
                            order by result.observed_at desc, result.id desc) as result_rank
  from public.github_official_compliance_results as result
  cross join caller
  where result.organisation_id = target_organisation_id
),
classified as materialized (
  select result.*,
         parameters.as_of,
         case when result.fresh_until > parameters.as_of then 'current' else 'stale' end as freshness,
         case when active.approval_id is not null then 'active' else 'historical' end as mapping_status,
         pg_catalog.jsonb_build_object(
           'id', 'github_result:' || result.id::text,
           'repositoryId', result.repository_id,
           'repositoryLabel', 'GitHub repository ' || pg_catalog.left(result.repository_id::text, 8),
           'checkId', result.check_id,
           'result', result.outcome,
           'severity', result.failure_severity,
           'summary', result.catalogue_summary,
           'observedAt', result.observed_at,
           'freshUntil', result.fresh_until,
           'materialisedAt', result.materialised_at
         ) as result_json
  from latest_official as result
  cross join parameters
  left join active_approval as active
    on active.mapping_pack_id = result.mapping_pack_id
   and active.mapping_version = result.mapping_version
   and active.mapping_checksum = result.mapping_checksum
  where result.result_rank = 1
    and result.materialised_at <= parameters.as_of
),
baseline as materialized (
  select prior.local_date, prior.delivered_at
  from public.get_mcp_prior_delivered_digest_baseline(
    target_organisation_id, target_local_date
  ) as prior
  cross join parameters
  where prior.delivered_at < parameters.as_of
),
official_event_ledger as materialized (
  select result.*,
         pg_catalog.jsonb_build_object(
           'id', 'github_result:' || result.id::text,
           'repositoryId', result.repository_id,
           'repositoryLabel', 'GitHub repository ' || pg_catalog.left(result.repository_id::text, 8),
           'checkId', result.check_id,
           'result', result.outcome,
           'severity', result.failure_severity,
           'summary', result.catalogue_summary,
           'observedAt', result.observed_at,
           'freshUntil', result.fresh_until,
           'materialisedAt', result.materialised_at
         ) as result_json
  from public.github_official_compliance_results as result
  join active_approval as active
    on active.mapping_pack_id = result.mapping_pack_id
   and active.mapping_version = result.mapping_version
   and active.mapping_checksum = result.mapping_checksum
  cross join caller
  cross join parameters
  cross join baseline
  where result.organisation_id = target_organisation_id
    and result.materialised_at > baseline.delivered_at
    and result.materialised_at <= parameters.as_of
),
partition_counts as (
  select count(*) filter (where mapping_status = 'active' and freshness = 'current' and outcome = 'pass')::integer as active_current_pass,
         count(*) filter (where mapping_status = 'active' and freshness = 'current' and outcome = 'fail')::integer as active_current_fail,
         count(*) filter (where mapping_status = 'active' and freshness = 'current' and outcome = 'unknown')::integer as active_current_unknown,
         count(*) filter (where mapping_status = 'active' and freshness = 'current' and outcome = 'not_applicable')::integer as active_current_not_applicable,
         count(*) filter (where mapping_status = 'active' and freshness = 'stale')::integer as active_stale,
         count(*) filter (where mapping_status = 'historical')::integer as historical,
         count(*)::integer as total
  from classified
),
transition_change_candidates as materialized (
  select result.id as result_id,
         case transition.reason
           when 'failed_observation_created' then 'new_failure'
           when 'failed_observation_reopened' then 'reopen'
           when 'fresh_pass_resolved' then 'resolution'
         end as kind,
         transition.occurred_at,
         result.materialised_at,
         result.result_json,
         transition.id as lineage_id
  from official_event_ledger as result
  join public.github_finding_transitions as transition
    on transition.organisation_id = result.organisation_id
   and transition.observation_id = result.observation_id
   and transition.approval_id = result.approval_id
   and transition.mapping_pack_id = result.mapping_pack_id
   and transition.mapping_version = result.mapping_version
  where transition.reason in (
      'failed_observation_created', 'failed_observation_reopened', 'fresh_pass_resolved'
    )
    and (
      (transition.reason in ('failed_observation_created', 'failed_observation_reopened') and result.outcome = 'fail')
      or (transition.reason = 'fresh_pass_resolved' and result.outcome = 'pass')
    )
),
evidence_change_candidates as materialized (
  select result.id as result_id,
         'superseding_pass'::text as kind,
         result.observed_at as occurred_at,
         result.materialised_at,
         result.result_json,
         provenance.id as lineage_id
  from official_event_ledger as result
  join public.github_evidence_provenance as provenance
    on provenance.organisation_id = result.organisation_id
   and provenance.observation_id = result.observation_id
   and provenance.approval_id = result.approval_id
   and provenance.mapping_pack_id = result.mapping_pack_id
   and provenance.supersedes_evidence_id is not null
  where result.outcome = 'pass'
),
change_candidates as materialized (
  select * from transition_change_candidates
  union all
  select * from evidence_change_candidates
),
changes as materialized (
  select result_id, kind, occurred_at, materialised_at, result_json
  from (
    select candidate.*,
           row_number() over (partition by candidate.result_id, candidate.kind
                              order by candidate.occurred_at desc, candidate.lineage_id desc) as kind_rank
    from change_candidates as candidate
  ) as ranked
  where ranked.kind_rank = 1
),
change_counts as (
  select count(*) filter (where kind = 'new_failure')::integer as new_failure,
         count(*) filter (where kind = 'reopen')::integer as reopen,
         count(*) filter (where kind = 'resolution')::integer as resolution,
         count(*) filter (where kind = 'superseding_pass')::integer as superseding_pass,
         count(*)::integer as total
  from changes
),
change_page as (
  select change.*
  from changes as change
  cross join parameters
  order by change.materialised_at desc,
           case change.kind when 'resolution' then 1 when 'superseding_pass' then 2 when 'reopen' then 3 else 4 end,
           ('github_change:' || change.kind || ':' || change.result_id::text) desc
  limit (select github_limit from parameters)
),
change_json as (
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(
    change.result_json || pg_catalog.jsonb_build_object(
      'id', 'github_change:' || change.kind || ':' || change.result_id::text,
      'resultId', 'github_result:' || change.result_id::text,
      'kind', change.kind,
      'occurredAt', change.occurred_at
    )
    order by change.materialised_at desc,
             case change.kind when 'resolution' then 1 when 'superseding_pass' then 2 when 'reopen' then 3 else 4 end,
             ('github_change:' || change.kind || ':' || change.result_id::text) desc
  ), '[]'::jsonb) as items
  from change_page as change
),
unknown_rows as materialized (
  select result.*
  from classified as result
  where result.mapping_status = 'active'
    and result.freshness = 'current'
    and result.outcome = 'unknown'
),
unknown_page as (
  select result.*
  from unknown_rows as result
  order by result.observed_at desc, result.id desc
  limit (select github_limit from parameters)
),
unknown_json as (
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(result.result_json order by result.observed_at desc, result.id desc), '[]'::jsonb) as items
  from unknown_page as result
),
stale_rows as materialized (
  select result.*
  from classified as result
  where result.mapping_status = 'active' and result.freshness = 'stale'
),
stale_page as (
  select result.*
  from stale_rows as result
  order by result.observed_at desc, result.id desc
  limit (select github_limit from parameters)
),
stale_json as (
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(result.result_json order by result.observed_at desc, result.id desc), '[]'::jsonb) as items
  from stale_page as result
),
action_rows as materialized (
  select result.*
  from classified as result
  where result.mapping_status = 'active'
    and result.freshness = 'current'
    and result.outcome = 'fail'
),
action_page as (
  select result.*
  from action_rows as result
  order by case result.failure_severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc,
           result.observed_at desc, result.id desc
  limit (select github_limit from parameters)
),
action_json as (
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(
    result.result_json
    order by case result.failure_severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc,
             result.observed_at desc, result.id desc
  ), '[]'::jsonb) as items
  from action_page as result
),
current_delivery as (
  select pg_catalog.jsonb_build_object(
    'id', delivery.id,
    'status', delivery.status::text,
    'deliveredAt', delivery.delivered_at,
    'factHash', delivery.fact_hash
  ) as value
  from public.daily_digest_deliveries as delivery
  cross join caller
  where caller.role = 'owner'
    and delivery.organisation_id = target_organisation_id
    and delivery.digest_on = target_local_date
  limit 1
),
github_projection as (
  select pg_catalog.jsonb_build_object(
    'asOf', parameters.as_of,
    'partition', pg_catalog.jsonb_build_object(
      'activeCurrentPass', partition.active_current_pass,
      'activeCurrentFail', partition.active_current_fail,
      'activeCurrentUnknown', partition.active_current_unknown,
      'activeCurrentNotApplicable', partition.active_current_not_applicable,
      'activeStale', partition.active_stale,
      'historical', partition.historical,
      'total', partition.total
    ),
    'baseline', case when baseline.delivered_at is null then null else pg_catalog.jsonb_build_object(
      'deliveredAt', baseline.delivered_at, 'localDate', baseline.local_date
    ) end,
    'changes', pg_catalog.jsonb_build_object(
      'counts', pg_catalog.jsonb_build_object(
        'newFailure', change_counts.new_failure,
        'reopen', change_counts.reopen,
        'resolution', change_counts.resolution,
        'supersedingPass', change_counts.superseding_pass,
        'total', change_counts.total
      ),
      'items', change_json.items,
      'truncated', change_counts.total > parameters.github_limit
    ),
    'unknowns', pg_catalog.jsonb_build_object(
      'count', (select count(*)::integer from unknown_rows),
      'items', unknown_json.items,
      'truncated', (select count(*) from unknown_rows) > parameters.github_limit
    ),
    'staleResults', pg_catalog.jsonb_build_object(
      'count', (select count(*)::integer from stale_rows),
      'items', stale_json.items,
      'truncated', (select count(*) from stale_rows) > parameters.github_limit
    ),
    'recommendedActions', pg_catalog.jsonb_build_object(
      'count', (select count(*)::integer from action_rows),
      'items', action_json.items,
      'truncated', (select count(*) from action_rows) > parameters.github_limit
    )
  ) as value
  from parameters
  cross join partition_counts as partition
  cross join change_counts
  cross join change_json
  cross join unknown_json
  cross join stale_json
  cross join action_json
  left join baseline on true
)
select case when base_bundle.value is null then null else
  base_bundle.value
  || pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'github', github_projection.value,
    'delivery', current_delivery.value
  )
end
from base_bundle
cross join github_projection
left join current_delivery on true;
$$;

alter function public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer) owner to postgres;
revoke all on function public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)
to authenticated;
