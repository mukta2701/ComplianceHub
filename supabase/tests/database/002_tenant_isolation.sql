begin;
select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}');

insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$ select name from public.organisations order by name $$,
  $$ values ('Tenant A'::text) $$,
  'members cannot read another organisation'
);
select is((select count(*) from public.memberships), 1::bigint, 'members cannot read another tenant membership');
select throws_ok(
  $$ insert into public.audit_events (organisation_id, actor_id, action, entity_type, entity_id)
     values ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'read', 'test', '1') $$,
  '42501', null, 'members cannot write audit events into another tenant'
);
select throws_ok(
  $$ insert into public.audit_events (organisation_id, actor_id, action, entity_type, entity_id)
     values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'read', 'test', '1') $$,
  '42501', null, 'clients cannot forge audit events in their tenant'
);

select * from finish();
rollback;
