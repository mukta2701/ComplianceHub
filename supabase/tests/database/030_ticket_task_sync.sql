begin;
select plan(6);

-- Phase D (B7): two-way ticket→task sync. The poll cron runs as the service role
-- (bypasses RLS, tenant-scoped per row via organisation_id). This proves the new
-- UPDATE grant lets the service role auto-close an open task to 'done', that the
-- open/in_progress filter leaves cancelled and already-done tasks untouched (no
-- reopen, no clobber), that the tenant scope keeps one org's cron off another
-- org's task, and that the members' tenant isolation is unaffected.

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

-- t1: tenant A, open        -> auto-closes to done
-- t2: tenant A, cancelled   -> the filter leaves it alone
-- t3: tenant A, done        -> already done, stays done (idempotent re-run)
-- t4: tenant B, open        -> only tenant B's cron may close it
insert into public.tasks (id, organisation_id, title, status, source, created_by) values
  ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Open task', 'open', 'manual', '10000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Cancelled task', 'cancelled', 'manual', '10000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Done task', 'done', 'manual', '10000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'Tenant B open task', 'open', 'manual', '10000000-0000-4000-8000-000000000002');

set local role service_role;

-- (1) The service role can auto-close an open task — the exact filtered update the
-- cron runs — and it affects exactly the one open row.
select results_eq(
  $$ update public.tasks set status = 'done'
       where id = '70000000-0000-4000-8000-000000000001'
         and organisation_id = '20000000-0000-4000-8000-000000000001'
         and status in ('open', 'in_progress') returning id $$,
  $$ values ('70000000-0000-4000-8000-000000000001'::uuid) $$,
  'the service role closes an open task to done');
select is(
  (select status::text from public.tasks where id = '70000000-0000-4000-8000-000000000001'),
  'done', 'the auto-closed task is now done');

-- (2) The open/in_progress filter is a no-op on a cancelled task: it is never
-- resurrected to done.
select results_eq(
  $$ update public.tasks set status = 'done'
       where id = '70000000-0000-4000-8000-000000000002'
         and organisation_id = '20000000-0000-4000-8000-000000000001'
         and status in ('open', 'in_progress') returning id $$,
  $$ select null::uuid where false $$,
  'a cancelled task is left untouched by the auto-close');

-- (3) Re-running on an already-done task is a no-op (idempotent).
select results_eq(
  $$ update public.tasks set status = 'done'
       where id = '70000000-0000-4000-8000-000000000003'
         and organisation_id = '20000000-0000-4000-8000-000000000001'
         and status in ('open', 'in_progress') returning id $$,
  $$ select null::uuid where false $$,
  'an already-done task is a no-op on re-run');

-- (4) Tenant scope: tenant A's cron (organisation_id = A) cannot close tenant B's
-- open task even though it exists and is open.
select results_eq(
  $$ update public.tasks set status = 'done'
       where id = '70000000-0000-4000-8000-000000000004'
         and organisation_id = '20000000-0000-4000-8000-000000000001'
         and status in ('open', 'in_progress') returning id $$,
  $$ select null::uuid where false $$,
  'the tenant scope keeps one org''s cron off another org''s task');
select is(
  (select status::text from public.tasks where id = '70000000-0000-4000-8000-000000000004'),
  'open', 'tenant B''s task stays open');

reset role;

select * from finish();
rollback;
