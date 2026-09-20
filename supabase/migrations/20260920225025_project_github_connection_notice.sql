-- Project a GitHub connection incident or recovery into durable in-app and
-- Slack work in one transaction. A Slack queue failure rolls back the notice,
-- so a later bounded reconciliation can retry without losing the transition.
create or replace function public.project_github_connection_notice_server(
  target_organisation_id uuid,
  target_installation_id uuid,
  target_kind text,
  target_diagnostic_code text,
  target_account_login text,
  target_channel_id uuid,
  safe_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recorded jsonb;
  slack_queued boolean := false;
begin
  recorded := public.record_github_connection_notice_server(
    target_organisation_id,
    target_installation_id,
    target_kind,
    target_diagnostic_code,
    target_account_login
  );

  if coalesce((recorded ->> 'is_new')::boolean, false)
     and target_channel_id is not null then
    slack_queued := public.queue_github_connection_alert_delivery(
      target_organisation_id,
      target_channel_id,
      target_installation_id,
      target_kind,
      target_diagnostic_code,
      safe_payload
    );
  end if;

  return recorded || pg_catalog.jsonb_build_object('slack_queued', slack_queued);
end;
$$;

alter function public.project_github_connection_notice_server(
  uuid, uuid, text, text, text, uuid, jsonb
) owner to postgres;
revoke all on function public.project_github_connection_notice_server(
  uuid, uuid, text, text, text, uuid, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.project_github_connection_notice_server(
  uuid, uuid, text, text, text, uuid, jsonb
) to service_role;
