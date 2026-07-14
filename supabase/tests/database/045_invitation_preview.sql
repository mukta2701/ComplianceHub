begin;
select plan(26);

select has_function('public', 'invitation_preview', array['text'], 'a public invitation preview RPC exists');
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid = 'public.invitation_preview(text)'::pg_catalog.regprocedure),
  'preview RPC pins an empty search path'
);
select ok(
  (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.invitation_preview(text)'::pg_catalog.regprocedure),
  'preview RPC is security definer so callers need no table privilege'
);
select ok(pg_catalog.has_function_privilege('anon', 'public.invitation_preview(text)', 'execute'), 'anonymous visitors may preview a bearer invitation');
select ok(pg_catalog.has_function_privilege('authenticated', 'public.invitation_preview(text)', 'execute'), 'authenticated visitors may preview a bearer invitation');
select ok(not pg_catalog.has_function_privilege('service_role', 'public.invitation_preview(text)', 'execute'), 'service role is not part of the browser preview API');
select ok(not exists (
  select 1
  from pg_catalog.pg_proc p,
       lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
  where p.oid = 'public.invitation_preview(text)'::pg_catalog.regprocedure
    and acl.grantee = 0
), 'PUBLIC has no preview RPC privilege');
select ok(not pg_catalog.has_table_privilege('anon', 'public.invitations', 'select'), 'anonymous visitors cannot select invitation rows directly');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('64000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','preview-owner@example.test','',now(),'{}','{}'),
 ('64000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','preview.person@example.test','',now(),'{}','{}'),
 ('64000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','wrong@example.test','',now(),'{}','{}');

insert into public.organisations(id,name,slug,created_by)
values('64000000-0000-4000-8000-000000000010','Preview Workspace','preview-workspace','64000000-0000-4000-8000-000000000001');

insert into public.invitations(organisation_id,email,role,job_title,token_hash,invited_by,expires_at)
values
 ('64000000-0000-4000-8000-000000000010','preview.person@example.test','member','Developer',encode(extensions.digest(convert_to(repeat('A',43),'UTF8'),'sha256'),'hex'),'64000000-0000-4000-8000-000000000001',now()+interval '1 day'),
 ('64000000-0000-4000-8000-000000000010','expired@example.test','member',null,encode(extensions.digest(convert_to(repeat('B',43),'UTF8'),'sha256'),'hex'),'64000000-0000-4000-8000-000000000001',now()-interval '1 minute'),
 ('64000000-0000-4000-8000-000000000010','revoked@example.test','admin','CTO',encode(extensions.digest(convert_to(repeat('C',43),'UTF8'),'sha256'),'hex'),'64000000-0000-4000-8000-000000000001',now()+interval '1 day'),
 ('64000000-0000-4000-8000-000000000010','accepted@example.test','member',null,encode(extensions.digest(convert_to(repeat('D',43),'UTF8'),'sha256'),'hex'),'64000000-0000-4000-8000-000000000001',now()+interval '1 day');
update public.invitations set revoked_at=now() where email='revoked@example.test';
update public.invitations set accepted_at=now(), accepted_by='64000000-0000-4000-8000-000000000003' where email='accepted@example.test';
insert into public.invitations(organisation_id,email,role,token_hash,invited_by,expires_at,revoked_at)
values('64000000-0000-4000-8000-000000000010','owner-history@example.test','owner',encode(extensions.digest(convert_to(repeat('E',43),'UTF8'),'sha256'),'hex'),'64000000-0000-4000-8000-000000000001',now()+interval '1 day',now());

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select set_config('app.invitation_preview', coalesce(public.invitation_preview(repeat('A',43))::text, '{}'), true);
select ok(current_setting('app.invitation_preview')::jsonb <> '{}'::jsonb, 'an active bearer invitation has a preview');
select is(
  (select array_agg(key order by key)::text from jsonb_object_keys(current_setting('app.invitation_preview')::jsonb) key),
  '{emailHint,emailMatches,expiresAt,jobTitle,organisationName,role}',
  'preview contains only the explicitly safe fields'
);
select is(current_setting('app.invitation_preview')::jsonb->>'organisationName', 'Preview Workspace', 'preview exposes the workspace name');
select is(current_setting('app.invitation_preview')::jsonb->>'role', 'member', 'preview exposes the offered role');
select is(current_setting('app.invitation_preview')::jsonb->>'jobTitle', 'Developer', 'preview exposes the offered job title');
select is(current_setting('app.invitation_preview')::jsonb->>'emailHint', 'p***@example.test', 'preview masks the invited email');
select ok((current_setting('app.invitation_preview')::jsonb->>'expiresAt')::timestamptz > now(), 'preview exposes a future expiry');
select ok(not (current_setting('app.invitation_preview')::jsonb ?| array['id','organisationId','userId','token','tokenHash','email']), 'preview exposes no identifiers, secret, or full email field');
select ok(strpos(current_setting('app.invitation_preview'), repeat('A',43)) = 0, 'preview never echoes the raw bearer token');
select ok(strpos(current_setting('app.invitation_preview'), 'preview.person@example.test') = 0, 'preview never exposes the full invited email');
select is((current_setting('app.invitation_preview')::jsonb->>'emailMatches')::boolean, false, 'anonymous preview does not claim an email match');
select is(public.invitation_preview(repeat('B',43)), null::jsonb, 'expired invitation has no preview');
select is(public.invitation_preview(repeat('C',43)), null::jsonb, 'revoked invitation has no preview');
select is(public.invitation_preview(repeat('D',43)), null::jsonb, 'accepted invitation has no preview');
select is(public.invitation_preview(repeat('E',43)), null::jsonb, 'Owner invitation history has no preview');
select is(public.invitation_preview('not-a-token'), null::jsonb, 'malformed token has no preview');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"64000000-0000-4000-8000-000000000002","email":"preview.person@example.test","role":"authenticated"}',true);
select is((public.invitation_preview(repeat('A',43))->>'emailMatches')::boolean, true, 'matching authenticated email is identified');
select set_config('request.jwt.claims','{"sub":"64000000-0000-4000-8000-000000000003","email":"wrong@example.test","role":"authenticated"}',true);
select is((public.invitation_preview(repeat('A',43))->>'emailMatches')::boolean, false, 'wrong authenticated email is not treated as a match');

select * from finish();
rollback;
