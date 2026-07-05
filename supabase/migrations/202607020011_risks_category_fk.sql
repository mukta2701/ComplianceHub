-- Phase B1: replace risks.category (free text) with a FK into risk_categories.
-- Backfill maps each existing free-text category to a seeded row by
-- case-insensitive name; any unmatched value becomes a new per-org category
-- so no data is lost, then the old column is dropped.

alter table public.risks add column category_id uuid;

-- Any free-text value that does not already match a seeded category becomes a
-- new category for that organisation (appended after existing positions).
-- Each distinct novel (organisation_id, category) pair must get a unique
-- position (unique(organisation_id, position) below): rank the novel
-- categories per organisation with row_number() (not dense_rank() inside a
-- correlated scalar subquery, which collapses to 1 for every row because the
-- ordering key is constant within each correlated invocation) and add that
-- rank to the organisation's current max position.
with novel_categories as (
  select distinct r.organisation_id, r.category
  from public.risks r
  where not exists (
    select 1 from public.risk_categories rc
    where rc.organisation_id = r.organisation_id and lower(rc.name) = lower(r.category)
  )
),
ranked_novel_categories as (
  select organisation_id, category,
    row_number() over (partition by organisation_id order by lower(category)) as rn
  from novel_categories
),
org_base_positions as (
  select organisation_id, coalesce(max(position), -1) as base_position
  from public.risk_categories
  group by organisation_id
)
insert into public.risk_categories (organisation_id, name, position)
select rnc.organisation_id, rnc.category, coalesce(obp.base_position, -1) + rnc.rn
from ranked_novel_categories rnc
left join org_base_positions obp on obp.organisation_id = rnc.organisation_id;

update public.risks r
set category_id = rc.id
from public.risk_categories rc
where rc.organisation_id = r.organisation_id and lower(rc.name) = lower(r.category);

alter table public.risks alter column category_id set not null;
alter table public.risks add constraint risks_category_tenant_fk
  foreign key (category_id, organisation_id)
  references public.risk_categories(id, organisation_id) on delete restrict;
alter table public.risks drop column category;
