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

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.kpis (organisation_id, indicator, measurement_type, created_by, responsible_id)
     values ('20000000-0000-4000-8000-000000000001', 'Mean time to revoke leaver access', 'manual', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'members log a KPI in their own tenant');
-- The insert policy admits the row (own tenant, created_by = self), then the
-- composite responsible-party FK rejects owner B, who is not a member of
-- tenant A: a genuine cross-org reference failing at the FK, not pre-empted by
-- RLS, so the 23503 assertion is non-vacuous.
select throws_ok(
  $$ insert into public.kpis (organisation_id, indicator, created_by, responsible_id)
     values ('20000000-0000-4000-8000-000000000001', 'x', '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'the responsible party must be a member of the KPI organisation');
select throws_ok(
  $$ insert into public.kpis (organisation_id, indicator, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'forged', '10000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'members cannot log a KPI in another tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.kpis where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'KPIs are read-isolated per tenant');
select results_eq(
  $$ update public.kpis set indicator = 'hijacked' where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant KPI update affects no rows');
select results_eq(
  $$ delete from public.kpis where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant KPI delete affects no rows');

-- audit_events carries the same member-only select policy, so the per-tenant
-- audit assertion is verified back under tenant A's JWT (owner B cannot read
-- tenant A's audit trail).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.audit_events where entity_type = 'kpis' and organisation_id = '20000000-0000-4000-8000-000000000001'), 1::bigint, 'KPI writes are audited per tenant');

select * from finish();
rollback;
