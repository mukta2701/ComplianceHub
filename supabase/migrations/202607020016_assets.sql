-- Phase B3: asset inventory. Classification (4) and Value (3) are independent,
-- uncombined enums (no derived score) — matches the toolkit exactly. Assets are
-- linkable to risks (many-to-many).

create type public.asset_classification as enum ('highly_confidential', 'confidential', 'internal_use_only', 'public');
create type public.asset_value as enum ('high', 'medium', 'low');

create table public.asset_categories (
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

create table public.assets (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  reference text not null check (char_length(reference) between 1 and 40),
  description text not null check (char_length(description) between 1 and 200),
  owner_location text not null default '' check (char_length(owner_location) <= 200),
  owner_id uuid,
  classification public.asset_classification not null default 'internal_use_only',
  value_criticality public.asset_value not null default 'medium',
  category_id uuid,
  security_controls text not null default '' check (char_length(security_controls) <= 10000),
  lifespan text not null default '' check (char_length(lifespan) <= 120),
  last_updated date,
  remarks text not null default '' check (char_length(remarks) <= 10000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, reference),
  unique (id, organisation_id),
  constraint assets_owner_tenant_fk foreign key (organisation_id, owner_id)
    references public.memberships(organisation_id, user_id) on delete set null (owner_id),
  constraint assets_category_tenant_fk foreign key (category_id, organisation_id)
    references public.asset_categories(id, organisation_id) on delete set null (category_id)
);
create index assets_org_idx on public.assets(organisation_id, classification, value_criticality);

create table public.asset_risks (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  asset_id uuid not null,
  risk_id uuid not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (asset_id, risk_id),
  constraint asset_risks_asset_tenant_fk foreign key (asset_id, organisation_id)
    references public.assets(id, organisation_id) on delete cascade,
  constraint asset_risks_risk_tenant_fk foreign key (risk_id, organisation_id)
    references public.risks(id, organisation_id) on delete cascade
);
create index asset_risks_risk_idx on public.asset_risks(organisation_id, risk_id);

-- Per-org category taxonomy (original en-GB wording, deduped/independent of the
-- toolkit's all-caps section headers).
create or replace function public.seed_default_asset_categories()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.asset_categories (organisation_id, name, position)
  select new.id, d.name, d.position
  from (values
    ('General', 0), ('Organisation', 1), ('Asset Management', 2),
    ('Human Resources', 3), ('Physical & Environmental', 4), ('Technology', 5)
  ) as d(name, position);
  return new;
end;
$$;
create trigger organisations_seed_asset_categories after insert on public.organisations
for each row execute function public.seed_default_asset_categories();

insert into public.asset_categories (organisation_id, name, position)
select o.id, d.name, d.position
from public.organisations o
cross join (values
  ('General', 0), ('Organisation', 1), ('Asset Management', 2),
  ('Human Resources', 3), ('Physical & Environmental', 4), ('Technology', 5)
) as d(name, position);

-- asset_risks is a composite-key link table with no `id`/`user_id` column, so the
-- canonical audit function's record_id coalesce would resolve to NULL and violate
-- audit_events.entity_id NOT NULL, aborting every link insert. Extend the shared
-- function to fall back to asset_id; existing tables all expose `id` and never
-- reach this branch, so the change is inert for them.
create or replace function public.capture_audit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; org_id uuid; record_id text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id := case tg_table_name
    when 'organisations' then (row_data ->> 'id')::uuid
    when 'assessment_responses' then (
      select organisation_id from public.assessment_sessions
      where id = (row_data ->> 'session_id')::uuid
    )
    when 'soa_items' then (
      select organisation_id from public.soa_registers
      where id = (row_data ->> 'soa_register_id')::uuid
    )
    else (row_data ->> 'organisation_id')::uuid
  end;
  record_id := coalesce(row_data ->> 'id', row_data ->> 'user_id', row_data ->> 'asset_id');
  insert into public.audit_events (organisation_id, actor_id, action, entity_type, entity_id, metadata)
  values (org_id, (select auth.uid()), lower(tg_op), tg_table_name, record_id, '{}'::jsonb);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger asset_categories_audit after insert or update or delete on public.asset_categories
for each row execute function public.capture_audit_event();
create trigger assets_audit after insert or update or delete on public.assets
for each row execute function public.capture_audit_event();
create trigger asset_risks_audit after insert or update or delete on public.asset_risks
for each row execute function public.capture_audit_event();

alter table public.asset_categories enable row level security;
alter table public.assets enable row level security;
alter table public.asset_risks enable row level security;

create policy asset_categories_members_select on public.asset_categories for select to authenticated using (public.is_organisation_member(organisation_id));
create policy asset_categories_members_insert on public.asset_categories for insert to authenticated with check (public.is_organisation_member(organisation_id));
create policy asset_categories_members_update on public.asset_categories for update to authenticated using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy asset_categories_members_delete on public.asset_categories for delete to authenticated using (public.is_organisation_member(organisation_id));

create policy assets_members_select on public.assets for select to authenticated using (public.is_organisation_member(organisation_id));
create policy assets_members_insert on public.assets for insert to authenticated with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy assets_members_update on public.assets for update to authenticated using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy assets_members_delete on public.assets for delete to authenticated using (public.is_organisation_member(organisation_id));

create policy asset_risks_members_select on public.asset_risks for select to authenticated using (public.is_organisation_member(organisation_id));
create policy asset_risks_members_insert on public.asset_risks for insert to authenticated with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy asset_risks_members_delete on public.asset_risks for delete to authenticated using (public.is_organisation_member(organisation_id));

revoke all on public.asset_categories, public.assets, public.asset_risks from anon, authenticated;
grant select, insert, update, delete on public.asset_categories, public.assets to authenticated;
grant select, insert, delete on public.asset_risks to authenticated;
