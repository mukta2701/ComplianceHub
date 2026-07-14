-- Harden OAuth target validation and bind GitHub ticket connections to their
-- monitoring source. Provider credentials remain in Nango; only opaque broker
-- references are copied to the linked monitor row.

alter table public.integration_connections
  drop constraint integration_connections_enabled_target_check;

-- Existing Jira OAuth rows pre-date verified Atlassian cloud IDs. Fail closed
-- until an operator re-selects a site/project through accessible-resources.
update public.integration_connections
set enabled = false
where connection_mode = 'oauth'
  and enabled
  and (
    provider = 'jira'
    or provider = 'github' and not coalesce(
      pg_catalog.jsonb_typeof(config) = 'object'
      and config = pg_catalog.jsonb_build_object('owner', config -> 'owner', 'repo', config -> 'repo')
      and pg_catalog.jsonb_typeof(config -> 'owner') = 'string'
      and pg_catalog.jsonb_typeof(config -> 'repo') = 'string'
      and (config ->> 'owner') ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
      and (config ->> 'repo') ~ '^[A-Za-z0-9._-]{1,100}$'
      and (config ->> 'repo') not in ('.', '..'),
      false
    )
  );

alter table public.integration_connections
  add constraint integration_connections_enabled_target_check check (
    not enabled
    or connection_mode = 'sandbox'
    or coalesce(
      case provider
        when 'github' then
          pg_catalog.jsonb_typeof(config) = 'object'
          and config = pg_catalog.jsonb_build_object('owner', config -> 'owner', 'repo', config -> 'repo')
          and pg_catalog.jsonb_typeof(config -> 'owner') = 'string'
          and pg_catalog.jsonb_typeof(config -> 'repo') = 'string'
          and (config ->> 'owner') ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
          and (config ->> 'repo') ~ '^[A-Za-z0-9._-]{1,100}$'
          and (config ->> 'repo') not in ('.', '..')
        when 'jira' then
          pg_catalog.jsonb_typeof(config) = 'object'
          and config = pg_catalog.jsonb_build_object(
            'baseUrl', config -> 'baseUrl',
            'projectKey', config -> 'projectKey',
            'cloudId', config -> 'cloudId'
          )
          and pg_catalog.jsonb_typeof(config -> 'baseUrl') = 'string'
          and pg_catalog.jsonb_typeof(config -> 'projectKey') = 'string'
          and pg_catalog.jsonb_typeof(config -> 'cloudId') = 'string'
          and (config ->> 'baseUrl') ~* '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.atlassian\.net/?$'
          and (config ->> 'projectKey') ~ '^[A-Z][A-Z0-9_]{0,79}$'
          and (config ->> 'cloudId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        else false
      end,
      false
    )
  );

drop index public.integration_connections_broker_ref_unique;
create unique index integration_connections_broker_ref_unique
on public.integration_connections(broker_provider_config_key, broker_connection_id)
where broker_connection_id is not null and revoked_at is null;

alter table public.monitor_sources
  add column connection_mode text not null default 'sandbox',
  add column integration_connection_id uuid,
  add column broker_connection_id text,
  add column broker_provider_config_key text,
  add constraint monitor_sources_connection_tenant_fk
    foreign key (integration_connection_id, organisation_id)
    references public.integration_connections(id, organisation_id) on delete cascade,
  add constraint monitor_sources_mode_check check (
    (
      connection_mode = 'sandbox'
      and integration_connection_id is null
      and broker_connection_id is null
      and broker_provider_config_key is null
    )
    or
    (
      connection_mode = 'oauth'
      and integration_connection_id is not null
      and nullif(pg_catalog.btrim(broker_connection_id), '') is not null
      and pg_catalog.char_length(broker_connection_id) <= 255
      and nullif(pg_catalog.btrim(broker_provider_config_key), '') is not null
      and pg_catalog.char_length(broker_provider_config_key) <= 255
      and access_token is null
      and refresh_token is null
    )
  );

create unique index monitor_sources_integration_connection_unique
on public.monitor_sources(integration_connection_id)
where integration_connection_id is not null;

create or replace function public.sync_github_oauth_monitor_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.provider <> 'github' or new.connection_mode <> 'oauth' then
    return new;
  end if;

  if new.enabled and new.revoked_at is null then
    insert into public.monitor_sources(
      organisation_id, provider, label, config, access_token, refresh_token,
      connected_by, revoked_at, enabled, connection_mode,
      integration_connection_id, broker_connection_id, broker_provider_config_key
    ) values (
      new.organisation_id, 'github', new.label, new.config, null, null,
      coalesce((select auth.uid()), new.connected_by), null, true, 'oauth',
      new.id, new.broker_connection_id, new.broker_provider_config_key
    )
    on conflict (integration_connection_id) where integration_connection_id is not null
    do update set
      label = excluded.label,
      config = excluded.config,
      access_token = null,
      refresh_token = null,
      revoked_at = null,
      enabled = true,
      connection_mode = 'oauth',
      broker_connection_id = excluded.broker_connection_id,
      broker_provider_config_key = excluded.broker_provider_config_key;
  else
    update public.monitor_sources
    set enabled = false,
        revoked_at = case
          when new.revoked_at is not null then coalesce(revoked_at, new.revoked_at)
          else revoked_at
        end
    where integration_connection_id = new.id
      and organisation_id = new.organisation_id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_github_oauth_monitor_source() from public, anon, authenticated;
grant execute on function public.sync_github_oauth_monitor_source() to authenticated, service_role;

create trigger integration_connections_sync_github_monitor
after insert or update of config, enabled, revoked_at, broker_connection_id, broker_provider_config_key
on public.integration_connections
for each row execute function public.sync_github_oauth_monitor_source();

-- Backfill any GitHub OAuth target enabled before this trigger existed.
update public.integration_connections
set enabled = enabled
where provider = 'github'
  and connection_mode = 'oauth';
