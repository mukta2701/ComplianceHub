create extension if not exists pgcrypto with schema extensions;

create type public.membership_role as enum ('owner', 'member');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organisations (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.membership_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create table public.invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  role public.membership_role not null default 'member',
  token_hash text not null unique,
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, email)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id text not null check (char_length(entity_id) between 1 and 128),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index memberships_user_idx on public.memberships(user_id);
create index audit_events_org_time_idx on public.audit_events(organisation_id, occurred_at desc);

create or replace function public.is_organisation_member(target_organisation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organisation_id = target_organisation_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_organisation_owner(target_organisation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organisation_id = target_organisation_id
      and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

revoke all on function public.is_organisation_member(uuid) from public;
revoke all on function public.is_organisation_owner(uuid) from public;
grant execute on function public.is_organisation_member(uuid) to authenticated;
grant execute on function public.is_organisation_owner(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(new.raw_user_meta_data ->> 'display_name', 120), ''));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.accept_invitation(raw_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invitation_row public.invitations; current_email text;
begin
  current_email := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  select * into invitation_row from public.invitations
  where token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'), 'hex')
    and accepted_at is null and expires_at > now()
  for update;
  if not found or lower(invitation_row.email) <> current_email then
    raise exception 'invitation is invalid or expired' using errcode = '22023';
  end if;
  insert into public.memberships (organisation_id, user_id, role)
  values (invitation_row.organisation_id, (select auth.uid()), invitation_row.role)
  on conflict (organisation_id, user_id) do nothing;
  update public.invitations set accepted_at = now() where id = invitation_row.id;
  return invitation_row.organisation_id;
end;
$$;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.protect_last_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') and not exists (
    select 1 from public.memberships m
    where m.organisation_id = old.organisation_id and m.user_id <> old.user_id and m.role = 'owner'
  ) then raise exception 'an organisation must retain at least one owner'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger memberships_retain_owner before update of role or delete on public.memberships
for each row execute function public.protect_last_owner();

create or replace function public.reject_immutable_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '%', tg_argv[0] using errcode = 'P0001';
end;
$$;
create trigger audit_events_immutable before update or delete on public.audit_events
for each statement execute function public.reject_immutable_change('audit events are immutable');

alter table public.profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_self_or_colleague on public.profiles for select to authenticated using (
  id = (select auth.uid()) or exists (
    select 1 from public.memberships mine join public.memberships theirs using (organisation_id)
    where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
  )
);
create policy profiles_update_self on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy organisations_select_members on public.organisations for select to authenticated
using (public.is_organisation_member(id));
create policy organisations_insert_authenticated on public.organisations for insert to authenticated
with check (created_by = (select auth.uid()));
create policy organisations_update_owners on public.organisations for update to authenticated
using (public.is_organisation_owner(id)) with check (public.is_organisation_owner(id));
create policy memberships_select_members on public.memberships for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy memberships_insert_owner_or_bootstrap on public.memberships for insert to authenticated with check (
  public.is_organisation_owner(organisation_id) or (
    user_id = (select auth.uid()) and role = 'owner' and exists (
      select 1 from public.organisations o where o.id = organisation_id and o.created_by = (select auth.uid())
    ) and not exists (select 1 from public.memberships x where x.organisation_id = organisation_id)
  )
);
create policy memberships_update_owners on public.memberships for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id));
create policy memberships_delete_owners on public.memberships for delete to authenticated
using (public.is_organisation_owner(organisation_id));
create policy invitations_select_owners on public.invitations for select to authenticated
using (public.is_organisation_owner(organisation_id));
create policy invitations_insert_owners on public.invitations for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and invited_by = (select auth.uid()));
create policy invitations_delete_owners on public.invitations for delete to authenticated
using (public.is_organisation_owner(organisation_id));
create policy audit_events_select_members on public.audit_events for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy audit_events_insert_members on public.audit_events for insert to authenticated
with check (public.is_organisation_member(organisation_id) and actor_id = (select auth.uid()));
revoke insert, update, delete on public.audit_events from authenticated;
