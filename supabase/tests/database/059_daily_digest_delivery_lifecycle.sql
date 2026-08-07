begin;
select plan(47);

select has_table('public','daily_digest_delivery_attempts','digest attempts have durable per-attempt history');
select has_function('public','reserve_daily_digest_delivery',array['uuid','date','text','jsonb'],'reservation uses one narrow RPC');
select has_function('public','finalize_daily_digest_delivery',array['uuid','integer','text','text'],'finalization uses one narrow CAS RPC');
select ok(not has_table_privilege('authenticated','public.daily_digest_deliveries','INSERT'),'authenticated cannot directly forge reservations');
select ok(not has_table_privilege('authenticated','public.daily_digest_deliveries','UPDATE'),'authenticated cannot directly forge outcomes');
select ok(not has_table_privilege('authenticated','public.daily_digest_deliveries','DELETE'),'authenticated cannot erase deliveries');
select ok(has_table_privilege('authenticated','public.daily_digest_deliveries','SELECT'),'Owner-scoped delivery reads remain exposed');
select ok(has_table_privilege('authenticated','public.daily_digest_delivery_attempts','SELECT'),'Owner-scoped attempt reads are exposed');
select ok(not has_table_privilege('authenticated','public.daily_digest_delivery_attempts','INSERT,UPDATE,DELETE'),'attempt writes are RPC-only and immutable');
select ok(has_function_privilege('authenticated','public.reserve_daily_digest_delivery(uuid,date,text,jsonb)','EXECUTE'),'authenticated may invoke guarded reservation');
select ok(has_function_privilege('authenticated','public.finalize_daily_digest_delivery(uuid,integer,text,text)','EXECUTE'),'authenticated may invoke guarded finalization');
select ok(not has_function_privilege('public','public.reserve_daily_digest_delivery(uuid,date,text,jsonb)','EXECUTE'),'PUBLIC cannot reserve');
select ok(not has_function_privilege('anon','public.reserve_daily_digest_delivery(uuid,date,text,jsonb)','EXECUTE'),'anon cannot reserve');
select ok(not has_function_privilege('service_role','public.reserve_daily_digest_delivery(uuid,date,text,jsonb)','EXECUTE'),'service role is outside the user-bound reservation API');
select ok(not has_function_privilege('public','public.finalize_daily_digest_delivery(uuid,integer,text,text)','EXECUTE'),'PUBLIC cannot finalize');
select ok(not has_function_privilege('anon','public.finalize_daily_digest_delivery(uuid,integer,text,text)','EXECUTE'),'anon cannot finalize');
select ok(not has_function_privilege('service_role','public.finalize_daily_digest_delivery(uuid,integer,text,text)','EXECUTE'),'service role is outside the user-bound finalization API');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('86000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-owner@example.test','',now(),'{}','{}'),
 ('86000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000000','authenticated','authenticated','lifecycle-admin@example.test','',now(),'{}','{}'),
 ('86000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000000','authenticated','authenticated','lifecycle-member@example.test','',now(),'{}','{}'),
 ('86000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000000','authenticated','authenticated','lifecycle-outsider@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"86000000-0000-4000-8000-000000000001","email":"lifecycle-owner@example.test","role":"authenticated"}',true);
