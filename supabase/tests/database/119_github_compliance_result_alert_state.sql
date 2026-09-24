begin;

select no_plan();

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('91000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-alert-owner@example.test','',now(),'{}','{}'),
 ('91000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-alert-admin@example.test','',now(),'{}','{}'),
 ('91000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-alert-member@example.test','',now(),'{}','{}'),
 ('91000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-alert-other-owner@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
 ('91000000-0000-4000-8000-000000000101','M2 Alert Org','m2-alert-org','91000000-0000-4000-8000-000000000001'),
 ('91000000-0000-4000-8000-000000000102','M2 Alert Other Org','m2-alert-other-org','91000000-0000-4000-8000-000000000004');
insert into public.memberships(organisation_id,user_id,role) values
 ('91000000-0000-4000-8000-000000000101','91000000-0000-4000-8000-000000000001','owner'),
 ('91000000-0000-4000-8000-000000000101','91000000-0000-4000-8000-000000000002','admin'),
 ('91000000-0000-4000-8000-000000000101','91000000-0000-4000-8000-000000000003','member'),
 ('91000000-0000-4000-8000-000000000102','91000000-0000-4000-8000-000000000004','owner');

select set_config('m2.alert_approval', public.approve_github_mapping_pack_server(
  '91000000-0000-4000-8000-000000000101','91000000-0000-4000-8000-000000000001',
  'github-iso-27001-v1',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-v1')
)::text, true);

insert into public.github_installations(
 id,organisation_id,provider_installation_id,account_id,account_login,account_type,
 repository_selection,status,connected_by,permissions,permissions_ok
) values (
 '91000000-0000-4000-8000-000000000201','91000000-0000-4000-8000-000000000101',91001,91002,
 'Alert-Test','Organization','selected','active','91000000-0000-4000-8000-000000000001','{}',true
);
insert into public.github_repositories(
 id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
 html_url,visibility,default_branch,archived,selected,available
) values (
 '91000000-0000-4000-8000-000000000202','91000000-0000-4000-8000-000000000101',
 '91000000-0000-4000-8000-000000000201',91003,'Alert-Test','repo','Alert-Test/repo',
 'https://github.com/Alert-Test/repo','private','main',false,true,true
);
insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,
 trigger_type,request_key,run_mode,status,started_at,completed_at,observation_count,
 passed_count,failed_count,unknown_count,not_applicable_count,lease_token,lease_expires_at,attempt
) values (
 '91000000-0000-4000-8000-000000000301','91000000-0000-4000-8000-000000000101',
 '91000000-0000-4000-8000-000000000201','91000000-0000-4000-8000-000000000202',91003,
 'manual','m2-alert-state','official','succeeded',now()-interval '3 days',now()-interval '2 days',
 1,0,0,1,0,extensions.gen_random_uuid(),now()-interval '2 days',1
);
insert into public.github_observations(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
 remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
) select '91000000-0000-4000-8000-000000000401','91000000-0000-4000-8000-000000000101',
  '91000000-0000-4000-8000-000000000201','91000000-0000-4000-8000-000000000202',91003,
  '91000000-0000-4000-8000-000000000301','Alert-Test/repo/'||entry.check_id||'/'||entry.rule_version,
  entry.check_id,entry.rule_version,'github_repository','Alert-Test/repo','unknown',null,
  'Bounded check title','Bounded check explanation',
  'Restore the required GitHub App permission or feature, then run collection again.',
  now()-interval '2 days',now()-interval '1 day','https://github.com/Alert-Test/repo',repeat('f',64),'permission_denied'
from public.github_mapping_entries entry
join public.github_mapping_packs pack on pack.id=entry.mapping_pack_id
where pack.version='github-iso-27001-v1' and entry.check_id='github.branch.status_checks';
insert into public.github_official_compliance_results(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,
 approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,
 catalogue_summary,observed_at,fresh_until
)
select '91000000-0000-4000-8000-000000000402',observation.organisation_id,observation.installation_id,observation.repository_id,
  observation.provider_repository_id,observation.collection_run_id,observation.id,
  approval.id,pack.id,pack.version,pack.checksum,observation.check_id,observation.rule_version,
  observation.result,entry.treatments #>> array['unknown','summary'],observation.observed_at,observation.fresh_until
from public.github_observations observation
join public.github_mapping_approvals approval
  on approval.id=current_setting('m2.alert_approval')::uuid
 and approval.organisation_id=observation.organisation_id
join public.github_mapping_packs pack on pack.id=approval.mapping_pack_id
join public.github_mapping_entries entry
  on entry.mapping_pack_id=pack.id and entry.check_id=observation.check_id
 and entry.rule_version=observation.rule_version
where observation.id='91000000-0000-4000-8000-000000000401';

select ok(not has_table_privilege('authenticated','public.github_compliance_result_alert_states','SELECT')
  and not has_table_privilege('service_role','public.github_compliance_result_alert_events','INSERT'),
  'alert storage is private; callers use the service-only functions');
