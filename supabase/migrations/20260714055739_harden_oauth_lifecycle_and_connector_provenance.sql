-- OAuth identities are verified once, then retained as immutable tombstones.
-- Linked monitoring remains a derived child of the parent integration, while
-- shared workspace resources survive offboarding of the person who connected
-- them. Connector provenance becomes nullable only through membership removal.

drop index public.integration_connections_broker_ref_unique;
create unique index integration_connections_broker_ref_unique
on public.integration_connections(broker_provider_config_key, broker_connection_id)
where broker_connection_id is not null;

alter table public.integration_connections
  drop constraint integration_connections_connector_tenant_fk,
  alter column connected_by drop not null,
  add constraint integration_connections_connector_tenant_fk
    foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id)
    on delete set null (connected_by);

alter table public.monitor_sources
  drop constraint monitor_sources_connector_tenant_fk,
  alter column connected_by drop not null,
  add constraint monitor_sources_connector_tenant_fk
    foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id)
    on delete set null (connected_by);

alter table public.alert_channels
  drop constraint alert_channels_connector_tenant_fk,
  alter column connected_by drop not null,
  add constraint alert_channels_connector_tenant_fk
    foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id)
    on delete set null (connected_by);

create or replace function public.enforce_oauth_connection_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.connection_mode = 'oauth' and (
    new.provider is distinct from old.provider
    or new.connection_mode is distinct from old.connection_mode
    or new.broker_connection_id is distinct from old.broker_connection_id
    or new.broker_provider_config_key is distinct from old.broker_provider_config_key
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'OAuth connection identity is immutable';
  end if;
  if new.provider is distinct from old.provider
     or new.connection_mode is distinct from old.connection_mode then
    raise exception using
      errcode = 'P0001',
      message = 'Connection provider and mode are immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_oauth_connection_identity() from public, anon, authenticated;
grant execute on function public.enforce_oauth_connection_identity() to authenticated, service_role;

create trigger integration_connections_immutable_oauth_identity
before update of provider, connection_mode, broker_connection_id, broker_provider_config_key
on public.integration_connections
for each row execute function public.enforce_oauth_connection_identity();

-- Existing linked rows may have recorded the Admin who selected the repository.
-- Restore their stable provenance and all derived fields from the parent before
-- installing the consistency guard.
update public.monitor_sources as source
set connected_by = connection.connected_by,
    label = connection.label,
    config = connection.config,
    enabled = connection.enabled and connection.revoked_at is null,
    revoked_at = case
      when connection.revoked_at is not null then coalesce(source.revoked_at, connection.revoked_at)
      when connection.enabled then null
      else source.revoked_at
    end,
    broker_connection_id = connection.broker_connection_id,
    broker_provider_config_key = connection.broker_provider_config_key
from public.integration_connections as connection
where source.integration_connection_id = connection.id
  and source.organisation_id = connection.organisation_id;

create or replace function public.enforce_linked_oauth_monitor_source()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent record;
  previous_revoked_at timestamptz;
  expected_revoked_at timestamptz;
  expected_enabled boolean;
begin
  if new.integration_connection_id is null then
    if tg_op = 'UPDATE' and old.integration_connection_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'Linked OAuth monitoring is managed by its integration connection';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.integration_connection_id is distinct from old.integration_connection_id then
    raise exception using
      errcode = 'P0001',
      message = 'Linked OAuth monitoring is managed by its integration connection';
  end if;

  -- Preserve the table constraint as the canonical rejection for token-bearing
  -- OAuth rows; the lifecycle guard handles otherwise valid derived updates.
  if new.access_token is not null or new.refresh_token is not null then
    return new;
  end if;

  select
    connection.id, connection.organisation_id, connection.provider,
    connection.connection_mode, connection.label, connection.config,
    connection.enabled, connection.revoked_at,
    connection.broker_connection_id, connection.broker_provider_config_key
  into parent
  from public.integration_connections as connection
  where connection.id = new.integration_connection_id
    and connection.organisation_id = new.organisation_id;

  -- Let the composite tenant FK provide its precise error for a missing or
  -- cross-workspace parent.
  if not found then
    return new;
  end if;
  if parent.provider <> 'github' or parent.connection_mode <> 'oauth' then
    raise exception using
      errcode = 'P0001',
      message = 'Linked OAuth monitoring is managed by its integration connection';
  end if;

  previous_revoked_at := case when tg_op = 'UPDATE' then old.revoked_at else null end;
  if parent.enabled and parent.revoked_at is null then
    expected_enabled := true;
    expected_revoked_at := null;
  else
    expected_enabled := false;
    expected_revoked_at := case
      when parent.revoked_at is not null then coalesce(previous_revoked_at, parent.revoked_at)
      else previous_revoked_at
    end;
  end if;

  if new.provider <> 'github'
     or new.connection_mode <> 'oauth'
     or new.label is distinct from parent.label
     or new.config is distinct from parent.config
     or new.enabled is distinct from expected_enabled
     or new.revoked_at is distinct from expected_revoked_at
     or new.broker_connection_id is distinct from parent.broker_connection_id
     or new.broker_provider_config_key is distinct from parent.broker_provider_config_key then
    raise exception using
      errcode = 'P0001',
      message = 'Linked OAuth monitoring is managed by its integration connection';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_linked_oauth_monitor_source() from public, anon, authenticated;
grant execute on function public.enforce_linked_oauth_monitor_source() to authenticated, service_role;

create trigger monitor_sources_enforce_linked_oauth_lifecycle
before insert or update on public.monitor_sources
for each row execute function public.enforce_linked_oauth_monitor_source();

drop policy if exists monitor_sources_owner_insert on public.monitor_sources;
create policy monitor_sources_owner_insert
on public.monitor_sources for insert to authenticated
with check (
  public.is_organisation_operator(organisation_id)
  and (
    (
      integration_connection_id is null
      and connected_by = (select auth.uid())
    )
    or
    (
      integration_connection_id is not null
      and (
        connected_by is null
        or exists (
          select 1
          from public.memberships as connector
          where connector.organisation_id = monitor_sources.organisation_id
            and connector.user_id = monitor_sources.connected_by
        )
      )
    )
  )
);

drop policy if exists monitor_sources_owner_delete on public.monitor_sources;
create policy monitor_sources_owner_delete
on public.monitor_sources for delete to authenticated
using (
  public.is_organisation_operator(organisation_id)
  and integration_connection_id is null
);

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
      new.connected_by, null, true, 'oauth',
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
