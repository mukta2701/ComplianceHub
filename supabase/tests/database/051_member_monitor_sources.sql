begin;
select plan(18);

select ok(
  pg_catalog.to_regprocedure('public.list_connected_monitor_sources(uuid)') is not null,
  'the narrow connected-monitor-source RPC exists'
);
select ok(
  (select p.prosecdef from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.list_connected_monitor_sources(uuid)')),
  'the connected-monitor-source RPC is SECURITY DEFINER'
);
select is(
  (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.list_connected_monitor_sources(uuid)')),
  'postgres',
  'the connected-monitor-source RPC has the expected trusted owner'
);
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.list_connected_monitor_sources(uuid)')),
  'the connected-monitor-source RPC pins an empty search path'
);
select ok(
  (select p.proretset from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.list_connected_monitor_sources(uuid)')),
  'the connected-monitor-source RPC returns a set'
);
select is(
  (
    select pg_catalog.string_agg(parameter_name, ',' order by ordinal_position)
    from information_schema.parameters
    where specific_schema = 'public'
      and specific_name = (
        select p.proname || '_' || p.oid
        from pg_catalog.pg_proc p
        where p.oid = pg_catalog.to_regprocedure('public.list_connected_monitor_sources(uuid)')
      )
      and parameter_mode = 'OUT'
  ),
  'id,provider,label,connected_at',
  'the RPC output has only the reviewed non-secret fields'
);
select ok(
  pg_catalog.pg_get_functiondef('public.list_connected_monitor_sources(uuid)'::pg_catalog.regprocedure) like '%public.memberships%'
  and pg_catalog.pg_get_functiondef('public.list_connected_monitor_sources(uuid)'::pg_catalog.regprocedure) like '%auth.uid()%'
  and pg_catalog.lower(pg_catalog.pg_get_functiondef('public.list_connected_monitor_sources(uuid)'::pg_catalog.regprocedure)) like '%revoked_at is null%',
  'the RPC validates tenant membership and returns only active sources'
);
select ok(not pg_catalog.has_function_privilege('public', pg_catalog.to_regprocedure('public.list_connected_monitor_sources(uuid)'), 'execute'), 'PUBLIC cannot execute the source-summary RPC');
select ok(not pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure('public.list_connected_monitor_sources(uuid)'), 'execute'), 'anon cannot execute the source-summary RPC');
select ok(pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.list_connected_monitor_sources(uuid)'), 'execute'), 'authenticated callers may invoke the guarded source-summary RPC');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','source-owner-a@example.test','',now(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','source-member-a@example.test','',now(),'{}','{}'),
 ('81000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','source-owner-b@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","email":"source-owner-a@example.test","role":"authenticated"}',true);
select set_config('app.source_org_a',public.create_organisation_with_owner('Source Org A','source-org-a')::text,true);
insert into public.memberships(organisation_id,user_id,role)
values(current_setting('app.source_org_a')::uuid,'81000000-0000-4000-8000-000000000002','member');

insert into public.monitor_sources(id,organisation_id,provider,label,config,access_token,refresh_token,connected_by,created_at)
values
 ('81000000-0000-4000-8000-000000000101',current_setting('app.source_org_a')::uuid,'github','Production GitHub','{"owner":"secret-owner","repo":"secret-repo"}','secret-access','secret-refresh','81000000-0000-4000-8000-000000000001','2026-01-01T00:00:00Z'),
 ('81000000-0000-4000-8000-000000000102',current_setting('app.source_org_a')::uuid,'github','Revoked GitHub','{"owner":"revoked"}','revoked-access','revoked-refresh','81000000-0000-4000-8000-000000000001','2026-01-02T00:00:00Z');
update public.monitor_sources set revoked_at = now() where id = '81000000-0000-4000-8000-000000000102';

select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000003","email":"source-owner-b@example.test","role":"authenticated"}',true);
select set_config('app.source_org_b',public.create_organisation_with_owner('Source Org B','source-org-b')::text,true);
insert into public.monitor_sources(id,organisation_id,provider,label,config,access_token,connected_by,created_at)
values('81000000-0000-4000-8000-000000000103',current_setting('app.source_org_b')::uuid,'github','Other tenant GitHub','{"owner":"other-secret"}','other-access','81000000-0000-4000-8000-000000000003','2026-01-03T00:00:00Z');

select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","email":"source-member-a@example.test","role":"authenticated"}',true);
select is((select count(*) from public.monitor_sources), 0::bigint, 'a Member still cannot read monitor source configuration directly');
select results_eq(
  $$ select id,provider,label,connected_at from public.list_connected_monitor_sources(current_setting('app.source_org_a')::uuid) $$,
  $$ values('81000000-0000-4000-8000-000000000101'::uuid,'github'::text,'Production GitHub'::text,'2026-01-01T00:00:00Z'::timestamptz) $$,
  'a Member receives only active non-secret source summaries for their tenant'
);
select is(
  (select pg_catalog.jsonb_object_agg(key, value) from pg_catalog.jsonb_each(pg_catalog.to_jsonb(s)) where key = any(array['config','access_token','refresh_token'])) ,
  null::jsonb,
  'a source summary row contains no configuration or token fields'
) from public.list_connected_monitor_sources(current_setting('app.source_org_a')::uuid) s;
select is((select count(*) from public.list_connected_monitor_sources(current_setting('app.source_org_b')::uuid)), 0::bigint, 'a Member cannot read another tenant through the RPC');

select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","email":"source-owner-a@example.test","role":"authenticated"}',true);
select is((select count(*) from public.list_connected_monitor_sources(current_setting('app.source_org_a')::uuid)), 1::bigint, 'an Owner can use the same narrow source-summary RPC');

select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000003","email":"source-owner-b@example.test","role":"authenticated"}',true);
select is((select count(*) from public.list_connected_monitor_sources(current_setting('app.source_org_a')::uuid)), 0::bigint, 'another tenant operator cannot read source summaries');

select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select is((select count(*) from public.list_connected_monitor_sources(current_setting('app.source_org_a')::uuid)), 0::bigint, 'an authenticated request without a user receives no source summaries');

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok(
  $$ select * from public.list_connected_monitor_sources(current_setting('app.source_org_a')::uuid) $$,
  '42501', null, 'anon cannot invoke the source-summary RPC'
);

select * from finish();
rollback;
