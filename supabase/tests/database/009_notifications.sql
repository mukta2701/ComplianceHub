begin;
select plan(6);

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
insert into public.notifications (organisation_id, user_id, kind, subject_type, subject_id, message) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'task_overdue', 'tasks', 'abc', 'Task is overdue'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'task_overdue', 'tasks', 'def', 'Task is overdue');

select throws_ok(
  $$ insert into public.notifications (organisation_id, user_id, kind, subject_type, subject_id, message)
     values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'task_overdue', 'tasks', 'abc', 'duplicate unread') $$,
  '23505', null, 'same-day notifications deduplicate per user and subject');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.notifications), 1::bigint, 'users only see their own notifications');
select throws_ok(
  $$ insert into public.notifications (organisation_id, user_id, kind, subject_type, subject_id, message)
     values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'task_overdue', 'tasks', 'zzz', 'forged') $$,
  '42501', null, 'clients cannot create notifications');
select lives_ok($$ update public.notifications set read_at = now() $$, 'users can mark their notifications read');
select throws_ok($$ delete from public.notifications $$, '42501', null, 'clients cannot delete notifications');
reset role;
select is((select count(*) from public.audit_events where entity_type = 'notifications' and action = 'update'), 1::bigint, 'marking a notification read is audited');

select * from finish();
rollback;
