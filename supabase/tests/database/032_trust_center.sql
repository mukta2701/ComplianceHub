begin;
select plan(17);

-- Four identities: owner A (0001) and member A (0003) in tenant A; owner B
-- (0002) and member B (0004) in tenant B. The owner-only gate must deny every
-- non-owner (same-org member AND either role of another tenant) on all four
-- verbs of trust_center_settings. The public security-definer RPC must return
-- ONLY the enabled org's whitelisted data for its slug, null for a disabled or
-- unknown slug, and NEVER one org's numbers through another org's slug.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-b@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004', 'member');

-- Seed each tenant with a distinct posture so cross-org leakage is observable.
-- Tenant A: one SoA register with one 'advanced' (100% ready) applicable control
-- and two approved policies. Tenant B: one 'pending' (0%) control and no
-- approved policy. Both need an assessment_session (SoA composite tenant FK).
insert into public.assessment_sessions (id, organisation_id, catalogue_version_id, title, created_by)
  select gen_random_uuid(), o.id, (select id from public.catalogue_versions order by created_at limit 1), 'Baseline', o.created_by
  from public.organisations o where o.id in ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002');
insert into public.soa_registers (id, organisation_id, assessment_session_id, control_catalogue_version_id, version, title, created_by) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
     (select id from public.assessment_sessions where organisation_id = '20000000-0000-4000-8000-000000000001'), '40000000-0000-4000-8000-000000000001', 1, 'SoA A', '10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002',
     (select id from public.assessment_sessions where organisation_id = '20000000-0000-4000-8000-000000000002'), '40000000-0000-4000-8000-000000000001', 1, 'SoA B', '10000000-0000-4000-8000-000000000002');
-- Reference a real catalogue control so the soa_items composite FK is satisfied.
insert into public.soa_items (organisation_id, soa_register_id, control_catalogue_version_id, control_id, control_code, control_title, applicable, status, justification, position)
select r.organisation_id, r.id, c.catalogue_version_id, c.id, c.code, c.title, true,
  case r.organisation_id when '20000000-0000-4000-8000-000000000001' then 'advanced' else 'pending' end::public.soa_implementation_status, 'j', 0
from public.soa_registers r
join public.control_catalogue_controls c on c.catalogue_version_id = '40000000-0000-4000-8000-000000000001' and c.position = 1
where r.id in ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002');
insert into public.policies (organisation_id, reference, title, status, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'POL-1', 'Access Control Policy', 'approved', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', 'POL-2', 'Cryptography Policy', 'approved', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'POL-1', 'Tenant B Secret Policy', 'approved', '10000000-0000-4000-8000-000000000002');

-- Owner A enables their Trust Center (with policy titles); owner B stays DISABLED.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.trust_center_settings (organisation_id, enabled, slug, show_policy_titles, headline)
     values ('20000000-0000-4000-8000-000000000001', true, 'tenant-a-trust', true, 'We take security seriously.') $$,
  'owners enable their own Trust Center');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.trust_center_settings (organisation_id, enabled, slug)
     values ('20000000-0000-4000-8000-000000000002', false, 'tenant-b-trust') $$,
  'owner B seeds a DISABLED Trust Center');

-- Owner-only gate: a NON-OWNER member of the SAME tenant is denied all 4 verbs.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.trust_center_settings (organisation_id, enabled, slug)
     values ('20000000-0000-4000-8000-000000000001', true, 'member-a-slug') $$,
  '42501', null, 'same-org non-owner cannot INSERT settings');
select is((select count(*) from public.trust_center_settings where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint,
  'same-org non-owner cannot SELECT settings');
select results_eq(
  $$ update public.trust_center_settings set enabled = false where organisation_id = '20000000-0000-4000-8000-000000000001' returning organisation_id $$,
  $$ select null::uuid where false $$, 'same-org non-owner UPDATE affects no rows');
select results_eq(
  $$ delete from public.trust_center_settings where organisation_id = '20000000-0000-4000-8000-000000000001' returning organisation_id $$,
  $$ select null::uuid where false $$, 'same-org non-owner DELETE affects no rows');

-- Cross-tenant: another tenant's OWNER is denied all 4 verbs on tenant A's row.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.trust_center_settings (organisation_id, enabled, slug)
     values ('20000000-0000-4000-8000-000000000001', true, 'owner-b-slug') $$,
  '42501', null, 'another tenant''s owner cannot INSERT settings for tenant A');
select is((select count(*) from public.trust_center_settings where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint,
  'another tenant''s owner cannot SELECT tenant A settings');
select results_eq(
  $$ update public.trust_center_settings set enabled = false where organisation_id = '20000000-0000-4000-8000-000000000001' returning organisation_id $$,
  $$ select null::uuid where false $$, 'another tenant''s owner UPDATE affects no rows');
select results_eq(
  $$ delete from public.trust_center_settings where organisation_id = '20000000-0000-4000-8000-000000000001' returning organisation_id $$,
  $$ select null::uuid where false $$, 'another tenant''s owner DELETE affects no rows');

-- Public RPC as anon: the enabled slug returns tenant A's whitelisted, safe data.
set local role anon;
select isnt(public.trust_center_view('tenant-a-trust'), null, 'an enabled slug returns a payload');
select is(public.trust_center_view('tenant-a-trust') ->> 'organisationName', 'Tenant A',
  'the payload is scoped to the enabled slug''s organisation');
select is((public.trust_center_view('tenant-a-trust') ->> 'readinessPercent')::int, 100,
  'readiness is computed from tenant A''s own SoA (advanced control = 100%), not tenant B''s');
select is((public.trust_center_view('tenant-a-trust') ->> 'approvedPolicyCount')::int, 2,
  'the approved-policy count reflects tenant A''s two policies, not tenant B''s one');
-- No-leak proof: tenant A's slug must never surface tenant B's secret policy title.
select is((public.trust_center_view('tenant-a-trust') -> 'policyTitles')::text not like '%Tenant B Secret Policy%', true,
  'tenant A''s slug never exposes tenant B''s policy titles (cross-org no-leak)');
-- A DISABLED slug and an UNKNOWN slug both return null (no oracle beyond enabled).
select is(public.trust_center_view('tenant-b-trust'), null, 'a disabled slug returns null (no oracle)');
select is(public.trust_center_view('never-configured'), null, 'an unknown slug returns null');

select * from finish();
rollback;
