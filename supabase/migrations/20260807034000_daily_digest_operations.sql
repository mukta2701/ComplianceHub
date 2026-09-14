-- Owners need one atomic boundary for choosing the server-owned Slack digest
-- destination. Clearing the previous channel and selecting the next channel in
-- one transaction avoids both duplicate selections and half-completed switches.

create or replace function public.set_daily_digest_channel(
  target_organisation_id uuid,
  target_channel_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if (select auth.uid()) is null
    or not public.is_organisation_owner(target_organisation_id)
  then
    raise exception 'daily digest channel selection requires a workspace Owner'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('daily-digest-channel:' || target_organisation_id::text, 0)
  );

  if target_channel_id is not null and not exists (
    select 1
    from public.alert_channels
    where id = target_channel_id
      and organisation_id = target_organisation_id
      and type = 'slack'
      and enabled
      and revoked_at is null
  ) then
    raise exception 'daily digest channel was not found' using errcode = '22023';
  end if;

  update public.alert_channels
  set daily_digest_enabled = false
  where organisation_id = target_organisation_id
    and daily_digest_enabled
    and (target_channel_id is null or id <> target_channel_id);

  if target_channel_id is not null then
    update public.alert_channels
    set daily_digest_enabled = true
    where id = target_channel_id
      and organisation_id = target_organisation_id
      and type = 'slack'
      and enabled
      and revoked_at is null;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'daily digest channel was not found' using errcode = '22023';
    end if;
  end if;

  return true;
end;
$$;

alter function public.set_daily_digest_channel(uuid,uuid) owner to postgres;
revoke all on function public.set_daily_digest_channel(uuid,uuid) from public, anon, authenticated;
grant execute on function public.set_daily_digest_channel(uuid,uuid) to authenticated;
