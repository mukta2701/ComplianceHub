-- Managed platforms can grant privileges directly to API roles by default.
-- Revoking PUBLIC alone does not remove those direct grants.
revoke all on function public.increment_rate_limit(text, integer)
  from public, anon, authenticated;
grant execute on function public.increment_rate_limit(text, integer)
  to service_role;

-- Audit events are append-only for the backend and readable through the
-- existing member-scoped RLS policy. ALL also removes TRUNCATE (which bypasses
-- UPDATE/DELETE triggers) and newer PostgreSQL privileges such as MAINTAIN.
revoke all on table public.audit_events
  from public, anon, authenticated, service_role;
grant select on table public.audit_events to authenticated;
grant insert on table public.audit_events to service_role;

-- Generated identity inserts do not require API callers to manipulate the
-- backing sequence. Keep callers from advancing or resetting audit IDs.
revoke all on sequence public.audit_events_id_seq
  from public, anon, authenticated, service_role;
