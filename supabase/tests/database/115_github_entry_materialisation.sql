begin;

select no_plan();

select has_function(
  'public', 'materialise_github_approved_entries_server',
  array['uuid','uuid','text','text','jsonb'],
  'the service materialises only the approved subset through an entry-aware boundary'
);
select has_table('public', 'github_entry_materialisation_receipts',
  'new official writes retain selected-entry and consent-source ancestry separately');
select has_column('public', 'github_official_compliance_results', 'entry_receipt_id',
  'official results point to the exact entry receipt');
select has_column('public', 'github_evidence_provenance', 'entry_receipt_id',
  'evidence provenance points to the exact entry receipt');
select has_column('public', 'github_finding_provenance', 'latest_entry_receipt_id',
  'finding provenance retains the latest entry receipt');
select has_column('public', 'github_finding_transitions', 'entry_receipt_id',
  'automated finding transitions point to the exact entry receipt');
select ok(case when pg_catalog.to_regclass('public.github_entry_materialisation_receipts') is null
  then false else not has_table_privilege('service_role',
  'public.github_entry_materialisation_receipts', 'INSERT,UPDATE,DELETE') end,
  'service clients cannot forge consent receipts directly');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('75000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','m2-material-owner@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by)
values ('75000000-0000-4000-8000-000000000101','M2 Material Org','m2-material-org',
  '75000000-0000-4000-8000-000000000001');
insert into public.memberships(organisation_id,user_id,role)
values ('75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001','owner');

select set_config('m2.material_legacy_approval', public.approve_github_mapping_pack_server(
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',
  'github-iso-27001-v1',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-v1')
)::text, true);
insert into public.github_mapping_packs(id,version,title)
values ('75000000-0000-4000-8000-000000000501','github-m2-material-v2','M2 material test pack');
insert into public.github_mapping_entries(
  mapping_pack_id,check_id,rule_version,iso_control_references,failure_severity,remediation,treatments
)
select '75000000-0000-4000-8000-000000000501',check_id,rule_version,
  iso_control_references,failure_severity,
  case when check_id='github.branch.stale_approvals'
    then 'Use the updated stale-review procedure.' else remediation end,
  treatments
from public.github_mapping_entries
where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1');
select public.seal_github_mapping_pack_server(
  'github-m2-material-v2',
  public.github_mapping_pack_checksum('75000000-0000-4000-8000-000000000501')
);
select public.select_github_mapping_pack_server(
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',
  'github-m2-material-v2',
  (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),0
);
select set_config('m2.material_explicit_decision', public.record_github_mapping_entry_decision_server(
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries
   where mapping_pack_id='75000000-0000-4000-8000-000000000501'
     and check_id='github.branch.stale_approvals'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id='75000000-0000-4000-8000-000000000501'
      and check_id='github.branch.stale_approvals')),
  'approved',1
)::text, true);

