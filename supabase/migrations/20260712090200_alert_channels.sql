-- Active monitoring (Phase 1): outbound alert channels. When a finding at or above
-- a channel's min_severity is raised, the monitor cron delivers it here. Owner-only
-- RLS (mirrors monitor_sources). config holds the delivery secret — {webhookUrl}
-- for slack — treated exactly like access_token: NEVER selected by client-facing
-- pages, read server-side in the cron only. type 'in_app' needs no secret (it
-- writes a notifications row); 'whatsapp' is a Phase 2 stub. min_severity reuses
-- the monitor_severity scale from 20260712090100.

create type public.alert_channel_type as enum ('slack', 'whatsapp', 'in_app');

create table public.alert_channels (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  type public.alert_channel_type not null,
  label text not null default '' check (char_length(label) <= 160),
  config jsonb not null default '{}'::jsonb,
  min_severity public.monitor_severity not null default 'high',
  connected_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organisation_id),
  constraint alert_channels_connector_tenant_fk foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id) on delete cascade
);
create index alert_channels_org_idx on public.alert_channels(organisation_id) where revoked_at is null;

create trigger alert_channels_audit after insert or update or delete on public.alert_channels
for each row execute function public.capture_audit_event();

alter table public.alert_channels enable row level security;
create policy alert_channels_owner_select on public.alert_channels for select to authenticated
using (public.is_organisation_owner(organisation_id));
create policy alert_channels_owner_insert on public.alert_channels for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and connected_by = (select auth.uid()));
create policy alert_channels_owner_update on public.alert_channels for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id));
create policy alert_channels_owner_delete on public.alert_channels for delete to authenticated
using (public.is_organisation_owner(organisation_id));

revoke all on public.alert_channels from anon, authenticated;
grant select, insert, update, delete on public.alert_channels to authenticated;

-- The monitor cron reads the webhook + min_severity to deliver alerts.
grant select on public.alert_channels to service_role;
