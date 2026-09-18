begin;
set local session_replication_role = replica;
delete from public.audit_events where organisation_id in (
  '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102'
);
delete from public.github_installations where organisation_id in (
  '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102'
);
delete from public.memberships where organisation_id in (
  '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102'
);
delete from public.asset_categories where organisation_id in ('77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102');
delete from public.risk_categories where organisation_id in ('77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102');
delete from public.organisations where id in (
  '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102'
);
delete from public.profiles where id::text like '77000000-0000-0000-0000-00000000000%';
delete from auth.users where id::text like '77000000-0000-0000-0000-00000000000%';
commit;
select no_plan();

begin;
insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) values
 ('77000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-owner@example.test','',now(),'{}','{}'),
 ('77000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-admin@example.test','',now(),'{}','{}'),
 ('77000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-member@example.test','',now(),'{}','{}'),
 ('77000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','discovery-other-owner@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
 ('77000000-0000-0000-0000-000000000101','Discovery Boundary A','discovery-boundary-a','77000000-0000-0000-0000-000000000001'),
 ('77000000-0000-0000-0000-000000000102','Discovery Boundary B','discovery-boundary-b','77000000-0000-0000-0000-000000000004');
insert into public.memberships(organisation_id,user_id,role) values
 ('77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000001','owner'),
 ('77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000002','admin'),
 ('77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000003','member'),
 ('77000000-0000-0000-0000-000000000102','77000000-0000-0000-0000-000000000004','owner'),
 ('77000000-0000-0000-0000-000000000102','77000000-0000-0000-0000-000000000001','member');
commit;

set role service_role;
select lives_ok(
  $$ with inventory as (
       select pg_catalog.jsonb_agg(
         pg_catalog.jsonb_build_object(
           'id', n,
           'owner', 'Owner-Co',
           'name', 'repo-' || n::text,
           'fullName', 'Owner-Co/repo-' || n::text,
           'htmlUrl', 'https://github.com/Owner-Co/repo-' || n::text,
           'visibility', 'private',
           'archived', false,
           'defaultBranch', 'main'
         )
         order by n
       ) as repos
       from pg_catalog.generate_series(1, 101) as n
     )
     select public.claim_github_installation_server(
       '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000001',
       77101,77201,'Owner-Co','Organization','selected','{"metadata":"read"}'::jsonb,true,
       (select repos from inventory)
     ) $$,
  'an Owner may claim a 101-repository discovered inventory'
);
select is(
  (select pg_catalog.count(*) from public.github_repositories where organisation_id='77000000-0000-0000-0000-000000000101' and available),
  101::bigint,
  'all 101 discovered repositories are stored available'
);
select throws_ok(
  $$ with inventory as (
       select pg_catalog.jsonb_agg(
         pg_catalog.jsonb_build_object(
           'id', n,
           'owner', 'Owner-Co',
           'name', 'repo-' || n::text,
           'fullName', 'Owner-Co/repo-' || n::text,
           'htmlUrl', 'https://github.com/Owner-Co/repo-' || n::text,
           'visibility', 'private',
           'archived', false,
           'defaultBranch', 'main'
         )
       ) as repos
       from pg_catalog.generate_series(1, 10001) as n
     )
     select public.claim_github_installation_server(
       '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000001',
       77102,77202,'Owner-Co','Organization','selected','{"metadata":"read"}'::jsonb,true,
       (select repos from inventory)
     ) $$,
  '23514','a verified GitHub installation claim may contain at most 10000 repositories',
  'a 10,001-repository inventory is rejected at the discovery bound'
);
select throws_ok(
  $$ with inventory as (
       select pg_catalog.jsonb_agg(
         pg_catalog.jsonb_build_object(
           'id', case when n <= 100 then n else 1 end,
           'owner', 'Owner-Co',
           'name', 'repo-' || n::text,
           'fullName', 'Owner-Co/repo-' || n::text,
           'htmlUrl', 'https://github.com/Owner-Co/repo-' || n::text,
           'visibility', 'private',
           'archived', false,
           'defaultBranch', 'main'
         )
       ) as repos
       from pg_catalog.generate_series(1, 101) as n
     )
     select public.claim_github_installation_server(
       '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000001',
       77103,77203,'Owner-Co','Organization','selected','{"metadata":"read"}'::jsonb,true,
       (select repos from inventory)
     ) $$,
  '22023','GitHub repository inventory contains duplicate provider ids',
  'a duplicate provider id fails the complete claim'
);
select is(
  (select pg_catalog.count(*) from public.github_installations where provider_installation_id in (77102,77103)),
  0::bigint,
  'rejected claims persist no installation row'
);
select is(
  (select pg_catalog.count(*) from public.github_repositories
   where organisation_id='77000000-0000-0000-0000-000000000101' and available),
  101::bigint,
  'rejected claims persist no repository rows'
);
select lives_ok(
  $$ with inventory as (
       select pg_catalog.jsonb_agg(
         pg_catalog.jsonb_build_object(
           'id', 7710400 + n,
           'owner', 'Owner-Co',
           'name', 'kept-' || n::text,
           'fullName', 'Owner-Co/kept-' || n::text,
           'htmlUrl', 'https://github.com/Owner-Co/kept-' || n::text,
           'visibility', 'private',
           'archived', false,
           'defaultBranch', 'main'
         )
         order by n
       ) as repos
       from pg_catalog.generate_series(1, 3) as n
     )
     select public.claim_github_installation_server(
       '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000001',
       77104,77204,'Owner-Co','Organization','selected','{"metadata":"read"}'::jsonb,true,
       (select repos from inventory)
     ) $$,
  'an Owner may claim a small discovered inventory'
);
select lives_ok(
  $$ with inventory as (
       select pg_catalog.jsonb_agg(
         pg_catalog.jsonb_build_object(
           'id', 7710400 + n,
           'owner', 'Owner-Co',
           'name', 'kept-' || n::text,
           'fullName', 'Owner-Co/kept-' || n::text,
           'htmlUrl', 'https://github.com/Owner-Co/kept-' || n::text,
           'visibility', 'private',
           'archived', false,
           'defaultBranch', 'main'
         )
         order by n
       ) as repos
       from pg_catalog.generate_series(1, 2) as n
     )
     select public.claim_github_installation_server(
       '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000001',
       77104,77204,'Owner-Co','Organization','selected','{"metadata":"read"}'::jsonb,true,
       (select repos from inventory)
     ) $$,
  'a later claim may narrow the discovered inventory'
);
select is(
  (select available from public.github_repositories where provider_repository_id=7710403
   and organisation_id='77000000-0000-0000-0000-000000000101'),
  false,
  'a repository missing from the latest inventory is preserved as unavailable'
);
select ok(
  (select removed_at is not null from public.github_repositories where provider_repository_id=7710403
   and organisation_id='77000000-0000-0000-0000-000000000101'),
  'an unavailable repository keeps its removal timestamp'
);
select lives_ok(
  $$ with inventory as (
       select pg_catalog.jsonb_agg(
         pg_catalog.jsonb_build_object(
           'id', 7710400 + n,
           'owner', 'Owner-Co',
           'name', 'kept-' || n::text,
           'fullName', 'Owner-Co/kept-' || n::text,
           'htmlUrl', 'https://github.com/Owner-Co/kept-' || n::text,
           'visibility', 'private',
           'archived', false,
           'defaultBranch', 'main'
         )
         order by n
       ) as repos
       from pg_catalog.generate_series(1, 3) as n
     )
     select public.claim_github_installation_server(
       '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000001',
       77104,77204,'Owner-Co','Organization','selected','{"metadata":"read"}'::jsonb,true,
       (select repos from inventory)
     ) $$,
  'a restored repository rejoins the discovered inventory'
);
select is(
  (select pg_catalog.count(*) from public.github_repositories
   where organisation_id='77000000-0000-0000-0000-000000000101' and available),
  104::bigint,
  'restored inventories leave the stored available set exact'
);
select throws_ok(
  $$ with inventory as (
       select pg_catalog.jsonb_agg(
         pg_catalog.jsonb_build_object(
           'id', 7710500 + n,
           'owner', 'Owner-Co',
           'name', 'admin-' || n::text,
           'fullName', 'Owner-Co/admin-' || n::text,
           'htmlUrl', 'https://github.com/Owner-Co/admin-' || n::text,
           'visibility', 'private',
           'archived', false,
           'defaultBranch', 'main'
         )
       ) as repos
       from pg_catalog.generate_series(1, 2) as n
     )
     select public.claim_github_installation_server(
       '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000002',
       77105,77205,'Owner-Co','Organization','selected','{"metadata":"read"}'::jsonb,true,
       (select repos from inventory)
     ) $$,
  '42501','GitHub installation claim requires a current workspace Owner',
  'an Admin cannot claim a discovered inventory'
);
select throws_ok(
  $$ with inventory as (
       select pg_catalog.jsonb_agg(
         pg_catalog.jsonb_build_object(
           'id', 7710600 + n,
           'owner', 'Owner-Co',
           'name', 'member-' || n::text,
           'fullName', 'Owner-Co/member-' || n::text,
           'htmlUrl', 'https://github.com/Owner-Co/member-' || n::text,
           'visibility', 'private',
           'archived', false,
           'defaultBranch', 'main'
         )
       ) as repos
       from pg_catalog.generate_series(1, 2) as n
     )
     select public.claim_github_installation_server(
       '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000003',
       77106,77206,'Owner-Co','Organization','selected','{"metadata":"read"}'::jsonb,true,
       (select repos from inventory)
     ) $$,
  '42501','GitHub installation claim requires a current workspace Owner',
  'a Member cannot claim a discovered inventory'
);
select lives_ok(
  $$ with inventory as (
       select pg_catalog.jsonb_agg(
         pg_catalog.jsonb_build_object(
           'id', 7710700 + n,
           'owner', 'Other-Co',
           'name', 'other-' || n::text,
           'fullName', 'Other-Co/other-' || n::text,
           'htmlUrl', 'https://github.com/Other-Co/other-' || n::text,
           'visibility', 'private',
           'archived', false,
           'defaultBranch', 'main'
         )
         order by n
       ) as repos
       from pg_catalog.generate_series(1, 2) as n
     )
     select public.claim_github_installation_server(
       '77000000-0000-0000-0000-000000000102','77000000-0000-0000-0000-000000000004',
       77107,77207,'Other-Co','Organization','selected','{"metadata":"read"}'::jsonb,true,
       (select repos from inventory)
     ) $$,
  'another workspace may claim its own installation'
);
select is(
  (select pg_catalog.count(*) from public.github_repositories
   where organisation_id='77000000-0000-0000-0000-000000000101' and available),
  104::bigint,
  'a second workspace claim leaves the first workspace inventory untouched'
);
reset role;

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.audit_events where organisation_id in (
  '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102'
);
delete from public.github_installations where organisation_id in (
  '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102'
);
delete from public.memberships where organisation_id in (
  '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102'
);
delete from public.asset_categories where organisation_id in ('77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102');
delete from public.risk_categories where organisation_id in ('77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102');
delete from public.organisations where id in (
  '77000000-0000-0000-0000-000000000101','77000000-0000-0000-0000-000000000102'
);
delete from public.profiles where id::text like '77000000-0000-0000-0000-00000000000%';
delete from auth.users where id::text like '77000000-0000-0000-0000-00000000000%';
commit;
