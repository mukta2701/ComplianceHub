begin;
select plan(30);

select ok(
  (select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid='public.is_organisation_operator(uuid)'::pg_catalog.regprocedure),
  'operator helper pins an empty search path');
select ok(not pg_catalog.has_function_privilege('anon','public.is_organisation_operator(uuid)','execute'),'anon cannot execute operator helper');
select ok(pg_catalog.has_function_privilege('authenticated','public.is_organisation_operator(uuid)','execute'),'authenticated users can execute operator helper');
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid='public.restrict_admin_membership_update()'::pg_catalog.regprocedure),
  'membership update guard pins an empty search path');
select ok(not pg_catalog.has_function_privilege('anon','public.restrict_admin_membership_update()','execute'),'anon cannot execute membership update guard');
select ok(pg_catalog.has_function_privilege('authenticated','public.restrict_admin_membership_update()','execute'),'authenticated updates can invoke membership update guard');
select is(
  (select count(*) from pg_catalog.pg_trigger where tgrelid='public.memberships'::pg_catalog.regclass and tgname='memberships_restrict_admin_update' and not tgisinternal),
  1::bigint,
  'membership update guard trigger is installed exactly once');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('61000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-owner-a@example.test','',now(),'{}','{}'),
 ('61000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-admin-a@example.test','',now(),'{}','{}'),
 ('61000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-member-a@example.test','',now(),'{}','{}'),
 ('61000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-owner-b@example.test','',now(),'{}','{}'),
 ('61000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-member-b@example.test','',now(),'{}','{}'),
 ('61000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-move-org@example.test','',now(),'{}','{}'),
 ('61000000-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-move-user@example.test','',now(),'{}','{}'),
 ('61000000-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-created-at@example.test','',now(),'{}','{}'),
 ('61000000-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000','authenticated','authenticated','roles-target-user@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","email":"roles-owner-a@example.test","role":"authenticated"}',true);
select set_config('app.org_a',public.create_organisation_with_owner('Roles Org A','roles-a')::text,true);
insert into public.memberships(organisation_id,user_id,role,job_title) values
 (current_setting('app.org_a')::uuid,'61000000-0000-4000-8000-000000000002','admin','Security lead'),
 (current_setting('app.org_a')::uuid,'61000000-0000-4000-8000-000000000003','member','Developer'),
 (current_setting('app.org_a')::uuid,'61000000-0000-4000-8000-000000000006','member','Move org victim'),
 (current_setting('app.org_a')::uuid,'61000000-0000-4000-8000-000000000007','member','Move user victim'),
 (current_setting('app.org_a')::uuid,'61000000-0000-4000-8000-000000000008','member','Timestamp victim');

select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000004","email":"roles-owner-b@example.test","role":"authenticated"}',true);
select set_config('app.org_b',public.create_organisation_with_owner('Roles Org B','roles-b')::text,true);
insert into public.memberships(organisation_id,user_id,role,job_title)
values(current_setting('app.org_b')::uuid,'61000000-0000-4000-8000-000000000005','member','Engineer');

select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","email":"roles-admin-a@example.test","role":"authenticated"}',true);
select ok(public.is_organisation_operator(current_setting('app.org_a')::uuid),'admin is an organisation operator');
select ok(not public.is_organisation_operator(current_setting('app.org_b')::uuid),'operator helper denies another tenant');
select throws_ok($$ insert into public.invitations(organisation_id,email,role,token_hash,invited_by,expires_at) values(current_setting('app.org_b')::uuid,'cross@example.test','member',repeat('4',64),'61000000-0000-4000-8000-000000000002',now()+interval '1 day') $$,'42501',null,'admin cannot invite into another tenant');
select is((select count(*) from public.memberships where organisation_id=current_setting('app.org_b')::uuid),0::bigint,'admin cannot read another tenant memberships');

select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000004","email":"roles-owner-b@example.test","role":"authenticated"}',true);
insert into public.memberships(organisation_id,user_id,role,job_title)
values(current_setting('app.org_b')::uuid,'61000000-0000-4000-8000-000000000002','admin','Shared admin');

