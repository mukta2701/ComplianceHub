begin;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'matrix-owner@example.test', '', now(), '{}', '{}'),
  ('71000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'matrix-admin@example.test', '', now(), '{}', '{}'),
  ('71000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'matrix-member@example.test', '', now(), '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('app.matrix_org', public.create_organisation_with_owner('Matrix Mutation Org', 'matrix-mutation-org')::text, true);
insert into public.memberships (organisation_id, user_id, role)
values
  (current_setting('app.matrix_org')::uuid, '71000000-0000-4000-8000-000000000002', 'admin'),
  (current_setting('app.matrix_org')::uuid, '71000000-0000-4000-8000-000000000003', 'member');

select lives_ok(
  $$ insert into public.risk_matrix_config (organisation_id, low_max, moderate_max, high_max, updated_by)
     values (current_setting('app.matrix_org')::uuid, 4, 9, 14, '71000000-0000-4000-8000-000000000001') $$,
  'an owner can create the workspace risk matrix configuration');

select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.risk_matrix_config (organisation_id, low_max, moderate_max, high_max, updated_by)
     values (current_setting('app.matrix_org')::uuid, 3, 8, 13, '71000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'a member cannot create workspace risk thresholds');
select results_eq(
  $$ update public.risk_matrix_config set low_max = 3, updated_by = '71000000-0000-4000-8000-000000000003'
     where organisation_id = current_setting('app.matrix_org')::uuid returning id $$,
  $$ select null::uuid where false $$,
  'a member cannot update workspace risk thresholds');
select results_eq(
  $$ delete from public.risk_matrix_config where organisation_id = current_setting('app.matrix_org')::uuid returning id $$,
  $$ select null::uuid where false $$,
  'a member cannot delete workspace risk thresholds');

select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ update public.risk_matrix_config
     set low_max = 5, moderate_max = 10, high_max = 15, updated_by = '71000000-0000-4000-8000-000000000002'
     where organisation_id = current_setting('app.matrix_org')::uuid $$,
  'an admin can update workspace risk thresholds');
select is(
  (select low_max::int from public.risk_matrix_config where organisation_id = current_setting('app.matrix_org')::uuid),
  5,
  'the operator update is persisted');

select set_config('request.jwt.claims', '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ delete from public.risk_matrix_config where organisation_id = current_setting('app.matrix_org')::uuid $$,
  'an owner can delete workspace risk thresholds');
select is(
  (select count(*)::int from public.risk_matrix_config where organisation_id = current_setting('app.matrix_org')::uuid),
  0,
  'the owner delete removes the configuration');

select * from finish();
rollback;
