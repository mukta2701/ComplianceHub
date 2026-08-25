-- Independent fixture coverage for immutable official GitHub results and the
-- caller-scoped MCP read. Every fixture is transaction-local and deterministic.
-- The committed-fixture, two-session wrapper race is exercised by 070; this
-- suite keeps the wrapper's conflict/rollback prerequisites independently visible.
begin;

select plan(78);

select has_table('public','github_official_compliance_results','official fixture: immutable ledger table exists');
select col_is_unique('public','github_official_compliance_results',array['observation_id'],'official fixture: observation identity is globally exact-once');
select has_fk('public','github_official_compliance_results','github_official_results_repository_fk','official fixture: repository ancestry uses a composite foreign key');
select has_fk('public','github_official_compliance_results','github_official_results_run_fk','official fixture: collection-run ancestry uses a composite foreign key');
select has_fk('public','github_official_compliance_results','github_official_results_observation_fk','official fixture: observation ancestry uses a composite foreign key');
select has_fk('public','github_official_compliance_results','github_official_results_approval_fk','official fixture: approval ancestry uses a composite foreign key');
select has_fk('public','github_official_compliance_results','github_official_results_pack_fk','official fixture: mapping-pack identity includes version and checksum');
select has_fk('public','github_official_compliance_results','github_official_results_evidence_fk','official fixture: evidence ancestry is tenant scoped');
select has_fk('public','github_official_compliance_results','github_official_results_finding_fk','official fixture: finding ancestry is tenant scoped');
select has_trigger('public','github_official_compliance_results','github_official_results_immutable','official fixture: immutable update-delete trigger is installed');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='public.github_official_compliance_results'::regclass),'official fixture: ledger enforces row-level security');
select policies_are('public','github_official_compliance_results',array['github_official_compliance_results_member_read'],'official fixture: member read is the only ledger policy');
select has_function('public','get_mcp_github_compliance_results_v1',array['uuid','uuid','public.github_observation_result','text','text','public.monitor_severity','integer'],'official fixture: versioned MCP read exists');
select is((select prosecdef from pg_catalog.pg_proc where oid='public.get_mcp_github_compliance_results_v1(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer)'::pg_catalog.regprocedure),false,'official fixture: MCP read is security invoker');
select is((select provolatile::text from pg_catalog.pg_proc where oid='public.get_mcp_github_compliance_results_v1(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer)'::pg_catalog.regprocedure),'s','official fixture: MCP read is stable');
select ok((select proconfig @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.get_mcp_github_compliance_results_v1(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer)'::pg_catalog.regprocedure),'official fixture: MCP read pins an empty search path');
select ok(has_function_privilege('authenticated','public.get_mcp_github_compliance_results_v1(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer)','EXECUTE'),'official fixture: authenticated callers enter the RLS-scoped read');
select ok(not has_function_privilege('anon','public.get_mcp_github_compliance_results_v1(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer)','EXECUTE'),'official fixture: anonymous callers cannot execute the MCP read');
select ok(not has_function_privilege('service_role','public.get_mcp_github_compliance_results_v1(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer)','EXECUTE'),'official fixture: service role has no MCP read bypass');
select ok(has_function_privilege('service_role','public.materialise_github_observations_server(uuid,uuid,text,text,jsonb)','EXECUTE'),'official fixture: wrapper is service executable');
select ok(not has_function_privilege('authenticated','public.materialise_github_observations_server(uuid,uuid,text,text,jsonb)','EXECUTE'),'official fixture: wrapper rejects authenticated callers');
select ok(not has_function_privilege('anon','public.materialise_github_observations_server(uuid,uuid,text,text,jsonb)','EXECUTE'),'official fixture: wrapper rejects anonymous callers');
select ok(not has_function_privilege('service_role','public.materialise_github_observations_task2_server(uuid,uuid,text,text,jsonb)','EXECUTE'),'official fixture: service role cannot bypass wrapper through inner materialiser');
select ok(not has_function_privilege('authenticated','public.materialise_github_observations_task2_server(uuid,uuid,text,text,jsonb)','EXECUTE'),'official fixture: authenticated callers cannot execute inner materialiser');
select ok(not has_table_privilege('service_role','public.github_official_compliance_results','INSERT,UPDATE,DELETE'),'official fixture: service clients cannot write ledger directly');
select ok(not has_table_privilege('authenticated','public.github_official_compliance_results','INSERT,UPDATE,DELETE'),'official fixture: authenticated clients cannot write ledger directly');
select ok((select pg_catalog.pg_get_functiondef('public.materialise_github_observations_server(uuid,uuid,text,text,jsonb)'::regprocedure) ~* 'on conflict \(observation_id\) do nothing'),'official fixture: wrapper contains the observation replay conflict prerequisite');
select ok((select pg_catalog.pg_get_functiondef('public.materialise_github_observations_server(uuid,uuid,text,text,jsonb)'::regprocedure) ~ 'inserted_count not in \(0, expected_count\)'),'official fixture: wrapper rejects partial ledger insertion counts');
select ok((select pg_catalog.pg_get_functiondef('public.materialise_github_observations_server(uuid,uuid,text,text,jsonb)'::regprocedure) ~ 'ledger_count <> expected_count'),'official fixture: wrapper verifies complete run ledger');

create or replace function pg_temp.official_decision(target_observation_id uuid, target_kind text)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'observation_id',target_observation_id,
    'treatment_kind',target_kind,
    'iso_control_references',pg_catalog.to_jsonb(array['A.8.32']::text[]),
    'failure_severity','medium',
    'remediation','Dismiss stale approvals when new commits are pushed.'
  ));