select lives_ok($sql$
  insert into public.github_entry_materialisation_receipts(
    organisation_id,selected_mapping_pack_id,selected_mapping_entry_id,check_id,
    source_mapping_pack_id,source_mapping_entry_id,entry_digest,legacy_approval_id
  )
  select '75000000-0000-4000-8000-000000000101',selected.mapping_pack_id,selected.id,selected.check_id,
    source.mapping_pack_id,source.id,public.github_mapping_entry_digest(selected.id),
    current_setting('m2.material_legacy_approval')::uuid
  from public.github_mapping_entries selected
  join public.github_mapping_entries source on source.check_id=selected.check_id
  where selected.mapping_pack_id='75000000-0000-4000-8000-000000000501'
    and source.mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
    and selected.check_id='github.repository.visibility'
$sql$, 'an unchanged v2 entry may inherit exact v1 whole-pack consent');
select lives_ok($sql$
  insert into public.github_entry_materialisation_receipts(
    organisation_id,selected_mapping_pack_id,selected_mapping_entry_id,check_id,
    source_mapping_pack_id,source_mapping_entry_id,entry_digest,entry_decision_id
  )
  select '75000000-0000-4000-8000-000000000101',entry.mapping_pack_id,entry.id,entry.check_id,
    entry.mapping_pack_id,entry.id,public.github_mapping_entry_digest(entry.id),
    current_setting('m2.material_explicit_decision')::uuid
  from public.github_mapping_entries entry
  where entry.mapping_pack_id='75000000-0000-4000-8000-000000000501'
    and entry.check_id='github.branch.stale_approvals'
$sql$, 'an explicit v2 entry approval can be retained without a pack approval');
select throws_ok($sql$
  insert into public.github_entry_materialisation_receipts(
    organisation_id,selected_mapping_pack_id,selected_mapping_entry_id,check_id,
    source_mapping_pack_id,source_mapping_entry_id,entry_digest
  )
  select '75000000-0000-4000-8000-000000000101',entry.mapping_pack_id,entry.id,entry.check_id,
    entry.mapping_pack_id,entry.id,public.github_mapping_entry_digest(entry.id)
  from public.github_mapping_entries entry
  where entry.mapping_pack_id='75000000-0000-4000-8000-000000000501'
    and entry.check_id='github.branch.stale_approvals'
$sql$, '23514', null, 'a receipt with no consent source is rejected');
select throws_ok($sql$
  insert into public.github_entry_materialisation_receipts(
    organisation_id,selected_mapping_pack_id,selected_mapping_entry_id,check_id,
    source_mapping_pack_id,source_mapping_entry_id,entry_digest,
    entry_decision_id,legacy_approval_id
  )
  select '75000000-0000-4000-8000-000000000101',entry.mapping_pack_id,entry.id,entry.check_id,
    entry.mapping_pack_id,entry.id,public.github_mapping_entry_digest(entry.id),
    current_setting('m2.material_explicit_decision')::uuid,
    current_setting('m2.material_legacy_approval')::uuid
  from public.github_mapping_entries entry
  where entry.mapping_pack_id='75000000-0000-4000-8000-000000000501'
    and entry.check_id='github.branch.stale_approvals'
$sql$, '42501', null, 'a receipt cannot name both consent sources');
select throws_ok($sql$
  insert into public.github_entry_materialisation_receipts(
    organisation_id,selected_mapping_pack_id,selected_mapping_entry_id,check_id,
    source_mapping_pack_id,source_mapping_entry_id,entry_digest,legacy_approval_id
  )
  select '75000000-0000-4000-8000-000000000101',selected.mapping_pack_id,selected.id,selected.check_id,
    source.mapping_pack_id,source.id,repeat('f',64),
    current_setting('m2.material_legacy_approval')::uuid
  from public.github_mapping_entries selected
  join public.github_mapping_entries source on source.check_id=selected.check_id
  where selected.mapping_pack_id='75000000-0000-4000-8000-000000000501'
    and source.mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
    and selected.check_id='github.repository.archived'
$sql$, '22023', null, 'a receipt cannot attach consent to a different entry digest');
select throws_ok($sql$
  insert into public.github_entry_materialisation_receipts(
    organisation_id,selected_mapping_pack_id,selected_mapping_entry_id,check_id,
    source_mapping_pack_id,source_mapping_entry_id,entry_digest,legacy_approval_id
  )
  select '75000000-0000-4000-8000-000000000102',selected.mapping_pack_id,selected.id,selected.check_id,
    source.mapping_pack_id,source.id,public.github_mapping_entry_digest(selected.id),
    current_setting('m2.material_legacy_approval')::uuid
  from public.github_mapping_entries selected
  join public.github_mapping_entries source on source.check_id=selected.check_id
  where selected.mapping_pack_id='75000000-0000-4000-8000-000000000501'
    and source.mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
    and selected.check_id='github.repository.archived'
$sql$, '42501', null, 'a source approval cannot cross workspaces');

insert into public.github_installations(
  id,organisation_id,provider_installation_id,account_id,account_login,account_type,
  repository_selection,status,connected_by,permissions,permissions_ok
) values (
  '75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000101',
  75001,75002,'M2Test','Organization','selected','active',
  '75000000-0000-4000-8000-000000000001','{"metadata":"read"}',true
);
insert into public.github_repositories(
  id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
  html_url,visibility,default_branch,archived,selected,available
) values (
  '75000000-0000-4000-8000-000000000202','75000000-0000-4000-8000-000000000101',
  '75000000-0000-4000-8000-000000000201',75003,'M2Test','repo','M2Test/repo',
  'https://github.com/M2Test/repo','private','main',false,true,true
);
insert into public.github_collection_runs(
  id,organisation_id,installation_id,repository_id,provider_repository_id,
  trigger_type,request_key,status,started_at,completed_at,observation_count,passed_count,
  lease_token,lease_expires_at,attempt
) values (
  '75000000-0000-4000-8000-000000000301','75000000-0000-4000-8000-000000000101',
  '75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000202',
  75003,'manual','m2-receipt-check-binding','succeeded',now()-interval '2 hours',now(),1,1,
  extensions.gen_random_uuid(),now()-interval '1 minute',1
);
insert into public.github_observations(
  id,organisation_id,installation_id,repository_id,provider_repository_id,
  collection_run_id,observation_key,check_id,rule_version,subject_type,subject_id,
  result,title,explanation,observed_at,fresh_until,source_url,fingerprint
) values (
  '75000000-0000-4000-8000-000000000401','75000000-0000-4000-8000-000000000101',
  '75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000202',
  75003,'75000000-0000-4000-8000-000000000301',
  'M2Test/repo/github.repository.visibility/github-repository-v1',
  'github.repository.visibility','github-repository-v1','github_repository','M2Test/repo',
  'pass','Repository is private','Visibility was verified.',now()-interval '1 minute',
  now()+interval '1 day','https://github.com/M2Test/repo',repeat('a',64)
);
select throws_ok($sql$
  insert into public.github_official_compliance_results(
    organisation_id,installation_id,repository_id,provider_repository_id,
    collection_run_id,observation_id,entry_receipt_id,mapping_pack_id,
    mapping_version,mapping_checksum,check_id,rule_version,outcome,
    catalogue_summary,observed_at,fresh_until
  )
  select observation.organisation_id,observation.installation_id,observation.repository_id,
    observation.provider_repository_id,observation.collection_run_id,observation.id,
    receipt.id,receipt.selected_mapping_pack_id,pack.version,pack.checksum,
    observation.check_id,observation.rule_version,observation.result,
    'Passing visibility is approved.',observation.observed_at,observation.fresh_until
  from public.github_observations observation
  join public.github_entry_materialisation_receipts receipt
    on receipt.organisation_id=observation.organisation_id
  join public.github_mapping_packs pack on pack.id=receipt.selected_mapping_pack_id
  where observation.id='75000000-0000-4000-8000-000000000401'
    and receipt.selected_mapping_entry_id=(select id from public.github_mapping_entries
      where mapping_pack_id='75000000-0000-4000-8000-000000000501'
        and check_id='github.branch.stale_approvals')
$sql$, '23503', null,
  'an approved stale-review receipt cannot authorize a visibility observation');

