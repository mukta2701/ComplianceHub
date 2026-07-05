begin;
select plan(21);

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

-- One risk per tenant (using each org's seeded 'Data Security' category) so the
-- asset<->risk link and its cross-tenant FK guards have real rows to target.
insert into public.risks (id, organisation_id, reference, title, description, category_id, likelihood, impact, treatment, residual_likelihood, residual_impact, status, created_by) values
  ('31000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'R-001', 'Risk A', 'desc', (select id from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000001' and name = 'Data Security'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000001'),
  ('31000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'R-001', 'Risk B', 'desc', (select id from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000002' and name = 'Data Security'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000002');
-- A tenant-B asset, seeded as owner (bypassing RLS) so the cross-tenant link FK
-- test below has a genuine foreign asset to point at.
insert into public.assets (id, organisation_id, reference, description, classification, value_criticality, created_by) values
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'AST-B1', 'Tenant B server', 'confidential', 'high', '10000000-0000-4000-8000-000000000002');

set local role authenticated;

-- ===== Tenant A's member =====
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is((select count(*) from public.asset_categories), 6::bigint, 'org creation seeds 6 default asset categories, visible to its member');
select lives_ok(
  $$ insert into public.asset_categories (organisation_id, name, position) values ('20000000-0000-4000-8000-000000000001', 'Cloud Services', 6) $$,
  'members add an asset category in their own tenant');
select throws_ok(
  $$ insert into public.asset_categories (organisation_id, name, position) values ('20000000-0000-4000-8000-000000000002', 'forged', 6) $$,
  '42501', null, 'members cannot add an asset category in another tenant');
select lives_ok(
  $$ insert into public.assets (organisation_id, reference, description, classification, value_criticality, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'AST-001', 'Laptop', 'confidential', 'high', '10000000-0000-4000-8000-000000000001') $$,
  'members create assets in their own tenant');
select throws_ok(
  $$ insert into public.assets (organisation_id, reference, description, classification, value_criticality, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'forged', 'x', 'public', 'low', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot create assets in another tenant');
select lives_ok(
  $$ insert into public.asset_risks (organisation_id, asset_id, risk_id, created_by)
     select '20000000-0000-4000-8000-000000000001', a.id, '31000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'
     from public.assets a where a.reference = 'AST-001' $$,
  'members link a risk to their own asset');
select throws_ok(
  $$ insert into public.asset_risks (organisation_id, asset_id, risk_id, created_by)
     values ('20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot link assets and risks in another tenant');
-- Audited while still under tenant A's JWT: audit_events RLS scopes SELECT to the
-- reader's own organisation.
select is((select count(*) from public.audit_events where entity_type = 'assets' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'asset writes are audited');

-- ===== Tenant B's member attacking tenant A's existing rows =====
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is((select count(*) from public.assets where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'assets are read-isolated per tenant');
select is((select count(*) from public.asset_categories where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'asset categories are read-isolated per tenant');
select is((select count(*) from public.asset_risks where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'asset-risk links are read-isolated per tenant');
with u as (
  update public.assets set description = 'forged update' where organisation_id = '20000000-0000-4000-8000-000000000001' and reference = 'AST-001' returning 1
) select is((select count(*) from u), 0::bigint, 'assets cannot be updated cross-tenant');
with d as (
  delete from public.assets where organisation_id = '20000000-0000-4000-8000-000000000001' and reference = 'AST-001' returning 1
) select is((select count(*) from d), 0::bigint, 'assets cannot be deleted cross-tenant');
with u as (
  update public.asset_categories set name = 'forged update' where organisation_id = '20000000-0000-4000-8000-000000000001' and name = 'General' returning 1
) select is((select count(*) from u), 0::bigint, 'asset categories cannot be updated cross-tenant');
with d as (
  delete from public.asset_categories where organisation_id = '20000000-0000-4000-8000-000000000001' and name = 'General' returning 1
) select is((select count(*) from d), 0::bigint, 'asset categories cannot be deleted cross-tenant');
-- The link table is immutable to authenticated: no UPDATE privilege is granted, so
-- any update (cross-tenant or otherwise) is denied outright at the privilege gate.
select throws_ok(
  $$ update public.asset_risks set created_by = '10000000-0000-4000-8000-000000000002' where organisation_id = '20000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'asset-risk links cannot be updated (no UPDATE grant)');
with d as (
  delete from public.asset_risks where organisation_id = '20000000-0000-4000-8000-000000000001' returning 1
) select is((select count(*) from d), 0::bigint, 'asset-risk links cannot be deleted cross-tenant');

-- ===== Composite-FK tenant integrity (run as owner so RLS does not pre-hide the
-- foreign rows; this isolates the (id, organisation_id) FK guards, which must
-- reject any cross-org reference with 23503). =====
reset role;
select throws_ok(
  $$ insert into public.assets (organisation_id, reference, description, classification, value_criticality, created_by, category_id)
     values ('20000000-0000-4000-8000-000000000001', 'AST-XCAT', 'x', 'public', 'low', '10000000-0000-4000-8000-000000000001',
       (select id from public.asset_categories where organisation_id = '20000000-0000-4000-8000-000000000002' limit 1)) $$,
  '23503', null, 'an asset cannot use another tenant''s category');
select throws_ok(
  $$ insert into public.assets (organisation_id, reference, description, classification, value_criticality, created_by, owner_id)
     values ('20000000-0000-4000-8000-000000000001', 'AST-XOWN', 'x', 'public', 'low', '10000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'an asset owner must be a member of the asset''s tenant');
select throws_ok(
  $$ insert into public.asset_risks (organisation_id, asset_id, risk_id, created_by)
     select '20000000-0000-4000-8000-000000000001', a.id, '31000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'
     from public.assets a where a.reference = 'AST-001' $$,
  '23503', null, 'a link cannot reference a risk from another tenant');
select throws_ok(
  $$ insert into public.asset_risks (organisation_id, asset_id, risk_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a link cannot reference an asset from another tenant');

select * from finish();
rollback;
