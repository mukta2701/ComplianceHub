-- Official GitHub compliance materialisation is deliberately separate from the
-- shadow collector. This suite uses committed fixtures so two independent
-- dblink sessions can exercise the real concurrency boundary. Exact test ids
-- are cleaned before and after the suite, including after an interrupted rerun.

create extension if not exists dblink with schema extensions;

begin;
set local session_replication_role = replica;
delete from public.task_tickets where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.integration_connections where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.evidence_links where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_evidence_provenance where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.evidence where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_finding_transitions where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_finding_provenance where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.monitoring_findings where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.tasks where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_mapping_approvals where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.audit_events where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_observations where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_collection_runs where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_repositories where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_installations where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.memberships where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.organisations where id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_mapping_entries where mapping_pack_id in (select id from public.github_mapping_packs where version = 'github-test-missing-v1');
delete from public.github_mapping_packs where version = 'github-test-missing-v1';
delete from public.profiles where id::text like '71000000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '71000000-0000-4000-8000-00000000000%';
commit;

select no_plan();

select has_table('public', 'github_mapping_packs', 'mapping packs are durable and versioned');
select has_table('public', 'github_mapping_entries', 'mapping entries are durable and versioned');
select has_table('public', 'github_mapping_approvals', 'workspace approvals are durable');
select has_table('public', 'github_evidence_provenance', 'official evidence retains GitHub provenance');
select has_table('public', 'github_finding_provenance', 'official findings retain collision-free GitHub provenance');
select has_table('public', 'github_finding_transitions', 'GitHub finding lifecycle transitions are audited');
select has_fk('public', 'github_evidence_provenance', 'github_evidence_provenance_observation_ancestry_fk');
select has_fk('public', 'github_evidence_provenance', 'github_evidence_provenance_approval_ancestry_fk');
select has_fk('public', 'github_finding_provenance', 'github_finding_provenance_latest_observation_ancestry_fk');
select has_fk('public', 'github_finding_provenance', 'github_finding_provenance_latest_approval_ancestry_fk');
select has_column('public', 'monitoring_findings', 'stable_subject_identity', 'finding deduplication stores a stable origin-specific subject identity');
select has_column('public', 'monitoring_findings', 'mapping_version', 'finding deduplication includes the reviewed mapping version');
select has_column('public', 'github_finding_provenance', 'provider_repository_id', 'finding provenance retains the stable GitHub repository identity');
select has_column('public', 'github_finding_provenance', 'latest_installation_id', 'latest finding ancestry can advance across a GitHub App reinstallation');
select has_fk('public', 'github_finding_provenance', 'github_finding_provenance_latest_repository_ancestry_fk');
select is(
  (select checksum from public.github_mapping_packs where version = 'github-iso-27001-v1'),
  'b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  'the SQL seed matches the reviewed TypeScript mapping-pack checksum'
);
select is(
  (select count(*) from public.github_mapping_entries entry join public.github_mapping_packs pack on pack.id=entry.mapping_pack_id where pack.version='github-iso-27001-v1'),
  15::bigint,
  'the standard pack stores exactly one mapping for every reviewed GitHub check'
);
select results_eq(
  $$ select iso_control_references from public.github_mapping_entries entry
     join public.github_mapping_packs pack on pack.id=entry.mapping_pack_id
     where pack.version='github-iso-27001-v1' and entry.check_id='github.branch.stale_approvals' $$,
  $$ values (array['A.8.32']::text[]) $$,
  'mapping entries retain reviewed ISO requirement codes rather than internal CH control codes'
);
select is(
  (select code from public.requirements requirement
   join public.frameworks framework on framework.id=requirement.framework_id
   where framework.slug='iso-27001' and framework.version='2022' and requirement.code='8.32'),
  '8.32',
  'the current ISO catalogue stores the requirement without the reviewed A. prefix'
);
select is(
  (select count(*)
   from public.github_mapping_entries entry
   join public.github_mapping_packs pack on pack.id=entry.mapping_pack_id
   cross join lateral pg_catalog.unnest(entry.iso_control_references) reviewed(reference_value)
   where pack.version='github-iso-27001-v1'
     and not exists (
       select 1 from public.requirements requirement
       join public.frameworks framework on framework.id=requirement.framework_id
       join public.requirement_control_mappings requirement_mapping on requirement_mapping.requirement_id=requirement.id
       join public.controls control on control.id=requirement_mapping.control_id
       where framework.slug='iso-27001' and framework.version='2022'
         and requirement.code=pg_catalog.regexp_replace(reviewed.reference_value,'^A[.]','')
     )),
  0::bigint,
  'every reviewed A-prefixed ISO reference resolves through the 2022 requirement catalogue to an internal control'
);

