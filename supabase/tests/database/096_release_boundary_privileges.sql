begin;
select plan(49);

-- Check effective privileges, including direct managed-platform grants. A
-- REVOKE FROM PUBLIC alone does not remove a grant made directly to anon.
select ok(
  has_table_privilege(role_name, 'public.audit_events', privilege_name) =
    ((role_name = 'authenticated' and privilege_name = 'SELECT') or
     (role_name = 'service_role' and privilege_name = 'INSERT')),
  role_name || ' audit capability: ' || privilege_name
)
from (values ('public'), ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) privileges(privilege_name);

-- ALL revocation must also remove privileges introduced by newer PostgreSQL,
-- such as MAINTAIN on PostgreSQL 17, without naming them in PG15 SQL.
select is((select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a
  where c.oid = 'public.audit_events'::regclass
    and (a.grantee = 0 or a.grantee in
      (select oid from pg_roles where rolname in ('anon','authenticated','service_role')))
    and a.privilege_type not in ('SELECT','INSERT')), 0::bigint,
  'no additional platform-specific audit capabilities remain');

select ok(has_function_privilege(role_name,
  'public.increment_rate_limit(text,integer)', 'EXECUTE') = (role_name = 'service_role'),
  role_name || ' counter capability')
from (values ('public'), ('anon'), ('authenticated'), ('service_role')) roles(role_name);

select ok(not has_sequence_privilege(role_name,
  'public.audit_events_id_seq', privilege_name),
  role_name || ' cannot manipulate audit identity: ' || privilege_name)
from (values ('public'), ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values ('SELECT'), ('USAGE'), ('UPDATE')) privileges(privilege_name);

set local role anon;
select throws_ok($$select public.increment_rate_limit('release-privilege-test', -1)$$,
  '42501', null, 'anonymous caller cannot create an expired arbitrary counter');
reset role;
set local role authenticated;
select throws_ok($$select public.increment_rate_limit('release-privilege-test', 1)$$,
  '42501', null, 'ordinary caller cannot reserve a caller-chosen counter');
reset role;
set local role service_role;
select is(public.increment_rate_limit('release-privilege-test', 60000), 1,
  'backend can reserve its counter');
select throws_ok($$truncate public.audit_events$$, '42501', null,
  'backend cannot bypass append-only audit protection with TRUNCATE');
reset role;
select * from finish();
rollback;
