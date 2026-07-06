-- Phase D (B7): two-way ticket→task sync. The poll cron
-- (/api/cron/integrations-sync) now closes the linked ComplianceHub task when a
-- pushed tracker ticket reaches a terminal "done" state. That is the FIRST
-- service_role UPDATE on public.tasks: 202607020009 granted the daily sweep only
-- select/insert/delete (it upserts tasks, never updates them), so the cron's
-- service client would get "permission denied" on the auto-close. Grant exactly
-- the missing verb — UPDATE — nothing else, keeping the least-privilege
-- convention. RLS is bypassed by service_role; the cron scopes every update by
-- organisation_id per row, and the tasks audit trigger still fires.

grant update on public.tasks to service_role;
