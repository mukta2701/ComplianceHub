begin;
select no_plan();

select has_view(
  'public', 'github_repository_monitoring_summaries',
  'operator-facing GitHub repository health has a dedicated read model'
);
select ok(
  pg_catalog.has_table_privilege('authenticated', 'public.github_repository_monitoring_summaries', 'SELECT'),
  'authenticated workspace members may read official GitHub repository health'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.github_repository_monitoring_summaries', 'SELECT'),
  'anonymous callers cannot read official GitHub repository health'
);
select is(
  (select relation.reloptions
   from pg_catalog.pg_class relation
   where relation.oid = pg_catalog.to_regclass('public.github_repository_monitoring_summaries')),
  array['security_invoker=true'],
  'the monitoring summary preserves caller RLS and column privileges'
);
select cmp_ok(
  (select pg_catalog.count(*)
   from pg_catalog.regexp_matches(
     pg_catalog.pg_get_viewdef('public.github_repository_monitoring_summaries'::pg_catalog.regclass),
     'run_mode = ''official''', 'g'
   )),
  '>=', 2::bigint,
  'both latest and completed monitoring summary branches are official-only'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.get_github_compliance_control_room_v1(uuid,integer,integer)'::pg_catalog.regprocedure
  ) ~ 'materialisation[.]collection_run_id = collection[.]id',
  'the control-room job is anchored to the displayed official collection'
);
select cmp_ok(
  (select pg_catalog.count(*)
   from pg_catalog.regexp_matches(
     pg_catalog.pg_get_functiondef(
       'public.get_github_compliance_control_room_v1(uuid,integer,integer)'::pg_catalog.regprocedure
     ),
     'run_mode = ''official''', 'g'
   )),
  '>=', 4::bigint,
  'control-room collection, job, result, and exhausted paths defend official ancestry'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values (
  '78000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'official-monitoring@example.test', '', now(), '{}', '{}'
);
insert into public.organisations(id, name, slug, created_by) values (
  '78000000-0000-4000-8000-000000000010', 'Official Monitoring', 'official-monitoring',
  '78000000-0000-4000-8000-000000000001'
);
insert into public.memberships(organisation_id, user_id, role) values (
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000001', 'owner'
);
insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, permissions_ok
) values (
  '78000000-0000-4000-8000-000000000020',
  '78000000-0000-4000-8000-000000000010',
  78101, 78201, 'Official-Co', 'Organization', 'selected', true
);
insert into public.github_repositories(
  id, organisation_id, installation_id, provider_repository_id, owner_login,
  name, full_name, html_url, visibility, default_branch, selected
) values
(
  '78000000-0000-4000-8000-000000000030',
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000020',
  78301, 'Official-Co', 'alpha', 'Official-Co/alpha',
  'https://github.com/Official-Co/alpha', 'private', 'main', true
),
(
  '78000000-0000-4000-8000-000000000031',
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000020',
  78302, 'Official-Co', 'beta', 'Official-Co/beta',
  'https://github.com/Official-Co/beta', 'private', 'main', true
),
(
  '78000000-0000-4000-8000-000000000032',
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000020',
  78303, 'Official-Co', 'gamma', 'Official-Co/gamma',
  'https://github.com/Official-Co/gamma', 'private', 'main', true
);
insert into public.github_collection_runs(
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  trigger_type, request_key, run_mode, status, started_at, completed_at,
  observation_count, passed_count, failed_count, unknown_count, not_applicable_count,
  lease_token, lease_expires_at, attempt
) values
(
  '78000000-0000-4000-8000-000000000040',
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000020',
  '78000000-0000-4000-8000-000000000030',
  78301, 'manual', 'official-monitoring:official', 'official', 'succeeded',
  '2026-09-01T08:00:00Z', '2026-09-01T08:05:00Z',
  15, 14, 1, 0, 0, extensions.gen_random_uuid(), '2026-09-01T08:01:00Z', 1
),
(
  '78000000-0000-4000-8000-000000000041',
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000020',
  '78000000-0000-4000-8000-000000000030',
  78301, 'manual', 'official-monitoring:shadow', 'shadow', 'partial',
  '2026-09-01T09:00:00Z', '2026-09-01T09:05:00Z',
  15, 2, 12, 1, 0, extensions.gen_random_uuid(), '2026-09-01T09:01:00Z', 1
),
(
  '78000000-0000-4000-8000-000000000042',
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000020',
  '78000000-0000-4000-8000-000000000031',
  78302, 'manual', 'official-monitoring:beta-completed', 'official', 'succeeded',
  '2026-09-01T07:00:00Z', '2026-09-01T07:05:00Z',
  15, 15, 0, 0, 0, extensions.gen_random_uuid(), '2026-09-01T07:01:00Z', 1
),
(
  '78000000-0000-4000-8000-000000000043',
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000020',
  '78000000-0000-4000-8000-000000000031',
  78302, 'manual', 'official-monitoring:beta-running', 'official', 'running',
  '2026-09-01T10:00:00Z', null,
  0, 0, 0, 0, 0, extensions.gen_random_uuid(), '2026-09-01T10:02:00Z', 1
),
(
  '78000000-0000-4000-8000-000000000044',
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000020',
  '78000000-0000-4000-8000-000000000032',
  78303, 'manual', 'official-monitoring:gamma-shadow', 'shadow', 'succeeded',
  '2026-09-01T11:00:00Z', '2026-09-01T11:05:00Z',
  15, 1, 14, 0, 0, extensions.gen_random_uuid(), '2026-09-01T11:01:00Z', 1
);

