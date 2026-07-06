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

insert into public.policies (id, organisation_id, reference, title, body, created_by) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'POL-001', 'Policy A', 'body', '10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'POL-001', 'Policy B', 'body', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.policy_acceptances (organisation_id, policy_id, user_id, accepted_version)
     values ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1) $$,
  'members record their own acceptance of a policy in their tenant');
select throws_ok(
  $$ insert into public.policy_acceptances (organisation_id, policy_id, user_id, accepted_version)
     values ('20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 1) $$,
  '23503', null, 'a member cannot accept another tenant''s policy');
select throws_ok(
  $$ insert into public.policy_acceptances (organisation_id, policy_id, user_id, accepted_version)
     values ('20000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 1) $$,
  '42501', null, 'members cannot record acceptances in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.policy_acceptances where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'acceptances are read-isolated per tenant');
select results_eq(
  $$ update public.policy_acceptances set accepted_version = 99 where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant acceptance update affects no rows');
select results_eq(
  $$ delete from public.policy_acceptances where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant acceptance delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.audit_events where entity_type = 'policy_acceptances' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'acceptance writes are audited per tenant');

select * from finish();
rollback;
