begin;
select plan(32);

select has_function(
  'public',
  'set_daily_digest_channel',
  array['uuid','uuid'],
  'daily digest channel selection has an atomic database boundary'
);
select ok(
  pg_catalog.has_function_privilege('authenticated', 'public.set_daily_digest_channel(uuid,uuid)', 'EXECUTE'),
  'authenticated Owners may call the selection boundary'
);
select ok(
  not pg_catalog.has_function_privilege('anon', 'public.set_daily_digest_channel(uuid,uuid)', 'EXECUTE'),
  'anonymous callers cannot select a digest channel'
);
select ok(
  not pg_catalog.has_function_privilege('public', 'public.set_daily_digest_channel(uuid,uuid)', 'EXECUTE'),
  'PUBLIC cannot select a digest channel'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('87000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-ops-owner@example.test','',now(),'{}','{}'),
 ('87000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-ops-admin@example.test','',now(),'{}','{}'),
 ('87000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-ops-member@example.test','',now(),'{}','{}'),
 ('87000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-ops-outsider@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"87000000-0000-4000-8000-000000000001","email":"digest-ops-owner@example.test","role":"authenticated"}',true);
select set_config('app.digest_ops_org',public.create_organisation_with_owner('Digest Operations','digest-operations')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000002','admin'),
 (current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000003','member');

select set_config('request.jwt.claims','{"sub":"87000000-0000-4000-8000-000000000004","email":"digest-ops-outsider@example.test","role":"authenticated"}',true);
select set_config('app.digest_ops_other_org',public.create_organisation_with_owner('Other Digest Operations','other-digest-operations')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.digest_ops_other_org')::uuid,'87000000-0000-4000-8000-000000000001','owner');
insert into public.alert_channels(id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled) values
 ('87000000-0000-4000-8000-000000000201',current_setting('app.digest_ops_other_org')::uuid,'slack','Other tenant','{"webhookUrl":"encrypted"}','87000000-0000-4000-8000-000000000004',true,false);

select set_config('request.jwt.claims','{"sub":"87000000-0000-4000-8000-000000000001","email":"digest-ops-owner@example.test","role":"authenticated"}',true);
insert into public.alert_channels(id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled,revoked_at) values
 ('87000000-0000-4000-8000-000000000101',current_setting('app.digest_ops_org')::uuid,'slack','Primary','{"webhookUrl":"encrypted"}','87000000-0000-4000-8000-000000000001',true,false,null),
 ('87000000-0000-4000-8000-000000000102',current_setting('app.digest_ops_org')::uuid,'slack','Backup','{"webhookUrl":"encrypted"}','87000000-0000-4000-8000-000000000001',true,false,null),
 ('87000000-0000-4000-8000-000000000103',current_setting('app.digest_ops_org')::uuid,'slack','Disabled','{"webhookUrl":"encrypted"}','87000000-0000-4000-8000-000000000001',false,false,null),
 ('87000000-0000-4000-8000-000000000104',current_setting('app.digest_ops_org')::uuid,'slack','Revoked','{"webhookUrl":"encrypted"}','87000000-0000-4000-8000-000000000001',true,false,now()),
 ('87000000-0000-4000-8000-000000000105',current_setting('app.digest_ops_org')::uuid,'whatsapp','Wrong type','{}','87000000-0000-4000-8000-000000000001',true,false,null);

select is(
  public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000101'),
  true,
  'an Owner can select an active Slack channel'
);
select is(
  (select id from public.alert_channels where organisation_id=current_setting('app.digest_ops_org')::uuid and daily_digest_enabled),
  '87000000-0000-4000-8000-000000000101'::uuid,
  'the selected channel is active'
);
select is(
  public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000102'),
  true,
  'an Owner can atomically switch the digest destination'
);
select is(
  (select id from public.alert_channels where organisation_id=current_setting('app.digest_ops_org')::uuid and daily_digest_enabled),
  '87000000-0000-4000-8000-000000000102'::uuid,
  'switching leaves exactly the new channel selected'
);

select throws_ok(
  $$ select public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000999') $$,
  '22023','daily digest channel was not found','a missing channel is rejected'
);
select is(
  (select id from public.alert_channels where organisation_id=current_setting('app.digest_ops_org')::uuid and daily_digest_enabled),
  '87000000-0000-4000-8000-000000000102'::uuid,
  'a failed missing-channel switch preserves the previous selection'
);
select throws_ok(
  $$ select public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000201') $$,
  '22023','daily digest channel was not found','a real cross-tenant channel is rejected'
);
select is(
  (select id from public.alert_channels where organisation_id=current_setting('app.digest_ops_org')::uuid and daily_digest_enabled),
  '87000000-0000-4000-8000-000000000102'::uuid,
  'a failed cross-tenant switch preserves the previous selection'
);
select throws_ok(
  $$ select public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000103') $$,
  '22023','daily digest channel was not found','a disabled Slack channel is rejected'
);
select throws_ok(
  $$ select public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000104') $$,
  '22023','daily digest channel was not found','a revoked Slack channel is rejected'
);
select throws_ok(
  $$ select public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000105') $$,
  '22023','daily digest channel was not found','a non-Slack channel is rejected'
);

select throws_ok(
  $$ update public.alert_channels set daily_digest_enabled=true where id='87000000-0000-4000-8000-000000000101' $$,
  '42501','daily digest channel must be selected with set_daily_digest_channel','an Owner cannot bypass the atomic RPC through the Data API'
);
select is(
  (select id from public.alert_channels where organisation_id=current_setting('app.digest_ops_org')::uuid and daily_digest_enabled),
  '87000000-0000-4000-8000-000000000102'::uuid,
  'a rejected direct update preserves the selected channel'
);
select lives_ok(
  $$ update public.alert_channels set organisation_id=current_setting('app.digest_ops_other_org')::uuid
     where id='87000000-0000-4000-8000-000000000102' $$,
  'a dual-workspace Owner may move a selected channel'
);
select is(
  (select daily_digest_enabled from public.alert_channels where id='87000000-0000-4000-8000-000000000102'),
  false,
  'moving a channel between workspaces clears its digest selection'
);
update public.alert_channels set organisation_id=current_setting('app.digest_ops_org')::uuid
where id='87000000-0000-4000-8000-000000000102';
select public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000102');
select lives_ok(
  $$ update public.alert_channels set type='whatsapp'
     where id='87000000-0000-4000-8000-000000000102' $$,
  'an Owner may change the selected channel type'
);
select is(
  (select daily_digest_enabled from public.alert_channels where id='87000000-0000-4000-8000-000000000102'),
  false,
  'changing channel type clears the digest selection so changing back cannot reactivate it'
);
update public.alert_channels set type='slack' where id='87000000-0000-4000-8000-000000000102';
select public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000102');
select lives_ok(
  $$ update public.alert_channels set enabled=false where id='87000000-0000-4000-8000-000000000102' $$,
  'an Owner can pause the selected Slack channel'
);
select is(
  (select count(*) from public.alert_channels where organisation_id=current_setting('app.digest_ops_org')::uuid and daily_digest_enabled),
  0::bigint,
  'pausing a channel clears its digest selection'
);
update public.alert_channels set enabled=true where id='87000000-0000-4000-8000-000000000102';
select is(
  (select count(*) from public.alert_channels where organisation_id=current_setting('app.digest_ops_org')::uuid and daily_digest_enabled),
  0::bigint,
  're-enabling a channel does not silently reactivate the digest'
);
select is(
  public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000101'),
  true,
  'the Owner can explicitly select another active channel'
);
select lives_ok(
  $$ update public.alert_channels set revoked_at=now(),enabled=false where id='87000000-0000-4000-8000-000000000101' $$,
  'an Owner can revoke the selected channel'
);
select is(
  (select count(*) from public.alert_channels where organisation_id=current_setting('app.digest_ops_org')::uuid and daily_digest_enabled),
  0::bigint,
  'revoking a channel clears its digest selection'
);
select is(
  public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,null),
  true,
  'an Owner can disable the daily digest when no channel is selected'
);
select is(
  (select count(*) from public.alert_channels where organisation_id=current_setting('app.digest_ops_org')::uuid and daily_digest_enabled),
  0::bigint,
  'disabling leaves every digest destination clear'
);

select set_config('request.jwt.claims','{"sub":"87000000-0000-4000-8000-000000000002","email":"digest-ops-admin@example.test","role":"authenticated"}',true);
select throws_ok(
  $$ select public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000102') $$,
  '42501','daily digest channel selection requires a workspace Owner','an Admin cannot select the digest destination'
);
select set_config('request.jwt.claims','{"sub":"87000000-0000-4000-8000-000000000003","email":"digest-ops-member@example.test","role":"authenticated"}',true);
select throws_ok(
  $$ select public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000102') $$,
  '42501','daily digest channel selection requires a workspace Owner','a Member cannot select the digest destination'
);
select set_config('request.jwt.claims','{"sub":"87000000-0000-4000-8000-000000000004","email":"digest-ops-outsider@example.test","role":"authenticated"}',true);
select throws_ok(
  $$ select public.set_daily_digest_channel(current_setting('app.digest_ops_org')::uuid,'87000000-0000-4000-8000-000000000102') $$,
  '42501','daily digest channel selection requires a workspace Owner','a cross-tenant Owner cannot select this workspace destination'
);

select * from finish();
rollback;
