begin;
select plan(31);

select hasnt_function(
  'public', 'reserve_daily_digest_delivery_server',
  array['uuid','uuid','date','text','jsonb'],
  'the reservation signature without an expected channel is removed'
);
select has_function(
  'public', 'reserve_daily_digest_delivery_server',
  array['uuid','uuid','uuid','date','text','jsonb'],
  'reservation requires the prevalidated expected channel id'
);
select ok(
  not has_function_privilege('authenticated','public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)','EXECUTE'),
  'authenticated cannot forge the expected channel boundary'
);
select ok(
  not has_function_privilege('anon','public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)','EXECUTE'),
  'anonymous callers cannot reserve'
);
select ok(
  not has_function_privilege('public','public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)','EXECUTE'),
  'PUBLIC cannot reserve'
);
select ok(
  has_function_privilege('service_role','public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)','EXECUTE'),
  'only the service boundary can reserve'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('94000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','slack-owner-a@example.test','',now(),'{}','{}'),
 ('94000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','slack-admin-a@example.test','',now(),'{}','{}'),
 ('94000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','slack-owner-b@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.slack_org_a',public.create_organisation_with_owner('Slack destination A','slack-destination-a')::text,true);
insert into public.memberships(organisation_id,user_id,role)
values (current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000002','admin');
insert into public.alert_channels(id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled) values
 ('94000000-0000-4000-8000-000000000101',current_setting('app.slack_org_a')::uuid,'slack','Approved A','{}','94000000-0000-4000-8000-000000000001',true,false),
 ('94000000-0000-4000-8000-000000000102',current_setting('app.slack_org_a')::uuid,'slack','Other A','{}','94000000-0000-4000-8000-000000000001',true,false);
select public.set_daily_digest_channel(current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000101');

select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('app.slack_org_b',public.create_organisation_with_owner('Slack destination B','slack-destination-b')::text,true);
insert into public.alert_channels(id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled)
values ('94000000-0000-4000-8000-000000000201',current_setting('app.slack_org_b')::uuid,'slack','Approved B','{}','94000000-0000-4000-8000-000000000003',true,false);
select public.set_daily_digest_channel(current_setting('app.slack_org_b')::uuid,'94000000-0000-4000-8000-000000000201');

select throws_ok(
  $$ select public.reserve_daily_digest_delivery_server(
       current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000001',
       '94000000-0000-4000-8000-000000000101','2026-08-25',repeat('a',64),'{"text":"Direct","blocks":[]}'
     ) $$,
  '42501',null,'an authenticated caller cannot invoke the server reservation'
);

set local role service_role;
select throws_ok(
  $$ select public.reserve_daily_digest_delivery_server(
       current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000002',
       '94000000-0000-4000-8000-000000000101','2026-08-25',repeat('a',64),'{"text":"Admin","blocks":[]}'
     ) $$,
  '42501','daily digest action requires a workspace Owner','an Admin actor cannot reserve'
);
select throws_ok(
  $$ select public.reserve_daily_digest_delivery_server(
       current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000003',
       '94000000-0000-4000-8000-000000000101','2026-08-25',repeat('a',64),'{"text":"Cross actor","blocks":[]}'
     ) $$,
  '42501','daily digest action requires a workspace Owner','a cross-organisation Owner actor cannot reserve'
);

select set_config('app.slack_first',public.reserve_daily_digest_delivery_server(
  current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000101','2026-08-25',repeat('a',64),'{"text":"Approved","blocks":[]}'
)::text,true);
select is((current_setting('app.slack_first')::jsonb->>'state'),'reserved','the exact selected expected channel reserves');
select is((current_setting('app.slack_first')::jsonb->>'channelId')::uuid,'94000000-0000-4000-8000-000000000101'::uuid,'the reservation is bound to the expected channel');
reset role;
select is((select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.slack_org_a')::uuid and digest_on='2026-08-25'),1,'the approved call creates one delivery');
select is((select count(*)::int from public.daily_digest_delivery_attempts where delivery_id=(current_setting('app.slack_first')::jsonb->>'deliveryId')::uuid),1,'the approved call creates one attempt');

select set_config('app.slack_delivery_count',(select count(*)::text from public.daily_digest_deliveries),true);
select set_config('app.slack_attempt_count',(select count(*)::text from public.daily_digest_delivery_attempts),true);
select set_config('app.slack_delivery_audit_count',(select count(*)::text from public.audit_events where entity_type in ('daily_digest_deliveries','daily_digest_delivery_attempts')),true);
set local role service_role;
select is((public.reserve_daily_digest_delivery_server(
  current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000102','2026-08-26',repeat('b',64),'{"text":"Wrong","blocks":[]}'
)->>'state'),'no_digest_channel','a same-organisation but unselected expected channel is rejected');
select is((public.reserve_daily_digest_delivery_server(
  current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000201','2026-08-27',repeat('c',64),'{"text":"Cross","blocks":[]}'
)->>'state'),'no_digest_channel','a cross-organisation expected channel is rejected');
reset role;
select is((select count(*)::int from public.daily_digest_deliveries),current_setting('app.slack_delivery_count')::int,'wrong and cross-tenant channels create no delivery');
select is((select count(*)::int from public.daily_digest_delivery_attempts),current_setting('app.slack_attempt_count')::int,'wrong and cross-tenant channels create no attempt');
select is((select count(*)::int from public.audit_events where entity_type in ('daily_digest_deliveries','daily_digest_delivery_attempts')),current_setting('app.slack_delivery_audit_count')::int,'wrong and cross-tenant channels create no delivery audit');

update public.alert_channels set enabled=false where id='94000000-0000-4000-8000-000000000101';
select set_config('app.slack_delivery_audit_count',(select count(*)::text from public.audit_events where entity_type in ('daily_digest_deliveries','daily_digest_delivery_attempts')),true);
set local role service_role;
select is((public.reserve_daily_digest_delivery_server(
  current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000101','2026-08-28',repeat('d',64),'{"text":"Disabled","blocks":[]}'
)->>'state'),'no_digest_channel','a disabled expected channel is rejected');
reset role;
select is((select count(*)::int from public.daily_digest_deliveries where digest_on='2026-08-28'),0,'disabled rejection creates no delivery');
select is((select count(*)::int from public.audit_events where entity_type in ('daily_digest_deliveries','daily_digest_delivery_attempts')),current_setting('app.slack_delivery_audit_count')::int,'disabled rejection creates no delivery audit');

update public.alert_channels set enabled=true,revoked_at=now() where id='94000000-0000-4000-8000-000000000101';
set local role service_role;
select is((public.reserve_daily_digest_delivery_server(
  current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000101','2026-08-29',repeat('e',64),'{"text":"Revoked","blocks":[]}'
)->>'state'),'no_digest_channel','a revoked expected channel is rejected');
reset role;
select is((select count(*)::int from public.daily_digest_deliveries where digest_on='2026-08-29'),0,'revoked rejection creates no delivery');

update public.alert_channels set revoked_at=null,enabled=true where id='94000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.set_daily_digest_channel(current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000102');
set local role service_role;
select is((public.reserve_daily_digest_delivery_server(
  current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000101','2026-08-30',repeat('f',64),'{"text":"Switched","blocks":[]}'
)->>'state'),'no_digest_channel','a selected-channel switch is rejected against the prevalidated expected channel');
reset role;
select is((select count(*)::int from public.daily_digest_deliveries where digest_on='2026-08-30'),0,'switched rejection creates no delivery');

set local role service_role;
select ok(public.finalize_daily_digest_delivery_server(
  (current_setting('app.slack_first')::jsonb->>'deliveryId')::uuid,'94000000-0000-4000-8000-000000000001',1,'failed','SLACK_REJECTED'
),'the first exact reservation can record a confirmed failure');
select is((public.reserve_daily_digest_delivery_server(
  current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000102','2026-08-25',repeat('a',64),'{"text":"Retry wrong","blocks":[]}'
)->>'state'),'no_digest_channel','a failed delivery cannot switch its immutable destination on retry');
reset role;
select is((select count(*)::int from public.daily_digest_delivery_attempts where delivery_id=(current_setting('app.slack_first')::jsonb->>'deliveryId')::uuid),1,'the rejected switched retry creates no attempt');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.set_daily_digest_channel(current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000101');
set local role service_role;
select set_config('app.slack_retry',public.reserve_daily_digest_delivery_server(
  current_setting('app.slack_org_a')::uuid,'94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000101','2026-08-25',repeat('a',64),'{"text":"Ignored replacement","blocks":[]}'
)::text,true);
select is((current_setting('app.slack_retry')::jsonb->>'state'),'reserved','the original selected expected destination can retry');
select is((current_setting('app.slack_retry')::jsonb->>'attemptNumber')::int,2,'the exact retry advances one attempt');
select is((current_setting('app.slack_retry')::jsonb->>'channelId')::uuid,'94000000-0000-4000-8000-000000000101'::uuid,'the retry remains bound to the original destination');

select * from finish();
rollback;
