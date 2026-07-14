begin;
select plan(24);

select ok(
  pg_catalog.pg_get_indexdef('public.integration_connections_broker_ref_unique'::pg_catalog.regclass) not ilike '%revoked_at%'
  and pg_catalog.pg_get_indexdef('public.integration_connections_broker_ref_unique'::pg_catalog.regclass) ilike '%broker_connection_id is not null%',
  'broker references retain an unconditional non-null tombstone after revoke'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('84000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-owner-a@example.test','',now(),'{}','{}'),
 ('84000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-owner-next@example.test','',now(),'{}','{}'),
 ('84000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-config-admin@example.test','',now(),'{}','{}'),
 ('84000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-owner-b@example.test','',now(),'{}','{}'),
 ('84000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-manager-admin@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"84000000-0000-4000-8000-000000000001","email":"lifecycle-owner-a@example.test","role":"authenticated"}',true);
select set_config('app.lifecycle_org_a',public.create_organisation_with_owner('Lifecycle A','lifecycle-a')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.lifecycle_org_a')::uuid,'84000000-0000-4000-8000-000000000002','owner'),
 (current_setting('app.lifecycle_org_a')::uuid,'84000000-0000-4000-8000-000000000003','admin'),
 (current_setting('app.lifecycle_org_a')::uuid,'84000000-0000-4000-8000-000000000005','admin');

insert into public.integration_connections(
  id,organisation_id,provider,label,config,connected_by,connection_mode,
  broker_connection_id,broker_provider_config_key,enabled
) values (
  '84000000-0000-4000-8000-000000000101',current_setting('app.lifecycle_org_a')::uuid,
  'github','GitHub Production','{}','84000000-0000-4000-8000-000000000001',
  'oauth','lifecycle-tombstone-ref','github-prod',false
);
insert into public.integration_connections(
  id,organisation_id,provider,label,config,connected_by,connection_mode,enabled
) values (
  '84000000-0000-4000-8000-000000000102',current_setting('app.lifecycle_org_a')::uuid,
  'jira','Engineering Jira','{"baseUrl":"https://acme.atlassian.net","projectKey":"ENG"}',
  '84000000-0000-4000-8000-000000000001','sandbox',true
);
insert into public.monitor_sources(
  id,organisation_id,provider,label,config,connected_by,connection_mode,enabled
) values (
  '84000000-0000-4000-8000-000000000201',current_setting('app.lifecycle_org_a')::uuid,
  'github','Sandbox monitor','{"owner":"acme","repo":"sandbox"}',
  '84000000-0000-4000-8000-000000000001','sandbox',true
);
insert into public.alert_channels(
  id,organisation_id,type,label,config,connected_by,enabled
) values (
  '84000000-0000-4000-8000-000000000301',current_setting('app.lifecycle_org_a')::uuid,
  'slack','Compliance Slack','{"webhookUrl":"encrypted"}',
  '84000000-0000-4000-8000-000000000001',true
);

select set_config('request.jwt.claims','{"sub":"84000000-0000-4000-8000-000000000003","email":"lifecycle-config-admin@example.test","role":"authenticated"}',true);
update public.integration_connections
set config='{"owner":"acme","repo":"isms"}', enabled=true
where id='84000000-0000-4000-8000-000000000101';
select is(
  (select connected_by from public.monitor_sources where integration_connection_id='84000000-0000-4000-8000-000000000101'),
  '84000000-0000-4000-8000-000000000001'::uuid,
  'the derived source preserves the original connection provenance rather than the configuring Admin'
);

select throws_ok(
  $$ update public.integration_connections
     set broker_connection_id='stolen-ref', broker_provider_config_key='stolen-key'
     where id='84000000-0000-4000-8000-000000000101' $$,
  'P0001','OAuth connection identity is immutable','an Owner or Admin cannot replace verified OAuth broker references'
);
update public.integration_connections
set broker_connection_id='lifecycle-tombstone-ref', broker_provider_config_key='github-prod'
where id='84000000-0000-4000-8000-000000000101';

select throws_ok(
  $$ update public.integration_connections
     set provider='jira', config='{"baseUrl":"https://acme.atlassian.net","projectKey":"SEC","cloudId":"1324a887-45db-4bf4-8e99-ef0ff456d421"}'
     where id='84000000-0000-4000-8000-000000000101' $$,
  'P0001','OAuth connection identity is immutable','an OAuth provider cannot be changed after confirmation'
);
update public.integration_connections set provider='github',config='{"owner":"acme","repo":"isms"}'
where id='84000000-0000-4000-8000-000000000101';

select throws_ok(
  $$ update public.integration_connections
     set connection_mode='sandbox',broker_connection_id=null,broker_provider_config_key=null
     where id='84000000-0000-4000-8000-000000000101' $$,
  'P0001','OAuth connection identity is immutable','an OAuth row cannot be converted into a sandbox row'
);
update public.integration_connections
set connection_mode='oauth',broker_connection_id='lifecycle-tombstone-ref',broker_provider_config_key='github-prod'
where id='84000000-0000-4000-8000-000000000101';

select throws_ok(
  $$ update public.monitor_sources set enabled=false
     where integration_connection_id='84000000-0000-4000-8000-000000000101' $$,
  'P0001','Linked OAuth monitoring is managed by its integration connection','a linked source cannot be independently disabled'
);
update public.monitor_sources set enabled=true
where integration_connection_id='84000000-0000-4000-8000-000000000101';
select throws_ok(
  $$ update public.monitor_sources set revoked_at=now(),enabled=false
     where integration_connection_id='84000000-0000-4000-8000-000000000101' $$,
  'P0001','Linked OAuth monitoring is managed by its integration connection','a linked source cannot be independently revoked'
);
update public.monitor_sources set revoked_at=null,enabled=true
where integration_connection_id='84000000-0000-4000-8000-000000000101';
select throws_ok(
  $$ update public.monitor_sources
     set broker_connection_id='stolen-ref',broker_provider_config_key='stolen-key'
     where integration_connection_id='84000000-0000-4000-8000-000000000101' $$,
  'P0001','Linked OAuth monitoring is managed by its integration connection','a linked source cannot replace its derived broker references'
);
update public.monitor_sources
set broker_connection_id='lifecycle-tombstone-ref',broker_provider_config_key='github-prod'
where integration_connection_id='84000000-0000-4000-8000-000000000101';
select throws_ok(
  $$ insert into public.monitor_sources(
       organisation_id,provider,label,config,connected_by,connection_mode,
       integration_connection_id,broker_connection_id,broker_provider_config_key,enabled
     ) values (
       current_setting('app.lifecycle_org_a')::uuid,'github','GitHub Production','{"owner":"acme","repo":"isms"}',
       '84000000-0000-4000-8000-000000000003','oauth','84000000-0000-4000-8000-000000000101',
       'inserted-stolen-ref','github-prod',true
     ) $$,
  'P0001','Linked OAuth monitoring is managed by its integration connection','a client cannot insert a forged linked source with copied or stolen broker references'
);

update public.integration_connections set enabled=false where id='84000000-0000-4000-8000-000000000101';
select is(
  (select enabled from public.monitor_sources where integration_connection_id='84000000-0000-4000-8000-000000000101'),
  false,'disabling the parent disables its linked source'
);
select throws_ok(
  $$ update public.monitor_sources set enabled=true
     where integration_connection_id='84000000-0000-4000-8000-000000000101' $$,
  'P0001','Linked OAuth monitoring is managed by its integration connection','a linked source cannot be re-enabled while its parent is disabled'
);
update public.integration_connections set enabled=true where id='84000000-0000-4000-8000-000000000101';
select is(
  (select enabled from public.monitor_sources where integration_connection_id='84000000-0000-4000-8000-000000000101'),
  true,'re-enabling the parent restores its linked source'
);

select set_config('request.jwt.claims','{"sub":"84000000-0000-4000-8000-000000000001","email":"lifecycle-owner-a@example.test","role":"authenticated"}',true);
delete from public.memberships
where organisation_id=current_setting('app.lifecycle_org_a')::uuid
  and user_id='84000000-0000-4000-8000-000000000003';
select is((select count(*) from public.integration_connections where id='84000000-0000-4000-8000-000000000101'),1::bigint,'offboarding the configuring Admin preserves the parent connection');
select is((select count(*) from public.monitor_sources where integration_connection_id='84000000-0000-4000-8000-000000000101'),1::bigint,'offboarding the configuring Admin preserves linked monitoring');

select set_config('request.jwt.claims','{"sub":"84000000-0000-4000-8000-000000000002","email":"lifecycle-owner-next@example.test","role":"authenticated"}',true);
delete from public.memberships
where organisation_id=current_setting('app.lifecycle_org_a')::uuid
  and user_id='84000000-0000-4000-8000-000000000001';
select is((select count(*) from public.integration_connections where organisation_id=current_setting('app.lifecycle_org_a')::uuid),2::bigint,'offboarding the original connector preserves GitHub and Jira connections');
select is((select count(*) from public.monitor_sources where organisation_id=current_setting('app.lifecycle_org_a')::uuid),2::bigint,'offboarding the original connector preserves sandbox and linked monitors');
select is((select count(*) from public.alert_channels where organisation_id=current_setting('app.lifecycle_org_a')::uuid),1::bigint,'offboarding the original connector preserves Slack channels');
select is((
  select count(*) from (
    select connected_by from public.integration_connections where organisation_id=current_setting('app.lifecycle_org_a')::uuid
    union all select connected_by from public.monitor_sources where organisation_id=current_setting('app.lifecycle_org_a')::uuid
    union all select connected_by from public.alert_channels where organisation_id=current_setting('app.lifecycle_org_a')::uuid
  ) provenance where connected_by is not null
),0::bigint,'offboarding nulls connector provenance without deleting workspace resources');

select set_config('request.jwt.claims','{"sub":"84000000-0000-4000-8000-000000000005","email":"lifecycle-manager-admin@example.test","role":"authenticated"}',true);
select results_eq(
  $$ update public.integration_connections set enabled=false where id='84000000-0000-4000-8000-000000000102' returning id $$,
  $$ values('84000000-0000-4000-8000-000000000102'::uuid) $$,
  'a remaining Admin can manage a preserved Jira connection'
);
select results_eq(
  $$ update public.monitor_sources set enabled=false where id='84000000-0000-4000-8000-000000000201' returning id $$,
  $$ values('84000000-0000-4000-8000-000000000201'::uuid) $$,
  'a remaining Admin can manage a preserved sandbox monitor'
);
select results_eq(
  $$ update public.alert_channels set enabled=false where id='84000000-0000-4000-8000-000000000301' returning id $$,
  $$ values('84000000-0000-4000-8000-000000000301'::uuid) $$,
  'a remaining Admin can manage a preserved Slack channel'
);
update public.integration_connections set revoked_at=now(),enabled=false where id='84000000-0000-4000-8000-000000000101';
select is(
  (select enabled from public.monitor_sources where integration_connection_id='84000000-0000-4000-8000-000000000101'),
  false,'revoking the parent disables its linked source'
);
select isnt(
  (select revoked_at from public.monitor_sources where integration_connection_id='84000000-0000-4000-8000-000000000101'),
  null::timestamptz,'revoking the parent also revokes its linked source'
);

select set_config('request.jwt.claims','{"sub":"84000000-0000-4000-8000-000000000004","email":"lifecycle-owner-b@example.test","role":"authenticated"}',true);
select set_config('app.lifecycle_org_b',public.create_organisation_with_owner('Lifecycle B','lifecycle-b')::text,true);
select throws_ok(
  $$ insert into public.integration_connections(
       organisation_id,provider,config,connected_by,connection_mode,
       broker_connection_id,broker_provider_config_key,enabled
     ) values (
       current_setting('app.lifecycle_org_b')::uuid,'github','{}','84000000-0000-4000-8000-000000000004',
       'oauth','lifecycle-tombstone-ref','github-prod',false
     ) $$,
  '23505',null,'a revoked broker reference cannot be replayed into another workspace'
);

select * from finish();
rollback;
