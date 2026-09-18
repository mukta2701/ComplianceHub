begin;
set local session_replication_role = replica;
delete from public.alert_deliveries where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.github_connection_incidents where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.notifications where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.alert_channels where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.audit_events where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.github_installations where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.memberships where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.asset_categories where organisation_id in ('79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102');
delete from public.risk_categories where organisation_id in ('79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102');
delete from public.organisations where id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.profiles where id::text like '79000000-0000-4111-8111-00000000000%';
delete from auth.users where id::text like '79000000-0000-4111-8111-00000000000%';
commit;
select no_plan();

select has_table('public', 'github_connection_incidents', 'connection incidents have durable state');
select ok(
  (select pg_catalog.count(*) from pg_catalog.pg_indexes
   where schemaname = 'public' and tablename = 'github_connection_incidents'
     and indexname = 'github_connection_incidents_open_key') = 1::bigint,
  'one open incident is enforced per installation and diagnostic'
);
select ok(
  has_function_privilege('service_role','public.record_github_connection_notice_server(uuid,uuid,text,text,text)','EXECUTE'),
  'service boundary may record connection notices'
);
select ok(
  has_function_privilege('service_role','public.enqueue_github_connection_alert_delivery(uuid,uuid,uuid,text,text,jsonb,text)','EXECUTE'),
  'service boundary may queue connection Slack alerts'
);
select ok(
  not has_function_privilege('authenticated','public.record_github_connection_notice_server(uuid,uuid,text,text,text)','EXECUTE'),
  'authenticated callers cannot record connection notices directly'
);
select ok(
  not has_function_privilege('authenticated','public.enqueue_github_connection_alert_delivery(uuid,uuid,uuid,text,text,jsonb,text)','EXECUTE'),
  'authenticated callers cannot queue connection Slack alerts directly'
);
select ok(has_column_privilege('authenticated', 'public.github_connection_incidents', 'status', 'SELECT'), 'authenticated may read incident status');

begin;
insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) values
 ('79000000-0000-4111-8111-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','notice-owner@example.test','',now(),'{}','{}'),
 ('79000000-0000-4111-8111-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','notice-admin@example.test','',now(),'{}','{}'),
 ('79000000-0000-4111-8111-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','notice-member@example.test','',now(),'{}','{}'),
 ('79000000-0000-4111-8111-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','notice-other-owner@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
 ('79000000-0000-4111-8111-000000000101','Notice Boundary A','notice-boundary-a','79000000-0000-4111-8111-000000000001'),
 ('79000000-0000-4111-8111-000000000102','Notice Boundary B','notice-boundary-b','79000000-0000-4111-8111-000000000004');
insert into public.memberships(organisation_id,user_id,role) values
 ('79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000001','owner'),
 ('79000000-0000-4111-8111-000000000102','79000000-0000-4111-8111-000000000001','admin'),
 ('79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000002','admin'),
 ('79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000003','member'),
 ('79000000-0000-4111-8111-000000000102','79000000-0000-4111-8111-000000000004','owner');
insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status
) values
 ('79000000-0000-4111-8111-000000000201','79000000-0000-4111-8111-000000000101',79101,79201,'Owner-Co','Organization','selected','active');
insert into public.alert_channels(id, organisation_id, type, connected_by, min_severity) values
 ('79000000-0000-4111-8111-000000000301','79000000-0000-4111-8111-000000000101','slack','79000000-0000-4111-8111-000000000001','medium');
commit;

