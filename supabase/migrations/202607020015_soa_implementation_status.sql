-- Phase B2: adopt the toolkit's 7-value implementation status and add a
-- per-control owner. Mapping old -> new (reversible, documented):
--   implemented -> operational, partial -> in_progress,
--   planned -> pending, not_applicable -> not_applicable.

create type public.soa_implementation_status as enum
  ('pending', 'absent', 'in_progress', 'established', 'operational', 'advanced', 'not_applicable');

-- Drop the table-level applicable/status check (name is server-generated, so
-- discover it by definition) and the column default before retyping.
do $$
declare cname text;
begin
  select conname into cname from pg_constraint
  where conrelid = 'public.soa_items'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%applicable%not_applicable%';
  if cname is not null then execute format('alter table public.soa_items drop constraint %I', cname); end if;
end $$;
alter table public.soa_items alter column status drop default;

alter table public.soa_items alter column status type public.soa_implementation_status using (
  case status::text
    when 'implemented' then 'operational'
    when 'partial' then 'in_progress'
    when 'planned' then 'pending'
    when 'not_applicable' then 'not_applicable'
  end::public.soa_implementation_status
);
alter table public.soa_items alter column status set default 'pending';
alter table public.soa_items add constraint soa_items_applicable_status_check
  check ((applicable and status <> 'not_applicable') or (not applicable and status = 'not_applicable'));

-- Per-control owner (the "map controls into the company" requirement).
alter table public.soa_items add column owner_id uuid;
alter table public.soa_items add constraint soa_items_owner_tenant_fk
  foreign key (organisation_id, owner_id)
  references public.memberships(organisation_id, user_id) on delete set null (owner_id);

drop type public.soa_status;
