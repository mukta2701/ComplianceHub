begin;
select plan(9);

select has_function(
  'public', 'cancel_terminal_evidence_expiry_tasks', array[]::text[],
  'terminal evidence has a database-enforced expiry-task lifecycle hook'
);
select ok(
  not coalesce((
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'cancel_terminal_evidence_expiry_tasks'
      and procedure.pronargs = 0
  ), true),
  'the lifecycle hook remains security invoker and cannot bypass tenant policy'
);
select has_trigger(
  'public', 'evidence', 'evidence_cancel_terminal_expiry_tasks',
  'evidence terminal transitions enforce task cancellation in the database'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data
) values
  ('80000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lifecycle-owner-a@example.test', '', now(), '{}', '{}'),
  ('80000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'lifecycle-owner-b@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('80000000-0000-4000-8000-000000000101', 'Lifecycle Tenant A', 'lifecycle-tenant-a', '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000102', 'Lifecycle Tenant B', 'lifecycle-tenant-b', '80000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-000000000001', 'owner'),
  ('80000000-0000-4000-8000-000000000102', '80000000-0000-4000-8000-000000000002', 'owner');
insert into public.evidence (
  id, organisation_id, title, kind, url, status, valid_until, created_by
) values
  ('80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000101', 'Withdrawn evidence', 'link', 'https://example.test/withdrawn', 'current', current_date + 1, '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000202', '80000000-0000-4000-8000-000000000101', 'Superseded evidence', 'link', 'https://example.test/superseded', 'current', current_date + 1, '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000203', '80000000-0000-4000-8000-000000000101', 'Completed replacement task evidence', 'link', 'https://example.test/done', 'current', current_date + 1, '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000204', '80000000-0000-4000-8000-000000000102', 'Sibling evidence', 'link', 'https://example.test/sibling', 'current', current_date + 1, '80000000-0000-4000-8000-000000000002');
insert into public.tasks (
  id, organisation_id, title, status, source, evidence_id, created_by
) values
  ('80000000-0000-4000-8000-000000000301', '80000000-0000-4000-8000-000000000101', 'Open expiry task', 'open', 'evidence_expiry', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000302', '80000000-0000-4000-8000-000000000101', 'In-progress expiry task', 'in_progress', 'evidence_expiry', '80000000-0000-4000-8000-000000000202', '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000303', '80000000-0000-4000-8000-000000000101', 'Completed expiry task', 'done', 'evidence_expiry', '80000000-0000-4000-8000-000000000203', '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000304', '80000000-0000-4000-8000-000000000101', 'Manual task', 'open', 'manual', '80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-000000000001'),
  ('80000000-0000-4000-8000-000000000305', '80000000-0000-4000-8000-000000000102', 'Sibling expiry task', 'open', 'evidence_expiry', '80000000-0000-4000-8000-000000000204', '80000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"80000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
update public.evidence set status = 'withdrawn'
where id = '80000000-0000-4000-8000-000000000201';
update public.evidence set status = 'superseded'
where id = '80000000-0000-4000-8000-000000000202';
update public.evidence set status = 'withdrawn'
where id = '80000000-0000-4000-8000-000000000203';
reset role;

select is(
  (select status::text from public.tasks where id = '80000000-0000-4000-8000-000000000301'),
  'cancelled',
  'withdrawn evidence cancels its open expiry task'
);
select is(
  (select status::text from public.tasks where id = '80000000-0000-4000-8000-000000000302'),
  'cancelled',
  'superseded evidence cancels its in-progress expiry task'
);
select is(
  (select status::text from public.tasks where id = '80000000-0000-4000-8000-000000000303'),
  'done',
  'terminal evidence does not rewrite completed task history'
);
select is(
  (select status::text from public.tasks where id = '80000000-0000-4000-8000-000000000304'),
  'open',
  'terminal evidence does not cancel a manually managed task'
);
select is(
  (select status::text from public.tasks where id = '80000000-0000-4000-8000-000000000305'),
  'open',
  'the lifecycle hook leaves a sibling tenant task unchanged'
);
select results_eq(
  $$ select entity_id, actor_id
     from public.audit_events
     where organisation_id = '80000000-0000-4000-8000-000000000101'
       and entity_type = 'tasks'
       and action = 'update'
       and entity_id in (
         '80000000-0000-4000-8000-000000000301',
         '80000000-0000-4000-8000-000000000302'
       )
     order by entity_id $$,
  $$ values
       ('80000000-0000-4000-8000-000000000301'::text, '80000000-0000-4000-8000-000000000001'::uuid),
       ('80000000-0000-4000-8000-000000000302'::text, '80000000-0000-4000-8000-000000000001'::uuid) $$,
  'each automatic task cancellation is audited with the verified actor and tenant'
);

select * from finish();
rollback;
