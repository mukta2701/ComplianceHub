begin;
select plan(79);

select has_table('public', 'policy_feedback_threads', 'policy feedback threads exist');
select has_table('public', 'policy_feedback_comments', 'policy feedback comments exist');
select has_table('public', 'leadership_report_snapshots', 'leadership report snapshots exist');
select has_function('public', 'create_policy_feedback', array['uuid','text','text'], 'feedback creation uses a narrow RPC');
select has_function('public', 'reply_policy_feedback', array['uuid','text'], 'feedback replies use a narrow RPC');
select has_function('public', 'set_policy_feedback_status', array['uuid','boolean'], 'feedback status uses an operator RPC');
select has_function('public', 'publish_leadership_report', array['uuid','jsonb'], 'leadership publication uses a narrow RPC');
select ok(pg_catalog.lower(pg_catalog.pg_get_functiondef('public.reply_policy_feedback(uuid,text)'::regprocedure)) like '%for share of policy%', 'feedback replies lock policy status against concurrent lifecycle changes');
select ok(pg_catalog.pg_get_functiondef('public.set_policy_feedback_status(uuid,boolean)'::regprocedure) like '%from public.memberships as membership%for share;%', 'feedback status changes lock the operator membership against concurrent demotion');
select ok(pg_catalog.pg_get_functiondef('public.publish_leadership_report(uuid,jsonb)'::regprocedure) like '%from public.memberships as membership%for share;%', 'report publication locks the operator membership against concurrent demotion');
select has_trigger('public','policy_feedback_threads','policy_feedback_threads_audit','feedback thread changes are audited');
select has_trigger('public','policy_feedback_comments','policy_feedback_comments_audit','feedback comments are audited');
select has_trigger('public','leadership_report_snapshots','leadership_report_snapshots_audit','leadership report publication is audited');

select ok(not has_table_privilege('authenticated','public.policy_feedback_threads','INSERT'), 'portal callers cannot directly insert feedback threads');
select ok(not has_table_privilege('authenticated','public.policy_feedback_threads','UPDATE'), 'portal callers cannot directly update feedback threads');
select ok(not has_table_privilege('authenticated','public.policy_feedback_threads','DELETE'), 'portal callers cannot directly delete feedback threads');
select ok(not has_table_privilege('authenticated','public.policy_feedback_comments','INSERT'), 'portal callers cannot directly insert feedback comments');
select ok(not has_table_privilege('authenticated','public.policy_feedback_comments','UPDATE'), 'portal callers cannot edit feedback comments');
select ok(not has_table_privilege('authenticated','public.policy_feedback_comments','DELETE'), 'portal callers cannot delete feedback comments');
select ok(not has_table_privilege('authenticated','public.leadership_report_snapshots','INSERT'), 'portal callers cannot directly publish snapshots');
select ok(not has_table_privilege('authenticated','public.leadership_report_snapshots','UPDATE'), 'portal callers cannot update snapshots');
select ok(not has_table_privilege('authenticated','public.leadership_report_snapshots','DELETE'), 'portal callers cannot delete snapshots');

