-- RED contract for organisation-scale, frozen-snapshot GitHub MCP reads.
-- The successor migration must make this suite green without changing v1.
begin;

select plan(62);

select has_function(
  'public', 'get_mcp_github_compliance_results_v2',
  array['uuid','uuid','public.github_observation_result','text','text','public.monitor_severity','integer','text'],
  'GitHub MCP v2: successor read RPC exists'
);
select has_function(
  'public', 'get_mcp_github_compliance_results_v1',
  array['uuid','uuid','public.github_observation_result','text','text','public.monitor_severity','integer'],
  'GitHub MCP v2: v1 remains available for rolling compatibility'
);
select is(
  (select prosecdef from pg_catalog.pg_proc
   where oid='public.get_mcp_github_compliance_results_v2(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer,text)'::pg_catalog.regprocedure),
  true,
  'GitHub MCP v2: authenticated read is a claim-validating security definer'
);
select is(
  (select provolatile::text from pg_catalog.pg_proc
   where oid='public.get_mcp_github_compliance_results_v2(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer,text)'::pg_catalog.regprocedure),
  's',
  'GitHub MCP v2: read is stable'
);
select ok(
  (select proconfig @> array['search_path=""'] from pg_catalog.pg_proc
   where oid='public.get_mcp_github_compliance_results_v2(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer,text)'::pg_catalog.regprocedure),
  'GitHub MCP v2: read pins an empty search path'
);
select ok(
  has_function_privilege('authenticated','public.get_mcp_github_compliance_results_v2(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer,text)','EXECUTE'),
  'GitHub MCP v2: authenticated callers enter the RLS-scoped read'
);
select ok(
  not has_function_privilege('anon','public.get_mcp_github_compliance_results_v2(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer,text)','EXECUTE'),
  'GitHub MCP v2: anonymous callers cannot execute the read'
);
select ok(
  not has_function_privilege('service_role','public.get_mcp_github_compliance_results_v2(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer,text)','EXECUTE'),
  'GitHub MCP v2: service role cannot bypass the authenticated v2 read'
);
select ok(
  has_function_privilege('authenticated','public.get_mcp_github_compliance_results_v1(uuid,uuid,public.github_observation_result,text,text,public.monitor_severity,integer)','EXECUTE'),
  'GitHub MCP v2: v1 authenticated grant remains intact'
);
select ok(
  (select nspowner='postgres'::pg_catalog.regrole from pg_catalog.pg_namespace
       where nspname='mcp_cursor_private')
  and not has_schema_privilege('anon','mcp_cursor_private','USAGE')
  and not has_schema_privilege('authenticated','mcp_cursor_private','USAGE')
  and not has_schema_privilege('service_role','mcp_cursor_private','USAGE')
  and not has_schema_privilege('supabase_auth_admin','mcp_cursor_private','USAGE')
  and not exists (
    select 1
    from pg_catalog.pg_namespace as namespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))
    ) as schema_acl
    where namespace.nspname='mcp_cursor_private'
      and schema_acl.grantee=0
      and schema_acl.privilege_type='USAGE'
  ),
  'GitHub MCP v2: dedicated cursor schema is postgres-owned and inaccessible to PUBLIC and application roles'
);
select ok(
  pg_catalog.to_regclass('mcp_cursor_private.mcp_github_results_cursor_key') is not null
  and (select tableowner='postgres' from pg_catalog.pg_tables
       where schemaname='mcp_cursor_private' and tablename='mcp_github_results_cursor_key')
  and (select pg_catalog.count(*)=1 and pg_catalog.bool_and(pg_catalog.octet_length(key_bytes)=32)
       from mcp_cursor_private.mcp_github_results_cursor_key),
  'GitHub MCP v2: one postgres-owned backup-stable 32-byte database cursor key exists'
);
select ok(
  not has_table_privilege('anon','mcp_cursor_private.mcp_github_results_cursor_key','SELECT')
  and not has_table_privilege('authenticated','mcp_cursor_private.mcp_github_results_cursor_key','SELECT')
  and not has_table_privilege('service_role','mcp_cursor_private.mcp_github_results_cursor_key','SELECT')
  and not has_table_privilege('supabase_auth_admin','mcp_cursor_private.mcp_github_results_cursor_key','SELECT'),
  'GitHub MCP v2: no application or auth role can read the database cursor key'
);
select has_function(
  'mcp_cursor_private','mcp_github_cursor_bytes_equal',array['bytea','bytea'],
  'GitHub MCP v2: private fixed-work cursor MAC comparison helper exists'
);
select ok(
  (select p.proowner='postgres'::pg_catalog.regrole
   from pg_catalog.pg_proc as p
   where p.oid='mcp_cursor_private.mcp_github_cursor_bytes_equal(bytea,bytea)'::pg_catalog.regprocedure)
  and not has_function_privilege('anon','mcp_cursor_private.mcp_github_cursor_bytes_equal(bytea,bytea)','EXECUTE')
  and not has_function_privilege('authenticated','mcp_cursor_private.mcp_github_cursor_bytes_equal(bytea,bytea)','EXECUTE')
  and not has_function_privilege('service_role','mcp_cursor_private.mcp_github_cursor_bytes_equal(bytea,bytea)','EXECUTE')
  and not has_function_privilege('supabase_auth_admin','mcp_cursor_private.mcp_github_cursor_bytes_equal(bytea,bytea)','EXECUTE'),
  'GitHub MCP v2: private fixed-work comparison helper is postgres-only'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp-v2-owner@example.test','',now(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp-v2-admin@example.test','',now(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp-v2-member@example.test','',now(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcp-v2-outsider@example.test','',now(),'{}','{}');

insert into public.organisations(id,name,slug,created_by) values
 ('81000000-0000-4000-8000-000000000001','MCP v2 Workspace A','mcp-v2-workspace-a','81000000-0000-4000-8000-000000000011'),
 ('81000000-0000-4000-8000-000000000002','MCP v2 Workspace B','mcp-v2-workspace-b','81000000-0000-4000-8000-000000000014');
insert into public.memberships(organisation_id,user_id,role) values
 ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000011','owner'),
 ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000012','admin'),
 ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000013','member'),
 ('81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000014','owner');

insert into private.mcp_oauth_config(config_key,audience)
values ('resource','https://compliance.example/mcp')
on conflict (config_key) do update set audience=excluded.audience;

insert into public.github_installations(
 id,organisation_id,provider_installation_id,account_id,account_login,account_type,
 repository_selection,status,connected_by,permissions,permissions_ok
) values
 ('81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000001',81101,81201,'Provider-A','Organization','selected','active','81000000-0000-4000-8000-000000000011','{"metadata":"read"}',true),
 ('81000000-0000-4000-8000-000000000102','81000000-0000-4000-8000-000000000002',81102,81202,'Provider-B','Organization','selected','active','81000000-0000-4000-8000-000000000014','{"metadata":"read"}',true);

insert into public.github_repositories(
 id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
 html_url,visibility,default_branch,archived,selected,available
) values
 ('81000000-0000-4000-8000-000000000201','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101',81301,'Provider-A','one','Provider-A/one','https://github.com/Provider-A/one','private','main',false,true,true),
 ('81000000-0000-4000-8000-000000000202','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101',81302,'Provider-A','two','Provider-A/two','https://github.com/Provider-A/two','private','main',false,true,true),
 ('81000000-0000-4000-8000-000000000203','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101',81303,'Provider-A','three','Provider-A/three','https://github.com/Provider-A/three','private','main',false,true,true),
 ('81000000-0000-4000-8000-000000000204','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101',81304,'Provider-A','four','Provider-A/four','https://github.com/Provider-A/four','private','main',false,true,true),
 ('81000000-0000-4000-8000-000000000205','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101',81305,'Provider-A','shadow','Provider-A/shadow','https://github.com/Provider-A/shadow','private','main',false,true,true),
 ('81000000-0000-4000-8000-000000000206','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101',81306,'Provider-A','direct-shadow','Provider-A/direct-shadow','https://github.com/Provider-A/direct-shadow','private','main',false,true,true),
 ('81000000-0000-4000-8000-000000000207','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101',81307,'Provider-A','nonterminal','Provider-A/nonterminal','https://github.com/Provider-A/nonterminal','private','main',false,true,true);

insert into public.github_mapping_approvals(id,organisation_id,mapping_pack_id,approved_by,approved_at)
select '81000000-0000-4000-8000-000000000601','81000000-0000-4000-8000-000000000001',id,
 '81000000-0000-4000-8000-000000000011',clock_timestamp()-interval '1 day'
from public.github_mapping_packs where version='github-iso-27001-v1';

-- A shadow-backed observation is retained only as a poisoned-ledger fixture;
-- the v2 read must exclude it before latest-result ranking.
insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
 run_mode,status,started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,
 not_applicable_count,lease_token,lease_expires_at,attempt
) values (
 '81000000-0000-4000-8000-000000000306','81000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000206',81306,
 'manual','mcp-v2:direct-shadow','shadow','partial',clock_timestamp()-interval '2 hours',
 clock_timestamp()-interval '1 hour',1,0,0,1,0,extensions.gen_random_uuid(),clock_timestamp()-interval '30 minutes',1
);
insert into public.github_observations(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
 remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
) values (
 '81000000-0000-4000-8000-000000000406','81000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000206',81306,
 '81000000-0000-4000-8000-000000000306','Provider-A/direct-shadow/github.branch.stale_approvals/github-repository-v1',
 'github.branch.stale_approvals','github-repository-v1','github_repository','Provider-A/direct-shadow','unknown',null,
 'Provider title','Provider explanation','Restore the required GitHub App permission or feature, then run collection again.',
 clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day','https://github.com/Provider-A/direct-shadow',
 repeat('a',64),'permission_denied'
);
-- Four repositories x fifteen mapped checks create sixty latest official rows.
insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
 run_mode,status,started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,
 not_applicable_count,lease_token,lease_expires_at,attempt
) values
 ('81000000-0000-4000-8000-000000000301','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000201',81301,'manual','mcp-v2:one','official','succeeded','2026-09-01T08:00:00Z','2026-09-01T09:00:00Z',15,1,1,13,0,extensions.gen_random_uuid(),'2026-09-01T08:30:00Z',1),
 ('81000000-0000-4000-8000-000000000302','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000202',81302,'manual','mcp-v2:two','official','succeeded','2026-09-01T08:00:00Z','2026-09-01T09:00:00Z',15,1,1,13,0,extensions.gen_random_uuid(),'2026-09-01T08:30:00Z',1),
 ('81000000-0000-4000-8000-000000000303','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000203',81303,'manual','mcp-v2:three','official','partial','2026-09-01T08:00:00Z','2026-09-01T09:00:00Z',15,1,1,13,0,extensions.gen_random_uuid(),'2026-09-01T08:30:00Z',1),
 ('81000000-0000-4000-8000-000000000304','81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000204',81304,'manual','mcp-v2:four','official','succeeded','2026-09-01T08:00:00Z','2026-09-01T09:00:00Z',15,1,1,13,0,extensions.gen_random_uuid(),'2026-09-01T08:30:00Z',1);

