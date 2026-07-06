begin;
select plan(8);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.integration_connections (id, organisation_id, provider, label, connected_by)
     values ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'jira', 'Engineering Jira', '10000000-0000-4000-8000-000000000001') $$,
  'owners create connections in their own tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.integration_connections (organisation_id, provider, connected_by)
     values ('20000000-0000-4000-8000-000000000001', 'github', '10000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'non-owner members cannot create connections');
select is((select count(*) from public.integration_connections where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'non-owner members cannot list connections (tokens stay hidden)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.integration_connections (organisation_id, provider, connected_by)
     values ('20000000-0000-4000-8000-000000000001', 'jira', '10000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'owners of another tenant cannot create connections in tenant A');
select is((select count(*) from public.integration_connections where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'connections are read-isolated per tenant');
select results_eq(
  $$ update public.integration_connections set revoked_at = now() where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant revoke affects no rows');
select results_eq(
  $$ delete from public.integration_connections where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.integration_connections set revoked_at = now() where id = '60000000-0000-4000-8000-000000000001' $$,
  'owners revoke their own connections');

select * from finish();
rollback;
