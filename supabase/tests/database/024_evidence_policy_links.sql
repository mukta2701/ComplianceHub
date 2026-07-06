begin;
select plan(5);

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
insert into public.evidence (id, organisation_id, title, kind, description, created_by) values
  ('52000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Signed policy', 'note', '', '10000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Signed policy', 'note', '', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, policy_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members link evidence to a policy in their own tenant');
select throws_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, control_id, policy_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', (select id from public.controls limit 1), '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'a link must target exactly one of control/risk/task/policy/checklist-item');
select throws_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, policy_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'evidence cannot link to another tenant''s policy');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.evidence_links where policy_id = '50000000-0000-4000-8000-000000000001'), 0::bigint, 'policy evidence links are read-isolated per tenant');
select results_eq(
  $$ delete from public.evidence_links where policy_id = '50000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant policy-evidence-link delete affects no rows');

select * from finish();
rollback;
