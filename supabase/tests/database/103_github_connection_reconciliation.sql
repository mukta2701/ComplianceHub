create extension if not exists dblink with schema extensions;

begin;
set local session_replication_role = replica;
delete from public.github_webhook_deliveries where provider_delivery_id in ('conn-exclusivity-1', 'mon-exclusivity-1');
delete from public.audit_events where organisation_id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.github_connection_reconciliation_runs where organisation_id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.github_installations where organisation_id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.memberships where organisation_id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.asset_categories where organisation_id in ('78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102');
delete from public.risk_categories where organisation_id in ('78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102');
delete from public.organisations where id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.profiles where id::text like '78000000-0000-0000-0000-00000000000%';
delete from auth.users where id::text like '78000000-0000-0000-0000-00000000000%';
commit;
select no_plan();

select has_table('public', 'github_connection_reconciliation_runs', 'connection reconciliation has a durable run ledger');
select has_column('public', 'github_installations', 'health', 'installations carry connection health');
select has_column('public', 'github_installations', 'next_reconciliation_at', 'installations carry the next reconciliation time');
select has_column('public', 'github_installations', 'reconciliation_locked_until', 'installations carry the reconciliation lease');
select ok(
  (select pg_catalog.count(*) from pg_catalog.pg_constraint
   where conrelid = 'public.github_connection_reconciliation_runs'::pg_catalog.regclass
     and conname = 'github_connection_runs_installation_request_key') = 1::bigint,
  'reconciliation request keys are idempotent per installation'
);
select ok(
  (select pg_catalog.count(*) from pg_catalog.pg_constraint
   where conrelid = 'public.github_connection_reconciliation_runs'::pg_catalog.regclass
     and contype = 'f'
     and pg_catalog.pg_get_constraintdef(oid) like '%(installation_id, organisation_id)%') = 1::bigint,
  'reconciliation runs keep composite installation ancestry'
);
select ok(
  has_function_privilege('service_role','public.claim_due_github_connection_reconciliations_server(uuid,integer,timestamptz)','EXECUTE'),
  'service boundary may claim due reconciliations'
);
select ok(
  has_function_privilege('service_role','public.finalize_github_connection_reconciliation_server(uuid,uuid,text,text,timestamptz,jsonb)','EXECUTE'),
  'service boundary may finalise reconciliations'
);
select ok(
  not has_function_privilege('authenticated','public.claim_due_github_connection_reconciliations_server(uuid,integer,timestamptz)','EXECUTE'),
  'authenticated callers cannot claim reconciliations directly'
);
select ok(
  not has_function_privilege('authenticated','public.finalize_github_connection_reconciliation_server(uuid,uuid,text,text,timestamptz,jsonb)','EXECUTE'),
  'authenticated callers cannot finalise reconciliations directly'
);
select ok(
  not has_function_privilege('anon','public.claim_due_github_connection_reconciliations_server(uuid,integer,timestamptz)','EXECUTE'),
  'anonymous callers cannot claim reconciliations'
);
select ok(
  has_function_privilege('authenticated','public.disconnect_github_installation(uuid)','EXECUTE'),
  'authenticated Owners may disconnect through the lifecycle command'
);
select ok(
  not has_function_privilege('service_role','public.disconnect_github_installation(uuid)','EXECUTE'),
  'service boundary cannot use the Owner lifecycle command'
);
select ok(has_column_privilege('authenticated', 'public.github_installations', 'health', 'SELECT'), 'authenticated may read connection health');
select ok(has_column_privilege('authenticated', 'public.github_installations', 'health_diagnostic_code', 'SELECT'), 'authenticated may read the health diagnostic');
select ok(has_column_privilege('authenticated', 'public.github_installations', 'next_reconciliation_at', 'SELECT'), 'authenticated may read the next reconciliation time');
select ok(not has_column_privilege('authenticated', 'public.github_installations', 'reconciliation_locked_by', 'SELECT'), 'authenticated cannot read reconciliation lease ownership');
select ok(not has_column_privilege('authenticated', 'public.github_installations', 'reconciliation_locked_until', 'SELECT'), 'authenticated cannot read reconciliation lease expiry');
select ok(has_column_privilege('authenticated', 'public.github_connection_reconciliation_runs', 'status', 'SELECT'), 'authenticated may read reconciliation run status');
select ok(not has_column_privilege('authenticated', 'public.github_connection_reconciliation_runs', 'request_key', 'SELECT'), 'authenticated cannot read reconciliation idempotency keys');
select ok(not has_column_privilege('authenticated', 'public.github_connection_reconciliation_runs', 'locked_by', 'SELECT'), 'authenticated cannot read run lease ownership');
select ok(
  pg_catalog.pg_get_functiondef('public.finalize_github_connection_reconciliation_server(uuid,uuid,text,text,timestamptz,jsonb)'::pg_catalog.regprocedure)
    !~* 'monitoring_findings|evidence|tasks|readiness',
  'reconciliation finalisation writes no compliance records'
);
select ok(
  pg_catalog.pg_get_functiondef('public.disconnect_github_installation(uuid)'::pg_catalog.regprocedure)
    !~* 'monitoring_findings|evidence|tasks|readiness',
  'disconnection writes no compliance records'
);

