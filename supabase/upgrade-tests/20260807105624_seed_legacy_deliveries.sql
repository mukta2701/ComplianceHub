-- This fixture is loaded only after the disposable database has been reset to
-- 20260807047000, immediately before the parent-outcome migration under test.
do $upgrade_fixture$
begin
insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) values (
  '8b000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','legacy-digest-upgrade@example.test','',now(),'{}','{}'
);

insert into public.organisations(id,name,slug,created_by) values (
  '8b000000-0000-4000-8000-000000000010',
  'Legacy Digest Upgrade','legacy-digest-upgrade','8b000000-0000-4000-8000-000000000001'
);
insert into public.memberships(organisation_id,user_id,role) values (
  '8b000000-0000-4000-8000-000000000010','8b000000-0000-4000-8000-000000000001','owner'
);
insert into public.alert_channels(
  id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled
) values (
  '8b000000-0000-4000-8000-000000000101',
  '8b000000-0000-4000-8000-000000000010',
  'slack','Legacy upgrade','{"webhookUrl":"encrypted"}',
  '8b000000-0000-4000-8000-000000000001',true,false
);

insert into public.daily_digest_deliveries(
  id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,
  attempt_count,status,error_code,reserved_at,last_attempted_at,delivered_at
) values
  (
    '8b000000-0000-4000-8000-000000000201','8b000000-0000-4000-8000-000000000010',
    '2026-08-01','8b000000-0000-4000-8000-000000000101',repeat('a',64),'{}',
    '8b000000-0000-4000-8000-000000000001',1,'reserved','legacy-reserved',
    '2026-08-01 08:00:00+00','2026-08-01 08:00:00+00',null
  ),
  (
    '8b000000-0000-4000-8000-000000000202','8b000000-0000-4000-8000-000000000010',
    '2026-08-02','8b000000-0000-4000-8000-000000000101',repeat('b',64),'{}',
    '8b000000-0000-4000-8000-000000000001',1,'delivered','legacy-delivered',
    '2026-08-02 08:00:00+00','2026-08-02 08:01:00+00','2026-08-02 08:02:00+00'
  ),
  (
    '8b000000-0000-4000-8000-000000000203','8b000000-0000-4000-8000-000000000010',
    '2026-08-03','8b000000-0000-4000-8000-000000000101',repeat('c',64),'{}',
    '8b000000-0000-4000-8000-000000000001',1,'failed','legacy-failed',
    '2026-08-03 08:00:00+00','2026-08-03 08:01:00+00',null
  ),
  (
    '8b000000-0000-4000-8000-000000000204','8b000000-0000-4000-8000-000000000010',
    '2026-08-04','8b000000-0000-4000-8000-000000000101',repeat('d',64),'{}',
    '8b000000-0000-4000-8000-000000000001',1,'unknown','legacy-unknown',
    '2026-08-04 08:00:00+00','2026-08-04 08:01:00+00',null
  ),
  (
    '8b000000-0000-4000-8000-000000000205','8b000000-0000-4000-8000-000000000010',
    '2026-08-05','8b000000-0000-4000-8000-000000000101',repeat('e',64),'{}',
    '8b000000-0000-4000-8000-000000000001',1,'failed',null,
    '2026-08-05 08:00:00+00','2026-08-05 08:01:00+00',null
  ),
  (
    '8b000000-0000-4000-8000-000000000206','8b000000-0000-4000-8000-000000000010',
    '2026-08-06','8b000000-0000-4000-8000-000000000101',repeat('f',64),'{}',
    '8b000000-0000-4000-8000-000000000001',1,'unknown',null,
    '2026-08-06 08:00:00+00','2026-08-06 08:01:00+00',null
  );

-- Three already-terminal attempts are the immutable history the parent
-- backfill must agree with, never rewrite.
insert into public.daily_digest_delivery_attempts(
  id,delivery_id,organisation_id,attempt_number,attempted_by,
  started_at,finished_at,outcome,error_code
) values
  (
    '8b000000-0000-4000-8000-000000000302','8b000000-0000-4000-8000-000000000202',
    '8b000000-0000-4000-8000-000000000010',1,'8b000000-0000-4000-8000-000000000001',
    '2026-08-02 08:01:00+00','2026-08-02 08:02:00+00','delivered',null
  ),
  (
    '8b000000-0000-4000-8000-000000000303','8b000000-0000-4000-8000-000000000203',
    '8b000000-0000-4000-8000-000000000010',1,'8b000000-0000-4000-8000-000000000001',
    '2026-08-03 08:01:00+00','2026-08-03 08:02:00+00','failed','INTERNAL_ERROR'
  ),
  (
    '8b000000-0000-4000-8000-000000000304','8b000000-0000-4000-8000-000000000204',
    '8b000000-0000-4000-8000-000000000010',1,'8b000000-0000-4000-8000-000000000001',
    '2026-08-04 08:01:00+00','2026-08-04 08:02:00+00','unknown','DELIVERY_UNKNOWN'
  );
end
$upgrade_fixture$;
