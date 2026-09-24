-- The current runtime writes approved checks through the entry-aware
-- materialiser. Keep the legacy wrapper and its historical rows, but remove
-- every API role's ability to create new official results through it.
revoke all on function public.materialise_github_observations_server(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;
