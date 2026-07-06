begin;
select plan(5);

-- Two tenants, each with an owner. Profiles are provisioned from auth.users by
-- the foundation trigger, so we only seed users/orgs/memberships here.
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

-- Per tenant: an audit, a checklist item within it, and an evidence record.
insert into public.audits (id, organisation_id, reference, title, created_by) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'AUD-001', 'Audit A', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'AUD-001', 'Audit B', '10000000-0000-4000-8000-000000000002');
insert into public.audit_checklist_items (id, organisation_id, audit_id, checklist_item, position) values
  ('31000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Policy approved?', 0),
  ('31000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'Policy approved?', 0);
insert into public.evidence (id, organisation_id, title, kind, description, created_by) values
  ('32000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Signed policy', 'note', '', '10000000-0000-4000-8000-000000000001'),
  ('32000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Signed policy', 'note', '', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- (a) The widened one-target check allows a single audit_checklist_item_id link,
--     and rejects both 2-target and (via the composite FK) cross-tenant links.
select lives_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, audit_checklist_item_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members link evidence to a checklist item in their own tenant');
select throws_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, control_id, audit_checklist_item_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', (select id from public.controls limit 1), '31000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'a link must target exactly one of control/risk/task/policy/checklist-item');
select throws_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, audit_checklist_item_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'evidence cannot link to another tenant''s checklist item');

-- (b) Cross-tenant isolation of evidence_links via the new column path.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*) from public.evidence_links where audit_checklist_item_id = '31000000-0000-4000-8000-000000000001'),
  0::bigint, 'evidence links are read-isolated per tenant');
select results_eq(
  $$ delete from public.evidence_links where audit_checklist_item_id = '31000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant evidence-link delete affects no rows');

select * from finish();
rollback;
