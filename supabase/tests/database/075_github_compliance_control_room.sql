create extension if not exists dblink with schema extensions;

begin;
set local session_replication_role = replica;
delete from public.audit_events where organisation_id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.github_official_compliance_results where organisation_id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.github_materialisation_jobs where organisation_id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.github_mapping_approvals where organisation_id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.github_observations where organisation_id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.github_collection_runs where organisation_id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.github_repositories where organisation_id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.github_installations where organisation_id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.monitoring_findings where organisation_id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.memberships where organisation_id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.organisations where id in (
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102'
);
delete from public.profiles where id::text like '75000000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '75000000-0000-4000-8000-00000000000%';
commit;

select no_plan();

select has_function(
  'public', 'retry_github_materialisation_job_server',
  array['uuid','uuid','uuid','text'],
  'an explicit audited materialisation retry boundary exists'
);
select ok(
  has_function_privilege('service_role','public.retry_github_materialisation_job_server(uuid,uuid,uuid,text)','EXECUTE'),
  'service role can invoke the retry boundary'
);
select ok(
  not has_function_privilege('authenticated','public.retry_github_materialisation_job_server(uuid,uuid,uuid,text)','EXECUTE'),
  'authenticated callers cannot invoke the service retry boundary directly'
);
select ok(
  not has_function_privilege('anon','public.retry_github_materialisation_job_server(uuid,uuid,uuid,text)','EXECUTE'),
  'anonymous callers cannot invoke the retry boundary'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(procedure.proacl) privilege
    where procedure.oid='public.retry_github_materialisation_job_server(uuid,uuid,uuid,text)'::pg_catalog.regprocedure
      and privilege.grantee=0 and privilege.privilege_type='EXECUTE'
  ),
  'PUBLIC cannot invoke the retry boundary'
);
select ok(
  (select prosecdef from pg_catalog.pg_proc where oid='public.retry_github_materialisation_job_server(uuid,uuid,uuid,text)'::pg_catalog.regprocedure),
  'retry is a deliberate security-definer server boundary'
);
select is(
  (select proconfig from pg_catalog.pg_proc where oid='public.retry_github_materialisation_job_server(uuid,uuid,uuid,text)'::pg_catalog.regprocedure),
  array['search_path='],
  'retry uses an empty search path'
);
select cmp_ok(
  (select pg_catalog.count(*) from pg_catalog.regexp_matches(
    pg_catalog.pg_get_functiondef('public.retry_github_materialisation_job_server(uuid,uuid,uuid,text)'::pg_catalog.regprocedure),
    'membership[.]role = ''owner''', 'g'
  )),
  '>=', 2::bigint,
  'retry revalidates the exact current Owner before and after locking'
);
select ok(
  pg_catalog.pg_get_functiondef('public.retry_github_materialisation_job_server(uuid,uuid,uuid,text)'::pg_catalog.regprocedure)
    ~* 'perform[[:space:]]+1[[:space:]]+from public[.]memberships membership[[:space:]]+where[[:space:][:print:]]+membership[.]role = ''owner''[[:space:]]+for update',
  'the second Owner revalidation takes a lock that blocks role demotion'
);
select ok(
  pg_catalog.to_regclass('public.github_materialisation_jobs_exhausted_attention_idx') is not null,
  'the exhausted-attention query has a dedicated partial index'
);
select ok(
  pg_catalog.pg_get_indexdef('public.github_materialisation_jobs_exhausted_attention_idx'::pg_catalog.regclass)
    ~ '[(]organisation_id, exhausted_at, id[)] WHERE [(][(]status = ''exhausted''::text[)] AND [(]exhausted_at IS NOT NULL[)][)]',
  'the exhausted-attention index matches tenant, order, tie-breaker, and predicate'
);
select ok(
  pg_catalog.to_regclass('public.github_repositories_control_room_selected_idx') is not null,
  'the selected-repository page has a dedicated partial index'
);
select ok(
  pg_catalog.pg_get_indexdef('public.github_repositories_control_room_selected_idx'::pg_catalog.regclass)
    ~ '[(]organisation_id, full_name COLLATE "C", id[)] WHERE selected',
  'the selected-repository index matches tenant, C ordering, tie-breaker, and predicate'
);

