begin;

select no_plan();

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('76000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-job-wake-owner-a@example.test','',now(),'{}','{}'),
 ('76000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-job-wake-owner-b@example.test','',now(),'{}','{}'),
 ('76000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-job-wake-owner-c@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
 ('76000000-0000-4000-8000-000000000101','M2 Job Wake Org A','m2-job-wake-a','76000000-0000-4000-8000-000000000001'),
 ('76000000-0000-4000-8000-000000000102','M2 Job Wake Org B','m2-job-wake-b','76000000-0000-4000-8000-000000000002'),
 ('76000000-0000-4000-8000-000000000103','M2 Job Wake Org C','m2-job-wake-c','76000000-0000-4000-8000-000000000003');
insert into public.memberships(organisation_id,user_id,role) values
 ('76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001','owner'),
 ('76000000-0000-4000-8000-000000000102','76000000-0000-4000-8000-000000000002','owner'),
 ('76000000-0000-4000-8000-000000000103','76000000-0000-4000-8000-000000000003','owner');

select public.select_github_mapping_pack_server(
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001',
  'github-iso-27001-v1',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-v1'),0
);
select public.select_github_mapping_pack_server(
  '76000000-0000-4000-8000-000000000102','76000000-0000-4000-8000-000000000002',
  'github-iso-27001-v1',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-v1'),0
);

-- A second published pack keeps the same check/rule set but changes the
-- force-push mapping digest, allowing the selection-change wake to be tested.
insert into public.github_mapping_packs(id,version,title) values
 ('76000000-0000-4000-8000-000000000601','github-iso-27001-m2-job-wake-v2','M2 job wake test pack');
insert into public.github_mapping_entries(
 mapping_pack_id,check_id,rule_version,iso_control_references,
 failure_severity,remediation,treatments
)
select '76000000-0000-4000-8000-000000000601',entry.check_id,entry.rule_version,
       entry.iso_control_references,entry.failure_severity,
       case when entry.check_id='github.branch.force_pushes'
         then entry.remediation || ' Confirm this pack selection in the test.'
         else entry.remediation end,
       entry.treatments
from public.github_mapping_entries entry
join public.github_mapping_packs pack on pack.id=entry.mapping_pack_id
where pack.version='github-iso-27001-v1';
select public.seal_github_mapping_pack_server(
  'github-iso-27001-m2-job-wake-v2',
  public.github_mapping_pack_checksum('76000000-0000-4000-8000-000000000601')
);

select public.select_github_mapping_pack_server(
  '76000000-0000-4000-8000-000000000103','76000000-0000-4000-8000-000000000003',
  'github-iso-27001-m2-job-wake-v2',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-m2-job-wake-v2'),0
);
select public.record_github_mapping_entry_decision_server(
  '76000000-0000-4000-8000-000000000103','76000000-0000-4000-8000-000000000003',
  (select id from public.github_mapping_entries where mapping_pack_id='76000000-0000-4000-8000-000000000601'
    and check_id='github.branch.force_pushes'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id='76000000-0000-4000-8000-000000000601'
      and check_id='github.branch.force_pushes')),
  'approved',1
);
select public.select_github_mapping_pack_server(
  '76000000-0000-4000-8000-000000000103','76000000-0000-4000-8000-000000000003',
  'github-iso-27001-v1',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-v1'),2
);

insert into public.github_installations(
 id,organisation_id,provider_installation_id,account_id,account_login,account_type,
 repository_selection,status,connected_by,permissions,permissions_ok
) values
 ('76000000-0000-4000-8000-000000000201','76000000-0000-4000-8000-000000000101',76001,76101,'Wake-A','Organization','selected','active','76000000-0000-4000-8000-000000000001','{}',true),
 ('76000000-0000-4000-8000-000000000202','76000000-0000-4000-8000-000000000102',76002,76102,'Wake-B','Organization','selected','active','76000000-0000-4000-8000-000000000002','{}',true),
 ('76000000-0000-4000-8000-000000000203','76000000-0000-4000-8000-000000000103',76003,76103,'Wake-C','Organization','selected','active','76000000-0000-4000-8000-000000000003','{}',true);
insert into public.github_repositories(
 id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
 html_url,visibility,default_branch,archived,selected,available
) values
 ('76000000-0000-4000-8000-000000000301','76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000201',76201,'Wake-A','portal','Wake-A/portal','https://github.com/Wake-A/portal','private','main',false,true,true),
 ('76000000-0000-4000-8000-000000000302','76000000-0000-4000-8000-000000000102','76000000-0000-4000-8000-000000000202',76202,'Wake-B','portal','Wake-B/portal','https://github.com/Wake-B/portal','private','main',false,true,true),
 ('76000000-0000-4000-8000-000000000303','76000000-0000-4000-8000-000000000103','76000000-0000-4000-8000-000000000203',76203,'Wake-C','portal','Wake-C/portal','https://github.com/Wake-C/portal','private','main',false,true,true);

insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,
 trigger_type,request_key,status,started_at,completed_at,observation_count,
 passed_count,failed_count,unknown_count,not_applicable_count,
 lease_token,lease_expires_at,attempt
) values
 ('76000000-0000-4000-8000-000000000401','76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000201','76000000-0000-4000-8000-000000000301',76201,'manual','m2-job-wake-a','succeeded',now()-interval '1 hour',now(),15,15,0,0,0,extensions.gen_random_uuid(),now()-interval '1 minute',1),
 ('76000000-0000-4000-8000-000000000402','76000000-0000-4000-8000-000000000102','76000000-0000-4000-8000-000000000202','76000000-0000-4000-8000-000000000302',76202,'manual','m2-job-wake-b','succeeded',now()-interval '1 hour',now(),15,15,0,0,0,extensions.gen_random_uuid(),now()-interval '1 minute',1),
 ('76000000-0000-4000-8000-000000000403','76000000-0000-4000-8000-000000000103','76000000-0000-4000-8000-000000000203','76000000-0000-4000-8000-000000000303',76203,'manual','m2-job-wake-c','succeeded',now()-interval '1 hour',now(),15,15,0,0,0,extensions.gen_random_uuid(),now()-interval '1 minute',1);
insert into public.github_observations(
 organisation_id,installation_id,repository_id,provider_repository_id,
 collection_run_id,observation_key,check_id,rule_version,subject_type,subject_id,
 result,title,explanation,observed_at,fresh_until,source_url,fingerprint
) select run.organisation_id, run.installation_id, run.repository_id,
         run.provider_repository_id, run.id,
         repository.full_name || '/' || entry.check_id || '/' || entry.rule_version,
         entry.check_id, entry.rule_version, 'github_repository', repository.full_name,
         'pass', 'Official check: ' || entry.check_id,
         'The official check was observed for the test repository.',
         now()-interval '1 minute', now()+interval '1 day', repository.html_url,
         encode(extensions.digest(convert_to(run.id::text || entry.id::text,'UTF8'),'sha256'),'hex')
  from public.github_collection_runs run
  join public.github_repositories repository on repository.id = run.repository_id
  join public.github_mapping_pack_selections selection on selection.organisation_id = run.organisation_id
  join public.github_mapping_entries entry on entry.mapping_pack_id = selection.mapping_pack_id
 where run.id in ('76000000-0000-4000-8000-000000000401','76000000-0000-4000-8000-000000000402','76000000-0000-4000-8000-000000000403');

select public.record_github_mapping_entry_decision_server(
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries where mapping_pack_id=(
    select id from public.github_mapping_packs where version='github-iso-27001-v1'
  ) and check_id='github.branch.force_pushes'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
      and check_id='github.branch.force_pushes')),
  'rejected',1
);

set role service_role;
select is((select count(*) from public.claim_github_materialisation_jobs_server(
  1,array['76000000-0000-4000-8000-000000000401'::uuid]
)),1::bigint,'the exact official run has one claimable job');
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  (select attempt_count from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  'awaiting_approval'
),'a run with no currently approved observation parks for review');
select is((select count(*) from public.claim_github_materialisation_jobs_server(
  1,array['76000000-0000-4000-8000-000000000402'::uuid]
)),1::bigint,'the sibling workspace run has an independent job');
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000402'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000402'),
  (select attempt_count from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000402'),
  'awaiting_approval'
),'the sibling workspace run also parks without its own approval');
select is((select count(*) from public.claim_github_materialisation_jobs_server(
  1,array['76000000-0000-4000-8000-000000000403'::uuid]
)),1::bigint,'the third exact official run also has one claimable job');
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000403'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000403'),
  (select attempt_count from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000403'),
  'awaiting_approval'
),'the run with an approval for a different selected pack parks for review');
reset role;

