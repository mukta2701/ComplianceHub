begin;
select plan(22);

select has_function(
  'public',
  'expire_abandoned_daily_digest_deliveries_server',
  array['uuid','date'],
  'abandoned digest reservations have a server-only recovery boundary'
);
select ok(
  pg_catalog.has_function_privilege('service_role','public.expire_abandoned_daily_digest_deliveries_server(uuid,date)','EXECUTE'),
  'the backend service may reconcile abandoned reservations'
);
select ok(
  not pg_catalog.has_function_privilege('authenticated','public.expire_abandoned_daily_digest_deliveries_server(uuid,date)','EXECUTE'),
  'authenticated users cannot rewrite abandoned delivery state'
);
select ok(
  not pg_catalog.has_function_privilege('anon','public.expire_abandoned_daily_digest_deliveries_server(uuid,date)','EXECUTE'),
  'anonymous users cannot reconcile deliveries'
);
select ok(
  not pg_catalog.has_function_privilege('public','public.expire_abandoned_daily_digest_deliveries_server(uuid,date)','EXECUTE'),
  'PUBLIC cannot reconcile deliveries'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('89000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','abandoned-digest-owner@example.test','',now(),'{}','{}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"89000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.abandoned_digest_org',public.create_organisation_with_owner('Abandoned Digest Org','abandoned-digest-org')::text,true);
insert into public.alert_channels(id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled)
values ('89000000-0000-4000-8000-000000000101',current_setting('app.abandoned_digest_org')::uuid,'slack','Digest','{"webhookUrl":"encrypted"}','89000000-0000-4000-8000-000000000001',true,false);
select public.set_daily_digest_channel(
  current_setting('app.abandoned_digest_org')::uuid,
  '89000000-0000-4000-8000-000000000101'
);

reset role;
insert into public.daily_digest_deliveries(
  id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,
  attempt_count,status,reserved_at,last_attempted_at
) values (
  '89000000-0000-4000-8000-000000000201',current_setting('app.abandoned_digest_org')::uuid,
  '2026-08-07','89000000-0000-4000-8000-000000000101',repeat('a',64),
  '{"text":"Abandoned","blocks":[]}','89000000-0000-4000-8000-000000000001',
  1,'reserved',now()-interval '1 hour',now()-interval '1 hour'
);
insert into public.daily_digest_delivery_attempts(
  id,delivery_id,organisation_id,attempt_number,attempted_by,started_at
) values (
  '89000000-0000-4000-8000-000000000301','89000000-0000-4000-8000-000000000201',
  current_setting('app.abandoned_digest_org')::uuid,1,'89000000-0000-4000-8000-000000000001',now()-interval '1 hour'
);

select set_config('request.jwt.claims','{}',true);
set local role service_role;
select is(
  public.expire_abandoned_daily_digest_deliveries_server(current_setting('app.abandoned_digest_org')::uuid,'2026-08-07'),
  1,
  'one stale reservation is classified without creating a retry path'
);
reset role;
select is(
  (select status::text from public.daily_digest_deliveries where id='89000000-0000-4000-8000-000000000201'),
  'unknown',
  'the abandoned delivery becomes terminal unknown'
);
select is(
  (select error_code from public.daily_digest_deliveries where id='89000000-0000-4000-8000-000000000201'),
  'DELIVERY_UNKNOWN',
  'the delivery stores only the stable review code'
);
select is(
  (select outcome::text from public.daily_digest_delivery_attempts where id='89000000-0000-4000-8000-000000000301'),
  'unknown',
  'the exact abandoned attempt is closed as unknown'
);
select ok(
  (select error_code='DELIVERY_UNKNOWN' and finished_at is not null
   from public.daily_digest_delivery_attempts where id='89000000-0000-4000-8000-000000000301'),
  'the attempt records a safe code and completion time'
);
select is(
  (select count(*)::int from public.audit_events
   where entity_id in ('89000000-0000-4000-8000-000000000201','89000000-0000-4000-8000-000000000301')
     and action='update'
     and actor_id is null),
  2,
  'automated recovery audit events are attributed to the system rather than a stale Owner claim'
);
set local role service_role;
select is(
  public.expire_abandoned_daily_digest_deliveries_server(current_setting('app.abandoned_digest_org')::uuid,'2026-08-07'),
  0,
  'recovery is idempotent'
);
select is(
  (public.reserve_daily_digest_delivery_server(
    current_setting('app.abandoned_digest_org')::uuid,'89000000-0000-4000-8000-000000000001',
    '2026-08-07',repeat('a',64),'{"text":"Replacement","blocks":[]}'
  )->>'state'),
  'delivery_unknown',
  'an unknown abandoned send can never be retried automatically'
);

reset role;
insert into public.daily_digest_deliveries(
  id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,
  attempt_count,status,reserved_at,last_attempted_at
) values (
  '89000000-0000-4000-8000-000000000202',current_setting('app.abandoned_digest_org')::uuid,
  '2026-08-09','89000000-0000-4000-8000-000000000101',repeat('c',64),
  '{"text":"Legacy abandoned","blocks":[]}','89000000-0000-4000-8000-000000000001',
  1,'reserved',now()-interval '1 hour',now()-interval '1 hour'
);
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select is(
  public.expire_abandoned_daily_digest_deliveries_server(current_setting('app.abandoned_digest_org')::uuid,'2026-08-09'),
  1,
  'a legacy reservation without attempt history cannot poison recovery'
);
reset role;
select is(
  (select status::text from public.daily_digest_deliveries where id='89000000-0000-4000-8000-000000000202'),
  'unknown',
  'the legacy delivery is conservatively terminal unknown'
);
select is(
  (select outcome::text from public.daily_digest_delivery_attempts
   where delivery_id='89000000-0000-4000-8000-000000000202' and attempt_number=1),
  'unknown',
  'recovery synthesizes safe terminal history for the legacy attempt'
);

reset role;
insert into public.daily_digest_deliveries(
  id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,
  attempt_count,status,reserved_at,last_attempted_at
) values (
  '89000000-0000-4000-8000-000000000203',current_setting('app.abandoned_digest_org')::uuid,
  '2026-08-10','89000000-0000-4000-8000-000000000101',repeat('d',64),
  '{"text":"Conflicting legacy history","blocks":[]}','89000000-0000-4000-8000-000000000001',
  1,'reserved',now()-interval '1 hour',now()-interval '1 hour'
);
insert into public.daily_digest_delivery_attempts(
  id,delivery_id,organisation_id,attempt_number,attempted_by,started_at,finished_at,outcome
) values (
  '89000000-0000-4000-8000-000000000303','89000000-0000-4000-8000-000000000203',
  current_setting('app.abandoned_digest_org')::uuid,1,'89000000-0000-4000-8000-000000000001',
  now()-interval '1 hour',now()-interval '55 minutes','delivered'
);
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select is(
  public.expire_abandoned_daily_digest_deliveries_server(current_setting('app.abandoned_digest_org')::uuid,'2026-08-10'),
  1,
  'recovery reconciles a legacy reservation whose immutable attempt is already terminal'
);
reset role;
select is(
  (select status::text from public.daily_digest_deliveries where id='89000000-0000-4000-8000-000000000203'),
  'delivered',
  'the parent adopts the immutable current attempt outcome instead of contradicting it'
);
select ok(
  (select delivered_at is not null from public.daily_digest_deliveries where id='89000000-0000-4000-8000-000000000203'),
  'reconciled delivery history receives a delivered timestamp'
);
select is(
  (select outcome::text from public.daily_digest_delivery_attempts where id='89000000-0000-4000-8000-000000000303'),
  'delivered',
  'recovery never rewrites an immutable terminal attempt'
);

set local role service_role;
select set_config('app.fresh_reservation',public.reserve_daily_digest_delivery_server(
  current_setting('app.abandoned_digest_org')::uuid,'89000000-0000-4000-8000-000000000001',
  '2026-08-08',repeat('b',64),'{"text":"Fresh","blocks":[]}'
)::text,true);
select is(
  public.expire_abandoned_daily_digest_deliveries_server(current_setting('app.abandoned_digest_org')::uuid,'2026-08-08'),
  0,
  'a fresh in-flight reservation is not classified as abandoned'
);
reset role;
select is(
  (select status::text from public.daily_digest_deliveries where id=(current_setting('app.fresh_reservation')::jsonb->>'deliveryId')::uuid),
  'reserved',
  'the fresh reservation remains available for normal finalization'
);

select * from finish();
rollback;
