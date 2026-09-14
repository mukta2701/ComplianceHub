-- Keep ordinary RLS and table privileges: these transactional helpers run as
-- the authenticated caller, never as an elevated service or definer role.
create function public.create_treatment_with_task(target_organisation_id uuid, plan_input jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  plan_id uuid;
  risk_id uuid := (plan_input->>'risk_id')::uuid;
  lead_id uuid := nullif(plan_input->>'assigned_lead_id','')::uuid;
  control_id uuid := nullif(plan_input->>'control_id','')::uuid;
  completion_date date := nullif(plan_input->>'target_completion','')::date;
  plan_status public.rtp_status := coalesce(plan_input->>'status','planned')::public.rtp_status;
begin
  if auth.uid() is null or not public.is_organisation_operator(target_organisation_id) then
    raise exception 'Workspace operator required' using errcode='42501';
  end if;
  if jsonb_typeof(plan_input) is distinct from 'object' then raise exception 'Invalid treatment plan'; end if;
  perform 1 from public.risks r where r.id=risk_id and r.organisation_id=target_organisation_id for key share;
  if not found then raise exception 'Risk not found' using errcode='42501'; end if;
  insert into public.risk_treatment_plans(organisation_id,risk_id,reference,summary,treatment_measures,control_id,assigned_lead_id,target_completion,status,actual_completion,created_by)
  values(target_organisation_id,risk_id,plan_input->>'reference',coalesce(plan_input->>'summary',''),coalesce(plan_input->>'treatment_measures',''),control_id,lead_id,completion_date,plan_status,
    case when plan_status='completed' then current_date else null end,auth.uid()) returning id into plan_id;
  if coalesce((plan_input->>'spawn_task')::boolean,false) then
    insert into public.tasks(organisation_id,title,detail,owner_id,due_on,source,control_id,risk_id,created_by)
    values(target_organisation_id,'Treatment plan '||(plan_input->>'reference'),coalesce(nullif(plan_input->>'treatment_measures',''),plan_input->>'summary',''),lead_id,completion_date,'risk_treatment',control_id,risk_id,auth.uid());
  end if;
  return plan_id;
end $$;
revoke all on function public.create_treatment_with_task(uuid,jsonb) from public,anon;
grant execute on function public.create_treatment_with_task(uuid,jsonb) to authenticated;

create function public.raise_finding_with_task(target_organisation_id uuid, finding_input jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  finding_id uuid;
  created_task_id uuid;
  target_audit uuid := (finding_input->>'audit_id')::uuid;
  target_item uuid := nullif(finding_input->>'checklist_item_id','')::uuid;
  correction text := coalesce(finding_input->>'corrective_action','');
begin
  if auth.uid() is null or not public.is_organisation_operator(target_organisation_id) then
    raise exception 'Workspace operator required' using errcode='42501';
  end if;
  if jsonb_typeof(finding_input) is distinct from 'object' then raise exception 'Invalid finding'; end if;
  perform 1 from public.audits a where a.id=target_audit and a.organisation_id=target_organisation_id for key share;
  if not found then raise exception 'Audit not found' using errcode='42501'; end if;
  if target_item is not null then
    perform 1 from public.audit_checklist_items i where i.id=target_item and i.audit_id=target_audit and i.organisation_id=target_organisation_id for key share;
    if not found then raise exception 'Checklist item not found' using errcode='42501'; end if;
  end if;
  insert into public.audit_findings(organisation_id,audit_id,checklist_item_id,summary,severity,root_cause,corrective_action,created_by)
  values(target_organisation_id,target_audit,target_item,finding_input->>'summary',coalesce(finding_input->>'severity','observation')::public.finding_severity,coalesce(finding_input->>'root_cause',''),correction,auth.uid()) returning id into finding_id;
  if coalesce((finding_input->>'spawn_task')::boolean,false) and correction <> '' then
    insert into public.tasks(organisation_id,title,detail,owner_id,due_on,source,created_by)
    values(target_organisation_id,left('Corrective action: '||(finding_input->>'summary'),200),correction,nullif(finding_input->>'owner_id','')::uuid,nullif(finding_input->>'due_on','')::date,'audit',auth.uid()) returning id into created_task_id;
    update public.audit_findings set task_id=created_task_id,status='in_progress' where id=finding_id and organisation_id=target_organisation_id;
  end if;
  return finding_id;
end $$;
revoke all on function public.raise_finding_with_task(uuid,jsonb) from public,anon;
grant execute on function public.raise_finding_with_task(uuid,jsonb) to authenticated;
