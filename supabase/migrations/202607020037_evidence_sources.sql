-- B3.1: continuous evidence automation — owner-managed external sources.
-- Mirrors integration_connections (Phase D2): only organisation owners create /
-- list / update / revoke sources. config holds provider settings (e.g. GitHub
-- owner + repo, AWS account/region); access_token/refresh_token are dev/env for
-- now (Vault at go-live) and are NEVER selected by client-facing pages. unique
-- (id, organisation_id) is the composite-FK target for auto-collected evidence.

create type public.evidence_provider as enum ('google_workspace', 'github', 'aws');

create table public.evidence_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider public.evidence_provider not null,
  label text not null default '' check (char_length(label) <= 160),
  config jsonb not null default '{}'::jsonb,
  access_token text,
  refresh_token text,
  connected_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organisation_id),
  constraint evidence_sources_connector_tenant_fk foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id) on delete cascade
);
create index evidence_sources_org_idx on public.evidence_sources(organisation_id) where revoked_at is null;

create trigger evidence_sources_audit after insert or update or delete on public.evidence_sources
for each row execute function public.capture_audit_event();

alter table public.evidence_sources enable row level security;
create policy evidence_sources_owner_select on public.evidence_sources for select to authenticated
using (public.is_organisation_owner(organisation_id));
create policy evidence_sources_owner_insert on public.evidence_sources for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and connected_by = (select auth.uid()));
create policy evidence_sources_owner_update on public.evidence_sources for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id));
create policy evidence_sources_owner_delete on public.evidence_sources for delete to authenticated
using (public.is_organisation_owner(organisation_id));

revoke all on public.evidence_sources from anon, authenticated;
grant select, insert, update, delete on public.evidence_sources to authenticated;

-- Link auto-collected evidence back to its source and the provider's stable id
-- for that item. Manual evidence leaves both null (unaffected). The partial
-- unique lets Stage 2 re-collection upsert-by-external_ref instead of duplicating.
alter table public.evidence add column source_id uuid;
alter table public.evidence add column external_ref text
  check (external_ref is null or char_length(external_ref) <= 400);
alter table public.evidence add constraint evidence_source_tenant_fk
  foreign key (source_id, organisation_id)
  references public.evidence_sources(id, organisation_id) on delete set null (source_id);
create unique index evidence_source_external_ref_key on public.evidence(source_id, external_ref)
  where source_id is not null and external_ref is not null;
