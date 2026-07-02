begin;
select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('30000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assessor@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by)
values ('30000000-0000-4000-8000-000000000002', 'Assessment Tenant', 'assessment-tenant', '30000000-0000-4000-8000-000000000001');
insert into public.memberships (organisation_id, user_id, role)
values ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'owner');
insert into public.assessment_sessions (id, organisation_id, catalogue_version_id, title, created_by)
values (
  '30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001', 'Readiness review', '30000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  format(
    $$ select public.save_assessment_response(
      '30000000-0000-4000-8000-000000000003', %L, 'partially', 'Evidence is being collected.', 0
    ) $$,
    (select id from public.catalogue_questions where code = 'GOV-01')
  ),
  'the current revision can be saved'
);
select is(
  (select revision from public.assessment_sessions where id = '30000000-0000-4000-8000-000000000003'),
  1::bigint,
  'saving increments the revision exactly once'
);
select throws_ok(
  format(
    $$ select public.save_assessment_response(
      '30000000-0000-4000-8000-000000000003', %L, 'yes', '', 0
    ) $$,
    (select id from public.catalogue_questions where code = 'GOV-01')
  ),
  '40001', 'assessment revision conflict', 'stale revisions are rejected'
);
select throws_ok(
  format(
    $$ insert into public.assessment_responses
      (organisation_id, session_id, question_id, answer, updated_by)
      values ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', %L, 'yes', '30000000-0000-4000-8000-000000000001') $$,
    (select id from public.catalogue_questions where code = 'GOV-01')
  ),
  '42501', null, 'clients cannot bypass the revision function'
);

select * from finish();
rollback;
