begin;

select no_plan();

select has_table('public', 'github_mapping_pack_selection_history',
  'pack selection has append-only history for snapshot reads');
select has_function('public', 'github_official_result_mapping_status_at',
  array['uuid','uuid','timestamp with time zone'],
  'one membership-gated helper classifies exact consent at a snapshot');

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('83000000-0000-4000-8000-000000000011',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'currentness-owner@example.test', '', now(), '{}', '{}'),
  ('83000000-0000-4000-8000-000000000012',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'currentness-member@example.test', '', now(), '{}', '{}'),
  ('83000000-0000-4000-8000-000000000013',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'currentness-outsider@example.test', '', now(), '{}', '{}');

insert into public.organisations(id, name, slug, created_by)
values ('83000000-0000-4000-8000-000000000001', 'Currentness Workspace',
  'currentness-workspace', '83000000-0000-4000-8000-000000000011');
insert into public.memberships(organisation_id, user_id, role) values
  ('83000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000011', 'owner'),
  ('83000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000012', 'member');

select set_config('m2.currentness.before_selection', pg_catalog.clock_timestamp()::text, true);
select set_config('m2.currentness.decision_id', public.record_github_mapping_entry_decision_server(
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000011',
  (select entry.id from public.github_mapping_entries entry
   join public.github_mapping_packs pack on pack.id = entry.mapping_pack_id
   where pack.version = 'github-iso-27001-v1'
     and entry.check_id = 'github.repository.visibility'),
  public.github_mapping_entry_digest((select entry.id
    from public.github_mapping_entries entry
    join public.github_mapping_packs pack on pack.id = entry.mapping_pack_id
    where pack.version = 'github-iso-27001-v1'
      and entry.check_id = 'github.repository.visibility')),
  'approved', 0
)::text, true);

insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status, connected_by, permissions, permissions_ok
) values (
  '83000000-0000-4000-8000-000000000101',
  '83000000-0000-4000-8000-000000000001', 83001, 83002,
  'CurrentnessFixture', 'Organization', 'selected', 'active',
  '83000000-0000-4000-8000-000000000011', '{"metadata":"read"}', true
);
insert into public.github_repositories(
  id, organisation_id, installation_id, provider_repository_id, owner_login,
  name, full_name, html_url, visibility, default_branch, archived, selected, available
) values (
  '83000000-0000-4000-8000-000000000102',
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000101', 83003,
  'CurrentnessFixture', 'repo', 'CurrentnessFixture/repo',
  'https://github.com/CurrentnessFixture/repo', 'private', 'main', false, true, true
);
insert into public.github_collection_runs(
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  trigger_type, request_key, status, started_at, completed_at,
  observation_count, passed_count, lease_token, lease_expires_at, attempt
) values (
  '83000000-0000-4000-8000-000000000201',
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000101',
  '83000000-0000-4000-8000-000000000102', 83003,
  'manual', 'currentness-run', 'succeeded', now() - interval '2 minutes', now(), 15, 15,
  extensions.gen_random_uuid(), now() - interval '1 minute', 1
);
insert into public.github_observations(
  organisation_id, installation_id, repository_id, provider_repository_id,
  collection_run_id, observation_key, check_id, rule_version, subject_type,
  subject_id, result, title, explanation, observed_at, fresh_until,
  source_url, fingerprint
)
select '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000101',
  '83000000-0000-4000-8000-000000000102', 83003,
  '83000000-0000-4000-8000-000000000201',
  'CurrentnessFixture/repo/' || entry.check_id || '/' || entry.rule_version,
  entry.check_id, entry.rule_version, 'github_repository', 'CurrentnessFixture/repo',
  'pass', 'Currentness fixture check', 'A bounded fictional observation.',
  now() - interval '1 minute', now() - interval '1 second',
  'https://github.com/CurrentnessFixture/repo',
  pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('currentness:' || entry.check_id, 'UTF8'), 'sha256'
  ), 'hex')
from public.github_mapping_entries entry
join public.github_mapping_packs pack on pack.id = entry.mapping_pack_id
where pack.version = 'github-iso-27001-v1';

select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '83000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000201',
    'github-iso-27001-v1',
    (select pack.checksum from public.github_mapping_packs pack
     where pack.version = 'github-iso-27001-v1'),
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'observation_id', observation.id,
      'treatment_kind', entry.treatments #>> array['pass','kind'],
      'iso_control_references', pg_catalog.to_jsonb(entry.iso_control_references),
      'failure_severity', entry.failure_severity,
      'remediation', entry.remediation
    ))
    from public.github_observations observation
    join public.github_mapping_entries entry on entry.check_id = observation.check_id
    join public.github_mapping_packs pack on pack.id = entry.mapping_pack_id
    where observation.collection_run_id = '83000000-0000-4000-8000-000000000201'
      and pack.version = 'github-iso-27001-v1'
      and observation.check_id = 'github.repository.visibility')
  )
