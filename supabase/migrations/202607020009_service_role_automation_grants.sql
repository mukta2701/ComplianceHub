-- The daily automation sweep (cron route) is the first server-side consumer of
-- the service-role client. This database's baseline strips DML on public tables
-- from every API role (grants are explicit per table), and no earlier migration
-- granted service_role anything, so the sweep's service client got "permission
-- denied" on every table it touches. Restore ONLY the operations the automation
-- surface actually performs — deliberately scoped, not blanket DML, so the
-- service role stays least-privilege in this multi-tenant compliance product.
-- RLS is bypassed by service_role anyway, and immutability (audit events,
-- evidence, catalogues) stays enforced by triggers, which fire for service_role.
--
-- The verbs below are the union of two service_role callers, kept narrow:
--   * the sweep runtime (src/app/api/cron/daily/route.ts):
--       memberships   SELECT
--       evidence      SELECT, UPDATE
--       tasks         SELECT, INSERT (upsert)
--       notifications INSERT (upsert)
--   * the live-DB integration test harness
--     (route.integration.test.ts), which provisions and tears down throwaway
--     tenant fixtures through the same service_role key:
--       organisations INSERT (+ SELECT id)
--       memberships   INSERT
--       evidence      INSERT
--       tasks         DELETE
--       notifications SELECT, DELETE
-- profiles is intentionally NOT granted: neither the sweep nor the harness
-- touches it (its row is created by the on_auth_user_created trigger, which runs
-- security-definer). No blanket UPDATE/DELETE is granted beyond the above.
grant select, insert on public.organisations to service_role;
grant select, insert on public.memberships to service_role;
grant select, insert, update on public.evidence to service_role;
grant select, insert, delete on public.tasks to service_role;
grant select, insert, delete on public.notifications to service_role;

-- notifications.id is an identity column; its insert needs the backing sequence.
-- Scoped to that one sequence — the sweep uses no others (all other ids are uuid).
grant usage, select on sequence public.notifications_id_seq to service_role;

-- NOTE: deliberately NO `alter default privileges ... to service_role`. Making
-- every FUTURE public table service-role writable by default would silently
-- remove the per-table decision speed bump this schema relies on. New tables
-- that the automation surface needs must be granted explicitly, here or in the
-- migration that creates them.
