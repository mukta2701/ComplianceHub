begin;
select no_plan();

select has_table('public', 'github_installations', 'GitHub installations have durable tenant state');
select has_table('public', 'github_repositories', 'GitHub repositories have durable tenant inventory');
select has_table('public', 'github_collection_runs', 'GitHub collection runs have durable reservations');
select has_table('public', 'github_observations', 'GitHub observations have durable shadow history');
select has_table('public', 'github_webhook_deliveries', 'GitHub webhook deliveries have replay-safe history');
select has_table('public', 'github_oauth_states', 'GitHub OAuth callbacks have a hashed replay ledger');
select has_view('public', 'github_repository_shadow_summaries', 'repositories have one bounded latest-run summary');
select col_is_pk('public', 'github_installations', 'id', 'GitHub installation ids are primary keys');
select has_unique('public', 'github_installations', 'github_installations_provider_id_key');
select has_fk('public', 'github_repositories', 'github_repositories_installation_tenant_fk');
select has_fk('public', 'github_observations', 'github_observations_repository_tenant_fk');
select has_column('public', 'github_webhook_deliveries', 'provider_installation_id', 'webhook intake retains the validated provider installation id');
select has_column('public', 'github_webhook_deliveries', 'provider_repository_id', 'webhook intake retains the optional validated provider repository id');

select is(
  (
    select count(*)
    from pg_catalog.pg_class table_row
    join pg_catalog.pg_namespace table_schema on table_schema.oid = table_row.relnamespace
    where table_schema.nspname = 'public'
      and table_row.relname in (
        'github_installations', 'github_repositories', 'github_collection_runs',
        'github_observations', 'github_webhook_deliveries', 'github_oauth_states'
      )
      and exists (
        select 1
        from pg_catalog.pg_attribute column_row
        where column_row.attrelid = table_row.oid
          and column_row.attname = 'organisation_id'
          and not column_row.attisdropped
      )
      and exists (
        select 1
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid = table_row.oid
          and constraint_row.contype = 'u'
          and constraint_row.conkey = array[
            (select attnum from pg_catalog.pg_attribute where attrelid = table_row.oid and attname = 'id'),
            (select attnum from pg_catalog.pg_attribute where attrelid = table_row.oid and attname = 'organisation_id')
          ]::smallint[]
      )
  ),
  6::bigint,
  'every GitHub tenant table carries organisation_id and a composite id/tenant key'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = pg_catalog.to_regclass('public.github_collection_runs')
      and conname = 'github_collection_runs_repository_tenant_fk'
      and contype = 'f'
  ),
  'collection runs bind repository, installation, and tenant ancestry'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = pg_catalog.to_regclass('public.github_observations')
      and conname = 'github_observations_collection_run_tenant_fk'
      and contype = 'f'
  ),
  'observations bind their run, repository, installation, and tenant ancestry'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = pg_catalog.to_regclass('public.github_installations')
      and conname = 'github_installations_id_full_ancestry_key'
      and contype = 'u'
  ),
  'webhook installation ancestry has an exact composite unique target'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_attribute
    where attrelid in (
      pg_catalog.to_regclass('public.github_observations'),
      pg_catalog.to_regclass('public.github_webhook_deliveries')
    )
      and attname in ('payload', 'raw_body', 'raw_payload', 'provider_payload', 'response_body')
      and not attisdropped
  ),
  0::bigint,
  'shadow history stores no raw provider payload or webhook body'
);

select ok(has_column_privilege('authenticated', 'public.github_installations', 'id', 'SELECT'), 'authenticated may read a safe installation identifier');
select ok(has_column_privilege('authenticated', 'public.github_installations', 'account_login', 'SELECT'), 'authenticated may read a safe installation account summary');
select ok(has_column_privilege('authenticated', 'public.github_installations', 'permissions_ok', 'SELECT'), 'authenticated may read the verified permission summary');
select ok(not has_column_privilege('authenticated', 'public.github_installations', 'permissions', 'SELECT'), 'authenticated cannot read retained GitHub permission metadata');
select ok(not has_column_privilege('authenticated', 'public.github_installations', 'connected_by', 'SELECT'), 'authenticated cannot read installation actor metadata');
select ok(has_column_privilege('authenticated', 'public.github_repositories', 'full_name', 'SELECT'), 'authenticated may read safe repository summaries');
select ok(has_column_privilege('authenticated', 'public.github_repositories', 'available', 'SELECT'), 'authenticated may read repository availability without losing selected state');
select ok(has_column_privilege('authenticated', 'public.github_collection_runs', 'status', 'SELECT'), 'authenticated may read safe collection summaries');
select ok(not has_column_privilege('authenticated', 'public.github_collection_runs', 'request_key', 'SELECT'), 'authenticated cannot read internal idempotency keys');
select ok(has_column_privilege('authenticated', 'public.github_observations', 'result', 'SELECT'), 'authenticated may read safe observation summaries');
select ok(not has_table_privilege('authenticated', 'public.github_webhook_deliveries', 'SELECT'), 'authenticated cannot inspect webhook delivery internals');
select ok(not has_table_privilege('authenticated', 'public.github_oauth_states', 'SELECT'), 'authenticated cannot inspect OAuth replay state');
select ok(has_table_privilege('authenticated', 'public.github_repository_shadow_summaries', 'SELECT'), 'authenticated may read bounded repository shadow summaries');
select is(
  (
    select reloptions
    from pg_catalog.pg_class
    where oid = pg_catalog.to_regclass('public.github_repository_shadow_summaries')
  ),
  array['security_invoker=true'],
  'repository shadow summaries execute with caller RLS and privileges'
);

