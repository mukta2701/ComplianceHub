begin;
select plan(7);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');
insert into public.tasks (id, organisation_id, title, created_by) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Tenant A task', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Tenant B task', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq($$ select title from public.tasks $$, $$ values ('Tenant A task'::text) $$, 'members only see their own tenant tasks');
select throws_ok(
  $$ insert into public.tasks (organisation_id, title, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'forged', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot create tasks in another tenant');
select throws_ok(
  $$ insert into public.tasks (organisation_id, title, created_by, owner_id)
     values ('20000000-0000-4000-8000-000000000001', 'bad owner', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'task owner must be an organisation member');
select throws_ok($$ delete from public.tasks where title = 'Tenant A task' $$, '42501', null, 'tasks are cancelled, never deleted by clients');
select is((select count(*) from public.task_catalogue_items), 3::bigint, 'starter calendar catalogue is readable and seeded');
reset role;
select throws_ok($$ update public.task_catalogue_items set title = 'tampered' $$, 'P0001', 'task catalogue items are immutable', 'task catalogue is immutable');
select is(
  (select count(*) from public.audit_events where entity_type = 'tasks' and organisation_id = '20000000-0000-4000-8000-000000000001'),
  1::bigint, 'task writes are audited');

select * from finish();
rollback;
