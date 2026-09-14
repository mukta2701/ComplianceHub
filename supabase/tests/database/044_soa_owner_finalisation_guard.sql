begin;
select plan(1);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('50000000-0000-4000-8000-000000000301','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-guard@soa.test','',now(),'{}','{}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000301","email":"owner-guard@soa.test","role":"authenticated"}',true);
select set_config('app.owner_guard_org',public.create_organisation_with_owner('Owner SoA Guard','owner-soa-guard')::text,true);
insert into public.assessment_sessions(organisation_id,catalogue_version_id,title,created_by) values(current_setting('app.owner_guard_org')::uuid,'00000000-0000-4000-8000-000000000001','Owner guard assessment','50000000-0000-4000-8000-000000000301');
select set_config('app.owner_guard_session',(select id::text from public.assessment_sessions where organisation_id=current_setting('app.owner_guard_org')::uuid),true);
select set_config('app.owner_guard_register',public.create_or_reuse_soa_review(current_setting('app.owner_guard_session')::uuid)::text,true);
reset role;
update public.soa_items set status = 'operational', justification = 'Reviewed and operating' where soa_register_id = current_setting('app.owner_guard_register')::uuid;
set local role authenticated;

select throws_ok(
  format($$ select public.finalise_soa(%L) $$, current_setting('app.owner_guard_register')),
  'P0001', 'SoA cannot be finalised: missing owners',
  'finalisation rejects applicable controls without an accountable owner');

select * from finish();
rollback;
