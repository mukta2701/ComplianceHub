begin;
select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('93000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recurrence-owner-a@example.test', '', now(), '{}', '{}'),
  ('93000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'recurrence-owner-b@example.test', '', now(), '{}', '{}');

insert into public.organisations (id, name, slug, created_by) values
  ('94000000-0000-4000-8000-000000000001', 'Recurrence Tenant A', 'recurrence-tenant-a', '93000000-0000-4000-8000-000000000001'),
  ('94000000-0000-4000-8000-000000000002', 'Recurrence Tenant B', 'recurrence-tenant-b', '93000000-0000-4000-8000-000000000002');

insert into public.memberships (organisation_id, user_id, role) values
  ('94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'owner'),
  ('94000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', 'owner');

insert into public.tasks (
  id, organisation_id, title, detail, status, owner_id, due_on, recurrence, source, created_by
) values
  (
    '95000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    'Quarterly access review',
    'Review access rights',
    'open',
    '93000000-0000-4000-8000-000000000001',
    '2026-07-31',
    'monthly',
    'manual',
    '93000000-0000-4000-8000-000000000001'
  );

select ok(
  has_function_privilege('authenticated', 'public.complete_recurring_task(uuid,date)', 'EXECUTE'),
  'authenticated users can execute recurrence completion'
);
select ok(
  not has_function_privilege('anon', 'public.complete_recurring_task(uuid,date)', 'EXECUTE'),
  'anonymous users cannot execute recurrence completion'
);
select ok(
  not has_function_privilege('service_role', 'public.complete_recurring_task(uuid,date)', 'EXECUTE'),
  'service role cannot execute the user recurrence endpoint'
);

create function pg_temp.reject_recurrence_successor()
returns trigger
language plpgsql
as $$
begin
  if new.due_on = '2026-08-31'::date then
    raise exception 'forced successor failure';
  end if;
  return new;
end;
$$;

create trigger test_reject_recurrence_successor
before insert on public.tasks
for each row execute function pg_temp.reject_recurrence_successor();

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$ select public.complete_recurring_task(
    '95000000-0000-4000-8000-000000000001',
    '2026-08-31'
  ) $$,
  'P0001',
  'forced successor failure',
  'a successor failure aborts the RPC'
);

reset role;
select is(
  (select status from public.tasks where id = '95000000-0000-4000-8000-000000000001'),
  'open'::public.task_status,
  'a successor failure rolls back the source completion'
);
select is(
  (select count(*) from public.tasks where organisation_id = '94000000-0000-4000-8000-000000000001' and id <> '95000000-0000-4000-8000-000000000001'),
  0::bigint,
  'a successor failure leaves no partial successor'
);

drop trigger test_reject_recurrence_successor on public.tasks;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select results_eq(
  $$ select public.complete_recurring_task(
    '95000000-0000-4000-8000-000000000001',
    '2026-08-31'
  ) $$,
  $$ values (true) $$,
  'a valid completion creates its successor atomically'
);
select results_eq(
  $$ select public.complete_recurring_task(
    '95000000-0000-4000-8000-000000000001',
    '2026-08-31'
  ) $$,
  $$ values (false) $$,
  'repeating completion is a no-op'
);

reset role;
select is(
  (select status from public.tasks where id = '95000000-0000-4000-8000-000000000001'),
  'done'::public.task_status,
  'successful completion marks the source done'
);
select is(
  (select count(*) from public.tasks where organisation_id = '94000000-0000-4000-8000-000000000001' and id <> '95000000-0000-4000-8000-000000000001'),
  1::bigint,
  'successful completion creates exactly one successor across retries'
);

select * from finish();
rollback;
