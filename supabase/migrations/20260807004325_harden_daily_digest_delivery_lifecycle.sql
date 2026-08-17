-- Daily digest delivery is an external side effect. Authenticated callers may
-- inspect Owner-scoped history, but all lifecycle writes pass through the two
-- compare-and-set RPCs below so terminal status, timestamps, destination, and
-- exact outgoing payload cannot be forged through the Data API.

drop policy if exists daily_digest_deliveries_owner_insert on public.daily_digest_deliveries;
drop policy if exists daily_digest_deliveries_owner_update on public.daily_digest_deliveries;
revoke insert, update, delete on public.daily_digest_deliveries from authenticated;

create table public.daily_digest_delivery_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  delivery_id uuid not null,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 10),
  attempted_by uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome public.daily_digest_delivery_status,
  error_code text check (error_code is null or char_length(error_code) between 1 and 100),
  unique (delivery_id, attempt_number),
  constraint daily_digest_attempt_delivery_tenant_fk
    foreign key (delivery_id, organisation_id)
    references public.daily_digest_deliveries(id, organisation_id) on delete restrict,
  constraint daily_digest_attempt_outcome_check check (
    (outcome is null and finished_at is null and error_code is null)
    or (outcome = 'delivered' and finished_at is not null and error_code is null)
    or (outcome = 'failed' and finished_at is not null and error_code in ('SLACK_REJECTED','RATE_LIMITED'))
    or (outcome = 'unknown' and finished_at is not null and error_code = 'DELIVERY_UNKNOWN')
  )
);

create index daily_digest_delivery_attempts_org_time_idx
on public.daily_digest_delivery_attempts(organisation_id, started_at desc);

create or replace function public.protect_daily_digest_delivery_attempt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.delivery_id is distinct from old.delivery_id
    or new.organisation_id is distinct from old.organisation_id
    or new.attempt_number is distinct from old.attempt_number
    or new.attempted_by is distinct from old.attempted_by
    or new.started_at is distinct from old.started_at
  then
    raise exception 'daily digest attempt identity is immutable' using errcode = 'P0001';
  end if;
  if old.outcome is not null or old.finished_at is not null then
    raise exception 'daily digest attempt outcome is immutable' using errcode = 'P0001';
  end if;
  if new.outcome not in ('delivered','failed','unknown') or new.finished_at is null then
    raise exception 'invalid daily digest attempt outcome' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_daily_digest_delivery_attempt() from public, anon;
grant execute on function public.protect_daily_digest_delivery_attempt() to service_role;

create trigger daily_digest_delivery_attempts_protect
before update on public.daily_digest_delivery_attempts
for each row execute function public.protect_daily_digest_delivery_attempt();

create trigger daily_digest_delivery_attempts_audit
after insert or update on public.daily_digest_delivery_attempts
for each row execute function public.capture_audit_event();

alter table public.daily_digest_delivery_attempts enable row level security;
create policy daily_digest_delivery_attempts_owner_select
on public.daily_digest_delivery_attempts for select to authenticated
using ((select public.is_organisation_owner(organisation_id)));

revoke all on public.daily_digest_delivery_attempts from public, anon, authenticated;
grant select on public.daily_digest_delivery_attempts to authenticated;
revoke truncate, references, trigger on public.daily_digest_delivery_attempts from authenticated;