insert into public.organisations(id,name,slug,created_by)
values ('75000000-0000-4000-8000-000000000102','M2 Mixed Org','m2-mixed-org',
  '75000000-0000-4000-8000-000000000001');
insert into public.memberships(organisation_id,user_id,role)
values ('75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000001','owner');
select public.select_github_mapping_pack_server(
  '75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000001',
  'github-m2-material-v2',
  (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),0
);
select public.record_github_mapping_entry_decision_server(
  '75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries
   where mapping_pack_id='75000000-0000-4000-8000-000000000501'
     and check_id='github.repository.visibility'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id='75000000-0000-4000-8000-000000000501'
      and check_id='github.repository.visibility')),
  'approved',1
);
select public.record_github_mapping_entry_decision_server(
  '75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries
   where mapping_pack_id='75000000-0000-4000-8000-000000000501'
     and check_id='github.branch.force_pushes'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id='75000000-0000-4000-8000-000000000501'
      and check_id='github.branch.force_pushes')),
  'rejected',2
);
insert into public.github_installations(
  id,organisation_id,provider_installation_id,account_id,account_login,account_type,
  repository_selection,status,connected_by,permissions,permissions_ok
) values (
  '75000000-0000-4000-8000-000000000211','75000000-0000-4000-8000-000000000102',
  75101,75102,'M2Mixed','Organization','selected','active',
  '75000000-0000-4000-8000-000000000001','{"metadata":"read"}',true
);
insert into public.github_repositories(
  id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
  html_url,visibility,default_branch,archived,selected,available
) values (
  '75000000-0000-4000-8000-000000000212','75000000-0000-4000-8000-000000000102',
  '75000000-0000-4000-8000-000000000211',75103,'M2Mixed','repo','M2Mixed/repo',
  'https://github.com/M2Mixed/repo','private','main',false,true,true
);
insert into public.github_collection_runs(
  id,organisation_id,installation_id,repository_id,provider_repository_id,
  trigger_type,request_key,status,started_at,completed_at,observation_count,
  passed_count,failed_count,lease_token,lease_expires_at,attempt
) values (
  '75000000-0000-4000-8000-000000000311','75000000-0000-4000-8000-000000000102',
  '75000000-0000-4000-8000-000000000211','75000000-0000-4000-8000-000000000212',
  75103,'manual','m2-mixed-run','succeeded',now()-interval '2 hours',now(),15,14,1,
  extensions.gen_random_uuid(),now()-interval '1 minute',1
);
insert into public.github_observations(
  organisation_id,installation_id,repository_id,provider_repository_id,
  collection_run_id,observation_key,check_id,rule_version,subject_type,subject_id,
  result,severity,title,explanation,remediation,observed_at,fresh_until,
  source_url,fingerprint
)
select '75000000-0000-4000-8000-000000000102',
  '75000000-0000-4000-8000-000000000211',
  '75000000-0000-4000-8000-000000000212',75103,
  '75000000-0000-4000-8000-000000000311',
  'M2Mixed/repo/' || entry.check_id || '/' || entry.rule_version,
  entry.check_id,entry.rule_version,'github_repository','M2Mixed/repo',
  case when entry.check_id='github.branch.force_pushes' then 'fail'::public.github_observation_result
    else 'pass'::public.github_observation_result end,
  case when entry.check_id='github.branch.force_pushes' then 'high' else null end,
  'GitHub check ' || entry.check_id,'Bounded provider observation.',
  case when entry.check_id='github.branch.force_pushes' then entry.remediation else null end,
  now()-interval '1 minute',now()+interval '1 day',
  'https://github.com/M2Mixed/repo',
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(entry.check_id,'UTF8'),'sha256'),'hex')
from public.github_mapping_entries entry
where entry.mapping_pack_id='75000000-0000-4000-8000-000000000501';

