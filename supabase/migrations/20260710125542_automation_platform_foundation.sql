create type public.automation_area as enum ('identity', 'engineering', 'cloud', 'compliance');
create type public.connector_provider as enum ('google_workspace', 'github', 'aws', 'jira', 'linear');
create type public.connector_status as enum ('setup', 'connected', 'paused', 'error', 'revoked');
create type public.source_object_classification as enum ('metadata', 'document', 'ticket', 'attachment');
create type public.source_object_status as enum ('pending', 'retained', 'purged');
create type public.automation_confidence as enum ('low', 'medium', 'high');
create type public.automation_proposal_status as enum ('draft', 'accepted', 'dismissed', 'superseded');

create table public.connector_connections (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider public.connector_provider not null,
  label text not null default '' check (char_length(label) <= 160),
  granted_scopes jsonb not null default '[]'::jsonb check (jsonb_typeof(granted_scopes) = 'array'),
  selected_resources jsonb not null default '[]'::jsonb check (jsonb_typeof(selected_resources) = 'array'),
  consent jsonb not null check (jsonb_typeof(consent) = 'object'),
  retention_days integer not null default 30 check (retention_days between 1 and 3650),
  secret_reference text check (secret_reference is null or char_length(secret_reference) <= 500),
  status public.connector_status not null default 'setup',
  owner_id uuid not null,
  connected_by uuid not null,
  last_collected_at timestamptz,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, organisation_id),
  constraint connector_connections_owner_tenant_fk foreign key (organisation_id, owner_id)
    references public.memberships(organisation_id, user_id) on delete restrict,
  constraint connector_connections_editor_tenant_fk foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id) on delete restrict
);
create index connector_connections_org_status_idx on public.connector_connections(organisation_id, status);

create table public.automation_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  area public.automation_area not null,
  owner_id uuid not null,
  assigned_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, area),
  constraint automation_assignments_owner_tenant_fk foreign key (organisation_id, owner_id)
    references public.memberships(organisation_id, user_id) on delete cascade,
  constraint automation_assignments_editor_tenant_fk foreign key (organisation_id, assigned_by)
    references public.memberships(organisation_id, user_id) on delete restrict
);

create table public.collection_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  cursor text,
  collected_count integer not null default 0 check (collected_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  error_summary text check (error_summary is null or char_length(error_summary) <= 1000),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint collection_runs_connection_tenant_fk foreign key (connection_id, organisation_id)
    references public.connector_connections(id, organisation_id) on delete cascade
);
create index collection_runs_connection_created_idx on public.collection_runs(connection_id, created_at desc);

create table public.source_objects (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid not null,
  external_ref text not null check (char_length(external_ref) between 1 and 500),
  title text not null check (char_length(title) between 1 and 500),
  source_url text check (source_url is null or char_length(source_url) <= 2000),
  content_ref text not null check (char_length(content_ref) between 1 and 1000),
  content_hash text not null check (char_length(content_hash) between 1 and 256),
  classification public.source_object_classification not null,
  status public.source_object_status not null default 'pending',
  expires_at timestamptz not null,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (connection_id, external_ref),
  unique (id, organisation_id),
  constraint source_objects_connection_tenant_fk foreign key (connection_id, organisation_id)
    references public.connector_connections(id, organisation_id) on delete cascade
);
create index source_objects_org_retention_idx on public.source_objects(organisation_id, status, expires_at);

create table public.automation_signals (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid not null,
  source_object_id uuid,
  signal_type text not null check (signal_type ~ '^[a-z0-9_.-]{3,160}$'),
  summary text not null check (char_length(summary) between 1 and 2000),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  confidence public.automation_confidence not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (id, organisation_id),
  constraint automation_signals_connection_tenant_fk foreign key (connection_id, organisation_id)
    references public.connector_connections(id, organisation_id) on delete cascade,
  constraint automation_signals_source_tenant_fk foreign key (source_object_id, organisation_id)
    references public.source_objects(id, organisation_id) on delete set null (source_object_id)
);
create index automation_signals_org_created_idx on public.automation_signals(organisation_id, created_at desc);

create table public.automation_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  signal_type text not null check (signal_type ~ '^[a-z0-9_.-]{3,160}$'),
  version integer not null check (version > 0),
  target_type text not null check (target_type in ('evidence', 'scope_fact', 'assessment_answer', 'soa_rationale', 'risk', 'task')),
  rule jsonb not null check (jsonb_typeof(rule) = 'object'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, signal_type, version),
  unique (id, organisation_id)
);

