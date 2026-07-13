begin;
select plan(25);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('50000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-a@example.test','',now(),'{}','{}'),
 ('50000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','invitee@example.test','',now(),'{}','{}'),
 ('50000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','owner-b@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","email":"owner-a@example.test","role":"authenticated"}',true);
select set_config('app.org_a',public.create_organisation_with_owner('Organisation A','workflow-a')::text,true);
select public.issue_invitation(
  current_setting('app.org_a')::uuid,
  'invitee@example.test',
  'member',
  null,
  encode(extensions.digest(convert_to('valid-invite-token','UTF8'),'sha256'),'hex'),
  now()+interval '1 day'
);
insert into public.assessment_sessions(organisation_id,catalogue_version_id,title,created_by)
values(current_setting('app.org_a')::uuid,'00000000-0000-4000-8000-000000000001','Tenant A assessment','50000000-0000-4000-8000-000000000001');
select set_config('app.session_a',(select id::text from public.assessment_sessions where organisation_id=current_setting('app.org_a')::uuid),true);
select public.save_assessment_response(current_setting('app.session_a')::uuid,(select id from public.catalogue_questions where code='GOV-01'),'partially','Tenant A evidence',0);
select set_config('app.register_a',public.create_soa_draft(current_setting('app.session_a')::uuid,'Tenant A SoA')::text,true);
update public.soa_items
set applicable=false,
    status='not_applicable',
    justification='Reviewed for applicability',
    owner_id='50000000-0000-4000-8000-000000000001'
where soa_register_id=current_setting('app.register_a')::uuid;
select set_config('app.snapshot_a',public.finalise_soa(current_setting('app.register_a')::uuid)::text,true);
insert into public.risks(organisation_id,reference,title,description,category_id,owner_id,likelihood,impact,treatment,residual_likelihood,residual_impact,created_by)
values(current_setting('app.org_a')::uuid,'R-A-1','Tenant A risk','A material risk owned by tenant A',(select id from public.risk_categories where organisation_id=current_setting('app.org_a')::uuid order by position limit 1),'50000000-0000-4000-8000-000000000001',3,4,'mitigate',2,3,'50000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000003","email":"owner-b@example.test","role":"authenticated"}',true);
select set_config('app.org_b',public.create_organisation_with_owner('Organisation B','workflow-b')::text,true);
select throws_ok($$ select public.accept_invitation('valid-invite-token') $$,'22023','invitation is invalid or expired','an invitation cannot be accepted by a different email address');

select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000002","email":"invitee@example.test","role":"authenticated"}',true);
select lives_ok($$ select public.accept_invitation('valid-invite-token') $$,'the intended recipient can accept an invitation');
select ok(public.is_organisation_member(current_setting('app.org_a')::uuid),'acceptance creates the membership atomically');
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","email":"owner-a@example.test","role":"authenticated"}',true);
select ok((select accepted_at is not null from public.invitations where organisation_id=current_setting('app.org_a')::uuid and email='invitee@example.test'),'acceptance marks the invitation used');

select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000003","email":"owner-b@example.test","role":"authenticated"}',true);

select is((select count(*) from public.organisations where id=current_setting('app.org_a')::uuid),0::bigint,'organisations are read-isolated');
select is((select count(*) from public.memberships where organisation_id=current_setting('app.org_a')::uuid),0::bigint,'memberships are read-isolated');
select is((select count(*) from public.invitations where organisation_id=current_setting('app.org_a')::uuid),0::bigint,'invitations are read-isolated');
select is((select count(*) from public.audit_events where organisation_id=current_setting('app.org_a')::uuid),0::bigint,'audit events are read-isolated');
select is((select count(*) from public.assessment_sessions where organisation_id=current_setting('app.org_a')::uuid),0::bigint,'assessment sessions are read-isolated');
select is((select count(*) from public.assessment_responses where organisation_id=current_setting('app.org_a')::uuid),0::bigint,'assessment responses are read-isolated');
select is((select count(*) from public.soa_registers where organisation_id=current_setting('app.org_a')::uuid),0::bigint,'SoA registers are read-isolated');
select is((select count(*) from public.soa_items where organisation_id=current_setting('app.org_a')::uuid),0::bigint,'SoA items are read-isolated');
select is((select count(*) from public.soa_snapshots where organisation_id=current_setting('app.org_a')::uuid),0::bigint,'SoA snapshots are read-isolated');
select is((select count(*) from public.risks where organisation_id=current_setting('app.org_a')::uuid),0::bigint,'risks are read-isolated');

select throws_ok(format($$ insert into public.memberships(organisation_id,user_id,role) values(%L,'50000000-0000-4000-8000-000000000003','member') $$,current_setting('app.org_a')),'42501',null,'cross-tenant membership insert is denied');
select throws_ok(format($$ insert into public.invitations(organisation_id,email,token_hash,invited_by,expires_at) values(%L,'x@example.test','%s','50000000-0000-4000-8000-000000000003',now()+interval '1 day') $$,current_setting('app.org_a'),repeat('a',64)),'42501',null,'cross-tenant invitation insert is denied');
select throws_ok(format($$ insert into public.assessment_sessions(organisation_id,catalogue_version_id,title,created_by) values(%L,'00000000-0000-4000-8000-000000000001','Attack','50000000-0000-4000-8000-000000000003') $$,current_setting('app.org_a')),'42501',null,'cross-tenant assessment insert is denied');
select throws_ok(format($$ insert into public.soa_registers(organisation_id,assessment_session_id,control_catalogue_version_id,version,title,created_by) values(%L,%L,'40000000-0000-4000-8000-000000000001',99,'Attack','50000000-0000-4000-8000-000000000003') $$,current_setting('app.org_a'),current_setting('app.session_a')),'42501',null,'cross-tenant SoA insert is denied');
select throws_ok(format($$ insert into public.risks(organisation_id,reference,title,description,category_id,likelihood,impact,treatment,residual_likelihood,residual_impact,created_by) values(%L,'ATTACK','Attack','Attack','00000000-0000-4000-8000-0000000000c1',1,1,'accept',1,1,'50000000-0000-4000-8000-000000000003') $$,current_setting('app.org_a')),'42501',null,'cross-tenant risk insert is denied');

select results_eq(format($$ update public.organisations set name='Tampered' where id=%L returning id $$,current_setting('app.org_a')),$$ select null::uuid where false $$,'cross-tenant updates affect no rows');
select results_eq(format($$ delete from public.risks where organisation_id=%L returning id $$,current_setting('app.org_a')),$$ select null::uuid where false $$,'cross-tenant deletes affect no rows');

select throws_ok(format($$ select public.save_assessment_response(%L,(select id from public.catalogue_questions where code='GOV-01'),'yes','Attack',1) $$,current_setting('app.session_a')),'42501','assessment not found','assessment response RPC rejects another tenant');
select throws_ok(format($$ select public.create_soa_draft(%L,'Attack') $$,current_setting('app.session_a')),'42501','assessment not found','SoA draft RPC rejects another tenant');
select throws_ok(format($$ select public.finalise_soa(%L) $$,current_setting('app.register_a')),'42501','SoA register not found','finalisation RPC rejects another tenant');
select throws_ok(format($$ select public.create_soa_successor(%L,'Attack') $$,current_setting('app.snapshot_a')),'42501','SoA snapshot not found','successor RPC rejects another tenant');

select * from finish();
rollback;
