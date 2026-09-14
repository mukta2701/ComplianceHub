create extension if not exists dblink with schema extensions;

begin;
set local session_replication_role = replica;
delete from public.audit_events where organisation_id in (
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102'
);
delete from public.github_installations where organisation_id in (
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102'
);
delete from public.memberships where organisation_id in (
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102'
);
delete from public.asset_categories where organisation_id in ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102');
delete from public.risk_categories where organisation_id in ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102');
delete from public.organisations where id in (
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102'
);
delete from public.profiles where id::text like '76000000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '76000000-0000-4000-8000-00000000000%';
commit;
select no_plan();

select has_function(
  'public','claim_github_installation_server',
  array['uuid','uuid','bigint','bigint','text','text','text','jsonb','boolean','jsonb'],
  'the verified installation claim retains its reviewed signature'
);
select ok(
  has_function_privilege('service_role','public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)','EXECUTE'),
  'service_role retains the only installation-claim capability'
);
select ok(
  not has_function_privilege('authenticated','public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)','EXECUTE'),
  'authenticated callers cannot invoke the installation claim directly'
);
select ok(
  not has_function_privilege('anon','public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)','EXECUTE'),
  'anonymous callers cannot invoke the installation claim'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(procedure.proacl) privilege
    where procedure.oid='public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)'::pg_catalog.regprocedure
      and privilege.grantee=0 and privilege.privilege_type='EXECUTE'
  ),
  'PUBLIC cannot invoke the installation claim'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid='public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)'::pg_catalog.regprocedure),
  'claim remains a deliberate security-definer boundary'
);
select ok(
  (select proconfig @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)'::pg_catalog.regprocedure),
  'claim retains an empty search path'
);
select cmp_ok(
  (select pg_catalog.count(*) from pg_catalog.regexp_matches(
    pg_catalog.pg_get_functiondef('public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)'::pg_catalog.regprocedure),
    'membership[.]role = ''owner''','g'
  )),
  '>=',2::bigint,
  'claim validates exact Owner authority before and after installation locking'
);
select ok(
  pg_catalog.pg_get_functiondef('public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)'::pg_catalog.regprocedure)
    ~* 'membership[.]role = ''owner''[[:space:][:print:]]+for update[[:space:][:print:]]+from public[.]github_installations[[:space:][:print:]]+for update[[:space:][:print:]]+membership[.]role = ''owner''',
  'claim locks the exact Owner membership before the installation and revalidates after it'
);