create table public.automation_proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  signal_id uuid,
  rule_id uuid,
  target_type text not null check (target_type in ('evidence', 'scope_fact', 'assessment_answer', 'soa_rationale', 'risk', 'task')),
  target_id text check (target_id is null or char_length(target_id) <= 160),
  assigned_to uuid not null,
  created_by uuid not null,
  reviewer_id uuid,
  status public.automation_proposal_status not null default 'draft',
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object' and char_length(input_snapshot::text) <= 16000),
  output jsonb not null check (jsonb_typeof(output) = 'object' and char_length(output::text) <= 16000),
  source_references jsonb not null default '[]'::jsonb check (jsonb_typeof(source_references) = 'array' and char_length(source_references::text) <= 16000),
  dismissal_reason text check (dismissal_reason is null or char_length(dismissal_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  constraint automation_proposals_signal_tenant_fk foreign key (signal_id, organisation_id)
    references public.automation_signals(id, organisation_id) on delete set null (signal_id),
  constraint automation_proposals_rule_tenant_fk foreign key (rule_id, organisation_id)
    references public.automation_rules(id, organisation_id) on delete restrict,
  constraint automation_proposals_assignee_tenant_fk foreign key (organisation_id, assigned_to)
    references public.memberships(organisation_id, user_id) on delete restrict,
  constraint automation_proposals_creator_tenant_fk foreign key (organisation_id, created_by)
    references public.memberships(organisation_id, user_id) on delete restrict,
  constraint automation_proposals_reviewer_tenant_fk foreign key (organisation_id, reviewer_id)
    references public.memberships(organisation_id, user_id) on delete restrict
);
create index automation_proposals_inbox_idx on public.automation_proposals(organisation_id, assigned_to, status, created_at desc);

create table public.automation_proposal_sources (
  proposal_id uuid not null,
  source_object_id uuid not null,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (proposal_id, source_object_id),
  constraint automation_proposal_sources_proposal_tenant_fk foreign key (proposal_id, organisation_id)
    references public.automation_proposals(id, organisation_id) on delete cascade,
  constraint automation_proposal_sources_source_tenant_fk foreign key (source_object_id, organisation_id)
    references public.source_objects(id, organisation_id) on delete restrict
);

create or replace function public.enforce_automation_proposal_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.reviewer_id is not null or new.dismissal_reason is not null then
      raise exception 'Automation proposals must start as unreviewed drafts' using errcode = '42501';
    end if;
    return new;
  end if;
  if (select auth.uid()) is null
     or old.status <> 'draft'
     or new.status not in ('accepted', 'dismissed', 'superseded')
     or new.reviewer_id is distinct from (select auth.uid())
     or new.organisation_id is distinct from old.organisation_id
     or new.signal_id is distinct from old.signal_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.assigned_to is distinct from old.assigned_to
     or new.created_by is distinct from old.created_by
     or new.input_snapshot is distinct from old.input_snapshot
     or new.output is distinct from old.output
     or new.source_references is distinct from old.source_references
     or new.created_at is distinct from old.created_at
     or (new.status <> 'dismissed' and new.dismissal_reason is not null) then
    raise exception 'Automation proposals can only be reviewed once' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger automation_proposals_lifecycle before insert or update on public.automation_proposals
for each row execute function public.enforce_automation_proposal_lifecycle();

create or replace function public.enforce_automation_tenant_immutability()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'Automation records cannot move between organisations' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger connector_connections_tenant_immutable before update on public.connector_connections for each row execute function public.enforce_automation_tenant_immutability();
create trigger automation_assignments_tenant_immutable before update on public.automation_assignments for each row execute function public.enforce_automation_tenant_immutability();
create trigger automation_rules_tenant_immutable before update on public.automation_rules for each row execute function public.enforce_automation_tenant_immutability();

create trigger connector_connections_audit after insert or update or delete on public.connector_connections for each row execute function public.capture_audit_event();
create trigger automation_assignments_audit after insert or update or delete on public.automation_assignments for each row execute function public.capture_audit_event();
create trigger collection_runs_audit after insert or update or delete on public.collection_runs for each row execute function public.capture_audit_event();
create trigger source_objects_audit after insert or update or delete on public.source_objects for each row execute function public.capture_audit_event();
create trigger automation_signals_audit after insert or update or delete on public.automation_signals for each row execute function public.capture_audit_event();
create trigger automation_rules_audit after insert or update or delete on public.automation_rules for each row execute function public.capture_audit_event();
create trigger automation_proposals_audit after insert or update or delete on public.automation_proposals for each row execute function public.capture_audit_event();
create trigger automation_proposal_sources_audit after insert or update or delete on public.automation_proposal_sources for each row execute function public.capture_audit_event();

alter table public.connector_connections enable row level security;
alter table public.automation_assignments enable row level security;
alter table public.collection_runs enable row level security;
alter table public.source_objects enable row level security;
alter table public.automation_signals enable row level security;
alter table public.automation_rules enable row level security;
alter table public.automation_proposals enable row level security;
alter table public.automation_proposal_sources enable row level security;

create policy connector_connections_select_members on public.connector_connections for select to authenticated using (public.is_organisation_member(organisation_id));
create policy connector_connections_manage_owners on public.connector_connections for all to authenticated using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id) and connected_by = (select auth.uid()));
create policy automation_assignments_select_members on public.automation_assignments for select to authenticated using (public.is_organisation_member(organisation_id));
create policy automation_assignments_manage_owners on public.automation_assignments for all to authenticated using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id) and assigned_by = (select auth.uid()));
create policy collection_runs_select_members on public.collection_runs for select to authenticated using (public.is_organisation_member(organisation_id));
create policy source_objects_select_members on public.source_objects for select to authenticated using (public.is_organisation_member(organisation_id));
create policy automation_signals_select_members on public.automation_signals for select to authenticated using (public.is_organisation_member(organisation_id));
create policy automation_rules_select_members on public.automation_rules for select to authenticated using (organisation_id is null or public.is_organisation_member(organisation_id));
create policy automation_rules_insert_owners on public.automation_rules for insert to authenticated with check (public.is_organisation_owner(organisation_id));
create policy automation_proposals_select_members on public.automation_proposals for select to authenticated using (public.is_organisation_member(organisation_id));
create policy automation_proposals_update_reviewers on public.automation_proposals for update to authenticated
using (public.is_organisation_member(organisation_id) and assigned_to = (select auth.uid()))
with check (public.is_organisation_member(organisation_id) and assigned_to = (select auth.uid()) and reviewer_id = (select auth.uid()));
create policy automation_proposal_sources_select_members on public.automation_proposal_sources for select to authenticated using (public.is_organisation_member(organisation_id));

