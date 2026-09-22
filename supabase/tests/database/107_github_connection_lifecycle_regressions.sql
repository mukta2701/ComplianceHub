begin;
set local session_replication_role = replica;
delete from public.alert_deliveries where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.alert_channels where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.github_connection_incidents where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.github_connection_reconciliation_runs where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.github_repositories where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.github_installations where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.notifications where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.audit_events where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.memberships where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.asset_categories where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.risk_categories where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.organisations where id = '92000000-0000-4000-8000-000000000101';
delete from public.profiles where id::text like '92000000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '92000000-0000-4000-8000-00000000000%';
commit;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) values
 ('92000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-owner@example.test','',now(),'{}','{}'),
 ('92000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-admin@example.test','',now(),'{}','{}');

insert into public.organisations(id,name,slug,created_by) values
 ('92000000-0000-4000-8000-000000000101','Lifecycle Test','lifecycle-test','92000000-0000-4000-8000-000000000001');

insert into public.memberships(organisation_id,user_id,role) values
 ('92000000-0000-4000-8000-000000000101','92000000-0000-4000-8000-000000000001','owner'),
 ('92000000-0000-4000-8000-000000000101','92000000-0000-4000-8000-000000000002','admin');

insert into public.alert_channels(
  id, organisation_id, type, connected_by, min_severity, enabled
) values (
  '92000000-0000-4000-8000-000000000401','92000000-0000-4000-8000-000000000101',
  'slack','92000000-0000-4000-8000-000000000001','medium',true
);

insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status, health,
  last_reconciliation_attempt_at, last_successful_reconciliation_at,
  consecutive_reconciliation_failures, next_reconciliation_at, health_diagnostic_code
) values
 ('92000000-0000-4000-8000-000000000201','92000000-0000-4000-8000-000000000101',92101,92201,'Lifecycle-Co','Organization','selected','active','owner_action_required',
  '2026-09-18 10:00:00+00','2026-09-17 10:00:00+00',3,now() - interval '1 minute','permission_mismatch'),
 ('92000000-0000-4000-8000-000000000202','92000000-0000-4000-8000-000000000101',92102,92202,'Lease-Co','Organization','selected','active','healthy',
  null,null,0,now() + interval '1 day',null);

insert into public.github_repositories(
  id, organisation_id, installation_id, provider_repository_id, owner_login,
  name, full_name, html_url, visibility, default_branch, selected, available
) values (
  '92000000-0000-4000-8000-000000000301','92000000-0000-4000-8000-000000000101',
  '92000000-0000-4000-8000-000000000201',9210101,'Lifecycle-Co','pilot',
  'Lifecycle-Co/pilot','https://github.com/Lifecycle-Co/pilot','private','main',true,true
);

select no_plan();

select ok(
  has_function_privilege('service_role','public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)','EXECUTE'),
  'the installation claim remains service-only'
);
select ok(
  not has_function_privilege('authenticated','public.finalize_github_connection_reconciliation_server(uuid,uuid,text,text,timestamptz,jsonb)','EXECUTE'),
  'authenticated callers cannot finalise reconciliations'
);

set role service_role;
select public.record_github_connection_notice_server(
  '92000000-0000-4000-8000-000000000101','92000000-0000-4000-8000-000000000201',
  'incident','permission_mismatch','Lifecycle-Co'
);
create temporary table lifecycle_initial_runs as
select id as run_id, installation_id, locked_by, locked_until
from public.claim_due_github_connection_reconciliations_server(
  '92000000-0000-4000-8000-000000000901',10,now()
);
reset role;

select is(
  (select count(*) from lifecycle_initial_runs where installation_id='92000000-0000-4000-8000-000000000201'),
  1::bigint,
  'the retryable installation has one live run before disconnection'
);

set role authenticated;
select set_config('request.jwt.claims','{"sub":"92000000-0000-4000-8000-000000000001","role":"authenticated"}',false);
select ok(
  public.disconnect_github_installation('92000000-0000-4000-8000-000000000201'),
  'the workspace Owner disconnects the pilot installation'
);
reset role;

