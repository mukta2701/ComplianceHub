-- All user-driven digest selection changes must pass through the atomic,
-- Owner-only set_daily_digest_channel RPC. Ordinary channel lifecycle updates
-- may still pause or revoke a destination; those transitions clear selection
-- in the same row write so re-enabling cannot silently resume delivery.

create or replace function public.restrict_daily_digest_channel_selection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and (
    (tg_op = 'INSERT' and new.daily_digest_enabled)
    or (
      tg_op = 'UPDATE'
      and new.daily_digest_enabled is distinct from old.daily_digest_enabled
    )
  ) then
    raise exception 'daily digest channel must be selected with set_daily_digest_channel'
      using errcode = '42501';
  end if;

  if not new.enabled or new.revoked_at is not null then
    new.daily_digest_enabled := false;
  end if;

  return new;
end;
$$;

revoke all on function public.restrict_daily_digest_channel_selection() from public, anon;
grant execute on function public.restrict_daily_digest_channel_selection() to authenticated;
grant execute on function public.restrict_daily_digest_channel_selection() to service_role;

drop trigger if exists alert_channels_restrict_daily_digest_selection on public.alert_channels;
create trigger alert_channels_restrict_daily_digest_selection
before insert or update of daily_digest_enabled, enabled, revoked_at on public.alert_channels
for each row execute function public.restrict_daily_digest_channel_selection();
