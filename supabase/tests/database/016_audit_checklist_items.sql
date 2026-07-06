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

insert into public.audits (id, organisation_id, reference, title, created_by) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'AUD-001', 'Audit A', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'AUD-001', 'Audit B', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.audit_checklist_items (organisation_id, audit_id, checklist_item, position)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Is the information security policy approved and current?', 0) $$,
  'members add checklist items to their own audit');
-- The composite responsible FK rejects an owner from another tenant (23503).
-- (A cross-tenant audit_id is caught earlier by the insert policy's audit
-- EXISTS as 42501, so responsible_id is the vehicle for the FK assertion.)
select throws_ok(
  $$ insert into public.audit_checklist_items (organisation_id, audit_id, checklist_item, position, responsible_id)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'x', 1, '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'the responsible owner must be a member of the checklist item''s organisation');
select throws_ok(
  $$ insert into public.audit_checklist_items (organisation_id, audit_id, checklist_item, position)
     values ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'forged', 0) $$,
  '42501', null, 'members cannot add items in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.audit_checklist_items where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'checklist items are read-isolated per tenant');
select results_eq(
  $$ update public.audit_checklist_items set compliant = 'compliant' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant checklist update affects no rows');
select results_eq(
  $$ delete from public.audit_checklist_items where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant checklist delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.audit_events where entity_type = 'audit_checklist_items' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'checklist writes are audited per tenant');

select * from finish();
rollback;
