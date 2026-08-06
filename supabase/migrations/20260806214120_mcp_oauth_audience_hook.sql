create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.mcp_oauth_config (
  config_key text primary key check (config_key = 'resource'),
  audience text not null check (
    audience ~ '^https://[^/?#[:space:]@]+(:[0-9]+)?/mcp$'
    or audience ~ '^http://(localhost|127[.]0[.]0[.]1)(:[0-9]+)?/mcp$'
  ),
  updated_at timestamptz not null default now()
);
revoke all on private.mcp_oauth_config from public, anon, authenticated;

create or replace function private.mcp_access_token_hook(event jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare configured_audience text;
begin
  if nullif(event ->> 'client_id', '') is null then return event; end if;
  if jsonb_typeof(event -> 'claims') <> 'object' then raise exception 'Invalid OAuth access-token event'; end if;
  select config.audience into configured_audience from private.mcp_oauth_config as config where config.config_key = 'resource';
  if configured_audience is null then raise exception 'MCP OAuth audience is not configured'; end if;
  return jsonb_set(event, '{claims,aud}', to_jsonb(configured_audience), true);
end;
$$;
revoke all on function private.mcp_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant select on private.mcp_oauth_config to supabase_auth_admin;
grant execute on function private.mcp_access_token_hook(jsonb) to supabase_auth_admin;
