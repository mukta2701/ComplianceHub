begin;
select plan(26);

select has_function('public','get_mcp_compliance_bundle',array['uuid','date','integer','integer'],'coherent MCP bundle RPC exists');
select is((select prosecdef from pg_proc where oid='public.get_mcp_compliance_bundle(uuid,date,integer,integer)'::regprocedure),false,'bundle is security invoker');
select is((select provolatile::text from pg_proc where oid='public.get_mcp_compliance_bundle(uuid,date,integer,integer)'::regprocedure),'s','bundle is stable/read-only');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.get_mcp_compliance_bundle(uuid,date,integer,integer)'::regprocedure),'bundle pins an empty search path');
select ok(pg_catalog.pg_get_functiondef('public.get_mcp_compliance_bundle(uuid,date,integer,integer)'::regprocedure)
  ilike '%coalesce(candidate.due_on, (candidate.observed_at at time zone ''Europe/London'')::date, ''infinity''::date)%',
  'bundle canonicalises observed timestamps to London dates before attention cutoff');
select ok(has_function_privilege('authenticated','public.get_mcp_compliance_bundle(uuid,date,integer,integer)','execute'),'authenticated users may invoke the guarded bundle');
select ok(not has_function_privilege('anon','public.get_mcp_compliance_bundle(uuid,date,integer,integer)','execute'),'anon cannot invoke the bundle');
select ok(not has_function_privilege('public','public.get_mcp_compliance_bundle(uuid,date,integer,integer)','execute'),'PUBLIC cannot invoke the bundle');
select ok(not has_function_privilege('service_role','public.get_mcp_compliance_bundle(uuid,date,integer,integer)','execute'),'service role is outside the bundle API');
select ok(exists (
  select 1 from pg_catalog.pg_indexes
  where schemaname='public' and tablename='audit_findings' and indexname='audit_findings_open_org_created_idx'
    and indexdef ilike '%(organisation_id, created_at, id)%' and indexdef ilike '%where (status <>%closed%'
), 'open audit bundle scans have a matching partial tenant/date index');
select is((select count(*)::int from pg_catalog.pg_indexes where schemaname='public' and tablename='audit_findings'
  and indexdef ilike '%(organisation_id, created_at, id)%'),1,'the bundle audit scan index is not duplicated');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('88000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bundle-owner@example.test','',now(),'{}','{}'),
 ('88000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bundle-admin@example.test','',now(),'{}','{}'),
 ('88000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bundle-member@example.test','',now(),'{}','{}'),
 ('88000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','bundle-outsider@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"88000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.bundle_org',public.create_organisation_with_owner('Bundle Org','bundle-org')::text,true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.bundle_org')::uuid,'88000000-0000-4000-8000-000000000002','admin'),
 (current_setting('app.bundle_org')::uuid,'88000000-0000-4000-8000-000000000003','member');

insert into public.tasks(id,organisation_id,title,status,due_on,source,created_by) values
 ('88000000-0000-4000-8000-000000000101',current_setting('app.bundle_org')::uuid,'Oldest task','open','2026-07-01','manual','88000000-0000-4000-8000-000000000001'),
 ('88000000-0000-4000-8000-000000000102',current_setting('app.bundle_org')::uuid,'Second task','open','2026-07-02','manual','88000000-0000-4000-8000-000000000001'),
 ('88000000-0000-4000-8000-000000000103',current_setting('app.bundle_org')::uuid,'Third task','in_progress','2026-07-03','manual','88000000-0000-4000-8000-000000000001'),
 ('88000000-0000-4000-8000-000000000104',current_setting('app.bundle_org')::uuid,'Fourth task','open','2026-07-04','manual','88000000-0000-4000-8000-000000000001');

insert into public.audits(id,organisation_id,reference,title,created_by) values
 ('88000000-0000-4000-8000-000000000301',current_setting('app.bundle_org')::uuid,'AUD-BST','BST cutoff audit','88000000-0000-4000-8000-000000000001');
insert into public.audit_findings(id,organisation_id,audit_id,summary,severity,status,created_by,created_at) values
 ('88000000-0000-4000-8000-000000000302',current_setting('app.bundle_org')::uuid,'88000000-0000-4000-8000-000000000301','BST cutoff finding','minor_nc','open','88000000-0000-4000-8000-000000000001','2026-06-30 23:30:00+00');

select public.publish_leadership_report(current_setting('app.bundle_org')::uuid,
  '{"soaPercent":77,"soaTotal":10,"riskBands":{"low":1,"moderate":2,"high":3,"very_high":4},"tasksOpen":9,"tasksOverdue":2,"evidence":{"total":5,"expiring":1,"expired":1},"openAudits":2,"openNonConformities":1}'::jsonb);

insert into public.alert_channels(id,organisation_id,type,label,config,connected_by,enabled,daily_digest_enabled) values
 ('88000000-0000-4000-8000-000000000201',current_setting('app.bundle_org')::uuid,'slack','Bundle Slack','{"webhookUrl":"encrypted"}','88000000-0000-4000-8000-000000000001',true,false);
select public.set_daily_digest_channel(
  current_setting('app.bundle_org')::uuid,
  '88000000-0000-4000-8000-000000000201'
);
set local role service_role;
select public.reserve_daily_digest_delivery_server(
  current_setting('app.bundle_org')::uuid,'88000000-0000-4000-8000-000000000001','2026-08-06',repeat('a',64),
  '{"text":"Reserved","blocks":[]}'::jsonb
);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"88000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

select isnt(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2),null::jsonb,'Owner receives a bundle');
select is(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2)->>'overviewSource','live','Owner receives live readiness');
select is((public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2)#>>'{overview,tasksOpen}')::int,4,'live task count is exact');
select is(jsonb_array_length(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2)->'attentionItems'),3,'bounded attention returns limit plus one for truncation');
select is(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2)#>>'{attentionItems,0,id}','task:88000000-0000-4000-8000-000000000101','attention ordering is deterministic');
select is(jsonb_array_length(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',1,2)->'attentionItems'),2,'attention cutoff returns only limit plus one');
select is(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',1,2)#>>'{attentionItems,1,id}','audit_finding:88000000-0000-4000-8000-000000000302','BST-local priority ties use severity after date');
select isnt(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2)->'delivery','null'::jsonb,'Owner receives delivery state');
select ok(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2)::text !~ '"(body|detail|description|root_cause|corrective_action|owner_id|created_by|published_by|webhook)"\s*:', 'bundle excludes restricted keys');

select set_config('request.jwt.claims','{"sub":"88000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2)->>'overviewSource','live','Admin receives live readiness');
select is(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2)->'delivery','null'::jsonb,'Admin cannot receive Owner delivery state');

select set_config('request.jwt.claims','{"sub":"88000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2)#>>'{overview,soaPercent}')::int,77,'Member receives only the published readiness payload');
select is(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2)->'delivery','null'::jsonb,'Member cannot receive Owner delivery state');

select set_config('request.jwt.claims','{"sub":"88000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is(public.get_mcp_compliance_bundle(current_setting('app.bundle_org')::uuid,'2026-08-06',2,2),null::jsonb,'outsider receives no cross-tenant bundle');

set local role anon;
select throws_ok(format('select public.get_mcp_compliance_bundle(%L,%L,2,2)',current_setting('app.bundle_org'),'2026-08-06'),'42501',null,'anon execution is denied');

select * from finish();
rollback;
