begin;
select plan(11);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-owner-b@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-member-a@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000101', 'AI Tenant A', 'ai-tenant-a', '10000000-0000-4000-8000-000000000101'),
  ('20000000-0000-4000-8000-000000000102', 'AI Tenant B', 'ai-tenant-b', '10000000-0000-4000-8000-000000000102');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000101', 'owner'),
  ('20000000-0000-4000-8000-000000000102', '10000000-0000-4000-8000-000000000102', 'owner'),
  ('20000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000103', 'member');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.ai_workspace_settings (organisation_id, enabled, updated_by)
     values ('20000000-0000-4000-8000-000000000101', true, '10000000-0000-4000-8000-000000000101') $$,
  'owner enables AI for their own workspace');
select lives_ok(
  $$ insert into public.ai_suggestions (id, organisation_id, target_type, target_id, suggestion_type, requester_id, input_snapshot, output, source_references)
     values ('30000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000101', 'assessment_question', 'question-a', 'assessment_remediation', '10000000-0000-4000-8000-000000000101', '{"kind":"assessment"}', '{"explanation":"draft","recommendedAction":"review"}', '[]') $$,
  'member-scoped request creates a draft suggestion');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000103","role":"authenticated"}', true);
select is((select enabled from public.ai_workspace_settings where organisation_id = '20000000-0000-4000-8000-000000000101'), true, 'members can read the workspace opt-in state');
select results_eq(
  $$ update public.ai_workspace_settings set enabled = false where organisation_id = '20000000-0000-4000-8000-000000000101' returning organisation_id $$,
  $$ select null::uuid where false $$,
  'non-owner members cannot change AI opt-in');
select lives_ok(
  $$ insert into public.ai_suggestions (id, organisation_id, target_type, target_id, suggestion_type, requester_id, input_snapshot, output, source_references)
     values ('30000000-0000-4000-8000-000000000102', '20000000-0000-4000-8000-000000000101', 'soa_item', 'item-a', 'soa_rationale', '10000000-0000-4000-8000-000000000103', '{"kind":"soa"}', '{"explanation":"draft","recommendedAction":"review"}', '[]') $$,
  'members can request their own draft suggestions');
select throws_ok(
  $$ insert into public.ai_suggestions (organisation_id, target_type, target_id, suggestion_type, requester_id, input_snapshot, output, source_references, status)
     values ('20000000-0000-4000-8000-000000000101', 'soa_item', 'item-b', 'soa_rationale', '10000000-0000-4000-8000-000000000103', '{}', '{}', '[]', 'accepted') $$,
  '42501', null, 'suggestions cannot be created as accepted decisions');
select lives_ok(
  $$ update public.ai_suggestions set status = 'accepted', reviewer_id = '10000000-0000-4000-8000-000000000103'
     where id = '30000000-0000-4000-8000-000000000102' $$,
  'requester may mark their draft as reviewed');
select throws_ok(
  $$ update public.ai_suggestions set output = '{"explanation":"tampered"}'
     where id = '30000000-0000-4000-8000-000000000102' $$,
  '42501', null, 'accepted suggestion output is immutable');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
select is((select count(*) from public.ai_suggestions where organisation_id = '20000000-0000-4000-8000-000000000101'), 0::bigint, 'other tenants cannot read suggestions');
select results_eq(
  $$ update public.ai_suggestions set status = 'dismissed', reviewer_id = '10000000-0000-4000-8000-000000000102'
     where id = '30000000-0000-4000-8000-000000000101' returning id $$,
  $$ select null::uuid where false $$,
  'other tenants cannot change a suggestion');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
select is((select status::text from public.ai_suggestions where id = '30000000-0000-4000-8000-000000000102'), 'accepted', 'review state is retained');
select * from finish();
rollback;