select is((select proowner::regrole::text from pg_proc where oid='public.create_policy_feedback(uuid,text,text)'::regprocedure),'postgres','feedback creation has a trusted owner');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.create_policy_feedback(uuid,text,text)'::regprocedure),'feedback creation pins an empty search path');
select is((select proowner::regrole::text from pg_proc where oid='public.reply_policy_feedback(uuid,text)'::regprocedure),'postgres','feedback reply has a trusted owner');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.reply_policy_feedback(uuid,text)'::regprocedure),'feedback reply pins an empty search path');
select is((select proowner::regrole::text from pg_proc where oid='public.set_policy_feedback_status(uuid,boolean)'::regprocedure),'postgres','feedback status has a trusted owner');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.set_policy_feedback_status(uuid,boolean)'::regprocedure),'feedback status pins an empty search path');
select is((select proowner::regrole::text from pg_proc where oid='public.publish_leadership_report(uuid,jsonb)'::regprocedure),'postgres','snapshot publication has a trusted owner');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.publish_leadership_report(uuid,jsonb)'::regprocedure),'snapshot publication pins an empty search path');
select ok(not has_function_privilege('anon','public.create_policy_feedback(uuid,text,text)','EXECUTE'), 'anon cannot create feedback');
select ok(not has_function_privilege('public','public.create_policy_feedback(uuid,text,text)','EXECUTE'), 'PUBLIC cannot create feedback');
select ok(not has_function_privilege('service_role','public.create_policy_feedback(uuid,text,text)','EXECUTE'), 'service role is not part of the feedback creation API');
select ok(has_function_privilege('authenticated','public.create_policy_feedback(uuid,text,text)','EXECUTE'), 'authenticated members may invoke guarded feedback creation');
select ok(not has_function_privilege('anon','public.reply_policy_feedback(uuid,text)','EXECUTE'), 'anon cannot reply to feedback');
select ok(not has_function_privilege('public','public.reply_policy_feedback(uuid,text)','EXECUTE'), 'PUBLIC cannot reply to feedback');
select ok(not has_function_privilege('service_role','public.reply_policy_feedback(uuid,text)','EXECUTE'), 'service role is not part of the feedback reply API');
select ok(has_function_privilege('authenticated','public.reply_policy_feedback(uuid,text)','EXECUTE'), 'authenticated members may invoke guarded feedback replies');
select ok(not has_function_privilege('anon','public.set_policy_feedback_status(uuid,boolean)','EXECUTE'), 'anon cannot change feedback status');
select ok(not has_function_privilege('public','public.set_policy_feedback_status(uuid,boolean)','EXECUTE'), 'PUBLIC cannot change feedback status');
select ok(not has_function_privilege('service_role','public.set_policy_feedback_status(uuid,boolean)','EXECUTE'), 'service role is not part of the feedback status API');
select ok(has_function_privilege('authenticated','public.set_policy_feedback_status(uuid,boolean)','EXECUTE'), 'authenticated operators may invoke guarded feedback status changes');
select ok(not has_function_privilege('anon','public.publish_leadership_report(uuid,jsonb)','EXECUTE'), 'anon cannot publish reports');
select ok(not has_function_privilege('public','public.publish_leadership_report(uuid,jsonb)','EXECUTE'), 'PUBLIC cannot publish reports');
select ok(not has_function_privilege('service_role','public.publish_leadership_report(uuid,jsonb)','EXECUTE'), 'service role is not part of the report publication API');
select ok(has_function_privilege('authenticated','public.publish_leadership_report(uuid,jsonb)','EXECUTE'), 'authenticated operators may invoke guarded report publication');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('7a000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','feedback-owner@example.test','',now(),'{}','{}'),
 ('7a000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','feedback-admin@example.test','',now(),'{}','{}'),
 ('7a000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','feedback-member@example.test','',now(),'{}','{}'),
 ('7a000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','feedback-outsider@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000001","email":"feedback-owner@example.test","role":"authenticated"}',true);