select has_function(
  'public', 'get_github_compliance_control_room_v1',
  array['uuid','integer','integer'],
  'the authenticated versioned control-room read exists'
);
select ok(
  has_function_privilege('authenticated','public.get_github_compliance_control_room_v1(uuid,integer,integer)','EXECUTE'),
  'authenticated workspace members may invoke the control-room read'
);
select ok(
  not has_function_privilege('anon','public.get_github_compliance_control_room_v1(uuid,integer,integer)','EXECUTE'),
  'anonymous callers cannot invoke the control-room read'
);
select ok(
  not has_function_privilege('service_role','public.get_github_compliance_control_room_v1(uuid,integer,integer)','EXECUTE'),
  'the service role cannot bypass member RLS through the control-room read'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(procedure.proacl) privilege
    where procedure.oid='public.get_github_compliance_control_room_v1(uuid,integer,integer)'::pg_catalog.regprocedure
      and privilege.grantee=0 and privilege.privilege_type='EXECUTE'
  ),
  'PUBLIC cannot invoke the control-room read'
);
select ok(
  not (select prosecdef from pg_catalog.pg_proc where oid='public.get_github_compliance_control_room_v1(uuid,integer,integer)'::pg_catalog.regprocedure),
  'the control-room read is security invoker'
);
select is(
  (select provolatile from pg_catalog.pg_proc where oid='public.get_github_compliance_control_room_v1(uuid,integer,integer)'::pg_catalog.regprocedure),
  's'::"char",
  'the statement-consistent control-room read is stable'
);
select is(
  (select proconfig from pg_catalog.pg_proc where oid='public.get_github_compliance_control_room_v1(uuid,integer,integer)'::pg_catalog.regprocedure),
  array['search_path='],
  'the control-room read uses an empty search path'
);

begin;
insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data
) values
 ('75000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','control-owner@example.test','',now(),'{}','{}'),
 ('75000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','control-admin@example.test','',now(),'{}','{}'),
 ('75000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','control-member@example.test','',now(),'{}','{}'),
 ('75000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','control-owner-b@example.test','',now(),'{}','{}'),
 ('75000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','control-outsider@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
 ('75000000-0000-4000-8000-000000000101','Control Room A','control-room-a','75000000-0000-4000-8000-000000000001'),
 ('75000000-0000-4000-8000-000000000102','Control Room B','control-room-b','75000000-0000-4000-8000-000000000004');
insert into public.memberships(organisation_id,user_id,role) values
 ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001','owner'),
 ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000002','admin'),
 ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000003','member'),
 ('75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000004','owner');
insert into public.github_installations(
 id,organisation_id,provider_installation_id,account_id,account_login,account_type,
 repository_selection,status,connected_by,permissions,permissions_ok
) values
 ('75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000101',75201,75301,'Mukta2701','User','selected','active','75000000-0000-4000-8000-000000000001','{}',true),
 ('75000000-0000-4000-8000-000000000202','75000000-0000-4000-8000-000000000102',75202,75302,'Other-Owner','Organization','selected','active','75000000-0000-4000-8000-000000000004','{}',true);
insert into public.github_repositories(
 id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
 html_url,visibility,default_branch,archived,selected,available
) values
 ('75000000-0000-4000-8000-000000000301','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201',75401,'Mukta2701','ComplianceHub','Mukta2701/ComplianceHub','https://github.com/Mukta2701/ComplianceHub','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000302','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201',75402,'Mukta2701','Second','Mukta2701/Second','https://github.com/Mukta2701/Second','private','main',false,true,true),
 ('75000000-0000-4000-8000-000000000303','75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000202',75403,'Other-Owner','Private','Other-Owner/Private','https://github.com/Other-Owner/Private','private','main',false,true,true);
insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
 status,started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,not_applicable_count
) values
 ('75000000-0000-4000-8000-000000000401','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000301',75401,'manual','control-a-one','succeeded','2026-08-25T05:00:00Z','2026-08-25T05:05:00Z',1,0,1,0,0),
 ('75000000-0000-4000-8000-000000000402','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000302',75402,'manual','control-a-two','partial','2026-08-25T05:30:00Z','2026-08-25T05:35:00Z',1,0,0,1,0),
 ('75000000-0000-4000-8000-000000000403','75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000202','75000000-0000-4000-8000-000000000303',75403,'manual','control-b-one','succeeded','2026-08-25T05:00:00Z','2026-08-25T05:05:00Z',1,1,0,0,0);