insert into public.github_observations(
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  collection_run_id, observation_key, check_id, rule_version, subject_type,
  subject_id, result, severity, title, explanation, remediation, observed_at,
  fresh_until, source_url, fingerprint, diagnostic_code
) values (
  '78000000-0000-4000-8000-000000000050',
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000020',
  '78000000-0000-4000-8000-000000000030', 78301,
  '78000000-0000-4000-8000-000000000040',
  'Official-Co/alpha/github.repository.visibility/github-repository-v1',
  'github.repository.visibility', 'github-repository-v1', 'github_repository',
  'github:repository:78301', 'fail', 'high', 'Repository visibility is restricted',
  'The repository is public.', 'Restrict repository visibility.',
  '2026-09-01T08:01:00Z', '2026-09-02T20:01:00Z',
  'https://github.com/Official-Co/alpha', repeat('a', 64), null
);
insert into public.github_mapping_approvals(
  organisation_id, mapping_pack_id, approved_by, approved_at
)
select '78000000-0000-4000-8000-000000000010', pack.id,
       '78000000-0000-4000-8000-000000000001', '2026-09-01T07:00:00Z'
from public.github_mapping_packs pack
where pack.version = 'github-iso-27001-v1';
insert into public.monitoring_findings(
  id, organisation_id, check_id, control_ref, subject_type, subject_id,
  severity, title, detail
) values (
  '78000000-0000-4000-8000-000000000060',
  '78000000-0000-4000-8000-000000000010',
  'github.repository.visibility', 'A.8.32', 'github_repository',
  'github:repository:78301', 'high', 'Repository visibility needs attention',
  'An approved GitHub check failed.'
);
insert into public.github_official_compliance_results(
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  collection_run_id, observation_id, approval_id, mapping_pack_id,
  mapping_version, mapping_checksum, check_id, rule_version, outcome,
  failure_severity, catalogue_summary, observed_at, fresh_until,
  materialised_at, evidence_id, finding_id
)
select
  '78000000-0000-4000-8000-000000000070',
  '78000000-0000-4000-8000-000000000010',
  '78000000-0000-4000-8000-000000000020',
  '78000000-0000-4000-8000-000000000030', 78301,
  '78000000-0000-4000-8000-000000000040',
  '78000000-0000-4000-8000-000000000050', approval.id, pack.id,
  pack.version, pack.checksum, 'github.repository.visibility',
  'github-repository-v1', 'fail', 'high',
  'A failed repository visibility check needs attention.',
  '2026-09-01T08:01:00Z', '2026-09-02T20:01:00Z',
  '2026-09-01T08:06:00Z', null,
  '78000000-0000-4000-8000-000000000060'