select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000311',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'observation_id',observation.id,'treatment_kind','evidence',
      'iso_control_references',pg_catalog.to_jsonb(entry.iso_control_references),
      'failure_severity',entry.failure_severity,'remediation',entry.remediation
    ))
    from public.github_observations observation
    join public.github_mapping_entries entry on entry.check_id=observation.check_id
      and entry.mapping_pack_id='75000000-0000-4000-8000-000000000501'
    where observation.collection_run_id='75000000-0000-4000-8000-000000000311'
      and observation.check_id='github.repository.visibility')
  )
$sql$, 'one approved entry materialises while 14 rejected or pending observations remain technical');
select is((select count(*) from public.github_official_compliance_results
  where collection_run_id='75000000-0000-4000-8000-000000000311'),
  1::bigint, 'only the approved entry has an official ledger row');
select is((select count(*) from public.monitoring_findings
  where organisation_id='75000000-0000-4000-8000-000000000102'),
  0::bigint, 'the rejected failed check creates no finding');

create function pg_temp.m2_material_decisions(target_run uuid, target_checks text[])
returns jsonb language sql stable as $$
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'observation_id',observation.id,
    'treatment_kind',case when observation.result='pass' then 'evidence'
      when observation.result='fail' then 'finding' else 'explanatory' end,
    'iso_control_references',pg_catalog.to_jsonb(entry.iso_control_references),
    'failure_severity',entry.failure_severity,'remediation',entry.remediation
  ) order by observation.check_id)
  from public.github_observations observation
  join public.github_mapping_entries entry on entry.check_id=observation.check_id
    and entry.mapping_pack_id='75000000-0000-4000-8000-000000000501'
  where observation.collection_run_id=target_run
    and observation.check_id=any(target_checks);
$$;
select public.record_github_mapping_entry_decision_server(
  '75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries
   where mapping_pack_id='75000000-0000-4000-8000-000000000501'
     and check_id='github.branch.force_pushes'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id='75000000-0000-4000-8000-000000000501'
      and check_id='github.branch.force_pushes')),
  'approved',3
);
select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000311',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    pg_temp.m2_material_decisions('75000000-0000-4000-8000-000000000311',
      array['github.repository.visibility','github.branch.force_pushes'])
  )
$sql$, 'approving another exact entry replays the run and creates only its missing finding');
select is((select count(*) from public.github_official_compliance_results
  where collection_run_id='75000000-0000-4000-8000-000000000311'),
  2::bigint, 'later approval appends the second official outcome without replacing the first');
select is((select count(*) from public.monitoring_findings
  where organisation_id='75000000-0000-4000-8000-000000000102'),
  1::bigint, 'the newly approved failure creates exactly one stable finding');
select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000311',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    pg_temp.m2_material_decisions('75000000-0000-4000-8000-000000000311',
      array['github.repository.visibility','github.branch.force_pushes'])
  )
$sql$, 'duplicate replay is safe');
select is((select count(*) from public.monitoring_findings
  where organisation_id='75000000-0000-4000-8000-000000000102'),
  1::bigint, 'duplicate replay cannot create a duplicate finding');

insert into public.github_collection_runs(
  id,organisation_id,installation_id,repository_id,provider_repository_id,
  trigger_type,request_key,status,diagnostic_code,started_at,completed_at,
  observation_count,passed_count,failed_count,lease_token,lease_expires_at,attempt
) values (
  '75000000-0000-4000-8000-000000000312','75000000-0000-4000-8000-000000000102',
  '75000000-0000-4000-8000-000000000211','75000000-0000-4000-8000-000000000212',
  75103,'manual','m2-failed-run','failed','provider_unavailable',
  now()-interval '2 hours',now(),15,14,1,
  extensions.gen_random_uuid(),now()-interval '1 minute',1
);
insert into public.github_observations(
  organisation_id,installation_id,repository_id,provider_repository_id,
  collection_run_id,observation_key,check_id,rule_version,subject_type,subject_id,
  result,severity,title,explanation,remediation,observed_at,fresh_until,
  source_url,fingerprint
)
select observation.organisation_id,observation.installation_id,
  observation.repository_id,observation.provider_repository_id,
  '75000000-0000-4000-8000-000000000312',observation.observation_key,
  observation.check_id,observation.rule_version,observation.subject_type,
  observation.subject_id,observation.result,observation.severity,
  observation.title,observation.explanation,observation.remediation,
  now(),now()+interval '1 day',observation.source_url,observation.fingerprint
