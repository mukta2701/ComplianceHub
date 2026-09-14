begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kpi-owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kpi-owner-b@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kpi-member-a@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-0000-0000-000000000001', 'KPI Tenant A', 'kpi-tenant-a', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'KPI Tenant B', 'kpi-tenant-b', '10000000-0000-0000-0000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'member'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'owner');
insert into public.kpis (id, organisation_id, indicator, next_steps, created_by) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Access reviews', 'Review access monthly', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Backup success', 'Review restore evidence', '10000000-0000-0000-0000-000000000002');

select ok(has_function_privilege('authenticated', 'public.raise_kpi_task(uuid,uuid,uuid)', 'EXECUTE'),
  'authenticated callers can use only the scoped KPI task RPC');
select ok(not has_function_privilege('anon', 'public.raise_kpi_task(uuid,uuid,uuid)', 'EXECUTE'),
  'anonymous callers cannot use the KPI task RPC');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.raise_kpi_task('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', null) $$,
  'an active-workspace member can atomically raise a KPI task');

reset role;
select is((select count(*) from public.tasks where organisation_id = '20000000-0000-0000-0000-000000000001'), 1::bigint,
  'the atomic RPC creates exactly one task');
select results_eq(
  $$ select title, detail from public.tasks where organisation_id = '20000000-0000-0000-0000-000000000001' $$,
  $$ values ('KPI follow-up: Access reviews'::text, 'Review access monthly'::text) $$,
  'task title and detail come from the scoped KPI row');
select isnt((select task_id from public.kpis where id = '30000000-0000-0000-0000-000000000001'), null::uuid,
  'the KPI stores the created task link');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.raise_kpi_task('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', null) $$,
  '23505', null, 'a linked KPI cannot create a duplicate task');
select throws_ok(
  $$ select public.raise_kpi_task('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', null) $$,
  '42501', null, 'a member cannot target a sibling workspace');
select throws_ok(
  $$ select public.raise_kpi_task('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'a task owner must belong to the active workspace');

select * from finish();
rollback;
