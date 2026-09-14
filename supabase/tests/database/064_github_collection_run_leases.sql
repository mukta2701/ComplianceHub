begin;
select no_plan();

select has_column('public', 'github_collection_runs', 'provider_repository_id', 'runs carry provider repository ancestry');
select has_column('public', 'github_collection_runs', 'lease_token', 'runs carry an unguessable lease token');
select has_column('public', 'github_collection_runs', 'lease_expires_at', 'runs carry lease expiry');
select has_column('public', 'github_collection_runs', 'attempt', 'runs carry lease attempt number');
select has_function('public', 'reserve_github_collection_run_server', array['uuid','uuid','uuid','bigint','text','text','integer']);
select has_function('public', 'save_github_observations_server', array['uuid','uuid','uuid','uuid','bigint','uuid','integer','jsonb']);
select has_function('public', 'finalise_github_collection_run_server', array['uuid','uuid','uuid','uuid','bigint','uuid','integer','text','text']);
select has_function('public', 'refresh_github_repository_server', array['uuid','uuid','uuid','uuid','bigint','uuid','integer','text','text','text','text','text','boolean']);
select function_privs_are('public', 'reserve_github_collection_run_server', array['uuid','uuid','uuid','bigint','text','text','integer'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'save_github_observations_server', array['uuid','uuid','uuid','uuid','bigint','uuid','integer','jsonb'], 'service_role', array['EXECUTE']);

select ok((select count(*) = 1 from pg_constraint where conname = 'github_collection_runs_provider_repository_tenant_fk'), 'run has provider repository ancestry FK');
select ok((select count(*) = 1 from pg_constraint where conname = 'github_collection_runs_lease_lifecycle_check'), 'run lease lifecycle is constrained');
select ok((select count(*) = 1 from pg_proc where proname = 'reserve_github_collection_run_server' and prosecdef), 'reserve RPC is security definer');
select ok((select count(*) = 1 from pg_proc where proname = 'save_github_observations_server' and prosecdef), 'save RPC is security definer');
select ok((select count(*) = 1 from pg_proc where proname = 'finalise_github_collection_run_server' and prosecdef), 'finalise RPC is security definer');
select ok((select count(*) = 0 from information_schema.role_routine_grants where routine_schema = 'public' and routine_name like '%github_collection_run_server' and grantee in ('anon','authenticated')), 'collection lease RPCs are not browser callable');
select ok(not has_column_privilege('service_role', 'public.github_collection_runs', 'status', 'UPDATE'), 'service cannot bypass run finalization CAS');
select ok(not has_column_privilege('service_role', 'public.github_observations', 'observation_key', 'INSERT'), 'service cannot bypass lease-checked observation save');
select ok(not has_column_privilege('service_role', 'public.github_repositories', 'last_seen_at', 'UPDATE'), 'service cannot bypass full-ancestry repository refresh');

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values (
  '9c000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'lease-owner@example.test', '', now(), '{}', '{}'
);
insert into public.organisations(id, name, slug, created_by) values (
  '9c000000-0000-4000-8000-000000000010', 'Lease Contract', 'lease-contract',
  '9c000000-0000-4000-8000-000000000001'
);
insert into public.memberships(organisation_id, user_id, role) values (
  '9c000000-0000-4000-8000-000000000010',
  '9c000000-0000-4000-8000-000000000001', 'owner'
);
insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, permissions_ok
) values (
  '9c000000-0000-4000-8000-000000000020',
  '9c000000-0000-4000-8000-000000000010',
  91001, 92001, 'Lease-Co', 'Organization', 'selected', true
);
insert into public.github_repositories(
  id, organisation_id, installation_id, provider_repository_id, owner_login,
  name, full_name, html_url, visibility, default_branch, selected
) values (
  '9c000000-0000-4000-8000-000000000030',
  '9c000000-0000-4000-8000-000000000010',
  '9c000000-0000-4000-8000-000000000020',
  93001, 'Lease-Co', 'alpha', 'Lease-Co/alpha',
  'https://github.com/Lease-Co/alpha', 'private', 'main', true
);

