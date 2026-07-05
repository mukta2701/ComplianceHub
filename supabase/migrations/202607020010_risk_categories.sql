-- Phase B1: per-workspace risk category taxonomy. Replaces the free-text
-- risks.category (migrated in 202607020011). Seeded with the toolkit's 7
-- distinct categories (the toolkit lists "Third-Party/Vendor Risk" twice —
-- deduped here). Members may add/rename their own categories.

create table public.risk_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name),
  unique (organisation_id, position),
  unique (id, organisation_id)
);
create index risk_categories_org_idx on public.risk_categories(organisation_id, position);

-- Default taxonomy applied to every organisation.
create or replace function public.seed_default_risk_categories()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.risk_categories (organisation_id, name, position)
  select new.id, d.name, d.position
  from (values
    ('Data Security', 0), ('Physical Security', 1), ('Compliance', 2),
    ('Access Control', 3), ('Network Security', 4), ('Operational', 5),
    ('Third-Party/Vendor Risk', 6)
  ) as d(name, position);
  return new;
end;
$$;
create trigger organisations_seed_risk_categories after insert on public.organisations
for each row execute function public.seed_default_risk_categories();

-- Backfill every organisation that already exists.
insert into public.risk_categories (organisation_id, name, position)
select o.id, d.name, d.position
from public.organisations o
cross join (values
  ('Data Security', 0), ('Physical Security', 1), ('Compliance', 2),
  ('Access Control', 3), ('Network Security', 4), ('Operational', 5),
  ('Third-Party/Vendor Risk', 6)
) as d(name, position);

create trigger risk_categories_audit after insert or update or delete on public.risk_categories
for each row execute function public.capture_audit_event();

alter table public.risk_categories enable row level security;
create policy risk_categories_members_select on public.risk_categories for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy risk_categories_members_insert on public.risk_categories for insert to authenticated
with check (public.is_organisation_member(organisation_id));
create policy risk_categories_members_update on public.risk_categories for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy risk_categories_members_delete on public.risk_categories for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.risk_categories from anon, authenticated;
grant select, insert, update, delete on public.risk_categories to authenticated;
