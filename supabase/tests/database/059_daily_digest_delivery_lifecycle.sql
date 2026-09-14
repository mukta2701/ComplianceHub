begin;
select plan(57);

select has_table('public','daily_digest_delivery_attempts','digest attempts have durable per-attempt history');
select hasnt_function('public','reserve_daily_digest_delivery',array['uuid','date','text','jsonb'],'actor-less reservation is removed');
select hasnt_function('public','finalize_daily_digest_delivery',array['uuid','integer','text','text'],'actor-less finalization is removed');
select has_function('public','reserve_daily_digest_delivery_server',array['uuid','uuid','uuid','date','text','jsonb'],'server reservation requires an explicit verified actor and expected channel');
select has_function('public','finalize_daily_digest_delivery_server',array['uuid','uuid','integer','text','text'],'server finalization requires the same explicit actor');
select ok(not has_table_privilege('authenticated','public.daily_digest_deliveries','INSERT'),'authenticated cannot directly forge reservations');
select ok(not has_table_privilege('authenticated','public.daily_digest_deliveries','UPDATE'),'authenticated cannot directly forge outcomes');
select ok(not has_table_privilege('authenticated','public.daily_digest_deliveries','DELETE'),'authenticated cannot erase deliveries');
select ok(has_table_privilege('authenticated','public.daily_digest_deliveries','SELECT'),'Owner-scoped delivery reads remain exposed');
select ok(has_table_privilege('authenticated','public.daily_digest_delivery_attempts','SELECT'),'Owner-scoped attempt reads remain exposed');
select ok(not has_table_privilege('authenticated','public.daily_digest_delivery_attempts','INSERT,UPDATE,DELETE'),'attempt writes remain RPC-only and immutable');
select ok(not has_function_privilege('authenticated','public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)','EXECUTE'),'authenticated cannot supply a forged reservation actor');
select ok(not has_function_privilege('authenticated','public.finalize_daily_digest_delivery_server(uuid,uuid,integer,text,text)','EXECUTE'),'authenticated cannot supply a forged finalization actor');
select ok(not has_function_privilege('anon','public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)','EXECUTE'),'anon cannot reserve');
select ok(not has_function_privilege('anon','public.finalize_daily_digest_delivery_server(uuid,uuid,integer,text,text)','EXECUTE'),'anon cannot finalize');
select ok(not has_function_privilege('public','public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)','EXECUTE'),'PUBLIC cannot reserve');
select ok(not has_function_privilege('public','public.finalize_daily_digest_delivery_server(uuid,uuid,integer,text,text)','EXECUTE'),'PUBLIC cannot finalize');
select ok(has_function_privilege('service_role','public.reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)','EXECUTE'),'only the backend service capability may reserve');
select ok(has_function_privilege('service_role','public.finalize_daily_digest_delivery_server(uuid,uuid,integer,text,text)','EXECUTE'),'only the backend service capability may finalize');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('86000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-owner@example.test','',now(),'{}','{}'),
 ('86000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-admin@example.test','',now(),'{}','{}'),
 ('86000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-member@example.test','',now(),'{}','{}'),
 ('86000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-outsider@example.test','',now(),'{}','{}'),
 ('86000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-owner-two@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"86000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.lifecycle_org',public.create_organisation_with_owner('Lifecycle Org','lifecycle-org')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000002','admin'),
 (current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000003','member'),
 (current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000005','owner');
insert into public.alert_channels(id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled)
values ('86000000-0000-4000-8000-000000000101',current_setting('app.lifecycle_org')::uuid,'slack','Digest','{"webhookUrl":"encrypted"}','86000000-0000-4000-8000-000000000001',true,false);
select public.set_daily_digest_channel(
  current_setting('app.lifecycle_org')::uuid,
  '86000000-0000-4000-8000-000000000101'
);

select throws_ok(
  $$ insert into public.daily_digest_deliveries(organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,delivered_at)
     values (current_setting('app.lifecycle_org')::uuid,'2026-08-01','86000000-0000-4000-8000-000000000101',repeat('f',64),'{"text":"forged","blocks":[]}','86000000-0000-4000-8000-000000000001','delivered',now()) $$,
  '42501',null,'even an Owner cannot directly forge a terminal delivery row'
);
select throws_ok(
  $$ select public.reserve_daily_digest_delivery(current_setting('app.lifecycle_org')::uuid,'2026-08-07',repeat('a',64),'{"text":"forged","blocks":[]}') $$,
  '42883',null,'an authenticated Owner cannot use the removed actor-less function'
);
select throws_ok(
  $$ select public.reserve_daily_digest_delivery_server(current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000101','2026-08-07',repeat('a',64),'{"text":"forged","blocks":[]}') $$,
  '42501',null,'an authenticated Owner cannot forge the actor through the server function'
);

select set_config('request.jwt.claims','{"sub":"86000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select set_config('app.lifecycle_other_org',public.create_organisation_with_owner('Lifecycle Other','lifecycle-other')::text,true);

set local role service_role;
select throws_ok(
  $$ select public.reserve_daily_digest_delivery_server(current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000002','86000000-0000-4000-8000-000000000101','2026-08-07',repeat('a',64),'{"text":"Daily","blocks":[]}') $$,
  '42501','daily digest action requires a workspace Owner','the backend rejects an Admin actor'
);
select throws_ok(
  $$ select public.reserve_daily_digest_delivery_server(current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000003','86000000-0000-4000-8000-000000000101','2026-08-07',repeat('a',64),'{"text":"Daily","blocks":[]}') $$,
  '42501','daily digest action requires a workspace Owner','the backend rejects a Member actor'
);
select throws_ok(
  $$ select public.reserve_daily_digest_delivery_server(current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000004','86000000-0000-4000-8000-000000000101','2026-08-07',repeat('a',64),'{"text":"Daily","blocks":[]}') $$,
  '42501','daily digest action requires a workspace Owner','the backend rejects a cross-tenant Owner actor'
);
select is((public.reserve_daily_digest_delivery_server(
  current_setting('app.lifecycle_other_org')::uuid,'86000000-0000-4000-8000-000000000004','86000000-0000-4000-8000-000000000101','2026-08-07',repeat('a',64),'{"text":"Daily","blocks":[]}'
)->>'state'),'no_digest_channel','the server chooses only a configured destination');

select set_config('app.first_reservation',public.reserve_daily_digest_delivery_server(
  current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000101','2026-08-07',repeat('a',64),
  '{"text":"ComplianceHub daily brief","blocks":[{"type":"section","text":{"type":"plain_text","text":"Exact original"}}]}'
)::text,true);
select is((current_setting('app.first_reservation')::jsonb->>'state'),'reserved','the first backend caller atomically reserves the organisation/date');
select is((current_setting('app.first_reservation')::jsonb->>'attemptNumber')::int,1,'the first reservation creates attempt one');
reset role;
select is((select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.lifecycle_org')::uuid and digest_on='2026-08-07'),1,'the unique organisation/date has exactly one reservation');
set local role service_role;
select is((public.reserve_daily_digest_delivery_server(
  current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000101','2026-08-07',repeat('a',64),'{"text":"Concurrent","blocks":[]}'
)->>'state'),'delivery_unknown','a repeated caller cannot create a second send path while reserved');
reset role;
select is((select message->'blocks'->0->'text'->>'text' from public.daily_digest_deliveries where id=(current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid),'Exact original','the exact outgoing payload is persisted before network delivery');
select is((select attempted_by from public.daily_digest_deliveries where id=(current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid),'86000000-0000-4000-8000-000000000001'::uuid,'delivery records the verified OAuth actor');
select is((select attempted_by from public.daily_digest_delivery_attempts where delivery_id=(current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid and attempt_number=1),'86000000-0000-4000-8000-000000000001'::uuid,'attempt records the verified OAuth actor');
select is((select count(*)::int from public.audit_events where organisation_id=current_setting('app.lifecycle_org')::uuid and entity_type in ('daily_digest_deliveries','daily_digest_delivery_attempts') and actor_id='86000000-0000-4000-8000-000000000001'),2,'generic audits retain the verified actor without message internals');
set local role service_role;
select ok(not public.finalize_daily_digest_delivery_server(
  (current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid,'86000000-0000-4000-8000-000000000005',1,'delivered',null
),'a different Owner cannot forge the reserved actor finalization');

reset role;
update public.alert_channels set enabled=false,daily_digest_enabled=false where id='86000000-0000-4000-8000-000000000101';
set local role service_role;
select ok(public.finalize_daily_digest_delivery_server(
  (current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid,'86000000-0000-4000-8000-000000000001',1,'delivered',null
),'finalization stays independent from later channel disablement');
reset role;
select is((select status::text from public.daily_digest_deliveries where id=(current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid),'delivered','the delivery has one terminal delivered outcome');
set local role service_role;
select ok(not public.finalize_daily_digest_delivery_server(
  (current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid,'86000000-0000-4000-8000-000000000001',1,'failed','SLACK_REJECTED'
),'CAS prevents replacing a terminal outcome');
select is((public.reserve_daily_digest_delivery_server(
  current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000101','2026-08-07',repeat('a',64),'{"text":"New","blocks":[]}'
)->>'state'),'already_posted','a delivered organisation/date cannot be reserved again');

reset role;
update public.alert_channels set enabled=true,daily_digest_enabled=true where id='86000000-0000-4000-8000-000000000101';
set local role service_role;
select set_config('app.disabled_reservation',public.reserve_daily_digest_delivery_server(
  current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000101','2026-08-08',repeat('b',64),'{"text":"Channel changed","blocks":[]}'
)::text,true);
select ok(public.finalize_daily_digest_delivery_server(
  (current_setting('app.disabled_reservation')::jsonb->>'deliveryId')::uuid,'86000000-0000-4000-8000-000000000001',1,'failed','NO_DIGEST_CHANNEL'
),'a disabled-before-send recheck can record a confirmed no-channel failure');
reset role;
select is((select error_code from public.daily_digest_deliveries where id=(current_setting('app.disabled_reservation')::jsonb->>'deliveryId')::uuid),'NO_DIGEST_CHANNEL','no-channel failure is durable and retryable');

set local role service_role;
select set_config('app.preflight_reservation',public.reserve_daily_digest_delivery_server(
  current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000101','2026-08-09',repeat('c',64),'{"text":"Preflight","blocks":[]}'
)::text,true);
select ok(public.finalize_daily_digest_delivery_server(
  (current_setting('app.preflight_reservation')::jsonb->>'deliveryId')::uuid,'86000000-0000-4000-8000-000000000001',1,'failed','INTERNAL_ERROR'
),'a database preflight failure is a confirmed failed outcome');
reset role;
select is((select error_code from public.daily_digest_deliveries where id=(current_setting('app.preflight_reservation')::jsonb->>'deliveryId')::uuid),'INTERNAL_ERROR','preflight failure stores only the stable safe error code');
set local role service_role;
select is((public.reserve_daily_digest_delivery_server(
  current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000101','2026-08-09',repeat('c',64),'{"text":"Ignored replacement","blocks":[]}'
)->>'attemptNumber')::int,2,'a confirmed INTERNAL_ERROR remains safely retryable');

select set_config('app.owner_a_retry',public.reserve_daily_digest_delivery_server(
  current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000101','2026-08-11',repeat('e',64),'{"text":"Owner retry","blocks":[]}'
)::text,true);
select is((current_setting('app.owner_a_retry')::jsonb->>'state'),'reserved','Owner A creates retry scenario attempt one');
select ok(public.finalize_daily_digest_delivery_server(
  (current_setting('app.owner_a_retry')::jsonb->>'deliveryId')::uuid,'86000000-0000-4000-8000-000000000001',1,'failed','SLACK_REJECTED'
),'Owner A records the confirmed attempt-one failure');
select set_config('app.owner_b_retry',public.reserve_daily_digest_delivery_server(
  current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000005','86000000-0000-4000-8000-000000000101','2026-08-11',repeat('e',64),'{"text":"Ignored replacement","blocks":[]}'
)::text,true);
select is((current_setting('app.owner_b_retry')::jsonb->>'attemptNumber')::int,2,'Owner B reserves attempt two');
reset role;
select is((select attempted_by from public.daily_digest_delivery_attempts
  where delivery_id=(current_setting('app.owner_b_retry')::jsonb->>'deliveryId')::uuid and attempt_number=2
),'86000000-0000-4000-8000-000000000005'::uuid,'attempt two is immutably bound to Owner B');
set local role service_role;
select ok(not public.finalize_daily_digest_delivery_server(
  (current_setting('app.owner_b_retry')::jsonb->>'deliveryId')::uuid,'86000000-0000-4000-8000-000000000001',2,'delivered',null
),'Owner A cannot finalize Owner B''s open retry attempt');
select ok(public.finalize_daily_digest_delivery_server(
  (current_setting('app.owner_b_retry')::jsonb->>'deliveryId')::uuid,'86000000-0000-4000-8000-000000000005',2,'delivered',null
),'Owner B can finalize the exact open retry attempt');
reset role;
select is((select status::text from public.daily_digest_deliveries
  where id=(current_setting('app.owner_b_retry')::jsonb->>'deliveryId')::uuid
),'delivered','the Owner B retry reaches the delivered terminal state');
select is((select count(*)::int from public.audit_events
  where organisation_id=current_setting('app.lifecycle_org')::uuid
    and entity_type='daily_digest_delivery_attempts'
    and entity_id=(select id::text from public.daily_digest_delivery_attempts
      where delivery_id=(current_setting('app.owner_b_retry')::jsonb->>'deliveryId')::uuid and attempt_number=2)
    and action='update'
    and actor_id='86000000-0000-4000-8000-000000000005'
),1,'retry finalization audit records Owner B as the exact attempt actor');

set local role service_role;
select set_config('app.demotion_reservation',public.reserve_daily_digest_delivery_server(
  current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000001','86000000-0000-4000-8000-000000000101','2026-08-10',repeat('d',64),'{"text":"Demotion race","blocks":[]}'
)::text,true);
select is((current_setting('app.demotion_reservation')::jsonb->>'state'),'reserved','the live Owner reserves before the external side effect');
reset role;
update public.memberships set role='member'
where organisation_id=current_setting('app.lifecycle_org')::uuid and user_id='86000000-0000-4000-8000-000000000001';
set local role service_role;
select ok(public.finalize_daily_digest_delivery_server(
  (current_setting('app.demotion_reservation')::jsonb->>'deliveryId')::uuid,'86000000-0000-4000-8000-000000000001',1,'delivered',null
),'the exact reserved actor can persist Slack success after demotion');
reset role;
select is((select status::text from public.daily_digest_deliveries where id=(current_setting('app.demotion_reservation')::jsonb->>'deliveryId')::uuid),'delivered','demotion cannot strand a confirmed Slack outcome as reserved');
select is((select attempted_by from public.daily_digest_deliveries where id=(current_setting('app.demotion_reservation')::jsonb->>'deliveryId')::uuid),'86000000-0000-4000-8000-000000000001'::uuid,'the immutable delivery actor retains original-delivery provenance');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"86000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok(
  $$ update public.daily_digest_delivery_attempts set error_code='forged' where delivery_id=(current_setting('app.disabled_reservation')::jsonb->>'deliveryId')::uuid $$,
  '42501',null,'attempt history cannot be rewritten directly'
);

select * from finish();
rollback;