begin;
insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) values
 ('78000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reconcile-owner@example.test','',now(),'{}','{}'),
 ('78000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reconcile-admin@example.test','',now(),'{}','{}'),
 ('78000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reconcile-member@example.test','',now(),'{}','{}'),
 ('78000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','reconcile-other-owner@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
 ('78000000-0000-0000-0000-000000000101','Reconcile Boundary A','reconcile-boundary-a','78000000-0000-0000-0000-000000000001'),
 ('78000000-0000-0000-0000-000000000102','Reconcile Boundary B','reconcile-boundary-b','78000000-0000-0000-0000-000000000004');
insert into public.memberships(organisation_id,user_id,role) values
 ('78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000001','owner'),
 ('78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000002','admin'),
 ('78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000003','member'),
 ('78000000-0000-0000-0000-000000000102','78000000-0000-0000-0000-000000000004','owner');
insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status
) values
 ('78000000-0000-0000-0000-000000000201','78000000-0000-0000-0000-000000000101',78101,78201,'Owner-Co','Organization','selected','active'),
 ('78000000-0000-0000-0000-000000000202','78000000-0000-0000-0000-000000000101',78102,78202,'Owner-Co','Organization','selected','active'),
 ('78000000-0000-0000-0000-000000000203','78000000-0000-0000-0000-000000000101',78103,78203,'Owner-Co','Organization','selected','active');
commit;

