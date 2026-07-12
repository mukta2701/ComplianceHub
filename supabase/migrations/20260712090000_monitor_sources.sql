-- Active monitoring (Phase 1): owner-managed monitored workplace tools. Mirrors
-- evidence_sources / integration_connections exactly (owner-only RLS, soft-revoke
-- via revoked_at, tokens dev/env for now — Vault at go-live — and NEVER selected
-- by client-facing pages). A monitor source is watched on a sub-daily cadence by
-- /api/cron/monitor, which runs a fixed set of compliance CHECKS against it.
-- Kept separate from integration_connections (ticketing) and evidence_sources
-- (freshness) so each cron only ever sees the connections it owns. config holds
-- the provider target (GitHub owner + repo). unique (id, organisation_id) is the
-- composite-FK target for monitoring_findings.

create type public.monitor_provider as enum ('github');

create table public.monitor_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider public.monitor_provider not null,
  label text not null default '' check (char_length(label) <= 160),
  config jsonb not null default '{}'::jsonb,
  access_token text,
  refresh_token text,
  connected_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organisation_id),
  constraint monitor_sources_connector_tenant_fk foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id) on delete cascade
);
create index monitor_sources_org_idx on public.monitor_sources(organisation_id) where revoked_at is null;

create trigger monitor_sources_audit after insert or update or delete on public.monitor_sources
for each row execute function public.capture_audit_event();

alter table public.monitor_sources enable row level security;
create policy monitor_sources_owner_select on public.monitor_sources for select to authenticated
using (public.is_organisation_owner(organisation_id));
create policy monitor_sources_owner_insert on public.monitor_sources for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and connected_by = (select auth.uid()));
create policy monitor_sources_owner_update on public.monitor_sources for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id));
create policy monitor_sources_owner_delete on public.monitor_sources for delete to authenticated
using (public.is_organisation_owner(organisation_id));

revoke all on public.monitor_sources from anon, authenticated;
grant select, insert, update, delete on public.monitor_sources to authenticated;

-- The monitor cron reads the token + config server-side to run checks.
grant select on public.monitor_sources to service_role;
