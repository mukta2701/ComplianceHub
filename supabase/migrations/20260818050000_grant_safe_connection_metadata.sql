-- Connection operators need the non-secret lifecycle metadata used by the
-- settings actions. Keep opaque broker references visible for verified
-- server-action routing, while credentials remain service-role only.
grant select (
  connection_mode,
  enabled,
  broker_connection_id,
  broker_provider_config_key
) on public.integration_connections to authenticated;
