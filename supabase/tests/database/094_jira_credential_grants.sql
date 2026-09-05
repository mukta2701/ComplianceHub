begin;
select plan(21);

select ok(
  has_function_privilege(role_name, signature, 'EXECUTE') = (role_name = 'service_role'),
  role_name || ' credential capability: ' || signature
)
from (values ('public'), ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values
  ('public.read_jira_access_credential(uuid)'),
  ('public.claim_jira_refresh_lease(uuid)'),
  ('public.complete_jira_refresh_lease(uuid,uuid,text,text,timestamp with time zone)')
) functions(signature);

-- A nonexistent connection proves actual execution permissions without reading
-- credentials or changing a connection. The synthetic envelopes satisfy the
-- completion function's input validation but contain no provider credentials.
set local role anon;
select throws_ok($$select * from public.read_jira_access_credential('94000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anonymous credential read denied');
select throws_ok($$select * from public.claim_jira_refresh_lease('94000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'anonymous refresh claim denied');
select throws_ok($$select public.complete_jira_refresh_lease('94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000002', 'v1:AA==:AA==:AA==', 'v1:AA==:AA==:AA==', now() + interval '1 hour')$$,
  '42501', null, 'anonymous refresh completion denied');

reset role;
set local role authenticated;
select throws_ok($$select * from public.read_jira_access_credential('94000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated credential read denied');
select throws_ok($$select * from public.claim_jira_refresh_lease('94000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated refresh claim denied');
select throws_ok($$select public.complete_jira_refresh_lease('94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000002', 'v1:AA==:AA==:AA==', 'v1:AA==:AA==:AA==', now() + interval '1 hour')$$,
  '42501', null, 'authenticated refresh completion denied');

reset role;
set local role service_role;
select is((select count(*) from public.read_jira_access_credential('94000000-0000-4000-8000-000000000001')),
  0::bigint, 'backend credential read preserves absent connection result');
select is((select count(*) from public.claim_jira_refresh_lease('94000000-0000-4000-8000-000000000001')),
  0::bigint, 'backend refresh claim preserves absent connection result');
select is(public.complete_jira_refresh_lease('94000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000002', 'v1:AA==:AA==:AA==', 'v1:AA==:AA==:AA==', now() + interval '1 hour'),
  false, 'backend refresh completion preserves absent connection result');

reset role;
select * from finish();
rollback;