select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","email":"roles-admin-a@example.test","role":"authenticated"}',true);
select throws_ok($$ update public.memberships set organisation_id=current_setting('app.org_b')::uuid where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000006' $$,'42501','admins may only update member job titles','admin cannot rewrite a member organisation identity');
select throws_ok($$ update public.memberships set user_id='61000000-0000-4000-8000-000000000009' where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000007' $$,'42501','admins may only update member job titles','admin cannot rewrite a member user identity');
select throws_ok($$ update public.memberships set created_at=created_at - interval '1 year' where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000008' $$,'42501','admins may only update member job titles','admin cannot rewrite membership creation time');

select lives_ok($$ update public.memberships set job_title='Senior Developer' where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000003' $$,'admin can update a member job title');
select is((select job_title from public.memberships where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000003'),'Senior Developer','member job title is updated');
select throws_ok($$ update public.memberships set role='admin' where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000003' $$,'42501',null,'admin cannot promote a member');
select results_eq($$ update public.memberships set job_title='Changed' where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000001' returning user_id $$,$$ select null::uuid where false $$,'admin cannot change an owner');
select results_eq($$ delete from public.memberships where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000001' returning user_id $$,$$ select null::uuid where false $$,'admin cannot remove an owner');
select lives_ok($$ insert into public.invitations(organisation_id,email,role,job_title,token_hash,invited_by,expires_at) values(current_setting('app.org_a')::uuid,'new-member@example.test','member','Engineer',repeat('1',64),'61000000-0000-4000-8000-000000000002',now()+interval '1 day') $$,'admin can invite a member');
select throws_ok($$ insert into public.invitations(organisation_id,email,role,token_hash,invited_by,expires_at) values(current_setting('app.org_a')::uuid,'new-admin@example.test','admin',repeat('2',64),'61000000-0000-4000-8000-000000000002',now()+interval '1 day') $$,'42501',null,'admin cannot invite an admin');
select throws_ok($$ insert into public.invitations(organisation_id,email,role,token_hash,invited_by,expires_at) values(current_setting('app.org_a')::uuid,'new-owner@example.test','owner',repeat('3',64),'61000000-0000-4000-8000-000000000002',now()+interval '1 day') $$,'42501',null,'admin cannot issue an owner invitation');
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","email":"roles-owner-a@example.test","role":"authenticated"}',true);
select lives_ok($$ insert into public.invitations(organisation_id,email,role,token_hash,invited_by,expires_at) values(current_setting('app.org_a')::uuid,'owner-created-admin@example.test','admin',repeat('5',64),'61000000-0000-4000-8000-000000000001',now()+interval '1 day') $$,'owner can invite an admin');
set local role postgres;
select throws_ok($$ insert into public.invitations(organisation_id,email,role,token_hash,invited_by,expires_at) values(current_setting('app.org_a')::uuid,'owner-created-owner@example.test','owner',repeat('7',64),'61000000-0000-4000-8000-000000000001',now()+interval '1 day') $$,'23514',null,'no invitation can grant owner');
set local role authenticated;
select lives_ok($$ update public.memberships set role='member' where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000002' $$,'owner can demote an admin');
select lives_ok($$ update public.memberships set role='owner' where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000003' $$,'owner can promote a member to owner');
select lives_ok($$ delete from public.memberships where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000002' $$,'owner can remove a non-owner');
set local role postgres;
update public.memberships set role='member' where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000001';
select throws_ok($$ update public.memberships set role='member' where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000003' $$,'P0001','an organisation must retain at least one owner','last-owner trigger remains enforced');
select throws_ok($$ update public.memberships set job_title=repeat('x',121) where organisation_id=current_setting('app.org_a')::uuid and user_id='61000000-0000-4000-8000-000000000003' $$,'23514',null,'membership job title is limited to 120 characters');
select throws_ok($$ insert into public.invitations(organisation_id,email,role,job_title,token_hash,invited_by,expires_at) values(current_setting('app.org_a')::uuid,'long-title@example.test','member',repeat('x',121),repeat('6',64),'61000000-0000-4000-8000-000000000001',now()+interval '1 day') $$,'23514',null,'invitation job title is limited to 120 characters');

select * from finish();
rollback;
