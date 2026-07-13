-- Postgres Changes only emits rows from tables explicitly included in the
-- Supabase-managed publication. Keep this addition narrow: RLS still controls
-- which authenticated subscribers can receive each finding, and anon retains
-- no SELECT grant on the table.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'supabase_realtime publication is required';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'monitoring_findings'
  ) then
    execute 'alter publication supabase_realtime add table public.monitoring_findings';
  end if;
end
$$;
