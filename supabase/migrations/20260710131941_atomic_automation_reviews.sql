create or replace function public.review_automation_proposal(
  target_proposal_id uuid,
  target_decision text,
  target_dismissal_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.automation_proposals%rowtype;
  actor_id uuid := (select auth.uid());
  draft_output jsonb;
begin
  if actor_id is null then
    raise exception 'An authenticated reviewer is required' using errcode = '42501';
  end if;
  if target_decision not in ('accepted', 'dismissed') then
    raise exception 'Invalid automation review decision' using errcode = '22023';
  end if;
  select * into proposal from public.automation_proposals where id = target_proposal_id for update;
  if not found
     or proposal.assigned_to <> actor_id
     or proposal.status <> 'draft'
     or not exists (select 1 from public.memberships where organisation_id = proposal.organisation_id and user_id = actor_id) then
    raise exception 'Automation proposal is not available to this reviewer' using errcode = '42501';
  end if;
  if target_decision = 'dismissed' and coalesce(btrim(target_dismissal_reason), '') = '' then
    raise exception 'A dismissal reason is required' using errcode = '22023';
  end if;

  draft_output := proposal.output;
  if target_decision = 'accepted' and proposal.target_type = 'evidence' then
    insert into public.evidence (organisation_id, title, kind, description, status, collected_on, created_by)
    values (
      proposal.organisation_id,
      coalesce(nullif(draft_output->>'title', ''), 'Accepted automation evidence'),
      'note',
      concat_ws(E'\n\n', nullif(draft_output->>'why', ''), 'Source provenance is retained on the accepted automation review.'),
      'current',
      current_date,
      actor_id
    );
  elsif target_decision = 'accepted' and proposal.target_type = 'task' then
    insert into public.tasks (organisation_id, title, detail, owner_id, source, created_by)
    values (
      proposal.organisation_id,
      coalesce(nullif(draft_output->>'title', ''), 'Review automation finding'),
      concat_ws(E'\n\n', nullif(draft_output->>'why', ''), nullif(draft_output->>'recommendedAction', ''), 'Source provenance is retained on the accepted automation review.'),
      proposal.assigned_to,
      'system',
      actor_id
    );
  end if;

  update public.automation_proposals
  set status = target_decision::public.automation_proposal_status,
      reviewer_id = actor_id,
      dismissal_reason = case when target_decision = 'dismissed' then btrim(target_dismissal_reason) else null end
  where id = proposal.id and organisation_id = proposal.organisation_id;

  if target_decision = 'accepted' then
    update public.source_objects
    set status = 'retained'
    where organisation_id = proposal.organisation_id
      and id in (select source_object_id from public.automation_proposal_sources where proposal_id = proposal.id and organisation_id = proposal.organisation_id);
  end if;
end;
$$;

revoke all on function public.review_automation_proposal(uuid, text, text) from public, anon;
grant execute on function public.review_automation_proposal(uuid, text, text) to authenticated;
