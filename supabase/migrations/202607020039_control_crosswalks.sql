-- Phase B5: org-owned multi-framework control crosswalk. ISO 27001 is the base
-- (public.controls is the shared control library); an organisation records how
-- THEIR controls map to another framework's requirement. These are the
-- organisation's own compliance interpretation — we deliberately do NOT seed
-- authoritative cross-framework mappings (a wrong mapping = false coverage
-- confidence, a real compliance harm). Only the framework catalogue is fixed.
--
-- Coverage is derived (not stored): a framework requirement counts as covered
-- when a mapped control's SoA status is implemented.

-- The frameworks an organisation may map TO. Identifiers only, not mapping
-- claims. ISO 27001 is the base library and so is intentionally absent here.
create type public.compliance_framework as enum
  ('soc_2', 'gdpr', 'hipaa', 'nist_csf', 'iso_27017');

create table public.control_crosswalks (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  -- controls are GLOBAL (not tenant-scoped), so a plain FK to controls(id).
  control_id uuid not null references public.controls(id),
  framework public.compliance_framework not null,
  -- the other framework's clause identifier, e.g. "CC6.1".
  external_ref text not null check (char_length(external_ref) between 1 and 80),
  note text check (char_length(note) <= 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  -- kept for convention/parity with other tenant tables; control_id is global.
  unique (id, organisation_id),
  -- no duplicate mapping of the same control to the same framework requirement.
  unique (organisation_id, control_id, framework, external_ref)
);
create index control_crosswalks_org_framework_idx
  on public.control_crosswalks(organisation_id, framework);

create trigger control_crosswalks_audit after insert or update or delete on public.control_crosswalks
for each row execute function public.capture_audit_event();

alter table public.control_crosswalks enable row level security;
-- Member split RLS: recording a mapping is normal compliance work (not
-- owner-only). All four verbs gate on organisation membership; INSERT also
-- pins created_by to the acting user.
create policy control_crosswalks_members_select on public.control_crosswalks for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy control_crosswalks_members_insert on public.control_crosswalks for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy control_crosswalks_members_update on public.control_crosswalks for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy control_crosswalks_members_delete on public.control_crosswalks for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.control_crosswalks from anon, authenticated;
grant select, insert, update, delete on public.control_crosswalks to authenticated;
