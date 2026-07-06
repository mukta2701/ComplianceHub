-- Phase D2: owner-managed ticketing connections (Jira / GitHub). Owner-only RLS
-- (mirrors auditor_access_tokens): only organisation owners create / list /
-- revoke connections. config holds provider settings (Jira project key + base
-- URL, or GitHub owner + repo); access_token/refresh_token are dev/env for now
-- (Vault at go-live) and are NEVER selected by client-facing pages. unique
-- (id, organisation_id) is the composite-FK target for task_tickets.

create type public.integration_provider as enum ('jira', 'github');

create table public.integration_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider public.integration_provider not null,
  label text not null default '' check (char_length(label) <= 160),
  config jsonb not null default '{}'::jsonb,
  access_token text,
  refresh_token text,
  connected_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organisation_id),
  constraint integration_connections_connector_tenant_fk foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id) on delete cascade
);
create index integration_connections_org_idx on public.integration_connections(organisation_id) where revoked_at is null;

create trigger integration_connections_audit after insert or update or delete on public.integration_connections
for each row execute function public.capture_audit_event();

alter table public.integration_connections enable row level security;
create policy integration_connections_owner_select on public.integration_connections for select to authenticated
using (public.is_organisation_owner(organisation_id));
create policy integration_connections_owner_insert on public.integration_connections for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and connected_by = (select auth.uid()));
create policy integration_connections_owner_update on public.integration_connections for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id));
create policy integration_connections_owner_delete on public.integration_connections for delete to authenticated
using (public.is_organisation_owner(organisation_id));

revoke all on public.integration_connections from anon, authenticated;
grant select, insert, update, delete on public.integration_connections to authenticated;
