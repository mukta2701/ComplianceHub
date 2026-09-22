-- Keep the incident lifecycle and recipients unchanged. Only the text shown
-- in Owner/Admin in-app notices changes; diagnostic codes remain internal.
create or replace function public.record_github_connection_notice_server(
  target_organisation_id uuid,
  target_installation_id uuid,
  target_kind text,
  target_diagnostic_code text,
  target_account_login text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  installation_organisation_id uuid;
  open_key text;
  incident_id uuid;
  is_new boolean := false;
  resolved_count integer := 0;
  resolved_ids uuid[];
  notified_user_ids uuid[] := '{}';
  notice_message text;
  notice_kind text;
begin
  if target_organisation_id is null
    or target_installation_id is null
    or target_kind not in ('incident', 'recovery')
    or (target_diagnostic_code is not null and target_diagnostic_code not in (
      'provider_rate_limited', 'provider_temporary_failure', 'installation_suspended',
      'installation_revoked', 'permission_mismatch', 'account_mismatch',
      'repository_unavailable', 'invalid_provider_response', 'internal_failure'
    ))
    or target_account_login is null
    or target_account_login !~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$'
  then
    raise exception 'invalid GitHub connection notice' using errcode = '22023';
  end if;

  select installation.organisation_id into installation_organisation_id
  from public.github_installations installation
  where installation.id = target_installation_id;

  if not found or installation_organisation_id <> target_organisation_id then
    raise exception 'GitHub installation belongs to another workspace'
      using errcode = '42501';
  end if;

  open_key := coalesce(target_diagnostic_code, 'unspecified');

  if target_kind = 'incident' then
    insert into public.github_connection_incidents(
      organisation_id, installation_id, incident_key, diagnostic_class, status,
      opened_at, last_observed_at
    ) values (
      target_organisation_id, target_installation_id, open_key,
      target_diagnostic_code, 'open', pg_catalog.now(), pg_catalog.now()
    )
    on conflict (organisation_id, installation_id, incident_key)
      where status = 'open'
      do update set last_observed_at = pg_catalog.now()
    returning id, (xmax = 0) into incident_id, is_new;

    if is_new then
      notice_kind := 'github_connection_incident';
      notice_message := case
          when target_diagnostic_code = 'provider_rate_limited'
            then 'GitHub monitoring delayed for '
          when target_diagnostic_code = 'repository_unavailable'
            then 'GitHub monitoring is incomplete for '
          else 'GitHub monitoring paused for '
        end || target_account_login || '. ' ||
        case target_diagnostic_code
          when 'provider_rate_limited' then
            'GitHub is temporarily limiting requests. ComplianceHub will try again. No action is needed now.'
          when 'provider_temporary_failure' then
            'ComplianceHub could not reach GitHub. It will try again.'
          when 'installation_suspended' then
            'The GitHub App is suspended. ComplianceHub cannot check the selected repositories. A workspace Owner must reactivate the App in GitHub.'
          when 'installation_revoked' then
            'GitHub access was removed. A workspace Owner must reconnect the App.'
          when 'permission_mismatch' then
            'The GitHub App is missing the required read-only permissions. A workspace Owner must review the App permissions in GitHub.'
          when 'account_mismatch' then
            'The App is connected to a different GitHub organisation. A workspace Owner must review the Connection.'
          when 'repository_unavailable' then
            'A selected repository is not available to the GitHub App. A workspace Owner must review repository access.'
          when 'invalid_provider_response' then
            'ComplianceHub could not read GitHub''s response. It will try again.'
          when 'internal_failure' then
            'ComplianceHub could not complete the GitHub check. A workspace Owner must review the Connection.'
          else
            'ComplianceHub cannot verify GitHub access. A workspace Owner must review the Connection.'
        end || ' Open Settings > Connections.';
      insert into public.notifications(organisation_id, user_id, kind, subject_type, subject_id, message)
      select target_organisation_id, membership.user_id, notice_kind, 'github_installation',
        target_installation_id::text, notice_message
      from public.memberships membership
      where membership.organisation_id = target_organisation_id
        and membership.role in ('owner', 'admin')
      on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing;
      select coalesce(pg_catalog.array_agg(notified.user_id), '{}') into notified_user_ids
      from (
        select membership.user_id
        from public.memberships membership
        join public.notifications notification
          on notification.organisation_id = membership.organisation_id
          and notification.user_id = membership.user_id
          and notification.kind = notice_kind
          and notification.subject_type = 'github_installation'
          and notification.subject_id = target_installation_id::text
          and notification.sweep_on = current_date
        where membership.organisation_id = target_organisation_id
          and membership.role in ('owner', 'admin')
      ) notified;
    end if;
  else
    with resolved as (
      update public.github_connection_incidents
      set status = 'resolved',
          resolved_at = pg_catalog.now()
      where organisation_id = target_organisation_id
        and installation_id = target_installation_id
        and status = 'open'
      returning id
    )
    select coalesce(pg_catalog.array_agg(resolved.id), '{}') into resolved_ids from resolved;
    resolved_count := coalesce(pg_catalog.array_length(resolved_ids, 1), 0);
    incident_id := resolved_ids[1];

    if resolved_count > 0 then
      is_new := true;
      notice_kind := 'github_connection_recovery';
      notice_message := 'GitHub monitoring restored for ' || target_account_login
        || '. GitHub access was verified again. Checks can resume. No action is needed. Open Settings > Connections.';
      insert into public.notifications(organisation_id, user_id, kind, subject_type, subject_id, message)
      select target_organisation_id, membership.user_id, notice_kind, 'github_installation',
        target_installation_id::text, notice_message
      from public.memberships membership
      where membership.organisation_id = target_organisation_id
        and membership.role in ('owner', 'admin')
      on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing;
      select coalesce(pg_catalog.array_agg(notified.user_id), '{}') into notified_user_ids
      from (
        select membership.user_id
        from public.memberships membership
        join public.notifications notification
          on notification.organisation_id = membership.organisation_id
          and notification.user_id = membership.user_id
          and notification.kind = notice_kind
          and notification.subject_type = 'github_installation'
          and notification.subject_id = target_installation_id::text
          and notification.sweep_on = current_date
        where membership.organisation_id = target_organisation_id
          and membership.role in ('owner', 'admin')
      ) notified;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'incident_id', incident_id,
    'is_new', is_new,
    'notified_user_ids', coalesce(to_jsonb(notified_user_ids), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.record_github_connection_notice_server(uuid, uuid, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.record_github_connection_notice_server(uuid, uuid, text, text, text)
to service_role;
