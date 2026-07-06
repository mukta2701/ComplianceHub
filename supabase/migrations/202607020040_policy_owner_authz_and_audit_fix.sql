-- Pre-launch security review fixes.
--
-- (1) CRITICAL — close the policy owner_id-reassignment escalation. The policy
-- update-authz trigger (202607020032) gated content edits to a workspace owner OR
-- the policy's own owner, but did NOT guard the owner_id column. Because policies
-- have member-split RLS (any member may UPDATE), a non-owner member could, via
-- direct PostgREST, first reassign owner_id to themselves (no content/status
-- change, so the trigger stayed silent) and then edit the body (now old.owner_id =
-- auth.uid(), so the content guard passed) — silently rewriting any policy,
-- including an approved one, without the version bump + re-accept notification.
-- Fold owner_id reassignment into the same owner-or-policy-owner gate, so a member
-- who is neither cannot grab ownership.
--
-- (2) MINOR — restore the asset_id fallback in the shared audit function. The
-- Trust Center migration (202607020036) redefined capture_audit_event with
-- record_id := coalesce(id, user_id, organisation_id), which dropped the asset_id
-- arm that 202607020016 added for asset_risks (a link table with neither id nor
-- user_id). No crash (asset_risks has organisation_id), but every asset_risks
-- audit event recorded the org id instead of the asset id. Keep BOTH arms so
-- asset_risks records asset_id and trust_center_settings (org-id PK) records the
-- org id.

create or replace function public.enforce_policy_update_authz()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Approval / lifecycle status is a workspace-owner-only control.
  if (new.status is distinct from old.status
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at)
     and not public.is_organisation_owner(old.organisation_id) then
    raise exception 'only workspace owners can change a policy''s approval or status'
      using errcode = '42501';
  end if;
  -- Content/version edits AND owner reassignment are limited to a workspace owner
  -- or the policy's current owner. Guarding owner_id here blocks the escalation
  -- where a member grabs ownership to unlock the content edit.
  if (new.body is distinct from old.body
      or new.version is distinct from old.version
      or new.reference is distinct from old.reference
      or new.title is distinct from old.title
      or new.review_due is distinct from old.review_due
      or new.owner_id is distinct from old.owner_id)
     and not public.is_organisation_owner(old.organisation_id)
     and old.owner_id is distinct from (select auth.uid()) then
    raise exception 'only workspace owners or the policy owner can edit this policy or reassign its owner'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.capture_audit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; org_id uuid; record_id text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id := case tg_table_name
    when 'organisations' then (row_data ->> 'id')::uuid
    when 'assessment_responses' then (
      select organisation_id from public.assessment_sessions
      where id = (row_data ->> 'session_id')::uuid
    )
    when 'soa_items' then (
      select organisation_id from public.soa_registers
      where id = (row_data ->> 'soa_register_id')::uuid
    )
    else (row_data ->> 'organisation_id')::uuid
  end;
  -- id (most tables) -> user_id (memberships/profiles) -> asset_id (asset_risks)
  -- -> organisation_id (trust_center_settings). Covers every audited table.
  record_id := coalesce(row_data ->> 'id', row_data ->> 'user_id', row_data ->> 'asset_id', row_data ->> 'organisation_id');
  insert into public.audit_events (organisation_id, actor_id, action, entity_type, entity_id, metadata)
  values (org_id, (select auth.uid()), lower(tg_op), tg_table_name, record_id, '{}'::jsonb);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
