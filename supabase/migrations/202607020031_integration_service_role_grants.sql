-- Phase D2: the poll cron (/api/cron/integrations-sync) is the only service-role
-- consumer of the integration tables. Grant ONLY what it performs, matching the
-- least-privilege convention of 202607020009: read connections (for the token +
-- config), read + update tickets (status/assignee/last_synced_at). No insert or
-- delete — pushes happen in the request path (Task 13), never in the cron.

grant select on public.integration_connections to service_role;
grant select, update on public.task_tickets to service_role;