set role service_role;
select throws_ok(
  $$ select public.claim_due_github_connection_reconciliations_server(null, 10, now()) $$,
  '22023', null, 'a claim without a worker is rejected'
);
select throws_ok(
  $$ select public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000901', 0, now()) $$,
  '22023', null, 'a claim without a positive limit is rejected'
);
select throws_ok(
  $$ select public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000901', 101, now()) $$,
  '22023', null, 'a claim beyond the worker bound is rejected'
);
select is(
  (select pg_catalog.count(*) from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000901', 10, now())),
  3::bigint,
  'a worker claims every due installation once'
);
select is(
  (select pg_catalog.count(*) from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000902', 10, now())),
  0::bigint,
  'a second worker finds no live lease to steal'
);
select is(
  (select pg_catalog.count(*) from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000901', 10, now())),
  0::bigint,
  'a repeated claim in the same minute opens no duplicate work'
);
reset role;
update public.github_installations
set reconciliation_locked_until = now() - interval '1 minute'
where id = '78000000-0000-0000-0000-000000000201';
set role service_role;
select is(
  (select pg_catalog.count(*) from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000902', 10, now())),
  0::bigint,
  'an expired lease reuses the minute request key instead of duplicating work'
);
select is(
  (select pg_catalog.count(*) from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000902', 10, now() + interval '6 minutes')),
  3::bigint,
  'expired leases become claimable again with fresh minute keys'
);
reset role;

select is(
  (select status from public.github_connection_reconciliation_runs
   where installation_id = '78000000-0000-0000-0000-000000000201'
   order by started_at desc limit 1),
  'running',
  'the opened run waits for its worker'
);
select set_config('test.runb', (select id::text from public.github_connection_reconciliation_runs where installation_id='78000000-0000-0000-0000-000000000201' order by started_at desc limit 1), false);
set role service_role;
select throws_ok(
  $$ select public.finalize_github_connection_reconciliation_server(
       current_setting('test.runb')::uuid,
       '78000000-0000-0000-0000-000000000999', 'success', null, null,
       '[{"id":7810101,"owner":"Owner-Co","name":"kept-one","fullName":"Owner-Co/kept-one","htmlUrl":"https://github.com/Owner-Co/kept-one","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
     ) $$,
  '22023', 'connection reconciliation lease mismatch',
  'finalisation by another worker is rejected'
);
reset role;
set role service_role;
select throws_ok(
  $$ select public.finalize_github_connection_reconciliation_server(
       current_setting('test.runb')::uuid,
       '78000000-0000-0000-0000-000000000902', 'success', null, null, null
     ) $$,
  '22023', 'invalid connection reconciliation finalisation',
  'a success without a repository snapshot is rejected'
);
reset role;
set role service_role;
select throws_ok(
  $$ select public.finalize_github_connection_reconciliation_server(
       current_setting('test.runb')::uuid,
       '78000000-0000-0000-0000-000000000902', 'success', null, null,
       '[{"id":7810101,"owner":"Owner-Co","name":"kept-one","fullName":"Owner-Co/kept-one","htmlUrl":"https://github.com/Owner-Co/kept-one","visibility":"private","archived":false,"defaultBranch":"main"},{"id":7810101,"owner":"Owner-Co","name":"kept-one","fullName":"Owner-Co/kept-one","htmlUrl":"https://github.com/Owner-Co/kept-one","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
     ) $$,
  '22023', 'connection repository snapshot contains duplicate provider ids',
  'a snapshot with duplicate provider ids is rejected'
);
reset role;
set role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    current_setting('test.runb')::uuid,
    '78000000-0000-0000-0000-000000000902', 'success', null, null,
    '[{"id":7810101,"owner":"Owner-Co","name":"kept-one","fullName":"Owner-Co/kept-one","htmlUrl":"https://github.com/Owner-Co/kept-one","visibility":"private","archived":false,"defaultBranch":"main"},{"id":7810102,"owner":"Owner-Co","name":"kept-two","fullName":"Owner-Co/kept-two","htmlUrl":"https://github.com/Owner-Co/kept-two","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
  ),
  'none',
  'a first success reports no incident transition'
);
reset role;
select is(
  (select health from public.github_installations where id='78000000-0000-0000-0000-000000000201'),
  'healthy',
  'a successful reconciliation keeps the installation healthy'
);
select is(
  (select pg_catalog.count(*) from public.github_repositories where installation_id='78000000-0000-0000-0000-000000000201' and available),
  2::bigint,
  'a successful snapshot stores the available inventory'
);
set role service_role;
select throws_ok(
  $$ select public.finalize_github_connection_reconciliation_server(
       current_setting('test.runb')::uuid,
       '78000000-0000-0000-0000-000000000901', 'success', null, null,
       '[{"id":7810101,"owner":"Owner-Co","name":"kept-one","fullName":"Owner-Co/kept-one","htmlUrl":"https://github.com/Owner-Co/kept-one","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
     ) $$,
  '22023', 'connection reconciliation lease mismatch',
  'a terminal run cannot be finalised twice'
);
reset role;
update public.github_installations
set reconciliation_locked_until = now() - interval '1 minute'
where id = '78000000-0000-0000-0000-000000000201';
set role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    (select id from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000901', 10, date_trunc('minute', now()) + interval '7 minutes') where installation_id='78000000-0000-0000-0000-000000000201' limit 1),
    '78000000-0000-0000-0000-000000000901', 'temporary_failure', 'provider_temporary_failure', now() + interval '5 minutes', null
  ),
  'none',
  'a first temporary failure stays quiet'
);
reset role;
select is(
  (select health from public.github_installations where id='78000000-0000-0000-0000-000000000201'),
  'retrying',
  'a temporary failure moves the installation to retrying'
);
select is(
  (select consecutive_reconciliation_failures from public.github_installations where id='78000000-0000-0000-0000-000000000201'),
  1,
  'a temporary failure counts consecutively'
);
update public.github_installations
set reconciliation_locked_until = now() - interval '1 minute'
where id = '78000000-0000-0000-0000-000000000201';
set role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    (select id from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000901', 10, date_trunc('minute', now()) + interval '13 minutes') where installation_id='78000000-0000-0000-0000-000000000201' limit 1),
    '78000000-0000-0000-0000-000000000901', 'partial', 'repository_unavailable', null,
    '[{"id":7810101,"owner":"Owner-Co","name":"kept-one","fullName":"Owner-Co/kept-one","htmlUrl":"https://github.com/Owner-Co/kept-one","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
  ),
  'opened',
  'partial repository loss opens one incident'
);
reset role;
select is(
  (select pg_catalog.count(*) from public.monitoring_findings where organisation_id='78000000-0000-0000-0000-000000000101'),
  0::bigint,
  'partial loss writes no compliance finding'
);
select is(
  (select pg_catalog.count(*) from public.evidence where organisation_id='78000000-0000-0000-0000-000000000101'),
  0::bigint,
  'partial loss writes no evidence'
);
select is(
  (select available from public.github_repositories where installation_id='78000000-0000-0000-0000-000000000201' and provider_repository_id=7810102),
  false,
  'a repository missing from the snapshot is preserved as unavailable'
);
select is(
  (select status from public.github_connection_reconciliation_runs where installation_id='78000000-0000-0000-0000-000000000201' order by started_at desc limit 1),
  'partial',
  'the partial run reaches its terminal status'
);
select is(
  (select repositories_unavailable from public.github_connection_reconciliation_runs where installation_id='78000000-0000-0000-0000-000000000201' order by started_at desc limit 1),
  1,
  'the partial run records its unavailable count'
);
update public.github_installations
set reconciliation_locked_until = now() - interval '1 minute'
where id = '78000000-0000-0000-0000-000000000201';
set role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    (select id from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000901', 10, date_trunc('minute', now()) + interval '14 minutes') where installation_id='78000000-0000-0000-0000-000000000201' limit 1),
    '78000000-0000-0000-0000-000000000901', 'partial', 'repository_unavailable', null,
    '[{"id":7810101,"owner":"Owner-Co","name":"kept-one","fullName":"Owner-Co/kept-one","htmlUrl":"https://github.com/Owner-Co/kept-one","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
  ),
  'remained_open',
  'a repeated partial loss does not open a second incident'
);
reset role;
update public.github_installations
set reconciliation_locked_until = now() - interval '1 minute'
where id = '78000000-0000-0000-0000-000000000201';
set role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    (select id from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000901', 10, date_trunc('minute', now()) + interval '15 minutes') where installation_id='78000000-0000-0000-0000-000000000201' limit 1),
    '78000000-0000-0000-0000-000000000901', 'success', null, null,
    '[{"id":7810101,"owner":"Owner-Co","name":"kept-one","fullName":"Owner-Co/kept-one","htmlUrl":"https://github.com/Owner-Co/kept-one","visibility":"private","archived":false,"defaultBranch":"main"},{"id":7810102,"owner":"Owner-Co","name":"kept-two","fullName":"Owner-Co/kept-two","htmlUrl":"https://github.com/Owner-Co/kept-two","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
  ),
  'recovered',
  'a restored inventory closes the incident'
);
reset role;
select is(
  (select available from public.github_repositories where installation_id='78000000-0000-0000-0000-000000000201' and provider_repository_id=7810102),
  true,
  'a restored repository rejoins the available inventory'
);

begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"78000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok(
  $$ select public.disconnect_github_installation('78000000-0000-0000-0000-000000000203') $$,
  '42501', 'GitHub disconnection requires a current workspace Owner',
  'a Member cannot disconnect an installation'
);
select set_config('request.jwt.claims','{"sub":"78000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok(
  $$ select public.disconnect_github_installation('78000000-0000-0000-0000-000000000203') $$,
  '42501', 'GitHub disconnection requires a current workspace Owner',
  'an Admin cannot disconnect an installation'
);
select set_config('request.jwt.claims','{"sub":"78000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select throws_ok(
  $$ select public.disconnect_github_installation('78000000-0000-0000-0000-000000000203') $$,
  '42501', 'GitHub disconnection requires a current workspace Owner',
  'another workspace Owner cannot disconnect a foreign installation'
);
select set_config('request.jwt.claims','{"sub":"78000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select ok(
  public.disconnect_github_installation('78000000-0000-0000-0000-000000000203'),
  'a current workspace Owner may disconnect an installation'
);
select is(
  (select health from public.github_installations where id='78000000-0000-0000-0000-000000000203'),
  'disconnected',
  'disconnection marks installation health without touching provider status'
);
select is(
  (select status from public.github_installations where id='78000000-0000-0000-0000-000000000203'),
  'active',
  'disconnection does not imply provider revocation'
);
select ok(
  public.disconnect_github_installation('78000000-0000-0000-0000-000000000203'),
  'a repeated disconnect stays harmless'
);
commit;
reset role;