from public.github_observations observation
where observation.collection_run_id='75000000-0000-4000-8000-000000000311';
select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000312',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    pg_temp.m2_material_decisions('75000000-0000-4000-8000-000000000312',
      array['github.repository.visibility','github.branch.force_pushes'])
  )
$sql$, 'a failed run remains a safe no-op even when receipts already exist');
select is((select count(*) from public.github_official_compliance_results
  where collection_run_id='75000000-0000-4000-8000-000000000312'),
  0::bigint, 'a failed run cannot create official results from old receipts');

insert into public.github_collection_runs(
  id,organisation_id,installation_id,repository_id,provider_repository_id,
  trigger_type,request_key,status,started_at,completed_at,observation_count,
  passed_count,failed_count,lease_token,lease_expires_at,attempt
) values
  ('75000000-0000-4000-8000-000000000313','75000000-0000-4000-8000-000000000102',
   '75000000-0000-4000-8000-000000000211','75000000-0000-4000-8000-000000000212',
   75103,'manual','m2-newer-pass','succeeded',now()-interval '2 hours',now(),15,15,0,
   extensions.gen_random_uuid(),now()-interval '1 minute',1),
  ('75000000-0000-4000-8000-000000000314','75000000-0000-4000-8000-000000000102',
   '75000000-0000-4000-8000-000000000211','75000000-0000-4000-8000-000000000212',
   75103,'manual','m2-delayed-fail','succeeded',now()-interval '2 hours',now(),15,14,1,
   extensions.gen_random_uuid(),now()-interval '1 minute',1);
insert into public.github_observations(
  organisation_id,installation_id,repository_id,provider_repository_id,
  collection_run_id,observation_key,check_id,rule_version,subject_type,subject_id,
  result,severity,title,explanation,remediation,observed_at,fresh_until,
  source_url,fingerprint
)
select observation.organisation_id,observation.installation_id,
  observation.repository_id,observation.provider_repository_id,
  target.run_id,observation.observation_key,observation.check_id,
  observation.rule_version,observation.subject_type,observation.subject_id,
  case when target.is_pass then 'pass'::public.github_observation_result else observation.result end,
  case when target.is_pass then null else observation.severity end,
  observation.title,observation.explanation,
  case when target.is_pass then null else observation.remediation end,
  case when target.is_pass then now()-interval '30 seconds'
    else now()-interval '45 seconds' end,
  now()+interval '1 day',observation.source_url,observation.fingerprint
from public.github_observations observation
cross join (values
  ('75000000-0000-4000-8000-000000000313'::uuid,true),
  ('75000000-0000-4000-8000-000000000314'::uuid,false)
) target(run_id,is_pass)
where observation.collection_run_id='75000000-0000-4000-8000-000000000311';
select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000313',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    pg_temp.m2_material_decisions('75000000-0000-4000-8000-000000000313',
      array['github.repository.visibility','github.branch.force_pushes'])
  )
$sql$, 'a newer passing check resolves the approved failure');
select is((select status::text from public.monitoring_findings
  where organisation_id='75000000-0000-4000-8000-000000000102'
    and check_id='github.branch.force_pushes'),
  'resolved', 'newer Pass leaves the stable finding resolved');
select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000314',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    pg_temp.m2_material_decisions('75000000-0000-4000-8000-000000000314',
      array['github.repository.visibility','github.branch.force_pushes'])
  )
$sql$, 'a delayed older failed observation may be recorded without reopening');
select is((select status::text from public.monitoring_findings
  where organisation_id='75000000-0000-4000-8000-000000000102'
    and check_id='github.branch.force_pushes'),
  'resolved', 'delayed older Fail cannot reverse the newer verified Pass');

insert into public.github_repositories(
  id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
  html_url,visibility,default_branch,archived,selected,available
) values (
  '75000000-0000-4000-8000-000000000213','75000000-0000-4000-8000-000000000102',
  '75000000-0000-4000-8000-000000000211',75104,'M2Mixed','second','M2Mixed/second',
  'https://github.com/M2Mixed/second','private','main',false,true,true
);
insert into public.github_collection_runs(
  id,organisation_id,installation_id,repository_id,provider_repository_id,
  trigger_type,request_key,status,started_at,completed_at,observation_count,
  passed_count,failed_count,lease_token,lease_expires_at,attempt
) values
  ('75000000-0000-4000-8000-000000000316','75000000-0000-4000-8000-000000000102',
   '75000000-0000-4000-8000-000000000211','75000000-0000-4000-8000-000000000213',
   75104,'manual','m2-second-newer-pass','succeeded',now()-interval '1 hour',now(),15,15,0,
   extensions.gen_random_uuid(),now()-interval '1 minute',1),
  ('75000000-0000-4000-8000-000000000317','75000000-0000-4000-8000-000000000102',
   '75000000-0000-4000-8000-000000000211','75000000-0000-4000-8000-000000000213',
   75104,'manual','m2-second-delayed-fail','succeeded',now()-interval '1 hour',now(),15,14,1,
   extensions.gen_random_uuid(),now()-interval '1 minute',1);
