-- RLS does not apply to TRUNCATE, REFERENCES or TRIGGER. Supabase's broad local
-- default ACLs granted these privileges to portal roles, so remove them from
-- every existing application-owned public table and prevent future migrations
-- from reintroducing them. Ordinary SELECT/INSERT/UPDATE/DELETE grants remain
-- unchanged and RLS-scoped. The provider-owned storage schema is deliberately
-- outside this migration: Supabase requires supabase_storage_admin ownership and
-- governs storage.objects through its managed grants plus our evidence RLS.
revoke truncate, references, trigger on all tables in schema public
from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from public, anon, authenticated;

-- Legacy rows pre-date the security-definer acceptance RPC and may contain
-- caller-supplied versions/timestamps. Keep them for audit history but exclude
-- them from every portal report until the user securely re-accepts.
alter table public.policy_acceptances
  add column trusted_at timestamptz;

drop policy if exists policy_acceptances_operator_select on public.policy_acceptances;
drop policy if exists policy_acceptances_member_own_select on public.policy_acceptances;

create policy policy_acceptances_operator_select
on public.policy_acceptances for select to authenticated
using (
  trusted_at is not null
  and public.is_organisation_operator(organisation_id)
);

create policy policy_acceptances_member_own_select
on public.policy_acceptances for select to authenticated
using (
  trusted_at is not null
  and public.is_organisation_member(organisation_id)
  and user_id = (select auth.uid())
);

create or replace function public.accept_policy(target_policy_id uuid)
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

alter function public.accept_policy(uuid) owner to postgres;
revoke all on function public.accept_policy(uuid) from public;
revoke all on function public.accept_policy(uuid) from anon;
grant execute on function public.accept_policy(uuid) to authenticated;

-- The database is the single authority for policy versions. Material body edits
-- bump exactly once from OLD.version; callers cannot write version directly.
create or replace function public.enforce_policy_update_authz()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_body text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(old.body, ''), '[[:space:]]+', ' ', 'g'));
  new_body text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(new.body, ''), '[[:space:]]+', ' ', 'g'));
begin
  if pg_catalog.to_jsonb(new) is distinct from pg_catalog.to_jsonb(old)
    and not public.is_organisation_operator(old.organisation_id)
  then
    raise exception 'only workspace operators can edit or approve policies'
      using errcode = '42501';
  end if;

  if new_body is distinct from old_body then
    new.version := old.version + 1;
  elsif new.version is distinct from old.version then
    raise exception 'policy version is database-managed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