$sql$, 'one exact approved entry creates a currentness fixture result');

select set_config('m2.currentness.result_id', (select result.id::text
  from public.github_official_compliance_results result
  where result.organisation_id = '83000000-0000-4000-8000-000000000001'
    and result.check_id = 'github.repository.visibility'), true);
select set_config('m2.currentness.before_pack_switch', pg_catalog.clock_timestamp()::text, true);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
select is(public.github_official_result_mapping_status_at(
  '83000000-0000-4000-8000-000000000001',
  current_setting('m2.currentness.result_id')::uuid,
  pg_catalog.clock_timestamp()
), 'active', 'the exact current entry decision is active at the snapshot');
select is(public.github_official_result_mapping_status_at(
  '83000000-0000-4000-8000-000000000001',
  current_setting('m2.currentness.result_id')::uuid,
  current_setting('m2.currentness.before_selection')::timestamptz
), 'historical', 'an ambiguous snapshot before recorded pack selection fails closed');

select is(public.get_github_compliance_control_room_v1(
    '83000000-0000-4000-8000-000000000001', 0, 10
  ) #>> '{repositories,0,officialResults,0,mappingStatus}',
  'active', 'Members receive exact mapping status without receipt details');
select is(public.get_github_compliance_control_room_v1(
    '83000000-0000-4000-8000-000000000001', 0, 10
  ) #>> '{repositories,0,officialResults,0,freshness}',
  'stale', 'freshness is reported separately from active mapping consent');
