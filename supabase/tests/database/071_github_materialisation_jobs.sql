create extension if not exists dblink with schema extensions;

begin;
set local session_replication_role = replica;
delete from public.github_materialisation_jobs where organisation_id in (
  '72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002'
);
delete from public.github_mapping_approvals where organisation_id in (
  '72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002'
);
delete from public.github_collection_runs where organisation_id in (
  '72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002'
);
delete from public.github_repositories where organisation_id in (
  '72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002'
);
delete from public.github_installations where organisation_id in (
  '72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002'
);
delete from public.memberships where organisation_id in (
  '72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002'
);
delete from public.organisations where id in (
  '72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002'
);
delete from public.profiles where id::text like '72000000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '72000000-0000-4000-8000-00000000000%';
commit;

select no_plan();

select has_table('public','github_materialisation_jobs','terminal collection work has a durable queue');
select has_column('public','github_materialisation_jobs','lease_token','claims use compare-and-set lease tokens');
select has_column('public','github_materialisation_jobs','available_at','retry scheduling is durable');
select has_column('public','github_materialisation_jobs','exhausted_at','dead-letter attention has a durable timestamp');
select has_fk('public','github_materialisation_jobs','github_materialisation_jobs_run_ancestry_fk');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid='public.github_materialisation_jobs'::regclass),
  'materialisation jobs enforce RLS'
);
select ok(has_function_privilege('service_role','public.claim_github_materialisation_jobs_server(integer,uuid[])','EXECUTE'),'service role can claim bounded jobs');
select ok(not has_function_privilege('authenticated','public.claim_github_materialisation_jobs_server(integer,uuid[])','EXECUTE'),'authenticated callers cannot claim jobs');
select ok(not has_function_privilege('anon','public.claim_github_materialisation_jobs_server(integer,uuid[])','EXECUTE'),'anonymous callers cannot claim jobs');
select ok(has_function_privilege('service_role','public.finalize_github_materialisation_job_server(uuid,uuid,integer,text)','EXECUTE'),'service role can finalise a matching lease');
select ok(not has_function_privilege('authenticated','public.finalize_github_materialisation_job_server(uuid,uuid,integer,text)','EXECUTE'),'authenticated callers cannot finalise jobs');
select ok(has_function_privilege('service_role','public.inspect_github_materialisation_jobs_server(integer,uuid[])','EXECUTE'),'service recovery can inspect bounded queue state');
select ok(not has_function_privilege('authenticated','public.inspect_github_materialisation_jobs_server(integer,uuid[])','EXECUTE'),'authenticated callers cannot invoke cross-tenant queue inspection');
select ok(not has_function_privilege('anon','public.inspect_github_materialisation_jobs_server(integer,uuid[])','EXECUTE'),'anonymous callers cannot invoke cross-tenant queue inspection');
select ok(not has_table_privilege('service_role','public.github_materialisation_jobs','INSERT,UPDATE,DELETE'),'service clients cannot bypass the job RPCs');
select ok(not has_table_privilege('authenticated','public.github_materialisation_jobs','INSERT,UPDATE,DELETE'),'members cannot mutate queue state');

begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('72000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','github-job-owner-a@example.test','',now(),'{}','{}'),
 ('72000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','github-job-owner-b@example.test','',now(),'{}','{}'),
 ('72000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','github-job-outsider@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by) values
 ('72000000-0000-4000-8000-000000000001','GitHub Job Org A','github-job-org-a','72000000-0000-4000-8000-000000000001'),
 ('72000000-0000-4000-8000-000000000002','GitHub Job Org B','github-job-org-b','72000000-0000-4000-8000-000000000002');
insert into public.memberships(organisation_id,user_id,role) values
 ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','owner'),
 ('72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000002','owner');
insert into public.github_installations(
 id,organisation_id,provider_installation_id,account_id,account_login,account_type,
 repository_selection,status,connected_by,permissions,permissions_ok
) values
 ('72000000-0000-4000-8000-000000000101','72000000-0000-4000-8000-000000000001',72101,72201,'Job-A','Organization','selected','active','72000000-0000-4000-8000-000000000001','{}',true),
 ('72000000-0000-4000-8000-000000000102','72000000-0000-4000-8000-000000000002',72102,72202,'Job-B','Organization','selected','active','72000000-0000-4000-8000-000000000002','{}',true);
insert into public.github_repositories(
 id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
 html_url,visibility,default_branch,archived,selected,available
) values
 ('72000000-0000-4000-8000-000000000201','72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000101',72301,'Job-A','portal','Job-A/portal','https://github.com/Job-A/portal','private','main',false,true,true),
 ('72000000-0000-4000-8000-000000000202','72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000102',72302,'Job-B','portal','Job-B/portal','https://github.com/Job-B/portal','private','main',false,true,true);
insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
 status,started_at,observation_count,passed_count,failed_count,unknown_count,not_applicable_count
) values
 ('72000000-0000-4000-8000-000000000301','72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000101','72000000-0000-4000-8000-000000000201',72301,'manual','job-a-old','running',now()-interval '4 hours',0,0,0,0,0),
 ('72000000-0000-4000-8000-000000000302','72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000101','72000000-0000-4000-8000-000000000201',72301,'manual','job-a-new','running',now()-interval '3 hours',0,0,0,0,0),
 ('72000000-0000-4000-8000-000000000303','72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000101','72000000-0000-4000-8000-000000000201',72301,'manual','job-a-third','running',now()-interval '2 hours',0,0,0,0,0),
 ('72000000-0000-4000-8000-000000000304','72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000102','72000000-0000-4000-8000-000000000202',72302,'manual','job-b-old','running',now()-interval '3 hours',0,0,0,0,0),
 ('72000000-0000-4000-8000-000000000305','72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000101','72000000-0000-4000-8000-000000000201',72301,'manual','job-failed','running',now()-interval '1 hour',0,0,0,0,0),
 ('72000000-0000-4000-8000-000000000306','72000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000102','72000000-0000-4000-8000-000000000202',72302,'manual','job-b-race','running',now()-interval '2 hours',0,0,0,0,0);
update public.github_collection_runs
set status=case when id='72000000-0000-4000-8000-000000000302' then 'partial'::public.github_collection_status else 'succeeded'::public.github_collection_status end,
    completed_at=now(), observation_count=15,
    passed_count=case when id='72000000-0000-4000-8000-000000000302' then 14 else 15 end,
    unknown_count=case when id='72000000-0000-4000-8000-000000000302' then 1 else 0 end
where id in (
 '72000000-0000-4000-8000-000000000301','72000000-0000-4000-8000-000000000302',
 '72000000-0000-4000-8000-000000000303','72000000-0000-4000-8000-000000000304',
 '72000000-0000-4000-8000-000000000306'
);
update public.github_collection_runs
set status='failed',completed_at=now(),diagnostic_code='provider_unavailable'
where id='72000000-0000-4000-8000-000000000305';
commit;

