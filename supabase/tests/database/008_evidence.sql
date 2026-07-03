begin;
select plan(9);

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
insert into public.evidence (id, organisation_id, title, kind, url, created_by) values
  ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'MFA policy screenshot link', 'link', 'https://example.test/mfa', '10000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Tenant B evidence', 'link', 'https://example.test/b', '10000000-0000-4000-8000-000000000002');

select throws_ok(
  $$ insert into public.evidence (organisation_id, title, kind, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'file without path', 'file', '10000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'file evidence requires a storage path');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq($$ select title from public.evidence $$, $$ values ('MFA policy screenshot link'::text) $$, 'members only see their own tenant evidence');
select throws_ok(
  $$ update public.evidence set title = 'tampered' where id = '80000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'evidence core fields are immutable to clients');
select lives_ok(
  $$ update public.evidence set status = 'withdrawn' where id = '80000000-0000-4000-8000-000000000001' $$,
  'members can withdraw their evidence');
select throws_ok(
  $$ update public.evidence set status = 'current' where id = '80000000-0000-4000-8000-000000000001' $$,
  'P0001', null, 'withdrawn evidence cannot be resurrected');
select throws_ok($$ delete from public.evidence $$, '42501', null, 'clients can never delete evidence');
select throws_ok(
  $$ insert into public.evidence_links (organisation_id, evidence_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  '23514', null, 'an evidence link must target exactly one entity');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('evidence', '20000000-0000-4000-8000-000000000002/upload.pdf') $$,
  '42501', null, 'members cannot upload into another tenant storage prefix');
reset role;
select is(
  (select count(*) from public.audit_events where entity_type = 'evidence' and organisation_id = '20000000-0000-4000-8000-000000000001'),
  2::bigint, 'evidence writes are audited');

select * from finish();
rollback;
