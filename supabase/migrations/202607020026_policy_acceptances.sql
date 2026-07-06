-- Phase D1: per-member policy acceptance, version-stamped. accepted_version
-- records which version the member acknowledged; the roster compares it to the
-- policy's live version, so a material edit (version bump) invalidates prior
-- acceptances by construction (no delete). A member may only record their OWN
-- acceptance (user_id = auth.uid()); re-accept is an upsert on (policy_id, user_id).

create table public.policy_acceptances (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  policy_id uuid not null,
  user_id uuid not null,
  accepted_version integer not null check (accepted_version >= 1),
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (policy_id, user_id),
  constraint policy_acceptances_policy_tenant_fk foreign key (policy_id, organisation_id)
    references public.policies(id, organisation_id) on delete cascade,
  constraint policy_acceptances_user_tenant_fk foreign key (organisation_id, user_id)
    references public.memberships(organisation_id, user_id) on delete cascade
);
create index policy_acceptances_policy_idx on public.policy_acceptances(policy_id);

create trigger policy_acceptances_audit after insert or update or delete on public.policy_acceptances
for each row execute function public.capture_audit_event();

alter table public.policy_acceptances enable row level security;
create policy policy_acceptances_members_select on public.policy_acceptances for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy policy_acceptances_members_insert on public.policy_acceptances for insert to authenticated
with check (public.is_organisation_member(organisation_id) and user_id = (select auth.uid()));
create policy policy_acceptances_members_update on public.policy_acceptances for update to authenticated
using (public.is_organisation_member(organisation_id) and user_id = (select auth.uid()))
with check (public.is_organisation_member(organisation_id) and user_id = (select auth.uid()));
create policy policy_acceptances_members_delete on public.policy_acceptances for delete to authenticated
using (public.is_organisation_member(organisation_id) and user_id = (select auth.uid()));

revoke all on public.policy_acceptances from anon, authenticated;
grant select, insert, update, delete on public.policy_acceptances to authenticated;