insert into public.github_observations(
 organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
 remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
)
select run.organisation_id,run.installation_id,run.repository_id,run.provider_repository_id,run.id,
 repository.full_name||'/'||entry.check_id||'/'||entry.rule_version,entry.check_id,entry.rule_version,
 'github_repository',repository.full_name,
 case when entry.check_id='github.branch.stale_approvals' then 'fail'::public.github_observation_result
      when entry.check_id='github.repository.visibility' then 'pass'::public.github_observation_result
      else 'unknown'::public.github_observation_result end,
 case when entry.check_id='github.branch.stale_approvals' then entry.failure_severity else null end,
 'Provider-controlled title','Provider-controlled explanation',
 'Restore the required GitHub App permission or feature, then run collection again.',
 '2026-09-01T10:00:00Z',
 case when entry.check_id='github.branch.stale_approvals' then pg_catalog.now() else pg_catalog.now()+interval '1 day' end,
 repository.html_url,
 pg_catalog.encode(extensions.digest(pg_catalog.convert_to(run.id::text||'/'||entry.check_id,'UTF8'),'sha256'),'hex'),
 case when entry.check_id in ('github.branch.stale_approvals','github.repository.visibility')
      then null else 'permission_denied' end
from public.github_collection_runs run
join public.github_repositories repository on repository.id=run.repository_id
cross join lateral (
  select mapping.* from public.github_mapping_entries mapping
  join public.github_mapping_packs pack on pack.id=mapping.mapping_pack_id
  where pack.version='github-iso-27001-v1'
) entry
where run.id in (
 '81000000-0000-4000-8000-000000000301','81000000-0000-4000-8000-000000000302',
 '81000000-0000-4000-8000-000000000303','81000000-0000-4000-8000-000000000304'
);

