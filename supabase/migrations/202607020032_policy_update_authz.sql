-- Phase D1 hardening: enforce policy approval / edit authorization at the DB, not
-- only in the server actions. policies has member-split RLS (any member may
-- UPDATE), so approvePolicyAction / setPolicyStatusAction / updatePolicyAction's
-- owner gates were bypassable by a member calling PostgREST directly with the
-- anon key and their own session JWT. For an ISO 27001 ISMS, "management approved
-- this policy" is an audited control — a member forging approval, or silently
-- editing the body without bumping the version (which would skip the re-accept
-- notification), must be impossible at the data layer. This BEFORE UPDATE trigger
-- mirrors the actions exactly: approval/status columns are owner-only; content and
-- version changes are limited to a workspace owner or the policy's own owner.

create or replace function public.enforce_policy_update_authz()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Approval is an owner-only control: only workspace owners may change the
  -- lifecycle status or the approval stamp (mirrors approvePolicyAction /
  -- setPolicyStatusAction).
  if (new.status is distinct from old.status
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at)
     and not public.is_organisation_owner(old.organisation_id) then
    raise exception 'only workspace owners can change a policy''s approval or status'
      using errcode = '42501';
  end if;
  -- Content/version edits are limited to a workspace owner or the policy's own
  -- owner (mirrors updatePolicyAction), so a member cannot edit the body or bump
  -- the version outside the sanctioned material-edit + re-accept flow.
  if (new.body is distinct from old.body
      or new.version is distinct from old.version
      or new.reference is distinct from old.reference
      or new.title is distinct from old.title
      or new.review_due is distinct from old.review_due)
     and not public.is_organisation_owner(old.organisation_id)
     and old.owner_id is distinct from (select auth.uid()) then
    raise exception 'only workspace owners or the policy owner can edit this policy'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger policies_enforce_update_authz before update on public.policies
for each row execute function public.enforce_policy_update_authz();
