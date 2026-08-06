-- The readiness catalogue is now seeded via migration 202607020041_catalogue_seed.sql
-- so it deploys to every environment (a hosted `supabase db push`, not only a local
-- `supabase db reset`). Kept intentionally empty to avoid double-seeding on reset.

-- Safe local-only audience. Hosted environments populate their exact canonical
-- HTTPS MCP URL explicitly after migrations are applied.
insert into private.mcp_oauth_config(config_key, audience)
values ('resource', 'http://localhost:3000/mcp')
on conflict (config_key) do update set audience=excluded.audience, updated_at=now();
