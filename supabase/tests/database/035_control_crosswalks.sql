begin;
select plan(9);

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

-- controls are GLOBAL (the seeded ISO 27001 library), so both tenants map onto
-- the same control ids; there is no cross-tenant control FK to exercise (a
-- 23503 case does not apply here — the control_id FK is to a global catalogue).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.control_crosswalks (organisation_id, control_id, framework, external_ref, note, created_by)
     values ('20000000-0000-4000-8000-000000000001',
             (select id from public.controls order by position limit 1),
             'soc_2', 'CC6.1', 'Our access control interpretation', '10000000-0000-4000-8000-000000000001') $$,
  'an Owner records a crosswalk mapping in their own tenant');
-- The insert policy admits the row (own tenant, created_by = self), then the
-- unique (organisation_id, control_id, framework, external_ref) rejects the
-- duplicate: a genuine 23505 not pre-empted by RLS, so the assertion is
-- non-vacuous.
select throws_ok(
  $$ insert into public.control_crosswalks (organisation_id, control_id, framework, external_ref, created_by)
     values ('20000000-0000-4000-8000-000000000001',
             (select id from public.controls order by position limit 1),
             'soc_2', 'CC6.1', '10000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'the same control cannot map twice to one framework requirement');
-- WITH CHECK admits only the acting member's own tenant: forging a row into
-- tenant B is rejected by RLS (42501), non-vacuously (a valid control id).
select throws_ok(
  $$ insert into public.control_crosswalks (organisation_id, control_id, framework, external_ref, created_by)
     values ('20000000-0000-4000-8000-000000000002',
             (select id from public.controls order by position limit 1),
             'gdpr', 'Art.32', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot record a mapping in another tenant');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.control_crosswalks (organisation_id, control_id, framework, external_ref, note, created_by)
     values ('20000000-0000-4000-8000-000000000001',
             (select id from public.controls order by position limit 1),
             'gdpr', 'Art.32', 'Member-authored interpretation', '10000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'an ordinary Member cannot create framework mappings');
select results_eq(
  $$ delete from public.control_crosswalks
     where organisation_id='20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$,
  'an ordinary Member cannot remove framework mappings');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.control_crosswalks where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'crosswalks are read-isolated per tenant');
select results_eq(
  $$ update public.control_crosswalks set external_ref = 'hijacked' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant crosswalk update affects no rows');
select results_eq(
  $$ delete from public.control_crosswalks where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant crosswalk delete affects no rows');

-- audit_events carries the same member-only select policy, so the per-tenant
-- audit assertion is verified back under tenant A's JWT.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.audit_events where entity_type = 'control_crosswalks' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'crosswalk writes are audited per tenant');

select * from finish();
rollback;
