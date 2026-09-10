begin;
select plan(7);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('50000000-0000-4000-8000-000000000101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-a@soa.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000101","email":"owner-a@soa.test","role":"authenticated"}',true);
select set_config('app.org_a',public.create_organisation_with_owner('SoA Status Org','soa-status-a')::text,true);
insert into public.assessment_sessions(organisation_id,catalogue_version_id,title,created_by)
values(current_setting('app.org_a')::uuid,'00000000-0000-4000-8000-000000000001','Tenant A assessment','50000000-0000-4000-8000-000000000101');
select set_config('app.session_a',(select id::text from public.assessment_sessions where organisation_id=current_setting('app.org_a')::uuid),true);
select set_config('app.reg_a',public.create_or_reuse_soa_review(current_setting('app.session_a')::uuid)::text,true);
select set_config('app.item_a',(select id::text from public.soa_items where soa_register_id=current_setting('app.reg_a')::uuid and position=0),true);

select is(
  (select count(distinct status) >= 1 from public.soa_items where soa_register_id = current_setting('app.reg_a')::uuid and status = 'pending'),
  true, 'new SoA items default to the new pending status');
select lives_ok(
  $$ select * from public.update_soa_decisions_guarded(
    current_setting('app.reg_a')::uuid,
    jsonb_build_array(jsonb_build_object(
      'itemId', current_setting('app.item_a'),
      'expectedRevision', 0,
      'applicable', true,
      'status', 'operational',
      'justification', 'Reviewed for applicability',
      'evidence', '',
      'ownerId', (select user_id from public.memberships where organisation_id=current_setting('app.org_a')::uuid limit 1)
    ))
  ) $$,
  'an operator can set a 7-value status through the guarded decision RPC');
select is(
  (select status::text from public.soa_items where id=current_setting('app.item_a')::uuid),
  'operational', 'the guarded decision RPC saves the implementation status');
select is(
  (select owner_id from public.soa_items where id=current_setting('app.item_a')::uuid),
  (select user_id from public.memberships where organisation_id=current_setting('app.org_a')::uuid limit 1),
  'the guarded decision RPC saves a tenant member as the SoA item owner');
select throws_ok(
  $$ select * from public.update_soa_decisions_guarded(
    current_setting('app.reg_a')::uuid,
    jsonb_build_array(jsonb_build_object(
      'itemId', current_setting('app.item_a'),
      'expectedRevision', 1,
      'applicable', true,
      'status', 'not_applicable',
      'justification', 'Invalid applicability',
      'evidence', '',
      'ownerId', null
    ))
  ) $$,
  '22023', 'control_decision_invalid', 'applicable items cannot be not_applicable through the guarded decision RPC');
select throws_ok(
  format($$ update public.soa_items set status = 'advanced' where id = %L $$, current_setting('app.item_a')),
  '42501', null, 'authenticated callers cannot bypass the guarded decision RPC with direct DML');
select throws_ok(
  $$ select 'not_applicable'::public.soa_status $$, '42704', null, 'the old soa_status type is dropped');

select * from finish();
rollback;