select ok(has_function_privilege('service_role',
  'public.load_github_compliance_result_alert_candidates(timestamptz,uuid,uuid,uuid,uuid,text,integer)','EXECUTE')
  and not has_function_privilege('authenticated',
  'public.load_github_compliance_result_alert_candidates(timestamptz,uuid,uuid,uuid,uuid,text,integer)','EXECUTE'),
  'only the service role can load alert candidates');

set role service_role;
select is(pg_catalog.jsonb_array_length(public.load_github_compliance_result_alert_candidates(
  now(),'91000000-0000-4000-8000-000000000301','91000000-0000-4000-8000-000000000101',null,null,null,100
)->'candidates'),1,'the exact new run loads its current official result');
select is(pg_catalog.jsonb_array_length(public.load_github_compliance_result_alert_candidates(
  now(),'91000000-0000-4000-8000-000000000301','91000000-0000-4000-8000-000000000102',null,null,null,100
)->'candidates'),0,'the exact run cannot cross organisation scope');

select is(public.record_github_compliance_result_alert_decisions(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'organisationId','91000000-0000-4000-8000-000000000101',
    'repositoryId','91000000-0000-4000-8000-000000000202',
    'checkId','github.branch.status_checks',
    'expectedRevision',null,
    'currentResultId','91000000-0000-4000-8000-000000000402',
    'currentOutcome','unknown',
    'actionableUnknownSince',null,
    'nextActiveIncident',pg_catalog.jsonb_build_object('kind','stale','incidentKey',repeat('a',64),'startedAt',now()-interval '2 days'),
    'nextEvaluationAt',null,
    'event',pg_catalog.jsonb_build_object(
      'kind','stale','incidentKey',repeat('a',64),
      'idempotencyKey',pg_catalog.encode(extensions.digest('stale' || E'\n' || repeat('a',64),'sha256'),'hex'),
      'incidentStartedAt',now()-interval '2 days',
      'resultId','91000000-0000-4000-8000-000000000402',
      'recordUrl','https://dev.compliancehub.example/app/monitoring/github-results/91000000-0000-4000-8000-000000000402',
      'notificationMessage','A GitHub result is out of date. Repository: Alert-Test/repo.'
    )
  )), now()
)->>'notificationsCreated','2','first event creates owner and admin notifications');
select is((select count(*) from public.notifications where organisation_id='91000000-0000-4000-8000-000000000101'),2::bigint,
  'one in-app notice is created for each Owner and Admin');
reset role;

select is((select count(*) from public.notifications where user_id='91000000-0000-4000-8000-000000000003'),0::bigint,
  'members do not receive owner/admin compliance alerts');
select is((select count(*) from public.notifications where organisation_id='91000000-0000-4000-8000-000000000102'),0::bigint,
  'another organisation receives no compliance alerts');
select is((select revision from public.github_compliance_result_alert_states
  where organisation_id='91000000-0000-4000-8000-000000000101'
    and repository_id='91000000-0000-4000-8000-000000000202'
    and check_id='github.branch.status_checks'),1::bigint,
  'the first accepted state starts at revision one');

set role service_role;
select is(public.record_github_compliance_result_alert_decisions(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'organisationId','91000000-0000-4000-8000-000000000101',
    'repositoryId','91000000-0000-4000-8000-000000000202',
    'checkId','github.branch.status_checks',
    'expectedRevision',1,
    'currentResultId','91000000-0000-4000-8000-000000000402',
    'currentOutcome','unknown',
    'actionableUnknownSince',null,
    'nextActiveIncident',pg_catalog.jsonb_build_object('kind','stale','incidentKey',repeat('a',64),'startedAt',now()-interval '2 days'),
    'nextEvaluationAt',now()+interval '1 hour',
    'event',null
  )),now()
)->>'processed','1','the expected revision can be updated with a due time');
select is((select revision from public.github_compliance_result_alert_states
  where organisation_id='91000000-0000-4000-8000-000000000101'
    and repository_id='91000000-0000-4000-8000-000000000202'
    and check_id='github.branch.status_checks'),2::bigint,
  'a successful compare-and-swap increments revision');
select is(public.record_github_compliance_result_alert_decisions(
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'organisationId','91000000-0000-4000-8000-000000000101',
    'repositoryId','91000000-0000-4000-8000-000000000202',
    'checkId','github.branch.status_checks',
    'expectedRevision',1,
    'currentResultId','91000000-0000-4000-8000-000000000402',
    'currentOutcome','unknown','actionableUnknownSince',null,
    'nextActiveIncident',pg_catalog.jsonb_build_object('kind','stale','incidentKey',repeat('a',64),'startedAt',now()-interval '2 days'),
    'nextEvaluationAt',now()+interval '2 hour','event',null
  )),now()
)->>'conflicts','1','a stale expected revision is reported as a conflict');
select is((select revision from public.github_compliance_result_alert_states
  where organisation_id='91000000-0000-4000-8000-000000000101'
    and repository_id='91000000-0000-4000-8000-000000000202'
    and check_id='github.branch.status_checks'),2::bigint,
  'a stale compare-and-swap leaves state unchanged');
reset role;

select * from finish();
rollback;
