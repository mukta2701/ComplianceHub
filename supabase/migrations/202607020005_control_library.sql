-- §3a framework-agnostic control library. The existing control catalogue
-- (202607020004) becomes the ISO 27001:2022 framework's requirements;
-- evidence, tasks, and policies attach to the shared controls library.

create table public.frameworks (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  version text not null,
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '',
  control_catalogue_version_id uuid references public.control_catalogue_versions(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (slug, version)
);

create table public.requirements (
  id uuid primary key default extensions.gen_random_uuid(),
  framework_id uuid not null references public.frameworks(id) on delete restrict,
  code text not null,
  title text not null check (char_length(title) between 3 and 200),
  description text not null default '',
  position integer not null check (position > 0),
  unique (framework_id, code),
  unique (framework_id, position)
);

create table public.controls (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code ~ '^CH-[0-9]{3}$'),
  title text not null check (char_length(title) between 3 and 160),
  description text not null default '',
  position integer not null unique check (position > 0)
);

create table public.requirement_control_mappings (
  requirement_id uuid not null references public.requirements(id) on delete restrict,
  control_id uuid not null references public.controls(id) on delete restrict,
  rationale text not null default '',
  primary key (requirement_id, control_id)
);

insert into public.frameworks (id, slug, version, title, description, control_catalogue_version_id, published_at)
values ('50000000-0000-4000-8000-000000000001', 'iso-27001', '2022',
  'ISO/IEC 27001:2022 alignment',
  'Readiness framework aligned to the themes of ISO/IEC 27001:2022 using independently written control descriptions.',
  '40000000-0000-4000-8000-000000000001', now());

-- Requirements reuse the control catalogue UUIDs so assessment_control_mappings
-- rows can be joined onto requirements without data migration.
insert into public.requirements (id, framework_id, code, title, position)
select c.id, '50000000-0000-4000-8000-000000000001', c.code, c.title, c.position
from public.control_catalogue_controls c
where c.catalogue_version_id = '40000000-0000-4000-8000-000000000001';

-- Phase 1 seeds the shared library 1:1 from the ISO requirements; later
-- frameworks map onto these same controls (consolidation is a content task).
insert into public.controls (code, title, position)
select 'CH-' || lpad(c.position::text, 3, '0'), c.title, c.position
from public.control_catalogue_controls c
where c.catalogue_version_id = '40000000-0000-4000-8000-000000000001';

insert into public.requirement_control_mappings (requirement_id, control_id, rationale)
select r.id, k.id, 'Direct one-to-one seed from the 2022 catalogue.'
from public.requirements r
join public.controls k on k.position = r.position
where r.framework_id = '50000000-0000-4000-8000-000000000001';

create trigger frameworks_immutable before update or delete on public.frameworks
for each statement execute function public.reject_immutable_change('framework catalogues are immutable');
create trigger requirements_immutable before update or delete on public.requirements
for each statement execute function public.reject_immutable_change('framework requirements are immutable');
create trigger controls_immutable before update or delete on public.controls
for each statement execute function public.reject_immutable_change('shared controls are immutable');
create trigger requirement_control_mappings_immutable before update or delete on public.requirement_control_mappings
for each statement execute function public.reject_immutable_change('requirement control mappings are immutable');

alter table public.frameworks enable row level security;
alter table public.requirements enable row level security;
alter table public.controls enable row level security;
alter table public.requirement_control_mappings enable row level security;
create policy frameworks_read on public.frameworks for select to authenticated using (published_at is not null);
create policy requirements_read on public.requirements for select to authenticated
using (exists (select 1 from public.frameworks f where f.id = framework_id and f.published_at is not null));
create policy controls_read on public.controls for select to authenticated using (true);
create policy requirement_control_mappings_read on public.requirement_control_mappings for select to authenticated using (true);

revoke all on public.frameworks, public.requirements, public.controls, public.requirement_control_mappings from anon, authenticated;
grant select on public.frameworks, public.requirements, public.controls, public.requirement_control_mappings to authenticated;
