-- Phase D1: post a "please re-accept" notification to every member of a policy's
-- organisation after a material edit. notifications has NO authenticated INSERT
-- grant (only the daily sweep's service role writes it), and request paths must
-- not use the service-role client. So this is a single security-definer RPC,
-- org-scoped inside its body (mirrors public.audit_view_for_token): it refuses
-- callers who are not members of the policy's org (42501) and dedups per day via
-- the notifications unique key. The definer (migration role) bypasses the missing
-- INSERT grant; the org scope keeps it tenant-safe.

create or replace function public.notify_policy_reaccept(target_policy_id uuid, note text default '')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  target_org uuid;
  policy_ref text;
  posted integer;
begin
  select organisation_id, reference into target_org, policy_ref
    from public.policies where id = target_policy_id;
  if target_org is null then
    return 0;
  end if;
  if not public.is_organisation_member(target_org) then
    raise exception 'not a member of the policy organisation' using errcode = '42501';
  end if;
  with recipients as (
    insert into public.notifications (organisation_id, user_id, kind, subject_type, subject_id, message, sweep_on)
    select target_org, m.user_id, 'policy_reaccept', 'policies', target_policy_id::text,
           pg_catalog.left('Policy ' || policy_ref || ' changed — please review and re-accept. ' || note, 500),
           current_date
    from public.memberships m
    where m.organisation_id = target_org
    on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing
    returning 1)
  select count(*)::integer into posted from recipients;
  return posted;
end;
$$;

revoke all on function public.notify_policy_reaccept(uuid, text) from public;
grant execute on function public.notify_policy_reaccept(uuid, text) to authenticated;
