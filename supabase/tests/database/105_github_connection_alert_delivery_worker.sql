begin;
set local session_replication_role = replica;

delete from public.alert_deliveries where organisation_id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.notifications where organisation_id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.alert_channels where organisation_id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.github_installations where organisation_id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.memberships where organisation_id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.organisations where id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.profiles where id::text like '8f000000-0000-4111-8111-00000000000%';
delete from auth.users where id::text like '8f000000-0000-4111-8111-00000000000%';
commit;

select no_plan();

select ok(
  has_function_privilege(
    'service_role',
    'public.queue_github_connection_alert_delivery(uuid,uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  ),
  'service role may queue connection Slack work'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_github_connection_alert_delivery(text)',
    'EXECUTE'
  ),
  'authenticated callers cannot claim connection Slack work'
);

begin;
set local session_replication_role = replica;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('8f000000-0000-4111-8111-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'connection-worker-owner@example.test', '', now(), '{}', '{}'),
  ('8f000000-0000-4111-8111-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'connection-worker-admin@example.test', '', now(), '{}', '{}'),
  ('8f000000-0000-4111-8111-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'connection-worker-member@example.test', '', now(), '{}', '{}'),
  ('8f000000-0000-4111-8111-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'connection-worker-other@example.test', '', now(), '{}', '{}');

insert into public.profiles(id) values
  ('8f000000-0000-4111-8111-000000000001'),
  ('8f000000-0000-4111-8111-000000000002'),
  ('8f000000-0000-4111-8111-000000000003'),
  ('8f000000-0000-4111-8111-000000000004');

insert into public.organisations(id, name, slug, created_by) values
  ('8f000000-0000-4111-8111-000000000101', 'Connection Worker A', 'connection-worker-a',
   '8f000000-0000-4111-8111-000000000001'),
  ('8f000000-0000-4111-8111-000000000102', 'Connection Worker B', 'connection-worker-b',
   '8f000000-0000-4111-8111-000000000004');

insert into public.memberships(organisation_id, user_id, role) values
  ('8f000000-0000-4111-8111-000000000101', '8f000000-0000-4111-8111-000000000001', 'owner'),
  ('8f000000-0000-4111-8111-000000000101', '8f000000-0000-4111-8111-000000000002', 'admin'),
  ('8f000000-0000-4111-8111-000000000101', '8f000000-0000-4111-8111-000000000003', 'member'),
  ('8f000000-0000-4111-8111-000000000102', '8f000000-0000-4111-8111-000000000004', 'owner');

insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status
) values
  ('8f000000-0000-4111-8111-000000000201', '8f000000-0000-4111-8111-000000000101',
   8910201, 8920201, 'Connection-Worker-A', 'Organization', 'selected', 'active'),
  ('8f000000-0000-4111-8111-000000000202', '8f000000-0000-4111-8111-000000000102',
   8910202, 8920202, 'Connection-Worker-B', 'Organization', 'selected', 'active');

insert into public.alert_channels(
  id, organisation_id, type, connected_by, min_severity, enabled
) values
  ('8f000000-0000-4111-8111-000000000301', '8f000000-0000-4111-8111-000000000101',
   'slack', '8f000000-0000-4111-8111-000000000001', 'high', true),
  ('8f000000-0000-4111-8111-000000000302', '8f000000-0000-4111-8111-000000000101',
   'slack', '8f000000-0000-4111-8111-000000000001', 'high', false);

insert into public.alert_deliveries(
  id, organisation_id, channel_id, kind, subject_type, subject_id,
  scope_key, idempotency_key, safe_payload, delivery_on
) values (
  '8f000000-0000-4111-8111-000000000401',
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000301',
  'monitoring_finding', 'monitoring_finding', 'finding-connection-worker',
  'finding:8f00000000000000000000000000000000000000000000000000000000000001',
  '8f00000000000000000000000000000000000000000000000000000000000001',
  '{"type":"monitoring_finding","severity":"high","title":"Monitoring finding","controlRef":"MON-1","subjectId":"finding-connection-worker","detail":"Monitoring remains outside the connection worker."}'::jsonb,
  current_date
);
commit;

select is(
  (select public.queue_github_connection_alert_delivery(
    '8f000000-0000-4111-8111-000000000101',
    '8f000000-0000-4111-8111-000000000301',
    '8f000000-0000-4111-8111-000000000201',
    'incident', 'permission_mismatch',
    '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"Connection health","subjectId":"Connection-Worker-A","detail":"Review the GitHub connection."}'::jsonb
  )),
  true,
  'the first connection alert queue call returns true'
);

select is(
  (select public.queue_github_connection_alert_delivery(
    '8f000000-0000-4111-8111-000000000101',
    '8f000000-0000-4111-8111-000000000301',
    '8f000000-0000-4111-8111-000000000201',
    'incident', 'permission_mismatch',
    '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"Connection health","subjectId":"Connection-Worker-A","detail":"Review the GitHub connection."}'::jsonb
  )),
  false,
  'an identical connection alert queue call returns false'
);

select is(
  (select count(*) from public.alert_deliveries
   where id = '8f000000-0000-4111-8111-000000000401'
      or (organisation_id = '8f000000-0000-4111-8111-000000000101'
          and kind = 'github_connection_health')),
  2::bigint,
  'the queue contains exactly one monitoring row and one connection row'
);
select is(
  (select status from public.alert_deliveries
   where organisation_id = '8f000000-0000-4111-8111-000000000101'
     and kind = 'github_connection_health'),
  'queued',
  'queueing does not acquire a lease'
);
select is(
  (select attempt_count from public.alert_deliveries
   where organisation_id = '8f000000-0000-4111-8111-000000000101'
     and kind = 'github_connection_health'),
  0,
  'a queued connection alert has no attempts'
);
select is(
  (select count(*) from public.alert_deliveries
   where organisation_id = '8f000000-0000-4111-8111-000000000101'
     and kind = 'github_connection_health'
     and locked_at is null and locked_by is null and lock_token is null),
  1::bigint,
  'a queued connection alert has no lock fields'
);

select throws_ok(
  $$ select public.queue_github_connection_alert_delivery(
       '8f000000-0000-4111-8111-000000000101',
       '8f000000-0000-4111-8111-000000000301',
       '8f000000-0000-4111-8111-000000000202',
       'incident', 'permission_mismatch',
       '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"Connection health","subjectId":"Connection-Worker-B","detail":"Cross-workspace installation."}'::jsonb
     ) $$,
  '42501', null,
  'a cross-workspace installation is rejected'
);

select throws_ok(
  $$ select public.queue_github_connection_alert_delivery(
       '8f000000-0000-4111-8111-000000000101',
       '8f000000-0000-4111-8111-000000000301',
       '8f000000-0000-4111-8111-000000000201',
       'incident', 'permission_mismatch',
       '{"type":"connection_health","severity":"high","title":"bad\n title","controlRef":"Connection health","subjectId":"Connection-Worker-A","detail":"Malformed payload."}'::jsonb
     ) $$,
  '22023', null,
  'a malformed safe payload is rejected'
);

select throws_ok(
  $$ select public.queue_github_connection_alert_delivery(
       '8f000000-0000-4111-8111-000000000101',
       '8f000000-0000-4111-8111-000000000302',
       '8f000000-0000-4111-8111-000000000201',
       'incident', 'permission_mismatch',
       '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"Connection health","subjectId":"Connection-Worker-A","detail":"Disabled destination."}'::jsonb
     ) $$,
  'P0001', null,
  'a disabled Slack channel is rejected'
);

create temporary table connection_worker_monitor_snapshot as
select to_jsonb(delivery) as row_value
from public.alert_deliveries as delivery
where delivery.id = '8f000000-0000-4111-8111-000000000401';

update public.alert_deliveries
set status = 'running', attempt_count = 1,
    locked_at = clock_timestamp() - interval '6 minutes',
    locked_by = 'old-connection-worker',
    lock_token = '8f000000-0000-4111-8111-000000000901',
    last_attempt_at = clock_timestamp() - interval '6 minutes',
    updated_at = clock_timestamp() - interval '6 minutes'
where organisation_id = '8f000000-0000-4111-8111-000000000101'
  and kind = 'github_connection_health';

set role service_role;
create temporary table connection_worker_claim as
select * from public.claim_github_connection_alert_delivery('connection-worker-1');
reset role;

select is(
  (select count(*) from connection_worker_claim),
  1::bigint,
  'a connection claim returns one row'
);
select is(
  (select delivery_id from connection_worker_claim),
  (select id from public.alert_deliveries
   where organisation_id = '8f000000-0000-4111-8111-000000000101'
     and kind = 'github_connection_health'),
  'the claim returns only the GitHub connection delivery'
);
select is(
  (select attempt_count from connection_worker_claim),
  2,
  'stale connection work is recovered and claimed with the next attempt'
);
select is(
  (select safe_payload ->> 'type' from connection_worker_claim),
  'connection_health',
  'the claim exposes only the safe connection payload'
);
select is(
  (select row_value from connection_worker_monitor_snapshot),
  (select to_jsonb(delivery) from public.alert_deliveries as delivery
   where delivery.id = '8f000000-0000-4111-8111-000000000401'),
  'the queued Monitoring row remains unchanged by a connection claim'
);

select throws_ok(
  $$ select * from public.claim_github_connection_alert_delivery('not a valid worker') $$,
  '22023', null,
  'an invalid worker id is rejected'
);

select is(
  public.complete_alert_delivery(
    (select delivery_id from connection_worker_claim),
    '8f000000-0000-4111-8111-000000000901'
  ),
  false,
  'completing with the stale lock token returns false'
);
select is(
  public.fail_alert_delivery(
    (select delivery_id from connection_worker_claim),
    '8f000000-0000-4111-8111-000000000901'
  ),
  false,
  'failing with the stale lock token returns false'
);
select is(
  public.complete_alert_delivery(
    (select delivery_id from connection_worker_claim),
    (select lock_token from connection_worker_claim)
  ),
  true,
  'the current lock token can complete the connection delivery'
);

update public.alert_deliveries
set status = 'running', attempt_count = 1,
    locked_at = clock_timestamp() - interval '6 minutes',
    locked_by = 'old-monitoring-worker',
    lock_token = '8f000000-0000-4111-8111-000000000902',
    last_attempt_at = clock_timestamp() - interval '6 minutes',
    updated_at = clock_timestamp() - interval '6 minutes'
where id = '8f000000-0000-4111-8111-000000000401';

create temporary table connection_worker_empty_claim as
select * from public.claim_github_connection_alert_delivery('connection-worker-2');

select is(
  (select count(*) from connection_worker_empty_claim),
  0::bigint,
  'a connection claim does not claim stale Monitoring work'
);
select is(
  (select status from public.alert_deliveries where id = '8f000000-0000-4111-8111-000000000401'),
  'running',
  'a stale Monitoring lease is not recovered by the connection claim'
);
select is(
  (select locked_by from public.alert_deliveries where id = '8f000000-0000-4111-8111-000000000401'),
  'old-monitoring-worker',
  'the stale Monitoring lease owner is unchanged'
);

update public.alert_deliveries
set status = 'running', attempt_count = 5,
    locked_at = clock_timestamp() - interval '6 minutes',
    locked_by = 'terminal-connection-worker',
    lock_token = '8f000000-0000-4111-8111-000000000903',
    last_attempt_at = clock_timestamp() - interval '6 minutes',
    delivered_at = null, terminal_at = null, safe_error = null,
    updated_at = clock_timestamp() - interval '6 minutes'
where id = (select delivery_id from connection_worker_claim);

create temporary table terminal_connection_claim as
select * from public.claim_github_connection_alert_delivery('connection-worker-3');

select is(
  (select count(*) from terminal_connection_claim),
  0::bigint,
  'five attempts make stale connection work terminal instead of reclaiming it'
);
select is(
  (select status from public.alert_deliveries
   where id = (select delivery_id from connection_worker_claim)),
  'terminal',
  'stale five-attempt connection work is terminal'
);
select is(
  (select count(*) from public.notifications
   where organisation_id = '8f000000-0000-4111-8111-000000000101'
     and kind = 'alert_delivery_failed'
     and user_id in (
       '8f000000-0000-4111-8111-000000000001',
       '8f000000-0000-4111-8111-000000000002'
     )),
  2::bigint,
  'terminal connection failure notifies Owners and Admins'
);
select is(
  (select count(*) from public.notifications
   where organisation_id = '8f000000-0000-4111-8111-000000000101'
     and kind = 'alert_delivery_failed'
     and user_id = '8f000000-0000-4111-8111-000000000003'),
  0::bigint,
  'terminal connection failure does not notify Members'
);

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.alert_deliveries where organisation_id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.notifications where organisation_id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.alert_channels where organisation_id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.github_installations where organisation_id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.memberships where organisation_id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.organisations where id in (
  '8f000000-0000-4111-8111-000000000101',
  '8f000000-0000-4111-8111-000000000102'
);
delete from public.profiles where id::text like '8f000000-0000-4111-8111-00000000000%';
delete from auth.users where id::text like '8f000000-0000-4111-8111-00000000000%';
commit;