select set_config('app.lifecycle_org',public.create_organisation_with_owner('Lifecycle Org','lifecycle-org')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000002','admin'),
 (current_setting('app.lifecycle_org')::uuid,'86000000-0000-4000-8000-000000000003','member');
insert into public.alert_channels(id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled)
values ('86000000-0000-4000-8000-000000000101',current_setting('app.lifecycle_org')::uuid,'slack','Digest','{"webhookUrl":"encrypted"}','86000000-0000-4000-8000-000000000001',true,true);

select throws_ok(
  $$ insert into public.daily_digest_deliveries(organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,delivered_at)
     values (current_setting('app.lifecycle_org')::uuid,'2026-08-01','86000000-0000-4000-8000-000000000101',repeat('f',64),'{"text":"forged","blocks":[]}','86000000-0000-4000-8000-000000000001','delivered',now()) $$,
  '42501',null,'even an Owner cannot forge a terminal delivery row'
);

select set_config('request.jwt.claims','{"sub":"86000000-0000-4000-8000-000000000002","email":"lifecycle-admin@example.test","role":"authenticated"}',true);
select throws_ok(
  $$ select public.reserve_daily_digest_delivery(current_setting('app.lifecycle_org')::uuid,'2026-08-07',repeat('a',64),'{"text":"Daily","blocks":[]}') $$,
  '42501','daily digest action requires a workspace Owner','an Admin cannot reserve'
);
select set_config('request.jwt.claims','{"sub":"86000000-0000-4000-8000-000000000003","email":"lifecycle-member@example.test","role":"authenticated"}',true);
select throws_ok(
  $$ select public.reserve_daily_digest_delivery(current_setting('app.lifecycle_org')::uuid,'2026-08-07',repeat('a',64),'{"text":"Daily","blocks":[]}') $$,
  '42501','daily digest action requires a workspace Owner','a Member cannot reserve'
);

select set_config('request.jwt.claims','{"sub":"86000000-0000-4000-8000-000000000004","email":"lifecycle-outsider@example.test","role":"authenticated"}',true);
select set_config('app.lifecycle_other_org',public.create_organisation_with_owner('Lifecycle Other','lifecycle-other')::text,true);
select throws_ok(
  $$ select public.reserve_daily_digest_delivery(current_setting('app.lifecycle_org')::uuid,'2026-08-07',repeat('a',64),'{"text":"Daily","blocks":[]}') $$,
  '42501','daily digest action requires a workspace Owner','an outsider cannot reserve'
);
select is((select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.lifecycle_org')::uuid),0,'an outsider cannot read delivery rows');
select is((public.reserve_daily_digest_delivery(current_setting('app.lifecycle_other_org')::uuid,'2026-08-07',repeat('a',64),'{"text":"Daily","blocks":[]}')->>'state'),'no_digest_channel','reservation never accepts a caller-selected destination');

select set_config('request.jwt.claims','{"sub":"86000000-0000-4000-8000-000000000001","email":"lifecycle-owner@example.test","role":"authenticated"}',true);
select set_config('app.first_reservation',public.reserve_daily_digest_delivery(
  current_setting('app.lifecycle_org')::uuid,'2026-08-07',repeat('a',64),
  '{"text":"ComplianceHub daily brief","blocks":[{"type":"section","text":{"type":"plain_text","text":"Exact original"}}]}'
)::text,true);
select is((current_setting('app.first_reservation')::jsonb->>'state'),'reserved','the first caller atomically reserves the organisation/date');
select is((current_setting('app.first_reservation')::jsonb->>'attemptNumber')::int,1,'the first reservation creates attempt one');
select is((select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.lifecycle_org')::uuid and digest_on='2026-08-07'),1,'the unique organisation/date has exactly one reservation');
select is((public.reserve_daily_digest_delivery(current_setting('app.lifecycle_org')::uuid,'2026-08-07',repeat('a',64),'{"text":"Concurrent","blocks":[]}')->>'state'),'delivery_unknown','a concurrent or repeated caller never sends while the attempt is reserved');
select is((select count(*)::int from public.daily_digest_delivery_attempts where delivery_id=(current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid),1,'one attempt history row exists before network delivery');
select is((select fact_hash from public.daily_digest_deliveries where id=(current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid),repeat('a',64),'the fact hash is persisted before network delivery');
select is((select message->'blocks'->0->'text'->>'text' from public.daily_digest_deliveries where id=(current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid),'Exact original','the exact outgoing payload is persisted before network delivery');

update public.alert_channels set enabled=false,daily_digest_enabled=false where id='86000000-0000-4000-8000-000000000101';
select ok(public.finalize_daily_digest_delivery((current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid,1,'delivered',null),'finalization succeeds even if the channel is disabled after reservation');
select is((select status::text from public.daily_digest_deliveries where id=(current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid),'delivered','the delivery has one terminal delivered outcome');
select ok((select delivered_at is not null from public.daily_digest_deliveries where id=(current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid),'delivered_at is set only for delivered');
select is((select outcome::text from public.daily_digest_delivery_attempts where delivery_id=(current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid and attempt_number=1),'delivered','attempt history records the safe terminal outcome');
select ok(not public.finalize_daily_digest_delivery((current_setting('app.first_reservation')::jsonb->>'deliveryId')::uuid,1,'failed','SLACK_REJECTED'),'CAS prevents replacing a terminal outcome');
select is((public.reserve_daily_digest_delivery(current_setting('app.lifecycle_org')::uuid,'2026-08-07',repeat('a',64),'{"text":"New","blocks":[]}')->>'state'),'already_posted','a delivered organisation/date cannot be reserved again');

update public.alert_channels set enabled=true,daily_digest_enabled=true where id='86000000-0000-4000-8000-000000000101';
select set_config('app.failed_reservation',public.reserve_daily_digest_delivery(current_setting('app.lifecycle_org')::uuid,'2026-08-08',repeat('b',64),'{"text":"Immutable retry payload","blocks":[]}')::text,true);
select ok(public.finalize_daily_digest_delivery((current_setting('app.failed_reservation')::jsonb->>'deliveryId')::uuid,1,'failed','SLACK_REJECTED'),'a confirmed Slack rejection is finalized as failed');
select ok((select delivered_at is null from public.daily_digest_deliveries where id=(current_setting('app.failed_reservation')::jsonb->>'deliveryId')::uuid),'failed delivery has no delivered_at');
update public.alert_channels set enabled=false,daily_digest_enabled=false where id='86000000-0000-4000-8000-000000000101';
select is((public.reserve_daily_digest_delivery(current_setting('app.lifecycle_org')::uuid,'2026-08-08',repeat('b',64),'{"text":"Do not send","blocks":[]}')->>'state'),'no_digest_channel','a failed delivery is not retried after its configured channel is disabled');
update public.alert_channels set enabled=true,daily_digest_enabled=true where id='86000000-0000-4000-8000-000000000101';
select set_config('app.retry_reservation',public.reserve_daily_digest_delivery(current_setting('app.lifecycle_org')::uuid,'2026-08-08',repeat('b',64),'{"text":"Replacement must not send","blocks":[]}')::text,true);
select is((current_setting('app.retry_reservation')::jsonb->>'attemptNumber')::int,2,'only a confirmed failure may be explicitly retried');
select is((current_setting('app.retry_reservation')::jsonb->'message'->>'text'),'Immutable retry payload','retry returns the immutable originally persisted payload');
select is((select count(*)::int from public.daily_digest_delivery_attempts where delivery_id=(current_setting('app.failed_reservation')::jsonb->>'deliveryId')::uuid),2,'retry appends a second attempt history row');
select ok(public.finalize_daily_digest_delivery((current_setting('app.retry_reservation')::jsonb->>'deliveryId')::uuid,2,'unknown','DELIVERY_UNKNOWN'),'an ambiguous external result becomes terminal unknown');
select is((public.reserve_daily_digest_delivery(current_setting('app.lifecycle_org')::uuid,'2026-08-08',repeat('b',64),'{"text":"Never resend","blocks":[]}')->>'state'),'delivery_unknown','unknown delivery is never automatically retried');

select throws_ok(
  $$ update public.daily_digest_delivery_attempts set error_code='forged' where delivery_id=(current_setting('app.failed_reservation')::jsonb->>'deliveryId')::uuid $$,
  '42501',null,'attempt history cannot be rewritten directly'
);
select is((select count(*)::int from public.audit_events where organisation_id=current_setting('app.lifecycle_org')::uuid and entity_type='daily_digest_deliveries' and metadata='{}'::jsonb),6,'generic delivery audits contain no message or webhook internals');
select is((select count(*)::int from public.audit_events where organisation_id=current_setting('app.lifecycle_org')::uuid and entity_type='daily_digest_delivery_attempts' and metadata='{}'::jsonb),6,'generic attempt audits contain only safe empty metadata');

select * from finish();
rollback;