select ok(not has_table_privilege('authenticated', 'public.github_installations', 'INSERT,UPDATE,DELETE'), 'authenticated cannot write installations directly');
select ok(not has_table_privilege('authenticated', 'public.github_repositories', 'INSERT,UPDATE,DELETE'), 'authenticated cannot write repositories directly');
select ok(not has_table_privilege('authenticated', 'public.github_collection_runs', 'INSERT,UPDATE,DELETE'), 'authenticated cannot write collection runs directly');
select ok(not has_table_privilege('authenticated', 'public.github_observations', 'INSERT,UPDATE,DELETE'), 'authenticated cannot rewrite observation history');
select ok(not has_table_privilege('authenticated', 'public.github_webhook_deliveries', 'INSERT,UPDATE,DELETE'), 'authenticated cannot forge webhook deliveries');
select ok(not has_table_privilege('authenticated', 'public.github_oauth_states', 'INSERT,UPDATE,DELETE'), 'authenticated cannot forge or consume OAuth replay state');

select ok(not has_column_privilege('service_role', 'public.github_installations', 'provider_installation_id', 'INSERT'), 'service boundary cannot bypass the transactional installation claim');
select ok(not has_column_privilege('service_role', 'public.github_repositories', 'provider_repository_id', 'INSERT'), 'service boundary cannot bypass transactional repository reconciliation');
select ok(not has_column_privilege('service_role', 'public.github_repositories', 'selected', 'UPDATE'), 'service boundary cannot bypass operator repository selection');
select ok(has_column_privilege('service_role', 'public.github_collection_runs', 'status', 'UPDATE'), 'service boundary may finalise collection runs');
select ok(has_column_privilege('service_role', 'public.github_observations', 'observation_key', 'INSERT'), 'service boundary may append observations');
select ok(not has_table_privilege('service_role', 'public.github_observations', 'UPDATE'), 'service boundary cannot update observation history');
select ok(has_column_privilege('service_role', 'public.github_webhook_deliveries', 'provider_delivery_id', 'INSERT'), 'service boundary may reserve verified webhook deliveries');
select ok(not has_column_privilege('service_role', 'public.github_webhook_deliveries', 'organisation_id', 'INSERT'), 'webhook intake cannot assert a resolved tenant directly');
select ok(not has_column_privilege('service_role', 'public.github_webhook_deliveries', 'installation_id', 'INSERT'), 'webhook intake cannot assert a resolved installation directly');
select ok(not has_column_privilege('service_role', 'public.github_webhook_deliveries', 'repository_id', 'INSERT'), 'webhook intake cannot assert a resolved repository directly');
select ok(not has_column_privilege('service_role', 'public.github_webhook_deliveries', 'attempt_count', 'UPDATE'), 'service boundary cannot forge webhook recovery attempts directly');
select ok(not has_column_privilege('service_role', 'public.github_webhook_deliveries', 'diagnostic_code', 'UPDATE'), 'service boundary cannot forge webhook outcomes directly');
select ok(has_column_privilege('service_role', 'public.github_oauth_states', 'state_hash', 'INSERT'), 'service boundary may reserve a hashed OAuth nonce');
select ok(not has_column_privilege('service_role', 'public.github_oauth_states', 'consumed_at', 'UPDATE'), 'service boundary cannot reset or directly consume OAuth state');
select ok(not has_table_privilege('service_role', 'public.github_oauth_states', 'DELETE'), 'service boundary cannot erase OAuth replay history');
select ok(not has_table_privilege('service_role', 'public.github_installations', 'DELETE'), 'service boundary cannot delete installations');
select ok(not has_table_privilege('service_role', 'public.github_repositories', 'DELETE'), 'service boundary cannot delete repositories');
select ok(not has_table_privilege('service_role', 'public.github_collection_runs', 'DELETE'), 'service boundary cannot delete collection runs');
select ok(not has_table_privilege('service_role', 'public.github_observations', 'DELETE'), 'service boundary cannot delete observations');
select ok(not has_table_privilege('service_role', 'public.github_webhook_deliveries', 'DELETE'), 'service boundary cannot delete webhook deliveries');
select hasnt_column('public', 'github_oauth_states', 'state', 'OAuth state is never stored in plaintext');
select hasnt_column('public', 'github_oauth_states', 'pkce_verifier', 'the PKCE verifier remains only in the integrity-protected flow cookie');