insert into public.github_official_compliance_results(
 organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,
 approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,
 failure_severity,catalogue_summary,observed_at,fresh_until,materialised_at
)
select observation.organisation_id,observation.installation_id,observation.repository_id,
 observation.provider_repository_id,observation.collection_run_id,observation.id,approval.id,pack.id,
 pack.version,pack.checksum,observation.check_id,observation.rule_version,observation.result,
 case when observation.result='fail' then entry.failure_severity else null end,
 entry.treatments #>> array[observation.result::text,'summary'],observation.observed_at,observation.fresh_until,
 '2026-09-01T10:01:00Z'
from public.github_observations observation
join public.github_mapping_approvals approval on approval.organisation_id=observation.organisation_id and approval.revoked_at is null
join public.github_mapping_packs pack on pack.id=approval.mapping_pack_id
join public.github_mapping_entries entry on entry.mapping_pack_id=pack.id and entry.check_id=observation.check_id and entry.rule_version=observation.rule_version
where observation.collection_run_id in (
 '81000000-0000-4000-8000-000000000301','81000000-0000-4000-8000-000000000302',
 '81000000-0000-4000-8000-000000000303','81000000-0000-4000-8000-000000000304'
);

create or replace function pg_temp.mcp_v2_cursor_payload(cursor_value text)
returns jsonb language sql immutable strict set search_path='' as $$
  select pg_catalog.convert_from(pg_catalog.decode(
    pg_catalog.translate(pg_catalog.split_part(cursor_value,'.',2),'-_','+/')
      || pg_catalog.repeat('=',(4-pg_catalog.char_length(pg_catalog.split_part(cursor_value,'.',2))%4)%4),
    'base64'
  ),'UTF8')::jsonb;
$$;

set role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select set_config('app.mcp_v2_page_one',public.get_mcp_github_compliance_results_v2(
 '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,null
)::text,true);
select set_config('app.mcp_v1_compatibility_page',public.get_mcp_github_compliance_results_v1(
 '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50
)::text,true);
select set_config('app.mcp_v2_filtered_page',public.get_mcp_github_compliance_results_v2(
 '81000000-0000-4000-8000-000000000001',null,'fail','stale','active','medium',50,null
)::text,true);
select set_config('app.mcp_v2_small_page_one',public.get_mcp_github_compliance_results_v2(
 '81000000-0000-4000-8000-000000000001',null,null,null,null,null,1,null
)::text,true);
select set_config('app.mcp_v2_small_page_two',public.get_mcp_github_compliance_results_v2(
 '81000000-0000-4000-8000-000000000001',null,null,null,null,null,1,
 current_setting('app.mcp_v2_small_page_one')::jsonb->>'nextCursor'
)::text,true);
reset role;

select is(pg_catalog.jsonb_array_length(current_setting('app.mcp_v2_page_one')::jsonb->'results'),50,'GitHub MCP v2: first page contains the exact requested bound');
select ok(
  (current_setting('app.mcp_v2_page_one')::jsonb->>'truncated')::boolean
  and current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor' is not null
  and current_setting('app.mcp_v2_page_one')::jsonb->>'pageKind'='initial',
  'GitHub MCP v2: first page exposes one opaque continuation cursor and truthful initial page kind'
);
select is(
  (select pg_catalog.array_agg(key order by key)
   from pg_catalog.jsonb_object_keys(current_setting('app.mcp_v1_compatibility_page')::jsonb) key),
  array['asOf','results','schemaVersion','truncated','workspace']::text[],
  'GitHub MCP v2: rolling-compatible v1 retains its exact envelope keys'
);
select is(
  (select pg_catalog.array_agg(key order by key)
   from pg_catalog.jsonb_object_keys(current_setting('app.mcp_v1_compatibility_page')::jsonb->'results'->0) key),
  array['checkId','evidenceId','findingId','freshness','freshUntil','id','mappingStatus','mappingVersion','materialisedAt','observedAt','repositoryId','repositoryLabel','result','ruleVersion','severity','summary']::text[],
  'GitHub MCP v2: rolling-compatible v1 retains its exact row keys'
);
select ok(
  pg_catalog.jsonb_array_length(current_setting('app.mcp_v2_filtered_page')::jsonb->'results')=4
  and not exists (
    select 1 from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_filtered_page')::jsonb->'results') value
    where value->>'result'<>'fail' or value->>'freshness'<>'stale'
       or value->>'mappingStatus'<>'active' or value->>'severity'<>'medium'
       or (value->>'freshUntil')::timestamptz
          <> (current_setting('app.mcp_v2_filtered_page')::jsonb->>'snapshotAt')::timestamptz
  ),
  'GitHub MCP v2: normalized outcome freshness mapping and severity filters apply, with freshUntil equal to snapshotAt classified stale'
);
select ok(
  pg_temp.mcp_v2_cursor_payload(current_setting('app.mcp_v2_small_page_one')::jsonb->>'nextCursor')->>'issuedAt'
    = pg_temp.mcp_v2_cursor_payload(current_setting('app.mcp_v2_small_page_two')::jsonb->>'nextCursor')->>'issuedAt'
  and pg_temp.mcp_v2_cursor_payload(current_setting('app.mcp_v2_small_page_one')::jsonb->>'nextCursor')->>'expiresAt'
    = pg_temp.mcp_v2_cursor_payload(current_setting('app.mcp_v2_small_page_two')::jsonb->>'nextCursor')->>'expiresAt'
  and current_setting('app.mcp_v2_small_page_one')::jsonb->>'pageKind'='initial'
  and current_setting('app.mcp_v2_small_page_two')::jsonb->>'pageKind'='continuation',
  'GitHub MCP v2: continuation pages preserve original non-sliding timing and direct page kind'
);

