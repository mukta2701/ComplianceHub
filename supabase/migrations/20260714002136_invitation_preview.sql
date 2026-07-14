-- Invitation credentials are random 32-byte (256-bit) bearer tokens. The
-- fixed-shape check rejects malformed inputs before hashing; online guessing is
-- not a viable discovery strategy at this entropy, while application-layer
-- request controls can still limit abuse and operational load.
create or replace function public.invitation_preview(raw_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  preview jsonb;
begin
  if raw_token is null or raw_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;

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
    'emailMatches', (select auth.uid()) is not null
      and lower(coalesce((select auth.jwt() ->> 'email'), '')) = lower(i.email)
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
