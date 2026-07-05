-- Phase B1: replace risks.category (free text) with a FK into risk_categories.
-- Backfill maps each existing free-text category to a seeded row by
-- case-insensitive name; any unmatched value becomes a new per-org category
-- so no data is lost, then the old column is dropped.

alter table public.risks add column category_id uuid;

-- Any free-text value that does not already match a seeded category becomes a
-- new category for that organisation (appended after existing positions).
insert into public.risk_categories (organisation_id, name, position)
select r.organisation_id, r.category,
  (select coalesce(max(rc.position), -1) + 1 + dense_rank() over (partition by r.organisation_id order by lower(r.category))
   from public.risk_categories rc where rc.organisation_id = r.organisation_id)
from (
  select distinct organisation_id, category from public.risks
) r
where not exists (
  select 1 from public.risk_categories rc
  where rc.organisation_id = r.organisation_id and lower(rc.name) = lower(r.category)
);

update public.risks r
set category_id = rc.id
from public.risk_categories rc
where rc.organisation_id = r.organisation_id and lower(rc.name) = lower(r.category);

alter table public.risks alter column category_id set not null;
alter table public.risks add constraint risks_category_tenant_fk
  foreign key (category_id, organisation_id)
  references public.risk_categories(id, organisation_id) on delete restrict;
alter table public.risks drop column category;