from public.github_mapping_approvals approval
join public.github_mapping_packs pack on pack.id = approval.mapping_pack_id
where approval.organisation_id = '78000000-0000-4000-8000-000000000010'
  and approval.revoked_at is null;

set role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"78000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select is(
  (select latest_run_id
   from public.github_repository_monitoring_summaries
   where repository_id = '78000000-0000-4000-8000-000000000030'),
  '78000000-0000-4000-8000-000000000040'::uuid,
  'operator health ignores a newer shadow run and returns the latest official run'
);
select is(
  (select latest_failed_count
   from public.github_repository_monitoring_summaries
   where repository_id = '78000000-0000-4000-8000-000000000030'),
  1,
  'operator health counts failures from the official run only'
);
select is(
  (select last_completed_collection_at
   from public.github_repository_monitoring_summaries
   where repository_id = '78000000-0000-4000-8000-000000000030'),
  '2026-09-01T08:05:00+00:00'::timestamptz,
  'operator freshness is derived from official terminal runs only'
);
select is(
  (select latest_run_id
   from public.github_repository_monitoring_summaries
   where repository_id = '78000000-0000-4000-8000-000000000031'),
  '78000000-0000-4000-8000-000000000043'::uuid,
  'operator health can show a newer official run in progress'
);
select is(
  (select last_completed_collection_at
   from public.github_repository_monitoring_summaries
   where repository_id = '78000000-0000-4000-8000-000000000031'),
  '2026-09-01T07:05:00+00:00'::timestamptz,
  'an official run in progress does not hide the last official completion used for freshness'
);
select ok(
  (select latest_run_id is null
      and latest_status is null
      and latest_failed_count is null
      and last_completed_collection_at is null
   from public.github_repository_monitoring_summaries
   where repository_id = '78000000-0000-4000-8000-000000000032'),
  'a shadow-only repository has no operator collection health or freshness'
);
select is(
  public.get_github_compliance_control_room_v1(
    '78000000-0000-4000-8000-000000000010', 0, 20
  ) #>> '{repositories,0,latestCollection,id}',
  '78000000-0000-4000-8000-000000000040',
  'the control room ignores a newer shadow run when choosing latest collection'
);
select is(
  public.get_github_compliance_control_room_v1(
    '78000000-0000-4000-8000-000000000010', 0, 20
  ) #>> '{repositories,0,latestMaterialisationJob,collectionRunId}',
  '78000000-0000-4000-8000-000000000040',
  'the control room materialisation status is anchored to an official run'
);
select is(
  public.get_github_compliance_control_room_v1(
    '78000000-0000-4000-8000-000000000010', 0, 20
  ) #>> '{repositories,0,officialResults,0,id}',
  '78000000-0000-4000-8000-000000000070',
  'the control room returns an official result with official run ancestry'
);
select ok(
  (public.get_github_compliance_control_room_v1(
    '78000000-0000-4000-8000-000000000010', 0, 20
  ) #>> '{repositories,2,latestCollection}') is null
  and (public.get_github_compliance_control_room_v1(
    '78000000-0000-4000-8000-000000000010', 0, 20
  ) #>> '{repositories,2,latestMaterialisationJob}') is null
  and pg_catalog.jsonb_array_length(public.get_github_compliance_control_room_v1(
    '78000000-0000-4000-8000-000000000010', 0, 20
  ) #> '{repositories,2,officialResults}') = 0,
  'a shadow-only repository has no operator collection, job, or official result'
);

reset role;
select * from finish();
rollback;
