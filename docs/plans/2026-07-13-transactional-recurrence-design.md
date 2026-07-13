# Transactional Recurrence Regeneration Design

## Context

Recurring tasks regenerate when a member marks an occurrence done. The current server
action updates the existing task and then performs a separate insert. If that insert
fails, the completed task remains committed without its successor. The daily cron does
not own this flow; it only ages evidence and raises overdue/review notifications.

## Design

Add one `public.complete_recurring_task` PostgreSQL function and call it from the task
status action only for a transition to `done` on a recurring, dated task. The function
will be `SECURITY INVOKER`, execute as the authenticated caller, and rely on the existing
task SELECT/UPDATE/INSERT RLS policies. It will lock and update the source task only when
its current status is not already `done`, derive the next due date from that locked row,
then insert exactly one successor. Both statements run in the function call's database
transaction; an insert error rolls back the status update. Because the RPC accepts only
the task id, a caller cannot supply an arbitrary or stale successor date.

The function will pin an empty search path and fully qualify every object. Default
function execution will be revoked from `PUBLIC`, `anon`, and `service_role`, then
granted only to `authenticated`. Repeated completion calls are guarded by the source
row's status and return `false` without inserting another successor.

Non-recurring status changes remain ordinary updates. PostgreSQL applies the same weekly
and calendar-month clamping semantics as the existing domain recurrence rules.

## Verification

A Vitest regression test will prove the recurring completion path calls one RPC rather
than update-plus-insert. A matching pgTAP test will inject a successor insert failure and
prove the source task remains open, then prove successful and repeated calls are atomic
and idempotent. The migration will be applied only to the local Docker database via
`docker exec -i supabase_db_compliancehub psql`.