set role service_role;
select throws_ok(
  $$ select public.finalize_github_connection_reconciliation_server(
       (select run_id from lifecycle_initial_runs where installation_id='92000000-0000-4000-8000-000000000201'),
       '92000000-0000-4000-8000-000000000901','success',null,null,
       '[{"id":9210101,"owner":"Lifecycle-Co","name":"pilot","fullName":"Lifecycle-Co/pilot","htmlUrl":"https://github.com/Lifecycle-Co/pilot","visibility":"private","archived":false,"defaultBranch":"main"},{"id":9210102,"owner":"Lifecycle-Co","name":"late-write","fullName":"Lifecycle-Co/late-write","htmlUrl":"https://github.com/Lifecycle-Co/late-write","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
     ) $$,
  '22023','connection reconciliation lease mismatch',
  'an in-flight worker cannot finalise after Owner disconnection'
);
reset role;

select is(
  (select count(*) from public.github_repositories where installation_id='92000000-0000-4000-8000-000000000201'),
  1::bigint,
  'a rejected disconnected run cannot write a repository snapshot'
);
select is(
  (select health from public.github_installations where id='92000000-0000-4000-8000-000000000201'),
  'disconnected',
  'a rejected disconnected run cannot restore healthy status'
);
select is(
  (select count(*) from public.github_connection_incidents where installation_id='92000000-0000-4000-8000-000000000201' and status='open'),
  1::bigint,
  'a rejected disconnected run leaves the existing incident open'
);
select is(
  (select count(*) from public.notifications where organisation_id='92000000-0000-4000-8000-000000000101' and kind='github_connection_recovery'),
  0::bigint,
  'a rejected disconnected run creates no recovery notification'
);

begin;
set local session_replication_role = replica;
delete from public.github_repositories
where installation_id='92000000-0000-4000-8000-000000000201' and provider_repository_id=9210102;
update public.github_installations
set health='disconnected',
    last_reconciliation_attempt_at='2026-09-18 10:00:00+00',
    last_successful_reconciliation_at='2026-09-17 10:00:00+00',
    consecutive_reconciliation_failures=3,
    next_reconciliation_at=now() + interval '1 day',
    health_diagnostic_code='permission_mismatch',
    reconciliation_locked_by='92000000-0000-4000-8000-000000000902',
    reconciliation_locked_until=clock_timestamp() + interval '10 minutes'
where id='92000000-0000-4000-8000-000000000201';
update public.github_repositories
set selected=false, available=false, removed_at='2026-09-18 10:00:00+00'
where installation_id='92000000-0000-4000-8000-000000000201';
commit;

set role service_role;
select set_config('test.lifecycle_reconnected', public.claim_github_installation_server(
  '92000000-0000-4000-8000-000000000101','92000000-0000-4000-8000-000000000001',
  92101,92201,'Lifecycle-Co','Organization','selected',
  '{"metadata":"read","administration":"read"}'::jsonb,true,
  '[{"id":9210101,"owner":"Lifecycle-Co","name":"pilot","fullName":"Lifecycle-Co/pilot","htmlUrl":"https://github.com/Lifecycle-Co/pilot","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
)::text,false);
reset role;

select is(
  (select health from public.github_installations where id='92000000-0000-4000-8000-000000000201'),
  'retrying',
  'verified OAuth reclaim schedules verification instead of claiming health'
);
select ok(
  (select next_reconciliation_at is not null and next_reconciliation_at <= clock_timestamp()
   from public.github_installations where id='92000000-0000-4000-8000-000000000201'),
  'verified reclaim is immediately due for a real provider check'
);
select is(
  (select consecutive_reconciliation_failures from public.github_installations where id='92000000-0000-4000-8000-000000000201'),
  0,
  'verified reclaim clears stale consecutive failure state'
);
select ok(
  (select health_diagnostic_code is null
      and reconciliation_locked_by is null
      and reconciliation_locked_until is null
   from public.github_installations where id='92000000-0000-4000-8000-000000000201'),
  'verified reclaim clears stale diagnostics and lease ownership'
);
select is(
  (select last_reconciliation_attempt_at from public.github_installations where id='92000000-0000-4000-8000-000000000201'),
  '2026-09-18 10:00:00+00'::timestamptz,
  'OAuth reclaim preserves the last real reconciliation attempt'
);
select is(
  (select last_successful_reconciliation_at from public.github_installations where id='92000000-0000-4000-8000-000000000201'),
  '2026-09-17 10:00:00+00'::timestamptz,
  'OAuth reclaim preserves the last verified reconciliation success'
);
select ok(
  (select available and not selected from public.github_repositories
   where installation_id='92000000-0000-4000-8000-000000000201' and provider_repository_id=9210101),
  'fresh provider inventory is available while collection remains unselected'
);
select is(
  (select count(*) from public.github_connection_incidents where installation_id='92000000-0000-4000-8000-000000000201' and status='open'),
  1::bigint,
  'OAuth reclaim does not resolve the old incident without a provider check'
);
select is(
  (select count(*) from public.notifications where organisation_id='92000000-0000-4000-8000-000000000101' and kind='github_connection_recovery'),
  0::bigint,
  'OAuth reclaim sends no premature recovery notice'
);