revoke all on public.connector_connections, public.automation_assignments, public.collection_runs, public.source_objects, public.automation_signals, public.automation_rules, public.automation_proposals, public.automation_proposal_sources from anon, authenticated, service_role;
grant select (id, organisation_id, provider, label, granted_scopes, selected_resources, consent, retention_days, status, owner_id, connected_by, last_collected_at, last_error_at, created_at, updated_at, revoked_at) on public.connector_connections to authenticated;
grant insert (id, organisation_id, provider, label, granted_scopes, selected_resources, consent, retention_days, status, owner_id, connected_by) on public.connector_connections to authenticated;
grant update (label, granted_scopes, selected_resources, consent, retention_days, status, owner_id, last_collected_at, last_error_at, updated_at, revoked_at) on public.connector_connections to authenticated;
grant delete on public.connector_connections to authenticated;
grant select, insert, update, delete on public.automation_assignments to authenticated;
grant select, insert on public.automation_rules to authenticated;
grant select on public.collection_runs, public.source_objects, public.automation_signals to authenticated;
grant select, update on public.automation_proposals to authenticated;
grant select on public.automation_proposal_sources to authenticated;
grant select, insert, update on public.connector_connections to service_role;
grant select on public.automation_assignments, public.automation_rules, public.automation_proposals, public.automation_proposal_sources to service_role;
grant select, insert, update on public.collection_runs, public.source_objects to service_role;
grant select, insert on public.automation_signals, public.automation_proposals, public.automation_proposal_sources to service_role;
revoke truncate on public.connector_connections, public.automation_assignments, public.collection_runs, public.source_objects, public.automation_signals, public.automation_rules, public.automation_proposals, public.automation_proposal_sources from service_role;