select ok(has_function_privilege('service_role', 'public.approve_github_mapping_pack_server(uuid,uuid,text,text)', 'EXECUTE'), 'only the server boundary can approve mapping packs');
select ok(not has_function_privilege('authenticated', 'public.approve_github_mapping_pack_server(uuid,uuid,text,text)', 'EXECUTE'), 'authenticated callers cannot target a workspace approval RPC directly');
select ok(not has_function_privilege('anon', 'public.approve_github_mapping_pack_server(uuid,uuid,text,text)', 'EXECUTE'), 'anonymous callers cannot approve mapping packs');
select ok(has_function_privilege('service_role', 'public.materialise_github_observations_server(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'), 'only the server boundary can materialise official results');
select ok(not has_function_privilege('authenticated', 'public.materialise_github_observations_server(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'), 'authenticated callers cannot target another workspace through the materialiser');
select ok(not has_function_privilege('anon', 'public.materialise_github_observations_server(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'), 'anonymous callers cannot materialise official results');
select ok(not has_table_privilege('service_role', 'public.github_mapping_approvals', 'INSERT,UPDATE,DELETE'), 'service clients cannot bypass approval RPCs with direct DML');
select ok(not has_table_privilege('service_role', 'public.github_evidence_provenance', 'INSERT,UPDATE,DELETE'), 'service clients cannot forge evidence provenance directly');
select ok(not has_table_privilege('service_role', 'public.github_finding_provenance', 'INSERT,UPDATE,DELETE'), 'service clients cannot forge finding provenance directly');
select ok(not has_table_privilege('authenticated', 'public.github_mapping_approvals', 'INSERT,UPDATE,DELETE'), 'authenticated clients cannot write approvals directly');
select ok(not has_table_privilege('authenticated', 'public.github_evidence_provenance', 'INSERT,UPDATE,DELETE'), 'authenticated clients cannot write evidence provenance directly');
select ok(not has_table_privilege('authenticated', 'public.github_finding_provenance', 'INSERT,UPDATE,DELETE'), 'authenticated clients cannot write finding provenance directly');
select ok(not has_table_privilege('anon', 'public.github_mapping_packs', 'SELECT'), 'anonymous callers cannot inspect mapping packs');

begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','github-material-owner@example.test','',now(),'{}','{}'),
 ('71000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','github-material-admin@example.test','',now(),'{}','{}'),
 ('71000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','github-material-member@example.test','',now(),'{}','{}'),
 ('71000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','github-material-outsider@example.test','',now(),'{}','{}');

insert into public.organisations(id,name,slug,created_by) values
 ('71000000-0000-4000-8000-000000000001','GitHub Material Org A','github-material-org-a','71000000-0000-4000-8000-000000000001'),
 ('71000000-0000-4000-8000-000000000002','GitHub Material Org B','github-material-org-b','71000000-0000-4000-8000-000000000004');
insert into public.memberships(organisation_id,user_id,role) values
 ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','owner'),
 ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','admin'),
 ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','member'),
 ('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','member'),
 ('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000004','owner');

insert into public.github_installations(
 id,organisation_id,provider_installation_id,account_id,account_login,account_type,
 repository_selection,status,connected_by,permissions,permissions_ok
) values (
 '71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000001',71001,72001,
 'Compliance-Test','Organization','selected','active','71000000-0000-4000-8000-000000000001','{"metadata":"read"}',true
);
insert into public.github_repositories(
 id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
 html_url,visibility,default_branch,archived,selected,available
) values (
 '71000000-0000-4000-8000-000000000201','71000000-0000-4000-8000-000000000001',
 '71000000-0000-4000-8000-000000000101',73001,'Compliance-Test','portal','Compliance-Test/portal',
 'https://github.com/Compliance-Test/portal','private','main',false,true,true
);

set local session_replication_role = replica;
insert into public.github_mapping_packs(id,version,title,checksum,published_at) values (
 '71000000-0000-4000-8000-000000000501','github-test-missing-v1','Test pack with an unresolved ISO requirement',repeat('c',64),now()
);
insert into public.github_mapping_entries(
 id,mapping_pack_id,check_id,rule_version,iso_control_references,failure_severity,remediation,treatments
) values (
 '71000000-0000-4000-8000-000000000502','71000000-0000-4000-8000-000000000501',
 'github.branch.stale_approvals','github-repository-v1',array['A.8.99'],'medium',
 'Dismiss stale approvals when new commits are pushed.',
  '{"pass":{"kind":"evidence","summary":"Passing creates evidence."},"fail":{"kind":"finding","summary":"Failure creates a finding."},"unknown":{"kind":"explanatory","summary":"Unknown is explanatory."},"not_applicable":{"kind":"explanatory","summary":"Not applicable is explanatory."}}'
);
set local session_replication_role = origin;

insert into public.github_installations(
 id,organisation_id,provider_installation_id,account_id,account_login,account_type,
 repository_selection,status,connected_by,permissions,permissions_ok
) values (
 '71000000-0000-4000-8000-000000000102','71000000-0000-4000-8000-000000000001',71002,72001,
 'Compliance-Test','Organization','selected','active','71000000-0000-4000-8000-000000000001','{"metadata":"read"}',true
);
insert into public.github_repositories(
 id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
 html_url,visibility,default_branch,archived,selected,available
) values (
 '71000000-0000-4000-8000-000000000202','71000000-0000-4000-8000-000000000001',
 '71000000-0000-4000-8000-000000000102',73001,'Compliance-Test','portal','Compliance-Test/portal',
 'https://github.com/Compliance-Test/portal','private','main',false,true,true
);

insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
 status,diagnostic_code,started_at,completed_at,observation_count,passed_count,failed_count,
 unknown_count,not_applicable_count,lease_token,lease_expires_at,attempt
) values
 ('71000000-0000-4000-8000-000000000301','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','pass-1','succeeded',null,now()-interval '3 hours',now()-interval '89 minutes',1,1,0,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000302','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','pass-2','succeeded',null,now()-interval '3 hours',now()-interval '79 minutes',1,1,0,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000303','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','fail-1','succeeded',null,now()-interval '3 hours',now()-interval '69 minutes',1,0,1,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000304','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','fail-2','succeeded',null,now()-interval '3 hours',now()-interval '59 minutes',1,0,1,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000305','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','stale-pass','succeeded',null,now()-interval '3 hours',now()-interval '49 minutes',1,1,0,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000306','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','older-pass','succeeded',null,now()-interval '3 hours',now()-interval '39 minutes',1,1,0,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000307','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','unknown','partial',null,now()-interval '3 hours',now()-interval '29 minutes',1,0,0,1,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000308','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','not-applicable','succeeded',null,now()-interval '3 hours',now()-interval '28 minutes',1,0,0,0,1,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000309','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','failed-pass','failed','provider_unavailable',now()-interval '3 hours',now()-interval '27 minutes',1,1,0,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000310','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','fresh-resolve','succeeded',null,now()-interval '3 hours',now()-interval '19 minutes',1,1,0,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000311','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','fail-reopen','succeeded',null,now()-interval '3 hours',now()-interval '9 minutes',1,0,1,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000312','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','concurrent-pass','succeeded',null,now()-interval '3 hours',now()-interval '7 minutes',1,1,0,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000313','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','risk-fail','succeeded',null,now()-interval '3 hours',now()-interval '5 minutes',1,0,1,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000314','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'manual','missing-map','succeeded',null,now()-interval '3 hours',now()-interval '3 minutes',1,1,0,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1),
 ('71000000-0000-4000-8000-000000000315','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000102','71000000-0000-4000-8000-000000000202',73001,'webhook','reconnected-fail','succeeded',null,now()-interval '3 hours',now()-interval '1 minute',1,0,1,0,0,extensions.gen_random_uuid(),now()-interval '179 minutes',1);

insert into public.github_observations(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
 remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
) values
 ('71000000-0000-4000-8000-000000000401','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000301','pass-1','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','pass',null,'Stale approvals are dismissed','The branch rule dismisses stale approvals.',null,now()-interval '90 minutes',now()+interval '30 hours','https://github.com/Compliance-Test/portal',repeat('1',64),null),
 ('71000000-0000-4000-8000-000000000402','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000302','pass-2','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','pass',null,'Stale approvals are dismissed','The branch rule still dismisses stale approvals.',null,now()-interval '80 minutes',now()+interval '31 hours','https://github.com/Compliance-Test/portal',repeat('2',64),null),
 ('71000000-0000-4000-8000-000000000403','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000303','fail-1','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','fail','medium','Stale approvals remain valid','The branch rule retains stale approvals.','Dismiss stale approvals when new commits are pushed.',now()-interval '70 minutes',now()+interval '32 hours','https://github.com/Compliance-Test/portal',repeat('3',64),null),
 ('71000000-0000-4000-8000-000000000404','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000304','fail-2','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','fail','medium','Stale approvals remain valid','The condition is still detected.','Dismiss stale approvals when new commits are pushed.',now()-interval '60 minutes',now()+interval '33 hours','https://github.com/Compliance-Test/portal',repeat('4',64),null),
 ('71000000-0000-4000-8000-000000000405','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000305','stale-pass','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','pass',null,'Expired passing observation','This pass is no longer fresh.',null,now()-interval '2 hours',now()-interval '1 hour','https://github.com/Compliance-Test/portal',repeat('5',64),null),
 ('71000000-0000-4000-8000-000000000406','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000306','older-pass','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','pass',null,'Older passing observation','This pass predates the latest failure.',null,now()-interval '65 minutes',now()+interval '34 hours','https://github.com/Compliance-Test/portal',repeat('6',64),null),
 ('71000000-0000-4000-8000-000000000407','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000307','unknown','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','unknown',null,'GitHub permission unavailable','GitHub could not establish the branch rule.',null,now()-interval '30 minutes',now()+interval '35 hours','https://github.com/Compliance-Test/portal',repeat('7',64),'permission_denied'),
 ('71000000-0000-4000-8000-000000000408','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000308','not-applicable','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','not_applicable',null,'Check is not applicable','The repository state makes the check inapplicable.',null,now()-interval '29 minutes',now()+interval '35 hours','https://github.com/Compliance-Test/portal',repeat('8',64),null),
 ('71000000-0000-4000-8000-000000000409','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000309','failed-pass','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','pass',null,'Untrusted failed-run pass','A failed run cannot resolve a finding.',null,now()-interval '28 minutes',now()+interval '35 hours','https://github.com/Compliance-Test/portal',repeat('9',64),null),
 ('71000000-0000-4000-8000-000000000410','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000310','fresh-resolve','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','pass',null,'Fresh passing verification','A later verified run passes.',null,now()-interval '20 minutes',now()+interval '35 hours','https://github.com/Compliance-Test/portal',repeat('a',64),null),
 ('71000000-0000-4000-8000-000000000411','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000311','fail-reopen','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','fail','medium','Failure returned','A newer run detects the condition again.','Dismiss stale approvals when new commits are pushed.',now()-interval '10 minutes',now()+interval '35 hours','https://github.com/Compliance-Test/portal',repeat('b',64),null),
 ('71000000-0000-4000-8000-000000000412','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000312','concurrent-pass','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','pass',null,'Concurrent fresh pass','Concurrent calls must materialise this once.',null,now()-interval '8 minutes',now()+interval '35 hours','https://github.com/Compliance-Test/portal',repeat('c',64),null),
 ('71000000-0000-4000-8000-000000000413','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000313','risk-fail','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','fail','medium','Accepted risk remains detected','Risk acceptance does not change the technical result.','Dismiss stale approvals when new commits are pushed.',now()-interval '6 minutes',now()+interval '35 hours','https://github.com/Compliance-Test/portal',repeat('d',64),null),
 ('71000000-0000-4000-8000-000000000414','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000201',73001,'71000000-0000-4000-8000-000000000314','missing-map','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','pass',null,'Unmapped passing observation','The test pack cannot resolve its ISO code.',null,now()-interval '4 minutes',now()+interval '35 hours','https://github.com/Compliance-Test/portal',repeat('e',64),null),
 ('71000000-0000-4000-8000-000000000415','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000102','71000000-0000-4000-8000-000000000202',73001,'71000000-0000-4000-8000-000000000315','reconnected-fail','github.branch.stale_approvals','github-repository-v1','github_repository','Compliance-Test/portal','fail','medium','Failure after reconnection','The same stable repository remains non-compliant after GitHub App reconnection.','Dismiss stale approvals when new commits are pushed.',now()-interval '2 minutes',now()+interval '35 hours','https://github.com/Compliance-Test/portal',repeat('f',64),null);
