begin;
select plan(8);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values ('95000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','export-audit@example.test','',now(),'{}','{}');
insert into public.organisations(id,name,slug,created_by)
values ('95000000-0000-4000-8000-000000000002','Export audit test','export-audit-test','95000000-0000-4000-8000-000000000001');
select ok(not has_table_privilege('anon','public.audit_events','INSERT'),'anonymous audit append remains forbidden');
select ok(not has_table_privilege('authenticated','public.audit_events','INSERT'),'ordinary users cannot forge audit events');
select ok(has_table_privilege('service_role','public.audit_events','INSERT'),'backend can append export events');
select ok(not has_table_privilege('service_role','public.audit_events','UPDATE'),'backend update is not granted');
select ok(not has_table_privilege('service_role','public.audit_events','DELETE'),'backend deletion is not granted');
set local role service_role;
select lives_ok($$insert into public.audit_events(organisation_id,actor_id,action,entity_type,entity_id,metadata)
values ('95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001','export','export','export:risks:csv','{"resource":"risks","format":"csv"}')$$,'actual backend export insert succeeds with generated identity');
reset role;
select is((select count(*) from public.audit_events where organisation_id='95000000-0000-4000-8000-000000000002' and action='export'),1::bigint,'exactly one export audit event persists');
select is((select metadata from public.audit_events where organisation_id='95000000-0000-4000-8000-000000000002' and action='export'),'{"resource":"risks","format":"csv"}'::jsonb,'export metadata stores type and format without contents');
select * from finish();
rollback;
