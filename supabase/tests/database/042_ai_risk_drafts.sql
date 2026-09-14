begin;
select plan(1);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('10000000-0000-4000-8000-000000000501', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ai-risk-owner@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values ('20000000-0000-4000-8000-000000000501', 'AI Risk Tenant', 'ai-risk-tenant', '10000000-0000-4000-8000-000000000501');
insert into public.memberships (organisation_id, user_id, role) values ('20000000-0000-4000-8000-000000000501', '10000000-0000-4000-8000-000000000501', 'owner');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000501","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.ai_suggestions (organisation_id, target_type, target_id, suggestion_type, requester_id, input_snapshot, output, source_references)
     values ('20000000-0000-4000-8000-000000000501', 'risk', 'risk-1', 'risk_scenario', '10000000-0000-4000-8000-000000000501', '{"kind":"risk"}', '{"explanation":"draft","recommendedAction":"review"}', '[]') $$,
  'AI risk-scenario drafts are accepted as drafts');

select * from finish();
rollback;