commit;

create or replace function pg_temp.github_decision(target_observation_id uuid, target_kind text)
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'observation_id', target_observation_id,
    'treatment_kind', target_kind,
    'iso_control_references', pg_catalog.to_jsonb(array['A.8.32']::text[]),
    'failure_severity', 'medium',
    'remediation', 'Dismiss stale approvals when new commits are pushed.'
  ));
$$;

set role authenticated;
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}',false);
select throws_ok(
  $$ select public.approve_github_mapping_pack_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f') $$,
  '42501', null, 'an authenticated Owner cannot bypass the server-side active-workspace boundary'
);
reset role;

set role service_role;
select throws_ok(
  $$ select public.approve_github_mapping_pack_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f') $$,
  '42501', 'GitHub mapping approval requires a current workspace Owner', 'an Admin cannot approve a mapping pack'
);
select throws_ok(
  $$ select public.approve_github_mapping_pack_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f') $$,
  '42501', 'GitHub mapping approval requires a current workspace Owner', 'a Member cannot approve a mapping pack'
);
select throws_ok(
  $$ select public.approve_github_mapping_pack_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000004','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f') $$,
  '42501', 'GitHub mapping approval requires a current workspace Owner', 'an outsider cannot approve a mapping pack'
);
select throws_ok(
  $$ select public.approve_github_mapping_pack_server('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f') $$,
  '42501', 'GitHub mapping approval requires a current workspace Owner', 'a dual-workspace Member cannot target a non-active workspace through the server boundary'
);
select set_config(
  'app.github_approval',
  public.approve_github_mapping_pack_server(
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
    'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f'
  )::text,
  false
);
select is(
  public.approve_github_mapping_pack_server(
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
    'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f'
  ),
  current_setting('app.github_approval')::uuid,
  'repeating the exact Owner approval is idempotent'
);
select is((select count(*) from public.github_mapping_approvals where organisation_id='71000000-0000-4000-8000-000000000001' and revoked_at is null),1::bigint,'one workspace has one active approval');
select throws_ok(
  $$ select public.revoke_github_mapping_approval_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003',current_setting('app.github_approval')::uuid) $$,
  '42501', 'GitHub mapping revocation requires a current workspace Owner', 'a Member cannot revoke a mapping approval'
);
select is(
  public.revoke_github_mapping_approval_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',current_setting('app.github_approval')::uuid),
  true,
  'an Owner can revoke the active mapping approval'
);
select is((select count(*) from public.github_mapping_approvals where organisation_id='71000000-0000-4000-8000-000000000001' and revoked_at is null),0::bigint,'revocation leaves no active approval');
select set_config(
  'app.github_approval',
  public.approve_github_mapping_pack_server(
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
    'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f'
  )::text,
  false
);
reset role;

select throws_ok(
  $$ update public.github_mapping_packs set title='tampered' where version='github-test-missing-v1' $$,
  'P0001', 'GitHub mapping packs are immutable', 'mapping-pack versions cannot be rewritten'
);
select throws_ok(
  $$ delete from public.github_mapping_entries where mapping_pack_id='71000000-0000-4000-8000-000000000501' $$,
  'P0001', 'GitHub mapping entries are immutable', 'mapping entries cannot be removed'
);
select throws_ok(
  $$ insert into public.github_mapping_entries(
       mapping_pack_id,check_id,rule_version,iso_control_references,failure_severity,remediation,treatments
     ) values (
       '91000000-0000-4000-8000-000000000001','github.test.append','github-repository-v1',array['A.8.32'],'medium',
       'This direct append must never become part of a published mapping pack.',
       '{"pass":{"kind":"evidence","summary":"Passing creates evidence."},"fail":{"kind":"finding","summary":"Failure creates a finding."},"unknown":{"kind":"explanatory","summary":"Unknown is explanatory."},"not_applicable":{"kind":"explanatory","summary":"Not applicable is explanatory."}}'
     ) $$,
  'P0001', 'GitHub mapping entries are immutable', 'published mapping-pack content is append-proof'
);
select throws_ok(
  $$ update public.github_mapping_approvals set approved_by='71000000-0000-4000-8000-000000000002' where id=current_setting('app.github_approval')::uuid $$,
  'P0001', 'GitHub mapping approval identity is immutable', 'approval identity and actor cannot be rewritten'
);