select is((public.get_mcp_github_compliance_results_v1(
    '83000000-0000-4000-8000-000000000001', null, null, null, null, null, 20
  ) #>> '{results,0,mappingStatus}'),
  'active', 'the Member result reader shares exact snapshot consent status');
select is((select pg_catalog.count(*) from public.github_mapping_entry_decisions
  where organisation_id = '83000000-0000-4000-8000-000000000001'),
  0::bigint, 'Members cannot read raw entry decisions');
select throws_ok($sql$
  select * from public.github_entry_materialisation_receipts
  where organisation_id = '83000000-0000-4000-8000-000000000001'
$sql$, '42501', null, 'Members cannot read raw materialisation receipts');
reset role;

insert into public.github_mapping_packs(id, version, title)
values ('83000000-0000-4000-8000-000000000501', 'github-currentness-v2', 'Currentness test pack');
insert into public.github_mapping_entries(
  mapping_pack_id, check_id, rule_version, iso_control_references,
  failure_severity, remediation, treatments
)
select '83000000-0000-4000-8000-000000000501', entry.check_id, entry.rule_version,
  entry.iso_control_references, entry.failure_severity, entry.remediation, entry.treatments
from public.github_mapping_entries entry
where entry.mapping_pack_id = (select pack.id from public.github_mapping_packs pack
  where pack.version = 'github-iso-27001-v1');
select public.seal_github_mapping_pack_server(
  'github-currentness-v2',
  public.github_mapping_pack_checksum('83000000-0000-4000-8000-000000000501')
);
select public.select_github_mapping_pack_server(
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000011',
  'github-currentness-v2',
  (select pack.checksum from public.github_mapping_packs pack
   where pack.id = '83000000-0000-4000-8000-000000000501'), 1
);
select set_config('m2.currentness.after_pack_switch', pg_catalog.clock_timestamp()::text, true);
select public.select_github_mapping_pack_server(
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000011',
  'github-iso-27001-v1',
  (select pack.checksum from public.github_mapping_packs pack
   where pack.version = 'github-iso-27001-v1'), 2
);
select set_config('m2.currentness.rejected_decision', public.record_github_mapping_entry_decision_server(
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000011',
  (select entry.id from public.github_mapping_entries entry
   join public.github_mapping_packs pack on pack.id = entry.mapping_pack_id
   where pack.version = 'github-iso-27001-v1'
     and entry.check_id = 'github.repository.visibility'),
  public.github_mapping_entry_digest((select entry.id from public.github_mapping_entries entry
    join public.github_mapping_packs pack on pack.id = entry.mapping_pack_id
    where pack.version = 'github-iso-27001-v1'
      and entry.check_id = 'github.repository.visibility')),
  'rejected', 3
)::text, true);
select set_config('m2.currentness.after_rejection', pg_catalog.clock_timestamp()::text, true);
update public.github_mapping_entry_decisions
set decided_at = current_setting('m2.currentness.after_rejection')::timestamptz
where id = current_setting('m2.currentness.rejected_decision')::uuid;
select set_config('m2.currentness.reapproved_decision', public.record_github_mapping_entry_decision_server(
  '83000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000011',
  (select entry.id from public.github_mapping_entries entry
   join public.github_mapping_packs pack on pack.id = entry.mapping_pack_id
   where pack.version = 'github-iso-27001-v1'
     and entry.check_id = 'github.repository.visibility'),
  public.github_mapping_entry_digest((select entry.id from public.github_mapping_entries entry
    join public.github_mapping_packs pack on pack.id = entry.mapping_pack_id
    where pack.version = 'github-iso-27001-v1'
      and entry.check_id = 'github.repository.visibility')),
  'approved', 4
)::text, true);
select set_config('m2.currentness.after_reapproval', pg_catalog.clock_timestamp()::text, true);
update public.github_mapping_entry_decisions
set decided_at = current_setting('m2.currentness.after_reapproval')::timestamptz
where id = current_setting('m2.currentness.reapproved_decision')::uuid;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"83000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
select is(public.github_official_result_mapping_status_at(
  '83000000-0000-4000-8000-000000000001',
  current_setting('m2.currentness.result_id')::uuid,
  current_setting('m2.currentness.before_pack_switch')::timestamptz
), 'active', 'a frozen snapshot before pack switch keeps its selected pack');
select is(public.github_official_result_mapping_status_at(
  '83000000-0000-4000-8000-000000000001',
  current_setting('m2.currentness.result_id')::uuid,
  current_setting('m2.currentness.after_pack_switch')::timestamptz
), 'historical', 'a pack switch is historical at the later snapshot');
select is(public.github_official_result_mapping_status_at(
  '83000000-0000-4000-8000-000000000001',
  current_setting('m2.currentness.result_id')::uuid,
  current_setting('m2.currentness.after_rejection')::timestamptz
), 'historical', 'a rejection makes the old result historical');
select is(public.github_official_result_mapping_status_at(
  '83000000-0000-4000-8000-000000000001',
  current_setting('m2.currentness.result_id')::uuid,
  current_setting('m2.currentness.after_reapproval')::timestamptz
), 'historical', 'a later approval does not revive a result bound to the prior decision');
reset role;

insert into public.organisations(id, name, slug, created_by)
values ('83000000-0000-4000-8000-000000000002', 'Legacy Fallback Workspace',
  'legacy-fallback-workspace', '83000000-0000-4000-8000-000000000011');
insert into public.memberships(organisation_id, user_id, role)
values ('83000000-0000-4000-8000-000000000002',
  '83000000-0000-4000-8000-000000000011', 'owner');
select set_config('m2.currentness.legacy_approval', public.approve_github_mapping_pack_server(
  '83000000-0000-4000-8000-000000000002',
  '83000000-0000-4000-8000-000000000011',
  'github-iso-27001-v1',
  (select pack.checksum from public.github_mapping_packs pack
   where pack.version = 'github-iso-27001-v1')
)::text, true);
select lives_ok($sql$
  insert into public.github_entry_materialisation_receipts(
    organisation_id, selected_mapping_pack_id, selected_mapping_entry_id, check_id,
    source_mapping_pack_id, source_mapping_entry_id, entry_digest, legacy_approval_id
  )
  select '83000000-0000-4000-8000-000000000002', entry.mapping_pack_id, entry.id,
    entry.check_id, entry.mapping_pack_id, entry.id,
    public.github_mapping_entry_digest(entry.id),
    current_setting('m2.currentness.legacy_approval')::uuid
  from public.github_mapping_entries entry
  join public.github_mapping_packs pack on pack.id = entry.mapping_pack_id
  where pack.version = 'github-iso-27001-v1'
    and entry.check_id = 'github.repository.visibility'
$sql$, 'legacy-approved entries can create receipts before explicit pack selection');
select is((select history.event_kind from public.github_mapping_pack_selection_history history
  where history.organisation_id = '83000000-0000-4000-8000-000000000002'
  order by history.recorded_at desc, history.id desc limit 1),
  'legacy_fallback', 'a new workspace records the known legacy-fallback state');
select is((select pg_catalog.count(*) from public.github_mapping_pack_selections selection
  where selection.organisation_id = '83000000-0000-4000-8000-000000000002'),
  0::bigint, 'legacy fallback does not invent an explicit selection');

select * from finish();
rollback;