select is(
  (public.record_github_connection_notice_server(
    '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000201',
    'incident','permission_mismatch','Owner-Co'
  ) ->> 'is_new')::boolean,
  true,
  'a first incident notice opens new notification work'
);
select is(
  (select pg_catalog.count(*) from public.notifications
   where organisation_id='79000000-0000-4111-8111-000000000101' and kind='github_connection_incident'),
  2::bigint,
  'the incident notice reaches Owners and Admins only'
);
select is(
  (select pg_catalog.count(*) from public.notifications
   where organisation_id='79000000-0000-4111-8111-000000000101' and user_id='79000000-0000-4111-8111-000000000003'),
  0::bigint,
  'a Member receives no incident notice'
);
set role service_role;
select is(
  (public.record_github_connection_notice_server(
    '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000201',
    'incident','permission_mismatch','Owner-Co'
  ) ->> 'is_new')::boolean,
  false,
  'a repeated incident observation creates no new work'
);
reset role;
select is(
  (select pg_catalog.count(*) from public.github_connection_incidents
   where installation_id='79000000-0000-4111-8111-000000000201' and status='open'),
  1::bigint,
  'repeated observations keep exactly one open incident'
);
set role service_role;
select is(
  (public.record_github_connection_notice_server(
    '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000201',
    'incident','installation_suspended','Owner-Co'
  ) ->> 'is_new')::boolean,
  true,
  'a different diagnostic opens its own incident'
);
reset role;
set role service_role;
select is(
  (public.record_github_connection_notice_server(
    '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000201',
    'recovery',null,'Owner-Co'
  ) ->> 'is_new')::boolean,
  true,
  'a verified recovery resolves with new notification work'
);
reset role;
select is(
  (select pg_catalog.count(*) from public.github_connection_incidents
   where installation_id='79000000-0000-4111-8111-000000000201' and status='open'),
  0::bigint,
  'recovery closes every open incident for the installation'
);
set role service_role;
select is(
  (public.record_github_connection_notice_server(
    '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000201',
    'recovery',null,'Owner-Co'
  ) ->> 'is_new')::boolean,
  false,
  'a repeated recovery creates no new work'
);
reset role;
set role service_role;
select throws_ok(
  $$ select public.record_github_connection_notice_server(
       '79000000-0000-4111-8111-000000000102','79000000-0000-4111-8111-000000000201',
       'incident','permission_mismatch','Owner-Co'
     ) $$,
  '42501', null,
  'a notice for another workspace installation is denied'
);
reset role;
set role service_role;
select throws_ok(
  $$ select public.record_github_connection_notice_server(
       '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000201',
       'incident','made-up-code','Owner-Co'
     ) $$,
  '22023', null,
  'an unknown diagnostic class is rejected'
);
reset role;
set role service_role;
select is(
  (select pg_catalog.count(*)::text from public.enqueue_github_connection_alert_delivery(
    '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000301',
    '79000000-0000-4111-8111-000000000201','incident','permission_mismatch',
    '{"type":"connection_health","severity":"high","title":"t","controlRef":"c","subjectId":"s","detail":"d"}'::jsonb,
    'notice-worker-1'
  )),
  '1',
  'a connection Slack alert queues exactly one lease'
);
reset role;
set role service_role;
select is(
  (select pg_catalog.count(*)::text from public.enqueue_github_connection_alert_delivery(
    '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000301',
    '79000000-0000-4111-8111-000000000201','incident','permission_mismatch',
    '{"type":"connection_health","severity":"high","title":"t","controlRef":"c","subjectId":"s","detail":"d"}'::jsonb,
    'notice-worker-1'
  )),
  '0',
  'an identical Slack alert is not queued twice'
);
reset role;
set role service_role;
select throws_ok(
  $$ select public.enqueue_github_connection_alert_delivery(
       '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000301',
       '79000000-0000-0000-0000-000000000201','incident','permission_mismatch',
       '{"type":"connection_health","severity":"high","title":"t","controlRef":"c","subjectId":"s","detail":"d"}'::jsonb,
       'notice-worker-1'
     ) $$,
  '42501', null,
  'a Slack alert for another workspace installation is denied'
);
reset role;

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.alert_deliveries where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.github_connection_incidents where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.notifications where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.alert_channels where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.audit_events where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.github_installations where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.memberships where organisation_id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.asset_categories where organisation_id in ('79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102');
delete from public.risk_categories where organisation_id in ('79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102');
delete from public.organisations where id in (
  '79000000-0000-4111-8111-000000000101','79000000-0000-4111-8111-000000000102'
);
delete from public.profiles where id::text like '79000000-0000-4111-8111-00000000000%';
delete from auth.users where id::text like '79000000-0000-4111-8111-00000000000%';
commit;
