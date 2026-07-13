-- Invitation delivery/lifecycle cutover.
--
-- Historical accepted Owner invitations are retained. Unaccepted legacy Owner
-- invitations are revoked because accepting one would bypass current ownership
-- delegation. The validated invariant below permits Owner rows only as inactive
-- history and prevents every new active Owner invitation.

alter table public.invitations
  add column if not exists revoked_at timestamptz,
  add column if not exists accepted_by uuid,
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists provider_message_id text,
  add column if not exists delivery_error text,
  add column if not exists last_delivery_attempt_at timestamptz,
  add column if not exists delivery_attempt_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::pg_catalog.regclass
      and conname = 'invitations_accepted_by_fkey'
  ) then
    alter table public.invitations
      add constraint invitations_accepted_by_fkey
      foreign key (accepted_by) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::pg_catalog.regclass
      and conname = 'invitations_delivery_status_check'
  ) then
    alter table public.invitations
      add constraint invitations_delivery_status_check
      check (delivery_status in ('pending', 'sent', 'failed', 'not_configured'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::pg_catalog.regclass
      and conname = 'invitations_delivery_attempt_count_check'
  ) then
    alter table public.invitations
      add constraint invitations_delivery_attempt_count_check
      check (delivery_attempt_count >= 0);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::pg_catalog.regclass
      and conname = 'invitations_provider_message_id_length'
  ) then
    alter table public.invitations
      add constraint invitations_provider_message_id_length
      check (provider_message_id is null or char_length(provider_message_id) <= 255);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.invitations'::pg_catalog.regclass
      and conname = 'invitations_delivery_error_length'
  ) then
    alter table public.invitations
      add constraint invitations_delivery_error_length
      check (delivery_error is null or char_length(delivery_error) <= 500);
  end if;
end;
$$;

-- The previous NOT VALID constraint rejected all Owner history, including rows
-- that predated the role cutover. Replace it with an active-row invariant.
alter table public.invitations drop constraint if exists invitations_cannot_grant_owner;

update public.invitations
set revoked_at = coalesce(revoked_at, now()),
    delivery_status = 'failed',
    delivery_error = 'Legacy Owner invitation revoked during role cutover.'
where role = 'owner'
  and accepted_at is null
  and revoked_at is null;

alter table public.invitations
  add constraint invitations_cannot_grant_owner
  check (role <> 'owner' or accepted_at is not null or revoked_at is not null);

-- Remove the original exact-case lifetime uniqueness constraint defensively,
-- regardless of the generated constraint name, while retaining token uniqueness.
alter table public.invitations drop constraint if exists invitations_organisation_id_email_key;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.invitations'::pg_catalog.regclass
      and c.contype = 'u'
      and pg_catalog.cardinality(c.conkey) = 2
      and (
        select a.attnum from pg_catalog.pg_attribute a
        where a.attrelid = c.conrelid and a.attname = 'organisation_id'
      ) = any(c.conkey)
      and (
        select a.attnum from pg_catalog.pg_attribute a
        where a.attrelid = c.conrelid and a.attname = 'email'
      ) = any(c.conkey)
  loop
    execute pg_catalog.format('alter table public.invitations drop constraint %I', constraint_name);
  end loop;
end;
$$;

update public.invitations
set email = lower(trim(email))
where email is distinct from lower(trim(email));

-- The old exact-case constraint could permit two active rows whose emails differ
-- only by case. Keep the newest active row and revoke older duplicates before
-- installing the case-insensitive partial index; accepted/revoked history remains.
with ranked_active_invitations as (
  select i.id,
         row_number() over (
           partition by i.organisation_id, lower(i.email)
           order by i.created_at desc, i.id desc
         ) as duplicate_rank
  from public.invitations i
  where i.accepted_at is null and i.revoked_at is null
)
update public.invitations i
set revoked_at = now(),
    delivery_status = 'failed',
    delivery_error = 'Superseded during case-insensitive invitation cutover.'
from ranked_active_invitations ranked
where ranked.id = i.id and ranked.duplicate_rank > 1;

drop index if exists public.invitations_active_org_email_idx;
create unique index invitations_active_org_email_idx
  on public.invitations (organisation_id, lower(email))
  where accepted_at is null and revoked_at is null;

create or replace function public.normalize_invitation_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

revoke all on function public.normalize_invitation_email() from public;
revoke all on function public.normalize_invitation_email() from anon;

drop trigger if exists invitations_normalize_email on public.invitations;
create trigger invitations_normalize_email
before insert or update of email on public.invitations
for each row execute function public.normalize_invitation_email();

