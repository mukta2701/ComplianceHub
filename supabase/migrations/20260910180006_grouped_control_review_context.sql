-- Read-only grouped context. SECURITY INVOKER preserves the existing member
-- SELECT policies; these functions grant no operator/write authority.
create function public.load_control_review_history(target_organisation_id uuid, target_register_id uuid)
returns table(item_id uuid, total bigint, entries jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.is_organisation_member(target_organisation_id)
    or not exists(select 1 from public.soa_registers r where r.id=target_register_id and r.organisation_id=target_organisation_id) then
    raise exception using errcode='42501', message='control_review_unavailable';
  end if;
  return query
  with decisions as materialized (
    select i.id from public.soa_items i
    where i.soa_register_id=target_register_id and i.organisation_id=target_organisation_id
  ), ranked as (
    select d.id as decision_id,e.id,e.action,e.occurred_at,
      count(*) over (partition by d.id) as event_total,
      row_number() over (partition by d.id order by e.occurred_at desc,e.id desc) as position
    from decisions d join public.audit_events e on e.entity_id=d.id::text
      and e.entity_type='soa_items' and e.organisation_id=target_organisation_id
  )
  select d.id,coalesce(max(r.event_total),0)::bigint,
    coalesce(jsonb_agg(jsonb_build_object('id',r.id::text,'action',r.action,'occurred_at',r.occurred_at)
      order by r.occurred_at desc,r.id desc) filter (where r.position<=5),'[]'::jsonb)
  from decisions d left join ranked r on r.decision_id=d.id
  group by d.id order by d.id;
end;
$$;

create function public.load_control_review_tasks(target_organisation_id uuid, target_register_id uuid)
returns table(item_id uuid, total bigint, open_count bigint, entries jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.is_organisation_member(target_organisation_id)
    or not exists(select 1 from public.soa_registers r where r.id=target_register_id and r.organisation_id=target_organisation_id) then
    raise exception using errcode='42501', message='control_review_unavailable';
  end if;
  return query
  with decisions as materialized (
    select i.id,i.control_id from public.soa_items i
    where i.soa_register_id=target_register_id and i.organisation_id=target_organisation_id
  ), linked as (
    select distinct d.id as decision_id,t.id,t.title,t.status,t.due_on
    from decisions d join public.requirement_control_mappings m on m.requirement_id=d.control_id
    join public.tasks t on t.control_id=m.control_id and t.organisation_id=target_organisation_id
  ), ranked as (
    select l.*,count(*) over (partition by l.decision_id) as task_total,
      count(*) filter (where l.status in ('open','in_progress')) over (partition by l.decision_id) as open_total,
      row_number() over (partition by l.decision_id order by l.id) as position
    from linked l
  )
  select d.id,coalesce(max(r.task_total),0)::bigint,coalesce(max(r.open_total),0)::bigint,
    coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'status',r.status,'due_on',r.due_on)
      order by r.id) filter (where r.position<=20),'[]'::jsonb)
  from decisions d left join ranked r on r.decision_id=d.id
  group by d.id order by d.id;
end;
$$;

revoke all on function public.load_control_review_history(uuid,uuid) from public,anon;
revoke all on function public.load_control_review_tasks(uuid,uuid) from public,anon;
grant execute on function public.load_control_review_history(uuid,uuid) to authenticated;
grant execute on function public.load_control_review_tasks(uuid,uuid) to authenticated;