insert into public.github_observations(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,
 explanation,remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
) values (
 '75000000-0000-4000-8000-000000000501','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000301',75401,'75000000-0000-4000-8000-000000000401',
 'Mukta2701/ComplianceHub/github.repository.visibility/github-repository-v1','github.repository.visibility','github-repository-v1','github_repository','github:repository:75401','fail','high','Repository visibility is restricted',
 'The repository is public.','Restrict repository visibility.','2026-08-25T05:01:00Z','2026-08-26T17:01:00Z','https://github.com/Mukta2701/ComplianceHub',repeat('a',64),null
);
insert into public.github_mapping_approvals(organisation_id,mapping_pack_id,approved_by,approved_at)
select '75000000-0000-4000-8000-000000000101',pack.id,'75000000-0000-4000-8000-000000000001','2026-08-25T04:00:00Z'
from public.github_mapping_packs pack
where pack.version='github-iso-27001-v1';
insert into public.monitoring_findings(
  id,organisation_id,check_id,control_ref,subject_type,subject_id,severity,title,detail
) values (
  '75000000-0000-4000-8000-000000000701','75000000-0000-4000-8000-000000000101',
  'github.repository.visibility','A.8.32','github_repository','github:repository:75401',
  'high','Repository visibility needs attention','An approved GitHub check failed.'
);
insert into public.github_official_compliance_results(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_id,approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,
 rule_version,outcome,failure_severity,catalogue_summary,observed_at,fresh_until,materialised_at,
 evidence_id,finding_id
)
select
 '75000000-0000-4000-8000-000000000601','75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000301',75401,'75000000-0000-4000-8000-000000000401',
 '75000000-0000-4000-8000-000000000501',approval.id,pack.id,pack.version,pack.checksum,'github.repository.visibility',
 'github-repository-v1','fail','high','A failed repository visibility check needs attention.','2026-08-25T05:01:00Z','2026-08-26T17:01:00Z','2026-08-25T05:06:00Z',
 null,'75000000-0000-4000-8000-000000000701'
from public.github_mapping_approvals approval
join public.github_mapping_packs pack on pack.id=approval.mapping_pack_id
where approval.organisation_id='75000000-0000-4000-8000-000000000101' and approval.revoked_at is null;
update public.github_materialisation_jobs
set status='exhausted',attempt_count=25,available_at='2026-08-25T05:05:00Z',
    exhausted_at='2026-08-25T05:10:00Z',updated_at='2026-08-25T05:10:00Z'
where collection_run_id='75000000-0000-4000-8000-000000000401';
update public.github_materialisation_jobs
set status='exhausted',attempt_count=25,available_at='2026-08-25T05:35:00Z',
    exhausted_at='2026-08-25T05:40:00Z',updated_at='2026-08-25T05:40:00Z'
where collection_run_id='75000000-0000-4000-8000-000000000402';
commit;

create temporary table github_control_room_protected_counts as
select
  (select count(*) from public.soa_items where organisation_id='75000000-0000-4000-8000-000000000101') as soa_items,
  (select count(*) from public.assessment_sessions where organisation_id='75000000-0000-4000-8000-000000000101') as assessment_sessions,
  (select count(*) from public.assessment_responses response join public.assessment_sessions session on session.id=response.session_id where session.organisation_id='75000000-0000-4000-8000-000000000101') as assessment_responses,
  (select count(*) from public.risks where organisation_id='75000000-0000-4000-8000-000000000101') as risks,
  (select count(*) from public.leadership_report_snapshots where organisation_id='75000000-0000-4000-8000-000000000101') as leadership_snapshots;