create or replace function public.issue_invitation(
  target_organisation_id uuid,
  target_email text,
  target_role public.membership_role,
  target_job_title text,
  new_token_hash text,
  new_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.membership_role;
  normalized_email text := lower(trim(coalesce(target_email, '')));
  normalized_job_title text := nullif(trim(target_job_title), '');
  invitation_row public.invitations;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if char_length(normalized_email) not between 3 and 320 or position('@' in normalized_email) <= 1 then
    raise exception 'invalid invitation email' using errcode = '22023';
  end if;
  if normalized_job_title is not null and char_length(normalized_job_title) > 120 then
    raise exception 'job title must be 120 characters or fewer' using errcode = '22023';
  end if;
  if new_token_hash is null or new_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid invitation token hash' using errcode = '22023';
  end if;
  if new_expires_at is null or new_expires_at <= now() or new_expires_at > now() + interval '8 days' then
    raise exception 'invalid invitation expiry' using errcode = '22023';
  end if;

  select m.role into actor_role
  from public.memberships m
  where m.organisation_id = target_organisation_id and m.user_id = actor_id;

  if actor_role is null or actor_role = 'member' then
    raise exception 'you are not allowed to issue invitations' using errcode = '42501';
  end if;
  if target_role = 'owner' then
    raise exception 'owner invitations are not permitted' using errcode = '42501';
  end if;
  if actor_role = 'admin' and target_role <> 'member' then
    raise exception 'your role cannot invite that role' using errcode = '42501';
  end if;

  -- All issue/reissue callers use the same tenant+email lock, so two requests
  -- cannot both observe an absent invitation before the partial unique index.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_organisation_id::text || ':' || normalized_email, 0)
  );

  if exists (
    select 1
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.organisation_id = target_organisation_id
      and lower(trim(coalesce(u.email, ''))) = normalized_email
  ) then
    raise exception 'user is already a member of this organisation' using errcode = '23505';
  end if;

  select i.* into invitation_row
  from public.invitations i
  where i.organisation_id = target_organisation_id
    and lower(i.email) = normalized_email
    and i.accepted_at is null
    and i.revoked_at is null
  for update;

  if found then
    if actor_role = 'admin' and invitation_row.role <> 'member' then
      raise exception 'your role cannot manage that invitation' using errcode = '42501';
    end if;

    update public.invitations
    set email = normalized_email,
        role = target_role,
        job_title = normalized_job_title,
        token_hash = new_token_hash,
        invited_by = actor_id,
        expires_at = new_expires_at,
        delivery_status = 'pending',
        provider_message_id = null,
        delivery_error = null
    where id = invitation_row.id
    returning * into invitation_row;
  else
    insert into public.invitations (
      organisation_id, email, role, job_title, token_hash, invited_by,
      expires_at, delivery_status
    ) values (
      target_organisation_id, normalized_email, target_role, normalized_job_title,
      new_token_hash, actor_id, new_expires_at, 'pending'
    ) returning * into invitation_row;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', invitation_row.id,
    'email', invitation_row.email,
    'role', invitation_row.role,
    'jobTitle', invitation_row.job_title,
    'expiresAt', invitation_row.expires_at
  );
end;
$$;

