begin;
select no_plan();

select has_table(
  'public', 'github_connection_reconciliation_runs',
  'GitHub connection reconciliation has a durable run ledger'
);
select has_view(
  'public', 'github_connection_health_summaries',
  'operators have one safe connection-health projection'
);
select hasnt_column(
  'public', 'github_connection_health_summaries', 'reconciliation_locked_by',
  'the safe health projection excludes worker lease identity'
);
select hasnt_column(
  'public', 'github_connection_health_summaries', 'reconciliation_locked_until',
  'the safe health projection excludes worker lease timing'
);
select has_column('public', 'github_installations', 'health', 'installations have an independent connection health');
select has_column('public', 'github_installations', 'last_reconciliation_attempt_at', 'installations record the latest attempt');
select has_column('public', 'github_installations', 'last_successful_reconciliation_at', 'installations preserve latest successful freshness');
select has_column('public', 'github_installations', 'consecutive_reconciliation_failures', 'installations record consecutive failures');
select has_column('public', 'github_installations', 'next_reconciliation_at', 'installations record their next due time');
select has_column('public', 'github_installations', 'health_diagnostic_code', 'installations expose a safe diagnostic');
select has_column('public', 'github_installations', 'reconciliation_locked_by', 'installations carry finite lease ownership');
select has_column('public', 'github_installations', 'reconciliation_locked_until', 'installations carry a finite lease expiry');
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.github_connection_reconciliation_runs'::regclass
      and conname = 'github_connection_reconciliation_runs_installation_tenant_fk'
      and contype = 'f'
  ),
  'a reconciliation run binds its installation and workspace ancestry'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.github_connection_reconciliation_runs'::regclass
      and conname = 'github_connection_reconciliation_runs_id_full_ancestry_key'
      and contype = 'u'
  ),
  'a reconciliation run exposes an exact full-ancestry key'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_attribute
    where attrelid = 'public.github_connection_reconciliation_runs'::regclass
      and not attisdropped
      and (
        attname in ('payload', 'raw_body', 'raw_payload', 'provider_payload', 'response_body')
        or attname like '%token%'
      )
  ),
  0::bigint,
  'the reconciliation ledger stores no provider bodies or tokens'
);

select has_function(
  'public', 'claim_due_github_connection_reconciliations_server',
  array['uuid', 'integer', 'timestamp with time zone']
);
select has_function(
  'public', 'finalize_github_connection_reconciliation_server',
  array['uuid', 'uuid', 'text', 'text', 'timestamp with time zone', 'jsonb']
);
select has_function('public', 'disconnect_github_installation', array['uuid']);
select ok(has_function_privilege(
  'service_role',
  'public.claim_due_github_connection_reconciliations_server(uuid,integer,timestamptz)',
  'EXECUTE'
), 'service workers may claim due reconciliation runs');
select ok(not has_function_privilege(
  'authenticated',
  'public.claim_due_github_connection_reconciliations_server(uuid,integer,timestamptz)',
  'EXECUTE'
), 'authenticated users cannot claim reconciliation work');
select ok(has_function_privilege(
  'service_role',
  'public.finalize_github_connection_reconciliation_server(uuid,uuid,text,text,timestamptz,jsonb)',
  'EXECUTE'
), 'service workers may CAS-finalize reconciliation runs');
select ok(not has_function_privilege(
  'authenticated',
  'public.finalize_github_connection_reconciliation_server(uuid,uuid,text,text,timestamptz,jsonb)',
  'EXECUTE'
), 'authenticated users cannot finalize reconciliation work');
select ok(has_function_privilege(
  'authenticated', 'public.disconnect_github_installation(uuid)', 'EXECUTE'
), 'authenticated Owners may invoke the checked local disconnect command');
select ok(not has_function_privilege(
  'service_role', 'public.disconnect_github_installation(uuid)', 'EXECUTE'
), 'the service boundary cannot impersonate an Owner disconnect');
select is(
  (
    select count(*)
    from (values
      ('public.claim_due_github_connection_reconciliations_server(uuid,integer,timestamptz)'::regprocedure),
      ('public.finalize_github_connection_reconciliation_server(uuid,uuid,text,text,timestamptz,jsonb)'::regprocedure),
      ('public.disconnect_github_installation(uuid)'::regprocedure)
    ) expected(function_oid)
    join pg_catalog.pg_proc function_row on function_row.oid = expected.function_oid
    where function_row.prosecdef
      and function_row.proowner = 'postgres'::regrole
      and function_row.proconfig = array['search_path=""']
  ),
  3::bigint,
  'all reconciliation RPCs are postgres-owned security definers with empty search paths'
);
select ok(
  lower(pg_get_functiondef(
    'public.claim_due_github_connection_reconciliations_server(uuid,integer,timestamptz)'::regprocedure
  )) like '%for update skip locked%',
  'the bounded claim skips rows already locked by another worker'
);