select set_config('test.runs203', (select pg_catalog.count(*)::text from public.github_connection_reconciliation_runs where installation_id='78000000-0000-0000-0000-000000000203'), false);
set role service_role;
select is(
  (select pg_catalog.count(*) from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000901', 10, date_trunc('minute', now()) + interval '30 minutes')),
  2::bigint,
  'only connected installations are claimed again'
);
reset role;
select is(
  (select pg_catalog.count(*)::text from public.github_connection_reconciliation_runs where installation_id='78000000-0000-0000-0000-000000000203'),
  current_setting('test.runs203'),
  'a disconnected installation is never claimed again'
);

select extensions.dblink_connect('reconcile_holder','host='||pg_catalog.host(pg_catalog.inet_server_addr())||' port='||pg_catalog.inet_server_port()::text||' dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_exec('reconcile_holder','begin');
select extensions.dblink_send_query('reconcile_holder','select 1 from public.github_installations where id=''78000000-0000-0000-0000-000000000202'' for update');
select pg_catalog.pg_sleep(0.5);
set role service_role;
set statement_timeout = '30s';
select is(
  (select pg_catalog.string_agg(claimed.installation_id::text, ',' order by claimed.installation_id)
   from public.claim_due_github_connection_reconciliations_server('78000000-0000-0000-0000-000000000903', 10, date_trunc('minute', now()) + interval '40 minutes') claimed),
  '78000000-0000-0000-0000-000000000201',
  'a claim skips a concurrently locked installation instead of blocking'
);
reset role;
reset statement_timeout;
select extensions.dblink_exec('reconcile_holder','rollback');
select extensions.dblink_disconnect('reconcile_holder');

insert into public.github_webhook_deliveries(
  provider_installation_id, provider_delivery_id, event_name, payload_sha256, status
) values
 (78101, 'conn-exclusivity-1', 'installation', repeat('a', 64), 'queued'),
 (78101, 'mon-exclusivity-1', 'workflow_run', repeat('b', 64), 'queued');
set role service_role;
select is(
  (select pg_catalog.string_agg(claimed.provider_delivery_id, ',' order by claimed.provider_delivery_id)
   from public.claim_github_webhook_deliveries_server(10) claimed),
  'mon-exclusivity-1',
  'the Monitoring claim takes only Monitoring-class deliveries'
);
select is(
  (select pg_catalog.string_agg(claimed.provider_delivery_id, ',' order by claimed.provider_delivery_id)
   from public.claim_github_connection_webhook_deliveries_server(10) claimed),
  'conn-exclusivity-1',
  'the connection claim takes only connection-class deliveries'
);
select is(
  (select event_name from public.github_webhook_deliveries where provider_delivery_id = 'conn-exclusivity-1'),
  'installation',
  'claimed connection deliveries keep their event name for routing'
);
select is(
  (select pg_catalog.count(*) from public.claim_github_webhook_deliveries_server(10)),
  0::bigint,
  'a claimed Monitoring delivery is not visible twice'
);
select is(
  (select pg_catalog.count(*) from public.claim_github_connection_webhook_deliveries_server(10)),
  0::bigint,
  'a claimed connection delivery is not visible twice'
);
reset role;
update public.github_webhook_deliveries
set status = 'failed', last_attempted_at = now() - interval '1 minute',
    processed_at = now() - interval '1 minute', diagnostic_code = 'internal_error',
    received_at = now() - interval '2 minutes'
where provider_delivery_id = 'conn-exclusivity-1';
set role service_role;
select is(
  (select pg_catalog.count(*) from public.claim_github_connection_webhook_deliveries_server(10)),
  1::bigint,
  'a failed connection delivery becomes reclaimable'
);
select is(
  public.finalize_github_webhook_delivery_server(
    (select id from public.github_webhook_deliveries where provider_delivery_id = 'conn-exclusivity-1'),
    2, 'processed', null
  ),
  true,
  'the shared finaliser completes connection deliveries'
);
select is(
  public.schedule_github_connection_reconciliation_server(78101),
  true,
  'a known installation is prompted for reconciliation'
);
select ok(
  (select next_reconciliation_at from public.github_installations where provider_installation_id = 78101) is not null,
  'the prompt records a due time on the installation'
);
select is(
  public.schedule_github_connection_reconciliation_server(999999999),
  false,
  'an unknown installation schedules nothing'
);
select throws_ok(
  $$ select public.schedule_github_connection_reconciliation_server(0) $$,
  '22023', null,
  'an invalid schedule request is rejected'
);
reset role;

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.github_webhook_deliveries where provider_delivery_id in ('conn-exclusivity-1', 'mon-exclusivity-1');
delete from public.audit_events where organisation_id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.github_connection_reconciliation_runs where organisation_id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.github_installations where organisation_id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.memberships where organisation_id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.asset_categories where organisation_id in ('78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102');
delete from public.risk_categories where organisation_id in ('78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102');
delete from public.organisations where id in (
  '78000000-0000-0000-0000-000000000101','78000000-0000-0000-0000-000000000102'
);
delete from public.profiles where id::text like '78000000-0000-0000-0000-00000000000%';
delete from auth.users where id::text like '78000000-0000-0000-0000-00000000000%';
commit;