create temp table first_reservation as
select * from public.reserve_github_collection_run_server(
  '9c000000-0000-4000-8000-000000000010',
  '9c000000-0000-4000-8000-000000000020',
  '9c000000-0000-4000-8000-000000000030',
  93001, 'scheduled', 'scheduled:2026-08-17', 120
);
create temp table active_duplicate as
select * from public.reserve_github_collection_run_server(
  '9c000000-0000-4000-8000-000000000010',
  '9c000000-0000-4000-8000-000000000020',
  '9c000000-0000-4000-8000-000000000030',
  93001, 'scheduled', 'scheduled:2026-08-17', 120
);

select is((select acquisition_state from first_reservation), 'acquired', 'the first duplicate reservation wins the lease');
select is((select acquisition_state from active_duplicate), 'active_duplicate', 'an active duplicate is skipped');
select is((select count(*)::integer from public.github_collection_runs where repository_id = '9c000000-0000-4000-8000-000000000030'), 1, 'duplicate reservations retain one run');
select is((select run_id from active_duplicate), (select run_id from first_reservation), 'duplicate reservation resolves to the same run');

update public.github_collection_runs
set started_at = pg_catalog.now() - interval '10 minutes',
    lease_expires_at = pg_catalog.now() - interval '5 minutes'
where id = (select run_id from first_reservation);

create temp table reclaimed_reservation as
select * from public.reserve_github_collection_run_server(
  '9c000000-0000-4000-8000-000000000010',
  '9c000000-0000-4000-8000-000000000020',
  '9c000000-0000-4000-8000-000000000030',
  93001, 'scheduled', 'scheduled:2026-08-17', 120
);

select is((select acquisition_state from reclaimed_reservation), 'reclaimed', 'expired zero-observation work is reclaimed');
select is((select attempt from reclaimed_reservation), 2, 'reclaim advances the compare-and-set attempt');
select isnt((select lease_token from reclaimed_reservation), (select lease_token from first_reservation), 'reclaim rotates the unguessable lease token');
select is(
  public.save_github_observations_server(
    (select run_id from first_reservation),
    '9c000000-0000-4000-8000-000000000010',
    '9c000000-0000-4000-8000-000000000020',
    '9c000000-0000-4000-8000-000000000030', 93001,
    (select lease_token from first_reservation), 1, '[]'::jsonb
  ),
  -1,
  'a stale lease cannot save observations after losing ownership'
);
select is(
  public.finalise_github_collection_run_server(
    (select run_id from first_reservation),
    '9c000000-0000-4000-8000-000000000010',
    '9c000000-0000-4000-8000-000000000020',
    '9c000000-0000-4000-8000-000000000030', 93001,
    (select lease_token from first_reservation), 1, 'failed', 'invalid_response'
  ),
  false,
  'a stale lease cannot finalize after losing ownership'
);
update public.github_collection_runs
set lease_expires_at = pg_catalog.now() + interval '30 seconds'
where id = (select run_id from reclaimed_reservation);
create temp table pre_refresh_lease as
select lease_expires_at from public.github_collection_runs
where id = (select run_id from reclaimed_reservation);
select is(
  public.refresh_github_repository_server(
    (select run_id from first_reservation),
    '9c000000-0000-4000-8000-000000000010',
    '9c000000-0000-4000-8000-000000000020',
    '9c000000-0000-4000-8000-000000000030', 93001,
    (select lease_token from first_reservation), 1,
    'Lease-Co', 'stale-name', 'https://github.com/Lease-Co/stale-name',
    'private', 'main', false
  ),
  false,
  'a stale lease cannot refresh repository identity after losing ownership'
);
select is(
  public.refresh_github_repository_server(
    (select run_id from reclaimed_reservation),
    '9c000000-0000-4000-8000-000000000010',
    '9c000000-0000-4000-8000-000000000020',
    '9c000000-0000-4000-8000-000000000030', 93001,
    (select lease_token from reclaimed_reservation), 2,
    'lease-co', 'alpha-renamed', 'https://github.com/lease-co/alpha-renamed',
    'private', 'trunk', false
  ),
  true,
  'the current lease safely refreshes stable provider identity before save'
);
select is(
  (select full_name from public.github_repositories where id = '9c000000-0000-4000-8000-000000000030'),
  'lease-co/alpha-renamed',
  'verified rename and case changes become the canonical repository identity'
);
select ok(
  (select lease_expires_at from public.github_collection_runs where id = (select run_id from reclaimed_reservation))
    > (select lease_expires_at from pre_refresh_lease),
  'lease-bound refresh renews enough time for immutable save and finalization'
);