select set_config('app.protected_soa',(select count(*)::text from public.soa_items where organisation_id='71000000-0000-4000-8000-000000000001'),false);
select set_config('app.protected_assessments',(select count(*)::text from public.assessment_sessions where organisation_id='71000000-0000-4000-8000-000000000001'),false);
select set_config('app.protected_risks',(select count(*)::text from public.risks where organisation_id='71000000-0000-4000-8000-000000000001'),false);
select set_config('app.protected_leadership',(select count(*)::text from public.leadership_report_snapshots where organisation_id='71000000-0000-4000-8000-000000000001'),false);

set role service_role;
select throws_ok(
  $$ insert into public.monitoring_findings(
       organisation_id,check_id,control_ref,subject_type,subject_id,severity,title,finding_origin
     ) values (
       '71000000-0000-4000-8000-000000000001','github.direct_forge','A.8.32',
       'github_repository','Compliance-Test/portal','medium','Unverified direct finding','github'
     ) $$,
  'P0001', 'official GitHub findings require verified materialisation',
  'a generic service client cannot forge an official GitHub finding outside materialisation'
);
select throws_ok(
  $$ select public.materialise_github_observations_server(
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000301',
    'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
    pg_temp.github_decision('71000000-0000-4000-8000-000000000401','evidence')
  ) $$,
  '42501', 'GitHub materialisation requires a current workspace Owner',
  'the server materialiser revalidates its explicit actor against the exact workspace'
);
select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000301',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000401','evidence')
)::text,false);
select is((current_setting('app.material_summary')::jsonb->>'evidence_created')::int,1,'a fresh pass creates one official evidence record');
select is((select count(*) from public.evidence where organisation_id='71000000-0000-4000-8000-000000000001'),1::bigint,'one pass produces exactly one evidence row');
select is((select count(*) from public.evidence_links link join public.controls control on control.id=link.control_id where link.organisation_id='71000000-0000-4000-8000-000000000001' and control.code like 'CH-%'),1::bigint,'ISO requirement A.8.32 resolves through the catalogue to an internal control link');
select is((select count(*) from public.github_evidence_provenance where observation_id='71000000-0000-4000-8000-000000000401'),1::bigint,'evidence retains exact observation/run/repository/approval provenance');
select lives_ok(
  $$ update public.evidence set status='expiring'
     where id=(select evidence_id from public.github_evidence_provenance where observation_id='71000000-0000-4000-8000-000000000401') $$,
  'the service-role daily sweep can mark verified official evidence expiring'
);
select throws_ok(
  $$ update public.evidence set status='superseded'
     where id=(select evidence_id from public.github_evidence_provenance where observation_id='71000000-0000-4000-8000-000000000401') $$,
  'P0001', 'official GitHub evidence lifecycle is server-managed',
  'a generic service client still cannot supersede official evidence'
);
reset role;

set session_replication_role = replica;
update public.evidence
set status='current', valid_until=current_date-1
where id=(select evidence_id from public.github_evidence_provenance where observation_id='71000000-0000-4000-8000-000000000401');
set session_replication_role = origin;
set role service_role;
select lives_ok(
  $$ update public.evidence set status='expired'
     where id=(select evidence_id from public.github_evidence_provenance where observation_id='71000000-0000-4000-8000-000000000401') $$,
  'the service-role daily sweep can mark verified official evidence expired'
);
select throws_ok(
  $$ update public.evidence set status='withdrawn'
     where id=(select evidence_id from public.github_evidence_provenance where observation_id='71000000-0000-4000-8000-000000000401') $$,
  'P0001', 'official GitHub evidence lifecycle is server-managed',
  'a generic service client still cannot withdraw official evidence'
);
reset role;

set role authenticated;
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000003","role":"authenticated"}',false);
select throws_ok(
  $$ update public.evidence set status='withdrawn'
     where id=(select evidence_id from public.github_evidence_provenance where observation_id='71000000-0000-4000-8000-000000000401') $$,
  'P0001', 'official GitHub evidence lifecycle is server-managed',
  'a generic member evidence update cannot withdraw official GitHub evidence'
);
select throws_ok(
  $$ delete from public.evidence_links
     where evidence_id=(select evidence_id from public.github_evidence_provenance where observation_id='71000000-0000-4000-8000-000000000401') $$,
  'P0001', 'official GitHub evidence links are server-managed',
  'a generic member link deletion cannot detach official GitHub evidence from its mapped control'
);
select throws_ok(
  $$ insert into public.evidence_links(organisation_id,evidence_id,control_id,created_by)
     select '71000000-0000-4000-8000-000000000001',provenance.evidence_id,control.id,'71000000-0000-4000-8000-000000000003'
     from public.github_evidence_provenance provenance cross join lateral (
       select id from public.controls where id not in (select control_id from public.evidence_links where evidence_id=provenance.evidence_id) limit 1
     ) control where provenance.observation_id='71000000-0000-4000-8000-000000000401' $$,
  'P0001', 'official GitHub evidence links are server-managed',
  'a generic member cannot add an unapproved control link to official GitHub evidence'
);
reset role;

set role service_role;

select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000301',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000401','evidence')
)::text,false);
select is((current_setting('app.material_summary')::jsonb->>'skipped')::int,1,'replaying the same run is exact-once');
select is((select count(*) from public.evidence where organisation_id='71000000-0000-4000-8000-000000000001'),1::bigint,'a replay does not duplicate evidence');