-- Add a fully eligible official result after page one. Its observation sorts
-- ahead of the original stable identity, so only the cursor's frozen ledger
-- snapshot can prevent it from replacing an already-snapshotted row.
insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
 run_mode,status,started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,
 not_applicable_count,lease_token,lease_expires_at,attempt
) values (
 '81000000-0000-4000-8000-000000000311','81000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000201',81301,
 'manual','mcp-v2:post-snapshot-official','official','succeeded','2026-09-01T10:30:00Z',
 '2026-09-01T10:45:00Z',1,0,0,1,0,extensions.gen_random_uuid(),'2026-09-01T10:40:00Z',1
);
insert into public.github_observations(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
 remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
) values (
 '81000000-0000-4000-8000-000000000410','81000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000201',81301,
 '81000000-0000-4000-8000-000000000311','Provider-A/one/github.branch.stale_approvals/github-repository-v1',
 'github.branch.stale_approvals','github-repository-v1','github_repository','Provider-A/one','unknown',null,
 'Post-snapshot provider title','Post-snapshot provider explanation',
 'Restore the required GitHub App permission or feature, then run collection again.',
 '2026-09-01T10:44:00Z','2026-09-10T11:00:00Z','https://github.com/Provider-A/one',repeat('e',64),'permission_denied'
);
insert into public.github_official_compliance_results(
 organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,
 approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,
 catalogue_summary,observed_at,fresh_until,materialised_at
)
select observation.organisation_id,observation.installation_id,observation.repository_id,
 observation.provider_repository_id,observation.collection_run_id,observation.id,approval.id,pack.id,
 pack.version,pack.checksum,observation.check_id,observation.rule_version,observation.result,
 entry.treatments #>> array['unknown','summary'],observation.observed_at,observation.fresh_until,
 clock_timestamp()
from public.github_observations observation
join public.github_mapping_approvals approval on approval.organisation_id=observation.organisation_id and approval.revoked_at is null
join public.github_mapping_packs pack on pack.id=approval.mapping_pack_id
join public.github_mapping_entries entry on entry.mapping_pack_id=pack.id and entry.check_id=observation.check_id and entry.rule_version=observation.rule_version
where observation.id='81000000-0000-4000-8000-000000000410';
select set_config('app.mcp_v2_post_snapshot_result_id','github_result:'||(
  select result.id::text from public.github_official_compliance_results result
  where result.observation_id='81000000-0000-4000-8000-000000000410'
),true);

-- Freeze the approval lifecycle and result ledger after page one. The second
-- page must retain the first page's asOf and active mapping classification.
update public.github_mapping_approvals
set revoked_at=clock_timestamp(),revoked_by='81000000-0000-4000-8000-000000000011'
where id='81000000-0000-4000-8000-000000000601';

set role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select set_config('app.mcp_v2_page_two',public.get_mcp_github_compliance_results_v2(
 '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
 current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor'
)::text,true);
select set_config('app.mcp_v2_page_two_replay',public.get_mcp_github_compliance_results_v2(
 '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
 current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor'
)::text,true);
reset role;

