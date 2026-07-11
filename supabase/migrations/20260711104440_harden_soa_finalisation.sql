-- Finalisation is authoritative in the database. The register and its review
-- rows are locked before validation so the immutable snapshot cannot race an
-- item update, and evidence freshness is checked in the same transaction.
create or replace function public.finalise_soa(target_register_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
  register_row public.soa_registers;
  item_count integer;
begin
  select *
  into register_row
  from public.soa_registers
  where id = target_register_id
  for update;

  if not found or not public.is_organisation_member(register_row.organisation_id) then
    raise exception 'SoA register not found' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.soa_snapshots where soa_register_id = target_register_id
  ) then
    raise exception 'SoA is already finalised' using errcode = '23505';
  end if;

  -- Prevent phantom item/evidence-link writes while the register is validated.
  -- Finalisation is infrequent and holds these locks only for this short RPC.
  lock table public.evidence_links, public.soa_items in share mode;

  perform item.id
  from public.soa_items as item
  where item.soa_register_id = target_register_id
    and item.organisation_id = register_row.organisation_id
  order by item.id
  for update;

  select count(*)
  into item_count
  from public.soa_items as item
  where item.soa_register_id = target_register_id
    and item.organisation_id = register_row.organisation_id;

  if item_count <> 93 then
    raise exception 'SoA must contain the complete 93-control catalogue';
  end if;

  if exists (
    select 1
    from public.soa_items as item
    where item.soa_register_id = target_register_id
      and item.organisation_id = register_row.organisation_id
      and item.status = 'pending'
  ) then
    raise exception 'SoA cannot be finalised: pending controls';
  end if;

  if exists (
    select 1
    from public.soa_items as item
    where item.soa_register_id = target_register_id
      and item.organisation_id = register_row.organisation_id
      and item.owner_id is null
  ) then
    raise exception 'SoA cannot be finalised: missing owners';
  end if;

  if exists (
    select 1
    from public.soa_items as item
    where item.soa_register_id = target_register_id
      and item.organisation_id = register_row.organisation_id
      and btrim(item.justification) = ''
  ) then
    raise exception 'SoA cannot be finalised: missing rationales';
  end if;

  -- Hold the linked evidence rows stable until this transaction has created the
  -- snapshot. Requirement mappings are immutable catalogue data.
  perform evidence.id
  from public.evidence as evidence
  where evidence.organisation_id = register_row.organisation_id
    and exists (
      select 1
      from public.evidence_links as link
      join public.requirement_control_mappings as mapping
        on mapping.control_id = link.control_id
      join public.soa_items as item
        on item.control_id = mapping.requirement_id
       and item.soa_register_id = target_register_id
       and item.organisation_id = register_row.organisation_id
       and item.applicable
      where link.evidence_id = evidence.id
        and link.organisation_id = register_row.organisation_id
    )
  order by evidence.id
  for share;

  if exists (
    select 1
    from public.soa_items as item
    join public.requirement_control_mappings as mapping
      on mapping.requirement_id = item.control_id
    join public.evidence_links as link
      on link.control_id = mapping.control_id
     and link.organisation_id = register_row.organisation_id
    join public.evidence as evidence
      on evidence.id = link.evidence_id
     and evidence.organisation_id = register_row.organisation_id
    where item.soa_register_id = target_register_id
      and item.organisation_id = register_row.organisation_id
      and item.applicable
      and evidence.status = 'expired'
  ) then
    raise exception 'SoA cannot be finalised: expired evidence';
  end if;

  if exists (
    select 1
    from public.soa_items as item
    where item.soa_register_id = target_register_id
      and item.organisation_id = register_row.organisation_id
      and item.applicable
      and not exists (
        select 1
        from public.requirement_control_mappings as mapping
        join public.evidence_links as link
          on link.control_id = mapping.control_id
         and link.organisation_id = register_row.organisation_id
        join public.evidence as evidence
          on evidence.id = link.evidence_id
         and evidence.organisation_id = register_row.organisation_id
        where mapping.requirement_id = item.control_id
          and evidence.status in ('current', 'expiring')
      )
  ) then
    raise exception 'SoA cannot be finalised: missing live evidence';
  end if;

  insert into public.soa_snapshots (
    organisation_id, soa_register_id, assessment_session_id, catalogue_version_id,
    control_catalogue_version_id, version, organisation_name, title, items, finalised_by
  )
  select
    register.organisation_id,
    register.id,
    register.assessment_session_id,
    session.catalogue_version_id,
    register.control_catalogue_version_id,
    register.version,
    organisation.name,
    register.title,
    jsonb_agg(jsonb_build_object(
      'controlCode', item.control_code,
      'controlTitle', item.control_title,
      'applicable', item.applicable,
      'status', item.status,
      'justification', item.justification,
      'evidence', item.evidence
    ) order by item.position),
    (select auth.uid())
  from public.soa_registers as register
  join public.organisations as organisation on organisation.id = register.organisation_id
  join public.assessment_sessions as session on session.id = register.assessment_session_id
  join public.soa_items as item
    on item.soa_register_id = register.id
   and item.organisation_id = register.organisation_id
  where register.id = target_register_id
    and register.organisation_id = register_row.organisation_id
  group by
    register.organisation_id,
    register.id,
    register.assessment_session_id,
    session.catalogue_version_id,
    register.control_catalogue_version_id,
    register.version,
    organisation.name,
    register.title
  returning id into result_id;

  return result_id;
end;
$$;

revoke all on function public.finalise_soa(uuid) from public;
grant execute on function public.finalise_soa(uuid) to authenticated;
