begin;
select plan(6);

-- Three users across two tenants: owner A (0001) and member A (0003) belong to
-- org A; owner B (0002) belongs to org B. One policy lives in org A. The
-- security-definer RPC must post ONE re-accept notification per member of the
-- policy's org (2, for org A), dedup a same-day repeat call to 0, and REFUSE any
-- caller who is not a member of the policy's org (42501, inserting nothing).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'member'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');

insert into public.policies (id, organisation_id, reference, title, body, created_by) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'POL-001', 'Policy A', 'body', '10000000-0000-4000-8000-000000000001');

-- A member of org A posts: one notification per member of the policy's org (2).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(public.notify_policy_reaccept('50000000-0000-4000-8000-000000000001', 'v2'), 2,
  'a member posts one re-accept notification per member of the policy organisation');

-- Dedup: a second call the same day collides on the notifications unique key and
-- posts nothing.
select is(public.notify_policy_reaccept('50000000-0000-4000-8000-000000000001', 'v2'), 0,
  'a second call the same day is deduped by the per-day unique key and posts nothing');

-- Bypass RLS (superuser) to inspect every posted row: exactly two, both carrying
-- the policy's organisation, kind, subject_type and subject_id.
reset role;
select is((select count(*) from public.notifications
    where organisation_id = '20000000-0000-4000-8000-000000000001'
      and subject_id = '50000000-0000-4000-8000-000000000001'
      and subject_type = 'policies' and kind = 'policy_reaccept'), 2::bigint,
  'exactly one correctly-scoped re-accept notification exists per org member');

-- Owner B (another tenant, not a member of the policy's org) is refused.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.notify_policy_reaccept('50000000-0000-4000-8000-000000000001', 'x') $$,
  '42501', null, 'a non-member of the policy organisation cannot post re-accept notifications');

-- The refused call inserted nothing: still exactly the two rows from the member.
reset role;
select is((select count(*) from public.notifications
    where subject_id = '50000000-0000-4000-8000-000000000001' and kind = 'policy_reaccept'), 2::bigint,
  'the refused non-member call posted no notification');

-- Under RLS each member reads only their own re-accept notification.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.notifications
    where subject_id = '50000000-0000-4000-8000-000000000001'), 1::bigint,
  'each member sees only their own re-accept notification');

select * from finish();
rollback;