select is((select status from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  'awaiting_approval','an explicit rejection does not wake the matching run');
select is((select status from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000402'),
  'awaiting_approval','an approval event in another workspace cannot wake this run');
select public.record_github_mapping_entry_decision_server(
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries where mapping_pack_id=(
    select id from public.github_mapping_packs where version='github-iso-27001-v1'
  ) and check_id='github.branch.force_pushes'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
      and check_id='github.branch.force_pushes')),
  'approved',2
);
select is((select status from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  'pending','a current approval for an exact observation wakes its parked run');
select is((select status from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000402'),
  'awaiting_approval','waking the approved workspace leaves the sibling job parked');

-- Materialise one approved result, then let a new approval arrive during the
-- final leased attempt. The result proves that this is genuinely new work.
select public.materialise_github_approved_entries_server(
  '76000000-0000-4000-8000-000000000101',
  '76000000-0000-4000-8000-000000000401',
  'github-iso-27001-v1',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-v1'),
  (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'observation_id', observation.id,
      'treatment_kind', case when observation.result='pass' then 'evidence'
        when observation.result='fail' then 'finding' else 'explanatory' end,
      'iso_control_references', pg_catalog.to_jsonb(entry.iso_control_references),
      'failure_severity', entry.failure_severity,
      'remediation', entry.remediation
    ))
    from public.github_observations observation
    join public.github_mapping_entries entry
      on entry.mapping_pack_id=(select id from public.github_mapping_packs
        where version='github-iso-27001-v1')
     and entry.check_id=observation.check_id
     and entry.rule_version=observation.rule_version
    where observation.collection_run_id='76000000-0000-4000-8000-000000000401'
      and observation.check_id='github.branch.force_pushes'
  )
);
select is((select count(*) from public.github_official_compliance_results
  where collection_run_id='76000000-0000-4000-8000-000000000401'),
  1::bigint,'the earlier approved entry has a real official result before the race');

update public.github_materialisation_jobs
set status='pending',attempt_count=24,available_at=now(),
    completed_at=null,lease_token=null,lease_expires_at=null,
    lease_attempt_incremented=null,exhausted_at=null,updated_at=now()
where collection_run_id='76000000-0000-4000-8000-000000000401';
set role service_role;
select is((select attempt_count from public.claim_github_materialisation_jobs_server(
  1,array['76000000-0000-4000-8000-000000000401'::uuid]
)),25,'the in-flight race begins on the twenty-fifth attempt');
reset role;

select public.record_github_mapping_entry_decision_server(
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries where mapping_pack_id=(
    select id from public.github_mapping_packs where version='github-iso-27001-v1'
  ) and check_id='github.repository.visibility'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
      and check_id='github.repository.visibility')),
  'approved',3
);
select ok((select status='pending' and lease_token is not null and attempt_count=25
  from public.github_materialisation_jobs
  where collection_run_id='76000000-0000-4000-8000-000000000401'),
  'an approval during a live lease leaves that lease and attempt count intact');
set role service_role;
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  (select attempt_count from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  'completed'
),'the final leased attempt completes its existing materialisation');
reset role;
select ok((select status='pending' and lease_token is null and attempt_count=0
  from public.github_materialisation_jobs
  where collection_run_id='76000000-0000-4000-8000-000000000401'),
  'newly approved work gets a fresh bounded attempt budget');
set role service_role;
select is((select attempt_count from public.claim_github_materialisation_jobs_server(
  1,array['76000000-0000-4000-8000-000000000401'::uuid]
)),1,'new work is claimable and consumes attempt one');
reset role;

-- The second ordering starts after an already completed result set.
select public.materialise_github_approved_entries_server(
  '76000000-0000-4000-8000-000000000101',
  '76000000-0000-4000-8000-000000000401',
  'github-iso-27001-v1',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-v1'),
  (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'observation_id', observation.id,
      'treatment_kind', case when observation.result='pass' then 'evidence'
        when observation.result='fail' then 'finding' else 'explanatory' end,
      'iso_control_references', pg_catalog.to_jsonb(entry.iso_control_references),
      'failure_severity', entry.failure_severity,
      'remediation', entry.remediation
    ))
    from public.github_observations observation
    join public.github_mapping_entries entry
      on entry.mapping_pack_id=(select id from public.github_mapping_packs
        where version='github-iso-27001-v1')
     and entry.check_id=observation.check_id
     and entry.rule_version=observation.rule_version
    where observation.collection_run_id='76000000-0000-4000-8000-000000000401'
      and observation.check_id in ('github.branch.force_pushes','github.repository.visibility')
  )
);
select is((select count(*) from public.github_official_compliance_results
  where collection_run_id='76000000-0000-4000-8000-000000000401'),
  2::bigint,'both approved entries have real official results before reopening completed work');
update public.github_materialisation_jobs
set status='completed',attempt_count=25,completed_at=now(),lease_token=null,
    lease_expires_at=null,lease_attempt_incremented=null,exhausted_at=null,updated_at=now()
