begin;
set local session_replication_role = replica;
delete from public.audit_events where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.github_installations where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.memberships where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.asset_categories where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.risk_categories where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.organisations where id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.profiles where id::text like '10200000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '10200000-0000-4000-8000-00000000000%';
commit;

select no_plan();

select ok(
  pg_catalog.pg_get_functiondef(
    'public.claim_github_installation_server(uuid,uuid,bigint,bigint,text,text,text,jsonb,boolean,jsonb)'::pg_catalog.regprocedure
  ) ~* 'jsonb_array_elements[(]target_repositories[)][[:space:][:print:]]+order by [(]value ->> ''id''[)]::bigint',
  'repository persistence has a stable provider-id order'
);

begin;
insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) values
 ('10200000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','complete-owner@example.test','',now(),'{}','{}'),
 ('10200000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','complete-admin@example.test','',now(),'{}','{}'),
 ('10200000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','complete-other-owner@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
 ('10200000-0000-4000-8000-000000000101','Complete Discovery A','complete-discovery-a','10200000-0000-4000-8000-000000000001'),
 ('10200000-0000-4000-8000-000000000102','Complete Discovery B','complete-discovery-b','10200000-0000-4000-8000-000000000003');
insert into public.memberships(organisation_id,user_id,role) values
 ('10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000001','owner'),
 ('10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000002','admin'),
 ('10200000-0000-4000-8000-000000000102','10200000-0000-4000-8000-000000000003','owner');
commit;

set role service_role;

select lives_ok(
  $$ select public.claim_github_installation_server(
       '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000001',
       10201,10211,'Owner-Co','Organization','selected',
       '{"metadata":"read","administration":"read","actions":"read","vulnerability_alerts":"read","security_events":"read","secret_scanning_alerts":"read"}'::jsonb,
       true,
       '[{"id":102001,"owner":"Owner-Co","name":"repo-102001","fullName":"Owner-Co/repo-102001","htmlUrl":"https://github.com/Owner-Co/repo-102001","visibility":"private","archived":false,"defaultBranch":"main"},{"id":102999,"owner":"Owner-Co","name":"historical","fullName":"Owner-Co/historical","htmlUrl":"https://github.com/Owner-Co/historical","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
     ) $$,
  'an Owner may establish the initial authorised repository history'
);

select lives_ok(
  pg_catalog.format(
    $claim$ select public.claim_github_installation_server(
      '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000001',
      10201,10211,'Owner-Co','Organization','selected',
      '{"metadata":"read","administration":"read","actions":"read","vulnerability_alerts":"read","security_events":"read","secret_scanning_alerts":"read"}'::jsonb,
      true,%L::jsonb
    ) $claim$,
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id',102000 + item,
          'owner','Owner-Co',
          'name','repo-' || (102000 + item)::text,
          'fullName','Owner-Co/repo-' || (102000 + item)::text,
          'htmlUrl','https://github.com/Owner-Co/repo-' || (102000 + item)::text,
          'visibility','private',
          'archived',false,
          'defaultBranch','main'
        )
        order by item desc
      )::text
      from pg_catalog.generate_series(1,101) item
    )
  ),
  'one atomic claim accepts all 101 authorised repositories'
);

select is(
  (
    select pg_catalog.count(*)::integer
    from public.github_repositories repository
    join public.github_installations installation on installation.id = repository.installation_id
    where installation.provider_installation_id = 10201
  ),
  102,
  'the full 101-row inventory is stored while one historical row is preserved'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.github_repositories repository
    join public.github_installations installation on installation.id = repository.installation_id
    where installation.provider_installation_id = 10201
      and repository.available
  ),
  101,
  'all 101 currently authorised repositories are available'
);
select ok(
  (
    select not available and removed_at is not null
    from public.github_repositories repository
    join public.github_installations installation on installation.id = repository.installation_id
    where installation.provider_installation_id = 10201
      and repository.provider_repository_id = 102999
  ),
  'a repository absent from the complete inventory remains as unavailable history'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.github_repositories repository
    join public.github_installations installation on installation.id = repository.installation_id
    where installation.provider_installation_id = 10201
      and repository.available
      and repository.selected
  ),
  0,
  'provider-authorised availability does not select repositories or claim compliance health'
);
reset role;
select ok(
  (
    select pg_catalog.count(*) > 0
      and pg_catalog.bool_and(actor_id = '10200000-0000-4000-8000-000000000001'::uuid)
    from public.audit_events
    where organisation_id = '10200000-0000-4000-8000-000000000101'
      and entity_type in ('github_installations','github_repositories')
  ),
  'installation and repository inventory audits retain the verified Owner actor'
);
set role service_role;

