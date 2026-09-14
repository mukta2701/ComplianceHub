begin;
select plan(2);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('10000000-0000-4000-8000-000000000301', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-audit-owner@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values ('20000000-0000-4000-8000-000000000301', 'AI Audit Tenant', 'ai-audit-tenant', '10000000-0000-4000-8000-000000000301');
insert into public.memberships (organisation_id, user_id, role) values ('20000000-0000-4000-8000-000000000301', '10000000-0000-4000-8000-000000000301', 'owner');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000301","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.ai_suggestions (organisation_id, target_type, target_id, suggestion_type, requester_id, input_snapshot, output, source_references)
     values ('20000000-0000-4000-8000-000000000301', 'audit', 'audit-1', 'audit_preparation', '10000000-0000-4000-8000-000000000301', '{"kind":"audit"}', '{"explanation":"draft","recommendedAction":"review"}', '[]') $$,
  'AI audit-preparation drafts are accepted as drafts');
select throws_ok(
  $$ insert into public.ai_suggestions (organisation_id, target_type, target_id, suggestion_type, requester_id, input_snapshot, output, source_references)
     values ('20000000-0000-4000-8000-000000000301', 'unknown_target', 'x', 'audit_preparation', '10000000-0000-4000-8000-000000000301', '{}', '{}', '[]') $$,
  '23514', null, 'unknown AI target types are rejected');

select * from finish();
rollback;