select ok(not has_column_privilege(
  'authenticated', 'public.github_installations', 'health', 'SELECT'
), 'the base installation table does not expose connection health to every member');
select ok(not has_column_privilege(
  'authenticated', 'public.github_installations', 'last_successful_reconciliation_at', 'SELECT'
), 'the base installation table does not expose reconciliation freshness to every member');
select ok(not has_column_privilege(
  'authenticated', 'public.github_installations', 'reconciliation_locked_by', 'SELECT'
), 'authenticated clients cannot inspect worker lease identity');
select is(
  (
    select count(*)
    from information_schema.column_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = 'github_installations'
      and privilege.grantee = 'authenticated'
      and privilege.privilege_type = 'SELECT'
      and privilege.column_name in (
        'health', 'last_reconciliation_attempt_at',
        'last_successful_reconciliation_at',
        'consecutive_reconciliation_failures', 'next_reconciliation_at',
        'health_diagnostic_code', 'reconciliation_locked_by',
        'reconciliation_locked_until'
      )
  ),
  0::bigint,
  'none of the new health or lease columns are granted to every authenticated member'
);
select ok(has_column_privilege(
  'authenticated', 'public.github_connection_reconciliation_runs', 'status', 'SELECT'
), 'operators may read safe reconciliation outcomes');
select ok(not has_column_privilege(
  'authenticated', 'public.github_connection_reconciliation_runs', 'request_key', 'SELECT'
), 'authenticated clients cannot inspect opaque request keys');
select ok(not has_table_privilege(
  'authenticated', 'public.github_connection_reconciliation_runs', 'INSERT,UPDATE,DELETE'
), 'authenticated clients cannot forge reconciliation history');
select ok(not has_table_privilege(
  'service_role', 'public.github_connection_reconciliation_runs', 'INSERT,UPDATE,DELETE'
), 'service workers cannot bypass claim and finalization functions');

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('a3000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reconcile-owner@example.test', '', now(), '{}', '{}'),
  ('a3000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reconcile-admin@example.test', '', now(), '{}', '{}'),
  ('a3000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reconcile-member@example.test', '', now(), '{}', '{}'),
  ('a3000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'reconcile-outsider@example.test', '', now(), '{}', '{}');
insert into public.organisations(id, name, slug, created_by) values
  ('a3100000-0000-4000-8000-000000000001', 'Reconciliation Workspace', 'reconciliation-workspace', 'a3000000-0000-4000-8000-000000000001'),
  ('a3100000-0000-4000-8000-000000000002', 'Other Reconciliation Workspace', 'other-reconciliation-workspace', 'a3000000-0000-4000-8000-000000000004');
insert into public.memberships(organisation_id, user_id, role) values
  ('a3100000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'owner'),
  ('a3100000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'admin'),
  ('a3100000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'member'),
  ('a3100000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000004', 'owner');

insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status, connected_by, permissions, permissions_ok,
  next_reconciliation_at
) values
  ('a3200000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 930001, 940001, 'Reconcile-Co', 'Organization', 'selected', 'active', 'a3000000-0000-4000-8000-000000000001', '{"metadata":"read"}', true, now() - interval '1 minute'),
  ('a3200000-0000-4000-8000-000000000002', 'a3100000-0000-4000-8000-000000000001', 930002, 940002, 'Reconcile-Co-2', 'Organization', 'selected', 'active', 'a3000000-0000-4000-8000-000000000001', '{"metadata":"read"}', true, now() - interval '1 minute'),
  ('a3200000-0000-4000-8000-000000000003', 'a3100000-0000-4000-8000-000000000001', 930003, 940003, 'Reconcile-Co-3', 'Organization', 'selected', 'active', 'a3000000-0000-4000-8000-000000000001', '{"metadata":"read"}', true, now() + interval '1 day');
insert into public.github_repositories(
  id, organisation_id, installation_id, provider_repository_id, owner_login,
  name, full_name, html_url, visibility, default_branch, selected
) values
  ('a3300000-0000-4000-8000-000000000001', 'a3100000-0000-4000-8000-000000000001', 'a3200000-0000-4000-8000-000000000001', 950001, 'Reconcile-Co', 'alpha', 'Reconcile-Co/alpha', 'https://github.com/Reconcile-Co/alpha', 'private', 'main', true),
  ('a3300000-0000-4000-8000-000000000002', 'a3100000-0000-4000-8000-000000000001', 'a3200000-0000-4000-8000-000000000001', 950002, 'Reconcile-Co', 'beta', 'Reconcile-Co/beta', 'https://github.com/Reconcile-Co/beta', 'private', 'main', true),
  ('a3300000-0000-4000-8000-000000000003', 'a3100000-0000-4000-8000-000000000001', 'a3200000-0000-4000-8000-000000000002', 950003, 'Reconcile-Co-2', 'gamma', 'Reconcile-Co-2/gamma', 'https://github.com/Reconcile-Co-2/gamma', 'private', 'main', true),
  ('a3300000-0000-4000-8000-000000000004', 'a3100000-0000-4000-8000-000000000001', 'a3200000-0000-4000-8000-000000000003', 950005, 'Reconcile-Co-3', 'delta', 'Reconcile-Co-3/delta', 'https://github.com/Reconcile-Co-3/delta', 'private', 'main', true);

create temporary table reconciliation_compliance_counts as
select
  (select count(*) from public.evidence) as evidence_count,
  (select count(*) from public.tasks) as task_count,
  (select count(*) from public.monitoring_findings) as finding_count,
  (select count(*) from public.automation_signals) as signal_count,
  (select count(*) from public.automation_proposals) as proposal_count;

set local role service_role;
select throws_ok(
  $$ select * from public.claim_due_github_connection_reconciliations_server(
       'a3400000-0000-4000-8000-000000000001', 0, now()
     ) $$,
  '22023', 'reconciliation claim limit must be between 1 and 100',
  'a reconciliation claim cannot be unbounded at the lower edge'
);
select throws_ok(
  $$ select * from public.claim_due_github_connection_reconciliations_server(
       'a3400000-0000-4000-8000-000000000001', 101, now()
     ) $$,
  '22023', 'reconciliation claim limit must be between 1 and 100',
  'a reconciliation claim cannot be unbounded at the upper edge'
);
select set_config('app.reconciliation_now', now()::text, true);
select is(
  (select count(*)::integer from public.claim_due_github_connection_reconciliations_server(
    'a3400000-0000-4000-8000-000000000001', 2,
    current_setting('app.reconciliation_now')::timestamptz
  )),
  2,
  'one claim leases no more than its requested bound'
);
reset role;
select is(
  (select count(*)::integer from public.github_connection_reconciliation_runs),
  2,
  'each due installation receives one durable run'
);
select is(
  (select count(distinct request_key)::integer from public.github_connection_reconciliation_runs),
  2,
  'each installation occurrence has one opaque idempotency key'
);
select ok(
  (select bool_and(reconciliation_locked_until = current_setting('app.reconciliation_now')::timestamptz + interval '5 minutes') from public.github_installations),
  'claims use a finite five-minute lease'
);
select set_config(
  'app.first_run_id',
  (select id::text from public.github_connection_reconciliation_runs where installation_id = 'a3200000-0000-4000-8000-000000000001'),
  true
);
select set_config(
  'app.second_run_id',
  (select id::text from public.github_connection_reconciliation_runs where installation_id = 'a3200000-0000-4000-8000-000000000002'),
  true
);

update public.github_installations
set reconciliation_locked_until = current_setting('app.reconciliation_now')::timestamptz - interval '1 second'
where id = 'a3200000-0000-4000-8000-000000000001';
set local role service_role;
select is(
  (select id from public.claim_due_github_connection_reconciliations_server(
    'a3400000-0000-4000-8000-000000000002', 1,
    current_setting('app.reconciliation_now')::timestamptz
  )),
  current_setting('app.first_run_id')::uuid,
  'a stale lease recovers its existing idempotent run instead of duplicating it'
);
reset role;
select is(
  (select attempt_count from public.github_connection_reconciliation_runs where id = current_setting('app.first_run_id')::uuid),
  2,
  'stale-lease recovery records a bounded second attempt'
);
select is(
  (select count(*)::integer from public.github_connection_reconciliation_runs),
  2,
  'stale-lease recovery preserves one row per request key'
);

set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    current_setting('app.first_run_id')::uuid,
    'a3400000-0000-4000-8000-000000000099',
    'success', null, now() + interval '1 day', '[]'::jsonb
  ),
  'not_finalized',
  'a worker that does not own the lease cannot finalize the run'
);
reset role;
select is(
  (select status from public.github_connection_reconciliation_runs where id = current_setting('app.first_run_id')::uuid),
  'running',
  'a failed compare-and-set leaves the run untouched'
);

set local role service_role;
select throws_ok(
  $$ select public.finalize_github_connection_reconciliation_server(
       current_setting('app.first_run_id')::uuid,
       'a3400000-0000-4000-8000-000000000002',
       'success', null, now() + interval '1 day', null::jsonb
     ) $$,
  '22023', 'invalid connection reconciliation outcome',
  'a missing provider snapshot cannot make unavailable data healthy'
);
reset role;

set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    current_setting('app.first_run_id')::uuid,
    'a3400000-0000-4000-8000-000000000002',
    'success', null, now() + interval '1 day',
    '[{"id":950001,"owner":"Reconcile-Co","name":"alpha-renamed","fullName":"Reconcile-Co/alpha-renamed","htmlUrl":"https://github.com/Reconcile-Co/alpha-renamed","visibility":"private","archived":false,"defaultBranch":"trunk"},{"id":950004,"owner":"Reconcile-Co","name":"new","fullName":"Reconcile-Co/new","htmlUrl":"https://github.com/Reconcile-Co/new","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
  ),
  'none',
  'a lease owner atomically finalizes a successful provider snapshot'
);
reset role;
select is(
  (select health::text from public.github_installations where id = 'a3200000-0000-4000-8000-000000000001'),
  'healthy',
  'successful verification makes the connection healthy'
);
select is(
  (select consecutive_reconciliation_failures from public.github_installations where id = 'a3200000-0000-4000-8000-000000000001'),
  0,
  'successful verification resets the consecutive failure count'
);
select ok(
  (select last_successful_reconciliation_at is not null and reconciliation_locked_by is null from public.github_installations where id = 'a3200000-0000-4000-8000-000000000001'),
  'successful finalization records freshness and releases the lease'
);
select is(
  (select full_name from public.github_repositories where id = 'a3300000-0000-4000-8000-000000000001'),
  'Reconcile-Co/alpha-renamed',
  'the canonical provider snapshot refreshes safe repository metadata'
);
select is(
  (select available from public.github_repositories where id = 'a3300000-0000-4000-8000-000000000002'),
  false,
  'an omitted repository becomes unavailable without deleting its history'
);
select is(
  (select selected from public.github_repositories where id = 'a3300000-0000-4000-8000-000000000002'),
  true,
  'provider scope loss preserves the Owner selection history'
);
select is(
  (select count(*)::integer from public.github_repositories where installation_id = 'a3200000-0000-4000-8000-000000000001'),
  3,
  'snapshot reconciliation preserves removed rows and adds newly authorised rows'
);
set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    current_setting('app.first_run_id')::uuid,
    'a3400000-0000-4000-8000-000000000002',
    'success', null, now() + interval '1 day', '[]'::jsonb
  ),
  'none',
  'replaying an already-finalized request key returns its saved transition harmlessly'
);

