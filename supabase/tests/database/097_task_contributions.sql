begin;
select no_plan();
select has_table('public', 'task_contributions', 'immutable task contributions exist');
select has_column('public', 'tasks', 'assignment_revision', 'assignment revision is database-owned');
select has_function('public', 'submit_task_contribution', array['uuid','uuid','bigint','text','uuid'], 'guarded submission RPC exists');
select has_function('public', 'review_task_contribution', array['uuid','uuid','text','text','uuid'], 'guarded exact-version review RPC exists');

select ok((select relrowsecurity from pg_class where oid='public.task_contributions'::regclass),'contribution RLS enabled');
select ok(not has_function_privilege('anon','public.submit_task_contribution(uuid,uuid,bigint,text,uuid)','execute'),'anonymous submission denied');
select ok(not has_function_privilege('anon','public.review_task_contribution(uuid,uuid,text,text,uuid)','execute'),'anonymous review denied');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where oid in ('public.submit_task_contribution(uuid,uuid,bigint,text,uuid)'::regprocedure,'public.review_task_contribution(uuid,uuid,text,text,uuid)'::regprocedure)),'guarded RPCs use trusted owner and empty search path');
select ok(not has_table_privilege('authenticated','public.task_contributions','TRUNCATE'),'authenticated cannot truncate contribution history');

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select ('97000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated','authenticated','contribution-'||n||'@example.test','',now(),'{}','{}' from generate_series(1,4) n;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.org',public.create_organisation_with_owner('Contributions A','contributions-a')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000002','member'),
(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000003','member');
insert into public.tasks(id,organisation_id,title,owner_id,created_by) values
('97000000-0000-4000-8000-000000000101',current_setting('test.org')::uuid,'Restore backup','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000001'),
('97000000-0000-4000-8000-000000000102',current_setting('test.org')::uuid,'Operator work','97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001');

insert into public.audits(id,organisation_id,reference,title,created_by) values
('97000000-0000-4000-8000-000000000401',current_setting('test.org')::uuid,'CONTRIB-1','Restore audit','97000000-0000-4000-8000-000000000001');
insert into public.audit_findings(id,organisation_id,audit_id,summary,task_id,created_by) values
('97000000-0000-4000-8000-000000000402',current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000401','Restore verification needed','97000000-0000-4000-8000-000000000101','97000000-0000-4000-8000-000000000001');
reset role;
insert into public.monitoring_findings(id,organisation_id,check_id,subject_type,subject_id,title,task_id) values
('97000000-0000-4000-8000-000000000403',current_setting('test.org')::uuid,'restore','system','fixture','Verify the restore','97000000-0000-4000-8000-000000000101');
select set_config('test.task_before',(select to_jsonb(t)::text from public.tasks t where id='97000000-0000-4000-8000-000000000101'),true);
select set_config('test.audit_before',(select to_jsonb(t)::text from public.audit_findings t where id='97000000-0000-4000-8000-000000000402'),true);
select set_config('test.monitor_before',(select to_jsonb(t)::text from public.monitoring_findings t where id='97000000-0000-4000-8000-000000000403'),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$ select public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',0,'Restored fixture','97000000-0000-4000-8000-000000000201') $$,'42501','only the current task assignee may submit','unrelated member denied');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$ select public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',0,'Restored fixture','97000000-0000-4000-8000-000000000201') $$,'42501','current workspace membership required','other tenant denied');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$ select public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',1,'Restored fixture','97000000-0000-4000-8000-000000000201') $$,'PT409','task assignment changed; reload the task','stale assignment denied');
select set_config('test.contribution',public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',0,'Restored fixture','97000000-0000-4000-8000-000000000201')::text,true);
select throws_ok($$select public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',0,E'\t\n','97000000-0000-4000-8000-000000000201')$$,'22023','invalid contribution note or request id','whitespace-only note rejected at RPC boundary');
select is(public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',0,'Restored fixture','97000000-0000-4000-8000-000000000201')::text,current_setting('test.contribution'),'identical submission retry returns original');
select throws_ok($$ select public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',0,'Changed payload','97000000-0000-4000-8000-000000000201') $$,'22023','request id already used with different submission','mismatched retry denied');
select throws_ok($$ select public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',0,'Restored fixture','97000000-0000-4000-8000-000000000202') $$,'PT409','a contribution is already awaiting review for this assignment','duplicate pending denied');
select throws_ok($$ select public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.contribution')::uuid,'accepted','Checked the note','97000000-0000-4000-8000-000000000301') $$,'42501','only an independent workspace operator may review','member review denied');
select throws_ok($$ insert into public.task_contributions(organisation_id) values(current_setting('test.org')::uuid) $$,'42501',null,'direct insert denied');
select throws_ok($$ update public.task_contributions set note='forged' $$,'42501',null,'direct update denied');
select throws_ok($$ delete from public.task_contributions $$,'42501',null,'direct delete denied');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.contribution')::uuid,'changes_requested','Add restore timing','97000000-0000-4000-8000-000000000301')$$,'coordinator requests changes');
select throws_ok($$select public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.contribution')::uuid,'changes_requested',E'\t\n','97000000-0000-4000-8000-000000000301')$$,'22023','invalid review decision, rationale or request id','whitespace-only review rationale rejected at RPC boundary');
select is(public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.contribution')::uuid,'changes_requested','Add restore timing','97000000-0000-4000-8000-000000000301')::text,current_setting('test.contribution'),'identical review retry returns original');
select throws_ok($$ select public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.contribution')::uuid,'accepted','Checked the note','97000000-0000-4000-8000-000000000302') $$,'PT409','contribution already reviewed','completed review immutable');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('test.successor',public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',0,'Restore took 5 minutes','97000000-0000-4000-8000-000000000202')::text,true);
select isnt(current_setting('test.successor'),current_setting('test.contribution'),'resubmission creates successor');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
reset role;
alter table public.evidence_links add constraint test_contribution_atomicity check (task_id <> '97000000-0000-4000-8000-000000000101');
set local role authenticated;
select throws_ok($$select public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.successor')::uuid,'accepted','Checked the note','97000000-0000-4000-8000-000000000302')$$,'23514',null,'failed evidence link rejects whole acceptance');
select is((select decision from public.task_contributions where id=current_setting('test.successor')::uuid),'pending','failed acceptance preserves pending review');
select is((select count(*) from public.evidence where organisation_id=current_setting('test.org')::uuid),0::bigint,'failed acceptance leaves no orphan evidence');
reset role;
alter table public.evidence_links drop constraint test_contribution_atomicity;
set local role authenticated;
select lives_ok($$select public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.successor')::uuid,'accepted','Checked the note','97000000-0000-4000-8000-000000000302')$$,'coordinator accepts exact successor');
select lives_ok($$select public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.successor')::uuid,'accepted','Checked the note','97000000-0000-4000-8000-000000000302')$$,'accepted retry is idempotent');
select is((select count(*) from public.evidence_links where task_id='97000000-0000-4000-8000-000000000101'),1::bigint,'one linked evidence record');
select is((select description from public.evidence where id=(select evidence_id from public.task_contributions where id=current_setting('test.successor')::uuid)),'Restore took 5 minutes','evidence copies exact submitted note');
select is((select status::text from public.tasks where id='97000000-0000-4000-8000-000000000101'),'open','acceptance does not complete task');
reset role;
select is((select to_jsonb(t)::text from public.tasks t where id='97000000-0000-4000-8000-000000000101'),current_setting('test.task_before'),'contribution workflow preserves complete task row');
select is((select to_jsonb(t)::text from public.audit_findings t where id='97000000-0000-4000-8000-000000000402'),current_setting('test.audit_before'),'contribution workflow preserves audit finding');
select is((select to_jsonb(t)::text from public.monitoring_findings t where id='97000000-0000-4000-8000-000000000403'),current_setting('test.monitor_before'),'contribution workflow preserves monitoring finding');
select throws_ok($$update public.task_contributions set note='altered' where id=current_setting('test.successor')::uuid$$,'42501','task contribution payload and completed reviews are immutable','accepted payload immutable even through privileged update');
set local role authenticated;
select throws_ok($$select public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.successor')::uuid,'accepted','Different rationale','97000000-0000-4000-8000-000000000302')$$,'22023','request id already used with different review','mismatched accepted retry denied');
select set_config('test.self',public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000102',0,'Operator note','97000000-0000-4000-8000-000000000203')::text,true);
select throws_ok($$ select public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.self')::uuid,'accepted','Checked the note','97000000-0000-4000-8000-000000000303') $$,'42501','only an independent workspace operator may review','operator cannot review own note');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('test.old',public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',0,'Old assignment','97000000-0000-4000-8000-000000000204')::text,true);
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
update public.tasks set owner_id='97000000-0000-4000-8000-000000000003',assignment_revision=777 where id='97000000-0000-4000-8000-000000000101';
update public.tasks set owner_id='97000000-0000-4000-8000-000000000002' where id='97000000-0000-4000-8000-000000000101';
select is((select assignment_revision from public.tasks where id='97000000-0000-4000-8000-000000000101'),2::bigint,'away and back increments revision and ignores forged value');
select throws_ok($$ select public.review_task_contribution(current_setting('test.org')::uuid,current_setting('test.old')::uuid,'accepted','Checked the note','97000000-0000-4000-8000-000000000304') $$,'PT409','task assignment changed; reload the task','old pending cannot be accepted');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$ select public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',0,'Old assignment','97000000-0000-4000-8000-000000000204') $$,'PT409','task assignment changed; reload the task','old retry cannot bypass assignment check');
select lives_ok($$select public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',2,'New assignment','97000000-0000-4000-8000-000000000205')$$,'new assignment can submit alongside obsolete history');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
update public.tasks set status='done' where id='97000000-0000-4000-8000-000000000101';
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$ select public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',2,'Restored fixture','97000000-0000-4000-8000-000000000206') $$,'PT409','task is closed','closed task denied');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
delete from public.memberships where organisation_id=current_setting('test.org')::uuid and user_id='97000000-0000-4000-8000-000000000002';
select is((select assignment_revision from public.tasks where id='97000000-0000-4000-8000-000000000101'),3::bigint,'membership removal invalidates assignment without losing evidence');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$ select public.submit_task_contribution(current_setting('test.org')::uuid,'97000000-0000-4000-8000-000000000101',3,'Restored fixture','97000000-0000-4000-8000-000000000207') $$,'42501','current workspace membership required','removed member denied');
select is((select count(*) from public.task_contributions),0::bigint,'removed member cannot read history');
select * from finish();
rollback;
