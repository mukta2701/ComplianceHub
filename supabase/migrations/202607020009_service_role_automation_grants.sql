-- The daily automation sweep (cron route) is the first server-side consumer of
-- the service-role client. This database's baseline strips DML on public
-- tables from every API role (grants are explicit per table), and no earlier
-- migration granted service_role anything, so the sweep's service client got
-- "permission denied" on every table it touches. Restore the conventional
-- Supabase service-role contract for the tenant tables the automation surface
-- reads and writes. RLS is bypassed by service_role anyway, and immutability
-- (audit events, evidence, catalogues) stays enforced by triggers, which fire
-- for service_role too.
grant select, insert, update, delete on
  public.organisations,
  public.memberships,
  public.profiles,
  public.evidence,
  public.tasks,
  public.notifications
to service_role;

-- notifications.id is an identity column; inserts need its sequence.
grant usage, select on all sequences in schema public to service_role;

-- Future tables created by migrations should keep the conventional
-- service-role access instead of silently repeating this failure mode.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
