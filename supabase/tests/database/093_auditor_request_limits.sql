begin;
select plan(17);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('93000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','auditor-limit-owner@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by)
values ('93000000-0000-4000-8000-000000000002','Auditor limit test','auditor-limit-test','93000000-0000-4000-8000-000000000001');
insert into public.memberships(organisation_id,user_id,role)
values ('93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001','owner');
insert into public.auditor_access_tokens(id,organisation_id,token_hash,label,expires_at,revoked_at,created_by)
select id::uuid,'93000000-0000-4000-8000-000000000002',encode(extensions.digest(convert_to(token,'UTF8'),'sha256'),'hex'),'Synthetic limiter proof',expires,revoked,'93000000-0000-4000-8000-000000000001'
from (values
('93000000-0000-4000-8000-000000000011','auditor-limit-a',now()+interval '1 day',null::timestamptz),
('93000000-0000-4000-8000-000000000012','auditor-limit-b',now()+interval '1 day',null::timestamptz),
('93000000-0000-4000-8000-000000000013','auditor-limit-expired',now()-interval '1 day',null::timestamptz),
('93000000-0000-4000-8000-000000000014','auditor-limit-revoked',now()+interval '1 day',now())) as v(id,token,expires,revoked);
delete from public.rate_limit_counters where key='auditor:global' or key like 'auditor:token:93000000%';
set local role anon;
select is(public.audit_view_for_token('auditor-limit-a')->>'organisationName','Auditor limit test','valid anonymous lookup preserves its payload');
select is(public.audit_view_for_token('unknown-limiter-token'),null,'unknown tokens are refused');
select is(public.audit_view_for_token('auditor-limit-expired'),null,'expired tokens are refused');
select is(public.audit_view_for_token('auditor-limit-revoked'),null,'revoked tokens are refused');
do $$ begin for i in 1..29 loop perform public.audit_view_for_token('auditor-limit-a'); end loop; end $$;
select is(public.audit_view_for_token('auditor-limit-a'),null,'anonymous direct RPC is blocked after thirty successful uses');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.audit_view_for_token('auditor-limit-a'),null,'authenticated callers share the same token budget');
reset role;
select is((select count(*) from public.auditor_access_log where token_id='93000000-0000-4000-8000-000000000011'),30::bigint,'denied calls do not append access logs');
select is((select count from public.rate_limit_counters where key='auditor:token:93000000-0000-4000-8000-000000000011'),32,'rejected calls retain their counter increments');
set local role anon;
select isnt(public.audit_view_for_token('auditor-limit-b'),null,'a different valid link has its own token budget');
reset role;
update public.rate_limit_counters set count=300 where key='auditor:global';
set local role anon;
select is(public.audit_view_for_token('auditor-limit-b'),null,'global budget cannot be bypassed with another token');
reset role;
select is((select count from public.rate_limit_counters where key='auditor:global'),301,'global rejection does not roll back the reservation');
select is((select count(*) from public.auditor_access_log where organisation_id='93000000-0000-4000-8000-000000000002'),31::bigint,'global denial avoids payload logging');
update public.rate_limit_counters set expires_at=now()-interval '1 second' where key='auditor:global' or key like 'auditor:token:93000000%';
set local role anon;
select isnt(public.audit_view_for_token('auditor-limit-a'),null,'ordinary access resumes after expiry');
select is(public.audit_view_for_token(repeat('x',257)),null,'oversized input is rejected before hashing or reserving');
reset role;
select is((select count from public.rate_limit_counters where key='auditor:global'),1,'expired global window restarts and oversized input creates no state');
set local role anon;
select throws_ok($$select public.increment_rate_limit('auditor:global',1)$$,'42501',null,'anonymous callers cannot reset or spoof the shared counter');
select throws_ok($$update public.rate_limit_counters set count=0 where key='auditor:global'$$,'42501',null,'anonymous callers cannot write counters directly');
select * from finish();
rollback;
