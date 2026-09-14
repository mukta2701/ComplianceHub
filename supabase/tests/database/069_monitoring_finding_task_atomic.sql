begin;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('69000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'monitor-rpc-owner@example.test', '', now(), '{}', '{}'),
  ('69000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'monitor-rpc-member@example.test', '', now(), '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"69000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('app.monitor_org', public.create_organisation_with_owner('Monitoring RPC Org', 'monitor-rpc-org')::text, true);
insert into public.memberships (organisation_id, user_id, role)
values (current_setting('app.monitor_org')::uuid, '69000000-0000-4000-8000-000000000002', 'member');

reset role;
select ok(has_function_privilege('authenticated', 'public.raise_monitoring_finding_task(uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated callers can use the monitoring task RPC');
select ok(not has_function_privilege('anon', 'public.raise_monitoring_finding_task(uuid,uuid,uuid)', 'EXECUTE'),
  'anonymous callers cannot use the monitoring task RPC');

set local role postgres;
insert into public.monitoring_findings (
  id, organisation_id, check_id, control_ref, subject_type, subject_id, severity, title, detail
) values (
  '69000000-0000-4000-8000-000000000099', current_setting('app.monitor_org')::uuid,
  'github.branch_protection', 'A.8.32', 'github_repo', 'mukta2701/ComplianceHub',
  'high', 'Branch protection missing', 'Require a pull-request review before merge.'
);

set local role authenticated;
select lives_ok(
  $$ select public.raise_monitoring_finding_task(current_setting('app.monitor_org')::uuid, '69000000-0000-4000-8000-000000000099', '69000000-0000-4000-8000-000000000001') $$,
  'an owner can atomically raise a monitoring remediation task');
reset role;
select is((select count(*) from public.tasks where organisation_id = current_setting('app.monitor_org')::uuid), 1::bigint,
  'the monitoring RPC creates exactly one task');
select is((select status::text from public.monitoring_findings where id = '69000000-0000-4000-8000-000000000099'), 'acknowledged',
  'the finding is acknowledged when the task is linked');
select isnt((select task_id from public.monitoring_findings where id = '69000000-0000-4000-8000-000000000099'), null::uuid,
  'the finding stores the created task link');

set local role authenticated;
select throws_ok(
  $$ select public.raise_monitoring_finding_task(current_setting('app.monitor_org')::uuid, '69000000-0000-4000-8000-000000000099', '69000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'a linked finding cannot create a duplicate task');
select set_config('request.jwt.claims', '{"sub":"69000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.raise_monitoring_finding_task(current_setting('app.monitor_org')::uuid, '69000000-0000-4000-8000-000000000099', '69000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'a member cannot invoke the owner-only monitoring task RPC');

select * from finish();
rollback;
