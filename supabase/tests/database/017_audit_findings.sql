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

-- A checklist item that genuinely belongs to tenant B, used to force a
-- cross-org composite-FK rejection (23503) that the insert policy does not
-- pre-empt (only audit_id has an EXISTS guard).
insert into public.audit_checklist_items (id, organisation_id, audit_id, checklist_item, position) values
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'B checklist item', 0);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.audit_findings (organisation_id, audit_id, summary, severity, created_by)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Access reviews are not evidenced', 'minor_nc', '10000000-0000-4000-8000-000000000001') $$,
  'members raise findings on their own audit');
-- The insert policy's audit EXISTS guard pre-empts a cross-tenant audit_id as
-- 42501 (see test 3 below), so the composite-FK (23503) assertion is routed
-- through checklist_item_id, which carries no such guard: audit_id stays valid
-- (own audit, RLS with-check passes), and the cross-org checklist reference
-- fails the item tenant FK after the row clears RLS.
select throws_ok(
  $$ insert into public.audit_findings (organisation_id, audit_id, checklist_item_id, summary, created_by)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', 'x', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a finding cannot link a checklist item from another tenant');
select throws_ok(
  $$ insert into public.audit_findings (organisation_id, audit_id, summary, created_by)
     values ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'forged', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot raise findings in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.audit_findings where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'findings are read-isolated per tenant');
select results_eq(
  $$ update public.audit_findings set status = 'closed' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant finding update affects no rows');
select results_eq(
  $$ delete from public.audit_findings where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant finding delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.audit_events where entity_type = 'audit_findings' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'finding writes are audited per tenant');

select * from finish();
rollback;
