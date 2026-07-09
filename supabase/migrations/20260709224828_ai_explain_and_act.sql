create type public.ai_suggestion_status as enum ('draft', 'accepted', 'dismissed', 'superseded');

create table public.ai_workspace_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  constraint ai_workspace_settings_editor_tenant_fk foreign key (organisation_id, updated_by)
    references public.memberships(organisation_id, user_id) on delete cascade
);

create table public.ai_suggestions (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  target_type text not null check (target_type in ('assessment_question', 'soa_item')),
  target_id text not null check (char_length(target_id) between 1 and 128),
  suggestion_type text not null check (suggestion_type in ('assessment_remediation', 'soa_rationale')),
  requester_id uuid not null,
  reviewer_id uuid,
  status public.ai_suggestion_status not null default 'draft',
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot) = 'object' and char_length(input_snapshot::text) <= 16000),
  output jsonb not null check (jsonb_typeof(output) = 'object' and char_length(output::text) <= 16000),
  source_references jsonb not null default '[]'::jsonb check (jsonb_typeof(source_references) = 'array' and char_length(source_references::text) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  constraint ai_suggestions_requester_tenant_fk foreign key (organisation_id, requester_id)
    references public.memberships(organisation_id, user_id) on delete cascade,
  constraint ai_suggestions_reviewer_tenant_fk foreign key (organisation_id, reviewer_id)
    references public.memberships(organisation_id, user_id) on delete set null
);
create index ai_suggestions_org_target_idx on public.ai_suggestions(organisation_id, target_type, target_id, created_at desc);

create or replace function public.enforce_ai_suggestion_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.reviewer_id is not null or new.requester_id <> (select auth.uid()) then
      raise exception 'AI suggestions must be created as requester-owned drafts' using errcode='42501';
    end if;
    return new;
  end if;
  if old.status <> 'draft'
     or new.status not in ('accepted', 'dismissed', 'superseded')
     or new.reviewer_id is distinct from (select auth.uid())
     or new.organisation_id is distinct from old.organisation_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.suggestion_type is distinct from old.suggestion_type
     or new.requester_id is distinct from old.requester_id
     or new.input_snapshot is distinct from old.input_snapshot
     or new.output is distinct from old.output
     or new.source_references is distinct from old.source_references
     or new.created_at is distinct from old.created_at then
    raise exception 'AI suggestion drafts can only be reviewed once' using errcode='42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger ai_suggestions_lifecycle before insert or update on public.ai_suggestions
for each row execute function public.enforce_ai_suggestion_lifecycle();
create trigger ai_suggestions_audit after insert or update or delete on public.ai_suggestions
for each row execute function public.capture_audit_event();
create trigger ai_workspace_settings_audit after insert or update or delete on public.ai_workspace_settings
for each row execute function public.capture_audit_event();

alter table public.ai_workspace_settings enable row level security;
alter table public.ai_suggestions enable row level security;
create policy ai_workspace_settings_select_members on public.ai_workspace_settings for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy ai_workspace_settings_insert_owners on public.ai_workspace_settings for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and updated_by = (select auth.uid()));
create policy ai_workspace_settings_update_owners on public.ai_workspace_settings for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id) and updated_by = (select auth.uid()));
create policy ai_suggestions_select_members on public.ai_suggestions for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy ai_suggestions_insert_requesters on public.ai_suggestions for insert to authenticated
with check (public.is_organisation_member(organisation_id) and requester_id = (select auth.uid()));
create policy ai_suggestions_update_requesters on public.ai_suggestions for update to authenticated
using (public.is_organisation_member(organisation_id) and requester_id = (select auth.uid()))
with check (public.is_organisation_member(organisation_id) and requester_id = (select auth.uid()));

revoke all on public.ai_workspace_settings, public.ai_suggestions from anon, authenticated;
grant select, insert, update on public.ai_workspace_settings to authenticated;
grant select, insert, update on public.ai_suggestions to authenticated;
