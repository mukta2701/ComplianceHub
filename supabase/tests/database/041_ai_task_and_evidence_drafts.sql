begin;
select plan(2);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('10000000-0000-4000-8000-000000000401', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-task-owner@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values ('20000000-0000-4000-8000-000000000401', 'AI Task Tenant', 'ai-task-tenant', '10000000-0000-4000-8000-000000000401');
insert into public.memberships (organisation_id, user_id, role) values ('20000000-0000-4000-8000-000000000401', '10000000-0000-4000-8000-000000000401', 'owner');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000401","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.ai_suggestions (organisation_id, target_type, target_id, suggestion_type, requester_id, input_snapshot, output, source_references)
     values ('20000000-0000-4000-8000-000000000401', 'task', 'task-1', 'task_remediation', '10000000-0000-4000-8000-000000000401', '{"kind":"task"}', '{"explanation":"draft","recommendedAction":"review"}', '[]') $$,
  'AI task-remediation drafts are accepted as drafts');
select lives_ok(
  $$ insert into public.ai_suggestions (organisation_id, target_type, target_id, suggestion_type, requester_id, input_snapshot, output, source_references)
     values ('20000000-0000-4000-8000-000000000401', 'evidence', 'evidence-1', 'evidence_review', '10000000-0000-4000-8000-000000000401', '{"kind":"evidence"}', '{"explanation":"draft","recommendedAction":"review"}', '[]') $$,
  'AI evidence-review drafts are accepted as drafts');

select * from finish();
rollback;
