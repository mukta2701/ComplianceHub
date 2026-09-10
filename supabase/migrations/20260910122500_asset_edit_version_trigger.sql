-- Keep the technical edit version current for every asset update, including
-- foreign-key SET NULL actions when an assigned owner or category is removed.
create or replace function public.touch_asset_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := pg_catalog.clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function public.touch_asset_updated_at() from public, anon, authenticated;

create trigger assets_touch_updated_at
before update on public.assets
for each row execute function public.touch_asset_updated_at();