select has_function('public', 'set_github_repository_selected', array['uuid', 'boolean'], 'operator repository selection RPC exists');
select has_function(
  'public', 'claim_github_installation_server',
  array['uuid', 'uuid', 'bigint', 'bigint', 'text', 'text', 'text', 'jsonb', 'boolean', 'jsonb'],
  'transactional GitHub installation claim RPC exists'
);
select has_function(
  'public', 'consume_github_oauth_state_server', array['text', 'uuid', 'uuid', 'bigint'],
  'consume-once OAuth state RPC exists'
);
select has_function('public', 'claim_github_webhook_deliveries_server', array['integer'], 'bounded webhook recovery claim RPC exists');
select has_function('public', 'finalize_github_webhook_delivery_server', array['uuid', 'integer', 'text', 'text'], 'webhook attempt CAS finalizer exists');
select ok(has_function_privilege('authenticated', 'public.set_github_repository_selected(uuid,boolean)', 'EXECUTE'), 'authenticated may invoke the operator-checked selection RPC');
select ok(not has_function_privilege('anon', 'public.set_github_repository_selected(uuid,boolean)', 'EXECUTE'), 'anonymous callers cannot invoke repository selection');
select ok(not has_function_privilege('service_role', 'public.set_github_repository_selected(uuid,boolean)', 'EXECUTE'), 'service boundary cannot impersonate an operator through repository selection');
select ok(has_function_privilege('service_role', 'public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)', 'EXECUTE'), 'only the service boundary may claim a verified installation transactionally');
select ok(not has_function_privilege('authenticated', 'public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)', 'EXECUTE'), 'authenticated cannot invoke the server installation claim');
select ok(has_function_privilege('service_role', 'public.consume_github_oauth_state_server(text,uuid,uuid,bigint)', 'EXECUTE'), 'only the service boundary may consume OAuth state');
select ok(not has_function_privilege('authenticated', 'public.consume_github_oauth_state_server(text,uuid,uuid,bigint)', 'EXECUTE'), 'authenticated cannot consume OAuth state directly');
select ok(has_function_privilege('service_role', 'public.claim_github_webhook_deliveries_server(integer)', 'EXECUTE'), 'service boundary may atomically claim bounded webhook work');
select ok(not has_function_privilege('authenticated', 'public.claim_github_webhook_deliveries_server(integer)', 'EXECUTE'), 'authenticated cannot claim webhook work');
select ok(has_function_privilege('service_role', 'public.finalize_github_webhook_delivery_server(uuid,integer,text,text)', 'EXECUTE'), 'service boundary may CAS-finalize its webhook attempt');
select ok(not has_function_privilege('authenticated', 'public.finalize_github_webhook_delivery_server(uuid,integer,text,text)', 'EXECUTE'), 'authenticated cannot finalize webhook work');
select is(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.set_github_repository_selected(uuid,boolean)'::pg_catalog.regprocedure
  ),
  true,
  'repository selection is security definer'
);
select is(
  (
    select proowner
    from pg_catalog.pg_proc
    where oid = 'public.set_github_repository_selected(uuid,boolean)'::pg_catalog.regprocedure
  ),
  'postgres'::pg_catalog.regrole::oid,
  'repository selection is owned by postgres'
);
select is(
  (
    select proconfig
    from pg_catalog.pg_proc
    where oid = 'public.set_github_repository_selected(uuid,boolean)'::pg_catalog.regprocedure
  ),
  array['search_path=""'],
  'repository selection has an empty search_path'
);
select is(
  (
    select count(*)
    from (values
      ('public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)'::pg_catalog.regprocedure),
      ('public.consume_github_oauth_state_server(text,uuid,uuid,bigint)'::pg_catalog.regprocedure),
      ('public.claim_github_webhook_deliveries_server(integer)'::pg_catalog.regprocedure),
      ('public.finalize_github_webhook_delivery_server(uuid,integer,text,text)'::pg_catalog.regprocedure)
    ) expected(function_oid)
    join pg_catalog.pg_proc function_row on function_row.oid = expected.function_oid
    where function_row.prosecdef
      and function_row.proowner = 'postgres'::pg_catalog.regrole
      and function_row.proconfig = array['search_path=""']
  ),
  4::bigint,
  'all service RPCs are postgres-owned security definers with empty search paths'
);

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('8b000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'github-owner@example.test', '', now(), '{}', '{}'),
  ('8b000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'github-admin@example.test', '', now(), '{}', '{}'),
  ('8b000000-0000-4000-8000-000000000003', '00000000-0000-0000-8000-000000000000', 'authenticated', 'authenticated', 'github-member@example.test', '', now(), '{}', '{}'),
  ('8b000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'github-outsider@example.test', '', now(), '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('app.github_org', public.create_organisation_with_owner('GitHub Collection', 'github-collection')::text, true);
insert into public.memberships(organisation_id, user_id, role) values
  (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000002', 'admin'),
  (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000003', 'member');
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select set_config('app.github_other_org', public.create_organisation_with_owner('GitHub Other', 'github-other')::text, true);

reset role;
insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login, account_type,
  repository_selection, status, connected_by, permissions, permissions_ok
) values
  ('8b000000-0000-4000-8000-000000000101', current_setting('app.github_org')::uuid, 81001, 82001, 'Example-Co', 'Organization', 'selected', 'active', '8b000000-0000-4000-8000-000000000001', '{"contents":"read"}', true),
  ('8b000000-0000-4000-8000-000000000102', current_setting('app.github_org')::uuid, 81002, 82002, 'Example-Co-2', 'Organization', 'selected', 'active', '8b000000-0000-4000-8000-000000000001', '{"contents":"read"}', true),
  ('8b000000-0000-4000-8000-000000000103', current_setting('app.github_other_org')::uuid, 81003, 82003, 'Other-Co', 'Organization', 'selected', 'active', '8b000000-0000-4000-8000-000000000004', '{"contents":"read"}', true);
insert into public.github_repositories(
  id, organisation_id, installation_id, provider_repository_id, owner_login, name,
  full_name, html_url, visibility, default_branch, archived, selected
) values
  ('8b000000-0000-4000-8000-000000000201', current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000101', 83001, 'Example-Co', 'alpha', 'Example-Co/alpha', 'https://github.com/Example-Co/alpha', 'private', 'main', false, false),
  ('8b000000-0000-4000-8000-000000000202', current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000101', 83002, 'Example-Co', 'beta', 'Example-Co/beta', 'https://github.com/Example-Co/beta', 'private', 'main', false, false),
  ('8b000000-0000-4000-8000-000000000203', current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000102', 83003, 'Example-Co-2', 'gamma', 'Example-Co-2/gamma', 'https://github.com/Example-Co-2/gamma', 'private', 'main', false, true),
  ('8b000000-0000-4000-8000-000000000204', current_setting('app.github_other_org')::uuid, '8b000000-0000-4000-8000-000000000103', 83004, 'Other-Co', 'delta', 'Other-Co/delta', 'https://github.com/Other-Co/delta', 'private', 'main', false, false);

set local role service_role;
insert into public.github_oauth_states(
  organisation_id, actor_id, pending_provider_installation_id, state_hash, expires_at
) values (
  current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000001',
  81001, repeat('f', 64), now() + interval '10 minutes'
);
insert into public.github_oauth_states(
  organisation_id, actor_id, pending_provider_installation_id, state_hash,
  created_at, expires_at
) values (
  current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000001',
  81001, repeat('e', 64), now() - interval '11 minutes', now() - interval '1 minute'
);
reset role;
insert into public.github_collection_runs(
  id, organisation_id, installation_id, repository_id, trigger_type, request_key, status
) values (
  '8b000000-0000-4000-8000-000000000301', current_setting('app.github_org')::uuid,
  '8b000000-0000-4000-8000-000000000101', '8b000000-0000-4000-8000-000000000201',
  'scheduled', '2026-08-17T05:29:00Z', 'running'
);
insert into public.github_observations(
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  collection_run_id, observation_key, check_id, rule_version, subject_type, subject_id,
  result, severity, title, explanation, remediation, observed_at, fresh_until,
  source_url, fingerprint, diagnostic_code
) values (
  '8b000000-0000-4000-8000-000000000401', current_setting('app.github_org')::uuid,
  '8b000000-0000-4000-8000-000000000101', '8b000000-0000-4000-8000-000000000201', 83001,
  '8b000000-0000-4000-8000-000000000301', 'Example-Co/alpha/visibility/github-repository-v1',
  'visibility', 'github-repository-v1', 'github_repository', 'github:repository:83001',
  'pass', null, 'Repository visibility is restricted', 'The repository is private.', null,
  '2026-08-17T05:30:00Z', '2026-08-18T17:30:00Z', 'https://github.com/Example-Co/alpha',
  repeat('a', 64), null
);
insert into public.github_webhook_deliveries(
  id, organisation_id, installation_id, repository_id, provider_installation_id,
  provider_repository_id, provider_delivery_id,
  event_name, payload_sha256, status, received_at
) values (
  '8b000000-0000-4000-8000-000000000501', current_setting('app.github_org')::uuid,
  '8b000000-0000-4000-8000-000000000101', '8b000000-0000-4000-8000-000000000201',
  81001, 83001, '123e4567-e89b-12d3-a456-426614174000', 'repository', repeat('b', 64), 'queued', now() - interval '1 hour'
);
set local role service_role;
select lives_ok(
  $$ insert into public.github_webhook_deliveries(
       provider_delivery_id, event_name, payload_sha256, status, processed_at
     ) values (
       '123e4567-e89b-12d3-a456-426614174001', 'unsupported_event',
       repeat('9', 64), 'ignored', now()
     ) $$,
  'a signed unsupported event is durably ignored before local tenant resolution'
);
reset role;
select throws_ok(
  $$ insert into public.github_webhook_deliveries(
       organisation_id, installation_id, provider_delivery_id, event_name,
       payload_sha256, status, processed_at
     ) values (
       current_setting('app.github_org')::uuid,
       '8b000000-0000-4000-8000-000000000101',
       '123e4567-e89b-12d3-a456-426614174005', 'unsupported_event',
       repeat('5', 64), 'ignored', now()
     ) $$,
  '23514', null,
  'a provider-less ignored webhook cannot retain local tenant or installation ids'
);
insert into public.github_webhook_deliveries(
  id, organisation_id, installation_id, repository_id, provider_installation_id,
  provider_repository_id, provider_delivery_id, event_name, payload_sha256,
  status, attempt_count, received_at, last_attempted_at
) values (
  '8b000000-0000-4000-8000-000000000502', current_setting('app.github_org')::uuid,
  '8b000000-0000-4000-8000-000000000101', '8b000000-0000-4000-8000-000000000201',
  81001, 83001, '123e4567-e89b-12d3-a456-426614174002', 'repository', repeat('8', 64),
  'processing', 9, now() - interval '30 minutes', now() - interval '16 minutes'
);

select is(
  (select attempt_count from public.github_webhook_deliveries where id = '8b000000-0000-4000-8000-000000000501'),
  0,
  'a verified webhook starts queued with no processing attempts'
);
set local role service_role;
select is(
  (select count(*)::int from public.claim_github_webhook_deliveries_server(1)),
  1,
  'the service boundary atomically claims one queued webhook'
);
select is(
  (select status || ':' || attempt_count::text from public.github_webhook_deliveries where id = '8b000000-0000-4000-8000-000000000501'),
  'processing:1',
  'a claimed webhook records its bounded recovery attempt'
);
select is(
  public.finalize_github_webhook_delivery_server(
    '8b000000-0000-4000-8000-000000000501', 1, 'failed', 'provider_unavailable'
  ),
  true,
  'the current webhook attempt finalizes with only an allowlisted diagnostic code'
);
select is(
  (select attempt_count from public.claim_github_webhook_deliveries_server(1) where id = '8b000000-0000-4000-8000-000000000501'),
  2,
  'a failed webhook can be claimed for a later bounded recovery attempt'
);
select is(
  public.finalize_github_webhook_delivery_server(
    '8b000000-0000-4000-8000-000000000501', 1, 'processed', null
  ),
  false,
  'a stale webhook attempt cannot finalize after a retry claim'
);
select is(
  public.finalize_github_webhook_delivery_server(
    '8b000000-0000-4000-8000-000000000501', 2, 'processed', null
  ),
  true,
  'the current webhook retry attempt can finalize once'
);
select is(
  (select attempt_count from public.claim_github_webhook_deliveries_server(1) where id = '8b000000-0000-4000-8000-000000000502'),
  10,
  'a stale processing webhook is reclaimed with a bounded final attempt'
);
select is(
  public.finalize_github_webhook_delivery_server(
    '8b000000-0000-4000-8000-000000000502', 10, 'failed', 'internal_error'
  ),
  true,
  'the bounded final webhook attempt records a safe failure'
);
select is(
  (select count(*)::int from public.claim_github_webhook_deliveries_server(100)),
  0,
  'a webhook at the attempt cap is never reclaimed'
);
select throws_ok(
  $$ select public.finalize_github_webhook_delivery_server(
       '8b000000-0000-4000-8000-000000000501', 1, null, null
     ) $$,
  '22023', 'invalid webhook delivery outcome', 'a NULL webhook outcome is rejected before mutation'
);
select throws_ok(
  $$ select public.finalize_github_webhook_delivery_server(
       '8b000000-0000-4000-8000-000000000501', 1, 'failed', null
     ) $$,
  '22023', 'invalid webhook delivery outcome', 'a failed webhook outcome requires a safe diagnostic code'
);
insert into public.github_webhook_deliveries(
  provider_installation_id, provider_repository_id, provider_delivery_id,
  event_name, payload_sha256
) values (
  81002, 83003, '123e4567-e89b-12d3-a456-426614174003',
  'repository', repeat('7', 64)
);
select is(
  (select repository_id from public.claim_github_webhook_deliveries_server(1)),
  '8b000000-0000-4000-8000-000000000203'::uuid,
  'webhook claim resolves only an active permission-verified selected available repository'
);
select is(
  public.finalize_github_webhook_delivery_server(
    (select id from public.github_webhook_deliveries where provider_delivery_id = '123e4567-e89b-12d3-a456-426614174003'),
    1, 'processed', null
  ),
  true,
  'the resolved provider webhook finalizes through its current attempt'
);
reset role;
update public.github_repositories
set available = false, removed_at = now()
where id = '8b000000-0000-4000-8000-000000000203';
set local role service_role;
insert into public.github_webhook_deliveries(
  provider_installation_id, provider_repository_id, provider_delivery_id,
  event_name, payload_sha256
) values (
  81002, 83003, '123e4567-e89b-12d3-a456-426614174004',
  'repository', repeat('6', 64)
);
select is(
  (select installation_id from public.claim_github_webhook_deliveries_server(1)),
  '8b000000-0000-4000-8000-000000000102'::uuid,
  'webhook claim resolves an active permission-verified installation'
);
select is(
  (select repository_id from public.github_webhook_deliveries where provider_delivery_id = '123e4567-e89b-12d3-a456-426614174004'),
  null::uuid,
  'webhook claim never maps an unavailable repository into a collection target'
);
select is(
  public.finalize_github_webhook_delivery_server(
    (select id from public.github_webhook_deliveries where provider_delivery_id = '123e4567-e89b-12d3-a456-426614174004'),
    1, 'processed', null
  ),
  true,
  'an installation-scoped webhook without a collection target still finalizes safely'
);
reset role;
update public.github_repositories
set available = true, removed_at = null, selected = false
where id = '8b000000-0000-4000-8000-000000000203';
set local role service_role;
select throws_ok(
  $$ update public.github_webhook_deliveries
     set status = 'queued', attempt_count = 0, last_attempted_at = null,
         processed_at = null, diagnostic_code = null
     where id = '8b000000-0000-4000-8000-000000000501' $$,
  '42501', null, 'the service boundary cannot bypass webhook lifecycle CAS functions'
);
select throws_ok(
  $$ insert into public.github_webhook_deliveries(provider_installation_id, provider_delivery_id, event_name, payload_sha256)
     values (81001, '123e4567-e89b-12d3-a456-426614174000', 'repository', repeat('c', 64)) $$,
  '23505', null, 'provider webhook delivery identifiers are replay-safe and unique'
);

reset role;
select throws_ok(
  $$ insert into public.github_repositories(organisation_id, installation_id, provider_repository_id, owner_login, name, full_name, html_url, visibility, default_branch)
     values (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000103', 83901, 'Other-Co', 'wrong', 'Other-Co/wrong', 'https://github.com/Other-Co/wrong', 'private', 'main') $$,
  '23503', null, 'a repository cannot cross an installation tenant boundary'
);
select throws_ok(
  $$ insert into public.github_collection_runs(organisation_id, installation_id, repository_id, trigger_type, request_key)
     values (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000102', '8b000000-0000-4000-8000-000000000201', 'scheduled', 'wrong-installation') $$,
  '23503', null, 'a run cannot attach a repository from another installation in the same tenant'
);
select throws_ok(
  $$ insert into public.github_observations(organisation_id, installation_id, repository_id, provider_repository_id, collection_run_id, observation_key, check_id, rule_version, subject_type, subject_id, result, title, explanation, observed_at, fresh_until, source_url, fingerprint)
     values (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000101', '8b000000-0000-4000-8000-000000000202', 83002, '8b000000-0000-4000-8000-000000000301', 'mismatched-run', 'visibility', 'github-repository-v1', 'github_repository', 'github:repository:83002', 'pass', 'Mismatch', 'Mismatch', now(), now() + interval '36 hours', 'https://github.com/Example-Co/beta', repeat('c', 64)) $$,
  '23503', null, 'an observation cannot attach a different repository to an existing run'
);
select throws_ok(
  $$ insert into public.github_collection_runs(organisation_id, installation_id, repository_id, trigger_type, request_key)
     values (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000101', '8b000000-0000-4000-8000-000000000201', 'scheduled', '2026-08-17T05:29:00Z') $$,
  '23505', null, 'one request key reserves only one run per repository'
);
select lives_ok(
  $$ insert into public.github_collection_runs(organisation_id, installation_id, repository_id, trigger_type, request_key)
     values (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000101', '8b000000-0000-4000-8000-000000000202', 'scheduled', '2026-08-17T05:29:00Z') $$,
  'the same scheduled request may reserve a run for another repository'
);
select throws_ok(
  $$ insert into public.github_observations(organisation_id, installation_id, repository_id, provider_repository_id, collection_run_id, observation_key, check_id, rule_version, subject_type, subject_id, result, title, explanation, observed_at, fresh_until, source_url, fingerprint)
     values (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000101', '8b000000-0000-4000-8000-000000000201', 83001, '8b000000-0000-4000-8000-000000000301', 'Example-Co/alpha/visibility/github-repository-v1', 'duplicate', 'github-repository-v1', 'github_repository', 'github:repository:83001', 'pass', 'Duplicate', 'Duplicate', now(), now() + interval '36 hours', 'https://github.com/Example-Co/alpha', repeat('d', 64)) $$,
  '23505', null, 'an observation key is unique within a collection run'
);
select throws_ok(
  $$ update public.github_observations set explanation = 'rewritten' where id = '8b000000-0000-4000-8000-000000000401' $$,
  'P0001', 'GitHub observations are append-only', 'observation history cannot be updated even by a privileged SQL caller'
);
select throws_ok(
  $$ delete from public.github_observations where id = '8b000000-0000-4000-8000-000000000401' $$,
  'P0001', 'GitHub observations are append-only', 'observation history cannot be deleted even by a privileged SQL caller'
);
select throws_ok(
  $$ update public.github_installations
     set organisation_id = current_setting('app.github_other_org')::uuid
     where id = '8b000000-0000-4000-8000-000000000101' $$,
  'P0001', 'GitHub installation ownership is immutable', 'a verified provider installation cannot be reassigned to another tenant'
);

set local role service_role;
select is(
  public.consume_github_oauth_state_server(
    repeat('e', 64), current_setting('app.github_org')::uuid,
    '8b000000-0000-4000-8000-000000000001', 81001
  ),
  false,
  'an expired OAuth state hash cannot be consumed'
);
select is(
  public.consume_github_oauth_state_server(
    repeat('f', 64), current_setting('app.github_other_org')::uuid,
    '8b000000-0000-4000-8000-000000000001', 81001
  ),
  false,
  'OAuth state consumption rejects a mismatched workspace'
);
select is(
  public.consume_github_oauth_state_server(
    repeat('f', 64), current_setting('app.github_org')::uuid,
    '8b000000-0000-4000-8000-000000000002', 81001
  ),
  false,
  'OAuth state consumption rejects a mismatched actor'
);
select is(
  public.consume_github_oauth_state_server(
    repeat('f', 64), current_setting('app.github_org')::uuid,
    '8b000000-0000-4000-8000-000000000001', 81002
  ),
  false,
  'OAuth state consumption rejects a mismatched pending installation'
);
select is(
  public.consume_github_oauth_state_server(
    repeat('f', 64), current_setting('app.github_org')::uuid,
    '8b000000-0000-4000-8000-000000000001', 81001
  ),
  true,
  'the service boundary atomically consumes a fresh OAuth state hash once'
);
select is(
  public.consume_github_oauth_state_server(
    repeat('f', 64), current_setting('app.github_org')::uuid,
    '8b000000-0000-4000-8000-000000000001', 81001
  ),
  false,
  'a copied OAuth cookie cannot replay an already consumed state hash'
);
select set_config(
  'app.claimed_installation_id',
  public.claim_github_installation_server(
    current_setting('app.github_org')::uuid,
    '8b000000-0000-4000-8000-000000000001',
    81100, 82100, 'Claimed-Co', 'Organization', 'selected',
    '{"contents":"read","metadata":"read"}'::jsonb, true,
    '[{"id":83100,"owner":"Claimed-Co","name":"claimed","fullName":"Claimed-Co/claimed","htmlUrl":"https://github.com/Claimed-Co/claimed","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
  )::text,
  true
);
select is(
  (select count(*)::int from public.github_repositories where installation_id = current_setting('app.claimed_installation_id')::uuid and available),
  1,
  'a verified claim atomically creates its canonical repository inventory'
);
select throws_ok(
  $$ select public.claim_github_installation_server(
       current_setting('app.github_other_org')::uuid,
       '8b000000-0000-4000-8000-000000000004',
       81100, 82100, 'Claimed-Co', 'Organization', 'selected',
       '{"contents":"read"}'::jsonb, true, '[]'::jsonb
     ) $$,
  '42501', 'GitHub installation is already claimed by another workspace',
  'provider installation advisory locking and ownership reject cross-tenant takeover'
);
select throws_ok(
  $$ select public.claim_github_installation_server(
       current_setting('app.github_org')::uuid,
       '8b000000-0000-4000-8000-000000000003',
       81101, 82101, 'Member-Co', 'Organization', 'selected',
       '{"contents":"read"}'::jsonb, true, '[]'::jsonb
     ) $$,
  '42501', 'GitHub installation claim requires a current workspace operator',
  'the service claim rechecks the actor after callback before writing'
);

reset role;
update public.github_repositories
set selected = true
where installation_id = current_setting('app.claimed_installation_id')::uuid;
set local role service_role;
select lives_ok(
  $$ select public.claim_github_installation_server(
       current_setting('app.github_org')::uuid,
       '8b000000-0000-4000-8000-000000000001',
       81100, 82100, 'Claimed-Co', 'Organization', 'selected',
       '{"contents":"read","metadata":"read"}'::jsonb, true, '[]'::jsonb
     ) $$,
  'a reconnect atomically reconciles an omitted repository without deleting history'
);
select is(
  (select available from public.github_repositories where installation_id = current_setting('app.claimed_installation_id')::uuid),
  false,
  'an omitted repository becomes unavailable to the collector'
);
select is(
  (select selected from public.github_repositories where installation_id = current_setting('app.claimed_installation_id')::uuid),
  true,
  'repository availability changes preserve the operator selection flag'
);
reset role;
select is(
  (select actor_id from public.audit_events where entity_type = 'github_installations' and entity_id = current_setting('app.claimed_installation_id') order by id limit 1),
  '8b000000-0000-4000-8000-000000000001'::uuid,
  'transaction-local claims attribute installation inventory audit to the verified actor'
);
select is(
  (
    select actor_id from public.audit_events
    where entity_type = 'github_repositories'
      and entity_id = (
        select id::text from public.github_repositories
        where installation_id = current_setting('app.claimed_installation_id')::uuid
      )
    order by id limit 1
  ),
  '8b000000-0000-4000-8000-000000000001'::uuid,
  'transaction-local claims attribute reconciled repository audit to the verified actor'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(id)::int from public.github_installations where organisation_id = current_setting('app.github_org')::uuid), 3, 'an Owner sees safe installation summaries in their workspace');
select is((select count(id)::int from public.github_repositories where organisation_id = current_setting('app.github_org')::uuid), 4, 'an Owner sees safe repository summaries in their workspace');
select is((select count(id)::int from public.github_collection_runs where organisation_id = current_setting('app.github_org')::uuid), 2, 'an Owner sees safe run summaries in their workspace');
select is((select count(id)::int from public.github_observations where organisation_id = current_setting('app.github_org')::uuid), 1, 'an Owner sees safe observation summaries in their workspace');
select is((select count(*)::int from public.github_repository_shadow_summaries where organisation_id = current_setting('app.github_org')::uuid), 4, 'an Owner gets one bounded latest-run summary per repository');
select is((select latest_status::text from public.github_repository_shadow_summaries where repository_id = '8b000000-0000-4000-8000-000000000201'), 'running', 'the bounded repository summary exposes the latest safe run status');
select is((select available from public.github_repository_shadow_summaries where installation_id = current_setting('app.claimed_installation_id')::uuid), false, 'the bounded repository summary exposes preserved unavailable inventory');
select is((select count(id)::int from public.github_installations where organisation_id = current_setting('app.github_other_org')::uuid), 0, 'an Owner cannot read another workspace installation');
select throws_ok(
  $$ insert into public.github_installations(organisation_id, provider_installation_id, account_id, account_login, account_type, repository_selection) values (current_setting('app.github_org')::uuid, 89901, 89901, 'Forged', 'Organization', 'selected') $$,
  '42501', null, 'an Owner cannot directly insert an installation'
);
select throws_ok(
  $$ update public.github_repositories set selected = true where id = '8b000000-0000-4000-8000-000000000201' $$,
  '42501', null, 'an Owner cannot directly update repository selection'
);
select throws_ok(
  $$ delete from public.github_observations where id = '8b000000-0000-4000-8000-000000000401' $$,
  '42501', null, 'an Owner cannot delete observation history'
);
select lives_ok(
  $$ select public.set_github_repository_selected('8b000000-0000-4000-8000-000000000201', true) $$,
  'an Owner may select a repository through the checked RPC'
);
select is((select selected from public.github_repositories where id = '8b000000-0000-4000-8000-000000000201'), true, 'Owner repository selection is persisted');

select set_config('request.jwt.claims', '{"sub":"8b000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(id)::int from public.github_repositories where organisation_id = current_setting('app.github_org')::uuid), 4, 'an Admin sees safe repository summaries in their workspace');
select throws_ok(
  $$ insert into public.github_collection_runs(organisation_id, installation_id, repository_id, trigger_type, request_key) values (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000101', '8b000000-0000-4000-8000-000000000201', 'manual', 'forged-admin') $$,
  '42501', null, 'an Admin cannot directly insert a collection run'
);
select throws_ok(
  $$ update public.github_repositories set selected = false where id = '8b000000-0000-4000-8000-000000000201' $$,
  '42501', null, 'an Admin cannot directly update repository selection'
);
select throws_ok(
  $$ delete from public.github_repositories where id = '8b000000-0000-4000-8000-000000000201' $$,
  '42501', null, 'an Admin cannot directly delete a repository'
);
select lives_ok(
  $$ select public.set_github_repository_selected('8b000000-0000-4000-8000-000000000201', false) $$,
  'an Admin may deselect a repository through the checked RPC'
);

select set_config('request.jwt.claims', '{"sub":"8b000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(id)::int from public.github_observations where organisation_id = current_setting('app.github_org')::uuid), 1, 'a Member sees safe observation summaries in their workspace');
select throws_ok(
  $$ insert into public.github_observations(organisation_id, installation_id, repository_id, provider_repository_id, collection_run_id, observation_key, check_id, rule_version, subject_type, subject_id, result, title, explanation, observed_at, fresh_until, source_url, fingerprint) values (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000101', '8b000000-0000-4000-8000-000000000201', 83001, '8b000000-0000-4000-8000-000000000301', 'forged-member', 'forged', 'github-repository-v1', 'github_repository', 'github:repository:83001', 'pass', 'Forged', 'Forged', now(), now() + interval '36 hours', 'https://github.com/Example-Co/alpha', repeat('e', 64)) $$,
  '42501', null, 'a Member cannot directly insert an observation'
);
select throws_ok(
  $$ update public.github_repositories set selected = true where id = '8b000000-0000-4000-8000-000000000201' $$,
  '42501', null, 'a Member cannot directly update a repository'
);
select throws_ok(
  $$ delete from public.github_collection_runs where id = '8b000000-0000-4000-8000-000000000301' $$,
  '42501', null, 'a Member cannot directly delete a run'
);
select throws_ok(
  $$ select public.set_github_repository_selected('8b000000-0000-4000-8000-000000000201', true) $$,
  '42501', 'repository selection requires a workspace operator', 'a Member cannot select a repository through the RPC'
);

select set_config('request.jwt.claims', '{"sub":"8b000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(id)::int from public.github_installations where organisation_id = current_setting('app.github_org')::uuid), 0, 'a cross-tenant Owner cannot read installations');
select is((select count(id)::int from public.github_repositories where organisation_id = current_setting('app.github_org')::uuid), 0, 'a cross-tenant Owner cannot read repositories');
select is((select count(id)::int from public.github_collection_runs where organisation_id = current_setting('app.github_org')::uuid), 0, 'a cross-tenant Owner cannot read collection runs');
select is((select count(id)::int from public.github_observations where organisation_id = current_setting('app.github_org')::uuid), 0, 'a cross-tenant Owner cannot read observations');
select is((select count(*)::int from public.github_repository_shadow_summaries where organisation_id = current_setting('app.github_org')::uuid), 0, 'a cross-tenant Owner cannot read repository shadow summaries');
select throws_ok(
  $$ insert into public.github_webhook_deliveries(organisation_id, installation_id, provider_delivery_id, event_name, payload_sha256) values (current_setting('app.github_org')::uuid, '8b000000-0000-4000-8000-000000000101', 'forged-outsider', 'repository', repeat('f', 64)) $$,
  '42501', null, 'a cross-tenant Owner cannot insert a webhook delivery'
);
select throws_ok(
  $$ update public.github_repositories set selected = true where id = '8b000000-0000-4000-8000-000000000201' $$,
  '42501', null, 'a cross-tenant Owner cannot update a repository'
);
select throws_ok(
  $$ delete from public.github_installations where id = '8b000000-0000-4000-8000-000000000101' $$,
  '42501', null, 'a cross-tenant Owner cannot delete an installation'
);
select throws_ok(
  $$ select public.set_github_repository_selected('8b000000-0000-4000-8000-000000000201', true) $$,
  '42501', 'repository selection requires a workspace operator', 'a cross-tenant Owner cannot select a repository through the RPC'
);

reset role;
insert into public.github_repositories(
  organisation_id, installation_id, provider_repository_id, owner_login, name,
  full_name, html_url, visibility, default_branch, selected
)
select
  current_setting('app.github_org')::uuid,
  '8b000000-0000-4000-8000-000000000101',
  84000 + generated.repository_number,
  'Example-Co',
  'selected-' || generated.repository_number,
  'Example-Co/selected-' || generated.repository_number,
  'https://github.com/Example-Co/selected-' || generated.repository_number,
  'private',
  'main',
  true
from pg_catalog.generate_series(1, 100) as generated(repository_number);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8b000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_github_repository_selected('8b000000-0000-4000-8000-000000000201', true) $$,
  '23514', 'a GitHub installation may select at most 100 repositories', 'the false-to-true repository cap is enforced atomically per installation'
);
select lives_ok(
  $$ select public.set_github_repository_selected('8b000000-0000-4000-8000-000000000203', true) $$,
  'a second installation may select independently when the first installation is at its cap'
);
select is(
  (select count(*)::int from public.github_repositories where installation_id = '8b000000-0000-4000-8000-000000000102' and selected),
  1,
  'repository selection capacity is isolated per installation'
);
select throws_ok(
  $$ select public.set_github_repository_selected(
       (select id from public.github_repositories where installation_id = current_setting('app.claimed_installation_id')::uuid),
       true
     ) $$,
  '23514', 'an unavailable GitHub repository cannot be selected', 'an unavailable repository cannot become a collection target'
);

reset role;
select cmp_ok(
  (select count(*) from public.audit_events where organisation_id = current_setting('app.github_org')::uuid and entity_type = 'github_installations'),
  '>=', 2::bigint,
  'mutable installation inventory writes are audited'
);
select cmp_ok(
  (select count(*) from public.audit_events where organisation_id = current_setting('app.github_org')::uuid and entity_type = 'github_repositories' and action = 'update'),
  '>=', 2::bigint,
  'operator repository-selection changes are audited'
);
select is(
  (
    select actor_id
    from public.audit_events
    where entity_type = 'github_repositories'
      and entity_id = '8b000000-0000-4000-8000-000000000201'
      and action = 'update'
    order by id desc
    limit 1
  ),
  '8b000000-0000-4000-8000-000000000002'::uuid,
  'repository selection audit retains the Admin operator actor'
);
select is(
  (select count(*) from public.audit_events where organisation_id = current_setting('app.github_org')::uuid and entity_type = 'github_observations'),
  0::bigint,
  'immutable high-volume observations do not emit generic audit rows'
);

select * from finish();
rollback;
