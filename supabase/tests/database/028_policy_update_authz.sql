begin;
select plan(6);

-- One org, one workspace owner (0001), one ordinary member (0003), plus a member
-- (0004) assigned as a policy owner. Policy ownership is now metadata only:
-- ordinary Members are read-only, while Owner/Admin operators write.
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

-- An ordinary member cannot reach a draft row through the curated SELECT policy,
-- and the operator mutation policy makes every attempted update a safe no-op.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select results_eq(
  $$ update public.policies set status = 'approved', approved_by = '10000000-0000-4000-8000-000000000003', approved_at = now()
     where id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'a member cannot forge policy approval');
select results_eq(
  $$ update public.policies set status = 'in_review' where id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'a member cannot change a policy''s status');
select results_eq(
  $$ update public.policies set body = 'Silently rewritten.', version = 2 where id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'a member cannot edit the body or bump the version');

-- Assignment as policy owner does not elevate an ordinary Member.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select results_eq(
  $$ update public.policies set body = 'We protect all information assets.', version = 2 where id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'a Member assigned as policy owner remains read-only');
select results_eq(
  $$ update public.policies set status = 'approved', approved_by = '10000000-0000-4000-8000-000000000004', approved_at = now()
     where id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'a Member assigned as policy owner cannot approve');

-- The workspace owner may approve.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.policies set status = 'approved', approved_by = '10000000-0000-4000-8000-000000000001', approved_at = now()
     where id = '50000000-0000-4000-8000-000000000001' $$,
  'a workspace operator approves the policy');

select * from finish();
rollback;