select set_config('app.feedback_org',public.create_organisation_with_owner('Feedback org','feedback-org')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.feedback_org')::uuid,'7a000000-0000-4000-8000-000000000002','admin'),
 (current_setting('app.feedback_org')::uuid,'7a000000-0000-4000-8000-000000000003','member');
insert into public.policies(id,organisation_id,reference,title,body,version,status,created_by) values
 ('7a000000-0000-4000-8000-000000000101',current_setting('app.feedback_org')::uuid,'FB-1','Approved feedback','body',4,'approved','7a000000-0000-4000-8000-000000000001'),
 ('7a000000-0000-4000-8000-000000000102',current_setting('app.feedback_org')::uuid,'FB-2','Draft feedback','body',2,'draft','7a000000-0000-4000-8000-000000000001');

select throws_ok($$ select public.create_policy_feedback('7a000000-0000-4000-8000-000000000102','Owner draft comment','Even Owners collaborate only on approved policy versions') $$,'42501','policy is not available for feedback','Owner cannot create feedback on a draft policy');

select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000003","email":"feedback-member@example.test","role":"authenticated"}',true);
select lives_ok($$ select public.create_policy_feedback('7a000000-0000-4000-8000-000000000101','Please clarify','Could this control include contractors?') $$,'Member can create feedback on an approved policy');
select set_config('app.feedback_thread',(select id::text from public.policy_feedback_threads limit 1),true);
select results_eq(
  $$ select organisation_id,policy_version,author_id,status,subject from public.policy_feedback_threads $$,
  $$ values(current_setting('app.feedback_org')::uuid,4,'7a000000-0000-4000-8000-000000000003'::uuid,'open'::text,'Please clarify'::text) $$,
  'thread org, policy version, author, status, and subject are authoritative'
);
select results_eq(
  $$ select author_id,body from public.policy_feedback_comments $$,
  $$ values('7a000000-0000-4000-8000-000000000003'::uuid,'Could this control include contractors?'::text) $$,
  'first comment author and body are stored together'
);
select throws_ok($$ select public.create_policy_feedback('7a000000-0000-4000-8000-000000000102','Draft comment','Members must not see drafts') $$,'42501','policy is not available for feedback','Member cannot comment on a draft policy');
select throws_ok($$ select public.set_policy_feedback_status(current_setting('app.feedback_thread')::uuid,true) $$,'42501','only workspace operators can change feedback status','Member cannot resolve feedback');

select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000002","email":"feedback-admin@example.test","role":"authenticated"}',true);
select lives_ok($$ select public.reply_policy_feedback(current_setting('app.feedback_thread')::uuid,'We will clarify the scope.') $$,'Admin can reply to open feedback');
select lives_ok($$ select public.set_policy_feedback_status(current_setting('app.feedback_thread')::uuid,true) $$,'Admin can resolve feedback');
select throws_ok($$ select public.reply_policy_feedback(current_setting('app.feedback_thread')::uuid,'Late reply') $$,'22023','feedback thread is closed','closed feedback cannot receive replies');
select lives_ok($$ select public.set_policy_feedback_status(current_setting('app.feedback_thread')::uuid,false) $$,'Admin can reopen feedback');
select lives_ok($$ select public.reply_policy_feedback(current_setting('app.feedback_thread')::uuid,'Reply after reopening') $$,'Admin can reply after reopening feedback');
select throws_ok($$ select public.create_policy_feedback('7a000000-0000-4000-8000-000000000102','Admin draft comment','Admins also wait for policy approval') $$,'42501','policy is not available for feedback','Admin cannot create feedback on a draft policy');
update public.policies set status='draft' where id='7a000000-0000-4000-8000-000000000101';
select throws_ok($$ select public.reply_policy_feedback(current_setting('app.feedback_thread')::uuid,'Draft policy reply') $$,'42501','feedback thread is not available','Admin cannot reply when the policy has returned to draft');
update public.policies set status='archived' where id='7a000000-0000-4000-8000-000000000101';
select throws_ok($$ select public.reply_policy_feedback(current_setting('app.feedback_thread')::uuid,'Archived policy reply') $$,'42501','feedback thread is not available','Admin cannot reply when the policy is archived');
update public.policies set status='approved' where id='7a000000-0000-4000-8000-000000000101';

select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000004","email":"feedback-outsider@example.test","role":"authenticated"}',true);
select throws_ok($$ select public.create_policy_feedback('7a000000-0000-4000-8000-000000000101','Cross tenant','Outsiders cannot create feedback') $$,'42501','policy is not available for feedback','cross-tenant feedback creation is denied');
select throws_ok($$ select public.reply_policy_feedback(current_setting('app.feedback_thread')::uuid,'Cross tenant') $$,'42501','feedback thread is not available','cross-tenant feedback access is denied');
select is((select count(*) from public.policy_feedback_threads),0::bigint,'outsider cannot read feedback threads');
select is((select count(*) from public.policy_feedback_comments),0::bigint,'outsider cannot read feedback comments');

select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000001","email":"feedback-owner@example.test","role":"authenticated"}',true);
select throws_ok($$ select public.publish_leadership_report(current_setting('app.feedback_org')::uuid,'{"soaPercent":"75","soaTotal":"20","riskBands":{"low":"2","moderate":"1","high":"0","very_high":"0"},"tasksOpen":"3","tasksOverdue":"1","evidence":{"total":"5","expiring":"1","expired":"0"},"openAudits":"1","openNonConformities":"0"}'::jsonb) $$,'22023','invalid readiness report payload','numeric strings cannot masquerade as a leadership report');
select throws_ok($$ select public.publish_leadership_report(current_setting('app.feedback_org')::uuid,'{"soaPercent":75,"soaTotal":20,"riskBands":{"low":2,"moderate":1,"high":0,"very_high":0},"tasksOpen":"3","tasksOverdue":1,"evidence":{"total":5,"expiring":1,"expired":0},"openAudits":1,"openNonConformities":0}'::jsonb) $$,'22023','invalid readiness report payload','a partially string-valued leadership report is rejected');
select throws_ok($$ select public.publish_leadership_report(current_setting('app.feedback_org')::uuid,'{"soaPercent":75,"soaTotal":20,"riskBands":{"low":2,"moderate":1,"high":0,"very_high":0},"tasksOpen":null,"tasksOverdue":1,"evidence":{"total":5,"expiring":1,"expired":0},"openAudits":1,"openNonConformities":0}'::jsonb) $$,'22023','invalid readiness report payload','a JSON null report leaf is rejected rather than accepted through SQL NULL semantics');
select lives_ok($$ select public.publish_leadership_report(current_setting('app.feedback_org')::uuid,'{"soaPercent":75,"soaTotal":20,"riskBands":{"low":2,"moderate":1,"high":0,"very_high":0},"tasksOpen":3,"tasksOverdue":1,"evidence":{"total":5,"expiring":1,"expired":0},"openAudits":1,"openNonConformities":0}'::jsonb) $$,'Owner can publish a validated leadership snapshot');
select throws_ok($$ select public.publish_leadership_report(current_setting('app.feedback_org')::uuid,'{"soaPercent":75}'::jsonb) $$,'22023','invalid readiness report payload','operator cannot publish a malformed payload');
select results_eq(
  $$ select organisation_name,published_by,(payload->>'soaPercent')::int from public.leadership_report_snapshots $$,
  $$ values('Feedback org'::text,'7a000000-0000-4000-8000-000000000001'::uuid,75) $$,
  'snapshot derives organisation name and publisher while preserving the exact report payload'
);
select throws_ok($$ delete from public.policy_feedback_comments $$,'42501',null,'comment deletion is unavailable to portal roles');

select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000002","email":"feedback-admin@example.test","role":"authenticated"}',true);
select lives_ok($$ select public.publish_leadership_report(current_setting('app.feedback_org')::uuid,'{"soaPercent":80,"soaTotal":20,"riskBands":{"low":3,"moderate":1,"high":0,"very_high":0},"tasksOpen":2,"tasksOverdue":0,"evidence":{"total":5,"expiring":0,"expired":0},"openAudits":0,"openNonConformities":0}'::jsonb) $$,'Admin can also publish a validated leadership snapshot');

set local role postgres;
select throws_ok($$ update public.leadership_report_snapshots set organisation_name='Tampered' $$,'P0001','leadership report snapshots are immutable','snapshot update trigger rejects privileged mutation');
select throws_ok($$ delete from public.leadership_report_snapshots $$,'P0001','leadership report snapshots are immutable','snapshot delete trigger rejects privileged mutation');
select throws_ok($$ update public.policy_feedback_comments set body='Tampered' $$,'P0001','policy feedback comments are immutable','comment update trigger rejects privileged mutation');
select throws_ok($$ delete from public.policy_feedback_comments $$,'P0001','policy feedback comments are immutable','comment delete trigger rejects privileged mutation');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000003","email":"feedback-member@example.test","role":"authenticated"}',true);
select is((select count(*) from public.leadership_report_snapshots),2::bigint,'Member can read snapshots from their organisation');
select throws_ok($$ select public.publish_leadership_report(current_setting('app.feedback_org')::uuid,'{"soaPercent":0}'::jsonb) $$,'42501','only workspace operators can publish leadership reports','Member cannot publish even with a malformed payload');

select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000004","email":"feedback-outsider@example.test","role":"authenticated"}',true);
select is((select count(*) from public.leadership_report_snapshots),0::bigint,'outsider cannot read another tenant snapshot');

select * from finish();
rollback;
