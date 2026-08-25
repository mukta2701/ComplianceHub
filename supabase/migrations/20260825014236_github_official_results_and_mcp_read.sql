-- Immutable official outcomes deliberately retain only approval-derived
-- catalogue facts.  Provider payloads remain in append-only shadow tables.
create table public.github_official_compliance_results (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  repository_id uuid not null,
  provider_repository_id bigint not null check (provider_repository_id > 0),
  collection_run_id uuid not null,
  observation_id uuid not null,
  approval_id uuid not null,
  mapping_pack_id uuid not null,
  mapping_version text not null check (pg_catalog.char_length(mapping_version) between 1 and 80 and mapping_version !~ '[<>[:cntrl:]]'),
  mapping_checksum text not null check (mapping_checksum ~ '^[0-9a-f]{64}$'),
  check_id text not null check (pg_catalog.char_length(check_id) between 1 and 120 and check_id !~ '[<>[:cntrl:]]'),
  rule_version text not null check (pg_catalog.char_length(rule_version) between 1 and 120 and rule_version !~ '[<>[:cntrl:]]'),
  outcome public.github_observation_result not null,
  failure_severity public.monitor_severity,
  catalogue_summary text not null check (pg_catalog.char_length(catalogue_summary) between 1 and 280 and catalogue_summary !~ '[<>[:cntrl:]]'),
  observed_at timestamptz not null,
  fresh_until timestamptz not null,
  materialised_at timestamptz not null default pg_catalog.now(),
  evidence_id uuid,
  finding_id uuid,
  constraint github_official_results_observation_key unique (observation_id),
  constraint github_official_results_id_organisation_key unique (id, organisation_id),
  constraint github_official_results_freshness_check check (fresh_until > observed_at),
  constraint github_official_results_failure_shape check ((outcome = 'fail' and failure_severity is not null) or (outcome <> 'fail' and failure_severity is null)),
  constraint github_official_results_repository_fk foreign key (repository_id, organisation_id, installation_id, provider_repository_id) references public.github_repositories(id, organisation_id, installation_id, provider_repository_id) on delete restrict,
  constraint github_official_results_run_fk foreign key (collection_run_id, organisation_id, installation_id, repository_id, provider_repository_id) references public.github_collection_runs(id, organisation_id, installation_id, repository_id, provider_repository_id) on delete restrict,
  constraint github_official_results_observation_fk foreign key (observation_id, organisation_id, installation_id, repository_id, collection_run_id) references public.github_observations(id, organisation_id, installation_id, repository_id, collection_run_id) on delete restrict,
  constraint github_official_results_approval_fk foreign key (approval_id, organisation_id, mapping_pack_id) references public.github_mapping_approvals(id, organisation_id, mapping_pack_id) on delete restrict,
  constraint github_official_results_pack_fk foreign key (mapping_pack_id, mapping_version, mapping_checksum) references public.github_mapping_packs(id, version, checksum) on delete restrict,
  constraint github_official_results_evidence_fk foreign key (evidence_id, organisation_id) references public.evidence(id, organisation_id) on delete restrict,
  constraint github_official_results_finding_fk foreign key (finding_id, organisation_id) references public.monitoring_findings(id, organisation_id) on delete restrict
);

create index github_official_results_latest_idx on public.github_official_compliance_results(organisation_id, provider_repository_id, check_id, observed_at desc, id desc);

create or replace function public.reject_github_official_result_change()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'official GitHub compliance results are immutable' using errcode = '42501'; end;
$$;
alter function public.reject_github_official_result_change() owner to postgres;
revoke all on function public.reject_github_official_result_change() from public, anon, authenticated, service_role;
create trigger github_official_results_immutable before update or delete on public.github_official_compliance_results for each row execute function public.reject_github_official_result_change();

alter table public.github_official_compliance_results enable row level security;
create policy github_official_compliance_results_member_read on public.github_official_compliance_results for select to authenticated using ((select public.is_organisation_member(organisation_id)));
revoke all on public.github_official_compliance_results from public, anon, authenticated, service_role;
grant select on public.github_official_compliance_results to authenticated;

-- Keep the Task 2 implementation byte-for-byte intact while replacing its
-- public service boundary in this successor migration.  The wrapper means a
-- failed immutable-result insert rolls back every lifecycle write it made.
alter function public.materialise_github_observations_server(uuid,uuid,text,text,jsonb)
  rename to materialise_github_observations_task2_server;
revoke all on function public.materialise_github_observations_task2_server(uuid,uuid,text,text,jsonb)
from public, anon, authenticated, service_role;

