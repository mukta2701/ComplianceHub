-- Keep the digest's snapshot aligned with the current statement and match
-- immutable lifecycle lineage by the exact legacy approval or entry receipt.
create or replace function public.get_mcp_compliance_bundle_v2(
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
  select pg_catalog.statement_timestamp() as as_of,
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
         case when public.github_official_result_mapping_status_at(
           result.organisation_id, result.id, parameters.as_of
         ) = 'active' then 'active' else 'historical' end as mapping_status,
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
  cross join caller
  cross join parameters
  cross join baseline
  where result.organisation_id = target_organisation_id
    and result.materialised_at > baseline.delivered_at
    and result.materialised_at <= parameters.as_of
    and public.github_official_result_mapping_status_at(
      result.organisation_id, result.id, parameters.as_of
    ) = 'active'
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
   and transition.approval_id is not distinct from result.approval_id
   and transition.entry_receipt_id is not distinct from result.entry_receipt_id
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
   and provenance.approval_id is not distinct from result.approval_id
   and provenance.entry_receipt_id is not distinct from result.entry_receipt_id
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
  select coalesce(pg_catalog.jsonb_agg(
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
  select coalesce(pg_catalog.jsonb_agg(result.result_json order by result.observed_at desc, result.id desc), '[]'::jsonb) as items
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
  select coalesce(pg_catalog.jsonb_agg(result.result_json order by result.observed_at desc, result.id desc), '[]'::jsonb) as items
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
  select coalesce(pg_catalog.jsonb_agg(
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
  from public, anon, service_role;
grant execute on function public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)
  to authenticated;

-- MCP v2 uses the same exact-result consent decision as the dashboard and
-- compatibility reader. Both cursor validation and page selection share the
-- frozen snapshot, so an entry receipt cannot be active on one page only.
create or replace function public.get_mcp_github_compliance_results_v2(
  target_organisation_id uuid,
  target_repository_id uuid default null,
  target_result public.github_observation_result default null,
  target_freshness text default null,
  target_mapping_status text default null,
  target_severity public.monitor_severity default null,
  target_limit integer default 20,
  target_cursor text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  request_now timestamptz := pg_catalog.statement_timestamp();
  snapshot_at timestamptz := request_now;
  issued_at timestamptz := request_now;
  expires_at timestamptz := request_now + interval '15 minutes';
  last_observed_at timestamptz;
  last_result_id uuid;
  caller_id uuid;
  caller_role text;
  caller_client_id text;
  caller_audience text;
  configured_audience text;
  cursor_keys bytea[];
  cursor_key bytea;
  cursor_payload_text text;
  cursor_payload jsonb;
  cursor_encoded text;
  cursor_mac bytea;
  expected_cursor_mac bytea;
  canonical_encoded text;
  expected_filters jsonb;
  cursor_version integer;
  cursor_user_id uuid;
  cursor_client_id text;
  cursor_audience text;
  cursor_organisation_id uuid;
  cursor_filters jsonb;
  results_value jsonb;
  has_more boolean;
  continuation_payload text;
  continuation_encoded text;
  next_cursor text;
  envelope_value jsonb;
begin
  caller_id := (select auth.uid());
  caller_role := (select auth.role());
  caller_client_id := (select auth.jwt() ->> 'client_id');
  caller_audience := (select auth.jwt() ->> 'aud');
  begin
    select config.audience into strict configured_audience
    from private.mcp_oauth_config as config
    where config.config_key = 'resource';
  exception when others then
    raise exception 'invalid GitHub MCP caller context' using errcode = '42501';
  end;
  if caller_id is null
    or caller_role is distinct from 'authenticated'
    or caller_client_id is null
    or caller_client_id !~ '^[A-Za-z0-9._~-]{1,200}$'
    or caller_audience is null
    or caller_audience is distinct from configured_audience
  then
    raise exception 'invalid GitHub MCP caller context' using errcode = '42501';
  end if;

  -- Membership is checked before cursor validation so cursor material never
  -- becomes an organisation-membership oracle.
  if target_organisation_id is null or not exists (
    select 1
    from public.memberships as membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = caller_id
  ) then
    return null;
  end if;

  if target_limit is null
    or target_limit not between 1 and 50
    or (target_freshness is not null and target_freshness not in ('current', 'stale'))
    or (target_mapping_status is not null and target_mapping_status not in ('active', 'historical'))
  then
    raise exception 'invalid GitHub compliance result filters' using errcode = '22023';
  end if;

  expected_filters := pg_catalog.jsonb_build_object(
    'repositoryId', target_repository_id,
    'result', target_result,
    'freshness', target_freshness,
    'mappingStatus', target_mapping_status,
    'severity', target_severity,
    'limit', target_limit
  );

  begin
    select pg_catalog.array_agg(key_row.key_bytes)
    into cursor_keys
    from mcp_cursor_private.mcp_github_results_cursor_key as key_row;
    if coalesce(pg_catalog.cardinality(cursor_keys),0) <> 1
      or pg_catalog.octet_length(cursor_keys[1]) <> 32
    then
      raise exception 'invalid cursor key';
    end if;
    cursor_key := cursor_keys[1];
  exception when others then
    raise exception 'GitHub compliance cursor security is unavailable' using errcode = '55000';
  end;

  if target_cursor is not null then
    if pg_catalog.char_length(target_cursor) not between 80 and 2048
      or target_cursor !~ '^ch3[.][A-Za-z0-9_-]+[.][0-9a-f]{64}$'
    then
      raise exception 'invalid GitHub compliance continuation cursor' using errcode = '22023';
    end if;

    cursor_encoded := pg_catalog.split_part(target_cursor, '.', 2);
    begin
      cursor_mac := pg_catalog.decode(pg_catalog.split_part(target_cursor,'.',3),'hex');
      expected_cursor_mac := extensions.hmac(
        pg_catalog.convert_to(cursor_encoded,'UTF8'),cursor_key,'sha256'
      );
    exception when others then
      raise exception 'invalid GitHub compliance continuation cursor' using errcode = '22023';
    end;
    if mcp_cursor_private.mcp_github_cursor_bytes_equal(cursor_mac,expected_cursor_mac) is not true then
      raise exception 'invalid GitHub compliance continuation cursor' using errcode = '22023';
    end if;

    begin
      cursor_payload_text := pg_catalog.convert_from(pg_catalog.decode(
        pg_catalog.translate(cursor_encoded, '-_', '+/')
          || pg_catalog.repeat('=', (4 - pg_catalog.char_length(cursor_encoded) % 4) % 4),
        'base64'
      ), 'UTF8');
      cursor_payload := cursor_payload_text::jsonb;
    exception when others then
      raise exception 'invalid GitHub compliance continuation cursor' using errcode = '22023';
    end;

    canonical_encoded := pg_catalog.rtrim(pg_catalog.translate(
      pg_catalog.replace(pg_catalog.replace(
        pg_catalog.encode(pg_catalog.convert_to(cursor_payload_text, 'UTF8'), 'base64'),
        E'\n', ''
      ), E'\r', ''),
      '+/', '-_'
    ), '=');

    if canonical_encoded <> cursor_encoded
      or cursor_payload_text <> cursor_payload::text
      or pg_catalog.jsonb_typeof(cursor_payload) <> 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(cursor_payload)) <> 11
      or not (cursor_payload ?& array[
        'v','userId','clientId','audience','organisationId','snapshotAt','filters',
        'lastObservedAt','lastResultId','issuedAt','expiresAt'
      ])
      or pg_catalog.jsonb_typeof(cursor_payload -> 'v') <> 'number'
      or pg_catalog.jsonb_typeof(cursor_payload -> 'userId') <> 'string'
      or pg_catalog.jsonb_typeof(cursor_payload -> 'clientId') <> 'string'
      or pg_catalog.jsonb_typeof(cursor_payload -> 'audience') <> 'string'
      or pg_catalog.jsonb_typeof(cursor_payload -> 'organisationId') <> 'string'
      or pg_catalog.jsonb_typeof(cursor_payload -> 'snapshotAt') <> 'string'
      or pg_catalog.jsonb_typeof(cursor_payload -> 'filters') <> 'object'
      or pg_catalog.jsonb_typeof(cursor_payload -> 'lastObservedAt') <> 'string'
      or pg_catalog.jsonb_typeof(cursor_payload -> 'lastResultId') <> 'string'
      or pg_catalog.jsonb_typeof(cursor_payload -> 'issuedAt') <> 'string'
      or pg_catalog.jsonb_typeof(cursor_payload -> 'expiresAt') <> 'string'
      or (cursor_payload ->> 'v') !~ '^[0-9]+$'
      or (cursor_payload ->> 'userId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (cursor_payload ->> 'organisationId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (cursor_payload ->> 'lastResultId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (cursor_payload ->> 'snapshotAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (cursor_payload ->> 'lastObservedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (cursor_payload ->> 'issuedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (cursor_payload ->> 'expiresAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    then
      raise exception 'invalid GitHub compliance continuation cursor' using errcode = '22023';
    end if;

    begin
      cursor_version := (cursor_payload ->> 'v')::integer;
      cursor_user_id := (cursor_payload ->> 'userId')::uuid;
      cursor_client_id := cursor_payload ->> 'clientId';
      cursor_audience := cursor_payload ->> 'audience';
      cursor_organisation_id := (cursor_payload ->> 'organisationId')::uuid;
      snapshot_at := (cursor_payload ->> 'snapshotAt')::timestamptz;
      cursor_filters := cursor_payload -> 'filters';
      last_observed_at := (cursor_payload ->> 'lastObservedAt')::timestamptz;
      last_result_id := (cursor_payload ->> 'lastResultId')::uuid;
      issued_at := (cursor_payload ->> 'issuedAt')::timestamptz;
      expires_at := (cursor_payload ->> 'expiresAt')::timestamptz;
    exception when others then
      raise exception 'invalid GitHub compliance continuation cursor' using errcode = '22023';
    end;

    if cursor_version <> 3
      or cursor_user_id <> caller_id
      or cursor_client_id is distinct from caller_client_id
      or cursor_audience is distinct from caller_audience
      or cursor_organisation_id <> target_organisation_id
      or cursor_filters is distinct from expected_filters
      or expires_at - issued_at <> interval '15 minutes'
      or snapshot_at <> issued_at
      or issued_at > request_now + interval '30 seconds'
      or request_now - issued_at > interval '15 minutes'
      or expires_at <= request_now
      or last_observed_at > snapshot_at
    then
      raise exception 'invalid GitHub compliance continuation cursor' using errcode = '22023';
    end if;

    if not exists (
      with eligible as materialized (
        select result.*, observation.fingerprint as source_response_fingerprint,
          run.id as eligible_run_id
        from public.github_official_compliance_results as result
        join public.github_observations as observation
          on observation.id = result.observation_id
         and observation.organisation_id = result.organisation_id
         and observation.installation_id = result.installation_id
         and observation.repository_id = result.repository_id
         and observation.provider_repository_id = result.provider_repository_id
         and observation.collection_run_id = result.collection_run_id
        join public.github_collection_runs as run
          on run.id = result.collection_run_id
         and run.organisation_id = result.organisation_id
         and run.installation_id = result.installation_id
         and run.repository_id = result.repository_id
         and run.provider_repository_id = result.provider_repository_id
         and run.run_mode = 'official'
         and run.status in ('succeeded', 'partial')
         and run.completed_at is not null
        where result.organisation_id = target_organisation_id
          and result.materialised_at <= snapshot_at
      ), latest as materialized (
        select result.*,
          row_number() over (
            partition by result.provider_repository_id, result.check_id
            order by result.observed_at desc, result.id desc
          ) as result_rank
        from eligible as result
      ), classified as materialized (
        select result.*,
          case when result.fresh_until > snapshot_at then 'current' else 'stale' end as freshness,
          case when public.github_official_result_mapping_status_at(
            result.organisation_id, result.id, snapshot_at
          ) = 'active' then 'active' else 'historical' end as mapping_status
        from latest as result
        where result.result_rank = 1
      )
      select 1
      from classified as result
      where (target_repository_id is null or result.repository_id = target_repository_id)
        and (target_result is null or result.outcome = target_result)
        and (target_freshness is null or result.freshness = target_freshness)
        and (target_mapping_status is null or result.mapping_status = target_mapping_status)
        and (target_severity is null or result.failure_severity = target_severity)
        and result.id = last_result_id
        and result.observed_at = last_observed_at
    ) then
      raise exception 'invalid GitHub compliance continuation cursor' using errcode = '22023';
    end if;
  end if;

  with eligible as materialized (
    select result.*, observation.fingerprint as source_response_fingerprint,
      run.id as eligible_run_id
    from public.github_official_compliance_results as result
    join public.github_observations as observation
      on observation.id = result.observation_id
     and observation.organisation_id = result.organisation_id
     and observation.installation_id = result.installation_id
     and observation.repository_id = result.repository_id
     and observation.provider_repository_id = result.provider_repository_id
     and observation.collection_run_id = result.collection_run_id
    join public.github_collection_runs as run
      on run.id = result.collection_run_id
     and run.organisation_id = result.organisation_id
     and run.installation_id = result.installation_id
     and run.repository_id = result.repository_id
     and run.provider_repository_id = result.provider_repository_id
     and run.run_mode = 'official'
     and run.status in ('succeeded', 'partial')
     and run.completed_at is not null
    where result.organisation_id = target_organisation_id
      and result.materialised_at <= snapshot_at
  ), latest as materialized (
    select result.*,
      row_number() over (
        partition by result.provider_repository_id, result.check_id
        order by result.observed_at desc, result.id desc
      ) as result_rank
    from eligible as result
  ), classified as materialized (
    select result.*,
      case when result.fresh_until > snapshot_at then 'current' else 'stale' end as freshness,
      case when public.github_official_result_mapping_status_at(
            result.organisation_id, result.id, snapshot_at
          ) = 'active' then 'active' else 'historical' end as mapping_status
    from latest as result
    where result.result_rank = 1
  ), filtered as materialized (
    select result.*
    from classified as result
    where (target_repository_id is null or result.repository_id = target_repository_id)
      and (target_result is null or result.outcome = target_result)
      and (target_freshness is null or result.freshness = target_freshness)
      and (target_mapping_status is null or result.mapping_status = target_mapping_status)
      and (target_severity is null or result.failure_severity = target_severity)
      and (last_result_id is null or (result.observed_at, result.id) < (last_observed_at, last_result_id))
  ), page as materialized (
    select result.*,
      row_number() over (order by result.observed_at desc, result.id desc) as page_number
    from filtered as result
    order by result.observed_at desc, result.id desc
    limit target_limit + 1
  ), record_bases as materialized (
    select result.page_number, result.observed_at, result.id,
      pg_catalog.jsonb_build_object(
        'id', 'github_result:' || result.id::text,
        'repositoryId', result.repository_id,
        'repositoryLabel', 'GitHub repository ' || pg_catalog.left(result.repository_id::text, 8),
        'collectionRunId', 'github_run:' || result.eligible_run_id::text,
        'runMode', 'official',
        'checkId', result.check_id,
        'result', result.outcome,
        'severity', result.failure_severity,
        'observedAt', result.observed_at,
        'freshUntil', result.fresh_until,
        'materialisedAt', result.materialised_at,
        'freshness', result.freshness,
        'mappingVersion', result.mapping_version,
        'mappingChecksum', result.mapping_checksum,
        'mappingStatus', result.mapping_status,
        'ruleVersion', result.rule_version,
        'sourceResponseFingerprint', result.source_response_fingerprint,
        'summary', result.catalogue_summary,
        'evidenceId', case when result.evidence_id is null then null else 'evidence:' || result.evidence_id::text end,
        'findingId', case when result.finding_id is null then null else 'monitoring_finding:' || result.finding_id::text end
      ) as value
    from page as result
    where result.page_number <= target_limit
  ), records as materialized (
    select record.page_number, record.observed_at, record.id,
      record.value || pg_catalog.jsonb_build_object(
        'recordHash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          'compliancehub.github.result.v2:'
            || (record.value - 'freshness' - 'mappingStatus' - 'recordHash')::text,
          'UTF8'
        ), 'sha256'), 'hex')
      ) as value
    from record_bases as record
  )
  select coalesce(
      pg_catalog.jsonb_agg(record.value order by record.observed_at desc, record.id desc),
      '[]'::jsonb
    ),
    (select pg_catalog.count(*) > target_limit from page),
    (select record.observed_at from records as record order by record.observed_at asc, record.id asc limit 1),
    (select record.id from records as record order by record.observed_at asc, record.id asc limit 1)
  into results_value, has_more, last_observed_at, last_result_id
  from records as record;

  if has_more then
    continuation_payload := pg_catalog.jsonb_build_object(
      'v', 3,
      'userId', caller_id,
      'clientId', caller_client_id,
      'audience', caller_audience,
      'organisationId', target_organisation_id,
      'snapshotAt', snapshot_at,
      'filters', expected_filters,
      'lastObservedAt', last_observed_at,
      'lastResultId', last_result_id,
      'issuedAt', issued_at,
      'expiresAt', expires_at
    )::text;
    continuation_encoded := pg_catalog.rtrim(pg_catalog.translate(
      pg_catalog.replace(pg_catalog.replace(
        pg_catalog.encode(pg_catalog.convert_to(continuation_payload, 'UTF8'), 'base64'),
        E'\n', ''
      ), E'\r', ''),
      '+/', '-_'
    ), '=');
    next_cursor := 'ch3.' || continuation_encoded || '.'
      || pg_catalog.encode(extensions.hmac(
        pg_catalog.convert_to(continuation_encoded,'UTF8'),cursor_key,'sha256'
      ),'hex');
  else
    next_cursor := null;
  end if;

  envelope_value := pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'workspace', pg_catalog.jsonb_build_object(
      'id', target_organisation_id,
      'name', (select organisation.name from public.organisations as organisation where organisation.id = target_organisation_id)
    ),
    'snapshotAt', snapshot_at,
    'results', results_value,
    'nextCursor', next_cursor,
    'truncated', has_more,
    'pageKind', case when target_cursor is null then 'initial' else 'continuation' end
  );

  return envelope_value || pg_catalog.jsonb_build_object(
    'pageHash', pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'compliancehub.github.page.v2:' || (envelope_value - 'pageHash')::text,
      'UTF8'
    ), 'sha256'), 'hex')
  );
end;
$$;

alter function public.get_mcp_github_compliance_results_v2(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer,text)
owner to postgres;
revoke all on function public.get_mcp_github_compliance_results_v2(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer,text)
from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function public.get_mcp_github_compliance_results_v2(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer,text)
to authenticated;
