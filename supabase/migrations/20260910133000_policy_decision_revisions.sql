-- Technical edits and human acknowledgements use separate version meanings.
-- The existing content trigger still decides whether employee reacceptance is due;
-- this revision changes on every write, including automatic owner clearing.
alter table public.policies add column edit_revision integer not null default 1 check (edit_revision > 0);

create or replace function public.advance_policy_edit_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.edit_revision := 1;
  else
    new.edit_revision := old.edit_revision + 1;
    new.updated_at := pg_catalog.clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function public.advance_policy_edit_revision() from public, anon, authenticated;
create trigger policies_touch_edit_revision before insert or update on public.policies
for each row execute function public.advance_policy_edit_revision();

-- The old endpoint could accept a different version from the one displayed.
-- Remove it so callers cannot bypass the pinned-version contract.
drop function public.accept_policy(uuid);

create or replace function public.accept_policy(target_policy_id uuid, expected_version integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_organisation_id uuid;
  target_version integer;
  accepted_timestamp timestamptz;
  acceptance_id uuid;
begin
  if actor_id is null or not exists (
    select 1
    from auth.users as account
    where account.id = actor_id
      and account.email_confirmed_at is not null
  ) then
    raise exception 'verified authentication required' using errcode = '42501';
  end if;

  select policy.organisation_id, policy.version
  into target_organisation_id, target_version
  from public.policies as policy
  where policy.id = target_policy_id
    and policy.status = 'approved'
  for share;

  if not found then
    raise exception 'policy is not available for acceptance' using errcode = '42501';
  end if;

  perform 1
  from public.memberships as membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = actor_id
  for share;

  if not found then
    raise exception 'policy is not available for acceptance' using errcode = '42501';
  end if;

  if expected_version is null or expected_version < 1 then
    raise exception 'expected policy version is required' using errcode = '22023';
  end if;
  if target_version <> expected_version then
    -- Use a non-retryable validation code. 40001 tells database clients to retry
    -- the same stale request, which can leave the acceptance control pending.
    raise exception 'policy version changed; read the current policy before accepting' using errcode = '22023';
  end if;

  accepted_timestamp := pg_catalog.clock_timestamp();
  insert into public.policy_acceptances (
    organisation_id,
    policy_id,
    user_id,
    accepted_version,
    accepted_at,
    trusted_at
  ) values (
    target_organisation_id,
    target_policy_id,
    actor_id,
    target_version,
    accepted_timestamp,
    accepted_timestamp
  )
  on conflict (policy_id, user_id) do update
  set organisation_id = excluded.organisation_id,
      accepted_version = excluded.accepted_version,
      accepted_at = excluded.accepted_at,
      trusted_at = excluded.trusted_at
  returning id into acceptance_id;

  return acceptance_id;
end;
$$;

alter function public.accept_policy(uuid, integer) owner to postgres;
revoke all on function public.accept_policy(uuid, integer) from public;
revoke all on function public.accept_policy(uuid, integer) from anon;
grant execute on function public.accept_policy(uuid, integer) to authenticated;