reset role;
update public.github_installations
set consecutive_reconciliation_failures = 2
where id = 'a3200000-0000-4000-8000-000000000002';
set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    current_setting('app.second_run_id')::uuid,
    'a3400000-0000-4000-8000-000000000001',
    'temporary_failure', 'internal_failure', now() + interval '2 minutes', '[]'::jsonb
  ),
  'opened',
  'the third consecutive temporary failure opens one safe incident transition'
);
reset role;
select is(
  (select next_reconciliation_at from public.github_installations where id = 'a3200000-0000-4000-8000-000000000002'),
  (select last_attempted_at + interval '15 minutes' from public.github_connection_reconciliation_runs where id = current_setting('app.second_run_id')::uuid),
  'the database cannot shorten the fixed third-failure retry delay'
);
set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    current_setting('app.second_run_id')::uuid,
    'a3400000-0000-4000-8000-000000000001',
    'temporary_failure', 'internal_failure', now() + interval '2 minutes', '[]'::jsonb
  ),
  'opened',
  'a replay returns the same incident transition instead of changing state twice'
);

reset role;
update public.github_installations
set next_reconciliation_at = now() - interval '2 seconds'
where id = 'a3200000-0000-4000-8000-000000000002';
set local role service_role;
select set_config(
  'app.third_run_id',
  (select id::text from public.claim_due_github_connection_reconciliations_server(
    'a3400000-0000-4000-8000-000000000003', 1, now()
  )),
  true
);
select is(
  public.finalize_github_connection_reconciliation_server(
    current_setting('app.third_run_id')::uuid,
    'a3400000-0000-4000-8000-000000000003',
    'temporary_failure', 'provider_rate_limited', now() + interval '30 minutes', '[]'::jsonb
  ),
  'remained_open',
  'a later temporary failure keeps the existing incident open'
);
reset role;
select cmp_ok(
  (select next_reconciliation_at from public.github_installations where id = 'a3200000-0000-4000-8000-000000000002'),
  '>=', now() + interval '29 minutes',
  'a later provider rate-limit time wins over the fixed retry delay'
);

