begin;
select no_plan();

select has_column(
  'public', 'github_collection_runs', 'run_mode',
  'collection runs persist whether they are official or shadow'
);
select col_not_null(
  'public', 'github_collection_runs', 'run_mode',
  'run mode cannot become unknown'
);
select col_default_is(
  'public', 'github_collection_runs', 'run_mode', 'official',
  'historical and existing official callers retain official behavior by default'
);
select ok(
  (select pg_catalog.count(*) = 1
   from pg_catalog.pg_constraint
   where conname = 'github_collection_runs_mode_check'
     and conrelid = 'public.github_collection_runs'::pg_catalog.regclass
     and contype = 'c'),
  'run mode is constrained by an exact named check'
);

select has_function(
  'public', 'reserve_github_shadow_collection_run_server',
  array['uuid','uuid','uuid','bigint','text','text','integer'],
  'a dedicated shadow reservation boundary exists'
);
select function_privs_are(
  'public', 'reserve_github_shadow_collection_run_server',
  array['uuid','uuid','uuid','bigint','text','text','integer'],
  'service_role', array['EXECUTE'],
  'only the service boundary can reserve shadow runs'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_github_shadow_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)',
    'EXECUTE'
  ),
  'authenticated users cannot reserve shadow runs'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.reserve_github_shadow_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)',
    'EXECUTE'
  ),
  'anonymous users cannot reserve shadow runs'
);
select ok(
  (select procedure.prosecdef
     and procedure.proconfig @> array['search_path=""']
     and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
   from pg_catalog.pg_proc procedure
   where procedure.oid = pg_catalog.to_regprocedure(
     'public.reserve_github_shadow_collection_run_server(uuid,uuid,uuid,bigint,text,text,integer)'
   )),
  'shadow reservation is postgres-owned security definer with empty search path'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values (
  '79000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'shadow-run-owner@example.test', '', now(), '{}', '{}'
);
insert into public.organisations(id, name, slug, created_by) values (
  '79000000-0000-4000-8000-000000000010', 'Shadow Run Contract', 'shadow-run-contract',
  '79000000-0000-4000-8000-000000000001'
);
insert into public.memberships(organisation_id, user_id, role) values (
  '79000000-0000-4000-8000-000000000010',
  '79000000-0000-4000-8000-000000000001', 'owner'
);
insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, permissions_ok
) values (
  '79000000-0000-4000-8000-000000000020',
  '79000000-0000-4000-8000-000000000010',
  79101, 79201, 'Shadow-Co', 'Organization', 'selected', true
);
insert into public.github_repositories(
  id, organisation_id, installation_id, provider_repository_id, owner_login,
  name, full_name, html_url, visibility, default_branch, selected
) values (
  '79000000-0000-4000-8000-000000000030',
  '79000000-0000-4000-8000-000000000010',
  '79000000-0000-4000-8000-000000000020',
  79301, 'Shadow-Co', 'alpha', 'Shadow-Co/alpha',
  'https://github.com/Shadow-Co/alpha', 'private', 'main', true
);

set role service_role;
select is(
  (select acquisition_state || ':' || run_mode
   from public.reserve_github_shadow_collection_run_server(
     '79000000-0000-4000-8000-000000000010',
     '79000000-0000-4000-8000-000000000020',
     '79000000-0000-4000-8000-000000000030',
     79301, 'manual', 'manual:shadow-terminal', 120
   )),
  'acquired:shadow',
  'the dedicated boundary acquires a shadow run and returns its persisted mode'
);
select is(
  (select acquisition_state || ':' || run_mode
   from public.reserve_github_collection_run_server(
     '79000000-0000-4000-8000-000000000010',
     '79000000-0000-4000-8000-000000000020',
     '79000000-0000-4000-8000-000000000030',
     79301, 'manual', 'manual:official-terminal', 120
   )),
  'acquired:official',
  'the existing reservation boundary acquires an official run and returns its persisted mode'
);
reset role;

select is(
  (select run_mode from public.github_collection_runs
   where repository_id = '79000000-0000-4000-8000-000000000030'
     and request_key = 'manual:shadow-terminal'),
  'shadow',
  'shadow reservation persists shadow mode'
);
select is(
  (select run_mode from public.github_collection_runs
   where repository_id = '79000000-0000-4000-8000-000000000030'
     and request_key = 'manual:official-terminal'),
  'official',
  'existing reservation persists official mode'
);
select ok(
  (select organisation_id = '79000000-0000-4000-8000-000000000010'
      and installation_id = '79000000-0000-4000-8000-000000000020'
      and repository_id = '79000000-0000-4000-8000-000000000030'
      and provider_repository_id = 79301
      and attempt = 1
      and lease_token is not null
      and lease_expires_at > started_at
   from public.github_collection_runs
   where request_key = 'manual:shadow-terminal'),
  'shadow reservation preserves tenant ancestry and lease invariants'
);

select throws_ok(
  $$ update public.github_collection_runs
     set run_mode = 'official'
     where repository_id = '79000000-0000-4000-8000-000000000030'
       and request_key = 'manual:shadow-terminal' $$,
  'P0001', null,
  'a persisted shadow mode cannot be changed'
);

set role service_role;
select throws_ok(
  $$ select * from public.reserve_github_collection_run_server(
       '79000000-0000-4000-8000-000000000010',
       '79000000-0000-4000-8000-000000000020',
       '79000000-0000-4000-8000-000000000030',
       79301, 'manual', 'manual:shadow-terminal', 120
     ) $$,
  'P0001', null,
  'an official reservation cannot reuse a shadow request key'
);
select throws_ok(
  $$ select * from public.reserve_github_shadow_collection_run_server(
       '79000000-0000-4000-8000-000000000010',
       '79000000-0000-4000-8000-000000000020',
       '79000000-0000-4000-8000-000000000030',
       79301, 'manual', 'manual:official-terminal', 120
     ) $$,
  'P0001', null,
  'a shadow reservation cannot reuse an official request key'
);
reset role;

update public.github_collection_runs
set status = 'succeeded', completed_at = now()
where repository_id = '79000000-0000-4000-8000-000000000030'
  and request_key in ('manual:shadow-terminal', 'manual:official-terminal');

select is(
  (select count(*) from public.github_materialisation_jobs job
   join public.github_collection_runs run on run.id = job.collection_run_id
   where run.repository_id = '79000000-0000-4000-8000-000000000030'
     and run.request_key = 'manual:shadow-terminal'),
  0::bigint,
  'a terminal shadow run creates no materialisation job'
);
select is(
  (select count(*) from public.github_materialisation_jobs job
   join public.github_collection_runs run on run.id = job.collection_run_id
   where run.repository_id = '79000000-0000-4000-8000-000000000030'
     and run.request_key = 'manual:official-terminal'),
  1::bigint,
  'a terminal official run still creates exactly one materialisation job'
);

select * from finish();
rollback;
