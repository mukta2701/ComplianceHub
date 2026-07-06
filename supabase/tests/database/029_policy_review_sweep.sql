begin;
select plan(10);

-- Phase D (B6): scheduled policy review reminders. The daily sweep runs as the
-- service role (bypasses RLS, tenant-scoped per row via organisation_id). This
-- proves the service role can read policies and raise the policy_review task +
-- notification for a DUE policy, that the dedup keys stop a daily re-raise, that
-- the composite tenant FK keeps a task's policy in its own tenant, that a NON-due
-- (future review_due) or non-approved policy raises nothing, and that widening
-- the service-role SELECT grant left the members' tenant isolation intact.

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

-- p1: tenant A, approved, review due yesterday      -> should be swept
-- p2: tenant A, approved, review due next month      -> not yet due
-- p3: tenant A, draft, review due yesterday          -> not approved
-- p4: tenant B, approved, review due yesterday        -> swept in its own tenant
insert into public.policies (id, organisation_id, reference, title, status, review_due, owner_id, created_by) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'POL-001', 'Access control', 'approved', current_date - 1, '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'POL-002', 'Cryptography', 'approved', current_date + 30, '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'POL-003', 'Draft policy', 'draft', current_date - 1, '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'POL-004', 'Supplier security', 'approved', current_date - 1, '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002');

set local role service_role;

-- (1) The sweep's service role can read policies at all (the new SELECT grant).
select is(
  (select count(*) from public.policies where id = '50000000-0000-4000-8000-000000000001'),
  1::bigint, 'the service role can read policies');

-- (2) The sweep's due-selection query finds exactly the approved, past-due
-- policies across every tenant — p1 (A) and p4 (B) — and never the future-due p2
-- or the unapproved draft p3.
select results_eq(
  $$ select id from public.policies where status = 'approved' and review_due <= current_date order by id $$,
  $$ values ('50000000-0000-4000-8000-000000000001'::uuid), ('50000000-0000-4000-8000-000000000004'::uuid) $$,
  'only approved, past-due policies are swept, across all tenants');

-- (3) The service role can raise the policy_review task, linked to its policy.
select lives_ok(
  $$ insert into public.tasks (organisation_id, title, detail, source, owner_id, due_on, policy_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'Review policy POL-001: Access control',
             'Raised automatically because this policy has reached its scheduled review date.',
             'policy_review', '10000000-0000-4000-8000-000000000001', current_date - 1,
             '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  'the service role raises a policy_review task linked to the due policy');

-- (4) The (organisation_id, policy_id, source) unique key stops the sweep from
-- re-raising the same policy_review task day after day.
select throws_ok(
  $$ insert into public.tasks (organisation_id, title, source, policy_id, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'duplicate policy review',
             'policy_review', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'a policy_review task never re-raises for the same policy');

-- (5) The composite tenant FK keeps a task's policy in the task's own tenant: a
-- task in tenant B cannot point at tenant A's policy.
select throws_ok(
  $$ insert into public.tasks (organisation_id, title, source, policy_id, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'cross-tenant policy review',
             'policy_review', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'a task cannot reference a policy from another tenant');

-- (6) The service role can post the policy_review notification to the owner.
select lives_ok(
  $$ insert into public.notifications (organisation_id, user_id, kind, subject_type, subject_id, message)
     values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
             'policy_review', 'policies', '50000000-0000-4000-8000-000000000001', 'Policy POL-001 "Access control" is due for review.') $$,
  'the service role posts a policy_review notification to the owner');

-- (7) The day-scoped notification key keeps the daily reminder to one per day.
select throws_ok(
  $$ insert into public.notifications (organisation_id, user_id, kind, subject_type, subject_id, message)
     values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
             'policy_review', 'policies', '50000000-0000-4000-8000-000000000001', 'duplicate same-day reminder') $$,
  '23505', null, 'the policy_review notification deduplicates per day');

-- (8) The application-layer open-task existence check (which lets a review be
-- re-raised only after the prior task is closed) sees the open task for p1 …
select is(
  (select count(*) from public.tasks where source = 'policy_review'
     and status in ('open', 'in_progress') and policy_id = '50000000-0000-4000-8000-000000000001'),
  1::bigint, 'the due policy now has an open policy_review task');

-- (9) … and none for the not-yet-due policy p2.
select is(
  (select count(*) from public.tasks where source = 'policy_review'
     and status in ('open', 'in_progress') and policy_id = '50000000-0000-4000-8000-000000000002'),
  0::bigint, 'the not-yet-due policy has no policy_review task');

reset role;

-- (10) The widened service-role SELECT grant did not touch members' RLS: a
-- tenant B member still cannot read tenant A's policies.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*) from public.policies where organisation_id = '20000000-0000-4000-8000-000000000001'),
  0::bigint, 'members still cannot read another tenant''s policies');

select * from finish();
rollback;
