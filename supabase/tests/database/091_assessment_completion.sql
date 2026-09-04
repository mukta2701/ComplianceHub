begin;
select plan(19);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
('91000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','completion-owner@example.test','',now(),'{}','{}'),
('91000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','completion-member@example.test','',now(),'{}','{}'),
('91000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','completion-admin@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
('91000000-0000-4000-8000-000000000010','Completion tenant','completion-tenant','91000000-0000-4000-8000-000000000001'),
('91000000-0000-4000-8000-000000000011','Sibling tenant','completion-sibling','91000000-0000-4000-8000-000000000001');
insert into public.memberships(organisation_id,user_id,role) values
('91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000001','owner'),
('91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000002','member'),
('91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000003','admin'),
('91000000-0000-4000-8000-000000000011','91000000-0000-4000-8000-000000000001','owner');
insert into public.catalogue_versions(id,version,title,published_at) values ('91000000-0000-4000-8000-000000000020','completion-test','Completion test',now());
insert into public.catalogue_categories(id,catalogue_version_id,code,title,position) values ('91000000-0000-4000-8000-000000000021','91000000-0000-4000-8000-000000000020','TEST','Test',0);
insert into public.catalogue_questions(id,catalogue_version_id,category_id,code,prompt,position) values
('91000000-0000-4000-8000-000000000022','91000000-0000-4000-8000-000000000020','91000000-0000-4000-8000-000000000021','TEST-1','First',0),
('91000000-0000-4000-8000-000000000023','91000000-0000-4000-8000-000000000020','91000000-0000-4000-8000-000000000021','TEST-2','Second',1);
insert into public.assessment_sessions(id,organisation_id,catalogue_version_id,title,created_by) values
('91000000-0000-4000-8000-000000000030','91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000020','Completion test','91000000-0000-4000-8000-000000000001');

select has_function('public','complete_assessment',array['uuid','uuid','bigint'],'completion RPC exists');
select ok(not coalesce((select prosecdef from pg_proc where oid=to_regprocedure('public.complete_assessment(uuid,uuid,bigint)')),true),'public RPC is invoker');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$insert into public.assessment_sessions(id,organisation_id,catalogue_version_id,title,created_by,state,completed_at) values
('91000000-0000-4000-8000-000000000031','91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000020','Forged completion','91000000-0000-4000-8000-000000000001','completed',now())$$,
'23514','New assessments must start as drafts','operator cannot bypass completion by inserting a completed session');
select lives_ok($$insert into public.assessment_sessions(id,organisation_id,catalogue_version_id,title,created_by) values
('91000000-0000-4000-8000-000000000032','91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000020','New draft','91000000-0000-4000-8000-000000000001')$$,
'operator can still create a draft assessment');
select lives_ok($$select public.save_assessment_response('91000000-0000-4000-8000-000000000030','91000000-0000-4000-8000-000000000022','yes','',0)$$,'first answer saves');
select throws_ok($$select public.complete_assessment('91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000030',1)$$,'23514','Answer every assessment question before completing','incomplete catalogue cannot complete');
select is((select state::text from public.assessment_sessions where id='91000000-0000-4000-8000-000000000030'),'draft','failed completion stays draft');
select lives_ok($$select public.save_assessment_response('91000000-0000-4000-8000-000000000030','91000000-0000-4000-8000-000000000023','not_applicable','Outside scope',1)$$,'second answer saves');
select throws_ok($$select public.complete_assessment('91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000030',1)$$,'40001','Assessment revision conflict','stale completion is rejected');
select throws_ok($$select public.complete_assessment('91000000-0000-4000-8000-000000000011','91000000-0000-4000-8000-000000000030',2)$$,'P0002','Assessment not found in active workspace','sibling workspace cannot complete this assessment');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.complete_assessment('91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000030',2)$$,'42501','Only workspace operators can complete assessments','Member cannot complete');
select set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select lives_ok($$select public.complete_assessment('91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000030',2)$$,'Admin can complete fully answered assessment');
select is((select state::text from public.assessment_sessions where id='91000000-0000-4000-8000-000000000030'),'completed','completion persists state');
select ok((select completed_at is not null and revision=2 from public.assessment_sessions where id='91000000-0000-4000-8000-000000000030'),'completion records timestamp and preserves final answer revision');
select lives_ok($$select public.complete_assessment('91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000030',2)$$,'same completed revision is retryable');
select throws_ok($$select public.save_assessment_response('91000000-0000-4000-8000-000000000030','91000000-0000-4000-8000-000000000022','no','',2)$$,'40001',null,'completed answers cannot be overwritten');
select throws_ok($$update public.assessment_sessions set state='draft',completed_at=null where id='91000000-0000-4000-8000-000000000030'$$,'42501',null,'completion does not grant direct table updates');
reset role;
select is((select count(*) from public.audit_events where entity_type='assessment_sessions' and entity_id='91000000-0000-4000-8000-000000000030' and action='update'),3::bigint,'idempotent retry adds no audit mutation');
set local role anon;
select throws_ok($$select public.complete_assessment('91000000-0000-4000-8000-000000000010','91000000-0000-4000-8000-000000000030',2)$$,'42501',null,'anonymous cannot execute completion');
reset role;
select * from finish();
rollback;