select is(pg_catalog.jsonb_array_length(current_setting('app.mcp_v2_page_two')::jsonb->'results'),10,'GitHub MCP v2: second page returns the remaining ten official rows');
select ok(
  (select count(*) from (
    select value->>'id' id from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_one')::jsonb->'results')
    union all
    select value->>'id' id from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_two')::jsonb->'results')
  ) combined)=60
  and (select count(distinct id) from (
    select value->>'id' id from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_one')::jsonb->'results')
    union all
    select value->>'id' id from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_two')::jsonb->'results')
  ) combined)=60,
  'GitHub MCP v2: cursor traversal has no gaps or duplicates across equal-time rows'
);
select is((select count(distinct value->>'repositoryId') from (
  select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_one')::jsonb->'results')
  union all
  select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_two')::jsonb->'results')
) combined),4::bigint,'GitHub MCP v2: traversal covers every selected repository in the organisation');
select ok(
  not (current_setting('app.mcp_v2_page_two')::jsonb->>'truncated')::boolean
  and current_setting('app.mcp_v2_page_two')::jsonb->'nextCursor'='null'::jsonb
  and current_setting('app.mcp_v2_page_two')::jsonb->>'pageKind'='continuation',
  'GitHub MCP v2: final page is explicitly exhausted and truthfully labelled continuation'
);
select ok(not exists (
  select 1 from (
    select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_one')::jsonb->'results')
    union all
    select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_two')::jsonb->'results')
  ) rows
  where value->>'runMode'<>'official'
     or value->>'collectionRunId' !~ '^github_run:[0-9a-f-]{36}$'
     or value->>'mappingChecksum' !~ '^[0-9a-f]{64}$'
     or value->>'sourceResponseFingerprint' !~ '^[0-9a-f]{64}$'
     or value->>'recordHash' !~ '^[0-9a-f]{64}$'
     or not (value ?& array['id','repositoryId','repositoryLabel','collectionRunId','runMode','checkId','result','severity','observedAt','freshUntil','materialisedAt','freshness','mappingVersion','mappingChecksum','mappingStatus','ruleVersion','sourceResponseFingerprint','summary','evidenceId','findingId','recordHash'])
),'GitHub MCP v2: every row exposes complete local official ancestry and canonical hash');
select ok(
  (select pg_catalog.array_agg(key order by key)
   from pg_catalog.jsonb_object_keys(current_setting('app.mcp_v2_page_one')::jsonb) key)
  = array['nextCursor','pageHash','pageKind','results','schemaVersion','snapshotAt','truncated','workspace']::text[]
  and (select pg_catalog.array_agg(key order by key)
       from pg_catalog.jsonb_object_keys(current_setting('app.mcp_v2_page_one')::jsonb->'workspace') key)
      = array['id','name']::text[],
  'GitHub MCP v2: envelope has exactly eight keys and workspace has exactly id and name'
);
select ok(not exists (
  select 1 from (
    select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_one')::jsonb->'results')
    union all
    select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_two')::jsonb->'results')
  ) rows
  where (select pg_catalog.array_agg(key order by key) from pg_catalog.jsonb_object_keys(value) key)
     <> array['checkId','collectionRunId','evidenceId','findingId','freshness','freshUntil','id','mappingChecksum','mappingStatus','mappingVersion','materialisedAt','observedAt','recordHash','repositoryId','repositoryLabel','result','ruleVersion','runMode','severity','sourceResponseFingerprint','summary']::text[]
),'GitHub MCP v2: every result has exactly the reviewed twenty-one closed-world keys');
select ok(not exists (
  select 1 from (
    select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_one')::jsonb->'results')
    union all
    select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_two')::jsonb->'results')
  ) rows
  where value->>'recordHash' <> pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'compliancehub.github.result.v2:'||(value-'freshness'-'mappingStatus'-'recordHash')::text,
    'UTF8'
  ),'sha256'),'hex')
),'GitHub MCP v2: each lowercase record hash covers the deterministic canonical local record');
select ok(not exists (
  select 1 from (values
    (current_setting('app.mcp_v2_page_one')::jsonb),
    (current_setting('app.mcp_v2_page_two')::jsonb)
  ) pages(page)
  where page->>'pageHash' <> pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'compliancehub.github.page.v2:'||(page-'pageHash')::text,
    'UTF8'
  ),'sha256'),'hex')
),'GitHub MCP v2: each lowercase page hash covers the deterministic canonical envelope');
select ok(not exists (
  select 1
  from (
    select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_one')::jsonb->'results')
    union all
    select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_two')::jsonb->'results')
  ) rows
  left join public.github_official_compliance_results result
    on result.id=pg_catalog.replace(value->>'id','github_result:','')::uuid
  left join public.github_observations observation
    on observation.id=result.observation_id
   and observation.organisation_id=result.organisation_id
   and observation.installation_id=result.installation_id
   and observation.repository_id=result.repository_id
   and observation.provider_repository_id=result.provider_repository_id
   and observation.collection_run_id=result.collection_run_id
  left join public.github_collection_runs run
    on run.id=result.collection_run_id
   and run.organisation_id=result.organisation_id
   and run.installation_id=result.installation_id
   and run.repository_id=result.repository_id
   and run.provider_repository_id=result.provider_repository_id
  where result.id is null or observation.id is null or run.id is null
     or value->>'collectionRunId' <> 'github_run:'||run.id::text
     or value->>'runMode' <> run.run_mode::text
     or value->>'mappingChecksum' <> result.mapping_checksum
     or value->>'sourceResponseFingerprint' <> observation.fingerprint
     or (value->>'evidenceId') is distinct from
        case when result.evidence_id is null then null else 'evidence:'||result.evidence_id::text end
     or (value->>'findingId') is distinct from
        case when result.finding_id is null then null else 'monitoring_finding:'||result.finding_id::text end
),'GitHub MCP v2: returned local references and fingerprints exactly match immutable ledger observation and run ancestry');
select ok(
  current_setting('app.mcp_v2_page_one') !~ '"(providerRepositoryId|providerInstallationId|sourceUrl|title|explanation|remediation|diagnosticCode|accountLogin|ownerLogin|fullName|htmlUrl|actorId|memberId|raw|token|authorization)"[[:space:]]*:'
  and current_setting('app.mcp_v2_page_one') not like '%Provider-A%'
  and current_setting('app.mcp_v2_page_one') not like '%Provider-controlled title%'
  and current_setting('app.mcp_v2_page_one') not like '%Provider-controlled explanation%'
  and current_setting('app.mcp_v2_page_one') not like '%https://github.com/%',
  'GitHub MCP v2: page excludes provider identity URLs raw text diagnostics actors and credentials as keys and values'
);
select is((select count(*) from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_two')::jsonb->'results') value where value->>'mappingStatus'='active'),10::bigint,'GitHub MCP v2: cursor freezes approval and mapping status at the first-page asOf');
select ok(not exists (
  select 1 from (
    select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_one')::jsonb->'results')
    union all
    select value from pg_catalog.jsonb_array_elements(current_setting('app.mcp_v2_page_two')::jsonb->'results')
  ) combined
  where value->>'id'=current_setting('app.mcp_v2_post_snapshot_result_id')
),'GitHub MCP v2: cursor freezes the official-result ledger against valid post-snapshot materialisation');
select is(current_setting('app.mcp_v2_page_two')::jsonb->>'pageHash',current_setting('app.mcp_v2_page_two_replay')::jsonb->>'pageHash','GitHub MCP v2: exact cursor replay returns the same canonical page hash');

set role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
    current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor'||'x'
  ) $$,'22023',null,'GitHub MCP v2: tampered cursor is rejected'
);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
    pg_catalog.regexp_replace(current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor','^ch3[.]','ch2.')
  ) $$,'22023',null,'GitHub MCP v2: legacy raw ch2 cursor is rejected'
);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
    'ch3.'||pg_catalog.split_part(current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor','.',2)||'.'||
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.split_part(current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor','.',2),'UTF8'
    ),'sha256'),'hex')
  ) $$,'22023',null,'GitHub MCP v2: public-SHA recomputation cannot forge a database cursor'
);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,'pass',null,null,null,50,
    current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor'
  ) $$,'22023',null,'GitHub MCP v2: cursor cannot be rebound to different filters'
);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,null,null
  ) $$,'22023',null,'GitHub MCP v2: an explicit null page limit is rejected before scanning results'
);
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","aud":"https://compliance.example/mcp"}',true);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,null
  ) $$,'42501',null,'GitHub MCP v2: authenticated execution without a bounded MCP client claim fails closed'
);
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"codex-test","aud":"https://wrong.example/mcp"}',true);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
    current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor'
  ) $$,'42501',null,'GitHub MCP v2: a cursor cannot bypass the exact OAuth audience check'
);
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"other-client","aud":"https://compliance.example/mcp"}',true);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
    current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor'
  ) $$,'22023',null,'GitHub MCP v2: cursor is bound to the exact authenticated MCP client'
);
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000012","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
    current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor'
  ) $$,'22023',null,'GitHub MCP v2: cursor is bound to the exact authenticated user'
);
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000014","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000002',null,null,null,null,null,50,
    current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor'
  ) $$,'22023',null,'GitHub MCP v2: cursor cannot be rebound to a sibling organisation'
);
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select ok(
  public.get_mcp_github_compliance_results_v2('81000000-0000-4000-8000-000000000002',null,null,null,null,null,50,null) is null,
  'GitHub MCP v2: outsider receives null from the sibling v2 read envelope'
);
select ok(
  pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v2('81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,null)->'results')>0,
  'GitHub MCP v2: Owner executes v2 through organisation RLS'
);
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000012","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select ok(
  pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v2('81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,null)->'results')>0,
  'GitHub MCP v2: Admin executes v2 through organisation RLS'
);
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000013","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select ok(
  pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v2('81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,null)->'results')>0,
  'GitHub MCP v2: Member executes v2 through organisation RLS'
);
reset role;

set role anon;
select throws_ok($$ select public.get_mcp_github_compliance_results_v2('81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,null) $$,'42501',null,'GitHub MCP v2: anonymous execution is denied');
reset role;
set role service_role;
select throws_ok($$ select public.get_mcp_github_compliance_results_v2('81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,null) $$,'42501',null,'GitHub MCP v2: service execution is denied');
reset role;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select throws_ok($$ insert into public.github_official_compliance_results(
 organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,
 approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,
 catalogue_summary,observed_at,fresh_until
) values (
 '81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000101',
 '81000000-0000-4000-8000-000000000201',81301,'81000000-0000-4000-8000-000000000301',
 extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),'x',repeat('a',64),
 'github.branch.stale_approvals','github-repository-v1','unknown','Direct write',clock_timestamp(),clock_timestamp()+interval '1 day'
) $$,'42501',null,'GitHub MCP v2: authenticated direct official-ledger write remains denied');
reset role;

-- Build deliberately well-shaped database cursors for negative tests. The
-- helper runs only inside this rolled-back pgTAP transaction and uses the
-- private HMAC key; authenticated roles never receive key or helper access.
create or replace function pg_temp.mcp_v2_cursor(
  organisation_id uuid, snapshot_at timestamptz, last_observed_at timestamptz,
  last_result_id uuid, page_limit integer,
  issued_at timestamptz default null,
  expires_at timestamptz default null
) returns text language plpgsql stable security definer set search_path='' as $$
declare
  payload text;
  encoded text;
  cursor_key bytea;
  effective_issued_at timestamptz := coalesce(issued_at,snapshot_at);
  effective_expires_at timestamptz := coalesce(
    expires_at,effective_issued_at+interval '15 minutes'
  );
begin
  select key_bytes into strict cursor_key
  from mcp_cursor_private.mcp_github_results_cursor_key
  where singleton;
  payload := pg_catalog.jsonb_build_object(
    'v',3,
    'userId','81000000-0000-4000-8000-000000000011',
    'clientId','codex-test',
    'audience','https://compliance.example/mcp',
    'organisationId',organisation_id,
    'snapshotAt',snapshot_at,
    'filters',pg_catalog.jsonb_build_object(
      'repositoryId',null,'result',null,'freshness',null,
      'mappingStatus',null,'severity',null,'limit',page_limit
    ),
    'lastObservedAt',last_observed_at,
    'lastResultId',last_result_id,
    'issuedAt',effective_issued_at,
    'expiresAt',effective_expires_at
  )::text;
  encoded := pg_catalog.rtrim(pg_catalog.translate(
    pg_catalog.replace(pg_catalog.replace(pg_catalog.encode(pg_catalog.convert_to(payload,'UTF8'),'base64'),E'\n',''),E'\r',''),
    '+/','-_'
  ),'=');
  return 'ch3.'||encoded||'.'||pg_catalog.encode(extensions.hmac(
    pg_catalog.convert_to(encoded,'UTF8'),cursor_key,'sha256'
  ),'hex');
end;
$$;
-- Test-only definer is confined to pg_temp and disappears at rollback/session
-- end; production callers have no equivalent signing helper.
revoke all on function pg_temp.mcp_v2_cursor(uuid,timestamptz,timestamptz,uuid,integer,timestamptz,timestamptz)
from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function pg_temp.mcp_v2_cursor(uuid,timestamptz,timestamptz,uuid,integer,timestamptz,timestamptz)
to authenticated;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
    pg_temp.mcp_v2_cursor(
      '81000000-0000-4000-8000-000000000001',clock_timestamp()+interval '1 day',
      '2026-09-01T10:00:00Z',pg_catalog.replace(
        current_setting('app.mcp_v2_page_one')::jsonb->'results'->49->>'id','github_result:',''
      )::uuid,50
    )
  ) $$,'22023',null,'GitHub MCP v2: future snapshot cursor is rejected'
);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
    pg_temp.mcp_v2_cursor(
      '81000000-0000-4000-8000-000000000001',
      (current_setting('app.mcp_v2_page_one')::jsonb->>'snapshotAt')::timestamptz,
      '2026-09-01T10:00:00Z','ffffffff-ffff-4fff-8fff-ffffffffffff',50
    )
  ) $$,'22023',null,'GitHub MCP v2: correctly checksummed cursor with an absent frozen keyset tuple is rejected'
);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
    pg_temp.mcp_v2_cursor(
      '81000000-0000-4000-8000-000000000001',
      pg_catalog.now()-interval '20 minutes',
      '2026-09-01T10:00:00Z',pg_catalog.replace(
        current_setting('app.mcp_v2_page_one')::jsonb->'results'->49->>'id','github_result:',''
      )::uuid,50,pg_catalog.now()-interval '20 minutes',pg_catalog.now()-interval '5 minutes'
    )
  ) $$,'22023',null,'GitHub MCP v2: expired correctly HMACed database cursor is rejected'
);
reset role;