select throws_ok(
  pg_catalog.format(
    $claim$ select public.claim_github_installation_server(
      '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000001',
      10202,10212,'Owner-Co','Organization','selected','{}'::jsonb,true,%L::jsonb
    ) $claim$,
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id',202000 + item,
          'owner',case when item = 101 then 'Other-Owner' else 'Owner-Co' end,
          'name','repo-' || (202000 + item)::text,
          'fullName',(case when item = 101 then 'Other-Owner' else 'Owner-Co' end) || '/repo-' || (202000 + item)::text,
          'htmlUrl','https://github.com/' || (case when item = 101 then 'Other-Owner' else 'Owner-Co' end) || '/repo-' || (202000 + item)::text,
          'visibility','private',
          'archived',false,
          'defaultBranch','main'
        )
        order by item
      )::text
      from pg_catalog.generate_series(1,101) item
    )
  ),
  '22023','invalid canonical GitHub repository inventory',
  'one malformed ownership entry rejects the whole 101-row claim'
);
select is(
  (select pg_catalog.count(*)::integer from public.github_installations where provider_installation_id = 10202),
  0,
  'a rejected inventory leaves no partial installation mutation'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.github_repositories repository
    join public.github_installations installation on installation.id = repository.installation_id
    where installation.provider_installation_id = 10202
  ),
  0,
  'a rejected inventory leaves no partial repository mutation'
);

select throws_ok(
  pg_catalog.format(
    $claim$ select public.claim_github_installation_server(
      '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000001',
      10205,10215,'Owner-Co','Organization','selected','{}'::jsonb,true,%L::jsonb
    ) $claim$,
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id',302000 + item,
          'owner','Owner-Co',
          'name','repo-' || (302000 + item)::text,
          'fullName','Owner-Co/repo-' || (302000 + item)::text,
          'htmlUrl','https://github.com/Owner-Co/repo-' || (302000 + item)::text,
          'visibility','private',
          'archived',false,
          'defaultBranch','main'
        )
      )::text
      from pg_catalog.generate_series(1,10001) item
    )
  ),
  '23514','a verified GitHub installation claim may contain at most 10000 repositories',
  'the atomic claim rejects an inventory above the complete-discovery bound'
);

select lives_ok(
  $$ select public.claim_github_installation_server(
       '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000001',
       10203,10213,'Owner-Co','Organization','selected','{}'::jsonb,true,
       '[{"id":102001,"owner":"Owner-Co","name":"shared-identity","fullName":"Owner-Co/shared-identity","htmlUrl":"https://github.com/Owner-Co/shared-identity","visibility":"private","archived":false,"defaultBranch":"main"}]'::jsonb
     ) $$,
  'the same provider repository identity may belong to a separate installation inventory'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.github_repositories repository
    join public.github_installations installation on installation.id = repository.installation_id
    where repository.provider_repository_id = 102001
      and installation.provider_installation_id in (10201,10203)
      and repository.organisation_id = installation.organisation_id
  ),
  2,
  'repository identities remain independently scoped to their own installation ancestry'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.github_repositories repository
    left join public.github_installations installation
      on installation.id = repository.installation_id
     and installation.organisation_id = repository.organisation_id
    where installation.id is null
      and repository.organisation_id in (
        '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
      )
  ),
  0,
  'stored repositories cannot cross installation or workspace ancestry'
);

select throws_ok(
  $$ select public.claim_github_installation_server(
       '10200000-0000-4000-8000-000000000102','10200000-0000-4000-8000-000000000003',
       10201,10221,'Owner-B','Organization','selected','{}'::jsonb,true,'[]'::jsonb
     ) $$,
  '42501','GitHub installation is already claimed by another workspace',
  'an Owner cannot move an installation or its repositories across workspaces'
);
select is(
  (select organisation_id from public.github_installations where provider_installation_id = 10201),
  '10200000-0000-4000-8000-000000000101'::uuid,
  'the rejected cross-workspace claim preserves the original workspace binding'
);
select throws_ok(
  $$ select public.claim_github_installation_server(
       '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000002',
       10204,10214,'Owner-Co','Organization','selected','{}'::jsonb,true,'[]'::jsonb
     ) $$,
  '42501','GitHub installation claim requires a current workspace Owner',
  'an Admin cannot claim the complete authorised inventory'
);

reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"10200000-0000-4000-8000-000000000001","role":"authenticated"}',
  false
);
select is(
  (select pg_catalog.count(*)::integer from public.github_repositories),
  103,
  'the Owner reads only repository inventory from their workspace through RLS'
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"10200000-0000-4000-8000-000000000003","role":"authenticated"}',
  false
);
select is(
  (select pg_catalog.count(*)::integer from public.github_repositories),
  0,
  'another workspace Owner cannot read the first workspace repository inventory'
);
reset role;

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.audit_events where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.github_installations where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.memberships where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.asset_categories where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.risk_categories where organisation_id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.organisations where id in (
  '10200000-0000-4000-8000-000000000101','10200000-0000-4000-8000-000000000102'
);
delete from public.profiles where id::text like '10200000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '10200000-0000-4000-8000-00000000000%';
commit;
