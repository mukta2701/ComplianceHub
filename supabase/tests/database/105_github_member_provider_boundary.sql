begin;
select no_plan();

select has_view(
  'public', 'github_official_repository_sources',
  'official GitHub results have a narrow repository-source projection'
);
select results_eq(
  $$ select column_name::text collate "default"
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'github_official_repository_sources'
     order by ordinal_position $$,
  $$ values ('id'::text), ('organisation_id'::text), ('full_name'::text), ('html_url'::text) $$,
  'the official source projection exposes only the minimum repository identity'
);
select ok(
  case when pg_catalog.to_regclass('public.github_official_repository_sources') is null then false
       else pg_catalog.has_table_privilege('authenticated', pg_catalog.to_regclass('public.github_official_repository_sources'), 'SELECT') end,
  'authenticated app readers receive only read access to official repository sources'
);
select ok(
  case when pg_catalog.to_regclass('public.github_official_repository_sources') is null then false
       else not pg_catalog.has_table_privilege('service_role', pg_catalog.to_regclass('public.github_official_repository_sources'), 'SELECT') end,
  'service workers cannot bypass the authenticated official repository-source boundary'
);
select ok(
  case when pg_catalog.to_regclass('public.github_official_repository_sources') is null then false
       else not pg_catalog.has_table_privilege('anon', pg_catalog.to_regclass('public.github_official_repository_sources'), 'SELECT') end,
  'anonymous callers cannot read official repository sources'
);
select is(
  (select relation.reloptions
   from pg_catalog.pg_class relation
   where relation.oid = pg_catalog.to_regclass('public.github_official_repository_sources')),
  array['security_barrier=true'],
  'the member-filtered official source projection is an optimiser barrier'
);

