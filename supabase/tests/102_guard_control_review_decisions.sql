begin;
select no_plan();

select has_column('public', 'soa_items', 'decision_revision', 'control decisions expose an edit revision');
select has_function('public', 'update_soa_decisions_guarded', array['uuid', 'jsonb'], 'guarded control decision command exists');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('a1020000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','decision-owner@example.test','',now(),'{}','{}'),
 ('a1020000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','decision-member@example.test','',now(),'{}','{}'),
 ('a1020000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','decision-other-owner@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1020000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.decision_org',public.create_organisation_with_owner('Guarded decisions','guarded-decisions')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.decision_org')::uuid,'a1020000-0000-4000-8000-000000000002','member');
insert into public.assessment_sessions(id,organisation_id,catalogue_version_id,title,created_by) values
 ('a1020000-0000-4000-8000-000000000011',current_setting('app.decision_org')::uuid,'00000000-0000-4000-8000-000000000001','Guarded assessment','a1020000-0000-4000-8000-000000000001');
select set_config('app.decision_register',public.create_or_reuse_soa_review('a1020000-0000-4000-8000-000000000011')::text,true);
select set_config('app.decision_item_one',(select id::text from public.soa_items where soa_register_id=current_setting('app.decision_register')::uuid order by position limit 1),true);
select set_config('app.decision_item_two',(select id::text from public.soa_items where soa_register_id=current_setting('app.decision_register')::uuid order by position offset 1 limit 1),true);

select is((select decision_revision from public.soa_items where id=current_setting('app.decision_item_one')::uuid),0::bigint,'new decisions start at revision zero');
select set_config('app.register_updated_before',(select updated_at::text from public.soa_registers where id=current_setting('app.decision_register')::uuid),true);
select pg_sleep(0.002);
select set_config('app.decision_result',(
  select jsonb_agg(to_jsonb(result) order by item_id)::text from public.update_soa_decisions_guarded(
    current_setting('app.decision_register')::uuid,
    jsonb_build_array(jsonb_build_object(
      'itemId',current_setting('app.decision_item_one'),'expectedRevision',0,'applicable',true,'status','in_progress',
      'justification','First guarded review','evidence','Evidence reference','ownerId','a1020000-0000-4000-8000-000000000001'
    ))
  ) result
),true);
select is((current_setting('app.decision_result')::jsonb->0->>'decision_revision')::bigint,1::bigint,'a successful decision advances its revision once');
select is((select justification from public.soa_items where id=current_setting('app.decision_item_one')::uuid),'First guarded review','the guarded command saves the decision');
select ok((select updated_at from public.soa_registers where id=current_setting('app.decision_register')::uuid) > current_setting('app.register_updated_before')::timestamptz,'a successful command advances parent activity time');
select is((select count(*)::integer from public.audit_events where entity_type='soa_registers' and entity_id=current_setting('app.decision_register') and action='update'),1,'one successful batch updates the parent register once');

create temporary table decision_error(code text, message text, detail text);
do $$
declare error_code text; error_message text; error_detail text;
begin
  perform public.update_soa_decisions_guarded(
    current_setting('app.decision_register')::uuid,
    jsonb_build_array(
      jsonb_build_object('itemId',current_setting('app.decision_item_one'),'expectedRevision',0,'applicable',true,'status','operational','justification','Stale overwrite','evidence','','ownerId',null),
      jsonb_build_object('itemId',current_setting('app.decision_item_two'),'expectedRevision',0,'applicable',false,'status','not_applicable','justification','Atomic companion','evidence','','ownerId',null)
    )
  );
exception when others then
  get stacked diagnostics error_code = returned_sqlstate, error_message = message_text, error_detail = pg_exception_detail;
  insert into decision_error values(error_code,error_message,error_detail);
end;
$$;
select is((select code from decision_error),'40001','stale decisions use a stable SQLSTATE');
select is((select message from decision_error),'control_decision_stale','stale decisions use a stable message');
select is((select detail from decision_error),'revision_mismatch','stale decisions use stable detail');
select is((select justification from public.soa_items where id=current_setting('app.decision_item_one')::uuid),'First guarded review','a stale overwrite changes nothing');
select is((select decision_revision from public.soa_items where id=current_setting('app.decision_item_two')::uuid),0::bigint,'one stale row rolls back the entire batch');

truncate decision_error;
do $$
declare error_code text; error_message text; error_detail text;
begin
  perform public.update_soa_decisions_guarded(
    current_setting('app.decision_register')::uuid,
    jsonb_build_array(
      jsonb_build_object('itemId',current_setting('app.decision_item_one'),'expectedRevision',1,'applicable',true,'status','operational','justification','Canonical duplicate one','evidence','','ownerId',null),
      jsonb_build_object('itemId',replace(upper(current_setting('app.decision_item_one')),'-',''),'expectedRevision',1,'applicable',true,'status','advanced','justification','Canonical duplicate two','evidence','','ownerId',null)
    )
  );
exception when others then
  get stacked diagnostics error_code = returned_sqlstate, error_message = message_text, error_detail = pg_exception_detail;
  insert into decision_error values(error_code,error_message,error_detail);
end;
$$;
select is((select code||':'||message||':'||detail from decision_error),'22023:control_decision_invalid:duplicate_item','equivalent UUID spellings are rejected as one duplicated decision');
select is((select decision_revision from public.soa_items where id=current_setting('app.decision_item_one')::uuid),1::bigint,'canonical duplicate rejection writes nothing');

select set_config('app.batch_result',(
  select jsonb_agg(to_jsonb(result) order by item_id)::text from public.update_soa_decisions_guarded(
    current_setting('app.decision_register')::uuid,
    jsonb_build_array(
      jsonb_build_object('itemId',current_setting('app.decision_item_one'),'expectedRevision',1,'applicable',true,'status','operational','justification','Batch first','evidence','','ownerId',null),
      jsonb_build_object('itemId',current_setting('app.decision_item_two'),'expectedRevision',0,'applicable',false,'status','not_applicable','justification','Batch second','evidence','','ownerId',null)
    )
  ) result
),true);
select is((select count(*)::integer from jsonb_array_elements(current_setting('app.batch_result')::jsonb)),2,'a valid multi-row batch returns every changed decision');
select is((select decision_revision from public.soa_items where id=current_setting('app.decision_item_one')::uuid),2::bigint,'the first batch decision advances exactly once');
select is((select decision_revision from public.soa_items where id=current_setting('app.decision_item_two')::uuid),1::bigint,'the second batch decision advances exactly once');

truncate decision_error;
do $$
declare error_code text; error_message text; error_detail text;
begin
  perform public.update_soa_decisions_guarded(current_setting('app.decision_register')::uuid,
    jsonb_build_array(jsonb_build_object('itemId','a1020000-0000-4000-8000-000000000099','expectedRevision',0,'applicable',true,'status','pending','justification','Missing row','evidence','','ownerId',null)));
exception when others then
  get stacked diagnostics error_code = returned_sqlstate, error_message = message_text, error_detail = pg_exception_detail;
  insert into decision_error values(error_code,error_message,error_detail);
end;
$$;
select is((select code||':'||message||':'||detail from decision_error),'P0002:control_decision_missing:item_unavailable','missing items have a stable recoverable error');

truncate decision_error;
do $$
declare error_code text; error_message text; error_detail text;
begin
  perform public.update_soa_decisions_guarded(current_setting('app.decision_register')::uuid,
    jsonb_build_array(jsonb_build_object('itemId',current_setting('app.decision_item_two'),'expectedRevision',1,'applicable',true,'status','operational','justification','Invalid owner','evidence','','ownerId','a1020000-0000-4000-8000-000000000003')));
exception when others then
  get stacked diagnostics error_code = returned_sqlstate, error_message = message_text, error_detail = pg_exception_detail;
  insert into decision_error values(error_code,error_message,error_detail);
end;
$$;
select is((select code||':'||message||':'||detail from decision_error),'22023:control_decision_invalid:owner_unavailable','invalid owners have a stable validation error');

select set_config('request.jwt.claims','{"sub":"a1020000-0000-4000-8000-000000000002","role":"authenticated"}',true);
truncate decision_error;
do $$
declare error_code text; error_message text; error_detail text;
begin
  perform public.update_soa_decisions_guarded(current_setting('app.decision_register')::uuid,'[]'::jsonb);
exception when others then
  get stacked diagnostics error_code = returned_sqlstate, error_message = message_text, error_detail = pg_exception_detail;
  insert into decision_error values(error_code,error_message,error_detail);
end;
$$;
select is((select code||':'||message||':'||detail from decision_error),'42501:control_decision_forbidden:register_unavailable','members receive the non-disclosing forbidden result');

select set_config('request.jwt.claims','{"sub":"a1020000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('app.other_org',public.create_organisation_with_owner('Other guarded decisions','other-guarded-decisions')::text,true);
insert into public.assessment_sessions(id,organisation_id,catalogue_version_id,title,created_by) values
 ('a1020000-0000-4000-8000-000000000012',current_setting('app.other_org')::uuid,'00000000-0000-4000-8000-000000000001','Other guarded assessment','a1020000-0000-4000-8000-000000000003');
select set_config('app.other_register',public.create_or_reuse_soa_review('a1020000-0000-4000-8000-000000000012')::text,true);
select set_config('request.jwt.claims','{"sub":"a1020000-0000-4000-8000-000000000001","role":"authenticated"}',true);
truncate decision_error;
do $$
declare error_code text; error_message text; error_detail text;
begin
  perform public.update_soa_decisions_guarded(current_setting('app.other_register')::uuid,'[]'::jsonb);
exception when others then
  get stacked diagnostics error_code = returned_sqlstate, error_message = message_text, error_detail = pg_exception_detail;
  insert into decision_error values(error_code,error_message,error_detail);
end;
$$;
select is((select code||':'||message||':'||detail from decision_error),'42501:control_decision_forbidden:register_unavailable','missing and cross-workspace registers do not disclose existence');

reset role;
update public.soa_items set applicable=false,status='not_applicable',justification='Ready to finalise',owner_id=null
 where soa_register_id=current_setting('app.decision_register')::uuid;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1020000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.finalise_soa(current_setting('app.decision_register')::uuid);
truncate decision_error;
do $$
declare error_code text; error_message text; error_detail text;
begin
  perform public.update_soa_decisions_guarded(current_setting('app.decision_register')::uuid,'[]'::jsonb);
exception when others then
  get stacked diagnostics error_code = returned_sqlstate, error_message = message_text, error_detail = pg_exception_detail;
  insert into decision_error values(error_code,error_message,error_detail);
end;
$$;
select is((select code||':'||message||':'||detail from decision_error),'42501:control_decision_forbidden:register_finalised','finalised registers are immutable through the command');
select set_config('app.successor',public.create_or_reuse_soa_successor(current_setting('app.decision_register')::uuid)::text,true);
select is((select count(*)::integer from public.soa_items where soa_register_id=current_setting('app.successor')::uuid and decision_revision=0),93,'successor decisions restart at revision zero');

reset role;
select ok(not pg_catalog.has_table_privilege('authenticated','public.soa_items','update'),'authenticated callers cannot bypass guarded decision updates');
select ok(pg_catalog.has_function_privilege('authenticated','public.update_soa_decisions_guarded(uuid,jsonb)','execute'),'authenticated operators can invoke the guarded command');
select ok(not pg_catalog.has_function_privilege('anon','public.update_soa_decisions_guarded(uuid,jsonb)','execute'),'anonymous callers cannot invoke the guarded command');
select is((select proconfig from pg_catalog.pg_proc where oid='public.update_soa_decisions_guarded(uuid,jsonb)'::regprocedure),array['search_path=""'],'the guarded command pins an empty search path');

select * from finish();
rollback;
