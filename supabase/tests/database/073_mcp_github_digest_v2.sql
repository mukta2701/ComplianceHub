-- Independent contracts for the coherent schema-v2 digest bundle. Official
-- lifecycle fixture coverage is extended below the structural boundary; every
-- row is transaction-local and rolled back.
begin;

select plan(60);

select has_function('public','get_mcp_compliance_bundle',array['uuid','date','integer','integer'],'digest v2: rolling-compatible v1 bundle remains present');
select function_returns('public','get_mcp_compliance_bundle',array['uuid','date','integer','integer'],'jsonb','digest v2: v1 return type is unchanged');
select is((select prosecdef from pg_catalog.pg_proc where oid='public.get_mcp_compliance_bundle(uuid,date,integer,integer)'::regprocedure),false,'digest v2: v1 remains security invoker');
select is((select provolatile::text from pg_catalog.pg_proc where oid='public.get_mcp_compliance_bundle(uuid,date,integer,integer)'::regprocedure),'s','digest v2: v1 remains stable');
select ok(has_function_privilege('authenticated','public.get_mcp_compliance_bundle(uuid,date,integer,integer)','EXECUTE'),'digest v2: v1 authenticated grant is preserved');
select ok(not has_function_privilege('anon','public.get_mcp_compliance_bundle(uuid,date,integer,integer)','EXECUTE'),'digest v2: v1 anonymous denial is preserved');
select ok(not has_function_privilege('service_role','public.get_mcp_compliance_bundle(uuid,date,integer,integer)','EXECUTE'),'digest v2: v1 service denial is preserved');

