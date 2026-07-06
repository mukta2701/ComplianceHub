begin;
select plan(6);

-- One org, one workspace owner (0001), one ordinary member (0003), plus a member
-- (0004) who OWNS a specific policy. Proves the DB-level policy-update authz
-- trigger (202607020032): approval/status is owner-only; body/version edits are
-- limited to a workspace owner or the policy's own owner — enforced even against
-- a member calling PostgREST directly (RLS alone would allow the update).
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

-- An ordinary member (not owner, not the policy owner) is blocked from forging
-- approval, from changing status, and from editing the body/version.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ update public.policies set status = 'approved', approved_by = '10000000-0000-4000-8000-000000000003', approved_at = now()
     where id = '50000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a non-owner member cannot forge policy approval');
select throws_ok(
  $$ update public.policies set status = 'in_review' where id = '50000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a non-owner member cannot change a policy''s status');
select throws_ok(
  $$ update public.policies set body = 'Silently rewritten.', version = 2 where id = '50000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a non-owner, non-policy-owner member cannot edit the body or bump the version');

-- The policy's own owner (a member) may edit content and bump the version — this
-- is the sanctioned material-edit path.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select lives_ok(
  $$ update public.policies set body = 'We protect all information assets.', version = 2 where id = '50000000-0000-4000-8000-000000000001' $$,
  'the policy owner may edit the body and bump the version');
select throws_ok(
  $$ update public.policies set status = 'approved', approved_by = '10000000-0000-4000-8000-000000000004', approved_at = now()
     where id = '50000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'even the policy owner cannot approve — approval is workspace-owner only');

-- The workspace owner may approve.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.policies set status = 'approved', approved_by = '10000000-0000-4000-8000-000000000001', approved_at = now()
     where id = '50000000-0000-4000-8000-000000000001' $$,
  'a workspace owner approves the policy');

select * from finish();
rollback;
