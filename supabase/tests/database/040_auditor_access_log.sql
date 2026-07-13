begin;
select plan(16);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a-log@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b-log@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a-log@example.test', '', now(), '{}', '{}');

insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Log Tenant A', 'log-tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Log Tenant B', 'log-tenant-b', '10000000-0000-4000-8000-000000000002');

insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member');

insert into public.auditor_access_tokens (id, organisation_id, token_hash, label, expires_at, revoked_at, created_by) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('valid-log-token','UTF8'),'sha256'),'hex'), 'Valid external auditor', now() + interval '7 days', null, '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('expired-log-token','UTF8'),'sha256'),'hex'), 'Expired external auditor', now() - interval '1 day', null, '10000000-0000-4000-8000-000000000001'),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('revoked-log-token','UTF8'),'sha256'),'hex'), 'Revoked external auditor', now() + interval '7 days', now(), '10000000-0000-4000-8000-000000000001');

select is((select count(*)::integer from pg_catalog.pg_trigger
  where tgrelid = 'public.auditor_access_log'::regclass and not tgisinternal), 0,
  'access logging does not emit duplicate generic audit events');

set local role anon;
select throws_ok(
  $$ insert into public.auditor_access_log (organisation_id, token_id)
     values ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anonymous callers cannot insert access-log rows directly');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.auditor_access_log (organisation_id, token_id)
     values ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'owners cannot insert access-log rows directly');

reset role;
insert into public.auditor_access_log (organisation_id, token_id, viewed_at)
values ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', now() - interval '1 hour');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.auditor_access_log), 1::bigint,
  'an organisation owner can read their access log');
select throws_ok(
  $$ update public.auditor_access_log set viewed_at = now()
     where token_id = '40000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'owners cannot update access-log rows directly');
select throws_ok(
  $$ delete from public.auditor_access_log
     where token_id = '40000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'owners cannot delete access-log rows directly');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.auditor_access_log), 0::bigint,
  'a same-organisation non-owner cannot read access logs');

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.auditor_access_log), 0::bigint,
  'another organisation owner cannot read cross-tenant access logs');

set local role anon;
select isnt(public.audit_view_for_token('valid-log-token'), null,
  'a valid public auditor token still resolves successfully');

reset role;
select results_eq(
  $$ select token_id from public.auditor_access_log order by viewed_at desc limit 1 $$,
  $$ values ('40000000-0000-4000-8000-000000000001'::uuid) $$,
  'a successful resolution logs the exact token used');

set local role anon;
select is(public.audit_view_for_token('never-issued-log-token'), null,
  'an invalid token is still refused');
select is(public.audit_view_for_token('expired-log-token'), null,
  'an expired token is still refused');
select is(public.audit_view_for_token('revoked-log-token'), null,
  'a revoked token is still refused');

reset role;
select is((select count(*) from public.auditor_access_log
  where organisation_id = '20000000-0000-4000-8000-000000000001'), 2::bigint,
  'invalid, expired, and revoked token attempts do not create log rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ delete from public.auditor_access_tokens
     where id = '40000000-0000-4000-8000-000000000001' $$,
  '23503', null, 'a token with recorded views cannot be deleted');

reset role;
select is((select count(*) from public.auditor_access_log
  where token_id = '40000000-0000-4000-8000-000000000001'), 2::bigint,
  'blocked token deletion preserves its access history');

select * from finish();
rollback;
