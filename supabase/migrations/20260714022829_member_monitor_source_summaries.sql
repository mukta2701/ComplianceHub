-- Members need to know which workplace systems are being monitored without
-- receiving monitor_sources.config or either provider token. This function is
-- the only Member-facing source boundary: it validates current membership and
-- returns a deliberately narrow, active-only projection.
create or replace function public.list_connected_monitor_sources(target_organisation_id uuid)
returns table (
  id uuid,
  provider text,
  label text,
  connected_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    source.id,
    source.provider::text,
    source.label,
    source.created_at as connected_at
  from public.monitor_sources as source
  where source.organisation_id = target_organisation_id
    and source.revoked_at is null
    and exists (
      select 1
      from public.memberships as membership
      where membership.organisation_id = target_organisation_id
        and membership.user_id = (select auth.uid())
    )
  order by source.created_at desc, source.id;
$$;

alter function public.list_connected_monitor_sources(uuid) owner to postgres;
revoke all on function public.list_connected_monitor_sources(uuid) from public, anon, authenticated;
grant execute on function public.list_connected_monitor_sources(uuid) to authenticated;
