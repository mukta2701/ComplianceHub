begin;
select plan(1);

select is(
  (
    select count(*)::int
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'monitoring_findings'
  ),
  1,
  'monitoring findings are published to Supabase Realtime'
);

select * from finish();
rollback;