select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000302',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000402','evidence')
)::text,false);
select is((current_setting('app.material_summary')::jsonb->>'evidence_refreshed')::int,1,'a newer pass refreshes evidence with a new immutable record');
select is((select count(*) from public.evidence where organisation_id='71000000-0000-4000-8000-000000000001'),2::bigint,'a refresh retains both historical and current evidence');
select is((select count(*) from public.evidence where organisation_id='71000000-0000-4000-8000-000000000001' and status='superseded'),1::bigint,'the prior evidence is superseded atomically');
select is((select count(*) from public.github_evidence_provenance where supersedes_evidence_id is not null),1::bigint,'the new provenance records one supersession lineage edge');

select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000305',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000405','evidence')
)::text,false);
select is((current_setting('app.material_summary')::jsonb->>'skipped')::int,1,'an expired pass cannot refresh official evidence');
select is((select count(*) from public.evidence where organisation_id='71000000-0000-4000-8000-000000000001'),2::bigint,'stale evidence input creates no record');

select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000303',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000403','finding')
)::text,false);
select is((current_setting('app.material_summary')::jsonb->>'findings_created')::int,1,'a failure creates one mapped GitHub finding');
select is((select count(*) from public.monitoring_findings where organisation_id='71000000-0000-4000-8000-000000000001' and finding_origin='github'),1::bigint,'the stable GitHub finding identity deduplicates separately from legacy monitors');

select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000304',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000404','finding')
)::text,false);
select is((current_setting('app.material_summary')::jsonb->>'findings_refreshed')::int,1,'a newer repeat failure refreshes the most-recent detection');
select is((select count(*) from public.monitoring_findings where organisation_id='71000000-0000-4000-8000-000000000001' and finding_origin='github'),1::bigint,'repeat failure does not duplicate the finding');
select is((select latest_failed_observation_id from public.github_finding_provenance), '71000000-0000-4000-8000-000000000404'::uuid, 'finding provenance advances to the newest failure');

select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000306',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000406','evidence')
)::text,false);
select is((select status::text from public.monitoring_findings where finding_origin='github'),'open','a pass older than the newest failure cannot resolve the finding');

select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000307',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000407','explanatory')
)::text,false);
select is((current_setting('app.material_summary')::jsonb->>'skipped')::int,1,'unknown observations remain explanatory');
select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000308',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000408','explanatory')
)::text,false);
select is((select status::text from public.monitoring_findings where finding_origin='github'),'open','not-applicable observations cannot resolve a finding');
select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000309',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000409','evidence')
)::text,false);
select is((select status::text from public.monitoring_findings where finding_origin='github'),'open','a passing observation from a failed run cannot resolve a finding');
reset role;

set role service_role;
select lives_ok(
  $$ select public.transition_github_finding_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',(select id from public.monitoring_findings where finding_origin='github'),'acknowledged','Owner reviewed the finding.') $$,
  'an Owner can record an acknowledged transition with a reason'
);
select lives_ok(
  $$ select public.transition_github_finding_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',(select id from public.monitoring_findings where finding_origin='github'),'in_progress','Remediation has started.') $$,
  'an Owner can move a GitHub finding into progress'
);
select lives_ok(
  $$ select public.transition_github_finding_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',(select id from public.monitoring_findings where finding_origin='github'),'exception_requested','An exception review is required.') $$,
  'an Owner can request an exception with an audited reason'
);
select lives_ok(
  $$ select public.transition_github_finding_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',(select id from public.monitoring_findings where finding_origin='github'),'open','Return the unresolved technical condition to open.') $$,
  'a reviewed non-resolution state can return to open'
);
select throws_ok(
  $$ select public.transition_github_finding_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',(select id from public.monitoring_findings where finding_origin='github'),'resolved','Human closure is not verification.') $$,
  '22023', 'a GitHub finding resolves only through a newer fresh pass', 'a human transition cannot mark the finding resolved'
);
select is((select count(*) from public.github_finding_transitions where actor_id='71000000-0000-4000-8000-000000000001'),4::bigint,'every valid human finding-state transition is retained with its actor and reason');
reset role;

set role authenticated;
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}',false);
select set_config('app.github_task',public.raise_monitoring_finding_task(
  '71000000-0000-4000-8000-000000000001',(select id from public.monitoring_findings where finding_origin='github'),'71000000-0000-4000-8000-000000000001'
)::text,false);
select is((select source::text from public.tasks where id=current_setting('app.github_task')::uuid),'github','a remediation task linked to an official finding has explicit GitHub source');
select is((select task_id from public.monitoring_findings where finding_origin='github'),current_setting('app.github_task')::uuid,'finding-task linkage is atomic and tenant-safe');
update public.tasks set status='done' where id=current_setting('app.github_task')::uuid;
select isnt((select status::text from public.monitoring_findings where finding_origin='github'),'resolved','task completion cannot resolve the technical finding');
insert into public.integration_connections(id,organisation_id,provider,label,config,connected_by) values (
 '71000000-0000-4000-8000-000000000601','71000000-0000-4000-8000-000000000001','github','Test GitHub Issues','{}','71000000-0000-4000-8000-000000000001'
);
insert into public.task_tickets(organisation_id,task_id,connection_id,provider,external_id,external_status,created_by) values (
 '71000000-0000-4000-8000-000000000001',current_setting('app.github_task')::uuid,'71000000-0000-4000-8000-000000000601','github','issue-1','closed','71000000-0000-4000-8000-000000000001'
);
select isnt((select status::text from public.monitoring_findings where finding_origin='github'),'resolved','GitHub Issue completion cannot resolve the technical finding');
reset role;