select throws_ok(
  $$ update mcp_cursor_private.mcp_github_results_cursor_key set key_bytes='\x00'::bytea where singleton $$,
  '23514',null,'GitHub MCP v2: cursor-key octet constraint rejects corrupt key material'
);
select throws_ok(
  $$ insert into mcp_cursor_private.mcp_github_results_cursor_key(singleton,key_bytes)
     values (true,extensions.gen_random_bytes(32)) $$,
  '23505',null,'GitHub MCP v2: cursor-key singleton constraint rejects a second row'
);
select set_config('app.mcp_v2_rotated_key',pg_catalog.encode(extensions.gen_random_bytes(32),'hex'),true);
update mcp_cursor_private.mcp_github_results_cursor_key
set key_bytes=pg_catalog.decode(current_setting('app.mcp_v2_rotated_key'),'hex')
where singleton;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,
    current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor'
  ) $$,'22023',null,'GitHub MCP v2: hard database-key rotation rejects every old cursor'
);
select set_config('app.mcp_v2_rotated_page',public.get_mcp_github_compliance_results_v2(
  '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,null
)::text,true);
reset role;
select ok(
  current_setting('app.mcp_v2_rotated_page')::jsonb->>'pageKind'='initial'
  and current_setting('app.mcp_v2_rotated_page')::jsonb->>'nextCursor' ~ '^ch3[.]'
  and current_setting('app.mcp_v2_rotated_page')::jsonb->>'nextCursor'
      <> current_setting('app.mcp_v2_page_one')::jsonb->>'nextCursor',
  'GitHub MCP v2: hard database-key rotation issues a distinct new initial cursor'
);
delete from mcp_cursor_private.mcp_github_results_cursor_key where singleton;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select throws_ok(
  $$ select public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001',null,null,null,null,null,50,null
  ) $$,'55000',null,'GitHub MCP v2: missing database cursor key fails closed without fallback'
);
reset role;
insert into mcp_cursor_private.mcp_github_results_cursor_key(singleton,key_bytes)
values (true,pg_catalog.decode(current_setting('app.mcp_v2_rotated_key'),'hex'));

