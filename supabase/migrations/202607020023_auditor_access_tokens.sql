-- Phase C4: time-boxed, read-only auditor share links. The raw token is NEVER
-- stored — only its sha256 hex hash (mirrors public.invitations.token_hash).
-- Only organisation owners may create / list / revoke. The token itself is
-- validated by the security-definer RPC in a later migration, not by RLS (an
-- unauthenticated visitor has no RLS identity).

create table public.auditor_access_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  token_hash text not null unique,
  label text not null default '' check (char_length(label) <= 160),
  audit_id uuid,
  framework text not null default 'ISO 27001:2022' check (char_length(framework) between 1 and 120),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint auditor_tokens_audit_tenant_fk foreign key (audit_id, organisation_id)
    references public.audits(id, organisation_id) on delete cascade
);
create index auditor_access_tokens_org_idx on public.auditor_access_tokens(organisation_id, expires_at);

create trigger auditor_access_tokens_audit after insert or update or delete on public.auditor_access_tokens
for each row execute function public.capture_audit_event();

-- Owner-only management. is_organisation_owner gates both tenant and role, so
-- regular members cannot see or manage tokens (mirrors inviteMember's owner-only
-- rule). Every verb is restricted to owners of the token's own organisation.
alter table public.auditor_access_tokens enable row level security;
create policy auditor_tokens_owner_select on public.auditor_access_tokens for select to authenticated
using (public.is_organisation_owner(organisation_id));
create policy auditor_tokens_owner_insert on public.auditor_access_tokens for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and created_by = (select auth.uid()));
create policy auditor_tokens_owner_update on public.auditor_access_tokens for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id));
create policy auditor_tokens_owner_delete on public.auditor_access_tokens for delete to authenticated
using (public.is_organisation_owner(organisation_id));

revoke all on public.auditor_access_tokens from anon, authenticated;
grant select, insert, update, delete on public.auditor_access_tokens to authenticated;
