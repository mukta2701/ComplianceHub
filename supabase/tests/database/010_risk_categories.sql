begin;
select plan(9);

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

select is((select count(*) from public.risk_categories), 7::bigint, 'org creation seeds 7 default categories, visible to its member');
select is((select count(*) from public.risk_categories where name = 'Third-Party/Vendor Risk'), 1::bigint, 'the toolkit vendor duplicate is deduped to a single category');
select lives_ok(
  $$ insert into public.risk_categories (organisation_id, name, position) values ('20000000-0000-4000-8000-000000000001', 'Custom category', 7) $$,
  'members can add a category in their own tenant');
select throws_ok(
  $$ insert into public.risk_categories (organisation_id, name, position) values ('20000000-0000-4000-8000-000000000002', 'forged', 8) $$,
  '42501', null, 'members cannot add a category in another tenant');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'tenant B cannot read tenant A categories');
select results_eq(
  $$ delete from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant delete affects no rows');
select results_eq(
  $$ update public.risk_categories set name = 'forged update' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant update affects no rows');
select is(
  (select count(*) from public.audit_events where entity_type = 'risk_categories' and organisation_id = '20000000-0000-4000-8000-000000000002'),
  7::bigint, 'category seeding is audited per tenant');

-- Run as the table owner so RLS does not hide tenant B's category from the
-- lookup; this isolates the composite (id, organisation_id) FK, which must
-- reject a tenant A risk pointing at a tenant B category with 23503.
reset role;
select throws_ok(
  $$ insert into public.risks (organisation_id, reference, title, description, category_id, likelihood, impact, treatment, residual_likelihood, residual_impact, status, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'R-900', 'x', 'y',
       (select id from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000002' limit 1),
       3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a risk cannot reference another tenant''s category');

select * from finish();
rollback;
