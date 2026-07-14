begin;
select plan(5);

select is(
  (
    with surfaces as (
      select c.oid
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname = 'public'
    )
    select count(*)
    from surfaces s
    cross join (values ('anon'), ('authenticated')) as portal(role_name)
    cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as special(privilege_name)
    where pg_catalog.has_table_privilege(portal.role_name, s.oid, special.privilege_name)
  ),
  0::bigint,
  'portal roles have no RLS-bypassing special privilege on any application-owned public table'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
    where c.relkind in ('r', 'p')
      and n.nspname = 'public'
      and acl.grantee = 0
      and acl.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  0::bigint,
  'PUBLIC has no RLS-bypassing special privilege on classified table surfaces'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_default_acl d
    join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral pg_catalog.aclexplode(d.defaclacl) acl
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where n.nspname = 'public'
      and d.defaclobjtype = 'r'
      -- Application migrations create tables as postgres. Provider-managed
      -- schemas/roles cannot be changed safely by app migrations.
      and d.defaclrole = 'postgres'::pg_catalog.regrole
      and (acl.grantee = 0 or grantee.rolname in ('anon', 'authenticated'))
      and acl.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  0::bigint,
  'table default privileges cannot reintroduce special portal privileges'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ truncate table public.assessment_control_mappings $$,
  '42501', null,
  'an authenticated request cannot TRUNCATE a table even inside a rollback-safe transaction'
);

reset role;
select is(
  (
    select count(*)
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.prokind in ('f', 'p')
      and (
        pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated', function_row.oid, 'EXECUTE')
      )
      and (
        pg_catalog.pg_get_functiondef(function_row.oid) ~* '\mtruncate\M'
        or pg_catalog.pg_get_functiondef(function_row.oid) ~* '\m(execute|alter|drop|create)\M[^;]*\mstorage\.'
      )
  ),
  0::bigint,
  'no API-executable application function exposes TRUNCATE or arbitrary storage DDL'
);

select * from finish();
rollback;
