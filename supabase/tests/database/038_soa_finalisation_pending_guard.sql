begin;
select plan(1);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('50000000-0000-4000-8000-000000000201','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pending-guard@soa.test','',now(),'{}','{}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000201","email":"pending-guard@soa.test","role":"authenticated"}',true);
select set_config('app.pending_org',public.create_organisation_with_owner('Pending SoA Guard','pending-soa-guard')::text,true);
insert into public.assessment_sessions(organisation_id,catalogue_version_id,title,created_by)
values(current_setting('app.pending_org')::uuid,'00000000-0000-4000-8000-000000000001','Pending test assessment','50000000-0000-4000-8000-000000000201');
select set_config('app.pending_session',(select id::text from public.assessment_sessions where organisation_id=current_setting('app.pending_org')::uuid),true);
select set_config('app.pending_register',public.create_or_reuse_soa_review(current_setting('app.pending_session')::uuid)::text,true);
reset role;
update public.soa_items set justification = 'Documented for review' where soa_register_id = current_setting('app.pending_register')::uuid;
set local role authenticated;

select throws_ok(
  format($$ select public.finalise_soa(%L) $$, current_setting('app.pending_register')),
  'P0001', 'SoA cannot be finalised: pending controls',
  'finalisation rejects an SoA that still contains pending applicable controls');

select * from finish();
rollback;
