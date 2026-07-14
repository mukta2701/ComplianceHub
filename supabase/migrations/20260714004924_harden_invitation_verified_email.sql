-- Invitation authorization must use the current, verified auth.users email.
-- JWT email claims can be stale after an account email change and are not an
-- authorization boundary.
create or replace function public.accept_invitation(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_row public.invitations;
  current_user_id uuid := (select auth.uid());
  current_email text;
begin
  select lower(trim(u.email))
  into current_email
  from auth.users u
  where u.id = current_user_id
    and u.email_confirmed_at is not null
    and nullif(trim(u.email), '') is not null;

  if current_user_id is null or current_email is null then
    raise exception 'invitation is invalid or expired' using errcode = '22023';
  end if;

  select * into invitation_row
  from public.invitations
  where token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'), 'hex')
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
    and role <> 'owner'
  for update;

  if not found or lower(trim(invitation_row.email)) <> current_email then
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

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.invitation_preview(raw_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preview jsonb;
  current_verified_email text;
begin
  if raw_token is null or raw_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;

  select lower(trim(u.email))
  into current_verified_email
  from auth.users u
  where u.id = (select auth.uid())
    and u.email_confirmed_at is not null
    and nullif(trim(u.email), '') is not null;

  select pg_catalog.jsonb_build_object(
    'organisationName', o.name,
    'role', i.role,
    'jobTitle', i.job_title,
    'expiresAt', i.expires_at,
    'emailHint', case
      when position('@' in i.email) > 1
        then left(lower(i.email), 1) || '***@' || split_part(lower(i.email), '@', 2)
      else '***'
    end,
    'emailMatches', coalesce(current_verified_email = lower(trim(i.email)), false)
  )
  into preview
  from public.invitations i
  join public.organisations o on o.id = i.organisation_id
  where i.token_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'),
      'hex'
    )
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and i.role <> 'owner'
  limit 1;

  return preview;
end;
$$;

revoke all on function public.invitation_preview(text) from public, service_role;
grant execute on function public.invitation_preview(text) to anon, authenticated;