set role service_role;
select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000310',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000410','evidence')
)::text,false);
select is((current_setting('app.material_summary')::jsonb->>'findings_resolved')::int,1,'only a newer fresh pass resolves the mapped GitHub finding');
select is((select status::text from public.monitoring_findings where finding_origin='github'),'resolved','fresh verification persists the resolved state');

select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000311',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000411','finding')
)::text,false);
select is((current_setting('app.material_summary')::jsonb->>'findings_reopened')::int,1,'a newer failure reopens the same resolved finding');
select is((select count(*) from public.monitoring_findings where finding_origin='github'),1::bigint,'reopening retains one stable finding');

select lives_ok(
  $$ select public.transition_github_finding_server('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',(select id from public.monitoring_findings where finding_origin='github'),'risk_accepted','The Owner records the business decision while the technical condition stays visible.') $$,
  'risk acceptance is a valid audited state'
);
select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000313',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000413','finding')
)::text,false);
select is((select status::text from public.monitoring_findings where finding_origin='github'),'risk_accepted','a repeat technical failure does not turn risk acceptance into a pass');

select set_config('app.material_summary',public.materialise_github_observations_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000315',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_temp.github_decision('71000000-0000-4000-8000-000000000415','finding')
)::text,false);
select is((current_setting('app.material_summary')::jsonb->>'findings_refreshed')::int,1,'reinstallation refreshes the same stable GitHub finding without conflict');
select is((select count(*) from public.monitoring_findings where finding_origin='github'),1::bigint,'reinstallation does not duplicate the stable repository finding');
select is((select status::text from public.monitoring_findings where finding_origin='github'),'risk_accepted','reinstallation refresh preserves the unresolved human state');
select is((select provider_repository_id from public.github_finding_provenance),73001::bigint,'finding identity retains the provider repository ID');
select is((select mapping_version from public.github_finding_provenance),'github-iso-27001-v1','finding identity retains the reviewed mapping version');
select is((select installation_id from public.github_finding_provenance),'71000000-0000-4000-8000-000000000101'::uuid,'initial installation ancestry remains immutable');
select is((select latest_installation_id from public.github_finding_provenance),'71000000-0000-4000-8000-000000000102'::uuid,'latest ancestry advances to the reconnected installation');
select is((select latest_repository_id from public.github_finding_provenance),'71000000-0000-4000-8000-000000000202'::uuid,'latest ancestry advances to the reconnected repository row');
select is((select latest_failed_observation_id from public.github_finding_provenance),'71000000-0000-4000-8000-000000000415'::uuid,'latest failed observation retains its reconnected ancestry');
select is(
  (select identity_key from public.github_finding_provenance),
  pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
    '71000000-0000-4000-8000-000000000001'::uuid,73001::bigint,'github.branch.stale_approvals','github-iso-27001-v1'
  )::text,'UTF8'),'sha256'),'hex'),
  'GitHub finding identity is exactly workspace, provider repository, check, and mapping version'
);

select set_config('app.bad_approval',public.approve_github_mapping_pack_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','github-test-missing-v1',repeat('c',64)
)::text,false);
select set_config('app.evidence_before_bad',(select count(*)::text from public.evidence where organisation_id='71000000-0000-4000-8000-000000000001'),false);
select throws_ok(
  $$ select public.materialise_github_observations_server(
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000314',
    'github-test-missing-v1',repeat('c',64),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'observation_id','71000000-0000-4000-8000-000000000414','treatment_kind','evidence',
      'iso_control_references',pg_catalog.to_jsonb(array['A.8.99']::text[]),'failure_severity','medium',
      'remediation','Dismiss stale approvals when new commits are pushed.'
    ))
  ) $$,
  'P0001', 'approved ISO requirement has no internal control mapping', 'a missing requirement-to-control mapping aborts materialisation'
);
select is((select count(*) from public.evidence where organisation_id='71000000-0000-4000-8000-000000000001'),current_setting('app.evidence_before_bad')::bigint,'missing mapping failure is atomic with no partial evidence');
select set_config('app.github_approval',public.approve_github_mapping_pack_server(
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
  'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f'
)::text,false);
reset role;

insert into public.evidence(
  id,organisation_id,title,kind,url,description,owner_id,collected_on,valid_until,status,created_by
) values (
  '71000000-0000-4000-8000-000000000700','71000000-0000-4000-8000-000000000001',
  'Cross-tenant ancestry probe','link','https://github.com/Compliance-Test/portal','Test-only evidence row.',
  '71000000-0000-4000-8000-000000000001',current_date,current_date+1,'current',
  '71000000-0000-4000-8000-000000000001'
);
select throws_ok(
  $$ insert into public.github_evidence_provenance(
    evidence_id,organisation_id,installation_id,repository_id,collection_run_id,observation_id,
    approval_id,mapping_pack_id,identity_key,check_id,rule_version,mapping_version,observed_at,fresh_until
  ) select '71000000-0000-4000-8000-000000000700',
      '71000000-0000-4000-8000-000000000002',installation_id,repository_id,collection_run_id,observation_id,
      approval_id,mapping_pack_id,repeat('f',64),check_id,rule_version,mapping_version,observed_at,fresh_until
    from public.github_evidence_provenance limit 1 $$,
  '23503', null, 'composite provenance ancestry rejects a cross-tenant evidence attachment'
);
select throws_ok(
  $$ update public.github_evidence_provenance set check_id='tampered' where organisation_id='71000000-0000-4000-8000-000000000001' $$,
  'P0001', 'GitHub evidence provenance is immutable', 'evidence provenance cannot be rewritten'
);

