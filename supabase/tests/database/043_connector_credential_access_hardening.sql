begin;
select plan(3);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('10000000-0000-4000-8000-000000000601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'connector-owner@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values ('20000000-0000-4000-8000-000000000601', 'Connector Tenant', 'connector-tenant', '10000000-0000-4000-8000-000000000601');
insert into public.memberships (organisation_id, user_id, role) values ('20000000-0000-4000-8000-000000000601', '10000000-0000-4000-8000-000000000601', 'owner');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000601","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.evidence_sources (organisation_id, provider, access_token, connected_by) values ('20000000-0000-4000-8000-000000000601', 'github', 'secret', '10000000-0000-4000-8000-000000000601') $$,
  'owner can save a source credential for server-side collection');
select throws_ok(
  $$ select access_token from public.evidence_sources $$,
  '42501', null, 'authenticated owners cannot select evidence source credentials');
select is((select count(*) from public.evidence_sources), 1::bigint, 'owners can still read source metadata rows');

select * from finish();
rollback;
