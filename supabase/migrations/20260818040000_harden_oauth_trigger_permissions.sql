-- OAuth lifecycle triggers validate parent connections on behalf of the
-- authenticated writer. Keep that integrity check server-owned while exposing
-- only the non-secret metadata the Connections page needs to render.
alter function public.enforce_linked_oauth_monitor_source() security definer;
grant select (connection_mode, enabled) on public.integration_connections to authenticated;
