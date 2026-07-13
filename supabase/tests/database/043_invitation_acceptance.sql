begin;
select plan(8);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('62000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','invite-owner@example.test','',now(),'{}','{}'),
 ('62000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','new-admin@example.test','',now(),'{}','{}'),
 ('62000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','existing-member@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"62000000-0000-4000-8000-000000000001","email":"invite-owner@example.test","role":"authenticated"}',true);
select set_config('app.invite_org',public.create_organisation_with_owner('Invite Org','invite-org')::text,true);
insert into public.memberships(organisation_id,user_id,role,job_title)
values(current_setting('app.invite_org')::uuid,'62000000-0000-4000-8000-000000000003','member','Developer');
insert into public.invitations(organisation_id,email,role,job_title,token_hash,invited_by,expires_at) values
 (current_setting('app.invite_org')::uuid,'new-admin@example.test','admin','CTO',encode(extensions.digest(convert_to('new-admin-token','UTF8'),'sha256'),'hex'),'62000000-0000-4000-8000-000000000001',now()+interval '1 day'),
 (current_setting('app.invite_org')::uuid,'existing-member@example.test','admin','Changed by invite',encode(extensions.digest(convert_to('existing-member-token','UTF8'),'sha256'),'hex'),'62000000-0000-4000-8000-000000000001',now()+interval '1 day');

select set_config('request.jwt.claims','{"sub":"62000000-0000-4000-8000-000000000002","email":"new-admin@example.test","role":"authenticated"}',true);
select lives_ok($$ select public.accept_invitation('new-admin-token') $$,'a genuinely new user can accept an Owner-issued Admin invitation');
select is((select role::text from public.memberships where organisation_id=current_setting('app.invite_org')::uuid and user_id='62000000-0000-4000-8000-000000000002'),'admin','accepted Admin invitation grants the Admin role');
select is((select job_title from public.memberships where organisation_id=current_setting('app.invite_org')::uuid and user_id='62000000-0000-4000-8000-000000000002'),'CTO','accepted invitation copies the job title');
select ok((select accepted_at is not null from public.invitations where organisation_id=current_setting('app.invite_org')::uuid and email='new-admin@example.test'),'successful acceptance consumes the invitation');

select set_config('request.jwt.claims','{"sub":"62000000-0000-4000-8000-000000000003","email":"existing-member@example.test","role":"authenticated"}',true);
select throws_ok($$ select public.accept_invitation('existing-member-token') $$,'23505','user is already a member of this organisation','an existing member cannot use an invitation to alter membership');
set local role postgres;
select ok((select accepted_at is null from public.invitations where organisation_id=current_setting('app.invite_org')::uuid and email='existing-member@example.test'),'rejected acceptance leaves the invitation unconsumed');
select is((select role::text from public.memberships where organisation_id=current_setting('app.invite_org')::uuid and user_id='62000000-0000-4000-8000-000000000003'),'member','rejected acceptance preserves the existing role');
select is((select job_title from public.memberships where organisation_id=current_setting('app.invite_org')::uuid and user_id='62000000-0000-4000-8000-000000000003'),'Developer','rejected acceptance preserves the existing job title');

select * from finish();
rollback;
