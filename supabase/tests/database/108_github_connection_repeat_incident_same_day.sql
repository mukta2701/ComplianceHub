-- Same-day repeat incident regression: a new incident after recovery must
-- notify again even on the same UTC day, while repeats of the same open
-- incident and duplicate recoveries stay quiet.
begin;
set local session_replication_role = replica;
delete from public.alert_deliveries where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.github_connection_incidents where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.notifications where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.alert_channels where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.github_installations where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.memberships where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.organisations where id = '93000000-0000-4111-8111-000000000101';
delete from public.profiles where id::text like '93000000-0000-4111-8111-00000000000%';
delete from auth.users where id::text like '93000000-0000-4111-8111-00000000000%';

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('93000000-0000-4111-8111-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'repeat-owner@example.test', '', now(), '{}', '{}'),
  ('93000000-0000-4111-8111-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'repeat-admin@example.test', '', now(), '{}', '{}'),
  ('93000000-0000-4111-8111-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'repeat-member@example.test', '', now(), '{}', '{}');

insert into public.profiles(id) values
  ('93000000-0000-4111-8111-000000000001'),
  ('93000000-0000-4111-8111-000000000002'),
  ('93000000-0000-4111-8111-000000000003');

insert into public.organisations(id, name, slug, created_by) values
  ('93000000-0000-4111-8111-000000000101', 'Repeat Incident', 'repeat-incident',
   '93000000-0000-4111-8111-000000000001');

insert into public.memberships(organisation_id, user_id, role) values
  ('93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000001', 'owner'),
  ('93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000002', 'admin'),
  ('93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000003', 'member');

insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status, health, health_diagnostic_code
) values
  ('93000000-0000-4111-8111-000000000201', '93000000-0000-4111-8111-000000000101',
   93101, 93201, 'Repeat-Co', 'Organization', 'selected', 'active', 'owner_action_required', 'installation_suspended');

insert into public.alert_channels(
  id, organisation_id, type, connected_by, min_severity, enabled
) values
  ('93000000-0000-4111-8111-000000000301', '93000000-0000-4111-8111-000000000101',
   'slack', '93000000-0000-4111-8111-000000000001', 'medium', true),
  ('93000000-0000-4111-8111-000000000302', '93000000-0000-4111-8111-000000000101',
   'slack', '93000000-0000-4111-8111-000000000001', 'medium', true);
commit;

select no_plan();

-- Cycle 1: first incident notifies and queues.
set role service_role;
create temporary table repeat_first_incident as
select public.project_github_connection_notice_server(
  '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000201',
  'incident', 'installation_suspended', 'Repeat-Co',
  '93000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
) as result;
reset role;
select is((select (result ->> 'is_new')::boolean from repeat_first_incident), true, 'cycle 1 incident is new');
select is((select (result ->> 'slack_queued')::boolean from repeat_first_incident), true, 'cycle 1 incident queues Slack');

-- Repeat check of the same open incident stays quiet.
set role service_role;
create temporary table repeat_same_incident as
select public.project_github_connection_notice_server(
  '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000201',
  'incident', 'installation_suspended', 'Repeat-Co',
  '93000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
) as result;
reset role;
select is((select (result ->> 'is_new')::boolean from repeat_same_incident), false, 'repeat check of the open incident is quiet');
select is((select (result ->> 'slack_queued')::boolean from repeat_same_incident), false, 'repeat check queues no Slack');

-- Cycle 1 recovery closes the incident with fresh notices.
update public.github_installations
set health = 'healthy', health_diagnostic_code = null
where id = '93000000-0000-4111-8111-000000000201';

set role service_role;
create temporary table repeat_first_recovery as
select public.project_github_connection_notice_server(
  '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000201',
  'recovery', null, 'Repeat-Co',
  '93000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb
) as result;
reset role;
select is((select (result ->> 'is_new')::boolean from repeat_first_recovery), true, 'cycle 1 recovery is new');
select is((select (result ->> 'slack_queued')::boolean from repeat_first_recovery), true, 'cycle 1 recovery queues Slack');

-- Duplicate recovery redelivery stays quiet.
set role service_role;
create temporary table repeat_dup_recovery as
select public.project_github_connection_notice_server(
  '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000201',
  'recovery', null, 'Repeat-Co',
  '93000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb
) as result;
reset role;
select is((select (result ->> 'is_new')::boolean from repeat_dup_recovery), false, 'duplicate recovery redelivery is quiet');
select is((select (result ->> 'slack_queued')::boolean from repeat_dup_recovery), false, 'duplicate recovery queues no Slack');

-- Cycle 2 same UTC day: the connection fails again after recovery.
update public.github_installations
set health = 'owner_action_required', health_diagnostic_code = 'installation_suspended'
where id = '93000000-0000-4111-8111-000000000201';

set role service_role;
create temporary table repeat_second_incident as
select public.project_github_connection_notice_server(
  '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000201',
  'incident', 'installation_suspended', 'Repeat-Co',
  '93000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
) as result;
reset role;
select is((select (result ->> 'is_new')::boolean from repeat_second_incident), true, 'cycle 2 incident after recovery is new on the same day');
select is((select (result ->> 'slack_queued')::boolean from repeat_second_incident), true, 'cycle 2 incident queues fresh Slack');
select is(
  (select count(*) from public.notifications where organisation_id = '93000000-0000-4111-8111-000000000101' and kind = 'github_connection_incident'),
  4::bigint,
  'cycle 2 incident notifies Owner and Admin again'
);
select is(
  (select count(*) from public.alert_deliveries where installation_id = '93000000-0000-4111-8111-000000000201' and kind = 'github_connection_health'),
  3::bigint,
  'cycle 2 incident queues a second Slack row'
);

-- Cycle 2 recovery notifies again on the same day.
update public.github_installations
set health = 'healthy', health_diagnostic_code = null
where id = '93000000-0000-4111-8111-000000000201';

set role service_role;
create temporary table repeat_second_recovery as
select public.project_github_connection_notice_server(
  '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000201',
  'recovery', null, 'Repeat-Co',
  '93000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb
) as result;
reset role;
select is((select (result ->> 'is_new')::boolean from repeat_second_recovery), true, 'cycle 2 recovery is new on the same day');
select is((select (result ->> 'slack_queued')::boolean from repeat_second_recovery), true, 'cycle 2 recovery queues fresh Slack');
select is(
  (select count(*) from public.notifications where organisation_id = '93000000-0000-4111-8111-000000000101' and kind = 'github_connection_recovery'),
  4::bigint,
  'cycle 2 recovery notifies Owner and Admin again'
);
select is(
  (select count(*) from public.alert_deliveries where installation_id = '93000000-0000-4111-8111-000000000201' and kind = 'github_connection_health'),
  4::bigint,
  'cycle 2 recovery queues a second Slack row'
);
select is(
  (select count(*) from public.notifications where organisation_id = '93000000-0000-4111-8111-000000000101' and user_id = '93000000-0000-4111-8111-000000000003'),
  0::bigint,
  'a Member receives no connection notice in either cycle'
);

-- Edge: durable incident UUID keys the repeat, not the calendar day.
select ok(
  (select result ->> 'incident_id' from repeat_first_incident)
    is distinct from (select result ->> 'incident_id' from repeat_second_incident),
  'each true incident cycle gets its own durable UUID'
);
select is(
  (select result ->> 'incident_id' from repeat_second_recovery),
  (select result ->> 'incident_id' from repeat_second_incident),
  'cycle 2 recovery closes cycle 2 incident'
);
select is(
  (select count(distinct subject_id) from public.notifications where organisation_id = '93000000-0000-4111-8111-000000000101' and kind = 'github_connection_incident'),
  2::bigint,
  'in-app incident notices use per-cycle subject identity'
);
select is(
  (select count(distinct subject_id) from public.notifications where organisation_id = '93000000-0000-4111-8111-000000000101' and kind = 'github_connection_recovery'),
  2::bigint,
  'in-app recovery notices use per-cycle subject identity'
);
select is(
  (select count(distinct scope_key) from public.alert_deliveries where installation_id = '93000000-0000-4111-8111-000000000201' and kind = 'github_connection_health'),
  4::bigint,
  'Slack queue uses per-cycle scope for two incidents and two recoveries'
);
select is(
  (select count(*) from public.alert_deliveries where installation_id = '93000000-0000-4111-8111-000000000201' and kind = 'github_connection_health' and subject_id <> '93000000-0000-4111-8111-000000000201'),
  0::bigint,
  'Slack rows keep installation-based subject'
);

-- Recovery can close more than one diagnostic. The projector must pass the
-- exact incident UUID returned by the recorder into the queue.
insert into public.github_connection_incidents(
  id, organisation_id, installation_id, incident_key, diagnostic_class,
  status, opened_at, last_observed_at
) values
  ('93000000-0000-4111-8111-000000000501', '93000000-0000-4111-8111-000000000101',
   '93000000-0000-4111-8111-000000000201', 'installation_suspended',
   'installation_suspended', 'open', now() - interval '10 minutes', now() - interval '10 minutes'),
  ('93000000-0000-4111-8111-000000000502', '93000000-0000-4111-8111-000000000101',
   '93000000-0000-4111-8111-000000000201', 'permission_mismatch',
   'permission_mismatch', 'open', now() - interval '10 minutes', now() - interval '10 minutes');
set role service_role;
create temporary table repeat_mixed_diagnostic_recovery as
select public.project_github_connection_notice_server(
  '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000201',
  'recovery', null, 'Repeat-Co',
  '93000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb
) as result;
reset role;
select is(
  (select result ->> 'incident_id' from repeat_mixed_diagnostic_recovery),
  '93000000-0000-4111-8111-000000000501',
  'mixed-diagnostic recovery returns its deterministic recorded incident'
);
select is(
  (select scope_key from public.alert_deliveries
   where installation_id = '93000000-0000-4111-8111-000000000201'
     and scope_key like 'github-connection:%:recovery'
   order by created_at desc limit 1),
  'github-connection:93000000-0000-4111-8111-000000000501:recovery',
  'projector queues against the exact recorded incident when timestamps tie'
);
set role service_role;
create temporary table repeat_mixed_legacy_recovery_queue as
select public.queue_github_connection_alert_delivery(
  '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000301',
  '93000000-0000-4111-8111-000000000201',
  'recovery', null,
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb
) as inserted;
reset role;
select is(
  (select inserted from repeat_mixed_legacy_recovery_queue), false,
  'legacy recovery calls resolve the same incident when diagnostics tie'
);

-- The unchanged legacy queue/enqueue signatures use the open incident identity
-- and keep the same row through a UTC date change.
insert into public.github_connection_incidents(
  id, organisation_id, installation_id, incident_key, diagnostic_class,
  status, opened_at, last_observed_at
) values (
  '93000000-0000-4111-8111-000000000503', '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000201', 'internal_failure',
  'internal_failure', 'open', now(), now()
);
set role service_role;
create temporary table repeat_legacy_queue as
select public.queue_github_connection_alert_delivery(
    '93000000-0000-4111-8111-000000000101',
    '93000000-0000-4111-8111-000000000301',
    '93000000-0000-4111-8111-000000000201',
    'incident', 'internal_failure',
    '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
  ) as inserted;
reset role;
select is((select inserted from repeat_legacy_queue), true, 'legacy queue signature inserts one row for its open incident');
update public.github_connection_incidents
set opened_at = (((now() at time zone 'UTC')::date - 1 + time '23:59') at time zone 'UTC'),
    last_observed_at = (((now() at time zone 'UTC')::date - 1 + time '23:59') at time zone 'UTC')
where id = '93000000-0000-4111-8111-000000000503';
update public.alert_deliveries
set delivery_on = (now() at time zone 'UTC')::date - 1
where installation_id = '93000000-0000-4111-8111-000000000201'
  and (idempotency_key = encode(extensions.digest(
         'github-connection:93000000-0000-4111-8111-000000000201:incident:internal_failure', 'sha256'), 'hex')
    or scope_key = 'github-connection:93000000-0000-4111-8111-000000000503:incident');
set role service_role;
create temporary table repeat_midnight_queue as
select public.queue_github_connection_alert_delivery(
    '93000000-0000-4111-8111-000000000101',
    '93000000-0000-4111-8111-000000000301',
    '93000000-0000-4111-8111-000000000201',
    'incident', 'internal_failure',
    '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
  ) as inserted;
create temporary table repeat_legacy_enqueue as
select * from public.enqueue_github_connection_alert_delivery(
  '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000301',
  '93000000-0000-4111-8111-000000000201',
  'incident', 'internal_failure',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb,
  'legacy-repeat-worker'
);
reset role;
select is((select inserted from repeat_midnight_queue), false, 'retry after midnight reuses the lifecycle delivery row');
select is((select count(*) from repeat_legacy_enqueue), 1::bigint, 'legacy enqueue can claim the existing lifecycle row');
select is(
  (select attempt_count from public.alert_deliveries
   where scope_key = 'github-connection:93000000-0000-4111-8111-000000000503:incident'),
  1, 'legacy enqueue retains the existing retry counter'
);
select is(
  (select count(*) from public.alert_deliveries
   where installation_id = '93000000-0000-4111-8111-000000000201'
     and scope_key = 'github-connection:93000000-0000-4111-8111-000000000503:incident'),
  1::bigint, 'legacy signatures do not create a second lifecycle row'
);

-- Old daily-key rows remain untouched and satisfy later calls for that same
-- incident, whether already delivered or waiting for its original backoff.
insert into public.github_connection_incidents(
  id, organisation_id, installation_id, incident_key, diagnostic_class,
  status, opened_at, last_observed_at
) values
  ('93000000-0000-4111-8111-000000000510', '93000000-0000-4111-8111-000000000101',
   '93000000-0000-4111-8111-000000000201', 'installation_revoked',
   'installation_revoked', 'open', now() - interval '1 minute', now()),
  ('93000000-0000-4111-8111-000000000511', '93000000-0000-4111-8111-000000000101',
   '93000000-0000-4111-8111-000000000201', 'account_mismatch',
   'account_mismatch', 'open', now() - interval '1 minute', now());
insert into public.alert_deliveries(
  id, organisation_id, channel_id, kind, subject_type, subject_id,
  installation_id, scope_key, idempotency_key, safe_payload, delivery_on,
  status, attempt_count, next_attempt_at, delivered_at, safe_error, created_at
) values (
  '93000000-0000-4111-8111-000000000520',
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
  'github_connection_health', 'github_installation', '93000000-0000-4111-8111-000000000201',
  '93000000-0000-4111-8111-000000000201',
  'github-connection:' || encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:incident:installation_revoked', 'sha256'), 'hex'),
  encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:incident:installation_revoked', 'sha256'), 'hex'),
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb,
  (now() at time zone 'UTC')::date - 1, 'delivered', 1, now(), now(), null, now()
), (
  '93000000-0000-4111-8111-000000000521',
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
  'github_connection_health', 'github_installation', '93000000-0000-4111-8111-000000000201',
  '93000000-0000-4111-8111-000000000201',
  'github-connection:' || encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:incident:account_mismatch', 'sha256'), 'hex'),
  encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:incident:account_mismatch', 'sha256'), 'hex'),
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb,
  (now() at time zone 'UTC')::date - 1, 'failed', 2, now() + interval '1 hour', null,
  'Alert delivery failed. Retry scheduled.', now()
);
set role service_role;
create temporary table repeat_delivered_legacy_queue as
select public.queue_github_connection_alert_delivery(
    '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
    '93000000-0000-4111-8111-000000000201', 'incident', 'installation_revoked',
    '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
  ) as inserted;
create temporary table repeat_failed_legacy_enqueue as
select * from public.enqueue_github_connection_alert_delivery(
    '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
    '93000000-0000-4111-8111-000000000201', 'incident', 'account_mismatch',
    '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb,
    'legacy-backoff-worker'
);
reset role;
select is((select inserted from repeat_delivered_legacy_queue), false, 'an existing delivered legacy row suppresses a duplicate');
select is((select count(*) from repeat_failed_legacy_enqueue), 0::bigint, 'an old failed row keeps its existing backoff');
select is(
  (select count(*) from public.alert_deliveries
   where id = '93000000-0000-4111-8111-000000000521'),
  1::bigint, 'the old failed row remains in place'
);
select is(
  (select attempt_count from public.alert_deliveries where id = '93000000-0000-4111-8111-000000000521'),
  2, 'the old failed row keeps its attempt count'
);
select is(
  (select count(*) from public.alert_deliveries
   where installation_id = '93000000-0000-4111-8111-000000000201'
     and idempotency_key = encode(extensions.digest(
       'github-connection:93000000-0000-4111-8111-000000000201:incident:account_mismatch', 'sha256'), 'hex')),
  1::bigint, 'the old failed row is not replaced by a new delivery'
);

-- Legacy retries can arrive after recovery. Reuse only a delivery created
-- within that lifecycle, including after resolved_at, and never emit a stale
-- incident alert if no historical delivery exists.
insert into public.github_connection_incidents(
  id, organisation_id, installation_id, incident_key, diagnostic_class,
  status, opened_at, last_observed_at, resolved_at
) values
  ('93000000-0000-4111-8111-000000000530', '93000000-0000-4111-8111-000000000101',
   '93000000-0000-4111-8111-000000000201', 'provider_rate_limited',
   'provider_rate_limited', 'resolved', now() - interval '20 minutes',
   now() - interval '10 minutes', now() - interval '10 minutes'),
  ('93000000-0000-4111-8111-000000000531', '93000000-0000-4111-8111-000000000101',
   '93000000-0000-4111-8111-000000000201', 'provider_temporary_failure',
   'provider_temporary_failure', 'resolved', now() - interval '20 minutes',
   now() - interval '10 minutes', now() - interval '10 minutes'),
  ('93000000-0000-4111-8111-000000000532', '93000000-0000-4111-8111-000000000101',
   '93000000-0000-4111-8111-000000000201', 'repository_unavailable',
   'repository_unavailable', 'resolved', now() - interval '20 minutes',
   now() - interval '10 minutes', now() - interval '10 minutes'),
  ('93000000-0000-4111-8111-000000000533', '93000000-0000-4111-8111-000000000101',
   '93000000-0000-4111-8111-000000000201', 'internal_failure',
   'internal_failure', 'resolved', now() - interval '20 minutes',
   now() + interval '5 minutes', now() + interval '5 minutes');

insert into public.alert_deliveries(
  id, organisation_id, channel_id, kind, subject_type, subject_id,
  installation_id, scope_key, idempotency_key, safe_payload, delivery_on,
  status, attempt_count, next_attempt_at, delivered_at, safe_error, created_at
) values (
  '93000000-0000-4111-8111-000000000540',
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
  'github_connection_health', 'github_installation', '93000000-0000-4111-8111-000000000201',
  '93000000-0000-4111-8111-000000000201',
  'github-connection:' || encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:incident:provider_rate_limited', 'sha256'), 'hex'),
  encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:incident:provider_rate_limited', 'sha256'), 'hex'),
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb,
  (now() at time zone 'UTC')::date, 'delivered', 1, now(), now() - interval '8 minutes', null, now() - interval '8 minutes'
), (
  '93000000-0000-4111-8111-000000000541',
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
  'github_connection_health', 'github_installation', '93000000-0000-4111-8111-000000000201',
  '93000000-0000-4111-8111-000000000201',
  'github-connection:' || encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:incident:provider_temporary_failure', 'sha256'), 'hex'),
  encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:incident:provider_temporary_failure', 'sha256'), 'hex'),
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb,
  (now() at time zone 'UTC')::date, 'failed', 2, now() + interval '1 hour', null,
  'Alert delivery failed. Retry scheduled.', now() - interval '8 minutes'
), (
  '93000000-0000-4111-8111-000000000542',
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
  'github_connection_health', 'github_installation', '93000000-0000-4111-8111-000000000201',
  '93000000-0000-4111-8111-000000000201',
  'github-connection:' || encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:recovery:none', 'sha256'), 'hex'),
  encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:recovery:none', 'sha256'), 'hex'),
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb,
  (now() at time zone 'UTC')::date, 'delivered', 1, now(), now() + interval '6 minutes', null, now() + interval '6 minutes'
), (
  '93000000-0000-4111-8111-000000000543',
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000302',
  'github_connection_health', 'github_installation', '93000000-0000-4111-8111-000000000201',
  '93000000-0000-4111-8111-000000000201',
  'github-connection:' || encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:recovery:none', 'sha256'), 'hex'),
  encode(extensions.digest('github-connection:93000000-0000-4111-8111-000000000201:recovery:none', 'sha256'), 'hex'),
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb,
  (now() at time zone 'UTC')::date, 'failed', 3, now() + interval '1 hour', null,
  'Alert delivery failed. Retry scheduled.', now() + interval '6 minutes'
);

-- The next incident begins after these recovery-period deliveries. Its opening
-- bounds legacy recovery-row matching, while the rows above remain reusable.
insert into public.github_connection_incidents(
  id, organisation_id, installation_id, incident_key, diagnostic_class,
  status, opened_at, last_observed_at
) values (
  '93000000-0000-4111-8111-000000000534', '93000000-0000-4111-8111-000000000101',
  '93000000-0000-4111-8111-000000000201', 'installation_suspended',
  'installation_suspended', 'open', now() + interval '7 minutes', now() + interval '7 minutes'
);

set role service_role;
create temporary table repeat_recovered_legacy_incident_queue as
select public.queue_github_connection_alert_delivery(
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
  '93000000-0000-4111-8111-000000000201', 'incident', 'provider_rate_limited',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
) as inserted;
create temporary table repeat_recovered_legacy_incident_enqueue as
select * from public.enqueue_github_connection_alert_delivery(
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
  '93000000-0000-4111-8111-000000000201', 'incident', 'provider_temporary_failure',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb,
  'recovered-incident-worker'
);
create temporary table repeat_recovered_no_history_queue as
select public.queue_github_connection_alert_delivery(
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
  '93000000-0000-4111-8111-000000000201', 'incident', 'repository_unavailable',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
) as inserted;
create temporary table repeat_recovered_no_history_duplicate as
select public.queue_github_connection_alert_delivery(
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
  '93000000-0000-4111-8111-000000000201', 'incident', 'repository_unavailable',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
) as inserted;
create temporary table repeat_post_resolution_recovery_queue as
select public.queue_github_connection_alert_delivery(
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000301',
  '93000000-0000-4111-8111-000000000201', 'recovery', null,
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb
) as inserted;
create temporary table repeat_post_resolution_recovery_enqueue as
select * from public.enqueue_github_connection_alert_delivery(
  '93000000-0000-4111-8111-000000000101', '93000000-0000-4111-8111-000000000302',
  '93000000-0000-4111-8111-000000000201', 'recovery', null,
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb,
  'recovered-alert-worker'
);
reset role;
select is((select inserted from repeat_recovered_legacy_incident_queue), false,
  'post-recovery legacy incident queue reuses its old delivered row');
select is((select count(*) from public.alert_deliveries where id = '93000000-0000-4111-8111-000000000540'), 1::bigint,
  'post-recovery incident retry does not create a duplicate');
select is((select status from public.alert_deliveries where id = '93000000-0000-4111-8111-000000000540'), 'delivered',
  'post-recovery delivered incident history stays delivered');
select is((select count(*) from repeat_recovered_legacy_incident_enqueue), 0::bigint,
  'post-recovery enqueue does not claim a failed row still in backoff');
select is((select status from public.alert_deliveries where id = '93000000-0000-4111-8111-000000000541'), 'failed',
  'post-recovery incident failure remains failed');
select is((select attempt_count from public.alert_deliveries where id = '93000000-0000-4111-8111-000000000541'), 2,
  'post-recovery incident retry count is unchanged');
select is((select next_attempt_at > now() from public.alert_deliveries where id = '93000000-0000-4111-8111-000000000541'), true,
  'post-recovery incident retry retains its backoff');
select is((select inserted from repeat_recovered_no_history_queue), false,
  'legacy incident retry without history is suppressed after a newer cycle begins');
select is((select inserted from repeat_recovered_no_history_duplicate), false,
  'repeated stale legacy incident retries remain suppressed');
select is((select count(*) from public.alert_deliveries where scope_key =
  'github-connection:93000000-0000-4111-8111-000000000532:incident'),
  0::bigint, 'stale legacy retries do not create an incident-scoped delivery');
select is((select count(*) from public.alert_deliveries where idempotency_key = encode(extensions.digest(
  'github-connection:93000000-0000-4111-8111-000000000201:incident:repository_unavailable', 'sha256'), 'hex')),
  0::bigint, 'stale legacy retries do not fall back to a daily idempotency key');
select is((select inserted from repeat_post_resolution_recovery_queue), false,
  'legacy recovery queue reuses a row created after resolution but before the next incident');
select is((select status from public.alert_deliveries where id = '93000000-0000-4111-8111-000000000542'), 'delivered',
  'post-resolution recovery delivery remains delivered');
select is((select count(*) from repeat_post_resolution_recovery_enqueue), 0::bigint,
  'legacy recovery enqueue preserves a failed row in backoff');
select is((select status from public.alert_deliveries where id = '93000000-0000-4111-8111-000000000543'), 'failed',
  'post-resolution failed recovery delivery remains failed');
select is((select attempt_count from public.alert_deliveries where id = '93000000-0000-4111-8111-000000000543'), 3,
  'post-resolution recovery attempt count remains unchanged');
select is((select next_attempt_at > now() from public.alert_deliveries where id = '93000000-0000-4111-8111-000000000543'), true,
  'post-resolution recovery retry retains its backoff');

select ok(
  to_regprocedure('private.queue_github_connection_alert_delivery_for_incident(uuid,uuid,uuid,text,text,jsonb,uuid)') is not null
    and not has_function_privilege('service_role', to_regprocedure('private.queue_github_connection_alert_delivery_for_incident(uuid,uuid,uuid,text,text,jsonb,uuid)'), 'EXECUTE')
    and not has_function_privilege('authenticated', to_regprocedure('private.queue_github_connection_alert_delivery_for_incident(uuid,uuid,uuid,text,text,jsonb,uuid)'), 'EXECUTE')
    and not has_function_privilege('anon', to_regprocedure('private.queue_github_connection_alert_delivery_for_incident(uuid,uuid,uuid,text,text,jsonb,uuid)'), 'EXECUTE'),
  'the private queue helper cannot be called by service_role, authenticated, or anon'
);
select ok(
  not has_function_privilege('authenticated', 'public.queue_github_connection_alert_delivery(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.enqueue_github_connection_alert_delivery(uuid,uuid,uuid,text,text,jsonb,text)', 'EXECUTE'),
  'authenticated callers cannot invoke the legacy delivery paths'
);

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.alert_deliveries where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.github_connection_incidents where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.notifications where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.alert_channels where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.github_installations where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.memberships where organisation_id = '93000000-0000-4111-8111-000000000101';
delete from public.organisations where id = '93000000-0000-4111-8111-000000000101';
delete from public.profiles where id::text like '93000000-0000-4111-8111-00000000000%';
delete from auth.users where id::text like '93000000-0000-4111-8111-00000000000%';
commit;
