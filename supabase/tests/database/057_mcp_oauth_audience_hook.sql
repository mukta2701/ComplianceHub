begin;
select plan(13);

select has_schema('private', 'private configuration schema exists');
select has_table('private', 'mcp_oauth_config', 'MCP OAuth configuration is private');
select has_function('private', 'mcp_access_token_hook', array['jsonb'], 'access-token hook exists');
select is((select prosecdef from pg_proc where oid='private.mcp_access_token_hook(jsonb)'::regprocedure), false, 'hook is security invoker');
select ok(has_function_privilege('supabase_auth_admin','private.mcp_access_token_hook(jsonb)','EXECUTE'), 'Auth admin can invoke hook');
select ok(not has_function_privilege('public','private.mcp_access_token_hook(jsonb)','EXECUTE'), 'PUBLIC cannot invoke hook');
select ok(not has_function_privilege('anon','private.mcp_access_token_hook(jsonb)','EXECUTE'), 'anon cannot invoke hook');
select ok(not has_function_privilege('authenticated','private.mcp_access_token_hook(jsonb)','EXECUTE'), 'authenticated cannot invoke hook');
select ok(has_table_privilege('supabase_auth_admin','private.mcp_oauth_config','SELECT'), 'Auth admin can read audience');
select ok(not has_table_privilege('supabase_auth_admin','private.mcp_oauth_config','INSERT,UPDATE,DELETE'), 'Auth admin cannot change audience');

select is(
  private.mcp_access_token_hook('{"claims":{"aud":"authenticated","sub":"11111111-1111-4111-8111-111111111111"},"authentication_method":"password"}'::jsonb),
  '{"claims":{"aud":"authenticated","sub":"11111111-1111-4111-8111-111111111111"},"authentication_method":"password"}'::jsonb,
  'ordinary browser token events remain exactly unchanged'
);

insert into private.mcp_oauth_config(config_key,audience) values ('resource','https://compliance.example/mcp')
on conflict (config_key) do update set audience=excluded.audience;
select is(
  private.mcp_access_token_hook('{"claims":{"aud":"authenticated","sub":"11111111-1111-4111-8111-111111111111"},"client_id":"codex-client","authentication_method":"oauth_provider/authorization_code"}'::jsonb)->'claims',
  '{"aud":"https://compliance.example/mcp","sub":"11111111-1111-4111-8111-111111111111"}'::jsonb,
  'OAuth token audience is bound to the configured MCP resource'
);

delete from private.mcp_oauth_config where config_key='resource';
select throws_ok(
  $$ select private.mcp_access_token_hook('{"claims":{"aud":"authenticated"},"client_id":"codex-client"}'::jsonb) $$,
  'P0001', 'MCP OAuth audience is not configured', 'OAuth issuance fails closed without an audience'
);

select * from finish();
rollback;
