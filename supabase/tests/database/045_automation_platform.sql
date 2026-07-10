begin;
select plan(18);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000701', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'automation-owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000702', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'automation-member-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000703', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'automation-owner-b@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000701', 'Automation Tenant A', 'automation-tenant-a', '10000000-0000-4000-8000-000000000701'),
  ('20000000-0000-4000-8000-000000000702', 'Automation Tenant B', 'automation-tenant-b', '10000000-0000-4000-8000-000000000703');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000701', '10000000-0000-4000-8000-000000000701', 'owner'),
  ('20000000-0000-4000-8000-000000000701', '10000000-0000-4000-8000-000000000702', 'member'),
  ('20000000-0000-4000-8000-000000000702', '10000000-0000-4000-8000-000000000701', 'owner'),
  ('20000000-0000-4000-8000-000000000702', '10000000-0000-4000-8000-000000000703', 'owner');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000701","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.connector_connections (id, organisation_id, provider, label, connected_by, owner_id, consent)
     values ('30000000-0000-4000-8000-000000000701', '20000000-0000-4000-8000-000000000701', 'github', 'Engineering GitHub', '10000000-0000-4000-8000-000000000701', '10000000-0000-4000-8000-000000000702', '{"version":1,"contentAnalysis":true}') $$,
  'owner creates a consented connector for their workspace');
select lives_ok(
  $$ insert into public.automation_assignments (organisation_id, area, owner_id, assigned_by)
     values ('20000000-0000-4000-8000-000000000701', 'engineering', '10000000-0000-4000-8000-000000000702', '10000000-0000-4000-8000-000000000701') $$,
  'owner assigns a member to an automation area');

set local role service_role;
select lives_ok(
  $$ update public.connector_connections set secret_reference = 'secret://github/a' where id = '30000000-0000-4000-8000-000000000701' $$,
  'server-only collector stores a secret reference');

set local role postgres;
select lives_ok(
  $$ insert into public.source_objects (id, organisation_id, connection_id, external_ref, title, content_ref, content_hash, classification, expires_at)
     values ('40000000-0000-4000-8000-000000000701', '20000000-0000-4000-8000-000000000701', '30000000-0000-4000-8000-000000000701', 'repo:acme/app', 'Branch protection report', 'private://automation/a/branch-protection.json', 'hash-a', 'metadata', now() + interval '30 days') $$,
  'collector stores private source-object provenance without exposing content');
select lives_ok(
  $$ insert into public.automation_signals (id, organisation_id, connection_id, source_object_id, signal_type, summary, confidence, occurred_at)
     values ('50000000-0000-4000-8000-000000000701', '20000000-0000-4000-8000-000000000701', '30000000-0000-4000-8000-000000000701', '40000000-0000-4000-8000-000000000701', 'github.branch_protection', 'Protected branches detected', 'high', now()) $$,
  'collector stores a normalised automation signal');

select lives_ok(
  $$ insert into public.automation_proposals (id, organisation_id, signal_id, target_type, assigned_to, created_by, input_snapshot, output, source_references)
     values ('60000000-0000-4000-8000-000000000701', '20000000-0000-4000-8000-000000000701', '50000000-0000-4000-8000-000000000701', 'evidence', '10000000-0000-4000-8000-000000000702', '10000000-0000-4000-8000-000000000701', '{"signal":"github.branch_protection"}', '{"summary":"Review the protection evidence"}', '[{"type":"source_object","id":"40000000-0000-4000-8000-000000000701"}]') $$,
  'collector creates a draft proposal for the assigned member');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000702","role":"authenticated"}', true);
select is((select count(*) from public.connector_connections), 1::bigint, 'members can read non-secret connector metadata');
select throws_ok(
  $$ select secret_reference from public.connector_connections $$,
  '42501', null, 'members cannot read connector secret references');
select is((select count(*) from public.source_objects), 1::bigint, 'members can read source provenance but not its private content');
select is((select count(*) from public.automation_proposals where assigned_to = '10000000-0000-4000-8000-000000000702'), 1::bigint, 'assigned member can see a workspace-created review proposal');
select lives_ok(
  $$ update public.automation_proposals set status = 'accepted', reviewer_id = '10000000-0000-4000-8000-000000000702'
     where id = '60000000-0000-4000-8000-000000000701' $$,
  'assigned member accepts a draft proposal');
select throws_ok(
  $$ update public.automation_proposals set output = '{"summary":"tampered"}'
     where id = '60000000-0000-4000-8000-000000000701' $$,
  '42501', null, 'accepted proposal content is immutable');
select throws_ok(
  $$ insert into public.automation_proposals (organisation_id, target_type, assigned_to, created_by, input_snapshot, output, source_references, status)
     values ('20000000-0000-4000-8000-000000000701', 'risk', '10000000-0000-4000-8000-000000000702', '10000000-0000-4000-8000-000000000702', '{}', '{}', '[]', 'accepted') $$,
  '42501', null, 'members cannot create an already accepted automation proposal');

set local role service_role;
select throws_ok(
  $$ update public.automation_proposals set status = 'dismissed' where id = '60000000-0000-4000-8000-000000000701' $$,
  '42501', null, 'collector role cannot review a proposal');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000701","role":"authenticated"}', true);
select throws_ok(
  $$ update public.connector_connections set organisation_id = '20000000-0000-4000-8000-000000000702' where id = '30000000-0000-4000-8000-000000000701' $$,
  '42501', null, 'an owner of both tenants cannot move a connector between them');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000703","role":"authenticated"}', true);
select is((select count(*) from public.connector_connections), 0::bigint, 'other tenants cannot read connectors');
select results_eq(
  $$ update public.automation_proposals set status = 'dismissed', reviewer_id = '10000000-0000-4000-8000-000000000703'
     where id = '60000000-0000-4000-8000-000000000701' returning id $$,
  $$ select null::uuid where false $$,
  'other tenants cannot review proposals');
select results_eq(
  $$ update public.connector_connections set status = 'revoked' where id = '30000000-0000-4000-8000-000000000701' returning id $$,
  $$ select null::uuid where false $$,
  'other tenants cannot change connector lifecycle');

select * from finish();
rollback;