select is(
  public.save_github_observations_server(
    (select run_id from reclaimed_reservation),
    '9c000000-0000-4000-8000-000000000010',
    '9c000000-0000-4000-8000-000000000020',
    '9c000000-0000-4000-8000-000000000030', 93001,
    (select lease_token from reclaimed_reservation), 2,
    (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'observation_key', 'lease-co/alpha-renamed/' || check_id || '/github-repository-v1',
        'check_id', check_id,
        'rule_version', 'github-repository-v1',
        'subject_type', 'github_repository',
        'subject_id', 'lease-co/alpha-renamed',
        'result', case when check_id = 'github.repository.visibility' then 'unknown' else 'pass' end,
        'severity', null,
        'title', check_id,
        'explanation', 'verified',
        'remediation', null,
        'observed_at', '2026-08-17T05:29:00.000Z',
        'fresh_until', '2026-08-18T17:29:00.000Z',
        'source_url', 'https://github.com/lease-co/alpha-renamed',
        'fingerprint', repeat('a', 64),
        'diagnostic_code', case when check_id = 'github.repository.visibility' then 'permission_denied' else null end
      ))
      from pg_catalog.unnest(array[
        'github.repository.visibility', 'github.repository.archived',
        'github.branch.force_pushes', 'github.branch.deletions',
        'github.branch.approving_reviews', 'github.branch.stale_approvals',
        'github.branch.code_owner_reviews', 'github.branch.status_checks',
        'github.dependabot.high_critical', 'github.code_scanning.high_critical',
        'github.secret_scanning.enabled', 'github.secret_scanning.push_protection',
        'github.secret_scanning.open_alerts', 'github.workflow.security',
        'github.administration.outside_collaborator_admins'
      ]) check_id
    )
  ),
  15,
  'the current lease saves one complete immutable observation set'
);

update public.github_collection_runs
set lease_expires_at = pg_catalog.now() - interval '1 minute'
where id = (select run_id from reclaimed_reservation);
create temp table persisted_reclaim as
select * from public.reserve_github_collection_run_server(
  '9c000000-0000-4000-8000-000000000010',
  '9c000000-0000-4000-8000-000000000020',
  '9c000000-0000-4000-8000-000000000030',
  93001, 'scheduled', 'scheduled:2026-08-17', 120
);

select is((select acquisition_state from persisted_reclaim), 'reclaimed', 'stale work with a persisted set is reclaimable');
select is(
  public.finalise_github_collection_run_server(
    (select run_id from reclaimed_reservation),
    '9c000000-0000-4000-8000-000000000010',
    '9c000000-0000-4000-8000-000000000020',
    '9c000000-0000-4000-8000-000000000030', 93001,
    (select lease_token from reclaimed_reservation), 2, 'succeeded', null
  ),
  false,
  'the prior attempt cannot finalize a persisted run after reclaim'
);
select is(
  public.finalise_github_collection_run_server(
    (select run_id from persisted_reclaim),
    '9c000000-0000-4000-8000-000000000010',
    '9c000000-0000-4000-8000-000000000020',
    '9c000000-0000-4000-8000-000000000030', 93001,
    (select lease_token from persisted_reclaim), 3, 'succeeded', null
  ),
  true,
  'the current reclaimed lease finalizes a complete persisted set without recollection'
);
select is(
  (select status::text || ':' || observation_count::text || ':' || attempt::text
   from public.github_collection_runs where id = (select run_id from persisted_reclaim)),
  'partial:15:3',
  'finalization derives counts, preserves the winning attempt, and never turns unknown into success'
);
select is(
  (select acquisition_state from public.reserve_github_collection_run_server(
    '9c000000-0000-4000-8000-000000000010',
    '9c000000-0000-4000-8000-000000000020',
    '9c000000-0000-4000-8000-000000000030',
    93001, 'scheduled', 'scheduled:2026-08-17', 120
  )),
  'completed_duplicate',
  'a completed duplicate remains immutable'
);
select throws_ok(
  $$ select * from public.reserve_github_collection_run_server(
    '9c000000-0000-4000-8000-000000000099',
    '9c000000-0000-4000-8000-000000000020',
    '9c000000-0000-4000-8000-000000000030',
    93001, 'manual', 'manual:cross-tenant', 120
  ) $$,
  'P0001', null,
  'cross-tenant target ancestry fails before provider work'
);

select * from finish();
rollback;