create or replace function pg_temp.official_source_count(
  target_organisation_id uuid,
  target_repository_id uuid default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  result integer;
begin
  if pg_catalog.to_regclass('public.github_official_repository_sources') is null then
    return -1;
  end if;
  execute $query$
    select pg_catalog.count(*)::integer
    from public.github_official_repository_sources source
    where source.organisation_id = $1
      and ($2 is null or source.id = $2)
  $query$ into result using target_organisation_id, target_repository_id;
  return result;
end;
$$;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('b1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider-boundary-owner@example.test', '', now(), '{}', '{}'),
  ('b1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider-boundary-admin@example.test', '', now(), '{}', '{}'),
  ('b1000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider-boundary-member@example.test', '', now(), '{}', '{}'),
  ('b1000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'provider-boundary-other-owner@example.test', '', now(), '{}', '{}');

insert into public.organisations(id, name, slug, created_by) values
  ('b1100000-0000-4000-8000-000000000001', 'Provider Boundary A', 'provider-boundary-a', 'b1000000-0000-4000-8000-000000000001'),
  ('b1100000-0000-4000-8000-000000000002', 'Provider Boundary B', 'provider-boundary-b', 'b1000000-0000-4000-8000-000000000004');
insert into public.memberships(organisation_id, user_id, role) values
  ('b1100000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'owner'),
  ('b1100000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'admin'),
  ('b1100000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', 'member'),
  ('b1100000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000004', 'owner');

insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status, connected_by, permissions,
  permissions_ok
) values
  ('b1200000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-000000000001', 912001, 922001, 'Boundary-A', 'Organization', 'selected', 'active', 'b1000000-0000-4000-8000-000000000001', '{"metadata":"read","administration":"read","actions":"read","vulnerability_alerts":"read","security_events":"read","secret_scanning_alerts":"read"}', true),
  ('b1200000-0000-4000-8000-000000000002', 'b1100000-0000-4000-8000-000000000002', 912002, 922002, 'Boundary-B', 'Organization', 'selected', 'active', 'b1000000-0000-4000-8000-000000000004', '{"metadata":"read","administration":"read","actions":"read","vulnerability_alerts":"read","security_events":"read","secret_scanning_alerts":"read"}', true);
insert into public.github_repositories(
  id, organisation_id, installation_id, provider_repository_id, owner_login,
  name, full_name, html_url, visibility, default_branch, selected
) values
  ('b1300000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 932001, 'Boundary-A', 'official', 'Boundary-A/official', 'https://github.com/Boundary-A/official', 'private', 'main', true),
  ('b1300000-0000-4000-8000-000000000002', 'b1100000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 932002, 'Boundary-A', 'provisional', 'Boundary-A/provisional', 'https://github.com/Boundary-A/provisional', 'private', 'main', true),
  ('b1300000-0000-4000-8000-000000000003', 'b1100000-0000-4000-8000-000000000002', 'b1200000-0000-4000-8000-000000000002', 932003, 'Boundary-B', 'official', 'Boundary-B/official', 'https://github.com/Boundary-B/official', 'private', 'main', true);

insert into public.github_collection_runs(
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  trigger_type, request_key, run_mode, status, started_at, completed_at,
  observation_count, passed_count, failed_count, unknown_count,
  not_applicable_count, lease_token, lease_expires_at, attempt
) values
  ('b1400000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-000000000001', 932001, 'manual', 'provider-boundary-a', 'official', 'succeeded', '2026-09-15T00:00:00Z', '2026-09-15T00:01:00Z', 1, 1, 0, 0, 0, extensions.gen_random_uuid(), '2026-09-15T00:02:00Z', 1),
  ('b1400000-0000-4000-8000-000000000002', 'b1100000-0000-4000-8000-000000000002', 'b1200000-0000-4000-8000-000000000002', 'b1300000-0000-4000-8000-000000000003', 932003, 'manual', 'provider-boundary-b', 'official', 'succeeded', '2026-09-15T00:00:00Z', '2026-09-15T00:01:00Z', 1, 1, 0, 0, 0, extensions.gen_random_uuid(), '2026-09-15T00:02:00Z', 1);

insert into public.github_observations(
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  collection_run_id, observation_key, check_id, rule_version, subject_type,
  subject_id, result, severity, title, explanation, remediation, observed_at,
  fresh_until, source_url, fingerprint, diagnostic_code
) values
  ('b1500000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-000000000001', 'b1200000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-000000000001', 932001, 'b1400000-0000-4000-8000-000000000001', 'Boundary-A/official/github.repository.visibility/github-repository-v1', 'github.repository.visibility', 'github-repository-v1', 'github_repository', 'github:repository:932001', 'pass', null, 'Repository visibility is restricted', 'The repository is private.', null, '2026-09-15T00:00:30Z', '2026-09-16T12:00:30Z', 'https://github.com/Boundary-A/official', repeat('a', 64), null),
  ('b1500000-0000-4000-8000-000000000002', 'b1100000-0000-4000-8000-000000000002', 'b1200000-0000-4000-8000-000000000002', 'b1300000-0000-4000-8000-000000000003', 932003, 'b1400000-0000-4000-8000-000000000002', 'Boundary-B/official/github.repository.visibility/github-repository-v1', 'github.repository.visibility', 'github-repository-v1', 'github_repository', 'github:repository:932003', 'pass', null, 'Repository visibility is restricted', 'The repository is private.', null, '2026-09-15T00:00:30Z', '2026-09-16T12:00:30Z', 'https://github.com/Boundary-B/official', repeat('b', 64), null);

insert into public.github_mapping_approvals(
  id, organisation_id, mapping_pack_id, approved_by, approved_at
)
select 'b1600000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-000000000001', pack.id, 'b1000000-0000-4000-8000-000000000001', '2026-09-14T23:00:00Z'
from public.github_mapping_packs pack
where pack.version = 'github-iso-27001-v1';
insert into public.github_mapping_approvals(
  id, organisation_id, mapping_pack_id, approved_by, approved_at
)
select 'b1600000-0000-4000-8000-000000000002', 'b1100000-0000-4000-8000-000000000002', pack.id, 'b1000000-0000-4000-8000-000000000004', '2026-09-14T23:00:00Z'
from public.github_mapping_packs pack
where pack.version = 'github-iso-27001-v1';

insert into public.evidence(
  id, organisation_id, title, kind, description, owner_id, collected_on,
  valid_until, status, created_by
) values (
  'b1700000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-000000000001',
  'Approved GitHub repository result', 'note', 'Approved result fixture.',
  'b1000000-0000-4000-8000-000000000001', '2026-09-15', '2026-09-16',
  'current', 'b1000000-0000-4000-8000-000000000001'
);
insert into public.github_evidence_provenance(
  id, evidence_id, organisation_id, installation_id, repository_id,
  collection_run_id, observation_id, approval_id, mapping_pack_id,
  identity_key, check_id, rule_version, mapping_version, observed_at,
  fresh_until
)
select
  'b1800000-0000-4000-8000-000000000001',
  'b1700000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'b1300000-0000-4000-8000-000000000001',
  'b1400000-0000-4000-8000-000000000001',
  'b1500000-0000-4000-8000-000000000001',
  approval.id, pack.id, repeat('c', 64), 'github.repository.visibility',
  'github-repository-v1', pack.version, '2026-09-15T00:00:30Z',
  '2026-09-16T12:00:30Z'
from public.github_mapping_approvals approval
join public.github_mapping_packs pack on pack.id = approval.mapping_pack_id
where approval.id = 'b1600000-0000-4000-8000-000000000001';

insert into public.github_official_compliance_results(
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  collection_run_id, observation_id, approval_id, mapping_pack_id,
  mapping_version, mapping_checksum, check_id, rule_version, outcome,
  failure_severity, catalogue_summary, observed_at, fresh_until,
  materialised_at, evidence_id, finding_id
)
select
  'b1900000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'b1300000-0000-4000-8000-000000000001', 932001,
  'b1400000-0000-4000-8000-000000000001',
  'b1500000-0000-4000-8000-000000000001', approval.id, pack.id,
  pack.version, pack.checksum, 'github.repository.visibility',
  'github-repository-v1', 'pass', null,
  'The approved repository visibility check passed.',
  '2026-09-15T00:00:30Z', '2026-09-16T12:00:30Z',
  '2026-09-15T00:01:30Z', 'b1700000-0000-4000-8000-000000000001', null
from public.github_mapping_approvals approval
join public.github_mapping_packs pack on pack.id = approval.mapping_pack_id
where approval.id = 'b1600000-0000-4000-8000-000000000001';
insert into public.github_official_compliance_results(
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  collection_run_id, observation_id, approval_id, mapping_pack_id,
  mapping_version, mapping_checksum, check_id, rule_version, outcome,
  failure_severity, catalogue_summary, observed_at, fresh_until,
  materialised_at, evidence_id, finding_id
)
select
  'b1900000-0000-4000-8000-000000000002',
  'b1100000-0000-4000-8000-000000000002',
  'b1200000-0000-4000-8000-000000000002',
  'b1300000-0000-4000-8000-000000000003', 932003,
  'b1400000-0000-4000-8000-000000000002',
  'b1500000-0000-4000-8000-000000000002', approval.id, pack.id,
  pack.version, pack.checksum, 'github.repository.visibility',
  'github-repository-v1', 'pass', null,
  'The approved repository visibility check passed.',
  '2026-09-15T00:00:30Z', '2026-09-16T12:00:30Z',
  '2026-09-15T00:01:30Z', null, null
from public.github_mapping_approvals approval
join public.github_mapping_packs pack on pack.id = approval.mapping_pack_id
where approval.id = 'b1600000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_installations), 1, 'an Owner reads its installation identity');
select is((select count(*)::integer from public.github_repositories), 2, 'an Owner reads its repository scope');
select is((select count(*)::integer from public.github_collection_runs), 1, 'an Owner reads its collection diagnostics');
select is((select count(*)::integer from public.github_observations), 1, 'an Owner reads its provisional observations');
select is((select count(*)::integer from public.github_materialisation_jobs), 1, 'an Owner reads its recovery queue');
select is((select count(*)::integer from public.github_repository_shadow_summaries), 2, 'an Owner reads its shadow repository summary');
select is((select count(*)::integer from public.github_repository_monitoring_summaries), 2, 'an Owner reads its official repository summary');
select ok(public.get_github_compliance_control_room_v1('b1100000-0000-4000-8000-000000000001', 0, 20) is not null, 'an Owner retains the bounded control-room response');

select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_installations), 1, 'an Admin reads its installation identity');
select is((select count(*)::integer from public.github_repositories), 2, 'an Admin reads its repository scope');
select is((select count(*)::integer from public.github_collection_runs), 1, 'an Admin reads its collection diagnostics');
select is((select count(*)::integer from public.github_observations), 1, 'an Admin reads its provisional observations');
select is((select count(*)::integer from public.github_materialisation_jobs), 1, 'an Admin reads its recovery queue');
select is((select count(*)::integer from public.github_repository_shadow_summaries), 2, 'an Admin reads its shadow repository summary');
select is((select count(*)::integer from public.github_repository_monitoring_summaries), 2, 'an Admin reads its official repository summary');
select ok(public.get_github_compliance_control_room_v1('b1100000-0000-4000-8000-000000000001', 0, 20) is not null, 'an Admin retains the bounded control-room response');

select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_installations), 0, 'a Member reads no installation configuration');
select is((select count(*)::integer from public.github_repositories), 0, 'a Member reads no repository scope');
select is((select count(*)::integer from public.github_collection_runs), 0, 'a Member reads no collection diagnostics');
select is((select count(*)::integer from public.github_observations), 0, 'a Member reads no provisional observations');
select is((select count(*)::integer from public.github_materialisation_jobs), 0, 'a Member reads no recovery queue');
select is((select count(*)::integer from public.github_repository_shadow_summaries), 0, 'a Member reads no shadow repository summary');
select is((select count(*)::integer from public.github_repository_monitoring_summaries), 0, 'a Member reads no official repository health summary');
select is(public.get_github_compliance_control_room_v1('b1100000-0000-4000-8000-000000000001', 0, 20), null::jsonb, 'a Member receives no provider control-room response');
select is((select count(*)::integer from public.github_official_compliance_results), 1, 'a Member retains its approved official result');
select is((select count(*)::integer from public.github_evidence_provenance), 1, 'a Member retains its approved evidence provenance');
select is(pg_temp.official_source_count('b1100000-0000-4000-8000-000000000001'), 1, 'a Member reads the minimum source for its official result');
select is(pg_temp.official_source_count('b1100000-0000-4000-8000-000000000001', 'b1300000-0000-4000-8000-000000000002'), 0, 'a repository without an official result is absent from the Member projection');

select set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_installations where organisation_id = 'b1100000-0000-4000-8000-000000000001'), 0, 'a cross-tenant Owner reads no installation configuration');
select is((select count(*)::integer from public.github_repositories where organisation_id = 'b1100000-0000-4000-8000-000000000001'), 0, 'a cross-tenant Owner reads no repository scope');
select is((select count(*)::integer from public.github_collection_runs where organisation_id = 'b1100000-0000-4000-8000-000000000001'), 0, 'a cross-tenant Owner reads no collection diagnostics');
select is((select count(*)::integer from public.github_observations where organisation_id = 'b1100000-0000-4000-8000-000000000001'), 0, 'a cross-tenant Owner reads no provisional observations');
select is((select count(*)::integer from public.github_materialisation_jobs where organisation_id = 'b1100000-0000-4000-8000-000000000001'), 0, 'a cross-tenant Owner reads no recovery queue');
select is((select count(*)::integer from public.github_repository_shadow_summaries where organisation_id = 'b1100000-0000-4000-8000-000000000001'), 0, 'a cross-tenant Owner reads no shadow repository summary');
select is((select count(*)::integer from public.github_repository_monitoring_summaries where organisation_id = 'b1100000-0000-4000-8000-000000000001'), 0, 'a cross-tenant Owner reads no official repository health summary');
select is(public.get_github_compliance_control_room_v1('b1100000-0000-4000-8000-000000000001', 0, 20), null::jsonb, 'a cross-tenant Owner receives no provider control-room response');
select is((select count(*)::integer from public.github_official_compliance_results where organisation_id = 'b1100000-0000-4000-8000-000000000001'), 0, 'official results remain cross-tenant isolated');
select is((select count(*)::integer from public.github_evidence_provenance where organisation_id = 'b1100000-0000-4000-8000-000000000001'), 0, 'official provenance remains cross-tenant isolated');
select is(pg_temp.official_source_count('b1100000-0000-4000-8000-000000000001'), 0, 'official repository sources remain cross-tenant isolated');
select is(pg_temp.official_source_count('b1100000-0000-4000-8000-000000000002'), 1, 'the other Owner retains only its own official repository source');

select * from finish();
rollback;