update public.github_installations
set next_reconciliation_at = now() - interval '1 second'
where id = 'a3200000-0000-4000-8000-000000000002';
set local role service_role;
select set_config(
  'app.fourth_run_id',
  (select id::text from public.claim_due_github_connection_reconciliations_server(
    'a3400000-0000-4000-8000-000000000004', 1, now()
  )),
  true
);
select is(
  public.finalize_github_connection_reconciliation_server(
    current_setting('app.fourth_run_id')::uuid,
    'a3400000-0000-4000-8000-000000000004',
    'success', null, now() + interval '1 day',
    '[{"id":950003,"owner":"Reconcile-Co-2","name":"gamma","fullName":"Reconcile-Co-2/gamma","htmlUrl":"https://github.com/Reconcile-Co-2/gamma","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
  ),
  'recovered',
  'a later successful verification records deterministic incident recovery'
);

reset role;
update public.github_installations
set health = 'partially_unavailable',
    consecutive_reconciliation_failures = 1,
    health_diagnostic_code = 'repository_unavailable',
    next_reconciliation_at = now() - interval '4 seconds'
where id = 'a3200000-0000-4000-8000-000000000003';
set local role service_role;
select set_config(
  'app.fifth_run_id',
  (select id::text from public.claim_due_github_connection_reconciliations_server(
    'a3400000-0000-4000-8000-000000000006', 1, now()
  )),
  true
);
select is(
  public.finalize_github_connection_reconciliation_server(
    current_setting('app.fifth_run_id')::uuid,
    'a3400000-0000-4000-8000-000000000006',
    'temporary_failure', 'provider_temporary_failure',
    now() + interval '1 minute', '[]'::jsonb
  ),
  'remained_open',
  'a still-unavailable retry cannot recover an incident opened by serious scope loss'
);

