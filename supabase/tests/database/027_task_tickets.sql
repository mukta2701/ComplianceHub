begin;
select plan(7);

-- Two tenants, four identities: owner A (0001) and member A (0003) in tenant A;
-- owner B (0002) and member B (0004) in tenant B. Each tenant gets a task and an
-- owner-held connection so the composite tenant FKs can be attacked cross-org.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-b@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004', 'member');

insert into public.tasks (id, organisation_id, title, source, created_by) values
  ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Fix access reviews', 'manual', '10000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Fix access reviews', 'manual', '10000000-0000-4000-8000-000000000002');
insert into public.integration_connections (id, organisation_id, provider, label, connected_by) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'jira', 'Jira A', '10000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'jira', 'Jira B', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.task_tickets (organisation_id, task_id, connection_id, provider, external_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'jira', 'ENG-1', '10000000-0000-4000-8000-000000000001') $$,
  'members record a ticket for their own task');
select throws_ok(
  $$ insert into public.task_tickets (organisation_id, task_id, connection_id, provider, external_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', 'jira', 'ENG-2', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a ticket cannot attach to another tenant''s task');
select throws_ok(
  $$ insert into public.task_tickets (organisation_id, task_id, connection_id, provider, external_id, created_by)
     values ('20000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 'jira', 'forged', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot record tickets in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.task_tickets where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'tickets are read-isolated per tenant');
select results_eq(
  $$ update public.task_tickets set external_status = 'Done' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant ticket update affects no rows');
select results_eq(
  $$ delete from public.task_tickets where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant ticket delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.audit_events where entity_type = 'task_tickets' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'ticket writes are audited per tenant');

select * from finish();
rollback;
