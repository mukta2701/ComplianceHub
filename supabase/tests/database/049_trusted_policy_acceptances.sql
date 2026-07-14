begin;
select plan(10);

select has_column('public', 'policy_acceptances', 'trusted_at', 'policy acceptances carry an explicit trust marker');
select col_is_null('public', 'policy_acceptances', 'trusted_at', 'legacy acceptances remain untrusted by default');
select is(
  (select count(*) from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'policy_acceptances' and cmd = 'SELECT' and qual like '%trusted_at IS NOT NULL%'),
  2::bigint,
  'member and operator reporting both exclude untrusted legacy rows'
);
select ok(
  pg_catalog.pg_get_functiondef('public.accept_policy(uuid)'::pg_catalog.regprocedure) like '%trusted_at%',
  'only accept_policy stamps an acceptance as trusted'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('79000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trusted-owner@example.test','',now(),'{}','{}'),
 ('79000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trusted-member@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"79000000-0000-4000-8000-000000000001","email":"trusted-owner@example.test","role":"authenticated"}',true);
select set_config('app.trusted_org',public.create_organisation_with_owner('Trusted acceptance org','trusted-acceptance-org')::text,true);
insert into public.memberships(organisation_id,user_id,role) values(current_setting('app.trusted_org')::uuid,'79000000-0000-4000-8000-000000000002','member');
insert into public.policies(id,organisation_id,reference,title,body,version,status,created_by)
values('79000000-0000-4000-8000-000000000101',current_setting('app.trusted_org')::uuid,'TRUST-1','Trust marker','body',3,'approved','79000000-0000-4000-8000-000000000001');

set local role postgres;
insert into public.policy_acceptances(organisation_id,policy_id,user_id,accepted_version,accepted_at)
values(current_setting('app.trusted_org')::uuid,'79000000-0000-4000-8000-000000000101','79000000-0000-4000-8000-000000000002',999,'2099-01-01');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"79000000-0000-4000-8000-000000000002","email":"trusted-member@example.test","role":"authenticated"}',true);
select is((select count(*) from public.policy_acceptances),0::bigint,'a Member does not see a forged legacy acceptance');

select set_config('request.jwt.claims','{"sub":"79000000-0000-4000-8000-000000000001","email":"trusted-owner@example.test","role":"authenticated"}',true);
select is((select count(*) from public.policy_acceptances),0::bigint,'an operator does not report a forged legacy acceptance');

select set_config('request.jwt.claims','{"sub":"79000000-0000-4000-8000-000000000002","email":"trusted-member@example.test","role":"authenticated"}',true);
select lives_ok($$ select public.accept_policy('79000000-0000-4000-8000-000000000101') $$,'secure re-acceptance upgrades the legacy row');
select results_eq(
  $$ select accepted_version, accepted_at < '2099-01-01'::timestamptz from public.policy_acceptances $$,
  $$ values(3, true) $$,
  'secure re-acceptance replaces forged version and time with authoritative values'
);
select is((select count(*) from public.policy_acceptances),1::bigint,'Member sees exactly one trusted personal acceptance after re-accepting');

select set_config('request.jwt.claims','{"sub":"79000000-0000-4000-8000-000000000001","email":"trusted-owner@example.test","role":"authenticated"}',true);
select is((select count(*) from public.policy_acceptances),1::bigint,'operator reporting includes the securely upgraded acceptance');

select * from finish();
rollback;
