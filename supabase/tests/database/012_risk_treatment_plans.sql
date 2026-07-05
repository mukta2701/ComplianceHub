begin;
select plan(8);

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

-- Organisation creation seeds the default 'Data Security' category per tenant;
-- reuse it rather than inserting a colliding one, so each risk gets exactly one
-- same-tenant category_id.
insert into public.risks (id, organisation_id, reference, title, description, category_id, likelihood, impact, treatment, residual_likelihood, residual_impact, status, created_by) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'R-001', 'Risk A', 'desc', (select id from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000001' and name = 'Data Security'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'R-001', 'Risk B', 'desc', (select id from public.risk_categories where organisation_id = '20000000-0000-4000-8000-000000000002' and name = 'Data Security'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.risk_treatment_plans (organisation_id, risk_id, reference, created_by, assigned_lead_id)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'RTP-001', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members create an RTP for their own risk');
select throws_ok(
  $$ insert into public.risk_treatment_plans (organisation_id, risk_id, reference, created_by)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'RTP-002', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'an RTP cannot link a risk from another tenant');
select throws_ok(
  $$ insert into public.risk_treatment_plans (organisation_id, risk_id, reference, created_by, assigned_lead_id)
     values ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'RTP-003', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'the assigned lead must be an organisation member');
select throws_ok(
  $$ insert into public.risk_treatment_plans (organisation_id, risk_id, reference, created_by)
     values ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'RTP-004', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot create an RTP in another tenant');
-- Audited while still under tenant A's JWT: audit_events RLS scopes SELECT to
-- the reader's own organisation, so the count must be taken by an A member.
select is((select count(*) from public.audit_events where entity_type = 'risk_treatment_plans' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'RTP writes are audited');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.risk_treatment_plans where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'RTPs are read-isolated per tenant');
with u as (
  update public.risk_treatment_plans set summary = 'forged update'
  where organisation_id = '20000000-0000-4000-8000-000000000001' and reference = 'RTP-001'
  returning 1
)
select is((select count(*) from u), 0::bigint, 'RTPs cannot be updated cross-tenant');
with d as (
  delete from public.risk_treatment_plans
  where organisation_id = '20000000-0000-4000-8000-000000000001' and reference = 'RTP-001'
  returning 1
)
select is((select count(*) from d), 0::bigint, 'RTPs cannot be deleted cross-tenant');

select * from finish();
rollback;
