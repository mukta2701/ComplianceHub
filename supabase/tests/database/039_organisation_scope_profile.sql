begin;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scope-owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scope-owner-b@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'scope-member-a@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000201', 'Scope Tenant A', 'scope-tenant-a', '10000000-0000-4000-8000-000000000201'),
  ('20000000-0000-4000-8000-000000000202', 'Scope Tenant B', 'scope-tenant-b', '10000000-0000-4000-8000-000000000202');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000201', 'owner'),
  ('20000000-0000-4000-8000-000000000202', '10000000-0000-4000-8000-000000000202', 'owner'),
  ('20000000-0000-4000-8000-000000000201', '10000000-0000-4000-8000-000000000203', 'member');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000201","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.organisation_scope_profiles (organisation_id, scope_statement, services, locations, information_types, dependencies, exclusions, updated_by)
     values ('20000000-0000-4000-8000-000000000201', 'SaaS service', 'Platform', 'UK remote', 'Customer data', 'AWS', 'None', '10000000-0000-4000-8000-000000000201') $$,
  'owner creates the workspace scope profile');
select lives_ok(
  $$ update public.organisation_scope_profiles set scope_statement = 'Updated SaaS scope', updated_by = '10000000-0000-4000-8000-000000000201'
     where organisation_id = '20000000-0000-4000-8000-000000000201' $$,
  'owner updates the workspace scope profile');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000203","role":"authenticated"}', true);
select is((select scope_statement from public.organisation_scope_profiles where organisation_id = '20000000-0000-4000-8000-000000000201'), 'Updated SaaS scope', 'members can read their workspace scope');
select results_eq(
  $$ update public.organisation_scope_profiles set scope_statement = 'Tampered' where organisation_id = '20000000-0000-4000-8000-000000000201' returning organisation_id $$,
  $$ select null::uuid where false $$,
  'members cannot change scope');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000202","role":"authenticated"}', true);
select is((select count(*) from public.organisation_scope_profiles where organisation_id = '20000000-0000-4000-8000-000000000201'), 0::bigint, 'other tenants cannot read scope');
select results_eq(
  $$ update public.organisation_scope_profiles set scope_statement = 'Cross tenant', updated_by = '10000000-0000-4000-8000-000000000202'
     where organisation_id = '20000000-0000-4000-8000-000000000201' returning organisation_id $$,
  $$ select null::uuid where false $$,
  'other tenants cannot change scope');

select * from finish();
rollback;
