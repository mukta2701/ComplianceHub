-- Owner RLS permits connector management, but credentials must never be
-- readable through the authenticated Data API. Re-grant only safe metadata
-- columns; service_role remains the server-only collector/sync identity.
revoke select on public.integration_connections from authenticated;
grant select (id, organisation_id, provider, label, config, connected_by, created_at, revoked_at) on public.integration_connections to authenticated;
revoke select on public.evidence_sources from authenticated;
grant select (id, organisation_id, provider, label, config, connected_by, created_at, revoked_at) on public.evidence_sources to authenticated;
