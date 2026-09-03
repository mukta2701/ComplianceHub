-- This singleton is ordinary backed-up database state. A deliberate key
-- rotation invalidates outstanding (at most fifteen-minute) cursors. A
-- rollback must disable/drop the v2 RPC before removing this key and must
-- never restore the legacy public-SHA cursor format.
create schema mcp_cursor_private authorization postgres;
revoke all on schema mcp_cursor_private
from public, anon, authenticated, service_role, supabase_auth_admin;

create table mcp_cursor_private.mcp_github_results_cursor_key (
  singleton boolean primary key default true check (singleton),
  key_bytes bytea not null check (pg_catalog.octet_length(key_bytes) = 32),
  created_at timestamptz not null default pg_catalog.now()
);
alter table mcp_cursor_private.mcp_github_results_cursor_key owner to postgres;
alter table mcp_cursor_private.mcp_github_results_cursor_key enable row level security;
revoke all on table mcp_cursor_private.mcp_github_results_cursor_key
from public, anon, authenticated, service_role, supabase_auth_admin;
insert into mcp_cursor_private.mcp_github_results_cursor_key(singleton,key_bytes)
values (true,extensions.gen_random_bytes(32));

create function mcp_cursor_private.mcp_github_cursor_bytes_equal(left_value bytea,right_value bytea)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  difference integer := 0;
  byte_index integer;
begin
  if pg_catalog.octet_length(left_value) <> 32
    or pg_catalog.octet_length(right_value) <> 32
  then
    return false;
  end if;
  for byte_index in 0..31 loop
    difference := difference
      | (pg_catalog.get_byte(left_value,byte_index) # pg_catalog.get_byte(right_value,byte_index));
  end loop;
  return difference = 0;
end;
$$;
alter function mcp_cursor_private.mcp_github_cursor_bytes_equal(bytea,bytea) owner to postgres;
revoke all on function mcp_cursor_private.mcp_github_cursor_bytes_equal(bytea,bytea)
from public, anon, authenticated, service_role, supabase_auth_admin;

create function public.get_mcp_github_compliance_results_v2(
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
  request_now timestamptz := pg_catalog.now();
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
          case when exists (
            select 1
            from public.github_mapping_approvals as approval
            join public.github_mapping_packs as pack
              on pack.id = approval.mapping_pack_id
             and pack.id = result.mapping_pack_id
             and pack.version = result.mapping_version
             and pack.checksum = result.mapping_checksum
             and pack.published_at is not null
             and pack.published_at <= snapshot_at
            where approval.id = result.approval_id
              and approval.organisation_id = result.organisation_id
              and approval.mapping_pack_id = result.mapping_pack_id
              and approval.approved_at <= snapshot_at
              and (approval.revoked_at is null or approval.revoked_at > snapshot_at)
          ) then 'active' else 'historical' end as mapping_status
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
      case when exists (
        select 1
        from public.github_mapping_approvals as approval
        join public.github_mapping_packs as pack
          on pack.id = approval.mapping_pack_id
         and pack.id = result.mapping_pack_id
         and pack.version = result.mapping_version
         and pack.checksum = result.mapping_checksum
         and pack.published_at is not null
         and pack.published_at <= snapshot_at
        where approval.id = result.approval_id
          and approval.organisation_id = result.organisation_id
          and approval.mapping_pack_id = result.mapping_pack_id
          and approval.approved_at <= snapshot_at
          and (approval.revoked_at is null or approval.revoked_at > snapshot_at)
      ) then 'active' else 'historical' end as mapping_status
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
