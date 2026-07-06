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

insert into public.kpis (id, organisation_id, indicator, measurement_type, created_by) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Mean time to revoke leaver access', 'manual', '10000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Phishing click-through rate', 'manual', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.kpi_measurements (organisation_id, kpi_id, value, measured_on, created_by)
     values ('20000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 12.5, '2026-07-01', '10000000-0000-4000-8000-000000000001') $$,
  'members record a measurement against their own tenant''s KPI');
-- The insert policy admits the row (own tenant, created_by = self), then the
-- composite (kpi_id, organisation_id) tenant FK rejects tenant B's KPI: a
-- genuine cross-org reference failing at the FK, not pre-empted by RLS, so the
-- 23503 assertion is non-vacuous.
select throws_ok(
  $$ insert into public.kpi_measurements (organisation_id, kpi_id, value, created_by)
     values ('20000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000002', 3, '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a measurement cannot reference another tenant''s KPI');
select throws_ok(
  $$ insert into public.kpi_measurements (organisation_id, kpi_id, value, created_by)
     values ('20000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 3, '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot record a measurement in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.kpi_measurements where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'measurements are read-isolated per tenant');
select results_eq(
  $$ update public.kpi_measurements set value = 999 where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant measurement update affects no rows');
select results_eq(
  $$ delete from public.kpi_measurements where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant measurement delete affects no rows');

-- audit_events carries the same member-only select policy, so the per-tenant
-- audit assertion is verified back under tenant A's JWT (owner B cannot read
-- tenant A's audit trail).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.audit_events where entity_type = 'kpi_measurements' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'measurement writes are audited per tenant');

select * from finish();
rollback;
