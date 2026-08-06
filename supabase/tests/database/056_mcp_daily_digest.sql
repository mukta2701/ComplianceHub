begin;
select plan(27);

select has_column('public', 'alert_channels', 'daily_digest_enabled', 'alert channels can be selected for the daily digest');
select has_table('public', 'daily_digest_deliveries', 'daily digest deliveries are durable records');
select has_trigger('public', 'daily_digest_deliveries', 'daily_digest_deliveries_audit', 'daily digest delivery changes are audited');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.daily_digest_deliveries', 'select'), 'authenticated callers receive RLS-scoped delivery reads');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.daily_digest_deliveries', 'insert'), 'authenticated callers may reserve through Owner-scoped RLS');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.daily_digest_deliveries', 'update'), 'authenticated callers may record delivery outcomes through Owner-scoped RLS');
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

select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000001","email":"digest-owner-a@example.test","role":"authenticated"}',true);
select lives_ok(
  $$ insert into public.daily_digest_deliveries(
       id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by
     ) values (
       '85000000-0000-4000-8000-000000000201',current_setting('app.digest_org_a')::uuid,
       '2026-08-06','85000000-0000-4000-8000-000000000101',repeat('a',64),
       '{"headline":"Compliance needs attention","priorities":["One"],"actions":["Two"]}',
       '85000000-0000-4000-8000-000000000001'
     ) $$,
  'an Owner can reserve a digest delivery'
);
select is(
  (select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.digest_org_a')::uuid),
  1,'the Owner can read the reserved delivery'
);

select throws_ok(
  $$ insert into public.daily_digest_deliveries(
       organisation_id,digest_on,channel_id,fact_hash,message,attempted_by
     ) values (
       current_setting('app.digest_org_a')::uuid,'2026-08-06','85000000-0000-4000-8000-000000000101',repeat('b',64),
       '{"headline":"Second","priorities":[],"actions":[]}',
       '85000000-0000-4000-8000-000000000001'
     ) $$,
  '23505',null,'the organisation and date reservation prevents duplicate posts'
);

select throws_ok(
  $$ insert into public.daily_digest_deliveries(
       organisation_id,digest_on,channel_id,fact_hash,message,attempted_by
     ) values (
       current_setting('app.digest_org_a')::uuid,'2026-08-07','85000000-0000-4000-8000-000000000103',repeat('b',64),
       '{"headline":"Wrong channel","priorities":[],"actions":[]}',
       '85000000-0000-4000-8000-000000000001'
     ) $$,
  '42501',null,'a delivery cannot target a channel that is not enabled for daily digests'
);

select throws_ok(
  $$ insert into public.daily_digest_deliveries(
       organisation_id,digest_on,channel_id,fact_hash,message,attempted_by
     ) values (
       current_setting('app.digest_org_a')::uuid,'2026-08-07','85000000-0000-4000-8000-000000000101','not-a-hash',
       '{"headline":"Bad hash","priorities":[],"actions":[]}',
       '85000000-0000-4000-8000-000000000001'
     ) $$,
  '23514',null,'fact hashes must be lowercase SHA-256 hex strings'
);

select throws_ok(
  $$ insert into public.daily_digest_deliveries(
       organisation_id,digest_on,channel_id,fact_hash,message,attempted_by
     ) values (
       current_setting('app.digest_org_a')::uuid,'2026-08-07','85000000-0000-4000-8000-000000000101',repeat('b',64),
       '["not","an","object"]',
       '85000000-0000-4000-8000-000000000001'
     ) $$,
  '23514',null,'the exact outgoing message must be a JSON object'
);

select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000002","email":"digest-admin-a@example.test","role":"authenticated"}',true);
select throws_ok(
  $$ insert into public.daily_digest_deliveries(
       organisation_id,digest_on,channel_id,fact_hash,message,attempted_by
     ) values (
       current_setting('app.digest_org_a')::uuid,'2026-08-07','85000000-0000-4000-8000-000000000101',repeat('b',64),
       '{"headline":"Admin","priorities":[],"actions":[]}',
       '85000000-0000-4000-8000-000000000002'
     ) $$,
  '42501',null,'an Admin cannot reserve a digest delivery'
);

select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000003","email":"digest-member-a@example.test","role":"authenticated"}',true);
select throws_ok(
  $$ insert into public.daily_digest_deliveries(
       organisation_id,digest_on,channel_id,fact_hash,message,attempted_by
     ) values (
       current_setting('app.digest_org_a')::uuid,'2026-08-07','85000000-0000-4000-8000-000000000101',repeat('c',64),
       '{"headline":"Member","priorities":[],"actions":[]}',
       '85000000-0000-4000-8000-000000000003'
     ) $$,
  '42501',null,'a Member cannot reserve a digest delivery'
);

select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000004","email":"digest-owner-b@example.test","role":"authenticated"}',true);
select set_config('app.digest_org_b',public.create_organisation_with_owner('Digest Org B','digest-org-b')::text,true);
select is(
  (select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.digest_org_a')::uuid),
  0,'an outsider cannot read another organisation delivery'
);

select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000001","email":"digest-owner-a@example.test","role":"authenticated"}',true);
select lives_ok(
  $$ update public.daily_digest_deliveries
     set status='delivered',delivered_at=now()
     where id='85000000-0000-4000-8000-000000000201' $$,
  'the reserving Owner can record a delivered outcome'
);
select throws_ok(
  $$ update public.daily_digest_deliveries set fact_hash=repeat('d',64)
     where id='85000000-0000-4000-8000-000000000201' $$,
  'P0001','daily digest delivery facts and destination are immutable','delivery facts cannot be rewritten after reservation'
);
select throws_ok(
  $$ update public.daily_digest_deliveries set status='failed'
     where id='85000000-0000-4000-8000-000000000201' $$,
  'P0001','daily digest delivery has a terminal outcome','a delivered outcome cannot be replaced'
);
select is(
  (select count(*)::int from public.audit_events
   where organisation_id=current_setting('app.digest_org_a')::uuid
     and entity_type='daily_digest_deliveries' and action='insert'),
  1,'the reservation is present in the audit trail'
);
select is(
  (select count(*)::int from public.audit_events
   where organisation_id=current_setting('app.digest_org_a')::uuid
     and entity_type='daily_digest_deliveries' and action='update'),
  1,'the delivery outcome is present in the audit trail'
);
select throws_ok(
  $$ delete from public.daily_digest_deliveries where id='85000000-0000-4000-8000-000000000201' $$,
  '42501',null,'delivery records cannot be deleted by authenticated callers'
);
select is(
  (select status::text from public.daily_digest_deliveries where id='85000000-0000-4000-8000-000000000201'),
  'delivered','failed update attempts leave the immutable delivered record intact'
);

select * from finish();
rollback;
