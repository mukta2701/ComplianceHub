create table public.organisation_scope_profiles (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  scope_statement text not null default '' check (char_length(scope_statement) <= 10000),
  services text not null default '' check (char_length(services) <= 10000),
  locations text not null default '' check (char_length(locations) <= 10000),
  information_types text not null default '' check (char_length(information_types) <= 10000),
  dependencies text not null default '' check (char_length(dependencies) <= 10000),
  exclusions text not null default '' check (char_length(exclusions) <= 10000),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  constraint organisation_scope_profiles_editor_tenant_fk foreign key (organisation_id, updated_by)
    references public.memberships(organisation_id, user_id) on delete cascade
);
create trigger organisation_scope_profiles_audit after insert or update or delete on public.organisation_scope_profiles
for each row execute function public.capture_audit_event();

alter table public.organisation_scope_profiles enable row level security;
create policy organisation_scope_profiles_select_members on public.organisation_scope_profiles for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy organisation_scope_profiles_insert_owners on public.organisation_scope_profiles for insert to authenticated
with check (public.is_organisation_owner(organisation_id) and updated_by = (select auth.uid()));
create policy organisation_scope_profiles_update_owners on public.organisation_scope_profiles for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id) and updated_by = (select auth.uid()));

revoke all on public.organisation_scope_profiles from anon, authenticated;
grant select, insert, update on public.organisation_scope_profiles to authenticated;