select is((select count(*) from public.github_materialisation_jobs where organisation_id in ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002')),5::bigint,'each succeeded or partial finalisation transactionally enqueues exactly one job');
select is((select count(*) from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000305'),0::bigint,'failed collection runs never enqueue official materialisation');
update public.github_collection_runs set status=status where id='72000000-0000-4000-8000-000000000301';
select is((select count(*) from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000301'),1::bigint,'terminal replay cannot duplicate a job');

set role service_role;
select is((select count(distinct organisation_id) from public.claim_github_materialisation_jobs_server(2,array[
 '72000000-0000-4000-8000-000000000301'::uuid,'72000000-0000-4000-8000-000000000302'::uuid,
 '72000000-0000-4000-8000-000000000303'::uuid,'72000000-0000-4000-8000-000000000304'::uuid
])),2::bigint,'fair claiming gives old work from each tenant a turn before a tenant second job');
reset role;

update public.github_materialisation_jobs set lease_token=null,lease_expires_at=null,attempt_count=0,available_at=now()-interval '1 hour';
set role service_role;
select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000301'::uuid])),1::bigint,'an exact run claim acquires its durable job');
select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000301'::uuid])),0::bigint,'a simultaneous or repeated caller cannot acquire an active lease');
reset role;

update public.github_materialisation_jobs set lease_expires_at=now()-interval '1 second' where collection_run_id='72000000-0000-4000-8000-000000000301';
set role service_role;
select is((select attempt_count from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000301'::uuid])),2,'an expired lease is recoverable with a new attempt');
select ok(not public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000301'),
  extensions.gen_random_uuid(),2,'completed'
),'a stale or losing lease cannot finalise the job');
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000301'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000301'),2,'completed'
),'the exact current lease completes once');
select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000301'::uuid])),0::bigint,'completed jobs are never reclaimed');

select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000302'::uuid])),1::bigint,'a second exact job can be claimed');
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000302'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000302'),1,'awaiting_approval'
),'absence of approval parks the exact job safely');
select ok((select lease_token is null and available_at='infinity'::timestamptz from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000302'),'awaiting approval is parked without a hot lease or recovery timestamp');
reset role;

insert into public.github_mapping_approvals(organisation_id,mapping_pack_id,approved_by)
select '72000000-0000-4000-8000-000000000001',id,'72000000-0000-4000-8000-000000000001'
from public.github_mapping_packs where version='github-iso-27001-v1';
select is((select status from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000302'),'pending','a new active approval wakes parked work for retry');

set role service_role;
select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000303'::uuid])),1::bigint,'retryable work is first acquired with a bounded lease');
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000303'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000303'),1,'retryable'
),'a retryable outcome safely releases the lease');
select ok((select status='retryable' and available_at>now() and lease_token is null from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000303'),'retryable failures retain durable backoff before the attempt ceiling');
reset role;

-- If approval commits after the application observed no approval but before
-- lease finalisation, awaiting_approval must resolve back to immediate pending.
set role service_role;
select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000304'::uuid])),1::bigint,'the approval-before-finalise fixture is claimed');
reset role;
insert into public.github_mapping_approvals(organisation_id,mapping_pack_id,approved_by)
select '72000000-0000-4000-8000-000000000002',id,'72000000-0000-4000-8000-000000000002'
from public.github_mapping_packs where version='github-iso-27001-v1';
set role service_role;
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000304'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000304'),1,'awaiting_approval'
),'awaiting finalisation remains a successful lease CAS when approval already exists');
reset role;
select ok((select status='pending' and available_at<=now() from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000304'),'approval before finalisation cannot strand a job at infinity');

-- Revoke the fixture approval only through privileged test setup, claim a
-- second job, then commit a replacement approval concurrently. Both approval
-- insertion and finalisation serialize on the organisation-specific lock.
begin;
set local session_replication_role=replica;
update public.github_mapping_approvals set revoked_by='72000000-0000-4000-8000-000000000002',revoked_at=now() where organisation_id='72000000-0000-4000-8000-000000000002' and revoked_at is null;
commit;
set role service_role;
select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000306'::uuid])),1::bigint,'the concurrent approval-ordering fixture is claimed');
reset role;
select extensions.dblink_connect('github_job_approval','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_connect('github_job_finalise','host=127.0.0.1 port=5432 dbname='||current_database()||' user=postgres password=postgres connect_timeout=5');
select extensions.dblink_exec('github_job_finalise','set role service_role');
select extensions.dblink_send_query('github_job_approval',$remote$
  insert into public.github_mapping_approvals(organisation_id,mapping_pack_id,approved_by)
  select '72000000-0000-4000-8000-000000000002',id,'72000000-0000-4000-8000-000000000002'
  from public.github_mapping_packs where version='github-iso-27001-v1'
  returning pg_catalog.pg_sleep(0.5)
$remote$);
select pg_catalog.pg_sleep(0.1);
select is(extensions.dblink_is_busy('github_job_approval'),1,'the concurrent approval transaction remains in flight');
select extensions.dblink_send_query('github_job_finalise',$remote$
  select public.finalize_github_materialisation_job_server(
    (select id from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000306'),
    (select lease_token from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000306'),1,'awaiting_approval'
  )
$remote$);
select pg_catalog.pg_sleep(0.1);
select is(extensions.dblink_is_busy('github_job_finalise'),1,'finalisation waits behind the approval transaction lock ordering');
select ignored from extensions.dblink_get_result('github_job_approval') as result(ignored text);
select ok(finalised,'concurrent awaiting finalisation retains the exact lease') from extensions.dblink_get_result('github_job_finalise') as result(finalised boolean);
select ok((select status='pending' and available_at<=now() from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000306'),'concurrent approval ordering cannot strand the job');
select extensions.dblink_disconnect('github_job_approval');
select extensions.dblink_disconnect('github_job_finalise');

update public.github_materialisation_jobs set status='retryable',attempt_count=24,available_at=now()-interval '1 minute',lease_token=null,lease_expires_at=null where collection_run_id='72000000-0000-4000-8000-000000000303';
set role service_role;
select is((select attempt_count from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000303'::uuid])),25,'the final retry is claimed at attempt twenty-five');
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000303'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000303'),25,'retryable'
),'the twenty-fifth retry finalises into durable attention');
reset role;
select ok((select status='exhausted' and exhausted_at is not null and lease_token is null from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000303'),'the twenty-fifth retry becomes explicit exhausted dead-letter state');
set role service_role;
select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000303'::uuid])),0::bigint,'the bounded attempt ceiling prevents an unbounded retry loop');
select results_eq(
  $$ select collection_run_id,status,lease_active from public.inspect_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000303'::uuid]) $$,
  $$ values ('72000000-0000-4000-8000-000000000303'::uuid,'exhausted'::text,false) $$,
  'exact inspection exposes exhausted work as durable attention'
);
reset role;

-- A worker crash on the final leased attempt is dead-lettered when its lease
-- expires; it cannot disappear merely because no finaliser ran.
update public.github_materialisation_jobs set status='retryable',attempt_count=24,available_at=now()-interval '1 minute',lease_token=null,lease_expires_at=null,exhausted_at=null where collection_run_id='72000000-0000-4000-8000-000000000304';
set role service_role;
select is((select attempt_count from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000304'::uuid])),25,'the crash fixture reaches its final leased attempt');
reset role;
update public.github_materialisation_jobs set lease_expires_at=now()-interval '1 second' where collection_run_id='72000000-0000-4000-8000-000000000304';
set role service_role;
select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000304'::uuid])),0::bigint,'an expired final-attempt lease is not reclaimed');
select is((select status from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000304'),'exhausted','an expired final-attempt lease is promoted to dead-letter attention');
select cmp_ok((select count(*) from public.inspect_github_materialisation_jobs_server(20,null) where status='exhausted'),'>=',2::bigint,'generic recovery inspection surfaces exhausted jobs across tenants');
reset role;

-- An active exact lease is inspectable rather than silently treated healthy;
-- completed jobs remain visible but non-reclaimable.
update public.github_materialisation_jobs set status='pending',attempt_count=0,available_at=now(),lease_token=null,lease_expires_at=null where collection_run_id='72000000-0000-4000-8000-000000000306';
set role service_role;
select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000306'::uuid])),1::bigint,'an exact in-progress job can be leased');
select results_eq(
  $$ select collection_run_id,status,lease_active from public.inspect_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000306'::uuid]) $$,
  $$ values ('72000000-0000-4000-8000-000000000306'::uuid,'pending'::text,true) $$,
  'exact inspection represents an active unclaimable lease'
);
select ok(public.finalize_github_materialisation_job_server(
  (select id from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000306'),
  (select lease_token from public.github_materialisation_jobs where collection_run_id='72000000-0000-4000-8000-000000000306'),1,'completed'
),'the inspected active job can complete through its lease');
select results_eq(
  $$ select collection_run_id,status,lease_active from public.inspect_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000306'::uuid]) $$,
  $$ values ('72000000-0000-4000-8000-000000000306'::uuid,'completed'::text,false) $$,
  'exact inspection recognises completed non-reclaimable work'
);
select is((select count(*) from public.claim_github_materialisation_jobs_server(1,array['72000000-0000-4000-8000-000000000306'::uuid])),0::bigint,'completed inspected work remains non-reclaimable');
reset role;

set role authenticated;
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}',false);
select is((select count(*) from public.github_materialisation_jobs),3::bigint,'a member sees only their tenant jobs through RLS');
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000003","role":"authenticated"}',false);
select is((select count(*) from public.github_materialisation_jobs),0::bigint,'an outsider sees no materialisation jobs');
reset role;

select * from finish();

begin;
set local session_replication_role = replica;
delete from public.github_materialisation_jobs where organisation_id in ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002');
delete from public.github_mapping_approvals where organisation_id in ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002');
delete from public.github_collection_runs where organisation_id in ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002');
delete from public.github_repositories where organisation_id in ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002');
delete from public.github_installations where organisation_id in ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002');
delete from public.memberships where organisation_id in ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002');
delete from public.organisations where id in ('72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002');
delete from public.profiles where id::text like '72000000-0000-4000-8000-00000000000%';
delete from auth.users where id::text like '72000000-0000-4000-8000-00000000000%';
commit;