create function public.materialise_github_observations_server(
  target_organisation_id uuid, target_collection_run_id uuid,
  target_mapping_version text, target_mapping_checksum text, target_decisions jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare summary_value jsonb; run_status public.github_collection_status; expected_count integer; distinct_count integer; inserted_count integer; matching_count integer; ledger_count integer;
begin
  summary_value := public.materialise_github_observations_task2_server(target_organisation_id, target_collection_run_id, target_mapping_version, target_mapping_checksum, target_decisions);
  select run.status into run_status
  from public.github_collection_runs run
  where run.id = target_collection_run_id and run.organisation_id = target_organisation_id;
  if run_status not in ('succeeded', 'partial') then return summary_value; end if;
  insert into public.github_official_compliance_results(
    organisation_id, installation_id, repository_id, provider_repository_id, collection_run_id, observation_id,
    approval_id, mapping_pack_id, mapping_version, mapping_checksum, check_id, rule_version, outcome,
    failure_severity, catalogue_summary, observed_at, fresh_until, evidence_id, finding_id
  )
  select observation.organisation_id, observation.installation_id, observation.repository_id, observation.provider_repository_id, observation.collection_run_id, observation.id,
    approval.id, pack.id, pack.version, pack.checksum, observation.check_id, observation.rule_version, observation.result,
    case when observation.result = 'fail' then entry.failure_severity else null end,
    entry.treatments #>> array[observation.result::text, 'summary'], observation.observed_at, observation.fresh_until,
    evidence_provenance.evidence_id, finding_provenance.finding_id
  from pg_catalog.jsonb_array_elements(target_decisions) decision_values(decision)
  join public.github_observations observation on observation.id = (decision_values.decision ->> 'observation_id')::uuid and observation.organisation_id = target_organisation_id and observation.collection_run_id = target_collection_run_id
  join public.github_mapping_approvals approval on approval.organisation_id = target_organisation_id and approval.revoked_at is null
  join public.github_mapping_packs pack on pack.id = approval.mapping_pack_id and pack.version = target_mapping_version and pack.checksum = target_mapping_checksum and pack.published_at is not null
  join public.github_mapping_entries entry on entry.mapping_pack_id = pack.id and entry.check_id = observation.check_id and entry.rule_version = observation.rule_version
  left join public.github_evidence_provenance evidence_provenance on evidence_provenance.observation_id = observation.id
  left join public.github_finding_provenance finding_provenance on finding_provenance.organisation_id = observation.organisation_id and finding_provenance.latest_observation_id = observation.id
  where exists (select 1 from public.github_collection_runs run where run.id = target_collection_run_id and run.organisation_id = target_organisation_id and run.status in ('succeeded','partial'))
  on conflict (observation_id) do nothing;
  get diagnostics inserted_count = row_count;
  select pg_catalog.count(*), pg_catalog.count(distinct (decision_values.decision ->> 'observation_id'))
  into expected_count, distinct_count
  from pg_catalog.jsonb_array_elements(target_decisions) decision_values(decision);
  select pg_catalog.count(*) into ledger_count
  from public.github_official_compliance_results result
  where result.organisation_id = target_organisation_id and result.collection_run_id = target_collection_run_id;
  select pg_catalog.count(*) into matching_count
  from pg_catalog.jsonb_array_elements(target_decisions) decision_values(decision)
  join public.github_observations observation on observation.id = (decision_values.decision ->> 'observation_id')::uuid
  join public.github_official_compliance_results result on result.observation_id = observation.id
  join public.github_mapping_approvals approval on approval.id = result.approval_id and approval.organisation_id = target_organisation_id and approval.revoked_at is null
  join public.github_mapping_packs pack on pack.id = result.mapping_pack_id
  join public.github_mapping_entries entry on entry.mapping_pack_id = pack.id and entry.check_id = observation.check_id and entry.rule_version = observation.rule_version
  left join public.github_evidence_provenance evidence_provenance on evidence_provenance.observation_id = observation.id
  left join public.github_finding_provenance finding_provenance on finding_provenance.organisation_id = observation.organisation_id and finding_provenance.latest_observation_id = observation.id
  where observation.organisation_id = target_organisation_id and observation.collection_run_id = target_collection_run_id
    and result.organisation_id = target_organisation_id and result.collection_run_id = target_collection_run_id
    and result.installation_id = observation.installation_id and result.repository_id = observation.repository_id and result.provider_repository_id = observation.provider_repository_id
    and result.mapping_version = target_mapping_version and result.mapping_checksum = target_mapping_checksum and pack.version = target_mapping_version and pack.checksum = target_mapping_checksum
    and result.check_id = observation.check_id and result.rule_version = observation.rule_version and result.outcome = observation.result
    and result.failure_severity is not distinct from case when observation.result = 'fail' then entry.failure_severity else null end
    and result.catalogue_summary = entry.treatments #>> array[observation.result::text, 'summary']
    and result.observed_at = observation.observed_at and result.fresh_until = observation.fresh_until
    and result.evidence_id is not distinct from evidence_provenance.evidence_id
    and result.finding_id is not distinct from finding_provenance.finding_id;
  if expected_count = 0 or expected_count <> distinct_count or inserted_count not in (0, expected_count) or matching_count <> expected_count or ledger_count <> expected_count then
    raise exception 'official result ledger is incomplete or conflicts' using errcode = 'P0001';
  end if;
  return summary_value;
end;
$$;
alter function public.materialise_github_observations_server(uuid,uuid,text,text,jsonb) owner to postgres;
revoke all on function public.materialise_github_observations_server(uuid,uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.materialise_github_observations_server(uuid,uuid,text,text,jsonb) to service_role;

create function public.get_mcp_github_compliance_results_v1(
  target_organisation_id uuid, target_repository_id uuid default null,
  target_result public.github_observation_result default null, target_freshness text default null,
  target_mapping_status text default null, target_severity public.monitor_severity default null,
  target_limit integer default 20
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with parameters as (
    select pg_catalog.now() as as_of
    where target_organisation_id is not null and target_limit between 1 and 50
      and (target_freshness is null or target_freshness in ('current','stale'))
      and (target_mapping_status is null or target_mapping_status in ('active','historical'))
  ), latest as (
    select result.*, row_number() over (partition by result.provider_repository_id, result.check_id order by result.observed_at desc, result.id desc) as result_rank
    from public.github_official_compliance_results result
    where result.organisation_id = target_organisation_id
  ), filtered as (
    select result.*, parameters.as_of,
      case when result.fresh_until > parameters.as_of then 'current' else 'stale' end as freshness,
      case when approval.id is not null and approval.mapping_pack_id = result.mapping_pack_id and pack.version = result.mapping_version and pack.checksum = result.mapping_checksum then 'active' else 'historical' end as mapping_status
    from latest result cross join parameters
    left join public.github_mapping_approvals approval on approval.organisation_id = result.organisation_id and approval.revoked_at is null
    left join public.github_mapping_packs pack on pack.id = approval.mapping_pack_id
    where result.result_rank = 1
      and (target_repository_id is null or result.repository_id = target_repository_id)
  ), bounded as (
    select * from filtered
    where (target_result is null or outcome = target_result)
      and (target_freshness is null or freshness = target_freshness)
      and (target_mapping_status is null or mapping_status = target_mapping_status)
      and (target_severity is null or failure_severity = target_severity)
    order by observed_at desc, id desc
    limit target_limit + 1
  )
  select pg_catalog.coalesce(pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'workspace', pg_catalog.jsonb_build_object('id', target_organisation_id, 'name', (select organisation.name from public.organisations organisation where organisation.id = target_organisation_id)),
    'asOf', (select as_of from parameters),
    'results', pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', 'github_result:' || id, 'repositoryId', repository_id,
      'repositoryLabel', 'GitHub repository ' || pg_catalog.left(repository_id::text, 8),
      'checkId', check_id, 'result', outcome, 'severity', failure_severity,
      'observedAt', observed_at, 'freshUntil', fresh_until, 'materialisedAt', materialised_at,
      'freshness', freshness, 'mappingVersion', mapping_version, 'mappingStatus', mapping_status,
      'ruleVersion', rule_version, 'summary', catalogue_summary,
      'evidenceId', case when evidence_id is null then null else 'evidence:' || evidence_id end,
      'findingId', case when finding_id is null then null else 'monitoring_finding:' || finding_id end
    ) order by observed_at desc, id desc) from (select * from bounded limit target_limit) selected), '[]'::jsonb),
    'truncated', (select count(*) > target_limit from bounded)
  ), null::jsonb);
$$;
alter function public.get_mcp_github_compliance_results_v1(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer) owner to postgres;
revoke all on function public.get_mcp_github_compliance_results_v1(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer) from public, anon, authenticated, service_role;
grant execute on function public.get_mcp_github_compliance_results_v1(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer) to authenticated;
