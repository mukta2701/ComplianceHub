-- One short, verified ComplianceHub digest may be posted per organisation and
-- local date. Delivery rows are both the concurrency reservation and immutable
-- operational history; Slack secrets remain on the existing alert channel.

alter table public.alert_channels
  add column daily_digest_enabled boolean not null default false;

-- Data API exposure is explicit: the existing Owner-only RLS policies remain
-- the authority boundary even on platforms that no longer auto-grant tables.
revoke all on public.alert_channels from anon;
grant select, insert, update, delete on public.alert_channels to authenticated;

create unique index alert_channels_one_daily_digest_per_org
on public.alert_channels(organisation_id)
where type = 'slack'::public.alert_channel_type
  and enabled
  and daily_digest_enabled
  and revoked_at is null;

create or replace function public.restrict_daily_digest_channel_selection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
    and new.daily_digest_enabled
    and (
      tg_op = 'INSERT'
      or new.daily_digest_enabled is distinct from old.daily_digest_enabled
    )
    and not public.is_organisation_owner(new.organisation_id)
  then
    raise exception 'only workspace owners can select the daily digest channel'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.restrict_daily_digest_channel_selection() from public;
revoke all on function public.restrict_daily_digest_channel_selection() from anon;
grant execute on function public.restrict_daily_digest_channel_selection() to authenticated;
grant execute on function public.restrict_daily_digest_channel_selection() to service_role;

create trigger alert_channels_restrict_daily_digest_selection
before insert or update of daily_digest_enabled on public.alert_channels
for each row execute function public.restrict_daily_digest_channel_selection();

create type public.daily_digest_delivery_status as enum (
  'reserved',
  'delivered',
  'failed',
  'unknown'
);

create table public.daily_digest_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  digest_on date not null,
  channel_id uuid not null,
  fact_hash text not null check (fact_hash ~ '^[0-9a-f]{64}$'),
  message jsonb not null check (jsonb_typeof(message) = 'object'),
  attempted_by uuid not null,
  attempt_count integer not null default 1 check (attempt_count between 1 and 10),
  status public.daily_digest_delivery_status not null default 'reserved',
  error_code text check (error_code is null or char_length(error_code) between 1 and 100),
  reserved_at timestamptz not null default now(),
  last_attempted_at timestamptz not null default now(),
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organisation_id, digest_on),
  unique (id, organisation_id),
  constraint daily_digest_deliveries_channel_tenant_fk
    foreign key (channel_id, organisation_id)
    references public.alert_channels(id, organisation_id) on delete restrict,
  constraint daily_digest_deliveries_delivered_at_check check (
    (status = 'delivered' and delivered_at is not null)
    or (status <> 'delivered' and delivered_at is null)
  )
);

create index daily_digest_deliveries_org_time_idx
on public.daily_digest_deliveries(organisation_id, digest_on desc);

create or replace function public.protect_daily_digest_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organisation_id is distinct from old.organisation_id
    or new.digest_on is distinct from old.digest_on
    or new.channel_id is distinct from old.channel_id
    or new.fact_hash is distinct from old.fact_hash
    or new.message is distinct from old.message
    or new.attempted_by is distinct from old.attempted_by
    or new.reserved_at is distinct from old.reserved_at
  then
    raise exception 'daily digest delivery facts and destination are immutable'
      using errcode = 'P0001';
  end if;

  if old.status in ('delivered', 'unknown') then
    raise exception 'daily digest delivery has a terminal outcome'
      using errcode = 'P0001';
  end if;

  if old.status = 'reserved' then
    if new.status not in ('delivered', 'failed', 'unknown')
      or new.attempt_count <> old.attempt_count
    then
      raise exception 'invalid daily digest delivery transition'
        using errcode = 'P0001';
    end if;
  elsif old.status = 'failed' then
    if new.status <> 'reserved'
      or new.attempt_count <> old.attempt_count + 1
      or new.error_code is not null
      or new.delivered_at is not null
    then
      raise exception 'only a confirmed failed delivery can be reserved for an explicit retry'
        using errcode = 'P0001';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.protect_daily_digest_delivery() from public;
revoke all on function public.protect_daily_digest_delivery() from anon;
grant execute on function public.protect_daily_digest_delivery() to authenticated;

create trigger daily_digest_deliveries_protect
before update on public.daily_digest_deliveries
for each row execute function public.protect_daily_digest_delivery();

create trigger daily_digest_deliveries_audit
after insert or update or delete on public.daily_digest_deliveries
for each row execute function public.capture_audit_event();

alter table public.daily_digest_deliveries enable row level security;

create policy daily_digest_deliveries_owner_select
on public.daily_digest_deliveries for select to authenticated
using (public.is_organisation_owner(organisation_id));

create policy daily_digest_deliveries_owner_insert
on public.daily_digest_deliveries for insert to authenticated
with check (
  public.is_organisation_owner(organisation_id)
  and attempted_by = (select auth.uid())
  and exists (
    select 1
    from public.alert_channels channel
    where channel.id = channel_id
      and channel.organisation_id = organisation_id
      and channel.type = 'slack'
      and channel.enabled
      and channel.daily_digest_enabled
      and channel.revoked_at is null
  )
);

create policy daily_digest_deliveries_owner_update
on public.daily_digest_deliveries for update to authenticated
using (public.is_organisation_owner(organisation_id))
with check (
  public.is_organisation_owner(organisation_id)
  and attempted_by = (select auth.uid())
  and exists (
    select 1
    from public.alert_channels channel
    where channel.id = channel_id
      and channel.organisation_id = organisation_id
      and channel.type = 'slack'
      and channel.enabled
      and channel.daily_digest_enabled
      and channel.revoked_at is null
  )
);

revoke all on public.daily_digest_deliveries from anon, authenticated;
grant select, insert, update on public.daily_digest_deliveries to authenticated;

revoke truncate, references, trigger on public.daily_digest_deliveries from authenticated;