insert into public.github_observations(
  organisation_id,installation_id,repository_id,provider_repository_id,
  collection_run_id,observation_key,check_id,rule_version,subject_type,subject_id,
  result,severity,title,explanation,remediation,observed_at,fresh_until,
  source_url,fingerprint
)
select observation.organisation_id,observation.installation_id,
  '75000000-0000-4000-8000-000000000213',75104,
  target.run_id,'M2Mixed/second/' || observation.check_id || '/' || observation.rule_version,
  observation.check_id,observation.rule_version,observation.subject_type,
  'M2Mixed/second',
  case when target.is_old and observation.check_id='github.repository.visibility'
    then 'fail'::public.github_observation_result else 'pass'::public.github_observation_result end,
  case when target.is_old and observation.check_id='github.repository.visibility'
    then entry.failure_severity else null end,
  observation.title,observation.explanation,
  case when target.is_old and observation.check_id='github.repository.visibility'
    then entry.remediation else null end,
  case when target.is_old then now()-interval '25 minutes' else now()-interval '15 minutes' end,
  now()+interval '1 day','https://github.com/M2Mixed/second',
  pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(target.run_id::text || observation.check_id,'UTF8'),'sha256'),'hex')
from public.github_observations observation
join public.github_mapping_entries entry
  on entry.mapping_pack_id='75000000-0000-4000-8000-000000000501'
 and entry.check_id=observation.check_id
cross join (values
  ('75000000-0000-4000-8000-000000000316'::uuid,false),
  ('75000000-0000-4000-8000-000000000317'::uuid,true)
) target(run_id,is_old)
where observation.collection_run_id='75000000-0000-4000-8000-000000000311';
select is((select count(*) from public.github_finding_provenance
  where organisation_id='75000000-0000-4000-8000-000000000102'
    and provider_repository_id=75104),
  0::bigint, 'the second repository starts without a finding');
select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000316',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    pg_temp.m2_material_decisions('75000000-0000-4000-8000-000000000316',
      array['github.repository.visibility','github.branch.force_pushes'])
  )
$sql$, 'the newer complete Pass run is materialised first for the second repository');
select is((select count(*) from public.github_official_compliance_results
  where collection_run_id='75000000-0000-4000-8000-000000000316'
    and check_id='github.repository.visibility' and outcome='pass'),
  1::bigint, 'the newer Pass has an immutable official result');
select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000317',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    pg_temp.m2_material_decisions('75000000-0000-4000-8000-000000000317',
      array['github.repository.visibility','github.branch.force_pushes'])
  )
$sql$, 'the delayed older complete Fail run can be retained without changing current state');
select is((select count(*) from public.github_finding_provenance
  where organisation_id='75000000-0000-4000-8000-000000000102'
    and provider_repository_id=75104 and check_id='github.repository.visibility'),
  0::bigint, 'older Fail cannot create a new open Finding after newer Pass');

select public.select_github_mapping_pack_server(
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',
  'github-iso-27001-v1',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-v1'),2
);
insert into public.github_collection_runs(
  id,organisation_id,installation_id,repository_id,provider_repository_id,
  trigger_type,request_key,status,started_at,completed_at,observation_count,
  passed_count,failed_count,lease_token,lease_expires_at,attempt
) values (
  '75000000-0000-4000-8000-000000000302','75000000-0000-4000-8000-000000000101',
  '75000000-0000-4000-8000-000000000201','75000000-0000-4000-8000-000000000202',
  75003,'manual','m2-legacy-replay','succeeded',now()-interval '2 hours',now(),15,14,1,
  extensions.gen_random_uuid(),now()-interval '1 minute',1
);
insert into public.github_observations(
  organisation_id,installation_id,repository_id,provider_repository_id,
  collection_run_id,observation_key,check_id,rule_version,subject_type,subject_id,
  result,severity,title,explanation,remediation,observed_at,fresh_until,
  source_url,fingerprint
)
select '75000000-0000-4000-8000-000000000101',
  '75000000-0000-4000-8000-000000000201',
  '75000000-0000-4000-8000-000000000202',75003,
  '75000000-0000-4000-8000-000000000302',
  'M2Test/repo/' || observation.check_id || '/' || observation.rule_version,
  observation.check_id,observation.rule_version,observation.subject_type,
  'M2Test/repo',observation.result,observation.severity,
  observation.title,observation.explanation,observation.remediation,
  now(),now()+interval '1 day','https://github.com/M2Test/repo',observation.fingerprint