create or replace function public.reserve_daily_digest_delivery(
  target_organisation_id uuid,
  target_digest_on date,
  target_fact_hash text,
  target_message jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_channel_id uuid;
  delivery public.daily_digest_deliveries;
  next_attempt integer;
begin
  if caller_id is null or not public.is_organisation_owner(target_organisation_id) then
    raise exception 'daily digest action requires a workspace Owner' using errcode = '42501';
  end if;
  if target_digest_on is null
    or target_fact_hash is null
    or target_fact_hash !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(target_message) <> 'object'
    or pg_catalog.jsonb_typeof(target_message -> 'text') <> 'string'
    or pg_catalog.jsonb_typeof(target_message -> 'blocks') <> 'array'
    or pg_catalog.pg_column_size(target_message) > 32768
  then
    raise exception 'invalid daily digest reservation' using errcode = '22023';
  end if;

  -- Serialize one organisation/date without holding a database lock across the
  -- external Slack call. The committed reserved row becomes the durable lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organisation_id::text || ':' || target_digest_on::text, 0)
  );

  select * into delivery
  from public.daily_digest_deliveries
  where organisation_id = target_organisation_id and digest_on = target_digest_on
  for update;

  if found then
    if delivery.status = 'delivered' then
      return pg_catalog.jsonb_build_object('state','already_posted');
    end if;
    if delivery.status in ('reserved','unknown')
      or delivery.fact_hash <> target_fact_hash
      or delivery.attempt_count >= 10
    then
      return pg_catalog.jsonb_build_object('state','delivery_unknown');
    end if;
    if not exists (
      select 1 from public.alert_channels
      where id = delivery.channel_id
        and organisation_id = target_organisation_id
        and type = 'slack'
        and enabled
        and daily_digest_enabled
        and revoked_at is null
    ) then
      return pg_catalog.jsonb_build_object('state','no_digest_channel');
    end if;

    -- Only a confirmed failure reaches here. The original destination, fact
    -- hash, and exact payload stay immutable; new model wording is ignored.
    next_attempt := delivery.attempt_count + 1;
    update public.daily_digest_deliveries
    set status = 'reserved',
        attempt_count = next_attempt,
        error_code = null,
        delivered_at = null,
        last_attempted_at = pg_catalog.now()
    where id = delivery.id and status = 'failed' and attempt_count = delivery.attempt_count;
    if not found then
      return pg_catalog.jsonb_build_object('state','delivery_unknown');
    end if;
    insert into public.daily_digest_delivery_attempts(
      delivery_id, organisation_id, attempt_number, attempted_by
    ) values (delivery.id, target_organisation_id, next_attempt, caller_id);
    return pg_catalog.jsonb_build_object(
      'state','reserved',
      'deliveryId',delivery.id,
      'channelId',delivery.channel_id,
      'attemptNumber',next_attempt,
      'message',delivery.message
    );
  end if;

  select id into selected_channel_id
  from public.alert_channels
  where organisation_id = target_organisation_id
    and type = 'slack'
    and enabled
    and daily_digest_enabled
    and revoked_at is null
  order by id
  limit 1;
  if selected_channel_id is null then
    return pg_catalog.jsonb_build_object('state','no_digest_channel');
  end if;

  insert into public.daily_digest_deliveries(
    organisation_id, digest_on, channel_id, fact_hash, message, attempted_by
  ) values (
    target_organisation_id, target_digest_on, selected_channel_id,
    target_fact_hash, target_message, caller_id
  ) returning * into delivery;
  insert into public.daily_digest_delivery_attempts(
    delivery_id, organisation_id, attempt_number, attempted_by
  ) values (delivery.id, target_organisation_id, 1, caller_id);

  return pg_catalog.jsonb_build_object(
    'state','reserved',
    'deliveryId',delivery.id,
    'channelId',delivery.channel_id,
    'attemptNumber',1,
    'message',delivery.message
  );
end;
$$;

create or replace function public.finalize_daily_digest_delivery(
  target_delivery_id uuid,
  target_attempt_number integer,
  target_outcome text,
  target_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  delivery public.daily_digest_deliveries;
  changed integer;
begin
  if caller_id is null then
    raise exception 'daily digest action requires a workspace Owner' using errcode = '42501';
  end if;
  select * into delivery from public.daily_digest_deliveries
  where id = target_delivery_id for update;
  if not found then return false; end if;
  if not public.is_organisation_owner(delivery.organisation_id) then
    raise exception 'daily digest action requires a workspace Owner' using errcode = '42501';
  end if;
  if target_attempt_number is null
    or target_outcome not in ('delivered','failed','unknown')
    or (target_outcome = 'delivered' and target_error_code is not null)
    or (target_outcome = 'failed' and target_error_code not in ('SLACK_REJECTED','RATE_LIMITED'))
    or (target_outcome = 'unknown' and target_error_code <> 'DELIVERY_UNKNOWN')
  then
    raise exception 'invalid daily digest outcome' using errcode = '22023';
  end if;
  if delivery.status <> 'reserved' or delivery.attempt_count <> target_attempt_number then
    return false;
  end if;

  update public.daily_digest_delivery_attempts
  set outcome = target_outcome::public.daily_digest_delivery_status,
      error_code = target_error_code,
      finished_at = pg_catalog.now()
  where delivery_id = target_delivery_id
    and attempt_number = target_attempt_number
    and outcome is null
    and finished_at is null;
  get diagnostics changed = row_count;
  if changed <> 1 then return false; end if;

  update public.daily_digest_deliveries
  set status = target_outcome::public.daily_digest_delivery_status,
      error_code = target_error_code,
      last_attempted_at = pg_catalog.now(),
      delivered_at = case when target_outcome = 'delivered' then pg_catalog.now() else null end
  where id = target_delivery_id
    and status = 'reserved'
    and attempt_count = target_attempt_number;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'daily digest finalization compare-and-set failed' using errcode = '40001';
  end if;
  return true;
end;
$$;

revoke all on function public.reserve_daily_digest_delivery(uuid,date,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finalize_daily_digest_delivery(uuid,integer,text,text) from public, anon, authenticated, service_role;
grant execute on function public.reserve_daily_digest_delivery(uuid,date,text,jsonb) to authenticated;
grant execute on function public.finalize_daily_digest_delivery(uuid,integer,text,text) to authenticated;
