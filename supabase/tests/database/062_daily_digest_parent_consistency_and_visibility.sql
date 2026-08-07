begin;
select plan(20);

select ok(
  coalesce((
    select constraint_row.convalidated
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.daily_digest_deliveries'::pg_catalog.regclass
      and constraint_row.conname = 'daily_digest_deliveries_outcome_consistency'
  ), false),
  'the parent delivery outcome consistency constraint exists and is validated'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('8a000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-visible-owner@example.test','',now(),'{}','{}'),
 ('8a000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-visible-admin@example.test','',now(),'{}','{}'),
 ('8a000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-visible-member@example.test','',now(),'{}','{}'),
 ('8a000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-visible-outsider@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.digest_visibility_org',public.create_organisation_with_owner('Digest Visibility','digest-visibility')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.digest_visibility_org')::uuid,'8a000000-0000-4000-8000-000000000002','admin'),
 (current_setting('app.digest_visibility_org')::uuid,'8a000000-0000-4000-8000-000000000003','member');
insert into public.alert_channels(id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled)
values ('8a000000-0000-4000-8000-000000000101',current_setting('app.digest_visibility_org')::uuid,'slack','Digest','{"webhookUrl":"encrypted"}','8a000000-0000-4000-8000-000000000001',true,false);

select set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select set_config('app.digest_visibility_other_org',public.create_organisation_with_owner('Other Digest Visibility','other-digest-visibility')::text,true);

reset role;
insert into public.daily_digest_deliveries(
  id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,
  attempt_count,status,error_code,reserved_at,last_attempted_at
) values (
  '8a000000-0000-4000-8000-000000000201',current_setting('app.digest_visibility_org')::uuid,
  '2026-08-07','8a000000-0000-4000-8000-000000000101',repeat('a',64),
  '{"text":"Failed","blocks":[]}','8a000000-0000-4000-8000-000000000001',
  1,'failed','INTERNAL_ERROR',now(),now()
);
insert into public.daily_digest_delivery_attempts(
  id,delivery_id,organisation_id,attempt_number,attempted_by,started_at,finished_at,outcome,error_code
) values (
  '8a000000-0000-4000-8000-000000000301','8a000000-0000-4000-8000-000000000201',
  current_setting('app.digest_visibility_org')::uuid,1,'8a000000-0000-4000-8000-000000000001',
  now(),now(),'failed','INTERNAL_ERROR'
);

select is(
  (select count(*)::int from public.daily_digest_deliveries where not (
    (status = 'reserved' and error_code is null)
    or (status = 'delivered' and error_code is null)
    or (status = 'failed' and error_code in ('SLACK_REJECTED','RATE_LIMITED','NO_DIGEST_CHANNEL','INTERNAL_ERROR'))
    or (status = 'unknown' and error_code = 'DELIVERY_UNKNOWN')
  )),
  0,
  'the migration backfill leaves every existing parent with a stable status-specific error code'
);
select throws_ok(
  $$ insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code)
     values ('8a000000-0000-4000-8000-000000000211',current_setting('app.digest_visibility_org')::uuid,'2026-08-08','8a000000-0000-4000-8000-000000000101',repeat('b',64),'{}','8a000000-0000-4000-8000-000000000001','reserved','INTERNAL_ERROR') $$,
  '23514',null,'reserved parents cannot retain an error code'
);
select throws_ok(
  $$ insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code)
     values ('8a000000-0000-4000-8000-000000000212',current_setting('app.digest_visibility_org')::uuid,'2026-08-09','8a000000-0000-4000-8000-000000000101',repeat('c',64),'{}','8a000000-0000-4000-8000-000000000001','failed','arbitrary') $$,
  '23514',null,'failed parents accept only stable failure codes'
);
select throws_ok(
  $$ insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code)
     values ('8a000000-0000-4000-8000-000000000213',current_setting('app.digest_visibility_org')::uuid,'2026-08-10','8a000000-0000-4000-8000-000000000101',repeat('d',64),'{}','8a000000-0000-4000-8000-000000000001','unknown','INTERNAL_ERROR') $$,
  '23514',null,'unknown parents require DELIVERY_UNKNOWN'
);
select throws_ok(
  $$ insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code)
     values ('8a000000-0000-4000-8000-000000000215',current_setting('app.digest_visibility_org')::uuid,'2026-08-12','8a000000-0000-4000-8000-000000000101',repeat('f',64),'{}','8a000000-0000-4000-8000-000000000001','failed',null) $$,
  '23514',null,'failed parents require a stable failure code rather than NULL'
);
select throws_ok(
  $$ insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code)
     values ('8a000000-0000-4000-8000-000000000216',current_setting('app.digest_visibility_org')::uuid,'2026-08-13','8a000000-0000-4000-8000-000000000101',repeat('0',64),'{}','8a000000-0000-4000-8000-000000000001','unknown',null) $$,
  '23514',null,'unknown parents require DELIVERY_UNKNOWN rather than NULL'
);
select lives_ok(
  $$ insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code)
     values ('8a000000-0000-4000-8000-000000000214',current_setting('app.digest_visibility_org')::uuid,'2026-08-11','8a000000-0000-4000-8000-000000000101',repeat('e',64),'{}','8a000000-0000-4000-8000-000000000001','unknown','DELIVERY_UNKNOWN') $$,
  'the stable unknown combination remains valid'
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.digest_visibility_org')::uuid),2,'an Owner sees delivery history for their workspace');
select is((select count(*)::int from public.daily_digest_delivery_attempts where organisation_id=current_setting('app.digest_visibility_org')::uuid),1,'an Owner sees attempt history for their workspace');
select is((select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.digest_visibility_other_org')::uuid),0,'an Owner cannot see another workspace delivery history');
select is((select count(*)::int from public.daily_digest_delivery_attempts where organisation_id=current_setting('app.digest_visibility_other_org')::uuid),0,'an Owner cannot see another workspace attempt history');

select set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.digest_visibility_org')::uuid),0,'an Admin cannot see delivery history');
select is((select count(*)::int from public.daily_digest_delivery_attempts where organisation_id=current_setting('app.digest_visibility_org')::uuid),0,'an Admin cannot see attempt history');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.digest_visibility_org')::uuid),0,'a Member cannot see delivery history');
select is((select count(*)::int from public.daily_digest_delivery_attempts where organisation_id=current_setting('app.digest_visibility_org')::uuid),0,'a Member cannot see attempt history');
select set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.digest_visibility_org')::uuid),0,'a cross-tenant Owner cannot see delivery history');
select is((select count(*)::int from public.daily_digest_delivery_attempts where organisation_id=current_setting('app.digest_visibility_org')::uuid),0,'a cross-tenant Owner cannot see attempt history');

reset role;
update public.memberships set role='owner'
where organisation_id=current_setting('app.digest_visibility_org')::uuid
  and user_id='8a000000-0000-4000-8000-000000000002';
update public.memberships set role='member'
where organisation_id=current_setting('app.digest_visibility_org')::uuid
  and user_id='8a000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"8a000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*)::int from public.daily_digest_deliveries where organisation_id=current_setting('app.digest_visibility_org')::uuid),0,'a demoted Owner immediately loses delivery-history visibility');
select is((select count(*)::int from public.daily_digest_delivery_attempts where organisation_id=current_setting('app.digest_visibility_org')::uuid),0,'a demoted Owner immediately loses attempt-history visibility');

select * from finish();
rollback;
