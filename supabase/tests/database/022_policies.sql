begin;
select plan(8);

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

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.policies (id, organisation_id, reference, title, body, owner_id, created_by)
     values ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'POL-001', 'Information security policy', 'The organisation protects the confidentiality, integrity and availability of information.', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members author a policy in their own tenant');
select throws_ok(
  $$ insert into public.policies (organisation_id, reference, title, created_by, owner_id)
     values ('20000000-0000-4000-8000-000000000001', 'POL-002', 'x', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'the policy owner must be a member of the policy organisation');
select throws_ok(
  $$ insert into public.policies (organisation_id, reference, title, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'forged', 'x', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot author a policy in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.policies where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'policies are read-isolated per tenant');
select results_eq(
  $$ update public.policies set title = 'hijacked' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant policy update affects no rows');
select results_eq(
  $$ delete from public.policies where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant policy delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.policies set status = 'approved', body = 'The approved policy text.' where id = '50000000-0000-4000-8000-000000000001' $$,
  'workspace operators progress their policy and let the database advance its version');
select is(
  (select count(*) from public.audit_events where entity_type = 'policies' and organisation_id = '20000000-0000-4000-8000-000000000001'),
  2::bigint, 'policy inserts and updates are captured to the audit trail');

select * from finish();
rollback;