$$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('75000000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','official-owner@example.test','',now(),'{}','{}'),
 ('75000000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','official-admin@example.test','',now(),'{}','{}'),
 ('75000000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','official-member@example.test','',now(),'{}','{}'),
 ('75000000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','official-outsider@example.test','',now(),'{}','{}');

insert into public.organisations(id,name,slug,created_by) values
 ('75000000-0000-4000-8000-000000000001','Official Result Workspace A','official-result-workspace-a','75000000-0000-4000-8000-000000000011'),
 ('75000000-0000-4000-8000-000000000002','Official Result Workspace B','official-result-workspace-b','75000000-0000-4000-8000-000000000014');
insert into public.memberships(organisation_id,user_id,role) values
 ('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000011','owner'),
 ('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000012','admin'),
 ('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000013','member'),
 ('75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000014','owner');

insert into public.github_installations(
 id,organisation_id,provider_installation_id,account_id,account_login,account_type,
 repository_selection,status,connected_by,permissions,permissions_ok
) values
 ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',75101,75201,'Fixture-A','Organization','selected','active','75000000-0000-4000-8000-000000000011','{"metadata":"read"}',true),
 ('75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000001',75102,75201,'Fixture-A','Organization','selected','active','75000000-0000-4000-8000-000000000011','{"metadata":"read"}',true),
 ('75000000-0000-4000-8000-000000000103','75000000-0000-4000-8000-000000000002',75103,75202,'Fixture-B','Organization','selected','active','75000000-0000-4000-8000-000000000014','{"metadata":"read"}',true);

insert into public.github_repositories(
 id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
 html_url,visibility,default_branch,archived,selected,available
) values
 ('75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75301,'Provider-A','primary','Provider-A/primary','https://github.com/Provider-A/primary','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000202','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75302,'Provider-A','stale','Provider-A/stale','https://github.com/Provider-A/stale','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000203','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75303,'Provider-A','evidence','Provider-A/evidence','https://github.com/Provider-A/evidence','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000204','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75304,'Provider-A','finding','Provider-A/finding','https://github.com/Provider-A/finding','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000205','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75305,'Provider-A','mapping','Provider-A/mapping','https://github.com/Provider-A/mapping','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000206','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75306,'Provider-A','order-a','Provider-A/order-a','https://github.com/Provider-A/order-a','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000207','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75307,'Provider-A','order-b','Provider-A/order-b','https://github.com/Provider-A/order-b','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000208','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75308,'Provider-A','old-binding','Provider-A/old-binding','https://github.com/Provider-A/old-binding','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000209','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000102',75308,'Provider-A','new-binding','Provider-A/new-binding','https://github.com/Provider-A/new-binding','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000210','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75310,'Provider-A','equality','Provider-A/equality','https://github.com/Provider-A/equality','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000211','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75311,'Provider-A','terminal','Provider-A/terminal','https://github.com/Provider-A/terminal','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000212','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75312,'Provider-A','partial-ledger','Provider-A/partial-ledger','https://github.com/Provider-A/partial-ledger','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000213','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101',75313,'Provider-A','conflict-ledger','Provider-A/conflict-ledger','https://github.com/Provider-A/conflict-ledger','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000214','75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000103',75314,'Provider-B','private','Provider-B/private','https://github.com/Provider-B/private','private','main',false,true,true);

insert into public.github_mapping_approvals(id,organisation_id,mapping_pack_id,approved_by)
select '75000000-0000-4000-8000-000000000601','75000000-0000-4000-8000-000000000001',id,'75000000-0000-4000-8000-000000000011'
from public.github_mapping_packs where version='github-iso-27001-v1';
insert into public.github_mapping_approvals(id,organisation_id,mapping_pack_id,approved_by)
select '75000000-0000-4000-8000-000000000602','75000000-0000-4000-8000-000000000002',id,'75000000-0000-4000-8000-000000000014'
from public.github_mapping_packs where version='github-iso-27001-v1';

create or replace function pg_temp.seed_official_single(
  run_id uuid, observation_id uuid, organisation_id uuid, installation_id uuid,
  repository_id uuid, provider_repository_id bigint, run_status public.github_collection_status,
  observation_result public.github_observation_result, observed_at timestamptz, fresh_until timestamptz
) returns void language plpgsql as $$
declare run_diagnostic text; observation_diagnostic text;
begin
  run_diagnostic := case when run_status='failed' then 'provider_unavailable' when run_status='rate_limited' then 'rate_limited' else null end;
  observation_diagnostic := case when observation_result='unknown' then 'permission_denied' else null end;
  insert into public.github_collection_runs(
    id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
    status,diagnostic_code,started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,not_applicable_count
  ) values (
    run_id,organisation_id,installation_id,repository_id,provider_repository_id,'manual','fixture-'||run_id,
    run_status,run_diagnostic,observed_at-interval '1 hour',observed_at,1,
    case when observation_result='pass' then 1 else 0 end,
    case when observation_result='fail' then 1 else 0 end,
    case when observation_result='unknown' then 1 else 0 end,
    case when observation_result='not_applicable' then 1 else 0 end
  );
  insert into public.github_observations(
    id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
    observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
    remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
  ) values (
    observation_id,organisation_id,installation_id,repository_id,provider_repository_id,run_id,
    'fixture-'||observation_id,'github.branch.stale_approvals','github-repository-v1','github_repository','Provider fixture/'||repository_id,
    observation_result,case when observation_result='fail' then 'medium' else null end,
    'Provider-controlled fixture title','Provider-controlled fixture explanation',
    case when observation_result='fail' then 'Provider-controlled remediation' else null end,
    observed_at,fresh_until,'https://github.test/private/'||observation_id,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(observation_id::text,'UTF8'),'sha256'),'hex'),observation_diagnostic
  );