select has_function('public','get_mcp_compliance_bundle_v2',array['uuid','date','integer','integer','integer'],'digest v2: separate successor bundle exists');
select function_returns('public','get_mcp_compliance_bundle_v2',array['uuid','date','integer','integer','integer'],'jsonb','digest v2: successor returns one JSON document');
select is((select prosecdef from pg_catalog.pg_proc where oid='public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure),false,'digest v2: successor is security invoker');
select is((select provolatile::text from pg_catalog.pg_proc where oid='public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure),'s','digest v2: successor is stable');
select ok((select proconfig @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure),'digest v2: successor pins an empty search path');
select ok(has_function_privilege('authenticated','public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)','EXECUTE'),'digest v2: authenticated callers enter the RLS-scoped successor');
select ok(not has_function_privilege('anon','public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)','EXECUTE'),'digest v2: anonymous callers cannot execute the successor');
select ok(not has_function_privilege('service_role','public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)','EXECUTE'),'digest v2: service role has no digest read bypass');
select ok(pg_catalog.pg_get_functiondef('public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure) ~ 'github_official_compliance_results','digest v2: successor consumes the immutable official ledger');
select ok(pg_catalog.pg_get_functiondef('public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure) !~ 'github_observations','digest v2: successor never reconstructs facts from shadow observations');
select ok(pg_catalog.pg_get_functiondef('public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure) ~ 'row_number\(\) over \(partition by result.provider_repository_id, result.check_id','digest v2: latest stable identity is selected before classification');
select ok(pg_catalog.pg_get_functiondef('public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure) ~ 'fresh_until > .*as_of','digest v2: only strict greater-than freshness is current');
select ok(pg_catalog.pg_get_functiondef('public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure) ~ 'failed_observation_created' and pg_catalog.pg_get_functiondef('public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure) ~ 'failed_observation_reopened' and pg_catalog.pg_get_functiondef('public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure) ~ 'fresh_pass_resolved','digest v2: change kinds derive from immutable lifecycle reasons');
select ok(pg_catalog.pg_get_functiondef('public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure) ~ 'supersedes_evidence_id','digest v2: superseding pass derives from immutable evidence lineage');
select ok(pg_catalog.pg_get_functiondef('public.get_mcp_compliance_bundle_v2(uuid,date,integer,integer,integer)'::regprocedure) ~ 'official_event_ledger','digest v2: change deltas use the all-official event ledger independently of latest-state collapse');

select has_function('public','get_mcp_prior_delivered_digest_baseline',array['uuid','date'],'digest v2: narrow prior-delivery baseline helper exists');
select is((select prosecdef from pg_catalog.pg_proc where oid='public.get_mcp_prior_delivered_digest_baseline(uuid,date)'::regprocedure),true,'digest v2: prior-delivery baseline helper is the narrow trusted boundary');
select is((select provolatile::text from pg_catalog.pg_proc where oid='public.get_mcp_prior_delivered_digest_baseline(uuid,date)'::regprocedure),'s','digest v2: prior-delivery baseline helper is stable');
select ok((select proconfig @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.get_mcp_prior_delivered_digest_baseline(uuid,date)'::regprocedure),'digest v2: prior-delivery baseline helper pins an empty search path');
select ok(has_function_privilege('authenticated','public.get_mcp_prior_delivered_digest_baseline(uuid,date)','EXECUTE'),'digest v2: authenticated callers may request only their membership-scoped safe baseline');
select ok(not has_function_privilege('anon','public.get_mcp_prior_delivered_digest_baseline(uuid,date)','EXECUTE'),'digest v2: anonymous callers cannot execute the baseline helper');
select ok(not has_function_privilege('service_role','public.get_mcp_prior_delivered_digest_baseline(uuid,date)','EXECUTE'),'digest v2: service role has no baseline helper bypass');
select ok(pg_catalog.pg_get_functiondef('public.get_mcp_prior_delivered_digest_baseline(uuid,date)'::regprocedure) ~ 'memberships' and pg_catalog.pg_get_functiondef('public.get_mcp_prior_delivered_digest_baseline(uuid,date)'::regprocedure) ~ 'auth.uid\(\)','digest v2: baseline helper enforces authenticated organisation membership internally');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('76000000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-v2-owner@example.test','',now(),'{}','{}'),
 ('76000000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-v2-admin@example.test','',now(),'{}','{}'),
 ('76000000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-v2-member@example.test','',now(),'{}','{}'),
 ('76000000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','digest-v2-outsider@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
 ('76000000-0000-4000-8000-000000000001','Digest V2 Workspace','digest-v2-workspace','76000000-0000-4000-8000-000000000011'),
 ('76000000-0000-4000-8000-000000000002','Digest V2 Outsider','digest-v2-outsider','76000000-0000-4000-8000-000000000014');
insert into public.memberships(organisation_id,user_id,role) values
 ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000011','owner'),
 ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000012','admin'),
 ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000013','member'),
 ('76000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000014','owner');
insert into public.alert_channels(id,organisation_id,type,label,config,min_severity,connected_by,enabled,daily_digest_enabled) values
 ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001','slack','Fixture','{}','high','76000000-0000-4000-8000-000000000011',true,true);
insert into public.daily_digest_deliveries(id,organisation_id,digest_on,channel_id,fact_hash,message,attempted_by,status,error_code,delivered_at) values
 ('76000000-0000-4000-8000-000000000201','76000000-0000-4000-8000-000000000001','2026-08-06','76000000-0000-4000-8000-000000000101',repeat('a',64),'{"text":"prior","blocks":[]}','76000000-0000-4000-8000-000000000011','delivered',null,'2026-08-06T08:00:00Z'),
 ('76000000-0000-4000-8000-000000000202','76000000-0000-4000-8000-000000000001','2026-08-07','76000000-0000-4000-8000-000000000101',repeat('b',64),'{"text":"failed","blocks":[]}','76000000-0000-4000-8000-000000000011','failed','INTERNAL_ERROR',null);

insert into public.github_installations(
 id,organisation_id,provider_installation_id,account_id,account_login,account_type,
 repository_selection,status,connected_by,permissions,permissions_ok
) values (
 '76000000-0000-4000-8000-000000000301','76000000-0000-4000-8000-000000000001',76301,76302,
 'Digest-Fixture','Organization','selected','active','76000000-0000-4000-8000-000000000011','{"metadata":"read"}',true
);
insert into public.github_repositories(
 id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
 html_url,visibility,default_branch,archived,selected,available
) values (
 '76000000-0000-4000-8000-000000000302','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000301',76303,
 'Digest-Fixture','private-repository','Digest-Fixture/private-repository','https://github.com/Digest-Fixture/private-repository',
 'private','main',false,true,true
);

insert into public.github_mapping_packs(id,version,title) values (
 '76000000-0000-4000-8000-000000000305','digest-historical-v1','Digest historical mapping fixture'
);
insert into public.github_mapping_entries(
 mapping_pack_id,check_id,rule_version,iso_control_references,failure_severity,remediation,treatments
)
select '76000000-0000-4000-8000-000000000305',entry.check_id,entry.rule_version,
       entry.iso_control_references,entry.failure_severity,entry.remediation,entry.treatments
from public.github_mapping_entries as entry
join public.github_mapping_packs as pack on pack.id=entry.mapping_pack_id
where pack.version='github-iso-27001-v1';
select set_config('app.digest_changed_pack_checksum',public.github_mapping_pack_checksum('76000000-0000-4000-8000-000000000305'),true);
select public.seal_github_mapping_pack_server('digest-historical-v1',current_setting('app.digest_changed_pack_checksum'));

insert into public.github_mapping_approvals(
 id,organisation_id,mapping_pack_id,approved_by,approved_at,revoked_by,revoked_at
)
select '76000000-0000-4000-8000-000000000303','76000000-0000-4000-8000-000000000001',pack.id,
       '76000000-0000-4000-8000-000000000011',now()-interval '10 days',
       '76000000-0000-4000-8000-000000000011',now()-interval '5 days'
from public.github_mapping_packs as pack where pack.version='github-iso-27001-v1';
insert into public.github_mapping_approvals(
 id,organisation_id,mapping_pack_id,approved_by,approved_at,revoked_by,revoked_at
) values (
 '76000000-0000-4000-8000-000000000306','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000305',
 '76000000-0000-4000-8000-000000000011',now(),
 '76000000-0000-4000-8000-000000000011',now()
);
insert into public.github_mapping_approvals(id,organisation_id,mapping_pack_id,approved_by)
select '76000000-0000-4000-8000-000000000304','76000000-0000-4000-8000-000000000001',pack.id,
       '76000000-0000-4000-8000-000000000011'
from public.github_mapping_packs as pack where pack.version='github-iso-27001-v1';

create or replace function pg_temp.seed_digest_official(
  result_id uuid, run_id uuid, observation_id uuid, check_id text,
  outcome public.github_observation_result, observed_at timestamptz,
  fresh_until timestamptz, materialised_at timestamptz, approval_id uuid
) returns void language plpgsql as $$
declare diagnostic text;
begin
  diagnostic := case when outcome='unknown' then 'permission_denied' else null end;
  insert into public.github_collection_runs(
    id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
    status,started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,not_applicable_count
  ) values (
    run_id,'76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000301',
    '76000000-0000-4000-8000-000000000302',76303,'manual','digest-'||run_id,'succeeded',
    observed_at-interval '1 minute',observed_at,1,
    case when outcome='pass' then 1 else 0 end,case when outcome='fail' then 1 else 0 end,
    case when outcome='unknown' then 1 else 0 end,case when outcome='not_applicable' then 1 else 0 end
  );
  insert into public.github_observations(
    id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
    observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
    remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
  ) values (
    observation_id,'76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000301',
    '76000000-0000-4000-8000-000000000302',76303,run_id,'digest-'||observation_id,check_id,
    'github-repository-v1','github_repository','Provider-controlled private subject',outcome,
    case when outcome='fail' then 'high' else null end,'Provider-controlled title','Provider-controlled explanation',
    case when outcome='fail' then 'Provider-controlled remediation' else null end,
    observed_at,fresh_until,'https://github.test/private/'||observation_id,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(observation_id::text,'UTF8'),'sha256'),'hex'),diagnostic
  );
  insert into public.github_official_compliance_results(
    id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,
    approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,
    failure_severity,catalogue_summary,observed_at,fresh_until,materialised_at
  )
  select result_id,observation.organisation_id,observation.installation_id,observation.repository_id,
         observation.provider_repository_id,observation.collection_run_id,observation.id,approval.id,
         pack.id,pack.version,pack.checksum,observation.check_id,observation.rule_version,observation.result,
         case when observation.result='fail' then 'high'::public.monitor_severity else null end,
         'Approved catalogue summary for '||check_id,observation.observed_at,observation.fresh_until,materialised_at
  from public.github_observations as observation
  join public.github_mapping_approvals as approval on approval.id=approval_id and approval.organisation_id=observation.organisation_id
  join public.github_mapping_packs as pack on pack.id=approval.mapping_pack_id
  where observation.id=observation_id;
end;
$$;

select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000401','76000000-0000-4000-8000-000000000501','76000000-0000-4000-8000-000000000601','digest.repeat_failure','fail',now()-interval '15 hours',now()+interval '1 day',now()-interval '14 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000411','76000000-0000-4000-8000-000000000512','76000000-0000-4000-8000-000000000615','digest.repeat_failure','fail',now()-interval '13 hours',now()+interval '1 day',now()-interval '12 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000402','76000000-0000-4000-8000-000000000502','76000000-0000-4000-8000-000000000602','digest.fail_pass','fail',now()-interval '11 hours',now()+interval '1 day',now()-interval '10 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000403','76000000-0000-4000-8000-000000000503','76000000-0000-4000-8000-000000000603','digest.fail_pass','pass',now()-interval '9 hours',now()+interval '1 day',now()-interval '8 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000412','76000000-0000-4000-8000-000000000513','76000000-0000-4000-8000-000000000612','digest.fail_pass_fail','fail',now()-interval '7 hours',now()+interval '1 day',now()-interval '6 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000413','76000000-0000-4000-8000-000000000514','76000000-0000-4000-8000-000000000613','digest.fail_pass_fail','pass',now()-interval '5 hours',now()+interval '1 day',now()-interval '4 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000414','76000000-0000-4000-8000-000000000515','76000000-0000-4000-8000-000000000614','digest.fail_pass_fail','fail',now()-interval '3 hours',now()+interval '1 day',now()-interval '2 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000404','76000000-0000-4000-8000-000000000504','76000000-0000-4000-8000-000000000604','digest.superseding_pass','pass',now()-interval '6 hours',now()+interval '1 day',now()-interval '5 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000405','76000000-0000-4000-8000-000000000505','76000000-0000-4000-8000-000000000605','digest.unknown_a','unknown',now()-interval '5 hours',now()+interval '1 day',now()-interval '4 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000406','76000000-0000-4000-8000-000000000506','76000000-0000-4000-8000-000000000606','digest.unknown_b','unknown',now()-interval '4 hours',now()+interval '1 day',now()-interval '3 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000407','76000000-0000-4000-8000-000000000507','76000000-0000-4000-8000-000000000607','digest.not_applicable','not_applicable',now()-interval '3 hours',now()+interval '1 day',now()-interval '2 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000408','76000000-0000-4000-8000-000000000508','76000000-0000-4000-8000-000000000608','digest.stale','pass',now()-interval '1 day',now(),now()-interval '10 hours','76000000-0000-4000-8000-000000000304');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000409','76000000-0000-4000-8000-000000000509','76000000-0000-4000-8000-000000000609','digest.reapproved_same_pack','unknown',now()-interval '2 hours',now()+interval '1 day',now()-interval '90 minutes','76000000-0000-4000-8000-000000000303');
select pg_temp.seed_digest_official('76000000-0000-4000-8000-000000000410','76000000-0000-4000-8000-000000000511','76000000-0000-4000-8000-000000000611','digest.changed_pack','unknown',now()-interval '90 minutes',now()+interval '1 day',now()-interval '1 hour','76000000-0000-4000-8000-000000000306');

set session_replication_role = replica;
insert into public.monitoring_findings(
 id,organisation_id,check_id,control_ref,subject_type,subject_id,severity,title,status,detected_at,
 finding_origin,provider_repository_id,mapping_version
) values
 ('76000000-0000-4000-8000-000000000701','76000000-0000-4000-8000-000000000001','digest.repeat_failure','A.8.32','github_repository','digest-repeat-failure','high','Approved repeated failure','open',now()-interval '15 hours','github',76303,'github-iso-27001-v1'),
 ('76000000-0000-4000-8000-000000000702','76000000-0000-4000-8000-000000000001','digest.fail_pass','A.8.32','github_repository','digest-fail-pass','high','Approved fail then pass','resolved',now()-interval '11 hours','github',76303,'github-iso-27001-v1'),
 ('76000000-0000-4000-8000-000000000703','76000000-0000-4000-8000-000000000001','digest.fail_pass_fail','A.8.32','github_repository','digest-fail-pass-fail','high','Approved fail pass fail','open',now()-interval '7 hours','github',76303,'github-iso-27001-v1');
set session_replication_role = origin;
insert into public.github_finding_transitions(
 id,organisation_id,finding_id,from_status,to_status,reason,observation_id,approval_id,mapping_pack_id,mapping_version,occurred_at
)
select transition.id,'76000000-0000-4000-8000-000000000001',transition.finding_id,
       transition.from_status::public.monitor_finding_status,transition.to_status::public.monitor_finding_status,
       transition.reason,transition.observation_id,'76000000-0000-4000-8000-000000000304',pack.id,pack.version,transition.occurred_at
from (values
 ('76000000-0000-4000-8000-000000000711'::uuid,'76000000-0000-4000-8000-000000000701'::uuid,null::text,'open','failed_observation_created','76000000-0000-4000-8000-000000000601'::uuid,now()-interval '14 hours'),
 ('76000000-0000-4000-8000-000000000712'::uuid,'76000000-0000-4000-8000-000000000702'::uuid,null::text,'open','failed_observation_created','76000000-0000-4000-8000-000000000602'::uuid,now()-interval '10 hours'),
 ('76000000-0000-4000-8000-000000000713'::uuid,'76000000-0000-4000-8000-000000000702'::uuid,'open','resolved','fresh_pass_resolved','76000000-0000-4000-8000-000000000603'::uuid,now()-interval '8 hours'),
 ('76000000-0000-4000-8000-000000000714'::uuid,'76000000-0000-4000-8000-000000000703'::uuid,null::text,'open','failed_observation_created','76000000-0000-4000-8000-000000000612'::uuid,now()-interval '6 hours'),
 ('76000000-0000-4000-8000-000000000715'::uuid,'76000000-0000-4000-8000-000000000703'::uuid,'open','resolved','fresh_pass_resolved','76000000-0000-4000-8000-000000000613'::uuid,now()-interval '4 hours'),
 ('76000000-0000-4000-8000-000000000716'::uuid,'76000000-0000-4000-8000-000000000703'::uuid,'resolved','open','failed_observation_reopened','76000000-0000-4000-8000-000000000614'::uuid,now()-interval '2 hours')
) as transition(id,finding_id,from_status,to_status,reason,observation_id,occurred_at)
cross join public.github_mapping_packs as pack
where pack.version='github-iso-27001-v1';

insert into public.evidence(id,organisation_id,title,kind,url,description,owner_id,collected_on,valid_until,status,created_by) values
 ('76000000-0000-4000-8000-000000000721','76000000-0000-4000-8000-000000000001','Earlier approved evidence','link','https://example.test/earlier','Earlier approved evidence fixture.','76000000-0000-4000-8000-000000000011',current_date-1,current_date,'superseded','76000000-0000-4000-8000-000000000011'),
 ('76000000-0000-4000-8000-000000000722','76000000-0000-4000-8000-000000000001','Current approved evidence','link','https://example.test/current','Current approved evidence fixture.','76000000-0000-4000-8000-000000000011',current_date,current_date+1,'current','76000000-0000-4000-8000-000000000011');
set session_replication_role = replica;
insert into public.github_evidence_provenance(
 id,evidence_id,organisation_id,installation_id,repository_id,collection_run_id,observation_id,
 approval_id,mapping_pack_id,identity_key,check_id,rule_version,mapping_version,supersedes_evidence_id,
 observed_at,fresh_until
)
select '76000000-0000-4000-8000-000000000723','76000000-0000-4000-8000-000000000722',
       '76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000301',
       '76000000-0000-4000-8000-000000000302','76000000-0000-4000-8000-000000000504',
       '76000000-0000-4000-8000-000000000604','76000000-0000-4000-8000-000000000304',pack.id,
       repeat('c',64),'digest.superseding_pass','github-repository-v1',pack.version,
       '76000000-0000-4000-8000-000000000721',now()-interval '6 hours',now()+interval '1 day'
from public.github_mapping_packs as pack where pack.version='github-iso-27001-v1';
set session_replication_role = origin;

set role authenticated;
select set_config('request.jwt.claims','{"sub":"76000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select set_config('app.digest_v2_owner',public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,20)::text,true);
select is((current_setting('app.digest_v2_owner')::jsonb->>'schemaVersion')::integer,2,'digest v2 fixture: Owner receives schema version two');
select is(current_setting('app.digest_v2_owner')::jsonb#>'{github,partition}','{"activeCurrentPass":2,"activeCurrentFail":2,"activeCurrentUnknown":3,"activeCurrentNotApplicable":1,"activeStale":1,"historical":1,"total":10}'::jsonb,'digest v2 fixture: latest official identities form the exact active-current, stale, and historical partition');
select ok((select sum(value::integer) from pg_catalog.jsonb_each_text((current_setting('app.digest_v2_owner')::jsonb#>'{github,partition}') - 'total'))=(current_setting('app.digest_v2_owner')::jsonb#>>'{github,partition,total}')::integer,'digest v2 fixture: disjoint partition sums exactly to total');
select is(current_setting('app.digest_v2_owner')::jsonb#>'{github,changes,counts}','{"newFailure":3,"reopen":1,"resolution":2,"supersedingPass":1,"total":7}'::jsonb,'digest v2 fixture: immutable transitions and evidence lineage preserve every exact lifecycle event count');
select is((select pg_catalog.jsonb_agg(item.value->>'kind' order by item.ordinal)
           from pg_catalog.jsonb_array_elements(current_setting('app.digest_v2_owner')::jsonb#>'{github,changes,items}')
                with ordinality as item(value,ordinal)),
          '["reopen","resolution","superseding_pass","new_failure","resolution","new_failure","new_failure"]'::jsonb,
          'digest v2 fixture: change items retain deterministic materialisation order');
select ok(current_setting('app.digest_v2_owner')::jsonb#>'{github,changes,items}' @> '[{"kind":"new_failure","resultId":"github_result:76000000-0000-4000-8000-000000000401","checkId":"digest.repeat_failure","result":"fail"}]'::jsonb and current_setting('app.digest_v2_owner')::jsonb#>'{github,recommendedActions,items}' @> '[{"id":"github_result:76000000-0000-4000-8000-000000000411","checkId":"digest.repeat_failure","result":"fail"}]'::jsonb,'digest v2 fixture: new fail then repeated unchanged fail retains the original new-failure event and latest fail state');
select ok(current_setting('app.digest_v2_owner')::jsonb#>'{github,changes,items}' @> '[{"kind":"new_failure","resultId":"github_result:76000000-0000-4000-8000-000000000402","checkId":"digest.fail_pass","result":"fail"},{"kind":"resolution","resultId":"github_result:76000000-0000-4000-8000-000000000403","checkId":"digest.fail_pass","result":"pass"}]'::jsonb and not (current_setting('app.digest_v2_owner')::jsonb#>'{github,recommendedActions,items}' @> '[{"checkId":"digest.fail_pass"}]'::jsonb),'digest v2 fixture: fail then pass retains new-failure and resolution events while latest state is pass');
select ok(current_setting('app.digest_v2_owner')::jsonb#>'{github,changes,items}' @> '[{"kind":"new_failure","resultId":"github_result:76000000-0000-4000-8000-000000000412","checkId":"digest.fail_pass_fail","result":"fail"},{"kind":"resolution","resultId":"github_result:76000000-0000-4000-8000-000000000413","checkId":"digest.fail_pass_fail","result":"pass"},{"kind":"reopen","resultId":"github_result:76000000-0000-4000-8000-000000000414","checkId":"digest.fail_pass_fail","result":"fail"}]'::jsonb and current_setting('app.digest_v2_owner')::jsonb#>'{github,recommendedActions,items}' @> '[{"id":"github_result:76000000-0000-4000-8000-000000000414","checkId":"digest.fail_pass_fail","result":"fail"}]'::jsonb,'digest v2 fixture: fail then pass then fail retains new-failure, resolution, and reopen events while latest state is fail');
select ok(current_setting('app.digest_v2_owner')::jsonb#>>'{github,staleResults,items,0,checkId}'='digest.stale' and (current_setting('app.digest_v2_owner')::jsonb#>>'{github,staleResults,count}')::integer=1,'digest v2 fixture: fresh-until equality is classified stale with its full count');
select ok(current_setting('app.digest_v2_owner')::jsonb#>'{github,unknowns,items}' @> '[{"checkId":"digest.reapproved_same_pack"}]'::jsonb and not (current_setting('app.digest_v2_owner')::jsonb#>'{github,unknowns,items}' @> '[{"checkId":"digest.changed_pack"}]'::jsonb),'digest v2 fixture: same-pack reapproval remains active while an exact mapping-identity change is historical');
select is(current_setting('app.digest_v2_owner')::jsonb#>>'{github,baseline,localDate}','2026-08-06','digest v2 fixture: baseline selects latest prior delivered local date');
select is(current_setting('app.digest_v2_owner')::jsonb#>>'{github,baseline,deliveredAt}','2026-08-06T08:00:00+00:00','digest v2 fixture: baseline exposes exact delivery time');
select ok((public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,1)#>>'{github,unknowns,count}')::integer=3 and (public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,1)#>>'{github,unknowns,truncated}')::boolean and pg_catalog.jsonb_array_length(public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,1)#>'{github,unknowns,items}')=1,'digest v2 fixture: unknown full count survives deterministic page truncation');
select ok((public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,1)#>>'{github,changes,counts,total}')::integer=7 and (public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,1)#>>'{github,changes,truncated}')::boolean and pg_catalog.jsonb_array_length(public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,1)#>'{github,changes,items}')=1,'digest v2 fixture: change full count survives deterministic page truncation');
select is(current_setting('app.digest_v2_owner')::jsonb#>>'{delivery,factHash}',repeat('b',64),'digest v2 fixture: Owner receives immutable current delivery hash');
select ok(current_setting('app.digest_v2_owner') !~ '"(providerRepositoryId|providerInstallationId|sourceUrl|explanation|remediation|accountLogin|ownerLogin|fullName|htmlUrl|actorId|memberId|webhook|config)"[[:space:]]*:','digest v2 fixture: bundle excludes provider, actor, destination, and raw-content keys');
select is(current_setting('app.digest_v2_owner')::jsonb#>>'{github,recommendedActions,items,0,repositoryLabel}','GitHub repository 76000000','digest v2 fixture: repository labels derive only from the local repository UUID');
select is(current_setting('app.digest_v2_owner')::jsonb#>>'{github,recommendedActions,items,0,summary}','Approved catalogue summary for digest.fail_pass_fail','digest v2 fixture: recommended facts expose only approved catalogue wording');
select is((public.get_mcp_compliance_bundle('76000000-0000-4000-8000-000000000001','2026-08-07',20,20)->>'schemaVersion')::integer,1,'digest v2 fixture: rolling-compatible v1 still returns schema one');

reset role;
insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,status,
 started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,not_applicable_count
) values (
 '76000000-0000-4000-8000-000000000510','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000301',
 '76000000-0000-4000-8000-000000000302',76303,'manual','digest-shadow-only','succeeded',now()-interval '2 minutes',now()-interval '1 minute',1,0,1,0,0
);
insert into public.github_observations(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
 remediation,observed_at,fresh_until,source_url,fingerprint
) values (
 '76000000-0000-4000-8000-000000000610','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000301',
 '76000000-0000-4000-8000-000000000302',76303,'76000000-0000-4000-8000-000000000510','digest-shadow-only',
 'digest.new_failure','github-repository-v1','github_repository','Provider shadow subject','fail','critical',
 'Unapproved provider title','Unapproved provider explanation','Unapproved provider remediation',now()-interval '1 minute',now()+interval '1 day',
 'https://github.test/private/shadow',repeat('d',64)
);
set role authenticated;
select set_config('request.jwt.claims','{"sub":"76000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select is(public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,20)->'github',current_setting('app.digest_v2_owner')::jsonb->'github','digest v2 fixture: newer raw shadow content and provider ordering cannot change official facts');
select is(public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,20)->'github',public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,20)->'github','digest v2 fixture: repeat reads and replay-equivalent state remain byte-for-byte deterministic');
select set_config('request.jwt.claims','{"sub":"76000000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select set_config('app.digest_v2_admin',public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,20)::text,true);
select is(current_setting('app.digest_v2_admin')::jsonb#>'{github,baseline}',current_setting('app.digest_v2_owner')::jsonb#>'{github,baseline}','digest v2 fixture: Admin receives the same safe prior-delivery baseline as Owner');
select is(current_setting('app.digest_v2_admin')::jsonb#>'{github,changes}',current_setting('app.digest_v2_owner')::jsonb#>'{github,changes}','digest v2 fixture: Admin receives the same verified deltas as Owner');
select is(current_setting('app.digest_v2_admin')::jsonb->'delivery','null'::jsonb,'digest v2 fixture: Admin delivery metadata remains redacted');
select set_config('request.jwt.claims','{"sub":"76000000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select set_config('app.digest_v2_member',public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,20)::text,true);
select is(current_setting('app.digest_v2_member')::jsonb#>'{github,baseline}',current_setting('app.digest_v2_owner')::jsonb#>'{github,baseline}','digest v2 fixture: Member receives the same safe prior-delivery baseline as Owner');
select is(current_setting('app.digest_v2_member')::jsonb#>'{github,changes}',current_setting('app.digest_v2_owner')::jsonb#>'{github,changes}','digest v2 fixture: Member receives the same verified deltas as Owner');
select is(current_setting('app.digest_v2_member')::jsonb->'delivery','null'::jsonb,'digest v2 fixture: Member delivery metadata remains redacted');
select set_config('request.jwt.claims','{"sub":"76000000-0000-4000-8000-000000000014","role":"authenticated"}',true);
select is(public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000001','2026-08-07',20,20,20),null::jsonb,'digest v2 fixture: outsider receives no cross-tenant bundle');
select is((select count(*) from public.get_mcp_prior_delivered_digest_baseline('76000000-0000-4000-8000-000000000001','2026-08-07')),0::bigint,'digest v2 fixture: outsider cannot read even the narrow cross-tenant baseline');
select ok(public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000002','2026-08-07',20,20,20)#>'{github,baseline}'='null'::jsonb and (public.get_mcp_compliance_bundle_v2('76000000-0000-4000-8000-000000000002','2026-08-07',20,20,20)#>>'{github,changes,counts,total}')::integer=0,'digest v2 fixture: workspace without a prior delivery has an explicit null baseline and no invented changes');
reset role;

select * from finish();
rollback;
