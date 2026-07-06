-- Phase D1: policy register. A policy has an approval lifecycle (draft ->
-- in_review -> approved -> archived) and a version that a MATERIAL edit bumps
-- (server-side, Task 6). owner_id / approved_by are members of the same org
-- (composite tenant FKs into memberships). unique (id, organisation_id) is the
-- composite-FK target for policy_acceptances and evidence_links.policy_id.

create type public.policy_status as enum ('draft', 'in_review', 'approved', 'archived');

create table public.policies (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  reference text not null check (char_length(reference) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 100000),
  version integer not null default 1 check (version >= 1),
  status public.policy_status not null default 'draft',
  owner_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  review_due date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, reference),
  unique (id, organisation_id),
  constraint policies_owner_tenant_fk foreign key (organisation_id, owner_id)
    references public.memberships(organisation_id, user_id) on delete set null (owner_id),
  constraint policies_approver_tenant_fk foreign key (organisation_id, approved_by)
    references public.memberships(organisation_id, user_id) on delete set null (approved_by)
);
create index policies_org_status_idx on public.policies(organisation_id, status);

create trigger policies_audit after insert or update or delete on public.policies
for each row execute function public.capture_audit_event();

alter table public.policies enable row level security;
create policy policies_members_select on public.policies for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy policies_members_insert on public.policies for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy policies_members_update on public.policies for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy policies_members_delete on public.policies for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.policies from anon, authenticated;
grant select, insert, update, delete on public.policies to authenticated;