create or replace function public.resend_invitation(
  target_invitation_id uuid,
  new_token_hash text,
  new_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.membership_role;
  invitation_row public.invitations;
begin
  if new_token_hash is null or new_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid invitation token hash' using errcode = '22023';
  end if;
  if new_expires_at is null or new_expires_at <= now() or new_expires_at > now() + interval '8 days' then
    raise exception 'invalid invitation expiry' using errcode = '22023';
  end if;

  select i.* into invitation_row
  from public.invitations i
  where i.id = target_invitation_id
    and i.accepted_at is null
    and i.revoked_at is null
  for update;
  if not found then
    raise exception 'active invitation not found' using errcode = '22023';
  end if;

  select m.role into actor_role
  from public.memberships m
  where m.organisation_id = invitation_row.organisation_id and m.user_id = actor_id;
  if actor_role is null or actor_role = 'member'
    or (actor_role = 'admin' and invitation_row.role <> 'member') then
    raise exception 'your role cannot manage that invitation' using errcode = '42501';
  end if;

  update public.invitations
  set token_hash = new_token_hash,
      expires_at = new_expires_at,
      invited_by = actor_id,
      delivery_status = 'pending',
      provider_message_id = null,
      delivery_error = null
  where id = invitation_row.id
  returning * into invitation_row;

  return pg_catalog.jsonb_build_object(
    'id', invitation_row.id,
    'email', invitation_row.email,
    'role', invitation_row.role,
    'jobTitle', invitation_row.job_title,
    'expiresAt', invitation_row.expires_at
  );
end;
$$;

create or replace function public.revoke_invitation(target_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.membership_role;
  invitation_row public.invitations;
begin
  select i.* into invitation_row
  from public.invitations i
  where i.id = target_invitation_id
    and i.accepted_at is null
    and i.revoked_at is null
  for update;
  if not found then
    raise exception 'active invitation not found' using errcode = '22023';
  end if;

  select m.role into actor_role
  from public.memberships m
  where m.organisation_id = invitation_row.organisation_id and m.user_id = actor_id;
  if actor_role is null or actor_role = 'member'
    or (actor_role = 'admin' and invitation_row.role <> 'member') then
    raise exception 'your role cannot manage that invitation' using errcode = '42501';
  end if;

  update public.invitations
  set revoked_at = now()
  where id = invitation_row.id;
end;
$$;

create or replace function public.record_invitation_delivery(
  target_invitation_id uuid,
  issued_token_hash text,
  new_delivery_status text,
  new_provider_message_id text,
  new_delivery_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.membership_role;
  invitation_row public.invitations;
begin
  if new_delivery_status not in ('sent', 'failed', 'not_configured') then
    raise exception 'invalid delivery status' using errcode = '22023';
  end if;

  select i.* into invitation_row
  from public.invitations i
  where i.id = target_invitation_id
    and i.accepted_at is null
    and i.revoked_at is null
  for update;
  if not found then
    raise exception 'active invitation not found' using errcode = '22023';
  end if;

  select m.role into actor_role
  from public.memberships m
  where m.organisation_id = invitation_row.organisation_id and m.user_id = actor_id;
  if actor_role is null or actor_role = 'member'
    or (actor_role = 'admin' and invitation_row.role <> 'member') then
    raise exception 'your role cannot manage that invitation' using errcode = '42501';
  end if;
  if invitation_row.token_hash <> issued_token_hash then
    raise exception 'invitation token has changed' using errcode = '22023';
  end if;

  update public.invitations
  set delivery_status = new_delivery_status,
      provider_message_id = case when new_delivery_status = 'sent' then nullif(left(new_provider_message_id, 255), '') else null end,
      delivery_error = case when new_delivery_status = 'sent' then null else nullif(left(new_delivery_error, 500), '') end,
      last_delivery_attempt_at = now(),
      delivery_attempt_count = delivery_attempt_count + 1
  where id = invitation_row.id;
end;
$$;

create or replace function public.accept_invitation(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_row public.invitations;
  current_user_id uuid := (select auth.uid());
  current_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  select * into invitation_row
  from public.invitations
  where token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'), 'hex')
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
    and role <> 'owner'
  for update;

  if not found or lower(invitation_row.email) <> current_email then
    raise exception 'invitation is invalid or expired' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.memberships m
    where m.organisation_id = invitation_row.organisation_id
      and m.user_id = current_user_id
  ) then
    raise exception 'user is already a member of this organisation' using errcode = '23505';
  end if;

  insert into public.memberships (organisation_id, user_id, role, job_title)
  values (invitation_row.organisation_id, current_user_id, invitation_row.role, invitation_row.job_title);

  update public.invitations
  set accepted_at = now(), accepted_by = current_user_id
  where id = invitation_row.id;

  return invitation_row.organisation_id;
end;
$$;

-- Browser clients can list RLS-scoped invitations, but all lifecycle writes go
-- through the narrowly-authorized functions above.
revoke insert, update, delete on public.invitations from authenticated;

revoke all on function public.issue_invitation(uuid,text,public.membership_role,text,text,timestamptz) from public;
revoke all on function public.issue_invitation(uuid,text,public.membership_role,text,text,timestamptz) from anon;
grant execute on function public.issue_invitation(uuid,text,public.membership_role,text,text,timestamptz) to authenticated;

revoke all on function public.resend_invitation(uuid,text,timestamptz) from public;
revoke all on function public.resend_invitation(uuid,text,timestamptz) from anon;
grant execute on function public.resend_invitation(uuid,text,timestamptz) to authenticated;

revoke all on function public.revoke_invitation(uuid) from public;
revoke all on function public.revoke_invitation(uuid) from anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

revoke all on function public.record_invitation_delivery(uuid,text,text,text,text) from public;
revoke all on function public.record_invitation_delivery(uuid,text,text,text,text) from anon;
grant execute on function public.record_invitation_delivery(uuid,text,text,text,text) to authenticated;

revoke all on function public.accept_invitation(text) from public;
revoke all on function public.accept_invitation(text) from anon;
grant execute on function public.accept_invitation(text) to authenticated;