where collection_run_id='76000000-0000-4000-8000-000000000401';
select public.record_github_mapping_entry_decision_server(
  '76000000-0000-4000-8000-000000000101','76000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries where mapping_pack_id=(
    select id from public.github_mapping_packs where version='github-iso-27001-v1'
  ) and check_id='github.branch.approving_reviews'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
      and check_id='github.branch.approving_reviews')),
  'approved',4
);
select is((select status from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  'pending','a new approval reopens completed work');
select is((select attempt_count from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  0,'a new completed-job work cycle gets a fresh bounded attempt budget');
set role service_role;
select is((select count(*) from public.claim_github_materialisation_jobs_server(
  1,array['76000000-0000-4000-8000-000000000401'::uuid]
)),1::bigint,'reopened work remains claimable instead of exhausting immediately');
select is((select attempt_count from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  1,'the new cycle consumes its first attempt only when claimed');
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  (select attempt_count from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000401'),
  'awaiting_approval'
),'the reopened job releases its lease while its approved entry awaits materialisation');
reset role;

do $$
declare
  entry_row record;
  revision_value bigint := 1;
begin
  for entry_row in
    select entry.id
    from public.github_mapping_entries entry
    join public.github_mapping_packs pack on pack.id=entry.mapping_pack_id
    where pack.version='github-iso-27001-v1'
    order by entry.check_id
  loop
    perform public.record_github_mapping_entry_decision_server(
      '76000000-0000-4000-8000-000000000102',
      '76000000-0000-4000-8000-000000000002',
      entry_row.id,
      public.github_mapping_entry_digest(entry_row.id),
      'rejected',
      revision_value
    );
    revision_value := revision_value + 1;
  end loop;
end;
$$;
select is((select status from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000402'),
  'completed','explicitly rejecting every check safely completes the parked job');
select is((select attempt_count from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000402'),
  0,'an all-rejected no-op does not consume a materialisation attempt');
select is((select count(*) from public.github_official_compliance_results where collection_run_id='76000000-0000-4000-8000-000000000402'),
  0::bigint,'an all-rejected run produces no official result');

select public.select_github_mapping_pack_server(
  '76000000-0000-4000-8000-000000000103','76000000-0000-4000-8000-000000000003',
  'github-iso-27001-m2-job-wake-v2',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-m2-job-wake-v2'),3
);
select is((select status from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000403'),
  'pending','selecting the pack with an exact current approval wakes its matching run');

select public.materialise_github_approved_entries_server(
  '76000000-0000-4000-8000-000000000103',
  '76000000-0000-4000-8000-000000000403',
  'github-iso-27001-m2-job-wake-v2',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-m2-job-wake-v2'),
  (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'observation_id', observation.id,
      'treatment_kind', entry.treatments #>> array['pass','kind'],
      'iso_control_references', pg_catalog.to_jsonb(entry.iso_control_references),
      'failure_severity', entry.failure_severity::text,
      'remediation', entry.remediation
    ))
    from public.github_observations observation
    join public.github_mapping_entries entry
      on entry.mapping_pack_id=(select id from public.github_mapping_packs
        where version='github-iso-27001-m2-job-wake-v2')
     and entry.check_id=observation.check_id
     and entry.rule_version=observation.rule_version
    where observation.collection_run_id='76000000-0000-4000-8000-000000000403'
      and observation.check_id='github.branch.force_pushes'
  )
);
select is((select count(*) from public.github_official_compliance_results where collection_run_id='76000000-0000-4000-8000-000000000403'),
  1::bigint,'the selected v2 entry materialises one immutable official result');
set role service_role;
select is((select count(*) from public.claim_github_materialisation_jobs_server(
  1,array['76000000-0000-4000-8000-000000000403'::uuid]
)),1::bigint,'the v2 result run can be claimed for completion');
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000403'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000403'),
  (select attempt_count from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000403'),
  'completed'
),'the v2 ledger is completed before its selection changes');
reset role;

select public.select_github_mapping_pack_server(
  '76000000-0000-4000-8000-000000000103','76000000-0000-4000-8000-000000000003',
  'github-iso-27001-v1',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-v1'),4
);
select public.record_github_mapping_entry_decision_server(
  '76000000-0000-4000-8000-000000000103','76000000-0000-4000-8000-000000000003',
  (select id from public.github_mapping_entries where mapping_pack_id=(
    select id from public.github_mapping_packs where version='github-iso-27001-v1'
  ) and check_id='github.repository.visibility'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
      and check_id='github.repository.visibility')),
  'approved',5
);
select is((select status from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000403'),
  'completed','a pack switch cannot replay an immutable run ledger under a new mapping');
select is((select attempt_count from public.github_materialisation_jobs where collection_run_id='76000000-0000-4000-8000-000000000403'),
  1,'a rejected replay does not reset the completed processing-cycle budget');

select * from finish();
rollback;
