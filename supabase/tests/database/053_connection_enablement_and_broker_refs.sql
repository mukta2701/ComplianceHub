begin;
select plan(30);

select has_column('public', 'integration_connections', 'enabled', 'connections have an enable-disable flag');
select has_column('public', 'integration_connections', 'connection_mode', 'connections distinguish sandbox and OAuth modes');
select has_column('public', 'integration_connections', 'broker_connection_id', 'connections can hold a broker reference');
select has_column('public', 'integration_connections', 'broker_provider_config_key', 'connections can hold an allowlisted provider key');
select has_column('public', 'monitor_sources', 'enabled', 'monitor sources have an enable-disable flag');
select has_column('public', 'alert_channels', 'enabled', 'alert channels have an enable-disable flag');
select col_default_is('public', 'integration_connections', 'enabled', 'true', 'connections default to enabled');
select col_default_is('public', 'monitor_sources', 'enabled', 'true', 'monitor sources default to enabled');
select col_default_is('public', 'alert_channels', 'enabled', 'true', 'alert channels default to enabled');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('82000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','conn-owner-a@example.test','',now(),'{}','{}'),
 ('82000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','conn-admin-a@example.test','',now(),'{}','{}'),
 ('82000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','conn-member-a@example.test','',now(),'{}','{}'),
 ('82000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','conn-owner-b@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000001","email":"conn-owner-a@example.test","role":"authenticated"}',true);
select set_config('app.conn_org_a',public.create_organisation_with_owner('Connection Org A','connection-org-a')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.conn_org_a')::uuid,'82000000-0000-4000-8000-000000000002','admin'),
 (current_setting('app.conn_org_a')::uuid,'82000000-0000-4000-8000-000000000003','member');

select lives_ok(
  $$ insert into public.integration_connections(
       id,organisation_id,provider,label,config,access_token,refresh_token,connected_by,
       connection_mode,broker_connection_id,broker_provider_config_key,enabled
     ) values (
       '82000000-0000-4000-8000-000000000101',current_setting('app.conn_org_a')::uuid,'github','Authorized GitHub','{}',null,null,
       '82000000-0000-4000-8000-000000000001','oauth','github-connection-1','github-prod',false
     ) $$,
  'an operator can persist a disabled OAuth broker reference without provider tokens'
);
select is(
  (select pg_catalog.jsonb_build_object(
    'mode',connection_mode,'enabled',enabled,'broker',broker_connection_id,'key',broker_provider_config_key,
    'access',access_token,'refresh',refresh_token
  ) from public.integration_connections where id='82000000-0000-4000-8000-000000000101'),
  '{"mode":"oauth","enabled":false,"broker":"github-connection-1","key":"github-prod","access":null,"refresh":null}'::jsonb,
  'an OAuth connection stores only broker metadata and remains pending target configuration'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,access_token,enabled)
     values(current_setting('app.conn_org_a')::uuid,'github','82000000-0000-4000-8000-000000000001','oauth','bad-token','github-prod','must-not-coexist',false) $$,
  '23514', null, 'OAuth broker references cannot store a provider token'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,connected_by,connection_mode,broker_connection_id,broker_provider_config_key)
     values(current_setting('app.conn_org_a')::uuid,'github','82000000-0000-4000-8000-000000000001','sandbox','bad-sandbox','github-prod') $$,
  '23514', null, 'sandbox connections cannot masquerade as broker connections'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.conn_org_a')::uuid,'github','82000000-0000-4000-8000-000000000001','oauth','github-connection-1','github-prod',false) $$,
  '23505', null, 'a broker connection reference cannot be attached twice in one workspace'
);
select throws_ok(
  $$ update public.integration_connections set enabled=true where id='82000000-0000-4000-8000-000000000101' $$,
  '23514', null, 'an OAuth connection cannot enable before a target repository or project is configured'
);