set role authenticated;
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000001","role":"authenticated"}',false);
select ok(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) is not null,
  'an Owner can read the active workspace control room'
);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) #>> '{pagination,total}',
  '2',
  'the repository page reports the complete selected total'
);
select is(
  pg_catalog.jsonb_array_length(public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1)->'repositories'),
  1,
  'the repository page enforces the requested bound'
);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) #>> '{pagination,truncated}',
  'true',
  'the repository page reports truncation truthfully'
);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) #>> '{repositories,0,name}',
  'Mukta2701/ComplianceHub',
  'the selected repository exposes its bounded trusted name'
);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) #>> '{repositories,0,url}',
  'https://github.com/Mukta2701/ComplianceHub',
  'the selected repository exposes its stored canonical GitHub URL'
);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) #>> '{approval,approvedAt}',
  '2026-08-25T04:00:00+00:00',
  'the active approval exposes reviewed time without an actor identity'
);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) #>> '{repositories,0,officialResults,0,checkId}',
  'github.repository.visibility',
  'the latest official stable repository/check result is included'
);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) #>> '{repositories,0,officialResults,0,findingId}',
  '75000000-0000-4000-8000-000000000701',
  'a failed official result exposes only its safe local finding reference'
);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) #>> '{exhaustedAttention,total}',
  '2',
  'all exhausted work is counted independently of the repository page'
);
select is(
  pg_catalog.jsonb_array_length(public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) #> '{exhaustedAttention,items}'),
  2,
  'exhausted attention includes bounded work beyond the visible repository page'
);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1) #>> '{exhaustedAttention,items,1,repositoryId}',
  '75000000-0000-4000-8000-000000000302',
  'the off-page exhausted repository remains visible to recovery attention'
);
select ok(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,1)::text
    !~* 'provider|installation|account|approvedBy|actor|member|observation|diagnostic|payload|token|secret',
  'the bounded control-room JSON excludes provider payloads and private identities'
);

select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000002","role":"authenticated"}',false);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,20) #>> '{pagination,total}',
  '2',
  'an Admin receives the same member-scoped read contract'
);
select throws_ok(
  $$ select public.set_github_repository_selected('75000000-0000-4000-8000-000000000301',false) $$,
  '42501','repository selection requires a workspace Owner','an Admin cannot change collection scope'
);

select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000003","role":"authenticated"}',false);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,20) #>> '{pagination,total}',
  '2',
  'a Member receives the same member-scoped read contract'
);
select throws_ok(
  $$ select public.set_github_repository_selected('75000000-0000-4000-8000-000000000301',false) $$,
  '42501','repository selection requires a workspace Owner','a Member cannot change collection scope'
);

select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000005","role":"authenticated"}',false);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,20),
  null::jsonb,
  'an outsider receives zero control-room data'
);
select throws_ok(
  $$ select public.set_github_repository_selected('75000000-0000-4000-8000-000000000301',false) $$,
  '42501','repository selection requires a workspace Owner','an outsider cannot change collection scope'
);
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000004","role":"authenticated"}',false);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,20),
  null::jsonb,
  'a different-workspace Owner receives zero cross-tenant data'
);
select throws_ok(
  $$ select public.set_github_repository_selected('75000000-0000-4000-8000-000000000301',false) $$,
  '42501','repository selection requires a workspace Owner','a different-workspace Owner cannot change collection scope'
);
select is(
  public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000102',0,20) #>> '{repositories,0,name}',
  'Other-Owner/Private',
  'the other Owner can read only their own selected repository'
);
select throws_ok(
  $$ select public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,0) $$,
  '22023','control-room pagination is invalid','the read rejects a zero limit'
);
select throws_ok(
  $$ select public.get_github_compliance_control_room_v1('75000000-0000-4000-8000-000000000101',0,21) $$,
  '22023','control-room pagination is invalid','the read rejects a limit above twenty'
);
reset role;