-- Inject impossible legacy rows with trigger replication disabled solely to
-- verify defense in depth in the existing digest bundle.
insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
 run_mode,status,started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,
 not_applicable_count,lease_token,lease_expires_at,attempt
) values (
 '81000000-0000-4000-8000-000000000307','81000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000207',81307,
 'manual','mcp-v2:nonterminal','official','running',pg_catalog.now()-interval '5 minutes',null,1,0,0,1,0,
 extensions.gen_random_uuid(),pg_catalog.now()+interval '1 minute',1
);
insert into public.github_observations(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
 remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
) values (
 '81000000-0000-4000-8000-000000000407','81000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000207',81307,
 '81000000-0000-4000-8000-000000000307','Provider-A/nonterminal/github.branch.stale_approvals/github-repository-v1',
 'github.branch.stale_approvals','github-repository-v1','github_repository','Provider-A/nonterminal','unknown',null,
 'Provider title','Provider explanation','Restore the required GitHub App permission or feature, then run collection again.',
 pg_catalog.now()-interval '2 minutes',pg_catalog.now()+interval '1 day','https://github.com/Provider-A/nonterminal',repeat('b',64),'permission_denied'
);

-- A newer poisoned shadow row uses the same stable repository/check identity
-- as an older eligible official result. Eligibility must be applied before
-- latest-result ranking, otherwise the poison suppresses the real result.
insert into public.github_collection_runs(
 id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
 run_mode,status,started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,
 not_applicable_count,lease_token,lease_expires_at,attempt
) values (
 '81000000-0000-4000-8000-000000000310','81000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000201',81301,
 'manual','mcp-v2:same-identity-shadow-poison','shadow','succeeded',pg_catalog.now()-interval '5 minutes',
 pg_catalog.now()-interval '90 seconds',1,0,0,1,0,extensions.gen_random_uuid(),pg_catalog.now()-interval '30 seconds',1
);
insert into public.github_observations(
 id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
 observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
 remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
) values (
 '81000000-0000-4000-8000-000000000409','81000000-0000-4000-8000-000000000001',
 '81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000201',81301,
 '81000000-0000-4000-8000-000000000310','Provider-A/one/github.branch.stale_approvals/github-repository-v1',
 'github.branch.stale_approvals','github-repository-v1','github_repository','Provider-A/one','unknown',null,
 'Poison provider title','Poison provider explanation','Restore the required GitHub App permission or feature, then run collection again.',
 pg_catalog.now()-interval '2 minutes',pg_catalog.now()+interval '1 day','https://github.com/Provider-A/one',
 repeat('c',64),'permission_denied'
);
select set_config('app.mcp_v2_eligible_result_id','github_result:'||(
  select result.id::text
  from public.github_official_compliance_results result
  where result.collection_run_id='81000000-0000-4000-8000-000000000301'
    and result.check_id='github.branch.stale_approvals'
),true);
set session_replication_role=replica;
insert into public.github_official_compliance_results(
 organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,
 approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,
 catalogue_summary,observed_at,fresh_until,materialised_at
)
select observation.organisation_id,observation.installation_id,observation.repository_id,
 observation.provider_repository_id,observation.collection_run_id,observation.id,'81000000-0000-4000-8000-000000000601',
 pack.id,pack.version,pack.checksum,observation.check_id,observation.rule_version,observation.result,
 entry.treatments #>> array['unknown','summary'],observation.observed_at,observation.fresh_until,pg_catalog.now()-interval '1 minute'
from public.github_observations observation
join public.github_mapping_packs pack on pack.version='github-iso-27001-v1'
join public.github_mapping_entries entry on entry.mapping_pack_id=pack.id and entry.check_id=observation.check_id
where observation.id in (
 '81000000-0000-4000-8000-000000000406',
 '81000000-0000-4000-8000-000000000407',
 '81000000-0000-4000-8000-000000000409'
)
on conflict (observation_id) do nothing;
set session_replication_role=origin;

select set_config('app.mcp_v2_poison_result_id','github_result:'||(
  select result.id::text from public.github_official_compliance_results result
  where result.observation_id='81000000-0000-4000-8000-000000000409'
),true);

