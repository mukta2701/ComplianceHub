begin;
select plan(5);

-- Regression proof that assigning a Member as policy owner does not elevate
-- their capability. Workspace owner: 0001; ordinary Member: 0003; Member assigned
-- as policy owner: 0004.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'policy-owner-a@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'member');
insert into public.policies (id, organisation_id, reference, title, body, owner_id, created_by) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'POL-001', 'Information security policy', 'We protect information.', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001');

-- An ordinary member cannot grab ownership (the first step of the escalation).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select results_eq(
  $$ update public.policies set owner_id = '10000000-0000-4000-8000-000000000003' where id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'a Member cannot reassign the policy owner to themselves');
select results_eq(
  $$ update public.policies set owner_id = '10000000-0000-4000-8000-000000000001' where id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'a Member cannot reassign the policy owner at all');
select results_eq(
  $$ update public.policies set body = 'tampered' where id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'a Member cannot edit the body');

-- Assignment as policy owner is not a mutation capability.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select results_eq(
  $$ update public.policies set owner_id = '10000000-0000-4000-8000-000000000001' where id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'a Member assigned as policy owner cannot reassign ownership');

-- A workspace owner may reassign ownership.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.policies set owner_id = '10000000-0000-4000-8000-000000000004' where id = '50000000-0000-4000-8000-000000000001' $$,
  'a workspace owner may reassign the policy owner');

select * from finish();
rollback;
