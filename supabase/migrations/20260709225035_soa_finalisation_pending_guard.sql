-- A pending implementation status means the organisation has not reviewed the
-- control yet. Immutable snapshots must not certify that incomplete review.
create or replace function public.finalise_soa(target_register_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; register_row public.soa_registers; item_count integer;
begin
  select * into register_row from public.soa_registers where id=target_register_id for update;
  if not found or not public.is_organisation_member(register_row.organisation_id) then raise exception 'SoA register not found' using errcode='42501'; end if;
  if exists(select 1 from public.soa_snapshots where soa_register_id=target_register_id) then raise exception 'SoA is already finalised' using errcode='23505'; end if;
  select count(*) into item_count from public.soa_items where soa_register_id=target_register_id;
  if item_count <> 93 then raise exception 'SoA must contain the complete 93-control catalogue'; end if;
  if exists(select 1 from public.soa_items where soa_register_id=target_register_id and applicable and status='pending') then raise exception 'Every applicable SoA item must be reviewed before finalisation'; end if;
  if exists(select 1 from public.soa_items where soa_register_id=target_register_id and btrim(justification)='') then raise exception 'Every SoA item requires a justification'; end if;
  insert into public.soa_snapshots(organisation_id,soa_register_id,assessment_session_id,catalogue_version_id,control_catalogue_version_id,version,organisation_name,title,items,finalised_by)
  select r.organisation_id,r.id,r.assessment_session_id,s.catalogue_version_id,r.control_catalogue_version_id,r.version,o.name,r.title,
    jsonb_agg(jsonb_build_object('controlCode',i.control_code,'controlTitle',i.control_title,'applicable',i.applicable,'status',i.status,'justification',i.justification,'evidence',i.evidence) order by i.position),(select auth.uid())
  from public.soa_registers r join public.organisations o on o.id=r.organisation_id join public.assessment_sessions s on s.id=r.assessment_session_id join public.soa_items i on i.soa_register_id=r.id
  where r.id=target_register_id group by r.organisation_id,r.id,r.assessment_session_id,s.catalogue_version_id,r.control_catalogue_version_id,r.version,o.name,r.title returning id into result_id;
  return result_id;
end $$;
revoke all on function public.finalise_soa(uuid) from public;
grant execute on function public.finalise_soa(uuid) to authenticated;