end;
$$;

select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000301','75000000-0000-4000-8000-000000000401','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201',75301,'succeeded','pass',now()-interval '6 hours',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000302','75000000-0000-4000-8000-000000000402','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201',75301,'succeeded','fail',now()-interval '5 hours',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000303','75000000-0000-4000-8000-000000000403','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201',75301,'partial','unknown',now()-interval '4 hours',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000304','75000000-0000-4000-8000-000000000404','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201',75301,'succeeded','not_applicable',now()-interval '3 hours',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000305','75000000-0000-4000-8000-000000000405','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000202',75302,'succeeded','pass',now()-interval '3 days',now()-interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000306','75000000-0000-4000-8000-000000000406','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000203',75303,'succeeded','pass',now()-interval '3 hours',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000307','75000000-0000-4000-8000-000000000407','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000203',75303,'succeeded','pass',now()-interval '2 hours',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000308','75000000-0000-4000-8000-000000000408','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000204',75304,'succeeded','fail',now()-interval '3 hours',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000309','75000000-0000-4000-8000-000000000409','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000204',75304,'succeeded','pass',now()-interval '2 hours',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000310','75000000-0000-4000-8000-000000000410','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000205',75305,'partial','unknown',now()-interval '30 minutes',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000311','75000000-0000-4000-8000-000000000411','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000206',75306,'partial','unknown',now()-interval '1 minute',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000312','75000000-0000-4000-8000-000000000412','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000207',75307,'partial','unknown',now()-interval '1 minute',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000313','75000000-0000-4000-8000-000000000413','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000208',75308,'succeeded','fail',now()-interval '5 minutes',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000314','75000000-0000-4000-8000-000000000414','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000209',75308,'succeeded','pass',now()-interval '4 minutes',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000315','75000000-0000-4000-8000-000000000415','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000210',75310,'partial','unknown',now()-interval '10 minutes',now());
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000316','75000000-0000-4000-8000-000000000416','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000211',75311,'failed','fail',now()-interval '1 hour',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000317','75000000-0000-4000-8000-000000000417','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000211',75311,'rate_limited','fail',now()-interval '50 minutes',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000319','75000000-0000-4000-8000-000000000420','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000213',75313,'succeeded','pass',now()-interval '1 hour',now()+interval '1 day');
select pg_temp.seed_official_single('75000000-0000-4000-8000-000000000320','75000000-0000-4000-8000-000000000421','75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000103','75000000-0000-4000-8000-000000000214',75314,'partial','unknown',now()-interval '30 minutes',now()+interval '1 day');

insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
 status,started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,not_applicable_count
) values ('75000000-0000-4000-8000-000000000318','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000212',75312,'manual','fixture-partial-ledger','succeeded',now()-interval '3 hours',now()-interval '2 hours',2,2,0,0,0);
insert into public.github_observations(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
 remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
) values
 ('75000000-0000-4000-8000-000000000418','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000212',75312,'75000000-0000-4000-8000-000000000318','partial-a','github.branch.stale_approvals','github-repository-v1','github_repository','Provider-A/partial-ledger','pass',null,'Provider partial A','Provider partial A explanation',null,now()-interval '2 hours',now()+interval '1 day','https://github.test/private/418',repeat('0',63)||'3',null),
 ('75000000-0000-4000-8000-000000000419','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000212',75312,'75000000-0000-4000-8000-000000000318','partial-b','github.branch.stale_approvals','github-repository-v1','github_repository','Provider-A/partial-ledger','pass',null,'Provider partial B','Provider partial B explanation',null,now()-interval '119 minutes',now()+interval '1 day','https://github.test/private/419',repeat('0',63)||'4',null);

-- Exercise all four outcomes through the real service-only wrapper.
set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000301','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000401','evidence'));
reset role;
select ok((select result.organisation_id='75000000-0000-4000-8000-000000000001' and result.installation_id='75000000-0000-4000-8000-000000000101' and result.repository_id='75000000-0000-4000-8000-000000000201' and result.provider_repository_id=75301 and result.collection_run_id='75000000-0000-4000-8000-000000000301' and result.observation_id='75000000-0000-4000-8000-000000000401' and result.approval_id='75000000-0000-4000-8000-000000000601' and pack.id=result.mapping_pack_id and result.mapping_version='github-iso-27001-v1' and result.mapping_checksum='b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f' and result.check_id='github.branch.stale_approvals' and result.rule_version='github-repository-v1' and result.outcome='pass' and result.failure_severity is null and result.catalogue_summary=entry.treatments #>> array['pass','summary'] and result.observed_at=now()-interval '6 hours' and result.fresh_until=now()+interval '1 day' and result.evidence_id=provenance.evidence_id and result.finding_id is null from public.github_official_compliance_results result join public.github_mapping_packs pack on pack.id=result.mapping_pack_id join public.github_mapping_entries entry on entry.mapping_pack_id=result.mapping_pack_id and entry.check_id=result.check_id and entry.rule_version=result.rule_version join public.github_evidence_provenance provenance on provenance.observation_id=result.observation_id where result.observation_id='75000000-0000-4000-8000-000000000401'),'official fixture: pass retains exact ancestry approved summary and evidence lineage');

set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000302','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000402','finding'));
reset role;
select ok((select result.outcome='fail' and result.failure_severity=entry.failure_severity and result.evidence_id is null and result.finding_id=transition.finding_id and result.catalogue_summary=entry.treatments #>> array['fail','summary'] and finding.status='open' from public.github_official_compliance_results result join public.github_mapping_entries entry on entry.mapping_pack_id=result.mapping_pack_id and entry.check_id=result.check_id and entry.rule_version=result.rule_version join public.github_finding_transitions transition on transition.observation_id=result.observation_id join public.monitoring_findings finding on finding.id=result.finding_id where result.observation_id='75000000-0000-4000-8000-000000000402'),'official fixture: fail retains approved severity summary and exact open finding lineage');

select set_config('app.official_evidence_before_explanatory',(select count(*)::text from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001'),true);
select set_config('app.official_findings_before_explanatory',(select count(*)::text from public.monitoring_findings where organisation_id='75000000-0000-4000-8000-000000000001'),true);
set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000303','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000403','explanatory'));
reset role;
select ok((select result.outcome='unknown' and result.failure_severity is null and result.evidence_id is null and result.finding_id is null from public.github_official_compliance_results result where result.observation_id='75000000-0000-4000-8000-000000000403') and (select count(*) from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_evidence_before_explanatory')::bigint and (select count(*) from public.monitoring_findings where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_findings_before_explanatory')::bigint and (select status='open' from public.monitoring_findings where id=(select finding_id from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000402')),'official fixture: unknown creates no evidence or finding and resolves nothing');

set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000304','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000404','explanatory'));
reset role;
select ok((select result.outcome='not_applicable' and result.failure_severity is null and result.evidence_id is null and result.finding_id is null from public.github_official_compliance_results result where result.observation_id='75000000-0000-4000-8000-000000000404') and (select count(*) from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_evidence_before_explanatory')::bigint and (select count(*) from public.monitoring_findings where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_findings_before_explanatory')::bigint and (select status='open' from public.monitoring_findings where id=(select finding_id from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000402')),'official fixture: not-applicable creates no evidence or finding and resolves nothing');
select results_eq($$ select outcome::text from public.github_official_compliance_results where observation_id in ('75000000-0000-4000-8000-000000000401','75000000-0000-4000-8000-000000000402','75000000-0000-4000-8000-000000000403','75000000-0000-4000-8000-000000000404') order by outcome::text $$,$$ values ('fail'::text),('not_applicable'::text),('pass'::text),('unknown'::text) $$,'official fixture: wrapper persists all four exact official outcomes');

select set_config('app.official_evidence_before_stale',(select count(*)::text from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001'),true);
set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000305','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000405','evidence'));
reset role;
select ok((select outcome='pass' and fresh_until<now() and evidence_id is null from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000405') and (select count(*) from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_evidence_before_stale')::bigint,'official fixture: stale pass remains official without positive evidence');

select set_config('app.official_rows_before_terminal',(select count(*)::text from public.github_official_compliance_results where organisation_id='75000000-0000-4000-8000-000000000001'),true);
select set_config('app.official_evidence_before_terminal',(select count(*)::text from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001'),true);
select set_config('app.official_evidence_provenance_before_terminal',(select count(*)::text from public.github_evidence_provenance where organisation_id='75000000-0000-4000-8000-000000000001'),true);
select set_config('app.official_findings_before_terminal',(select count(*)::text from public.monitoring_findings where organisation_id='75000000-0000-4000-8000-000000000001'),true);
select set_config('app.official_finding_provenance_before_terminal',(select count(*)::text from public.github_finding_provenance where organisation_id='75000000-0000-4000-8000-000000000001'),true);
select set_config('app.official_transitions_before_terminal',(select count(*)::text from public.github_finding_transitions where organisation_id='75000000-0000-4000-8000-000000000001'),true);
set role service_role;
select lives_ok($$ select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000316','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000416','finding')) $$,'official fixture: failed collection replay is a safe old no-op');
select lives_ok($$ select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000317','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000417','finding')) $$,'official fixture: rate-limited collection replay is a safe old no-op');
reset role;
select ok(
  (select count(*) from public.github_official_compliance_results where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_rows_before_terminal')::bigint
  and (select count(*) from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_evidence_before_terminal')::bigint
  and (select count(*) from public.github_evidence_provenance where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_evidence_provenance_before_terminal')::bigint
  and (select count(*) from public.monitoring_findings where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_findings_before_terminal')::bigint
  and (select count(*) from public.github_finding_provenance where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_finding_provenance_before_terminal')::bigint
  and (select count(*) from public.github_finding_transitions where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_transitions_before_terminal')::bigint,
  'official fixture: failed and rate-limited FAIL runs change none of six ledger or lifecycle tables'
);

-- Replay lineage remains exact after later materialisation.
set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000306','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000406','evidence'));
reset role;
select set_config('app.official_old_evidence',(select evidence_id::text from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000406'),true);
set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000307','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000407','evidence'));
reset role;
select ok((select evidence_id=current_setting('app.official_old_evidence')::uuid from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000406') and (select evidence_id is distinct from current_setting('app.official_old_evidence')::uuid from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000407'),'official fixture: later pass preserves old evidence ID and creates a distinct new lineage');
select set_config('app.official_evidence_before_replay',(select count(*)::text from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001'),true);
set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000306','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000406','evidence'));
reset role;
select ok((select count(*)=1 and min(evidence_id)=current_setting('app.official_old_evidence')::uuid from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000406') and (select count(*) from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_evidence_before_replay')::bigint,'official fixture: exact replay retains one official row and creates no duplicate evidence');

set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000308','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000408','finding'));
reset role;
select set_config('app.official_old_finding',(select finding_id::text from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000408'),true);
set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000309','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000409','evidence'));
reset role;
select ok((select finding_id=current_setting('app.official_old_finding')::uuid from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000408') and (select finding_id=current_setting('app.official_old_finding')::uuid from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000409') and (select status='resolved' from public.monitoring_findings where id=current_setting('app.official_old_finding')::uuid),'official fixture: later pass preserves failure finding ID and records exact resolution lineage');
set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000308','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000408','finding'));
reset role;
select ok((select count(*)=1 and min(finding_id)=current_setting('app.official_old_finding')::uuid from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000408') and (select status='resolved' from public.monitoring_findings where id=current_setting('app.official_old_finding')::uuid),'official fixture: failure replay retains one immutable result without undoing later resolution');

-- Seed partial/conflicting ledgers directly, then make the real wrapper fail.
insert into public.github_official_compliance_results(id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,catalogue_summary,observed_at,fresh_until)
select '75000000-0000-4000-8000-000000000701',observation.organisation_id,observation.installation_id,observation.repository_id,observation.provider_repository_id,observation.collection_run_id,observation.id,approval.id,pack.id,pack.version,pack.checksum,observation.check_id,observation.rule_version,observation.result,entry.treatments #>> array['pass','summary'],observation.observed_at,observation.fresh_until
from public.github_observations observation join public.github_mapping_approvals approval on approval.organisation_id=observation.organisation_id and approval.revoked_at is null join public.github_mapping_packs pack on pack.id=approval.mapping_pack_id join public.github_mapping_entries entry on entry.mapping_pack_id=pack.id and entry.check_id=observation.check_id and entry.rule_version=observation.rule_version where observation.id='75000000-0000-4000-8000-000000000418';
select set_config('app.official_evidence_before_atomic',(select count(*)::text from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001'),true);
set role service_role;
select throws_ok($$ select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000318','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000418','evidence') || pg_temp.official_decision('75000000-0000-4000-8000-000000000419','evidence')) $$,'P0001','official result ledger is incomplete or conflicts','official fixture: partial ledger rejects whole materialisation transaction');
reset role;
select ok((select count(*) from public.github_evidence_provenance where observation_id in ('75000000-0000-4000-8000-000000000418','75000000-0000-4000-8000-000000000419'))=0 and (select count(*) from public.evidence where organisation_id='75000000-0000-4000-8000-000000000001')=current_setting('app.official_evidence_before_atomic')::bigint and (select count(*) from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000419')=0,'official fixture: partial-ledger failure rolls back lifecycle and newly inserted result');

insert into public.github_official_compliance_results(id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,catalogue_summary,observed_at,fresh_until)
select '75000000-0000-4000-8000-000000000702',observation.organisation_id,observation.installation_id,observation.repository_id,observation.provider_repository_id,observation.collection_run_id,observation.id,approval.id,pack.id,pack.version,pack.checksum,observation.check_id,observation.rule_version,observation.result,'Conflicting approved summary',observation.observed_at,observation.fresh_until
from public.github_observations observation join public.github_mapping_approvals approval on approval.organisation_id=observation.organisation_id and approval.revoked_at is null join public.github_mapping_packs pack on pack.id=approval.mapping_pack_id where observation.id='75000000-0000-4000-8000-000000000420';
set role service_role;
select throws_ok($$ select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000319','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000420','evidence')) $$,'P0001','official result ledger is incomplete or conflicts','official fixture: conflicting ledger rejects replay atomically');
reset role;
select ok((select count(*) from public.github_evidence_provenance where observation_id='75000000-0000-4000-8000-000000000420')=0 and (select catalogue_summary='Conflicting approved summary' from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000420'),'official fixture: conflicting-ledger failure rolls back lifecycle and preserves prior immutable row');

-- Establish v1 active status before replacing the approval.
set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000310','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000410','explanatory'));
reset role;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select is((public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000205',null,null,'active',null,20)->'results'->0->>'mappingStatus'),'active','official fixture: exact approved v1 result begins active');
reset role;

-- Build the successor through the reachable draft/seal/approval path. The
-- enclosing rollback is the deterministic cleanup for this complete v2 pack.
insert into public.github_mapping_packs(id,version,title) values
 ('75000000-0000-4000-8000-000000000501','github-iso-27001-v2','Standard GitHub to ISO/IEC 27001:2022 mapping pack v2');
insert into public.github_mapping_entries(id,mapping_pack_id,check_id,rule_version,iso_control_references,failure_severity,remediation,treatments)
select
 ('75000000-0000-4000-8000-'||pg_catalog.lpad((900+pg_catalog.row_number() over (order by entry.check_id))::text,12,'0'))::uuid,
 '75000000-0000-4000-8000-000000000501',entry.check_id,entry.rule_version,
 entry.iso_control_references,entry.failure_severity,entry.remediation,entry.treatments
from public.github_mapping_entries entry join public.github_mapping_packs pack on pack.id=entry.mapping_pack_id
where pack.version='github-iso-27001-v1';
set role postgres;
select ok(
 public.seal_github_mapping_pack_server('github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab')='75000000-0000-4000-8000-000000000501'::uuid
 and (select count(*) from public.github_mapping_entries where mapping_pack_id='75000000-0000-4000-8000-000000000501')=15,
 'official fixture: postgres-only sealer publishes the complete 15-entry v2 draft'
);
reset role;
set role service_role;
select set_config('app.official_v2_approval',public.approve_github_mapping_pack_server(
 '75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000011',
 'github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab'
)::text,true);
reset role;

set role service_role;
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000311','github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab',pg_temp.official_decision('75000000-0000-4000-8000-000000000411','explanatory'));
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000312','github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab',pg_temp.official_decision('75000000-0000-4000-8000-000000000412','explanatory'));
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000313','github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab',pg_temp.official_decision('75000000-0000-4000-8000-000000000413','finding'));
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000314','github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab',pg_temp.official_decision('75000000-0000-4000-8000-000000000414','evidence'));
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000315','github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab',pg_temp.official_decision('75000000-0000-4000-8000-000000000415','explanatory'));
select set_config('app.official_active_replay',public.materialise_github_observations_server('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000311','github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab',pg_temp.official_decision('75000000-0000-4000-8000-000000000411','explanatory'))::text,true);
select public.materialise_github_observations_server('75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000320','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',pg_temp.official_decision('75000000-0000-4000-8000-000000000421','explanatory'));
reset role;
select ok((current_setting('app.official_active_replay')::jsonb->>'skipped')::int=1 and (select count(*) from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000411')=1,'official fixture: active replay reports one skip and retains exactly one result');

set role authenticated;
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select set_config('app.official_order_payload',public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001',null,'unknown','current','active',null,2)::text,true);
select set_config('app.official_limit_payload',public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001',null,'unknown','current','active',null,1)::text,true);
select is((public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000205',null,null,'historical',null,20)->'results'->0->>'mappingStatus'),'historical','official fixture: approval change makes exact earlier result historical');
select is(pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000206',null,null,'active',null,20)->'results'),1,'official fixture: replacement approval result is active');
select is(pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000208','fail',null,null,null,20)->'results'),0,'official fixture: repository filter cannot resurrect older pre-reinstallation failure');
select is(pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001',null,'fail',null,null,null,20)->'results'),0,'official fixture: result filter runs after latest stable repository-check selection');
select ok(pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000210',null,'stale',null,null,20)->'results')=1 and pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000210',null,'current',null,null,20)->'results')=0,'official fixture: fresh-until equality with as-of is stale and not current');
select ok(pg_catalog.jsonb_array_length(current_setting('app.official_order_payload')::jsonb->'results')=2 and (current_setting('app.official_order_payload')::jsonb->'results'->0->>'observedAt')=(current_setting('app.official_order_payload')::jsonb->'results'->1->>'observedAt'),'official fixture: deterministic-order query returns both exact equal-time identities');
select ok((current_setting('app.official_order_payload')::jsonb->'results'->0->>'id')>(current_setting('app.official_order_payload')::jsonb->'results'->1->>'id'),'official fixture: equal observed times use descending stable result ID');
select ok(pg_catalog.jsonb_array_length(current_setting('app.official_limit_payload')::jsonb->'results')=1 and (current_setting('app.official_limit_payload')::jsonb->>'truncated')::boolean and (current_setting('app.official_limit_payload')::jsonb->'results'->0->>'id')=(current_setting('app.official_order_payload')::jsonb->'results'->0->>'id'),'official fixture: limit-plus-one truncates while preserving deterministic first row');
select is((current_setting('app.official_limit_payload')::jsonb->'results'->0->>'repositoryLabel'),'GitHub repository '||pg_catalog.left(current_setting('app.official_limit_payload')::jsonb->'results'->0->>'repositoryId',8),'official fixture: repository label derives only from local UUID');
select ok(current_setting('app.official_order_payload') !~ '"(providerRepositoryId|providerInstallationId|sourceUrl|title|explanation|remediation|accountLogin|ownerLogin|fullName|htmlUrl|actorId|memberId)"[[:space:]]*:','official fixture: MCP JSON excludes prohibited provider sensitive and actor keys');
reset role;

-- Direct ledger RLS and security-invoker RPC role matrix.
set role authenticated;
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select cmp_ok((select count(*) from public.github_official_compliance_results),'>',0::bigint,'official fixture: Owner reads workspace ledger through RLS');
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select cmp_ok((select count(*) from public.github_official_compliance_results),'>',0::bigint,'official fixture: Admin reads workspace ledger through RLS');
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select cmp_ok((select count(*) from public.github_official_compliance_results),'>',0::bigint,'official fixture: Member reads workspace ledger through RLS');
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000014","role":"authenticated"}',true);
select is((select count(*) from public.github_official_compliance_results where organisation_id='75000000-0000-4000-8000-000000000001'),0::bigint,'official fixture: outsider cannot read another workspace ledger');
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select cmp_ok(pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001',null,null,null,null,null,50)->'results'),'>',0,'official fixture: Owner receives caller-scoped MCP rows');
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select cmp_ok(pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001',null,null,null,null,null,50)->'results'),'>',0,'official fixture: Admin receives caller-scoped MCP rows');
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select cmp_ok(pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001',null,null,null,null,null,50)->'results'),'>',0,'official fixture: Member receives caller-scoped MCP rows');
select is(pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000002',null,null,null,null,null,50)->'results'),0,'official fixture: Member cannot target sibling workspace through MCP read');
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000014","role":"authenticated"}',true);
select is(pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001',null,null,null,null,null,50)->'results'),0,'official fixture: outsider MCP read returns no cross-tenant rows');
reset role;

set role anon;
select throws_ok($$ select count(*) from public.github_official_compliance_results $$,'42501',null,'official fixture: anonymous direct ledger read is denied');
select throws_ok($$ select public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000001',null,null,null,null,null,20) $$,'42501',null,'official fixture: anonymous runtime RPC execution is denied');
reset role;

set role authenticated;
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select throws_ok($$ insert into public.github_official_compliance_results(organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,failure_severity,catalogue_summary,observed_at,fresh_until) values ('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000211',75311,'75000000-0000-4000-8000-000000000316','75000000-0000-4000-8000-000000000416',current_setting('app.official_v2_approval')::uuid,'75000000-0000-4000-8000-000000000501','github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab','github.branch.stale_approvals','github-repository-v1','fail','medium','Direct write',now()-interval '1 hour',now()+interval '1 day') $$,'42501',null,'official fixture: authenticated direct insert is denied');
reset role;
select throws_ok($$ update public.github_official_compliance_results set catalogue_summary='rewritten' where observation_id='75000000-0000-4000-8000-000000000401' $$,'42501','official GitHub compliance results are immutable','official fixture: direct update is rejected by immutable trigger');
select throws_ok($$ delete from public.github_official_compliance_results where observation_id='75000000-0000-4000-8000-000000000401' $$,'42501','official GitHub compliance results are immutable','official fixture: direct delete is rejected by immutable trigger');

select throws_ok($$ insert into public.github_official_compliance_results(id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,failure_severity,catalogue_summary,observed_at,fresh_until) values ('75000000-0000-4000-8000-000000000703','75000000-0000-4000-8000-000000000002','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000211',75311,'75000000-0000-4000-8000-000000000316','75000000-0000-4000-8000-000000000416','75000000-0000-4000-8000-000000000602',(select mapping_pack_id from public.github_mapping_approvals where id='75000000-0000-4000-8000-000000000602'),'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f','github.branch.stale_approvals','github-repository-v1','fail','medium','Cross tenant',now()-interval '1 hour',now()+interval '1 day') $$,'23503',null,'official fixture: composite ancestry rejects cross-tenant repository run and observation');

insert into public.evidence(id,organisation_id,title,kind,url,description,owner_id,collected_on,valid_until,status,created_by) values
 ('75000000-0000-4000-8000-000000000801','75000000-0000-4000-8000-000000000002','Sibling evidence','link','https://example.test/evidence','Tenant isolation fixture.','75000000-0000-4000-8000-000000000014',current_date,current_date+1,'current','75000000-0000-4000-8000-000000000014');
select throws_ok($$ insert into public.github_official_compliance_results(id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,failure_severity,catalogue_summary,observed_at,fresh_until,evidence_id) values ('75000000-0000-4000-8000-000000000704','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000211',75311,'75000000-0000-4000-8000-000000000317','75000000-0000-4000-8000-000000000417',current_setting('app.official_v2_approval')::uuid,'75000000-0000-4000-8000-000000000501','github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab','github.branch.stale_approvals','github-repository-v1','fail','medium','Cross tenant evidence',now()-interval '50 minutes',now()+interval '1 day','75000000-0000-4000-8000-000000000801') $$,'23503',null,'official fixture: composite evidence FK rejects sibling workspace evidence');

set role authenticated;
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000014","role":"authenticated"}',true);
select is(pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v1('75000000-0000-4000-8000-000000000002',null,null,null,null,null,50)->'results'),1,'official fixture: sibling Owner reads exactly their own private result');
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select is((select count(*) from public.github_official_compliance_results where organisation_id='75000000-0000-4000-8000-000000000002'),0::bigint,'official fixture: Member direct RLS cannot see sibling workspace row');
reset role;

set role service_role;
select throws_ok($$ insert into public.github_official_compliance_results(organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,failure_severity,catalogue_summary,observed_at,fresh_until) values ('75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000211',75311,'75000000-0000-4000-8000-000000000317','75000000-0000-4000-8000-000000000417',current_setting('app.official_v2_approval')::uuid,'75000000-0000-4000-8000-000000000501','github-iso-27001-v2','498642cd3df84b3a8f480af088ac9d75ae247be136f22292ab51ec40fdf8aeab','github.branch.stale_approvals','github-repository-v1','fail','medium','Direct service write',now()-interval '50 minutes',now()+interval '1 day') $$,'42501',null,'official fixture: service-role direct insert is denied at runtime');
reset role;

select * from finish();
rollback;
