begin;
select no_plan();
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001', 'atomic-owner@example.test', '{}', '{}'),
 ('81000000-0000-4000-8000-000000000002', 'atomic-member@example.test', '{}', '{}');
insert into public.organisations (id,name,slug,created_by) values
 ('82000000-0000-4000-8000-000000000001','Atomic workflow','atomic-followup-test','81000000-0000-4000-8000-000000000001');
insert into public.memberships (organisation_id,user_id,role) values
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','owner'),
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','member');
insert into public.risks (id,organisation_id,reference,title,description,category_id,likelihood,impact,treatment,residual_likelihood,residual_impact,status,created_by)
 select '83000000-0000-4000-8000-000000000001',organisation_id,'R-ATOMIC','Atomic risk','Test',id,3,3,'mitigate',2,2,'open','81000000-0000-4000-8000-000000000001'
 from public.risk_categories where organisation_id='82000000-0000-4000-8000-000000000001' limit 1;
insert into public.audits (id,organisation_id,reference,title,created_by) values
 ('84000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','AUD-ATOMIC','Atomic audit','81000000-0000-4000-8000-000000000001'),
 ('84000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','AUD-OTHER','Other audit','81000000-0000-4000-8000-000000000001');
insert into public.audit_checklist_items (id,organisation_id,audit_id,checklist_item,position) values
 ('85000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002','Other audit checklist',0);

-- Inject a task-store failure after the parent record has been inserted.
create function pg_temp.reject_test_followup() returns trigger language plpgsql as $$ begin
 if new.title in ('Treatment plan RTP-ROLLBACK','Corrective action: ROLLBACK') then raise exception 'test followup failure'; end if;
 return new;
end $$;
create trigger reject_test_followup before insert on public.tasks for each row execute function pg_temp.reject_test_followup();
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.create_treatment_with_task('82000000-0000-4000-8000-000000000001',
 '{"risk_id":"83000000-0000-4000-8000-000000000001","reference":"RTP-OK","summary":"Reduce exposure","spawn_task":true}')$$,'treatment and task succeed together');
select is((select count(*) from public.tasks where title='Treatment plan RTP-OK'),1::bigint,'exactly one linked task');
select throws_ok($$select public.create_treatment_with_task('82000000-0000-4000-8000-000000000001',
 '{"risk_id":"83000000-0000-4000-8000-000000000001","reference":"RTP-ROLLBACK","spawn_task":true}')$$,'P0001','test followup failure','task failure aborts treatment');
select is((select count(*) from public.risk_treatment_plans where reference='RTP-ROLLBACK'),0::bigint,'failed task leaves no treatment plan');
select lives_ok($$select public.raise_finding_with_task('82000000-0000-4000-8000-000000000001',
 '{"audit_id":"84000000-0000-4000-8000-000000000001","summary":"Finding OK","corrective_action":"Fix access","spawn_task":true}')$$,'finding and task succeed together');
select is((select count(*) from public.audit_findings f join public.tasks t on t.id=f.task_id where f.summary='Finding OK' and f.status='in_progress'),1::bigint,'finding links its corrective task');
select throws_ok($$select public.raise_finding_with_task('82000000-0000-4000-8000-000000000001',
 '{"audit_id":"84000000-0000-4000-8000-000000000001","summary":"ROLLBACK","corrective_action":"Fix access","spawn_task":true}')$$,'P0001','test followup failure','task failure aborts finding');
select is((select count(*) from public.audit_findings where summary='ROLLBACK'),0::bigint,'failed task leaves no finding');
select throws_ok($$select public.raise_finding_with_task('82000000-0000-4000-8000-000000000001',
 '{"audit_id":"84000000-0000-4000-8000-000000000001","checklist_item_id":"85000000-0000-4000-8000-000000000001","summary":"Wrong checklist"}')$$,'42501',null,'checklist must belong to selected audit');
select throws_ok($$select public.create_treatment_with_task('82000000-0000-4000-8000-000000000002',
 '{"risk_id":"83000000-0000-4000-8000-000000000001","reference":"WRONG-ORG"}')$$,'42501',null,'other workspace denied');
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.create_treatment_with_task('82000000-0000-4000-8000-000000000001',
 '{"risk_id":"83000000-0000-4000-8000-000000000001","reference":"MEMBER"}')$$,'42501',null,'Member cannot create treatment');
select throws_ok($$select public.raise_finding_with_task('82000000-0000-4000-8000-000000000001',
 '{"audit_id":"84000000-0000-4000-8000-000000000001","summary":"MEMBER"}')$$,'42501',null,'Member cannot create finding');
select ok(not has_function_privilege('anon','public.create_treatment_with_task(uuid,jsonb)','EXECUTE'),'anonymous treatment RPC denied');
select ok(not has_function_privilege('anon','public.raise_finding_with_task(uuid,jsonb)','EXECUTE'),'anonymous finding RPC denied');
select * from finish();
rollback;
