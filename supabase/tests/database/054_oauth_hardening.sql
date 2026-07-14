begin;
select plan(25);

select has_column('public', 'monitor_sources', 'connection_mode', 'monitor sources distinguish sandbox and OAuth');
select has_column('public', 'monitor_sources', 'integration_connection_id', 'OAuth monitor sources link to their ticket connection');
select has_column('public', 'monitor_sources', 'broker_connection_id', 'OAuth monitor sources carry only an opaque broker connection reference');
select has_column('public', 'monitor_sources', 'broker_provider_config_key', 'OAuth monitor sources carry the allowlisted provider key');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('83000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oauth-hardening-a@example.test','',now(),'{}','{}'),
 ('83000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','oauth-hardening-b@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000000001","email":"oauth-hardening-a@example.test","role":"authenticated"}',true);
select set_config('app.oauth_org_a',public.create_organisation_with_owner('OAuth Hardening A','oauth-hardening-a')::text,true);

set local role service_role;
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'github','{"owner":123,"repo":"isms"}',
       '83000000-0000-4000-8000-000000000001','oauth','bad-gh-number','github-prod',true) $$,
  '23514', null, 'GitHub target rejects non-string owner values'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'github','{"owner":"acme","repo":"isms","extra":true}',
       '83000000-0000-4000-8000-000000000001','oauth','bad-gh-extra','github-prod',true) $$,
  '23514', null, 'GitHub target rejects extra configuration keys'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'github','{"owner":"acme/replay","repo":"isms"}',
       '83000000-0000-4000-8000-000000000001','oauth','bad-gh-path','github-prod',true) $$,
  '23514', null, 'GitHub target rejects path separators'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'github','{"owner":"acme","repo":".."}',
       '83000000-0000-4000-8000-000000000001','oauth','bad-gh-dot','github-prod',true) $$,
  '23514', null, 'GitHub target rejects dot traversal repositories'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'jira','null',
       '83000000-0000-4000-8000-000000000001','oauth','bad-jira-null','jira-prod',true) $$,
  '23514', null, 'Jira target check returns false rather than SQL NULL for JSON null'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'jira','{}',
       '83000000-0000-4000-8000-000000000001','oauth','bad-jira-empty','jira-prod',true) $$,
  '23514', null, 'Jira target rejects an empty object'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'jira','{"baseUrl":"https://acme.atlassian.net","projectKey":"SEC","cloudId":123}',
       '83000000-0000-4000-8000-000000000001','oauth','bad-jira-number','jira-prod',true) $$,
  '23514', null, 'Jira target rejects non-string cloud IDs'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'jira','{"baseUrl":"https://acme.atlassian.net","projectKey":"SEC"}',
       '83000000-0000-4000-8000-000000000001','oauth','bad-jira-missing','jira-prod',true) $$,
  '23514', null, 'Jira target requires a verified cloud ID'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'jira','{"baseUrl":"https://acme.atlassian.net","projectKey":"SEC","cloudId":"1324a887-45db-4bf4-8e99-ef0ff456d421","extra":true}',
       '83000000-0000-4000-8000-000000000001','oauth','bad-jira-extra','jira-prod',true) $$,
  '23514', null, 'Jira target rejects extra configuration keys'
);
select lives_ok(
  $$ insert into public.integration_connections(id,organisation_id,provider,label,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values('83000000-0000-4000-8000-000000000101',current_setting('app.oauth_org_a')::uuid,'github','GitHub Production','{"owner":"acme","repo":"isms"}',
       '83000000-0000-4000-8000-000000000001','oauth','deployment-global-ref','github-prod',true) $$,
  'a strict valid GitHub OAuth target is accepted'
);
select is(
  (select count(*) from public.monitor_sources where integration_connection_id='83000000-0000-4000-8000-000000000101'),
  1::bigint,
  'enabling a GitHub OAuth target creates its linked monitoring source'
);
select is(
  (select pg_catalog.jsonb_build_object(
    'mode',connection_mode,'broker',broker_connection_id,'key',broker_provider_config_key,
    'access',access_token,'refresh',refresh_token,'enabled',enabled
  ) from public.monitor_sources where integration_connection_id='83000000-0000-4000-8000-000000000101'),
  '{"mode":"oauth","broker":"deployment-global-ref","key":"github-prod","access":null,"refresh":null,"enabled":true}'::jsonb,
  'linked OAuth monitoring stores broker references and no provider tokens'
);

update public.integration_connections set enabled=false where id='83000000-0000-4000-8000-000000000101';
select is(
  (select enabled from public.monitor_sources where integration_connection_id='83000000-0000-4000-8000-000000000101'),
  false,
  'disabling the connection disables its linked monitor source'
);
update public.integration_connections set enabled=true where id='83000000-0000-4000-8000-000000000101';
select is(
  (select enabled from public.monitor_sources where integration_connection_id='83000000-0000-4000-8000-000000000101'),
  true,
  're-enabling the connection re-enables its linked monitor source'
);

set local role authenticated;
select throws_ok(
  $$ insert into public.monitor_sources(organisation_id,provider,connected_by,connection_mode,integration_connection_id,broker_connection_id,broker_provider_config_key,access_token,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'github','83000000-0000-4000-8000-000000000001','oauth',
       '83000000-0000-4000-8000-000000000101','other-ref','github-prod','must-not-store',true) $$,
  '23514', null, 'OAuth monitor sources cannot store provider tokens'
);

set local role service_role;
select lives_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_a')::uuid,'jira',
       '{"baseUrl":"https://acme.atlassian.net","projectKey":"SEC","cloudId":"1324a887-45db-4bf4-8e99-ef0ff456d421"}',
       '83000000-0000-4000-8000-000000000001','oauth','valid-jira','jira-prod',true) $$,
  'a strict verified Jira OAuth target is accepted'
);
select lives_ok(
  $$ insert into public.integration_connections(id,organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values('83000000-0000-4000-8000-000000000102',current_setting('app.oauth_org_a')::uuid,'github','{}',
       '83000000-0000-4000-8000-000000000001','oauth','tenant-fk-ref','github-prod',false) $$,
  'a disabled pending OAuth connection can wait for strict target configuration'
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000000002","email":"oauth-hardening-b@example.test","role":"authenticated"}',true);
select set_config('app.oauth_org_b',public.create_organisation_with_owner('OAuth Hardening B','oauth-hardening-b')::text,true);
set local role service_role;
select throws_ok(
  $$ insert into public.integration_connections(organisation_id,provider,config,connected_by,connection_mode,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_b')::uuid,'github','{}',
       '83000000-0000-4000-8000-000000000002','oauth','deployment-global-ref','github-prod',false) $$,
  '23505', null, 'a broker reference cannot be replayed into another workspace'
);
set local role authenticated;
select throws_ok(
  $$ insert into public.monitor_sources(organisation_id,provider,connected_by,connection_mode,integration_connection_id,broker_connection_id,broker_provider_config_key,enabled)
     values(current_setting('app.oauth_org_b')::uuid,'github','83000000-0000-4000-8000-000000000002','oauth',
       '83000000-0000-4000-8000-000000000102','tenant-fk-ref','github-prod',true) $$,
  '23503', null, 'a monitor source cannot link to another workspace connection'
);

select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000000001","email":"oauth-hardening-a@example.test","role":"authenticated"}',true);
set local role service_role;
update public.integration_connections set revoked_at=now(),enabled=false where id='83000000-0000-4000-8000-000000000101';
select is(
  (select enabled from public.monitor_sources where integration_connection_id='83000000-0000-4000-8000-000000000101'),
  false,
  'revoking the connection disables its linked monitor source'
);
select isnt(
  (select revoked_at from public.monitor_sources where integration_connection_id='83000000-0000-4000-8000-000000000101'),
  null::timestamptz,
  'revoking the connection also soft-revokes its linked monitor source'
);

select * from finish();
rollback;
