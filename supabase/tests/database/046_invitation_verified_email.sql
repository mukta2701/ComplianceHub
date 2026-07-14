begin;
select plan(12);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('66000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','verified-owner@example.test','',now(),'{}','{}'),
 ('66000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','unverified@example.test','',null,'{}','{}'),
 ('66000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','confirmed@example.test','',now(),'{}','{}'),
 ('66000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','changed@example.test','',now(),'{}','{}');

insert into public.organisations(id,name,slug,created_by)
values('66000000-0000-4000-8000-000000000010','Verified Email Workspace','verified-email-workspace','66000000-0000-4000-8000-000000000001');

insert into public.invitations(organisation_id,email,role,job_title,token_hash,invited_by,expires_at)
values
 ('66000000-0000-4000-8000-000000000010','unverified@example.test','member','Developer',encode(extensions.digest(convert_to(repeat('U',43),'UTF8'),'sha256'),'hex'),'66000000-0000-4000-8000-000000000001',now()+interval '1 day'),
 ('66000000-0000-4000-8000-000000000010','confirmed@example.test','member','Engineer',encode(extensions.digest(convert_to(repeat('C',43),'UTF8'),'sha256'),'hex'),'66000000-0000-4000-8000-000000000001',now()+interval '1 day'),
 ('66000000-0000-4000-8000-000000000010','old@example.test','member','Analyst',encode(extensions.digest(convert_to(repeat('M',43),'UTF8'),'sha256'),'hex'),'66000000-0000-4000-8000-000000000001',now()+interval '1 day');

set local role authenticated;

-- A matching JWT claim cannot elevate an unverified account.
select set_config('request.jwt.claims','{"sub":"66000000-0000-4000-8000-000000000002","email":"unverified@example.test","role":"authenticated"}',true);
select is((public.invitation_preview(repeat('U',43))->>'emailMatches')::boolean, false, 'unverified auth.users email never matches a preview');
select throws_ok($$ select public.accept_invitation(repeat('U',43)) $$, '22023', 'invitation is invalid or expired', 'unverified user cannot accept even with a matching JWT email');
set local role postgres;
select ok(not exists(select 1 from public.memberships where organisation_id='66000000-0000-4000-8000-000000000010' and user_id='66000000-0000-4000-8000-000000000002'), 'unverified rejection creates no membership');
select ok((select accepted_at is null from public.invitations where email='unverified@example.test'), 'unverified rejection leaves invitation unconsumed');

-- The verified auth.users row is authoritative when the JWT email is stale.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"66000000-0000-4000-8000-000000000003","email":"stale@example.test","role":"authenticated"}',true);
select is((public.invitation_preview(repeat('C',43))->>'emailMatches')::boolean, true, 'confirmed auth.users email matches despite a stale JWT email');
select lives_ok($$ select public.accept_invitation(repeat('C',43)) $$, 'confirmed auth.users email can accept despite a stale JWT email');
set local role postgres;
select ok(exists(select 1 from public.memberships where organisation_id='66000000-0000-4000-8000-000000000010' and user_id='66000000-0000-4000-8000-000000000003'), 'verified acceptance creates membership');
select is((select accepted_by from public.invitations where email='confirmed@example.test'), '66000000-0000-4000-8000-000000000003'::uuid, 'verified acceptance records the authoritative user');

-- A stale JWT containing the old invited email cannot override a changed account email.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"66000000-0000-4000-8000-000000000004","email":"old@example.test","role":"authenticated"}',true);
select is((public.invitation_preview(repeat('M',43))->>'emailMatches')::boolean, false, 'current auth.users email mismatch does not match preview');
select throws_ok($$ select public.accept_invitation(repeat('M',43)) $$, '22023', 'invitation is invalid or expired', 'current auth.users email mismatch rejects acceptance');
set local role postgres;
select ok(not exists(select 1 from public.memberships where organisation_id='66000000-0000-4000-8000-000000000010' and user_id='66000000-0000-4000-8000-000000000004'), 'mismatched account creates no membership');
select ok((select accepted_at is null from public.invitations where email='old@example.test'), 'mismatched rejection leaves invitation unconsumed');

select * from finish();
rollback;