reset role;
select throws_ok(
  $$ insert into public.github_connection_reconciliation_runs(
       organisation_id, installation_id, trigger, request_key
     ) values (
       'a3100000-0000-4000-8000-000000000002',
       'a3200000-0000-4000-8000-000000000001', 'webhook', 'cross-workspace'
     ) $$,
  '23503', null,
  'a reconciliation run cannot cross its installation workspace ancestry'
);
select throws_ok(
  $$ insert into public.github_connection_reconciliation_runs(
       organisation_id, installation_id, trigger, request_key
     ) select organisation_id, installation_id, 'scheduled', request_key
       from public.github_connection_reconciliation_runs
       where id = current_setting('app.first_run_id')::uuid $$,
  '23505', null,
  'one request key is idempotent for an installation'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_connection_health_summaries), 3, 'an Owner sees safe workspace connection health');
select is((select count(id)::integer from public.github_installations), 3, 'an Owner retains existing safe installation identity reads');
select is((select count(*)::integer from public.github_repositories), 5, 'an Owner sees safe workspace repository scope');
select is((select count(*)::integer from public.github_connection_reconciliation_runs), 5, 'an Owner sees safe reconciliation history');

select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_connection_health_summaries), 3, 'an Admin sees safe workspace connection health');
select is((select count(*)::integer from public.github_connection_reconciliation_runs), 5, 'an Admin sees safe reconciliation history');
select throws_ok(
  $$ select public.disconnect_github_installation('a3200000-0000-4000-8000-000000000001') $$,
  '42501', 'GitHub disconnect requires a current workspace Owner',
  'an Admin cannot disconnect GitHub'
);