set role service_role;
create temporary table lifecycle_reconnect_runs as
select id as run_id, installation_id, locked_by as worker_id
from public.claim_due_github_connection_reconciliations_server(
  '92000000-0000-4000-8000-000000000903',10,date_trunc('minute',clock_timestamp()) + interval '2 minutes'
);
reset role;

select is(
  (select count(*) from lifecycle_reconnect_runs where installation_id='92000000-0000-4000-8000-000000000201'),
  1::bigint,
  'a reclaimed installation is included in the due reconciliation queue'
);

set role service_role;
create temporary table lifecycle_recovery_signal as
select public.finalize_github_connection_reconciliation_server(
  (select run_id from lifecycle_reconnect_runs where installation_id='92000000-0000-4000-8000-000000000201'),
  '92000000-0000-4000-8000-000000000903','success',null,null,
  '[{"id":9210101,"owner":"Lifecycle-Co","name":"pilot","fullName":"Lifecycle-Co/pilot","htmlUrl":"https://github.com/Lifecycle-Co/pilot","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
 ) as signal;
reset role;
select is((select signal from lifecycle_recovery_signal),'recovered','the first genuine success closes the pre-existing incident');

set role authenticated;
select ok(
  public.disconnect_github_installation('92000000-0000-4000-8000-000000000201'),
  'the Owner disconnects after the successful finalizer commits'
);
reset role;

set role service_role;
create temporary table lifecycle_stale_recovery_projection as
select public.project_github_connection_notice_server(
  '92000000-0000-4000-8000-000000000101','92000000-0000-4000-8000-000000000201',
  'recovery',null,'Lifecycle-Co','92000000-0000-4000-8000-000000000401',
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb
) as result;
reset role;
select is(
  (select count(*) from public.github_connection_incidents where installation_id='92000000-0000-4000-8000-000000000201' and status='open'),
  1::bigint,
  'a stale recovery projection after disconnection leaves the incident open'
);
select is(
  (select count(*) from public.notifications where organisation_id='92000000-0000-4000-8000-000000000101' and kind='github_connection_recovery'),
  0::bigint,
  'a stale recovery projection sends no in-app notices'
);
select is(
  (select count(*) from public.alert_deliveries where installation_id='92000000-0000-4000-8000-000000000201' and kind='github_connection_health'),
  0::bigint,
  'a stale recovery projection queues no Slack delivery'
);
select is(
  (select (result ->> 'is_new')::boolean from lifecycle_stale_recovery_projection),
  false,
  'a stale recovery projection returns the idempotent no-op result'
);
select is(
  (select (result ->> 'slack_queued')::boolean from lifecycle_stale_recovery_projection),
  false,
  'a stale recovery projection reports no queued Slack work'
);

update public.github_installations
set next_reconciliation_at=clock_timestamp() - interval '1 minute'
where id='92000000-0000-4000-8000-000000000202';
set role service_role;
create temporary table lifecycle_stale_runs as
select id as run_id, installation_id, locked_by as worker_id
from public.claim_due_github_connection_reconciliations_server(
  '92000000-0000-4000-8000-000000000904',10,clock_timestamp() + interval '30 minutes'
);
reset role;

