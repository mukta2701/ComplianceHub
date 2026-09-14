-- Export routes already use the trusted backend client to append content-free
-- audit metadata. Restore that missing capability without permitting ordinary
-- users to forge events or granting any ability to alter historical events.
grant insert on public.audit_events to service_role;
