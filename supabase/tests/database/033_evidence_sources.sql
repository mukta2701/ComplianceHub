begin;
select plan(11);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member');

-- Owner-only RLS on evidence_sources (mirrors integration_connections).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.evidence_sources (id, organisation_id, provider, label, connected_by)
     values ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'github', 'Engineering GitHub', '10000000-0000-4000-8000-000000000001') $$,
  'owners create evidence sources in their own tenant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.evidence_sources (organisation_id, provider, connected_by)
     values ('20000000-0000-4000-8000-000000000001', 'aws', '10000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'non-owner members cannot create evidence sources');
select is((select count(*) from public.evidence_sources where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'non-owner members cannot list sources (tokens stay hidden)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.evidence_sources (organisation_id, provider, connected_by)
     values ('20000000-0000-4000-8000-000000000001', 'github', '10000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'owners of another tenant cannot create sources in tenant A');
select is((select count(*) from public.evidence_sources where organisation_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'sources are read-isolated per tenant');
select results_eq(
  $$ update public.evidence_sources set revoked_at = now() where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant update affects no rows');
select results_eq(
  $$ delete from public.evidence_sources where organisation_id = '20000000-0000-4000-8000-000000000001' returning id $$,
  $$ select null::uuid where false $$, 'cross-tenant delete affects no rows');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ update public.evidence_sources set label = 'Renamed' where id = '60000000-0000-4000-8000-000000000001' $$,
  'owners update their own evidence sources');

-- Evidence can carry a source. Composite tenant FK holds within-tenant and
-- rejects cross-tenant; (source_id, external_ref) uniqueness rejects duplicates.
reset role;
insert into public.evidence_sources (id, organisation_id, provider, connected_by) values
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'aws', '10000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.evidence (organisation_id, title, kind, source_id, external_ref, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'Cross-tenant source', 'note', '60000000-0000-4000-8000-000000000002', 'x-ref', '10000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'evidence cannot reference a source from another tenant');
select lives_ok(
  $$ insert into public.evidence (organisation_id, title, kind, source_id, external_ref, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'MFA enforcement report', 'note', '60000000-0000-4000-8000-000000000001', 'gh-branch-protection', '10000000-0000-4000-8000-000000000001') $$,
  'evidence carries a within-tenant source and external_ref');
select throws_ok(
  $$ insert into public.evidence (organisation_id, title, kind, source_id, external_ref, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'Duplicate re-collection', 'note', '60000000-0000-4000-8000-000000000001', 'gh-branch-protection', '10000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'a duplicate (source_id, external_ref) is rejected');

select * from finish();
rollback;
