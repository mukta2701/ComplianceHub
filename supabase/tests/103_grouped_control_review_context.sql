begin;
select no_plan();
select has_function('public','load_control_review_history',array['uuid','uuid'],'grouped history read exists');
select has_function('public','load_control_review_tasks',array['uuid','uuid'],'grouped task read exists');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('a1030000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','group-owner@example.test','',now(),'{}','{}'),
 ('a1030000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','group-member@example.test','',now(),'{}','{}'),
 ('a1030000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','group-admin@example.test','',now(),'{}','{}'),
 ('a1030000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','group-outsider@example.test','',now(),'{}','{}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1030000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.group_org',public.create_organisation_with_owner('Grouped read tests','group-read-tests')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.group_org')::uuid,'a1030000-0000-4000-8000-000000000002','member'),
 (current_setting('app.group_org')::uuid,'a1030000-0000-4000-8000-000000000003','admin');
insert into public.assessment_sessions(id,organisation_id,catalogue_version_id,title,created_by) values
 ('a1030000-0000-4000-8000-000000000011',current_setting('app.group_org')::uuid,'00000000-0000-4000-8000-000000000001','Grouped context assessment','a1030000-0000-4000-8000-000000000001');
-- Privileged, rollback-only fixture preparation suppresses audit triggers so zero-history groups are observable.
reset role;
set local session_replication_role = replica;
select set_config('app.group_register',public.create_or_reuse_soa_review('a1030000-0000-4000-8000-000000000011')::text,true);
set local session_replication_role = origin;
select set_config('app.group_one',(select id::text from public.soa_items where soa_register_id=current_setting('app.group_register')::uuid order by position limit 1),true);
select set_config('app.group_two',(select id::text from public.soa_items where soa_register_id=current_setting('app.group_register')::uuid order by position offset 1 limit 1),true);
select set_config('app.group_three',(select id::text from public.soa_items where soa_register_id=current_setting('app.group_register')::uuid order by position offset 2 limit 1),true);
select set_config('app.group_control',(select id::text from public.controls order by position limit 1),true);
insert into public.requirement_control_mappings(requirement_id,control_id)
select i.control_id,current_setting('app.group_control')::uuid from public.soa_items i where i.id in (current_setting('app.group_one')::uuid,current_setting('app.group_two')::uuid)
on conflict do nothing;
insert into public.audit_events(organisation_id,actor_id,action,entity_type,entity_id,occurred_at)
select current_setting('app.group_org')::uuid,'a1030000-0000-4000-8000-000000000001','event-'||n,'soa_items',current_setting('app.group_one'),'2026-09-01T12:00:00Z'::timestamptz from generate_series(1,7) n;
insert into public.audit_events(organisation_id,actor_id,action,entity_type,entity_id,occurred_at) values
 (current_setting('app.group_org')::uuid,'a1030000-0000-4000-8000-000000000001','quiet','soa_items',current_setting('app.group_two'),'2026-01-01T12:00:00Z'),
 (current_setting('app.group_org')::uuid,'a1030000-0000-4000-8000-000000000001','wrong-entity','tasks',current_setting('app.group_one'),now());
insert into public.tasks(id,organisation_id,title,status,control_id,created_by)
select ('a1031000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,current_setting('app.group_org')::uuid,'Task '||n,
 (case when n<=10 then 'open' when n<=20 then 'in_progress' else 'done' end)::public.task_status,
 current_setting('app.group_control')::uuid,'a1030000-0000-4000-8000-000000000001' from generate_series(1,25) n;
set local role authenticated;
select is((select count(*) from public.load_control_review_history(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid)),93::bigint,'history covers every visible decision');
select is((select total from public.load_control_review_history(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),7::bigint,'history total includes entries beyond the cap and excludes other entity types');
select is((select jsonb_array_length(entries) from public.load_control_review_history(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),5,'history cap is five per decision');
select is((select entries->0->>'action' from public.load_control_review_history(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),'event-7','equal-time history is ordered by descending identity');
select is((select entries->0->>'action' from public.load_control_review_history(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_two')::uuid),'quiet','busy decisions do not consume quiet history');
select is((select total from public.load_control_review_history(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_three')::uuid),0::bigint,'a decision with no events has an explicit zero total');
select is((select entries from public.load_control_review_history(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_three')::uuid),'[]'::jsonb,'zero history has an empty list');
select is((select count(*) from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid)),93::bigint,'tasks cover every visible decision');
select is((select total from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),25::bigint,'task total is exact before the cap');
select is((select open_count from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),20::bigint,'open count includes open and in-progress tasks');
select is((select jsonb_array_length(entries) from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),20,'task display cap is twenty');
select is((select entries->0->>'id' from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),'a1031000-0000-4000-8000-000000000001','tasks use ascending identity order');
select is((select total from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_two')::uuid),25::bigint,'a shared task appears once for each legitimately mapped decision');
select ok((select bool_and(total=0 and open_count=0 and entries='[]'::jsonb) from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id in (select i.id from public.soa_items i where i.soa_register_id=current_setting('app.group_register')::uuid and not exists(select 1 from public.requirement_control_mappings m where m.requirement_id=i.control_id and m.control_id=current_setting('app.group_control')::uuid))),'unmapped decisions have known zero task groups');
select set_config('request.jwt.claims','{"sub":"a1030000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.load_control_review_history(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid)),93::bigint,'Members retain history read access');
select is((select max(total) from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid)),25::bigint,'Members retain task context read access');
select set_config('request.jwt.claims','{"sub":"a1030000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*) from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid)),93::bigint,'Admins can read groups');
select throws_ok(format('select * from public.load_control_review_history(%L,%L)',current_setting('app.group_org'),'a1030000-0000-4000-8000-000000000099'),'42501','control_review_unavailable','missing register is rejected safely');
select set_config('request.jwt.claims','{"sub":"a1030000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select set_config('app.group_other_org',public.create_organisation_with_owner('Other grouped tests','other-group-read-tests')::text,true);
select throws_ok(format('select * from public.load_control_review_history(%L,%L)',current_setting('app.group_org'),current_setting('app.group_register')),'42501','control_review_unavailable','other organisation owner cannot read history');
select throws_ok(format('select * from public.load_control_review_tasks(%L,%L)',current_setting('app.group_other_org'),current_setting('app.group_register')),'42501','control_review_unavailable','register cannot be mixed with another authorised organisation');
-- The same user can see both organisations: explicit dataset scope still excludes sibling records.
insert into public.memberships(organisation_id,user_id,role) values (current_setting('app.group_other_org')::uuid,'a1030000-0000-4000-8000-000000000001','member');
insert into public.tasks(organisation_id,title,status,control_id,created_by) values
 (current_setting('app.group_other_org')::uuid,'Sibling task','open',current_setting('app.group_control')::uuid,'a1030000-0000-4000-8000-000000000004');
reset role;
insert into public.audit_events(organisation_id,actor_id,action,entity_type,entity_id) values
 (current_setting('app.group_other_org')::uuid,'a1030000-0000-4000-8000-000000000004','sibling-event','soa_items',current_setting('app.group_one'));
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1030000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select total from public.load_control_review_history(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),7::bigint,'history excludes a visible sibling organisation event with the same entity identity');
select is((select total from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),25::bigint,'tasks exclude visible sibling organisation records on the same shared control');
reset role;
-- Rollback-only restrictive policies prove the invoker observes the caller's row policies.
create policy group_read_test_tasks on public.tasks as restrictive for select to authenticated using (title <> 'Task 25');
create policy group_read_test_history on public.audit_events as restrictive for select to authenticated using (action <> 'event-7');
set local role authenticated;
select is((select total from public.load_control_review_tasks(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),24::bigint,'grouped tasks honour a restrictive caller row policy');
select is((select total from public.load_control_review_history(current_setting('app.group_org')::uuid,current_setting('app.group_register')::uuid) where item_id=current_setting('app.group_one')::uuid),6::bigint,'grouped history honours a restrictive caller row policy');
select set_config('request.jwt.claims','{}',true);
select throws_ok(format('select * from public.load_control_review_tasks(%L,%L)',current_setting('app.group_org'),current_setting('app.group_register')),'42501','control_review_unavailable','missing authenticated identity cannot read groups');
reset role;
select ok((select bool_and(not prosecdef and provolatile='s' and proconfig @> array['search_path=""']) from pg_proc where oid in ('public.load_control_review_history(uuid,uuid)'::regprocedure,'public.load_control_review_tasks(uuid,uuid)'::regprocedure)),'both reads are stable invokers with empty search paths');
select ok(not has_function_privilege('anon','public.load_control_review_history(uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.load_control_review_tasks(uuid,uuid)','EXECUTE'),'anonymous execution is not granted');
select ok(has_function_privilege('authenticated','public.load_control_review_history(uuid,uuid)','EXECUTE') and has_function_privilege('authenticated','public.load_control_review_tasks(uuid,uuid)','EXECUTE'),'authenticated read execution is granted');
select * from finish();
rollback;