set role service_role;
select throws_ok(
  $$ select public.retry_github_materialisation_job_server('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',(select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),'') $$,
  '22023','materialisation retry reason is invalid','retry rejects an empty reason'
);
select throws_ok(
  $$ select public.retry_github_materialisation_job_server('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',(select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),repeat('x',501)) $$,
  '22023','materialisation retry reason is invalid','retry rejects an overlong reason'
);
select throws_ok(
  $$ select public.retry_github_materialisation_job_server('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',(select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),'unsafe <reason>') $$,
  '22023','materialisation retry reason is invalid','retry rejects arbitrary free text'
);
select throws_ok(
  $$ select public.retry_github_materialisation_job_server('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',(select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),'https://' || 'example.test/retry?' || 'to' || 'ken=' || 'synthetic-value') $$,
  '22023','materialisation retry reason is invalid','retry rejects URL and token-shaped content'
);
select throws_ok(
  $$ select public.retry_github_materialisation_job_server('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',(select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),'owner' || pg_catalog.chr(64) || 'example.test') $$,
  '22023','materialisation retry reason is invalid','retry rejects email-shaped content'
);
select throws_ok(
  $$ select public.retry_github_materialisation_job_server('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000002',(select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),'owner_reviewed') $$,
  '42501','materialisation retry requires a current workspace Owner','an Admin cannot nominate a retry'
);
select throws_ok(
  $$ select public.retry_github_materialisation_job_server('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000003',(select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),'owner_reviewed') $$,
  '42501','materialisation retry requires a current workspace Owner','a Member cannot nominate a retry'
);
select throws_ok(
  $$ select public.retry_github_materialisation_job_server('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000005',(select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),'owner_reviewed') $$,
  '42501','materialisation retry requires a current workspace Owner','an outsider cannot nominate a retry'
);
select throws_ok(
  $$ select public.retry_github_materialisation_job_server('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000004',(select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),'owner_reviewed') $$,
  '42501','materialisation retry requires a current workspace Owner','a cross-workspace Owner cannot nominate a retry'
);
select ok(
  not public.retry_github_materialisation_job_server(
    '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',
    (select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000403'),
    'owner_reviewed'
  ),
  'an exact organisation guard rejects a sibling-workspace job ID'
);
reset role;

select extensions.dblink_connect('control_retry_a','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_connect('control_retry_b','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_exec('control_retry_a','set role service_role');
select extensions.dblink_exec('control_retry_b','set role service_role');
select extensions.dblink_send_query('control_retry_a',$remote$
  with retried as (
    select public.retry_github_materialisation_job_server(
      '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',
      (select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),
      'owner_reviewed'
    ) as result
  )
  select retried.result
  from retried
  cross join lateral (
    select pg_catalog.pg_sleep(0.5 + case when retried.result then 0 else 0 end)
  ) hold(waited)
  where hold.waited is null
$remote$);
select pg_catalog.pg_sleep(0.1);
select extensions.dblink_send_query('control_retry_b',$remote$
  select public.retry_github_materialisation_job_server(
    '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',
    (select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000401'),
    'owner_reviewed'
  )
$remote$);
select pg_catalog.pg_sleep(0.1);
select is(extensions.dblink_is_busy('control_retry_b'),1,'a concurrent retry waits behind the exact locked job');
select ok(result,'the first Owner-authorised retry resets exhausted work') from extensions.dblink_get_result('control_retry_a') as result(result boolean);
select ok(not result,'the concurrent retry is exact-once after the first commit') from extensions.dblink_get_result('control_retry_b') as result(result boolean);
select extensions.dblink_disconnect('control_retry_a');
select extensions.dblink_disconnect('control_retry_b');

select ok(
  (select status='pending' and attempt_count=0 and available_at<=pg_catalog.now()
    and exhausted_at is null and lease_token is null and lease_expires_at is null
   from public.github_materialisation_jobs
   where collection_run_id='75000000-0000-4000-8000-000000000401'),
  'the winning retry resets only an exhausted unleased job to fresh pending work'
);
select is(
  (select count(*) from public.audit_events
   where organisation_id='75000000-0000-4000-8000-000000000101'
     and action='github.materialisation_retry'
     and entity_type='github_materialisation_job'),
  1::bigint,
  'concurrent retry writes exactly one immutable audit event'
);
select is(
  (select metadata->>'reason_code' from public.audit_events
   where organisation_id='75000000-0000-4000-8000-000000000101'
     and action='github.materialisation_retry' order by id desc limit 1),
  'owner_reviewed',
  'the retry audit retains only the closed safe reason code'
);
select is(
  (select (metadata->>'previous_attempt_count')::integer from public.audit_events
   where organisation_id='75000000-0000-4000-8000-000000000101'
     and action='github.materialisation_retry' order by id desc limit 1),
  25,
  'the retry audit retains the previous exhausted attempt count'
);
select is(
  (select actor_id from public.audit_events
   where organisation_id='75000000-0000-4000-8000-000000000101'
     and action='github.materialisation_retry' order by id desc limit 1),
  '75000000-0000-4000-8000-000000000001'::uuid,
  'the retry audit retains the exact current Owner actor'
);
select results_eq(
  $$ select
       (select count(*) from public.soa_items where organisation_id='75000000-0000-4000-8000-000000000101'),
       (select count(*) from public.assessment_sessions where organisation_id='75000000-0000-4000-8000-000000000101'),
       (select count(*) from public.assessment_responses response join public.assessment_sessions session on session.id=response.session_id where session.organisation_id='75000000-0000-4000-8000-000000000101'),
       (select count(*) from public.risks where organisation_id='75000000-0000-4000-8000-000000000101'),
       (select count(*) from public.leadership_report_snapshots where organisation_id='75000000-0000-4000-8000-000000000101') $$,
  $$ select soa_items,assessment_sessions,assessment_responses,risks,leadership_snapshots from github_control_room_protected_counts $$,
  'retry and control-room reads leave SoA, assessment, risk, and leadership state unchanged'
);

update public.memberships
set role='owner'
where organisation_id='75000000-0000-4000-8000-000000000101'
  and user_id='75000000-0000-4000-8000-000000000002';
select extensions.dblink_connect('control_role_retry','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_connect('control_role_demote','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_exec('control_role_retry','set role service_role');
select extensions.dblink_send_query('control_role_retry',$remote$
  with retried as (
    select public.retry_github_materialisation_job_server(
      '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',
      (select id from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000402'),
      'owner_reviewed'
    ) as result
  )
  select retried.result
  from retried
  cross join lateral (
    select pg_catalog.pg_sleep(0.5 + case when retried.result then 0 else 0 end)
  ) hold(waited)
  where hold.waited is null
$remote$);
select pg_catalog.pg_sleep(0.1);
select extensions.dblink_send_query('control_role_demote',$remote$
  update public.memberships
  set role='admin'
  where organisation_id='75000000-0000-4000-8000-000000000101'
    and user_id='75000000-0000-4000-8000-000000000001'
  returning role::text
$remote$);
select pg_catalog.pg_sleep(0.1);
select is(
  extensions.dblink_is_busy('control_role_demote'),
  1,
  'Owner demotion waits while the authorised retry and audit still hold the membership row'
);
select ok(
  result,
  'the retry succeeds while its nominated actor remains a locked current Owner'
) from extensions.dblink_get_result('control_role_retry') as result(result boolean);
select is(
  changed_role,
  'admin',
  'the role change completes only after the Owner-authorised retry commits'
) from extensions.dblink_get_result('control_role_demote') as demotion(changed_role text);
select extensions.dblink_disconnect('control_role_retry');
select extensions.dblink_disconnect('control_role_demote');
select is(
  (select actor_id from public.audit_events
   where organisation_id='75000000-0000-4000-8000-000000000101'
     and entity_id=(select id::text from public.github_materialisation_jobs where collection_run_id='75000000-0000-4000-8000-000000000402')
     and action='github.materialisation_retry'),
  '75000000-0000-4000-8000-000000000001'::uuid,
  'the role-locked retry audit attributes the actor who remained Owner through commit'
);
update public.memberships
set role='owner'
where organisation_id='75000000-0000-4000-8000-000000000101'
  and user_id='75000000-0000-4000-8000-000000000001';
update public.memberships
set role='admin'
where organisation_id='75000000-0000-4000-8000-000000000101'
  and user_id='75000000-0000-4000-8000-000000000002';

set role authenticated;
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000001","role":"authenticated"}',false);
select lives_ok(
  $$ select public.set_github_repository_selected('75000000-0000-4000-8000-000000000302',false) $$,
  'the active workspace Owner can change repository scope'
);
select set_config('request.jwt.claims','{"sub":"75000000-0000-4000-8000-000000000002","role":"authenticated"}',false);
select throws_ok(
  $$ select public.set_github_repository_selected('75000000-0000-4000-8000-000000000302',true) $$,
  '42501','repository selection requires a workspace Owner','an Admin cannot restore repository scope'
);
reset role;

update public.memberships
set role='owner'
where organisation_id='75000000-0000-4000-8000-000000000101'
  and user_id='75000000-0000-4000-8000-000000000002';
select extensions.dblink_connect('control_selection_owner','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_connect('control_selection_demote','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_exec('control_selection_owner','set role authenticated');
select extensions.dblink_exec(
  'control_selection_owner',
  $remote$set "request.jwt.claims" = '{"sub":"75000000-0000-4000-8000-000000000001","role":"authenticated"}'$remote$
);
select extensions.dblink_send_query('control_selection_owner',$remote$
  with changed as (
    select public.set_github_repository_selected(
      '75000000-0000-4000-8000-000000000302', true
    ) as result
  )
  select changed.result
  from changed
  cross join lateral (
    select pg_catalog.pg_sleep(0.5 + case when changed.result then 0 else 0 end)
  ) hold(waited)
  where hold.waited is null
$remote$);
select pg_catalog.pg_sleep(0.1);
select extensions.dblink_send_query('control_selection_demote',$remote$
  update public.memberships
  set role='admin'
  where organisation_id='75000000-0000-4000-8000-000000000101'
    and user_id='75000000-0000-4000-8000-000000000001'
  returning role::text
$remote$);
select pg_catalog.pg_sleep(0.1);
select is(
  extensions.dblink_is_busy('control_selection_demote'),
  1,
  'Owner demotion waits while repository selection holds the exact membership row'
);
select ok(
  result,
  'the current Owner changes repository scope while the role lock is held'
) from extensions.dblink_get_result('control_selection_owner') as selection(result boolean);
select is(
  changed_role,
  'admin',
  'role demotion completes only after repository selection commits'
) from extensions.dblink_get_result('control_selection_demote') as demotion(changed_role text);
select extensions.dblink_disconnect('control_selection_owner');
select extensions.dblink_disconnect('control_selection_demote');
select ok(
  (select selected from public.github_repositories where id='75000000-0000-4000-8000-000000000302'),
  'the selected state committed before Owner demotion'
);
update public.memberships
set role='owner'
where organisation_id='75000000-0000-4000-8000-000000000101'
  and user_id='75000000-0000-4000-8000-000000000001';
update public.memberships
set role='admin'
where organisation_id='75000000-0000-4000-8000-000000000101'
  and user_id='75000000-0000-4000-8000-000000000002';

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.audit_events where organisation_id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.github_official_compliance_results where organisation_id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.github_materialisation_jobs where organisation_id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.github_mapping_approvals where organisation_id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.github_observations where organisation_id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.github_collection_runs where organisation_id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.github_repositories where organisation_id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.github_installations where organisation_id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.monitoring_findings where organisation_id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.memberships where organisation_id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.organisations where id in ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000102');
delete from public.profiles where id::text like '75000000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '75000000-0000-4000-8000-00000000000%';
commit;
