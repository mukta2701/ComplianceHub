begin;
select plan(6);

select ok(
  pg_catalog.has_column_privilege('authenticated', 'public.integration_connections', 'connection_mode', 'select'),
  'authenticated operators can read connection mode metadata'
);
select ok(
  pg_catalog.has_column_privilege('authenticated', 'public.integration_connections', 'enabled', 'select'),
  'authenticated operators can read connection enablement metadata'
);
select ok(
  pg_catalog.has_column_privilege('authenticated', 'public.integration_connections', 'broker_connection_id', 'select'),
  'authenticated operators can read opaque broker connection references'
);
select ok(
  pg_catalog.has_column_privilege('authenticated', 'public.integration_connections', 'broker_provider_config_key', 'select'),
  'authenticated operators can read opaque broker provider keys'
);
select ok(
  not pg_catalog.has_column_privilege('authenticated', 'public.integration_connections', 'access_token', 'select'),
  'authenticated clients cannot read connector access tokens'
);
select ok(
  not pg_catalog.has_column_privilege('authenticated', 'public.integration_connections', 'refresh_token', 'select'),
  'authenticated clients cannot read connector refresh tokens'
);

select * from finish();
rollback;
