begin;
select no_plan();

-- All fictional records and assertions are rolled back, including failed runs.
select has_function('public', 'create_or_reuse_soa_review', array['uuid']);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('a1010000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-operator@example.test','',now(),'{}','{}'),
 ('a1010000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','review-member@example.test','',now(),'{}','{}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.review_org',public.create_organisation_with_owner('Atomic review test','atomic-review-test')::text,true);
insert into public.assessment_sessions(id,organisation_id,catalogue_version_id,title,created_by) values
 ('a1010000-0000-4000-8000-000000000011',current_setting('app.review_org')::uuid,'00000000-0000-4000-8000-000000000001','First assessment','a1010000-0000-4000-8000-000000000001'),
 ('a1010000-0000-4000-8000-000000000012',current_setting('app.review_org')::uuid,'00000000-0000-4000-8000-000000000001','Second assessment','a1010000-0000-4000-8000-000000000001');
select set_config('app.review_first',public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000011')::text,true);
select is(public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000011'),current_setting('app.review_first')::uuid,'repeated requests reuse the active review');
select is((select count(*)::integer from public.soa_items where soa_register_id=current_setting('app.review_first')::uuid),93,'new review contains exactly the 93 catalogue controls');
select is((select count(*)::integer from public.soa_registers where organisation_id=current_setting('app.review_org')::uuid),1,'retry does not leave another register');

select set_config('app.review_second',public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000012')::text,true);
select is((select version from public.soa_registers where id=current_setting('app.review_second')::uuid),2,'another assessment takes the next organisation-wide version');
select ok(exists(select 1 from pg_catalog.pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted
  and classid=((pg_catalog.hashtextextended(current_setting('app.review_org'),0) >> 32) & 4294967295)::oid
  and objid=(pg_catalog.hashtextextended(current_setting('app.review_org'),0) & 4294967295)::oid),
  'creation holds the existing organisation-wide advisory lock until transaction end');
select throws_ok($$ select public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000099') $$,'42501','Assessment unavailable','missing assessment does not disclose existence');
insert into public.memberships(organisation_id,user_id,role) values(current_setting('app.review_org')::uuid,'a1010000-0000-4000-8000-000000000002','member');
select set_config('request.jwt.claims','{"sub":"a1010000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$ select public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000011') $$,'42501','Assessment unavailable','ordinary members cannot start or reuse a review via the mutation');
select set_config('app.other_org',public.create_organisation_with_owner('Other atomic review test','other-atomic-review-test')::text,true);
insert into public.assessment_sessions(id,organisation_id,catalogue_version_id,title,created_by) values
 ('a1010000-0000-4000-8000-000000000013',current_setting('app.other_org')::uuid,'00000000-0000-4000-8000-000000000001','Other workspace assessment','a1010000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"sub":"a1010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$ select public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000013') $$,'42501','Assessment unavailable','cross-workspace assessment uses the same non-disclosing error');
select has_function('public','create_or_reuse_soa_successor',array['uuid']);
select throws_ok(format('select public.create_or_reuse_soa_successor(%L)',current_setting('app.review_first')),'42501','Finalised statement unavailable','an active register is not a finalised successor source');
update public.soa_items set applicable=false,status='not_applicable',justification='Reviewed exclusion',evidence='Preserved evidence text',owner_id='a1010000-0000-4000-8000-000000000001'
 where soa_register_id=current_setting('app.review_first')::uuid;
select set_config('app.review_snapshot',public.finalise_soa(current_setting('app.review_first')::uuid)::text,true);
select set_config('app.source_items',(select md5(jsonb_agg(to_jsonb(i) order by i.position)::text) from public.soa_items i where soa_register_id=current_setting('app.review_first')::uuid),true);
select set_config('app.source_snapshot',(select md5(to_jsonb(s)::text) from public.soa_snapshots s where id=current_setting('app.review_snapshot')::uuid),true);
select set_config('app.review_successor',public.create_or_reuse_soa_successor(current_setting('app.review_first')::uuid)::text,true);
select isnt(current_setting('app.review_successor'),current_setting('app.review_first'),'a finalised source gets a distinct active workspace');
select is(public.create_or_reuse_soa_successor(current_setting('app.review_first')::uuid),current_setting('app.review_successor')::uuid,'repeated successor requests reuse the active workspace');
select is(public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000011'),current_setting('app.review_successor')::uuid,'ordinary creation reuses a successor for the same assessment');
select is((select version from public.soa_registers where id=current_setting('app.review_successor')::uuid),3,'successor shares organisation-wide version allocation');
select is((select count(*)::integer from public.soa_items where soa_register_id=current_setting('app.review_successor')::uuid and owner_id='a1010000-0000-4000-8000-000000000001' and not applicable and status='not_applicable' and justification='Reviewed exclusion' and evidence='Preserved evidence text'),93,'successor copies all 93 decisions, evidence text and current member owners');
select is((select assessment_session_id from public.soa_registers where id=current_setting('app.review_successor')::uuid),'a1010000-0000-4000-8000-000000000011'::uuid,'successor preserves the source assessment');
select is((select control_catalogue_version_id from public.soa_registers where id=current_setting('app.review_successor')::uuid),'40000000-0000-4000-8000-000000000001'::uuid,'successor preserves the source catalogue');
select is((select md5(jsonb_agg(to_jsonb(i) order by i.position)::text) from public.soa_items i where soa_register_id=current_setting('app.review_first')::uuid),current_setting('app.source_items'),'finalised source decisions remain unchanged');
select is((select md5(to_jsonb(s)::text) from public.soa_snapshots s where id=current_setting('app.review_snapshot')::uuid),current_setting('app.source_snapshot'),'finalised snapshot remains unchanged');

-- A finalised owner cannot normally be removed because the FK update hits the
-- immutability trigger. Simulate only a historical stale owner on our fictional
-- source; bypass is transaction-local, restored before invoking the public RPC.
update public.soa_items set applicable=false,status='not_applicable',justification='Second reviewed exclusion'
  where soa_register_id=current_setting('app.review_second')::uuid;
select public.finalise_soa(current_setting('app.review_second')::uuid);
reset role;
set local session_replication_role = replica;
update public.soa_items set owner_id='a1010000-0000-4000-8000-000000000099'
  where soa_register_id=current_setting('app.review_second')::uuid and position=0;
set local session_replication_role = origin;
set local role authenticated;
select set_config('app.stale_owner_successor',public.create_or_reuse_soa_successor(current_setting('app.review_second')::uuid)::text,true);
select is((select owner_id from public.soa_items where soa_register_id=current_setting('app.stale_owner_successor')::uuid and position=0),null::uuid,'a stale owner is left unassigned');
select is((select owner_id from public.soa_items where soa_register_id=current_setting('app.review_second')::uuid and position=0),'a1010000-0000-4000-8000-000000000099'::uuid,'copying does not rewrite the historical owner');

-- Privileged legacy setup represents duplicates created before this migration.
reset role;
select set_config('app.duplicate_one',public.create_soa_draft('a1010000-0000-4000-8000-000000000011','Historical duplicate one')::text,true);
select set_config('app.duplicate_two',public.create_soa_draft('a1010000-0000-4000-8000-000000000011','Historical duplicate two')::text,true);
set local role authenticated;
select is(public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000011'),current_setting('app.duplicate_two')::uuid,'equal update dates recommend the greatest version');
reset role;
set local session_replication_role = replica;
update public.soa_registers set updated_at='2099-01-01T00:00:00Z' where id=current_setting('app.duplicate_one')::uuid;
set local session_replication_role = origin;
set local role authenticated;
select is(public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000011'),current_setting('app.duplicate_one')::uuid,'the most recently updated active review wins even with a lower version');
select is(public.create_or_reuse_soa_successor(current_setting('app.review_first')::uuid),current_setting('app.duplicate_one')::uuid,'successors use the same deterministic recommendation');
select is((select count(*)::integer from public.soa_registers r where r.assessment_session_id='a1010000-0000-4000-8000-000000000011' and not exists(select 1 from public.soa_snapshots s where s.soa_register_id=r.id)),3,'historical active duplicates remain intact');
select throws_ok($$ select public.create_or_reuse_soa_successor('a1010000-0000-4000-8000-000000000099') $$,'42501','Finalised statement unavailable','missing source uses a non-disclosing error');
select set_config('request.jwt.claims','{"sub":"a1010000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok(format('select public.create_or_reuse_soa_successor(%L)',current_setting('app.review_first')),'42501','Finalised statement unavailable','ordinary members cannot create successors');
reset role;
delete from public.memberships where organisation_id=current_setting('app.review_org')::uuid and user_id='a1010000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok(format('select public.create_or_reuse_soa_successor(%L)',current_setting('app.review_first')),'42501','Finalised statement unavailable','cross-workspace source uses the same non-disclosing error');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$ select public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000011') $$,'42501','Assessment unavailable','review creation requires authenticated identity');
select throws_ok(format('select public.create_or_reuse_soa_successor(%L)',current_setting('app.review_first')),'42501','Finalised statement unavailable','successor creation requires authenticated identity');
reset role;
select ok(not has_function_privilege('authenticated','public.create_soa_draft(uuid,text)','execute'),'authenticated callers cannot bypass atomic review creation');
select ok(not has_function_privilege('authenticated','public.create_soa_successor(uuid,text)','execute'),'authenticated callers cannot bypass atomic successors');
select ok(not has_function_privilege('anon','public.create_or_reuse_soa_review(uuid)','execute'),'anonymous callers cannot execute review creation');
select ok(not has_function_privilege('anon','public.create_or_reuse_soa_successor(uuid)','execute'),'anonymous callers cannot execute successors');
select ok(not has_function_privilege('service_role','public.create_or_reuse_soa_review(uuid)','execute'),'new review RPC grants execute only to authenticated');
select ok(not has_function_privilege('service_role','public.create_or_reuse_soa_successor(uuid)','execute'),'new successor RPC grants execute only to authenticated');
select is((select count(*)::integer from pg_proc where oid in ('public.create_or_reuse_soa_review(uuid)'::regprocedure,'public.create_or_reuse_soa_successor(uuid)'::regprocedure) and proconfig @> array['search_path=""']),2,'both RPCs fix the empty search path');

-- Review creation must be the sole authenticated insert path, even for an owner.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok(format($$ insert into public.soa_registers(organisation_id,assessment_session_id,control_catalogue_version_id,version,title,created_by)
  values(%L,'a1010000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000001',999,'Direct insert bypass','a1010000-0000-4000-8000-000000000001') $$,current_setting('app.review_org')),
  '42501','permission denied for table soa_registers','same-workspace operators cannot bypass review creation with a direct insert');
insert into public.assessment_sessions(id,organisation_id,catalogue_version_id,title,created_by) values
  ('a1010000-0000-4000-8000-000000000014',current_setting('app.review_org')::uuid,'00000000-0000-4000-8000-000000000001','RPC-only assessment','a1010000-0000-4000-8000-000000000001');
select lives_ok($$ select public.create_or_reuse_soa_review('a1010000-0000-4000-8000-000000000014') $$,'authorised RPC creation still succeeds without direct register insert privilege');
select is((select count(*)::integer from public.soa_items i join public.soa_registers r on r.id=i.soa_register_id
  where r.assessment_session_id='a1010000-0000-4000-8000-000000000014'),93,'the authorised RPC still creates its complete decision set');
reset role;
-- The lock may wait. Inspect only the source/authentication checks between lock
-- acquisition and active-review lookup, not an earlier preflight check.
select ok((select split_part(split_part(prosrc,'perform pg_catalog.pg_advisory_xact_lock',2),'select r.id into result_id',1)
  ~ 'from public.assessment_sessions[\s\S]*public.is_organisation_operator'
  from pg_proc where oid='public.create_or_reuse_soa_review(uuid)'::regprocedure),
  'review creation re-reads assessment provenance and checks operator authority after the lock before reuse');
select ok((select split_part(split_part(prosrc,'perform pg_catalog.pg_advisory_xact_lock',2),'select r.id into result_id',1)
  ~ 'from public.soa_registers[\s\S]*join public.soa_snapshots[\s\S]*public.is_organisation_operator'
  from pg_proc where oid='public.create_or_reuse_soa_successor(uuid)'::regprocedure),
  'successor re-reads the finalised source and checks operator authority after the lock before reuse');

select * from finish();
rollback;
