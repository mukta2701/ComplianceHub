begin;
select plan(55);

select has_column('public', 'invitations', 'revoked_at', 'invitations retain revocation history');
select has_column('public', 'invitations', 'accepted_by', 'invitations record the accepting user');
select has_column('public', 'invitations', 'delivery_status', 'invitations record delivery state');
select col_default_is('public', 'invitations', 'delivery_status', 'pending', 'delivery starts pending');
select has_column('public', 'invitations', 'delivery_attempt_count', 'invitations count delivery attempts');
select ok(
  exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'invitations_active_org_email_idx' and indexdef ilike '%unique%' and indexdef ilike '%lower(email)%' and indexdef ilike '%accepted_at is null%' and indexdef ilike '%revoked_at is null%'),
  'a case-insensitive partial unique index protects active invitations');

select ok((select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid = 'public.issue_invitation(uuid,text,public.membership_role,text,text,timestamp with time zone)'::pg_catalog.regprocedure), 'issue RPC pins an empty search path');
select ok(not pg_catalog.has_function_privilege('anon', 'public.issue_invitation(uuid,text,public.membership_role,text,text,timestamp with time zone)', 'execute'), 'anonymous users cannot issue invitations');
select ok(pg_catalog.has_function_privilege('authenticated', 'public.issue_invitation(uuid,text,public.membership_role,text,text,timestamp with time zone)', 'execute'), 'authenticated operators may call issue RPC');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.invitations', 'insert'), 'authenticated users cannot bypass issue RPC with direct inserts');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.invitations', 'update'), 'authenticated users cannot bypass lifecycle RPCs with direct updates');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.invitations', 'delete'), 'authenticated users cannot erase invitation history');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.invitations', 'select'), 'authenticated operators retain RLS-scoped invitation reads');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.invitations', 'truncate'), 'authenticated users cannot bypass RLS by truncating invitations');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.invitations', 'references'), 'authenticated users cannot add dependencies to invitations');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.invitations', 'trigger'), 'authenticated users cannot install invitation triggers');
select ok(not pg_catalog.has_table_privilege('anon', 'public.invitations', 'select'), 'anonymous users cannot read invitations');
select ok(not (
  pg_catalog.has_table_privilege('anon', 'public.invitations', 'insert')
  or pg_catalog.has_table_privilege('anon', 'public.invitations', 'update')
  or pg_catalog.has_table_privilege('anon', 'public.invitations', 'delete')
  or pg_catalog.has_table_privilege('anon', 'public.invitations', 'truncate')
  or pg_catalog.has_table_privilege('anon', 'public.invitations', 'references')
  or pg_catalog.has_table_privilege('anon', 'public.invitations', 'trigger')
), 'anonymous users have no invitation table mutation privilege');
select ok(not exists (
  select 1
  from pg_catalog.pg_class c,
       lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
  where c.oid = 'public.invitations'::pg_catalog.regclass
    and acl.grantee = 0
), 'PUBLIC has no invitation table privilege');
select ok((select convalidated from pg_catalog.pg_constraint where conrelid='public.invitations'::pg_catalog.regclass and conname='invitations_cannot_grant_owner'), 'the active Owner-invitation invariant is validated');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('63000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-owner@example.test','',now(),'{}','{}'),
 ('63000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-admin@example.test','',now(),'{}','{}'),
 ('63000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lifecycle-member@example.test','',now(),'{}','{}'),
 ('63000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','accept-me@example.test','',now(),'{}','{}'),
 ('63000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','outsider@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000001","email":"lifecycle-owner@example.test","role":"authenticated"}',true);
select set_config('app.invitation_org', public.create_organisation_with_owner('Invitation Lifecycle Org','invitation-lifecycle-org')::text, true);
insert into public.memberships(organisation_id,user_id,role,job_title) values
 (current_setting('app.invitation_org')::uuid,'63000000-0000-4000-8000-000000000002','admin','CTO'),
 (current_setting('app.invitation_org')::uuid,'63000000-0000-4000-8000-000000000003','member','Developer');