from public.github_observations observation
where observation.collection_run_id='75000000-0000-4000-8000-000000000311';
create function pg_temp.m2_legacy_decisions(target_run uuid)
returns jsonb language sql stable as $$
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'observation_id',observation.id,
    'treatment_kind',case when observation.result='pass' then 'evidence'
      when observation.result='fail' then 'finding' else 'explanatory' end,
    'iso_control_references',pg_catalog.to_jsonb(entry.iso_control_references),
    'failure_severity',entry.failure_severity,'remediation',entry.remediation
  ) order by observation.check_id)
  from public.github_observations observation
  join public.github_mapping_entries entry on entry.check_id=observation.check_id
    and entry.mapping_pack_id=(select id from public.github_mapping_packs
      where version='github-iso-27001-v1')
  where observation.collection_run_id=target_run;
$$;
select lives_ok($sql$
  select public.materialise_github_observations_server(
    '75000000-0000-4000-8000-000000000101',
    '75000000-0000-4000-8000-000000000302',
    'github-iso-27001-v1',
    (select checksum from public.github_mapping_packs where version='github-iso-27001-v1'),
    pg_temp.m2_legacy_decisions('75000000-0000-4000-8000-000000000302')
  )
$sql$, 'a complete historical whole-pack run remains materialisable');
select is((select count(*) from public.github_official_compliance_results
  where collection_run_id='75000000-0000-4000-8000-000000000302'),
  15::bigint, 'historical whole-pack official results stay intact');
select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000101',
    '75000000-0000-4000-8000-000000000302',
    'github-iso-27001-v1',
    (select checksum from public.github_mapping_packs where version='github-iso-27001-v1'),
    pg_temp.m2_legacy_decisions('75000000-0000-4000-8000-000000000302')
  )
$sql$, 'new entry-aware replay accepts an identical immutable historical ledger');
select is((select count(*) from public.github_official_compliance_results
  where collection_run_id='75000000-0000-4000-8000-000000000302'
    and approval_id is not null and entry_receipt_id is null),
  15::bigint, 'replay preserves original whole-pack approval ancestry byte-for-byte');

select public.record_github_mapping_entry_decision_server(
  '75000000-0000-4000-8000-000000000101','75000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries
   where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
     and check_id='github.repository.visibility'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
      and check_id='github.repository.visibility')),
  'rejected',3
);
select throws_ok($sql$
  select public.materialise_github_observations_server(
    '75000000-0000-4000-8000-000000000101',
    '75000000-0000-4000-8000-000000000301',
    'github-iso-27001-v1',
    (select checksum from public.github_mapping_packs where version='github-iso-27001-v1'),
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'observation_id',observation.id,'treatment_kind','evidence',
      'iso_control_references',pg_catalog.to_jsonb(entry.iso_control_references),
      'failure_severity',entry.failure_severity,'remediation',entry.remediation
    ))
    from public.github_observations observation
    join public.github_mapping_entries entry on entry.check_id=observation.check_id
      and entry.mapping_pack_id=(select id from public.github_mapping_packs
        where version='github-iso-27001-v1')
    where observation.collection_run_id='75000000-0000-4000-8000-000000000301')
  )
$sql$, '42501', null,
  'the old five-argument route cannot bypass an explicit rejection of inherited consent');

select throws_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000311',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    '[]'::jsonb
  )
$sql$, '42501', null,
  'an empty request cannot silently omit entries that are still approved');
select public.record_github_mapping_entry_decision_server(
  '75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries
   where mapping_pack_id='75000000-0000-4000-8000-000000000501'
     and check_id='github.repository.visibility'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id='75000000-0000-4000-8000-000000000501'
      and check_id='github.repository.visibility')),
  'rejected',4
);
select public.record_github_mapping_entry_decision_server(
  '75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries
   where mapping_pack_id='75000000-0000-4000-8000-000000000501'
     and check_id='github.branch.force_pushes'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id='75000000-0000-4000-8000-000000000501'
      and check_id='github.branch.force_pushes')),
  'rejected',5
);
insert into public.github_collection_runs(
  id,organisation_id,installation_id,repository_id,provider_repository_id,
  trigger_type,request_key,status,started_at,completed_at,observation_count,
  passed_count,failed_count,lease_token,lease_expires_at,attempt
) values (
  '75000000-0000-4000-8000-000000000315','75000000-0000-4000-8000-000000000102',
  '75000000-0000-4000-8000-000000000211','75000000-0000-4000-8000-000000000212',
  75103,'manual','m2-zero-approved','succeeded',now()-interval '2 hours',now(),15,14,1,
  extensions.gen_random_uuid(),now()-interval '1 minute',1
);
insert into public.github_observations(
  organisation_id,installation_id,repository_id,provider_repository_id,
  collection_run_id,observation_key,check_id,rule_version,subject_type,subject_id,
  result,severity,title,explanation,remediation,observed_at,fresh_until,
  source_url,fingerprint
)
select observation.organisation_id,observation.installation_id,
  observation.repository_id,observation.provider_repository_id,
  '75000000-0000-4000-8000-000000000315',observation.observation_key,
  observation.check_id,observation.rule_version,observation.subject_type,
  observation.subject_id,observation.result,observation.severity,
  observation.title,observation.explanation,observation.remediation,
  now(),now()+interval '1 day',observation.source_url,observation.fingerprint
