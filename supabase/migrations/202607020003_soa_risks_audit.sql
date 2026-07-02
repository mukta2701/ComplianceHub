create type public.soa_status as enum ('implemented', 'partial', 'planned', 'not_applicable');
create type public.risk_status as enum ('open', 'treating', 'accepted', 'closed');
create type public.risk_treatment as enum ('mitigate', 'avoid', 'transfer', 'accept');

create table public.soa_registers (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  assessment_session_id uuid not null references public.assessment_sessions(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  title text not null check (char_length(title) between 1 and 160),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, version)
);
create table public.soa_items (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  soa_register_id uuid not null references public.soa_registers(id) on delete cascade,
  control_code text not null,
  control_title text not null,
  applicable boolean not null default true,
  status public.soa_status not null default 'planned',
  justification text not null default '' check (char_length(justification) <= 10000),
  evidence text not null default '' check (char_length(evidence) <= 10000),
  position integer not null check (position >= 0),
  unique (soa_register_id, control_code), unique (soa_register_id, position),
  check ((applicable and status <> 'not_applicable') or (not applicable and status = 'not_applicable'))
);
create table public.soa_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  soa_register_id uuid not null references public.soa_registers(id) on delete restrict,
  assessment_session_id uuid not null references public.assessment_sessions(id) on delete restrict,
  catalogue_version_id uuid not null references public.catalogue_versions(id) on delete restrict,
  version integer not null check (version > 0),
  organisation_name text not null,
  title text not null,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  finalised_by uuid not null references public.profiles(id),
  finalised_at timestamptz not null default now(),
  unique (organisation_id, version), unique (soa_register_id)
);

create table public.risks (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  reference text not null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null check (char_length(description) between 1 and 10000),
  category text not null check (char_length(category) between 1 and 120),
  owner_id uuid references public.profiles(id) on delete set null,
  likelihood smallint not null check (likelihood between 1 and 5),
  impact smallint not null check (impact between 1 and 5),
  treatment public.risk_treatment not null,
  treatment_plan text not null default '' check (char_length(treatment_plan) <= 10000),
  residual_likelihood smallint not null check (residual_likelihood between 1 and 5),
  residual_impact smallint not null check (residual_impact between 1 and 5),
  review_date date,
  status public.risk_status not null default 'open',
  evidence text not null default '' check (char_length(evidence) <= 10000),
  source_assessment_session_id uuid references public.assessment_sessions(id) on delete set null,
  source_soa_register_id uuid references public.soa_registers(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, reference)
);
create index risks_org_status_idx on public.risks(organisation_id, status, review_date);

create or replace function public.validate_soa_tenant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.assessment_sessions s
    where s.id = new.assessment_session_id and s.organisation_id = new.organisation_id
  ) then raise exception 'assessment and SoA must belong to the same organisation'; end if;
  return new;
end;
$$;
create trigger soa_registers_validate_tenant before insert or update on public.soa_registers
for each row execute function public.validate_soa_tenant();

create or replace function public.validate_risk_tenant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is not null and not exists (
    select 1 from public.memberships m where m.organisation_id = new.organisation_id and m.user_id = new.owner_id
  ) then raise exception 'risk owner must be an organisation member'; end if;
  if new.source_assessment_session_id is not null and not exists (
    select 1 from public.assessment_sessions s
    where s.id = new.source_assessment_session_id and s.organisation_id = new.organisation_id
  ) then raise exception 'source assessment must belong to the risk organisation'; end if;
  if new.source_soa_register_id is not null and not exists (
    select 1 from public.soa_registers r
    where r.id = new.source_soa_register_id and r.organisation_id = new.organisation_id
  ) then raise exception 'source SoA must belong to the risk organisation'; end if;
  return new;
end;
$$;
create trigger risks_validate_tenant before insert or update on public.risks
for each row execute function public.validate_risk_tenant();

create trigger soa_snapshots_immutable before update or delete on public.soa_snapshots
for each statement execute function public.reject_immutable_change('finalised SoA snapshots are immutable');

