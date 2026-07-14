-- Owner/Admin-managed integration state. OAuth access is brokered by Nango:
-- ComplianceHub stores only opaque connection references, never provider OAuth
-- tokens. Existing/manual demo connections remain sandbox connections.

alter table public.integration_connections
  add column enabled boolean not null default true,
  add column connection_mode text not null default 'sandbox',
  add column broker_connection_id text,
  add column broker_provider_config_key text;

alter table public.integration_connections
  add constraint integration_connections_mode_check check (
    (
      connection_mode = 'sandbox'
      and broker_connection_id is null
      and broker_provider_config_key is null
    )
    or
    (
      connection_mode = 'oauth'
      and nullif(pg_catalog.btrim(broker_connection_id), '') is not null
      and pg_catalog.char_length(broker_connection_id) <= 255
      and nullif(pg_catalog.btrim(broker_provider_config_key), '') is not null
      and pg_catalog.char_length(broker_provider_config_key) <= 255
      and access_token is null
      and refresh_token is null
    )
  ),
  add constraint integration_connections_enabled_target_check check (
    not enabled
    or connection_mode = 'sandbox'
    or (
      provider = 'github'
      and nullif(pg_catalog.btrim(config ->> 'owner'), '') is not null
      and pg_catalog.char_length(config ->> 'owner') <= 120
      and nullif(pg_catalog.btrim(config ->> 'repo'), '') is not null
      and pg_catalog.char_length(config ->> 'repo') <= 120
    )
    or (
      provider = 'jira'
      and (config ->> 'baseUrl') ~* '^https://[a-z0-9][a-z0-9.-]*\.atlassian\.net/?$'
      and (config ->> 'projectKey') ~ '^[A-Z][A-Z0-9_]{0,79}$'
    )
  );

create unique index integration_connections_broker_ref_unique
on public.integration_connections(organisation_id, broker_provider_config_key, broker_connection_id)
where broker_connection_id is not null and revoked_at is null;

drop index if exists public.integration_connections_org_idx;
create index integration_connections_org_idx
on public.integration_connections(organisation_id)
where revoked_at is null and enabled;

alter table public.monitor_sources
  add column enabled boolean not null default true;

drop index if exists public.monitor_sources_org_idx;
create index monitor_sources_org_idx
on public.monitor_sources(organisation_id)
where revoked_at is null and enabled;

alter table public.alert_channels
  add column enabled boolean not null default true;

drop index if exists public.alert_channels_org_idx;
create index alert_channels_org_idx
on public.alert_channels(organisation_id)
where revoked_at is null and enabled;

-- Members receive only active, enabled source summaries. Secret configuration
-- and token columns remain outside this narrow SECURITY DEFINER boundary.
create or replace function public.list_connected_monitor_sources(target_organisation_id uuid)
returns table (
  id uuid,
  provider text,
  label text,
  connected_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    source.id,
    source.provider::text,
    source.label,
    source.created_at as connected_at
  from public.monitor_sources as source
  where source.organisation_id = target_organisation_id
    and source.revoked_at is null
    and source.enabled
    and exists (
      select 1
      from public.memberships as membership
      where membership.organisation_id = target_organisation_id
        and membership.user_id = (select auth.uid())
    )
  order by source.created_at desc, source.id;
$$;

alter function public.list_connected_monitor_sources(uuid) owner to postgres;
revoke all on function public.list_connected_monitor_sources(uuid) from public, anon, authenticated;
grant execute on function public.list_connected_monitor_sources(uuid) to authenticated;
