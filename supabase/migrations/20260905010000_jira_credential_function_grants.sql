-- Credential reads and refresh mutations are backend-only capabilities. The
-- consolidated Jira migration omitted these explicit grants; preserve the
-- existing function bodies and match the cleanup-credential RPC boundary.
revoke all on function public.read_jira_access_credential(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_jira_access_credential(uuid) to service_role;

revoke all on function public.claim_jira_refresh_lease(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_jira_refresh_lease(uuid) to service_role;

revoke all on function public.complete_jira_refresh_lease(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_jira_refresh_lease(uuid, uuid, text, text, timestamptz)
  to service_role;
