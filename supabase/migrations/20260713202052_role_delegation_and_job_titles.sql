alter table public.memberships
  add column job_title text,
  add constraint memberships_job_title_length check (job_title is null or char_length(job_title) between 1 and 120);

alter table public.invitations
  add column job_title text,
  add constraint invitations_job_title_length check (job_title is null or char_length(job_title) between 1 and 120),
  add constraint invitations_cannot_grant_owner check (role <> 'owner') not valid;

create or replace function public.is_organisation_operator(target_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organisation_id = target_organisation_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_organisation_operator(uuid) from public;
revoke all on function public.is_organisation_operator(uuid) from anon;
grant execute on function public.is_organisation_operator(uuid) to authenticated;

drop policy memberships_update_owners on public.memberships;
create policy memberships_update_delegated on public.memberships
for update to authenticated
using (
  public.is_organisation_owner(organisation_id)
  or (public.is_organisation_operator(organisation_id) and role = 'member')
)
with check (
  public.is_organisation_owner(organisation_id)
  or (public.is_organisation_operator(organisation_id) and role = 'member')
);

drop policy memberships_delete_owners on public.memberships;
create policy memberships_delete_delegated on public.memberships
for delete to authenticated
using (
  public.is_organisation_owner(organisation_id)
  or (public.is_organisation_operator(organisation_id) and role = 'member')
);

drop policy invitations_select_owners on public.invitations;
create policy invitations_select_operators on public.invitations
for select to authenticated
using (public.is_organisation_operator(organisation_id));

drop policy invitations_insert_owners on public.invitations;
create policy invitations_insert_delegated on public.invitations
for insert to authenticated
with check (
  invited_by = (select auth.uid())
  and role <> 'owner'
  and (
    public.is_organisation_owner(organisation_id)
    or (public.is_organisation_operator(organisation_id) and role = 'member')
  )
);

drop policy invitations_delete_owners on public.invitations;
create policy invitations_delete_delegated on public.invitations
for delete to authenticated
using (
  public.is_organisation_owner(organisation_id)
  or (public.is_organisation_operator(organisation_id) and role = 'member')
);

create or replace function public.accept_invitation(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_row public.invitations;
  current_email text;
begin
  current_email := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  select * into invitation_row
  from public.invitations
  where token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'), 'hex')
    and accepted_at is null
    and expires_at > now()
    and role <> 'owner'
  for update;

  if not found or lower(invitation_row.email) <> current_email then
    raise exception 'invitation is invalid or expired' using errcode = '22023';
  end if;

  insert into public.memberships (organisation_id, user_id, role, job_title)
  values (invitation_row.organisation_id, (select auth.uid()), invitation_row.role, invitation_row.job_title)
  on conflict (organisation_id, user_id) do nothing;

  update public.invitations set accepted_at = now() where id = invitation_row.id;
  return invitation_row.organisation_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