select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_connection_health_summaries), 0, 'a Member cannot read connection health');
select is((select count(id)::integer from public.github_installations), 3, 'Member denial does not silently change older non-health installation reads');
select is((select count(id)::integer from public.github_repositories), 5, 'Member denial does not silently change older Monitoring repository reads');
select is((select count(*)::integer from public.github_connection_reconciliation_runs), 0, 'a Member cannot read reconciliation history');
select throws_ok(
  $$ select public.disconnect_github_installation('a3200000-0000-4000-8000-000000000001') $$,
  '42501', 'GitHub disconnect requires a current workspace Owner',
  'a Member cannot disconnect GitHub'
);

select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_connection_health_summaries), 0, 'a cross-workspace Owner cannot read another workspace connection health');
select throws_ok(
  $$ select public.disconnect_github_installation('a3200000-0000-4000-8000-000000000001') $$,
  '42501', 'GitHub disconnect requires a current workspace Owner',
  'a cross-workspace Owner cannot disconnect another workspace installation'
);

reset role;
select set_config(
  'app.installation_audit_before_disconnect',
  (select count(*)::text from public.audit_events where entity_type = 'github_installations' and entity_id = 'a3200000-0000-4000-8000-000000000001'),
  true
);
select set_config(
  'app.repository_rows_before_disconnect',
  (select count(*)::text from public.github_repositories where installation_id = 'a3200000-0000-4000-8000-000000000001'),
  true
);
select set_config(
  'app.run_rows_before_disconnect',
  (select count(*)::text from public.github_connection_reconciliation_runs where installation_id = 'a3200000-0000-4000-8000-000000000001'),
  true
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.disconnect_github_installation('a3200000-0000-4000-8000-000000000001'), true, 'an Owner disconnects only the local lifecycle state');
select is(public.disconnect_github_installation('a3200000-0000-4000-8000-000000000001'), false, 'a repeated local disconnect is harmless');