set role authenticated;
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000003","role":"authenticated"}',false);
select cmp_ok((select count(*) from public.github_mapping_approvals where organisation_id='71000000-0000-4000-8000-000000000001'),'>',0::bigint,'a workspace Member can read safe approval history');
select cmp_ok((select count(*) from public.github_evidence_provenance where organisation_id='71000000-0000-4000-8000-000000000001'),'>',0::bigint,'a workspace Member can read safe evidence provenance');
select set_config('request.jwt.claims','{"sub":"71000000-0000-4000-8000-000000000004","role":"authenticated"}',false);
select is((select count(*) from public.github_mapping_approvals where organisation_id='71000000-0000-4000-8000-000000000001'),0::bigint,'an outsider cannot read another workspace approval history');
select is((select count(*) from public.github_evidence_provenance where organisation_id='71000000-0000-4000-8000-000000000001'),0::bigint,'an outsider cannot read another workspace evidence provenance');
select is((select count(*) from public.github_finding_provenance where organisation_id='71000000-0000-4000-8000-000000000001'),0::bigint,'an outsider cannot read another workspace finding provenance');
reset role;

select is((select count(*) from public.soa_items where organisation_id='71000000-0000-4000-8000-000000000001'),current_setting('app.protected_soa')::bigint,'materialisation never writes the SoA');
select is((select count(*) from public.assessment_sessions where organisation_id='71000000-0000-4000-8000-000000000001'),current_setting('app.protected_assessments')::bigint,'materialisation never writes assessments');
select is((select count(*) from public.risks where organisation_id='71000000-0000-4000-8000-000000000001'),current_setting('app.protected_risks')::bigint,'materialisation never writes risks');
select is((select count(*) from public.leadership_report_snapshots where organisation_id='71000000-0000-4000-8000-000000000001'),current_setting('app.protected_leadership')::bigint,'materialisation never writes leadership snapshots');
select cmp_ok((select count(*) from public.audit_events where organisation_id='71000000-0000-4000-8000-000000000001' and action='github.materialise'),'>',0::bigint,'materialisation emits bounded safe audit summaries');
select cmp_ok((select count(*) from public.audit_events where organisation_id='71000000-0000-4000-8000-000000000001' and entity_type='github_finding_transitions'),'>',0::bigint,'finding transitions emit immutable audit events');

-- Hold the first remote call open after the function returns. The second call
-- must wait on the same transaction-scoped run/identity lock, then observe the
-- committed provenance and return a skip instead of creating a duplicate.
create temporary table github_materialisation_concurrency_results(summary jsonb);
select extensions.dblink_connect('github_materialise_a','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_connect('github_materialise_b','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_exec('github_materialise_a','set role service_role');
select extensions.dblink_exec('github_materialise_b','set role service_role');
select extensions.dblink_exec('github_materialise_a','begin');
select extensions.dblink_send_query('github_materialise_a',$remote$
  select public.materialise_github_observations_server(
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000312',
    'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
    '[{"observation_id":"71000000-0000-4000-8000-000000000412","treatment_kind":"evidence","iso_control_references":["A.8.32"],"failure_severity":"medium","remediation":"Dismiss stale approvals when new commits are pushed."}]'::jsonb
  )
$remote$);
insert into github_materialisation_concurrency_results
select summary from extensions.dblink_get_result('github_materialise_a') as result(summary jsonb);
select extensions.dblink_send_query('github_materialise_b',$remote$
  select public.materialise_github_observations_server(
    '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000312',
    'github-iso-27001-v1','b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
    '[{"observation_id":"71000000-0000-4000-8000-000000000412","treatment_kind":"evidence","iso_control_references":["A.8.32"],"failure_severity":"medium","remediation":"Dismiss stale approvals when new commits are pushed."}]'::jsonb
  )
$remote$);
select pg_catalog.pg_sleep(0.1);
select is(extensions.dblink_is_busy('github_materialise_b'),1,'a concurrent replay waits on the first materialisation transaction');
select extensions.dblink_exec('github_materialise_a','commit');
insert into github_materialisation_concurrency_results
select summary from extensions.dblink_get_result('github_materialise_b') as result(summary jsonb);
select is((select count(*) from public.github_evidence_provenance where observation_id='71000000-0000-4000-8000-000000000412'),1::bigint,'concurrent calls materialise one provenance row exactly once');
select is((select sum((summary->>'skipped')::int) from github_materialisation_concurrency_results),1::bigint,'one concurrent caller reports the committed duplicate as skipped');
select extensions.dblink_disconnect('github_materialise_a');
select extensions.dblink_disconnect('github_materialise_b');

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.task_tickets where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.integration_connections where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.evidence_links where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_evidence_provenance where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.evidence where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_finding_transitions where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_finding_provenance where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.monitoring_findings where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.tasks where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_mapping_approvals where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.audit_events where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_observations where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_collection_runs where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_repositories where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_installations where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.memberships where organisation_id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.organisations where id in ('71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002');
delete from public.github_mapping_entries where mapping_pack_id in (select id from public.github_mapping_packs where version='github-test-missing-v1');
delete from public.github_mapping_packs where version='github-test-missing-v1';
delete from public.profiles where id::text like '71000000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '71000000-0000-4000-8000-00000000000%';
commit;
