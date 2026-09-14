begin;
select plan(14);

select ok(
  coalesce((
    select constraint_row.convalidated
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid='public.daily_digest_deliveries'::pg_catalog.regclass
      and constraint_row.conname='daily_digest_deliveries_outcome_consistency'
  ),false),
  'the upgraded parent-outcome constraint exists and is validated'
);

select is((select error_code from public.daily_digest_deliveries where id='8b000000-0000-4000-8000-000000000201'),null,'reserved legacy error is cleared');
select is((select error_code from public.daily_digest_deliveries where id='8b000000-0000-4000-8000-000000000202'),null,'delivered legacy error is cleared');
select is((select error_code from public.daily_digest_deliveries where id='8b000000-0000-4000-8000-000000000203'),'INTERNAL_ERROR','failed legacy error becomes INTERNAL_ERROR');
select is((select error_code from public.daily_digest_deliveries where id='8b000000-0000-4000-8000-000000000204'),'DELIVERY_UNKNOWN','unknown legacy error becomes DELIVERY_UNKNOWN');
select is((select error_code from public.daily_digest_deliveries where id='8b000000-0000-4000-8000-000000000205'),'INTERNAL_ERROR','NULL failed error becomes INTERNAL_ERROR');
select is((select error_code from public.daily_digest_deliveries where id='8b000000-0000-4000-8000-000000000206'),'DELIVERY_UNKNOWN','NULL unknown error becomes DELIVERY_UNKNOWN');

select is(
  (select count(*)::int
   from public.daily_digest_deliveries delivery
   join public.daily_digest_delivery_attempts attempt
     on attempt.delivery_id=delivery.id and attempt.attempt_number=delivery.attempt_count
   where delivery.id in (
     '8b000000-0000-4000-8000-000000000202',
     '8b000000-0000-4000-8000-000000000203',
     '8b000000-0000-4000-8000-000000000204'
   )
     and delivery.status=attempt.outcome
     and delivery.error_code is not distinct from attempt.error_code),
  3,
  'every seeded terminal parent agrees with its immutable current attempt'
);
select is(
  (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',id,
    'attemptedBy',attempted_by,
    'startedAt',started_at,
    'finishedAt',finished_at,
    'outcome',outcome,
    'errorCode',error_code
  ) order by id) from public.daily_digest_delivery_attempts
   where id in (
     '8b000000-0000-4000-8000-000000000302',
     '8b000000-0000-4000-8000-000000000303',
     '8b000000-0000-4000-8000-000000000304'
   )),
  '[
    {"id":"8b000000-0000-4000-8000-000000000302","attemptedBy":"8b000000-0000-4000-8000-000000000001","startedAt":"2026-08-02T08:01:00+00:00","finishedAt":"2026-08-02T08:02:00+00:00","outcome":"delivered","errorCode":null},
    {"id":"8b000000-0000-4000-8000-000000000303","attemptedBy":"8b000000-0000-4000-8000-000000000001","startedAt":"2026-08-03T08:01:00+00:00","finishedAt":"2026-08-03T08:02:00+00:00","outcome":"failed","errorCode":"INTERNAL_ERROR"},
    {"id":"8b000000-0000-4000-8000-000000000304","attemptedBy":"8b000000-0000-4000-8000-000000000001","startedAt":"2026-08-04T08:01:00+00:00","finishedAt":"2026-08-04T08:02:00+00:00","outcome":"unknown","errorCode":"DELIVERY_UNKNOWN"}
  ]'::jsonb,
  'terminal attempt identity, timestamps, outcome, and error code remain byte-for-byte equivalent'
);
select is((select count(*)::int from public.daily_digest_delivery_attempts),3,'the parent migration neither creates nor deletes attempt history');

select throws_ok(
  $$ insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code)
     values ('8b000000-0000-4000-8000-000000000211','8b000000-0000-4000-8000-000000000010','2026-08-11','8b000000-0000-4000-8000-000000000101',repeat('1',64),'{}','8b000000-0000-4000-8000-000000000001','reserved','INTERNAL_ERROR') $$,
  '23514',null,'the upgraded constraint rejects a reserved error code'
);
select throws_ok(
  $$ insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code)
     values ('8b000000-0000-4000-8000-000000000212','8b000000-0000-4000-8000-000000000010','2026-08-12','8b000000-0000-4000-8000-000000000101',repeat('2',64),'{}','8b000000-0000-4000-8000-000000000001','failed','legacy') $$,
  '23514',null,'the upgraded constraint rejects an arbitrary failed error code'
);
select throws_ok(
  $$ insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code)
     values ('8b000000-0000-4000-8000-000000000213','8b000000-0000-4000-8000-000000000010','2026-08-13','8b000000-0000-4000-8000-000000000101',repeat('3',64),'{}','8b000000-0000-4000-8000-000000000001','failed',null) $$,
  '23514',null,'the upgraded constraint rejects a NULL failed error code'
);
select throws_ok(
  $$ insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code)
     values ('8b000000-0000-4000-8000-000000000214','8b000000-0000-4000-8000-000000000010','2026-08-14','8b000000-0000-4000-8000-000000000101',repeat('4',64),'{}','8b000000-0000-4000-8000-000000000001','unknown',null) $$,
  '23514',null,'the upgraded constraint rejects a NULL unknown error code'
);

select * from finish();
rollback;
