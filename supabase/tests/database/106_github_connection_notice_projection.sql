begin;
set local session_replication_role = replica;

delete from public.alert_deliveries where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.github_connection_incidents where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.notifications where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.alert_channels where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.github_installations where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.memberships where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.organisations where id = '91000000-0000-4111-8111-000000000101';
delete from public.profiles where id::text like '91000000-0000-4111-8111-00000000000%';
delete from auth.users where id::text like '91000000-0000-4111-8111-00000000000%';

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('91000000-0000-4111-8111-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'projection-owner@example.test', '', now(), '{}', '{}'),
  ('91000000-0000-4111-8111-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'projection-admin@example.test', '', now(), '{}', '{}'),
  ('91000000-0000-4111-8111-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'projection-member@example.test', '', now(), '{}', '{}');

insert into public.profiles(id) values
  ('91000000-0000-4111-8111-000000000001'),
  ('91000000-0000-4111-8111-000000000002'),
  ('91000000-0000-4111-8111-000000000003');

insert into public.organisations(id, name, slug, created_by) values
  ('91000000-0000-4111-8111-000000000101', 'Notice Projection', 'notice-projection',
   '91000000-0000-4111-8111-000000000001');

insert into public.memberships(organisation_id, user_id, role) values
  ('91000000-0000-4111-8111-000000000101', '91000000-0000-4111-8111-000000000001', 'owner'),
  ('91000000-0000-4111-8111-000000000101', '91000000-0000-4111-8111-000000000002', 'admin'),
  ('91000000-0000-4111-8111-000000000101', '91000000-0000-4111-8111-000000000003', 'member');

insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status, health, health_diagnostic_code
) values
  ('91000000-0000-4111-8111-000000000201', '91000000-0000-4111-8111-000000000101',
   91101, 91201, 'Projection-Co', 'Organization', 'selected', 'active', 'owner_action_required', 'installation_suspended'),
  ('91000000-0000-4111-8111-000000000202', '91000000-0000-4111-8111-000000000101',
   91102, 91202, 'Rollback-Co', 'Organization', 'selected', 'active', 'owner_action_required', 'permission_mismatch');

insert into public.alert_channels(
  id, organisation_id, type, connected_by, min_severity, enabled
) values
  ('91000000-0000-4111-8111-000000000301', '91000000-0000-4111-8111-000000000101',
   'slack', '91000000-0000-4111-8111-000000000001', 'medium', true),
  ('91000000-0000-4111-8111-000000000302', '91000000-0000-4111-8111-000000000101',
   'slack', '91000000-0000-4111-8111-000000000001', 'high', false);
commit;

select no_plan();

select ok(
  has_function_privilege(
    'service_role',
    'public.project_github_connection_notice_server(uuid,uuid,text,text,text,uuid,jsonb)',
    'EXECUTE'
  ),
  'service role may project connection notices'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.project_github_connection_notice_server(uuid,uuid,text,text,text,uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated callers cannot project connection notices'
);

set role service_role;
create temporary table first_projection as
select public.project_github_connection_notice_server(
  '91000000-0000-4111-8111-000000000101',
  '91000000-0000-4111-8111-000000000201',
  'incident', 'installation_suspended', 'Projection-Co',
  '91000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
) as result;
reset role;

select is((select (result ->> 'is_new')::boolean from first_projection), true, 'first projection records a new incident');
select is((select (result ->> 'slack_queued')::boolean from first_projection), true, 'first projection queues Slack atomically');
select is((select count(*) from public.github_connection_incidents where installation_id = '91000000-0000-4111-8111-000000000201' and status = 'open'), 1::bigint, 'one incident is open');
select is((select count(*) from public.notifications where organisation_id = '91000000-0000-4111-8111-000000000101' and kind = 'github_connection_incident'), 2::bigint, 'only Owner and Admin receive in-app incident notices');
select is((select count(*) from public.alert_deliveries where installation_id = '91000000-0000-4111-8111-000000000201' and kind = 'github_connection_health'), 1::bigint, 'one Slack outbox row exists');

set role service_role;
create temporary table repeated_projection as
select public.project_github_connection_notice_server(
  '91000000-0000-4111-8111-000000000101',
  '91000000-0000-4111-8111-000000000201',
  'incident', 'installation_suspended', 'Projection-Co',
  '91000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
) as result;
reset role;
select is((select (result ->> 'is_new')::boolean from repeated_projection), false, 'repeat incident is a no-op');
select is((select (result ->> 'slack_queued')::boolean from repeated_projection), false, 'repeat incident queues no duplicate Slack row');

set role service_role;
select throws_ok(
  $$ select public.project_github_connection_notice_server(
       '91000000-0000-4111-8111-000000000101',
       '91000000-0000-4111-8111-000000000202',
       'incident', 'permission_mismatch', 'Rollback-Co',
       '91000000-0000-4111-8111-000000000302',
       '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
     ) $$,
  'P0001', null,
  'a Slack queue failure aborts the whole projection'
);
reset role;
select is((select count(*) from public.github_connection_incidents where installation_id = '91000000-0000-4111-8111-000000000202'), 0::bigint, 'failed projection rolls back the incident');
select is((select count(*) from public.notifications where subject_id = '91000000-0000-4111-8111-000000000202'), 0::bigint, 'failed projection rolls back in-app notices');

set role service_role;
select is(
  (public.project_github_connection_notice_server(
    '91000000-0000-4111-8111-000000000101',
    '91000000-0000-4111-8111-000000000202',
    'incident', 'permission_mismatch', 'Rollback-Co',
    '91000000-0000-4111-8111-000000000301',
    '{"type":"connection_health","severity":"high","title":"GitHub needs attention","controlRef":"GitHub connection","subjectId":"connection","detail":"Review the GitHub connection."}'::jsonb
  ) ->> 'slack_queued')::boolean,
  true,
  'a later projection retries successfully'
);
reset role;

update public.github_installations
set health = 'healthy', health_diagnostic_code = null
where id = '91000000-0000-4111-8111-000000000201';

set role service_role;
select throws_ok(
  $$ select public.project_github_connection_notice_server(
       '91000000-0000-4111-8111-000000000101',
       '91000000-0000-4111-8111-000000000201',
       'recovery', null, 'Projection-Co',
       '91000000-0000-4111-8111-000000000302',
       '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb
     ) $$,
  'P0001', null,
  'a recovery queue failure aborts the whole projection'
);
reset role;
select is((select count(*) from public.github_connection_incidents where installation_id = '91000000-0000-4111-8111-000000000201' and status = 'open'), 1::bigint, 'failed recovery leaves the incident open for retry');
select is((select count(*) from public.notifications where organisation_id = '91000000-0000-4111-8111-000000000101' and kind = 'github_connection_recovery'), 0::bigint, 'failed recovery rolls back in-app recovery notices');

set role service_role;
create temporary table recovery_projection as
select public.project_github_connection_notice_server(
  '91000000-0000-4111-8111-000000000101',
  '91000000-0000-4111-8111-000000000201',
  'recovery', null, 'Projection-Co',
  '91000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb
) as result;
reset role;
select is((select (result ->> 'is_new')::boolean from recovery_projection), true, 'recovery resolves an open incident');
select is((select (result ->> 'slack_queued')::boolean from recovery_projection), true, 'recovery queues one Slack row');
select is((select count(*) from public.github_connection_incidents where installation_id = '91000000-0000-4111-8111-000000000201' and status = 'open'), 0::bigint, 'recovery closes the incident');

set role service_role;
create temporary table repeated_recovery_projection as
select public.project_github_connection_notice_server(
  '91000000-0000-4111-8111-000000000101',
  '91000000-0000-4111-8111-000000000201',
  'recovery', null, 'Projection-Co',
  '91000000-0000-4111-8111-000000000301',
  '{"type":"connection_health","severity":"medium","title":"GitHub recovered","controlRef":"GitHub connection","subjectId":"connection","detail":"GitHub access was verified again."}'::jsonb
) as result;
reset role;
select is((select (result ->> 'is_new')::boolean from repeated_recovery_projection), false, 'repeat recovery is a no-op');
select is((select (result ->> 'slack_queued')::boolean from repeated_recovery_projection), false, 'repeat recovery queues no duplicate Slack row');
select is((select count(*) from public.notifications where organisation_id = '91000000-0000-4111-8111-000000000101' and kind = 'github_connection_recovery'), 2::bigint, 'repeat recovery creates no duplicate in-app notices');
select is((select count(*) from public.alert_deliveries where installation_id = '91000000-0000-4111-8111-000000000201' and kind = 'github_connection_health'), 2::bigint, 'repeat recovery creates no duplicate Slack row');

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.alert_deliveries where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.github_connection_incidents where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.notifications where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.alert_channels where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.github_installations where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.memberships where organisation_id = '91000000-0000-4111-8111-000000000101';
delete from public.organisations where id = '91000000-0000-4111-8111-000000000101';
delete from public.profiles where id::text like '91000000-0000-4111-8111-00000000000%';
delete from auth.users where id::text like '91000000-0000-4111-8111-00000000000%';
commit;