reset role;
select is((select health::text from public.github_installations where id = 'a3200000-0000-4000-8000-000000000001'), 'disconnected', 'local disconnect has an explicit connection state');
select ok((select next_reconciliation_at is null and reconciliation_locked_by is null and reconciliation_locked_until is null from public.github_installations where id = 'a3200000-0000-4000-8000-000000000001'), 'disconnect stops future lease claims');
select ok((select bool_and(not available and not selected) from public.github_repositories where installation_id = 'a3200000-0000-4000-8000-000000000001'), 'disconnect makes every repository unavailable and unselected');
select is((select count(*)::text from public.github_repositories where installation_id = 'a3200000-0000-4000-8000-000000000001'), current_setting('app.repository_rows_before_disconnect'), 'disconnect preserves all repository history');
select is((select count(*)::text from public.github_connection_reconciliation_runs where installation_id = 'a3200000-0000-4000-8000-000000000001'), current_setting('app.run_rows_before_disconnect'), 'disconnect preserves all reconciliation history');
select is(
  (select count(*)::integer from public.audit_events where entity_type = 'github_installations' and entity_id = 'a3200000-0000-4000-8000-000000000001'),
  current_setting('app.installation_audit_before_disconnect')::integer + 1,
  'the first local disconnect is audited once and its replay emits no second installation audit'
);
update public.github_installations
set next_reconciliation_at = now() - interval '3 seconds',
    reconciliation_locked_by = null,
    reconciliation_locked_until = null
where id = 'a3200000-0000-4000-8000-000000000002';
set local role service_role;
select is(
  (select count(*)::integer from public.claim_due_github_connection_reconciliations_server(
    'a3400000-0000-4000-8000-000000000005', 100, now()
  ) where installation_id = 'a3200000-0000-4000-8000-000000000001'),
  0,
  'a disconnected installation is never claimed again'
);

select is(
  public.claim_github_installation_server(
    'a3100000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    930001, 940001, 'Reconcile-Co', 'Organization', 'selected',
    '{"metadata":"read"}'::jsonb, true,
    '[{"id":950001,"owner":"Reconcile-Co","name":"alpha-renamed","fullName":"Reconcile-Co/alpha-renamed","htmlUrl":"https://github.com/Reconcile-Co/alpha-renamed","visibility":"private","archived":false,"defaultBranch":"trunk"}]'::jsonb
  ),
  'a3200000-0000-4000-8000-000000000001'::uuid,
  'the existing verified Owner claim remains the deliberate local reconnect path'
);
reset role;
select ok(
  (select health = 'retrying' and next_reconciliation_at is not null
   from public.github_installations
   where id = 'a3200000-0000-4000-8000-000000000001'),
  'a deliberate reconnect becomes due for verification without being called healthy by discovery'
);

select is(
  (select row(
    (select count(*) from public.evidence),
    (select count(*) from public.tasks),
    (select count(*) from public.monitoring_findings),
    (select count(*) from public.automation_signals),
    (select count(*) from public.automation_proposals)
  )::text),
  (select row(evidence_count, task_count, finding_count, signal_count, proposal_count)::text from reconciliation_compliance_counts),
  'connection reconciliation and disconnect create no compliance, Monitoring, Task, or Automation records'
);

select * from finish();
rollback;
