begin;
select plan(5);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('50000000-0000-4000-8000-000000000101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-a@soa.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000101","email":"owner-a@soa.test","role":"authenticated"}',true);
select set_config('app.org_a',public.create_organisation_with_owner('SoA Status Org','soa-status-a')::text,true);
insert into public.assessment_sessions(organisation_id,catalogue_version_id,title,created_by)
values(current_setting('app.org_a')::uuid,'00000000-0000-4000-8000-000000000001','Tenant A assessment','50000000-0000-4000-8000-000000000101');
select set_config('app.session_a',(select id::text from public.assessment_sessions where organisation_id=current_setting('app.org_a')::uuid),true);
select set_config('app.reg_a',public.create_soa_draft(current_setting('app.session_a')::uuid,'Tenant A SoA')::text,true);

-- (after building a draft register for tenant A whose id is in current_setting('app.reg_a'))
select is(
  (select count(distinct status) >= 1 from public.soa_items where soa_register_id = current_setting('app.reg_a')::uuid and status = 'pending'),
  true, 'new SoA items default to the new pending status');
select lives_ok(
  format($$ update public.soa_items set status = 'operational' where soa_register_id = %L and position = 0 $$, current_setting('app.reg_a')),
  'a member can set a 7-value status on an applicable item');
select throws_ok(
  format($$ update public.soa_items set applicable = true, status = 'not_applicable' where soa_register_id = %L and position = 0 $$, current_setting('app.reg_a')),
  '23514', null, 'applicable items cannot be not_applicable');
select lives_ok(
  format($$ update public.soa_items set owner_id = (select user_id from public.memberships where organisation_id = current_setting('app.org_a')::uuid limit 1) where soa_register_id = %L and position = 0 $$, current_setting('app.reg_a')),
  'a member can be set as the SoA item owner');
select throws_ok(
  $$ select 'not_applicable'::public.soa_status $$, '42704', null, 'the old soa_status type is dropped');

select * from finish();
rollback;