select lives_ok(
  $$ insert into public.monitor_sources(id,organisation_id,provider,label,connected_by,enabled)
     values('82000000-0000-4000-8000-000000000102',current_setting('app.conn_org_a')::uuid,'github','Production GitHub','82000000-0000-4000-8000-000000000001',true) $$,
  'an operator can create an enabled monitoring source'
);
insert into public.alert_channels(id,organisation_id,type,label,connected_by,enabled)
values('82000000-0000-4000-8000-000000000103',current_setting('app.conn_org_a')::uuid,'slack','Compliance Slack','82000000-0000-4000-8000-000000000001',true);

select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000003","email":"conn-member-a@example.test","role":"authenticated"}',true);
select results_eq(
  $$ update public.integration_connections set enabled=true where id='82000000-0000-4000-8000-000000000101' returning id $$,
  $$ select null::uuid where false $$, 'a Member cannot enable a connection'
);
select results_eq(
  $$ update public.monitor_sources set enabled=false where id='82000000-0000-4000-8000-000000000102' returning id $$,
  $$ select null::uuid where false $$, 'a Member cannot disable a monitor source'
);
select results_eq(
  $$ update public.alert_channels set enabled=false where id='82000000-0000-4000-8000-000000000103' returning id $$,
  $$ select null::uuid where false $$, 'a Member cannot disable an alert channel'
);
select is((select count(*) from public.monitor_sources),0::bigint,'a Member still cannot read monitor source configuration');
select is((select count(*) from public.integration_connections),0::bigint,'a Member still cannot read connection configuration');

select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000002","email":"conn-admin-a@example.test","role":"authenticated"}',true);
select results_eq(
  $$ update public.integration_connections set config='{"owner":"acme","repo":"isms"}',enabled=true where id='82000000-0000-4000-8000-000000000101' returning enabled $$,
  $$ values(true) $$, 'an Admin can finish OAuth target setup and enable its workspace connection'
);
select results_eq(
  $$ update public.monitor_sources set enabled=false where id='82000000-0000-4000-8000-000000000102' returning enabled $$,
  $$ values(false) $$, 'an Admin can disable its workspace monitor source'
);
select results_eq(
  $$ update public.alert_channels set enabled=false where id='82000000-0000-4000-8000-000000000103' returning enabled $$,
  $$ values(false) $$, 'an Admin can disable its workspace alert channel'
);
select is((select count(*) from public.integration_connections),1::bigint,'an Admin can list its workspace connection configuration');
select is((select count(*) from public.monitor_sources),2::bigint,'an Admin can list manual and OAuth-linked workspace monitor source configuration');

select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000003","email":"conn-member-a@example.test","role":"authenticated"}',true);
select is(
  (select count(*) from public.list_connected_monitor_sources(current_setting('app.conn_org_a')::uuid)),
  1::bigint,
  'disabled monitor sources are hidden while the enabled OAuth-linked source remains visible to Members'
);

select set_config('request.jwt.claims','{"sub":"82000000-0000-4000-8000-000000000004","email":"conn-owner-b@example.test","role":"authenticated"}',true);
select set_config('app.conn_org_b',public.create_organisation_with_owner('Connection Org B','connection-org-b')::text,true);
select results_eq(
  $$ update public.integration_connections set enabled=false where id='82000000-0000-4000-8000-000000000101' returning id $$,
  $$ select null::uuid where false $$, 'another tenant cannot disable a connection'
);
select results_eq(
  $$ update public.monitor_sources set enabled=true where id='82000000-0000-4000-8000-000000000102' returning id $$,
  $$ select null::uuid where false $$, 'another tenant cannot enable a monitor source'
);
select results_eq(
  $$ update public.alert_channels set enabled=true where id='82000000-0000-4000-8000-000000000103' returning id $$,
  $$ select null::uuid where false $$, 'another tenant cannot enable an alert channel'
);

select * from finish();
rollback;
