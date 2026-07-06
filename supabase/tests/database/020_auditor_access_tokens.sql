begin;
select plan(15);

-- Four identities: owner A (0001) and member A (0003) in tenant A; owner B
-- (0002) and member B (0004) in tenant B. The owner-only gate must deny every
-- non-owner (same-org member AND either role of another tenant) on all four
-- verbs, and the composite tenant FK must reject a cross-org audit reference.
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
-- An audit owned by tenant B, used to prove the composite tenant FK rejects a
-- token in tenant A that references tenant B's audit.
insert into public.audits (id, organisation_id, reference, title, created_by) values
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'AUD-B', 'Tenant B audit', '10000000-0000-4000-8000-000000000002');

-- Owner A mints a token in their own tenant (the row every later probe targets).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.auditor_access_tokens (id, organisation_id, token_hash, label, expires_at, created_by)
     values ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'hash-a', 'External auditor', now() + interval '7 days', '10000000-0000-4000-8000-000000000001') $$,
  'owners mint tokens in their own tenant');

-- Owner-only gate: a NON-OWNER member of the SAME tenant is denied all 4 verbs.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.auditor_access_tokens (organisation_id, token_hash, expires_at, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'hash-m', now() + interval '7 days', '10000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'same-org non-owner cannot INSERT tokens');
select is((select count(*) from public.auditor_access_tokens where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint,
  'same-org non-owner cannot SELECT tokens');
select results_eq(
  $$ update public.auditor_access_tokens set revoked_at = now() where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'same-org non-owner UPDATE affects no rows');
select results_eq(
  $$ delete from public.auditor_access_tokens where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'same-org non-owner DELETE affects no rows');

-- Cross-tenant: another tenant's OWNER is denied all 4 verbs on tenant A's token.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.auditor_access_tokens (organisation_id, token_hash, expires_at, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'hash-b', now() + interval '7 days', '10000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'another tenant''s owner cannot INSERT tokens for tenant A');
select is((select count(*) from public.auditor_access_tokens where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint,
  'another tenant''s owner cannot SELECT tenant A tokens');
select results_eq(
  $$ update public.auditor_access_tokens set revoked_at = now() where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'another tenant''s owner UPDATE affects no rows');
select results_eq(
  $$ delete from public.auditor_access_tokens where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'another tenant''s owner DELETE affects no rows');

-- Cross-tenant: another tenant's MEMBER is denied all 4 verbs on tenant A's token.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.auditor_access_tokens (organisation_id, token_hash, expires_at, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'hash-bm', now() + interval '7 days', '10000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'another tenant''s member cannot INSERT tokens for tenant A');
select is((select count(*) from public.auditor_access_tokens where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint,
  'another tenant''s member cannot SELECT tenant A tokens');
select results_eq(
  $$ update public.auditor_access_tokens set revoked_at = now() where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'another tenant''s member UPDATE affects no rows');
select results_eq(
  $$ delete from public.auditor_access_tokens where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'another tenant''s member DELETE affects no rows');

-- Composite tenant FK: owner A cannot bind a tenant A token to tenant B's audit.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.auditor_access_tokens (organisation_id, token_hash, audit_id, expires_at, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'hash-fk', '30000000-0000-4000-8000-000000000002', now() + interval '7 days', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'a token cannot reference an audit from another tenant');

-- Owner A revokes their own token.
select lives_ok(
  $$ update public.auditor_access_tokens set revoked_at = now() where id = '40000000-0000-4000-8000-000000000001' $$,
  'owners revoke their own tokens');

select * from finish();
rollback;
