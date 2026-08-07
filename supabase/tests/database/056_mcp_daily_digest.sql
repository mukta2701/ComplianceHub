begin;
select plan(11);

select has_column('public', 'alert_channels', 'daily_digest_enabled', 'alert channels can be selected for the daily digest');
select has_table('public', 'daily_digest_deliveries', 'daily digest deliveries are durable records');
select has_trigger('public', 'daily_digest_deliveries', 'daily_digest_deliveries_audit', 'daily digest delivery changes are audited');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.daily_digest_deliveries', 'select'), 'authenticated callers receive RLS-scoped delivery reads');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.daily_digest_deliveries', 'insert'), 'authenticated callers cannot forge delivery reservations');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.daily_digest_deliveries', 'update'), 'authenticated callers cannot forge delivery outcomes');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.daily_digest_deliveries', 'delete'), 'authenticated callers cannot erase delivery history');
select ok(
  not pg_catalog.has_table_privilege('anon', 'public.daily_digest_deliveries', 'select')
  and not pg_catalog.has_table_privilege('anon', 'public.daily_digest_deliveries', 'insert')
  and not pg_catalog.has_table_privilege('anon', 'public.daily_digest_deliveries', 'update')
  and not pg_catalog.has_table_privilege('anon', 'public.daily_digest_deliveries', 'delete'),
  'anonymous callers have no delivery-table privileges'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('85000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-owner-a@example.test','',now(),'{}','{}'),
 ('85000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000000','authenticated','authenticated','digest-admin-a@example.test','',now(),'{}','{}'),
 ('85000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000000','authenticated','authenticated','digest-member-a@example.test','',now(),'{}','{}'),
 ('85000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000000','authenticated','authenticated','digest-owner-b@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000001","email":"digest-owner-a@example.test","role":"authenticated"}',true);
select set_config('app.digest_org_a',public.create_organisation_with_owner('Digest Org A','digest-org-a')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.digest_org_a')::uuid,'85000000-0000-4000-8000-000000000002','admin'),
 (current_setting('app.digest_org_a')::uuid,'85000000-0000-4000-8000-000000000003','member');

select lives_ok(
  $$ insert into public.alert_channels(
       id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled
     ) values (
       '85000000-0000-4000-8000-000000000101',current_setting('app.digest_org_a')::uuid,
       'slack','Private digest','{"webhookUrl":"encrypted"}',
       '85000000-0000-4000-8000-000000000001',true,true
     ) $$,
  'an Owner can enable one active Slack digest channel'
);

select throws_ok(
  $$ insert into public.alert_channels(
       id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled
     ) values (
       '85000000-0000-4000-8000-000000000102',current_setting('app.digest_org_a')::uuid,
       'slack','Duplicate digest','{"webhookUrl":"encrypted"}',
       '85000000-0000-4000-8000-000000000001',true,true
     ) $$,
  '23505',null,'an organisation cannot have two active digest channels'
);

insert into public.alert_channels(
  id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled,revoked_at
) values (
  '85000000-0000-4000-8000-000000000103',current_setting('app.digest_org_a')::uuid,
  'slack','Disabled Slack','{"webhookUrl":"encrypted"}',
  '85000000-0000-4000-8000-000000000001',false,false,now()
);

select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000002","email":"digest-admin-a@example.test","role":"authenticated"}',true);
select throws_ok(
  $$ update public.alert_channels set daily_digest_enabled=true
     where id='85000000-0000-4000-8000-000000000103' returning id $$,
  '42501','only workspace owners can select the daily digest channel',
  'an Admin cannot select a digest channel'
);

select * from finish();
rollback;