update public.github_installations
set reconciliation_locked_until=clock_timestamp() - interval '1 second'
where id='92000000-0000-4000-8000-000000000202';
set role service_role;
select throws_ok(
  $$ select public.finalize_github_connection_reconciliation_server(
       (select run_id from lifecycle_stale_runs where installation_id='92000000-0000-4000-8000-000000000202'),
       '92000000-0000-4000-8000-000000000904','success',null,null,'[]'::jsonb
     ) $$,
  '22023','connection reconciliation lease mismatch',
  'a stale installation lease is rejected even for its original worker'
);
reset role;
select is(
  (select status from public.github_connection_reconciliation_runs
   where id=(select run_id from lifecycle_stale_runs where installation_id='92000000-0000-4000-8000-000000000202')),
  'running',
  'a rejected same-worker finalisation leaves its run uncompleted'
);
select is(
  (select health from public.github_installations where id='92000000-0000-4000-8000-000000000202'),
  'healthy',
  'a rejected same-worker finalisation leaves installation health unchanged'
);

set role service_role;
create temporary table lifecycle_stale_incident_projection as
select public.project_github_connection_notice_server(
  '92000000-0000-4000-8000-000000000101','92000000-0000-4000-8000-000000000202',
  'incident','permission_mismatch','Lease-Co','92000000-0000-4000-8000-000000000401',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
) as result;
reset role;
select is(
  (select count(*) from public.github_connection_incidents where installation_id='92000000-0000-4000-8000-000000000202'),
  0::bigint,
  'a stale incident projection after recovery records no incident'
);
select is(
  (select (result ->> 'is_new')::boolean from lifecycle_stale_incident_projection),
  false,
  'a stale incident projection returns the idempotent no-op result'
);
select is(
  (select count(*) from public.notifications where organisation_id='92000000-0000-4000-8000-000000000101' and kind='github_connection_incident' and subject_id='92000000-0000-4000-8000-000000000202'),
  0::bigint,
  'a stale incident projection sends no in-app notices'
);
select is(
  (select count(*) from public.alert_deliveries where installation_id='92000000-0000-4000-8000-000000000202' and kind='github_connection_health'),
  0::bigint,
  'a stale incident projection queues no Slack delivery'
);

set role service_role;
create temporary table lifecycle_expired_runs as
select id as run_id, installation_id
from public.claim_due_github_connection_reconciliations_server(
  '92000000-0000-4000-8000-000000000905',10,clock_timestamp() + interval '1 hour'
);
reset role;
update public.github_connection_reconciliation_runs
set locked_until=clock_timestamp() - interval '1 second'
where id=(select run_id from lifecycle_expired_runs where installation_id='92000000-0000-4000-8000-000000000202');
update public.github_installations
set reconciliation_locked_until=clock_timestamp() - interval '1 second'
where id='92000000-0000-4000-8000-000000000202';
set role service_role;
select throws_ok(
  $$ select public.finalize_github_connection_reconciliation_server(
       (select run_id from lifecycle_expired_runs where installation_id='92000000-0000-4000-8000-000000000202'),
       '92000000-0000-4000-8000-000000000905','success',null,null,'[]'::jsonb
     ) $$,
  '22023','connection reconciliation lease mismatch',
  'a finalizer rejects an expired run and installation lease using wall-clock time'
);
reset role;
select is(
  (select status from public.github_connection_reconciliation_runs
   where id=(select run_id from lifecycle_expired_runs where installation_id='92000000-0000-4000-8000-000000000202')),
  'running',
  'an expired-lease rejection leaves its run uncompleted'
);

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.alert_deliveries where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.alert_channels where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.github_connection_incidents where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.github_connection_reconciliation_runs where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.github_repositories where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.github_installations where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.notifications where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.audit_events where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.memberships where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.asset_categories where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.risk_categories where organisation_id = '92000000-0000-4000-8000-000000000101';
delete from public.organisations where id = '92000000-0000-4000-8000-000000000101';
delete from public.profiles where id::text like '92000000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '92000000-0000-4000-8000-00000000000%';
commit;