create or replace function public.finalise_soa(target_register_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid; register_row public.soa_registers; item_count integer;
begin
  select * into register_row from public.soa_registers where id = target_register_id for update;
  if not found or not public.is_organisation_member(register_row.organisation_id) then
    raise exception 'SoA register not found' using errcode = '42501';
  end if;
  select count(*) into item_count from public.soa_items where soa_register_id = target_register_id;
  if item_count = 0 then raise exception 'SoA must contain at least one item'; end if;
  if exists (select 1 from public.soa_items where soa_register_id = target_register_id and btrim(justification) = '') then
    raise exception 'Every SoA item requires a justification';
  end if;
  insert into public.soa_snapshots (
    organisation_id, soa_register_id, assessment_session_id, catalogue_version_id,
    version, organisation_name, title, items, finalised_by
  ) select r.organisation_id, r.id, r.assessment_session_id, s.catalogue_version_id,
    r.version, o.name, r.title,
    jsonb_agg(jsonb_build_object(
      'controlCode', i.control_code, 'controlTitle', i.control_title, 'applicable', i.applicable,
      'status', i.status, 'justification', i.justification, 'evidence', i.evidence
    ) order by i.position), (select auth.uid())
  from public.soa_registers r
  join public.organisations o on o.id = r.organisation_id
  join public.assessment_sessions s on s.id = r.assessment_session_id
  join public.soa_items i on i.soa_register_id = r.id
  where r.id = target_register_id
  group by r.organisation_id, r.id, r.assessment_session_id, s.catalogue_version_id, r.version, o.name, r.title
  returning id into result_id;
  return result_id;
end;
$$;
revoke all on function public.finalise_soa(uuid) from public;
grant execute on function public.finalise_soa(uuid) to authenticated;
revoke insert, update, delete on public.soa_snapshots from authenticated;

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
  record_id := coalesce(row_data ->> 'id', row_data ->> 'user_id');
  insert into public.audit_events (organisation_id, actor_id, action, entity_type, entity_id, metadata)
  values (org_id, (select auth.uid()), lower(tg_op), tg_table_name, record_id, '{}'::jsonb);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger assessment_sessions_audit after insert or update or delete on public.assessment_sessions
for each row execute function public.capture_audit_event();
create trigger assessment_responses_audit after insert or update or delete on public.assessment_responses
for each row execute function public.capture_audit_event();
create trigger organisations_audit after insert or update or delete on public.organisations
for each row execute function public.capture_audit_event();
create trigger memberships_audit after insert or update or delete on public.memberships
for each row execute function public.capture_audit_event();
create trigger invitations_audit after insert or update or delete on public.invitations
for each row execute function public.capture_audit_event();
create trigger soa_registers_audit after insert or update or delete on public.soa_registers
for each row execute function public.capture_audit_event();
create trigger soa_items_audit after insert or update or delete on public.soa_items
for each row execute function public.capture_audit_event();
create trigger soa_snapshots_audit after insert on public.soa_snapshots
for each row execute function public.capture_audit_event();
create trigger risks_audit after insert or update or delete on public.risks
for each row execute function public.capture_audit_event();

alter table public.soa_registers enable row level security;
alter table public.soa_items enable row level security;
alter table public.soa_snapshots enable row level security;
alter table public.risks enable row level security;
create policy soa_registers_members_all on public.soa_registers for all to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy soa_items_members_all on public.soa_items for all to authenticated
using (public.is_organisation_member(organisation_id)) with check (
  public.is_organisation_member(organisation_id) and exists (
    select 1 from public.soa_registers r where r.id = soa_register_id and r.organisation_id = organisation_id
  )
);
create policy soa_snapshots_members_select on public.soa_snapshots for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy soa_snapshots_members_insert on public.soa_snapshots for insert to authenticated
with check (public.is_organisation_member(organisation_id) and finalised_by = (select auth.uid()));
create policy risks_members_select on public.risks for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy risks_members_insert on public.risks for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy risks_members_update on public.risks for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy risks_members_delete on public.risks for delete to authenticated
using (public.is_organisation_member(organisation_id));

-- PostgreSQL privileges are the outer gate; RLS policies above remain the
-- row-level gate. Grant only the operations each browser-facing workflow uses.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.organisations to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
grant select on public.audit_events to authenticated;
grant select on public.catalogue_versions, public.catalogue_categories, public.catalogue_questions to authenticated;
grant select, insert, delete on public.assessment_sessions to authenticated;
grant select on public.assessment_responses to authenticated;
grant select, insert, update, delete on public.soa_registers, public.soa_items, public.risks to authenticated;
grant select on public.soa_snapshots to authenticated;