set role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select ok(
  exists (
    select 1 from pg_catalog.jsonb_array_elements(public.get_mcp_github_compliance_results_v2(
      '81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000201',null,null,null,null,50,null
    )->'results') value where value->>'id'=current_setting('app.mcp_v2_eligible_result_id')
  )
  and not exists (
    select 1 from pg_catalog.jsonb_array_elements(public.get_mcp_github_compliance_results_v2(
      '81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000201',null,null,null,null,50,null
    )->'results') value where value->>'id'=current_setting('app.mcp_v2_poison_result_id')
  ),
  'GitHub MCP v2: v2 filters eligible ancestry before latest ranking so newer shadow poison cannot suppress older official state'
);
select ok(
  pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000206',null,null,null,null,50,null
  )->'results')=0
  and pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000207',null,null,null,null,50,null
  )->'results')=0,
  'GitHub MCP v2: v2 omits identities backed only by shadow or nonterminal runs'
);
reset role;

-- Isolate the same-pack reapproval regression in workspace B. Approval A is
-- approved and revoked once through the normal immutable lifecycle before
-- approval B becomes its active successor. No trigger is bypassed or weakened.
insert into public.github_mapping_approvals(
  id,organisation_id,mapping_pack_id,approved_by,approved_at
)
select '81000000-0000-4000-8000-000000000603',
  '81000000-0000-4000-8000-000000000002',pack.id,
  '81000000-0000-4000-8000-000000000014',pg_catalog.now()-interval '6 minutes'
from public.github_mapping_packs as pack
where pack.version='github-iso-27001-v1';
update public.github_mapping_approvals
set revoked_by='81000000-0000-4000-8000-000000000014',
    revoked_at=pg_catalog.now()-interval '2 minutes'
where id='81000000-0000-4000-8000-000000000603';
insert into public.github_mapping_approvals(
  id,organisation_id,mapping_pack_id,approved_by,approved_at
)
select '81000000-0000-4000-8000-000000000604',
  '81000000-0000-4000-8000-000000000002',pack.id,
  '81000000-0000-4000-8000-000000000014',pg_catalog.now()-interval '1 minute'
from public.github_mapping_packs as pack
where pack.version='github-iso-27001-v1';

insert into public.github_repositories(
  id,organisation_id,installation_id,provider_repository_id,owner_login,name,full_name,
  html_url,visibility,default_branch,archived,selected,available
) values (
  '81000000-0000-4000-8000-000000000208','81000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000102',81308,'Provider-B','reapproval','Provider-B/reapproval',
  'https://github.com/Provider-B/reapproval','private','main',false,true,true
);
insert into public.github_collection_runs(
  id,organisation_id,installation_id,repository_id,provider_repository_id,trigger_type,request_key,
  run_mode,status,started_at,completed_at,observation_count,passed_count,failed_count,unknown_count,
  not_applicable_count,lease_token,lease_expires_at,attempt
) values (
  '81000000-0000-4000-8000-000000000312','81000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000102','81000000-0000-4000-8000-000000000208',81308,
  'manual','mcp-v2:reapproval','official','succeeded',pg_catalog.now()-interval '5 minutes',
  pg_catalog.now()-interval '3 minutes',1,0,0,1,0,extensions.gen_random_uuid(),
  pg_catalog.now()-interval '2 minutes',1
);
insert into public.github_observations(
  id,organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,
  observation_key,check_id,rule_version,subject_type,subject_id,result,severity,title,explanation,
  remediation,observed_at,fresh_until,source_url,fingerprint,diagnostic_code
)
select '81000000-0000-4000-8000-000000000411','81000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000102','81000000-0000-4000-8000-000000000208',81308,
  '81000000-0000-4000-8000-000000000312','Provider-B/reapproval/'||entry.check_id||'/'||entry.rule_version,
  entry.check_id,entry.rule_version,'github_repository','Provider-B/reapproval','unknown',null,
  'Provider-controlled title','Provider-controlled explanation',
  'Restore the required GitHub App permission or feature, then run collection again.',
  pg_catalog.now()-interval '4 minutes',pg_catalog.now()+interval '1 day',
  'https://github.com/Provider-B/reapproval',repeat('f',64),'permission_denied'
from public.github_mapping_entries as entry
join public.github_mapping_packs as pack on pack.id=entry.mapping_pack_id
where pack.version='github-iso-27001-v1'
  and entry.check_id='github.branch.stale_approvals';
insert into public.github_official_compliance_results(
  organisation_id,installation_id,repository_id,provider_repository_id,collection_run_id,observation_id,
  approval_id,mapping_pack_id,mapping_version,mapping_checksum,check_id,rule_version,outcome,
  catalogue_summary,observed_at,fresh_until,materialised_at
)
select observation.organisation_id,observation.installation_id,observation.repository_id,
  observation.provider_repository_id,observation.collection_run_id,observation.id,approval.id,pack.id,
  pack.version,pack.checksum,observation.check_id,observation.rule_version,observation.result,
  entry.treatments #>> array['unknown','summary'],observation.observed_at,observation.fresh_until,
  pg_catalog.now()-interval '2 minutes 30 seconds'
from public.github_observations as observation
join public.github_mapping_approvals as approval
  on approval.id='81000000-0000-4000-8000-000000000603'
 and approval.organisation_id=observation.organisation_id
join public.github_mapping_packs as pack on pack.id=approval.mapping_pack_id
join public.github_mapping_entries as entry
  on entry.mapping_pack_id=pack.id
 and entry.check_id=observation.check_id
 and entry.rule_version=observation.rule_version
where observation.id='81000000-0000-4000-8000-000000000411';

set role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000014","role":"authenticated","client_id":"codex-test","aud":"https://compliance.example/mcp"}',true);
select ok(
  pg_catalog.jsonb_array_length(public.get_mcp_github_compliance_results_v2(
    '81000000-0000-4000-8000-000000000002',null,null,null,null,null,50,null
  )->'results')=1
  and not exists (
    select 1
    from pg_catalog.jsonb_array_elements(public.get_mcp_github_compliance_results_v2(
      '81000000-0000-4000-8000-000000000002',null,null,null,null,null,50,null
    )->'results') as row
    where row->>'mappingStatus'<>'historical'
  ),
  'GitHub MCP v2: same-pack approval B cannot reactivate approval-A-bound v2 rows'
);
reset role;

select * from finish();
rollback;
