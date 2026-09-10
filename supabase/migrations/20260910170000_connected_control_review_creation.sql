-- The version sequence belongs to the organisation, not to one assessment.
create or replace function public.create_or_reuse_soa_review(target_assessment_session_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_org uuid;
  current_org uuid;
  result_id uuid;
  next_version integer;
  inserted_count integer;
  control_version constant uuid := '40000000-0000-4000-8000-000000000001'::uuid;
begin
  select organisation_id into target_org
  from public.assessment_sessions where id = target_assessment_session_id;
  if actor is null or target_org is null or not public.is_organisation_operator(target_org) then
    raise exception 'Assessment unavailable' using errcode = '42501';
  end if;

  -- Reuse the original draft/successor lock key across every assessment.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_org::text, 0));
  -- Permission or assessment scope may have changed while the lock waited.
  select organisation_id into current_org
  from public.assessment_sessions where id = target_assessment_session_id;
  if current_org is distinct from target_org or not public.is_organisation_operator(current_org) then
    raise exception 'Assessment unavailable' using errcode = '42501';
  end if;
  select r.id into result_id
  from public.soa_registers r
  where r.organisation_id = target_org and r.assessment_session_id = target_assessment_session_id
    and not exists (select 1 from public.soa_snapshots s where s.soa_register_id = r.id)
  order by r.updated_at desc, r.version desc, r.id desc limit 1;
  if result_id is not null then return result_id; end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.soa_registers where organisation_id = target_org;
  insert into public.soa_registers(organisation_id, assessment_session_id, control_catalogue_version_id, version, title, created_by)
  values (target_org, target_assessment_session_id, control_version, next_version, 'Statement of Applicability', actor)
  returning id into result_id;
  insert into public.soa_items(organisation_id, soa_register_id, control_catalogue_version_id, control_id, control_code, control_title, position)
  select target_org, result_id, c.catalogue_version_id, c.id, c.code, c.title, c.position - 1
  from public.control_catalogue_controls c where c.catalogue_version_id = control_version order by c.position;
  get diagnostics inserted_count = row_count;
  if inserted_count <> 93 then
    raise exception 'Control catalogue must contain 93 controls' using errcode = '23514';
  end if;
  return result_id;
end;
$$;

revoke all on function public.create_or_reuse_soa_review(uuid) from public, anon, service_role;
grant execute on function public.create_or_reuse_soa_review(uuid) to authenticated;

create or replace function public.create_or_reuse_soa_successor(source_register_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  source_row public.soa_registers;
  target_org uuid;
  result_id uuid;
  next_version integer;
  inserted_count integer;
begin
  select organisation_id into target_org from public.soa_registers where id = source_register_id;
  if actor is null or target_org is null or not public.is_organisation_operator(target_org) then
    raise exception 'Finalised statement unavailable' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_org::text, 0));
  -- Re-read provenance after waiting: the source may have been finalised while
  -- this call was blocked by another review creation in the organisation.
  select r.* into source_row
  from public.soa_registers r
  join public.soa_snapshots s on s.soa_register_id = r.id and s.organisation_id = r.organisation_id
  where r.id = source_register_id and r.organisation_id = target_org;
  if not found or not public.is_organisation_operator(target_org) then
    raise exception 'Finalised statement unavailable' using errcode = '42501';
  end if;
  select r.id into result_id
  from public.soa_registers r
  where r.organisation_id = source_row.organisation_id and r.assessment_session_id = source_row.assessment_session_id
    and not exists (select 1 from public.soa_snapshots s where s.soa_register_id = r.id)
  order by r.updated_at desc, r.version desc, r.id desc limit 1;
  if result_id is not null then return result_id; end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.soa_registers where organisation_id = source_row.organisation_id;
  insert into public.soa_registers(organisation_id, assessment_session_id, control_catalogue_version_id, version, title, created_by)
  values (source_row.organisation_id, source_row.assessment_session_id, source_row.control_catalogue_version_id, next_version, source_row.title, actor)
  returning id into result_id;
  -- Do not copy technical edit revisions: new rows use their initial defaults.
  insert into public.soa_items(organisation_id, soa_register_id, control_catalogue_version_id, control_id, control_code, control_title,
    applicable, status, justification, evidence, position, owner_id)
  select i.organisation_id, result_id, i.control_catalogue_version_id, i.control_id, i.control_code, i.control_title,
    i.applicable, i.status, i.justification, i.evidence, i.position, m.user_id
  from public.soa_items i
  left join public.memberships m on m.organisation_id = source_row.organisation_id and m.user_id = i.owner_id
  where i.soa_register_id = source_register_id and i.organisation_id = source_row.organisation_id
  order by i.position;
  get diagnostics inserted_count = row_count;
  if inserted_count <> 93 then
    raise exception 'Finalised statement must contain 93 controls' using errcode = '23514';
  end if;
  return result_id;
end;
$$;

revoke all on function public.create_or_reuse_soa_successor(uuid) from public, anon, service_role;
grant execute on function public.create_or_reuse_soa_successor(uuid) to authenticated;

-- Keep existing service-role maintenance grants; ordinary callers must use the atomic APIs.
revoke all on function public.create_soa_draft(uuid, text) from public, anon, authenticated;
revoke all on function public.create_soa_successor(uuid, text) from public, anon, authenticated;

-- A same-workspace operator must not bypass locking, reuse or decision seeding.
revoke insert on table public.soa_registers from public, anon, authenticated;