select set_config('app.member_invite', public.issue_invitation(current_setting('app.invitation_org')::uuid, ' New.Person@Example.Test ', 'member', 'Engineer', repeat('a',64), now()+interval '7 days')->>'id', true);
select is((select email from public.invitations where id=current_setting('app.member_invite')::uuid), 'new.person@example.test', 'issue normalises email');
select is((select role::text from public.invitations where id=current_setting('app.member_invite')::uuid), 'member', 'owner can issue a Member invitation');
select set_config('app.admin_invite', public.issue_invitation(current_setting('app.invitation_org')::uuid, 'new.admin@example.test', 'admin', 'CISO', repeat('b',64), now()+interval '7 days')->>'id', true);
select is((select role::text from public.invitations where id=current_setting('app.admin_invite')::uuid), 'admin', 'owner can issue an Admin invitation');
select throws_ok($$ select public.issue_invitation(current_setting('app.invitation_org')::uuid, 'owner@example.test', 'owner', null, repeat('c',64), now()+interval '7 days') $$, '42501', 'owner invitations are not permitted', 'no caller can issue an Owner invitation');
select throws_ok($$ select public.issue_invitation(current_setting('app.invitation_org')::uuid, 'lifecycle-member@example.test', 'member', null, repeat('d',64), now()+interval '7 days') $$, '23505', 'user is already a member of this organisation', 'existing members cannot be invited by email');

select set_config('app.reissued_member_invite', public.issue_invitation(current_setting('app.invitation_org')::uuid, 'NEW.PERSON@example.test', 'member', 'Senior Engineer', repeat('e',64), now()+interval '7 days')->>'id', true);
select is(current_setting('app.reissued_member_invite'), current_setting('app.member_invite'), 'case-insensitive reissue locks and rotates the existing active invitation');
select is((select token_hash from public.invitations where id=current_setting('app.member_invite')::uuid), repeat('e',64), 'reissue rotates the stored token hash');
select is((select count(*) from public.invitations where organisation_id=current_setting('app.invitation_org')::uuid and lower(email)='new.person@example.test' and accepted_at is null and revoked_at is null), 1::bigint, 'only one active case-insensitive invitation exists');

select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000002","email":"lifecycle-admin@example.test","role":"authenticated"}',true);
select set_config('app.admin_member_invite', public.issue_invitation(current_setting('app.invitation_org')::uuid, 'admin-created@example.test', 'member', 'Developer', repeat('f',64), now()+interval '7 days')->>'id', true);
select ok(current_setting('app.admin_member_invite')::uuid is not null, 'Admin can issue Member invitations');
select throws_ok($$ select public.issue_invitation(current_setting('app.invitation_org')::uuid, 'admin-created-admin@example.test', 'admin', null, repeat('1',64), now()+interval '7 days') $$, '42501', 'your role cannot invite that role', 'Admin cannot issue Admin invitations');
select throws_ok(format($$ select public.resend_invitation(%L::uuid, repeat('2',64), now()+interval '7 days') $$, current_setting('app.admin_invite')), '42501', 'your role cannot manage that invitation', 'Admin cannot rotate an active Admin invitation');
select throws_ok(format($$ select public.revoke_invitation(%L::uuid) $$, current_setting('app.admin_invite')), '42501', 'your role cannot manage that invitation', 'Admin cannot revoke an active Admin invitation');

select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000003","email":"lifecycle-member@example.test","role":"authenticated"}',true);
select throws_ok($$ select public.issue_invitation(current_setting('app.invitation_org')::uuid, 'member-created@example.test', 'member', null, repeat('3',64), now()+interval '7 days') $$, '42501', 'you are not allowed to issue invitations', 'ordinary Members cannot issue invitations');

select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000001","email":"lifecycle-owner@example.test","role":"authenticated"}',true);
select lives_ok(format($$ select public.resend_invitation(%L::uuid, repeat('4',64), now()+interval '7 days') $$, current_setting('app.member_invite')), 'Owner can resend an active invitation');
select is((select token_hash from public.invitations where id=current_setting('app.member_invite')::uuid), repeat('4',64), 'resend rotates the token hash');
select lives_ok(format($$ select public.record_invitation_delivery(%L::uuid, repeat('4',64), 'sent', 'email_123', null) $$, current_setting('app.member_invite')), 'operator can record the current token delivery outcome');
select is((select delivery_status from public.invitations where id=current_setting('app.member_invite')::uuid), 'sent', 'sent delivery status is persisted');
select is((select delivery_attempt_count from public.invitations where id=current_setting('app.member_invite')::uuid), 1, 'delivery attempt is counted');
select throws_ok(format($$ select public.record_invitation_delivery(%L::uuid, repeat('e',64), 'failed', null, 'stale') $$, current_setting('app.member_invite')), '22023', 'invitation token has changed', 'a stale delivery cannot overwrite a newer token outcome');
select lives_ok(format($$ select public.revoke_invitation(%L::uuid) $$, current_setting('app.member_invite')), 'Owner can revoke an active invitation without deleting it');
select ok((select revoked_at is not null from public.invitations where id=current_setting('app.member_invite')::uuid), 'revocation retains the invitation row');
select set_config('app.recreated_member_invite', public.issue_invitation(current_setting('app.invitation_org')::uuid, 'new.person@example.test', 'member', 'Principal Engineer', repeat('6',64), now()+interval '7 days')->>'id', true);
select isnt(current_setting('app.recreated_member_invite'), current_setting('app.member_invite'), 'reissuing after revocation creates a new invitation row');
select is((select count(*) from public.invitations where organisation_id=current_setting('app.invitation_org')::uuid and lower(email)='new.person@example.test'), 2::bigint, 'reissue preserves revoked invitation history');