begin;
insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) values
 ('76000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','claim-owner@example.test','',now(),'{}','{}'),
 ('76000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','claim-admin@example.test','',now(),'{}','{}'),
 ('76000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','claim-member@example.test','',now(),'{}','{}'),
 ('76000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','claim-other-owner@example.test','',now(),'{}','{}'),
 ('76000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','claim-outsider@example.test','',now(),'{}','{}'),
 ('76000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','claim-backup-owner@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
 ('76000000-0000-4000-8000-000000000101','Claim Boundary A','claim-boundary-a','76000000-0000-4000-8000-000000000001'),
 ('76000000-0000-4000-8000-000000000102','Claim Boundary B','claim-boundary-b','76000000-0000-4000-8000-000000000004');
insert into public.memberships(organisation_id,user_id,role) values
 ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001','owner'),
 ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000002','admin'),
 ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000003','member'),
 ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000006','owner'),
 ('76000000-0000-4000-8000-000000000102','76000000-0000-4000-8000-000000000004','owner'),
 ('76000000-0000-4000-8000-000000000102','76000000-0000-4000-8000-000000000001','member');
commit;

set role service_role;
select lives_ok(
  $$ select public.claim_github_installation_server(
       '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001',
       76101,76201,'Owner-Co','Organization','selected','{"contents":"read"}'::jsonb,true,'[]'::jsonb
     ) $$,
  'a current exact Owner may claim a verified installation'
);
select throws_ok(
  $$ select public.claim_github_installation_server(
       '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000002',
       76102,76202,'Admin-Co','Organization','selected','{"contents":"read"}'::jsonb,true,'[]'::jsonb
     ) $$,
  '42501','GitHub installation claim requires a current workspace Owner',
  'an Admin cannot claim a verified installation'
);
select throws_ok(
  $$ select public.claim_github_installation_server(
       '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000003',
       76103,76203,'Member-Co','Organization','selected','{"contents":"read"}'::jsonb,true,'[]'::jsonb
     ) $$,
  '42501','GitHub installation claim requires a current workspace Owner',
  'a Member cannot claim a verified installation'
);
select throws_ok(
  $$ select public.claim_github_installation_server(
       '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000005',
       76104,76204,'Outsider-Co','Organization','selected','{"contents":"read"}'::jsonb,true,'[]'::jsonb
     ) $$,
  '42501','GitHub installation claim requires a current workspace Owner',
  'an outsider cannot claim a verified installation'
);
select throws_ok(
  $$ select public.claim_github_installation_server(
       '76000000-0000-4000-8000-000000000102','76000000-0000-4000-8000-000000000001',
       76105,76205,'Cross-Co','Organization','selected','{"contents":"read"}'::jsonb,true,'[]'::jsonb
     ) $$,
  '42501','GitHub installation claim requires a current workspace Owner',
  'an Owner of another workspace cannot use a cross-workspace Member role to claim'
);
reset role;

select extensions.dblink_connect('claim_owner','host='||pg_catalog.host(pg_catalog.inet_server_addr())||' port='||pg_catalog.inet_server_port()::text||' dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_connect('claim_demote','host='||pg_catalog.host(pg_catalog.inet_server_addr())||' port='||pg_catalog.inet_server_port()::text||' dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_exec('claim_owner','set role service_role');
select extensions.dblink_send_query('claim_owner',$remote$
  with claimed as (
    select public.claim_github_installation_server(
      '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001',
      76101,76201,'Owner-Co-Race','Organization','selected','{"contents":"read"}'::jsonb,true,'[]'::jsonb
    ) as installation_id
  )
  select claimed.installation_id is not null
  from claimed
  cross join lateral (
    select pg_catalog.pg_sleep(0.5 + case when claimed.installation_id is not null then 0 else 0 end)
  ) hold(waited)
  where hold.waited is null
$remote$);
select pg_catalog.pg_sleep(0.1);
select extensions.dblink_send_query('claim_demote',$remote$
  update public.memberships
  set role='admin'
  where organisation_id='76000000-0000-4000-8000-000000000101'
    and user_id='76000000-0000-4000-8000-000000000001'
  returning role::text
$remote$);
select pg_catalog.pg_sleep(0.1);
select is(
  extensions.dblink_is_busy('claim_demote'),1,
  'Owner demotion waits while installation claim holds the exact membership row'
);
select ok(
  claimed,
  'the installation claim commits while its exact actor remains a locked current Owner'
) from extensions.dblink_get_result('claim_owner') as result(claimed boolean);
select is(
  changed_role,'admin',
  'legal Owner demotion completes only after the verified claim commits'
) from extensions.dblink_get_result('claim_demote') as demotion(changed_role text);
select extensions.dblink_disconnect('claim_owner');
select extensions.dblink_disconnect('claim_demote');
select is(
  (select account_login from public.github_installations where provider_installation_id=76101),
  'Owner-Co-Race',
  'the claimed installation mutation commits before Owner demotion'
);
update public.memberships
set role='owner'
where organisation_id='76000000-0000-4000-8000-000000000101'
  and user_id='76000000-0000-4000-8000-000000000001';

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.audit_events where organisation_id in (
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102'
);
delete from public.github_installations where organisation_id in (
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102'
);
delete from public.memberships where organisation_id in (
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102'
);
delete from public.asset_categories where organisation_id in ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102');
delete from public.risk_categories where organisation_id in ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102');
delete from public.organisations where id in (
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000102'
);
delete from public.profiles where id::text like '76000000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '76000000-0000-4000-8000-00000000000%';
commit;