from public.github_observations observation
where observation.collection_run_id='75000000-0000-4000-8000-000000000311';
select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000315',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    '[]'::jsonb
  )
$sql$, 'a complete run with zero currently approved entries is a safe no-op');
select is((select count(*) from public.github_official_compliance_results
  where collection_run_id='75000000-0000-4000-8000-000000000315'),
  0::bigint, 'zero approved entries cannot create an official result');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('75000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','m2-second-owner@example.test','',now(),'{}','{}');
insert into public.memberships(organisation_id,user_id,role)
values ('75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000002','owner');
select public.record_github_mapping_entry_decision_server(
  '75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000001',
  (select id from public.github_mapping_entries
   where mapping_pack_id='75000000-0000-4000-8000-000000000501'
     and check_id='github.repository.visibility'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id='75000000-0000-4000-8000-000000000501'
      and check_id='github.repository.visibility')),
  'approved',6
);
select public.record_github_mapping_entry_decision_server(
  '75000000-0000-4000-8000-000000000102','75000000-0000-4000-8000-000000000002',
  (select id from public.github_mapping_entries
   where mapping_pack_id='75000000-0000-4000-8000-000000000501'
     and check_id='github.branch.force_pushes'),
  public.github_mapping_entry_digest((select id from public.github_mapping_entries
    where mapping_pack_id='75000000-0000-4000-8000-000000000501'
      and check_id='github.branch.force_pushes')),
  'approved',7
);
insert into public.github_collection_runs(
  id,organisation_id,installation_id,repository_id,provider_repository_id,
  trigger_type,request_key,status,started_at,completed_at,observation_count,
  passed_count,lease_token,lease_expires_at,attempt
) values (
  '75000000-0000-4000-8000-000000000318','75000000-0000-4000-8000-000000000102',
  '75000000-0000-4000-8000-000000000211','75000000-0000-4000-8000-000000000213',
  75104,'manual','m2-mixed-reviewer-run','succeeded',now()-interval '1 hour',now(),15,15,
  extensions.gen_random_uuid(),now()-interval '1 minute',1
);
insert into public.github_observations(
  organisation_id,installation_id,repository_id,provider_repository_id,
  collection_run_id,observation_key,check_id,rule_version,subject_type,subject_id,
  result,severity,title,explanation,remediation,observed_at,fresh_until,
  source_url,fingerprint
)
select observation.organisation_id,observation.installation_id,
  observation.repository_id,observation.provider_repository_id,
  '75000000-0000-4000-8000-000000000318',observation.observation_key,
  observation.check_id,observation.rule_version,observation.subject_type,
  observation.subject_id,observation.result,observation.severity,
  observation.title,observation.explanation,observation.remediation,
  now()-interval '5 minutes',now()+interval '1 day',observation.source_url,
  pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('m2-mixed-reviewer-' || observation.check_id,'UTF8'),'sha256'),'hex')
from public.github_observations observation
where observation.collection_run_id='75000000-0000-4000-8000-000000000316';
select lives_ok($sql$
  select public.materialise_github_approved_entries_server(
    '75000000-0000-4000-8000-000000000102',
    '75000000-0000-4000-8000-000000000318',
    'github-m2-material-v2',
    (select checksum from public.github_mapping_packs where version='github-m2-material-v2'),
    pg_temp.m2_material_decisions('75000000-0000-4000-8000-000000000318',
      array['github.repository.visibility','github.branch.force_pushes'])
  )
$sql$, 'two Owners can approve separate entries in one complete run');
select is((select count(distinct decision.decided_by)
  from public.github_official_compliance_results result
  join public.github_entry_materialisation_receipts receipt on receipt.id=result.entry_receipt_id
  join public.github_mapping_entry_decisions decision on decision.id=receipt.entry_decision_id
  where result.collection_run_id='75000000-0000-4000-8000-000000000318'),
  2::bigint, 'each official result retains its actual individual reviewer');
select is((select count(*) from public.audit_events event
  where event.action='github.materialise'
    and event.entity_id='75000000-0000-4000-8000-000000000318'),
  1::bigint, 'mixed-reviewer materialisation writes one run audit event');
select ok((select event.metadata ->> 'approved_by'
  from public.audit_events event
  where event.action='github.materialise'
    and event.entity_id='75000000-0000-4000-8000-000000000318'
  order by event.id desc limit 1) is null,
  'a mixed-reviewer run does not falsely name one Owner as approving the entire run');

select * from finish();
rollback;