select set_config('app.accept_invite', public.issue_invitation(current_setting('app.invitation_org')::uuid, 'accept-me@example.test', 'member', 'Analyst', encode(extensions.digest(convert_to('accept-lifecycle-token','UTF8'),'sha256'),'hex'), now()+interval '7 days')->>'id', true);
select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000004","email":"accept-me@example.test","role":"authenticated"}',true);
select lives_ok($$ select public.accept_invitation('accept-lifecycle-token') $$, 'an active invitation can be accepted');
set local role postgres;
select is((select accepted_by from public.invitations where id=current_setting('app.accept_invite')::uuid), '63000000-0000-4000-8000-000000000004'::uuid, 'acceptance records the accepting profile atomically');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000001","email":"lifecycle-owner@example.test","role":"authenticated"}',true);
select set_config('app.revoked_accept_invite', public.issue_invitation(current_setting('app.invitation_org')::uuid, 'outsider@example.test', 'member', null, encode(extensions.digest(convert_to('revoked-lifecycle-token','UTF8'),'sha256'),'hex'), now()+interval '7 days')->>'id', true);
select lives_ok(format($$ select public.revoke_invitation(%L::uuid) $$, current_setting('app.revoked_accept_invite')), 'Owner can revoke the acceptance test invitation');
select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000005","email":"outsider@example.test","role":"authenticated"}',true);
select throws_ok(format($$ select public.record_invitation_delivery(%L::uuid, repeat('6',64), 'sent', 'forged', null) $$, current_setting('app.recreated_member_invite')), '42501', 'your role cannot manage that invitation', 'an outsider cannot record delivery for another organisation');
select throws_ok($$ select public.accept_invitation('revoked-lifecycle-token') $$, '22023', 'invitation is invalid or expired', 'a revoked invitation cannot be accepted');

select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000001","email":"lifecycle-owner@example.test","role":"authenticated"}',true);
update public.memberships
set role = 'member'
where organisation_id = current_setting('app.invitation_org')::uuid
  and user_id = '63000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"63000000-0000-4000-8000-000000000002","email":"lifecycle-admin@example.test","role":"authenticated"}',true);
select throws_ok($$ select public.issue_invitation(current_setting('app.invitation_org')::uuid, 'after-demotion@example.test', 'member', null, repeat('9',64), now()+interval '7 days') $$, '42501', 'you are not allowed to issue invitations', 'a demoted operator immediately loses issue authorization');
select throws_ok(format($$ select public.resend_invitation(%L::uuid, repeat('0',64), now()+interval '7 days') $$, current_setting('app.admin_member_invite')), '42501', 'your role cannot manage that invitation', 'a demoted operator immediately loses resend authorization');
select throws_ok(format($$ select public.revoke_invitation(%L::uuid) $$, current_setting('app.admin_member_invite')), '42501', 'your role cannot manage that invitation', 'a demoted operator immediately loses revoke authorization');
select throws_ok(format($$ select public.record_invitation_delivery(%L::uuid, repeat('f',64), 'sent', 'forged-after-demotion', null) $$, current_setting('app.admin_member_invite')), '42501', 'your role cannot manage that invitation', 'a demoted operator immediately loses delivery-record authorization');

set local role postgres;
select lives_ok(format($$ insert into public.invitations(organisation_id,email,role,token_hash,invited_by,expires_at,accepted_at) values(%L::uuid,'historical-owner@example.test','owner',repeat('8',64),'63000000-0000-4000-8000-000000000001',now(),now()) $$, current_setting('app.invitation_org')), 'accepted legacy Owner invitation history remains representable');
select lives_ok(format($$ insert into public.invitations(organisation_id,email,role,token_hash,invited_by,expires_at,revoked_at) values(%L::uuid,'revoked-owner@example.test','owner',repeat('0',64),'63000000-0000-4000-8000-000000000001',now(),now()) $$, current_setting('app.invitation_org')), 'revoked legacy Owner invitation history remains representable');
select throws_ok(format($$ insert into public.invitations(organisation_id,email,role,token_hash,invited_by,expires_at) values(%L::uuid,'active-owner@example.test','owner',repeat('9',64),'63000000-0000-4000-8000-000000000001',now()+interval '1 day') $$, current_setting('app.invitation_org')), '23514', null, 'an active Owner invitation cannot be directly represented');

select * from finish();
rollback;
