-- OAuth references are accepted only after the server has verified Nango's
-- user/email/workspace tags. Browser sessions retain the local sandbox path,
-- but cannot create, update, revoke, or delete OAuth rows directly.

drop policy if exists integration_connections_owner_insert on public.integration_connections;
create policy integration_connections_owner_insert
on public.integration_connections for insert to authenticated
with check (
  public.is_organisation_operator(organisation_id)
  and connected_by = (select auth.uid())
  and connection_mode = 'sandbox'
  and broker_connection_id is null
  and broker_provider_config_key is null
);

drop policy if exists integration_connections_owner_update on public.integration_connections;
create policy integration_connections_owner_update
on public.integration_connections for update to authenticated
using (
  public.is_organisation_operator(organisation_id)
  and connection_mode = 'sandbox'
  and broker_connection_id is null
  and broker_provider_config_key is null
)
with check (
  public.is_organisation_operator(organisation_id)
  and connection_mode = 'sandbox'
  and broker_connection_id is null
  and broker_provider_config_key is null
);

drop policy if exists integration_connections_owner_delete on public.integration_connections;
create policy integration_connections_owner_delete
on public.integration_connections for delete to authenticated
using (
  public.is_organisation_operator(organisation_id)
  and connection_mode = 'sandbox'
  and broker_connection_id is null
  and broker_provider_config_key is null
);

-- The service client may perform only the OAuth writes used by the verified
-- server actions. It deliberately receives no DELETE privilege: OAuth rows are
-- soft-revoked so their deployment-wide broker identity remains a tombstone.
grant select, insert, update on public.integration_connections to service_role;
revoke delete on public.integration_connections from service_role;

-- OAuth writes fire this trigger to maintain the derived GitHub monitor. Give
-- the trigger its own tightly scoped table-owner authority instead of granting
-- the general service client direct INSERT/UPDATE access to monitor_sources.
alter function public.sync_github_oauth_monitor_source() security definer;
alter function public.sync_github_oauth_monitor_source() owner to postgres;
revoke all on function public.sync_github_oauth_monitor_source() from public, anon, authenticated, service_role;

-- integration_connections.organisation_id retains ON DELETE CASCADE for an
-- explicit database-level workspace destruction. The authenticated portal has
-- no organisations DELETE policy, so ordinary Owner/Admin actions cannot reach
-- that administrative cleanup path or use it to remove broker tombstones.
