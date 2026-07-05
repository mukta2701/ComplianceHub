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

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.risk_matrix_config (organisation_id, low_max, moderate_max, high_max, updated_by)
     values ('20000000-0000-4000-8000-000000000001', 4, 9, 14, '10000000-0000-4000-8000-000000000001') $$,
  'members can create their own config');
select throws_ok(
  $$ insert into public.risk_matrix_config (organisation_id, low_max, moderate_max, high_max, updated_by)
     values ('20000000-0000-4000-8000-000000000001', 9, 4, 14, '10000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'thresholds must be strictly increasing');
select throws_ok(
  $$ insert into public.risk_matrix_config (organisation_id, low_max, moderate_max, high_max, updated_by)
     values ('20000000-0000-4000-8000-000000000002', 4, 9, 14, '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot create config for another tenant');
-- Asserted as tenant A: audit_events is org-scoped by RLS, and the sole
-- successful write above was tenant A's own insert.
select is((select count(*) from public.audit_events where entity_type = 'risk_matrix_config'), 1::bigint, 'config writes are audited');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.risk_matrix_config where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'config is read-isolated per tenant');
select results_eq(
  $$ update public.risk_matrix_config set low_max = 1 where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant update affects no rows');
select results_eq(
  $$ delete from public.risk_matrix_config where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant delete affects no rows');

select * from finish();
rollback;
