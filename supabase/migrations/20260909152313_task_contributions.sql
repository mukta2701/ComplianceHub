-- Narrow assigned-owner collaboration. Pending history from old assignments is
-- retained, but only the current assignment can submit/review active work.
alter table public.tasks add column assignment_revision bigint not null default 0 check (assignment_revision >= 0);
create function public.task_assignment_revision_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then new.assignment_revision := 0;
  else new.assignment_revision := old.assignment_revision + case when new.owner_id is distinct from old.owner_id then 1 else 0 end;
  end if;
  return new;
end $$;
create trigger task_assignment_revision_guard before insert or update on public.tasks
for each row execute function public.task_assignment_revision_guard();
revoke all on function public.task_assignment_revision_guard() from public, anon, authenticated;

create table public.task_contributions (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  task_id uuid not null,
  submitter_id uuid not null references public.profiles(id),
  assignment_revision bigint not null check (assignment_revision >= 0),
  note text not null check (char_length(btrim(note)) between 1 and 10000),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  decision text not null default 'pending' check (decision in ('pending','accepted','changes_requested')),
  reviewer_id uuid references public.profiles(id),
  reviewed_at timestamptz,
  rationale text check (char_length(btrim(rationale)) between 1 and 2000),
  review_request_id uuid,
  evidence_id uuid,
  unique (submitter_id, request_id),
  unique (reviewer_id, review_request_id),
  foreign key (task_id, organisation_id) references public.tasks(id, organisation_id),
  foreign key (evidence_id, organisation_id) references public.evidence(id, organisation_id),
  check ((decision = 'pending' and reviewer_id is null and reviewed_at is null and rationale is null and review_request_id is null and evidence_id is null)
    or (decision <> 'pending' and reviewer_id is not null and reviewer_id <> submitter_id and reviewed_at is not null and rationale is not null and review_request_id is not null
      and ((decision = 'accepted' and evidence_id is not null) or (decision = 'changes_requested' and evidence_id is null))))
);
create unique index task_contributions_one_active_pending on public.task_contributions(task_id, assignment_revision) where decision = 'pending';
create index task_contributions_org_task_created on public.task_contributions(organisation_id, task_id, created_at desc);
alter table public.task_contributions enable row level security;
create policy task_contributions_members_read on public.task_contributions for select to authenticated
using (public.is_organisation_member(organisation_id));
revoke all on public.task_contributions from public, anon, authenticated, service_role;
grant select on public.task_contributions to authenticated;

create function public.task_contribution_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.decision <> 'pending' or
    (to_jsonb(new) - array['decision','reviewer_id','reviewed_at','rationale','review_request_id','evidence_id'])
      is distinct from (to_jsonb(old) - array['decision','reviewer_id','reviewed_at','rationale','review_request_id','evidence_id'])
    or new.decision = 'pending' then
    raise exception 'task contribution payload and completed reviews are immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger task_contribution_guard before update on public.task_contributions for each row execute function public.task_contribution_guard();
create trigger task_contributions_no_delete before delete on public.task_contributions for each statement execute function public.reject_immutable_change('task contributions are immutable');
create trigger task_contributions_audit after insert or update on public.task_contributions for each row execute function public.capture_audit_event();
revoke all on function public.task_contribution_guard() from public, anon, authenticated;

-- SECURITY DEFINER is necessary because Members have no direct task/evidence or
-- contribution writes. Every mutation derives actor from auth and locks live
-- membership before the task; no service credentials are used by the app.
create function public.submit_task_contribution(
  target_organisation_id uuid, target_task_id uuid, expected_assignment_revision bigint,
  submission_note text, submission_request_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); task public.tasks%rowtype; prior public.task_contributions%rowtype; result uuid;
  clean_note text := btrim(submission_note, E' \t\n\r\f');
begin
  if actor is null then raise exception 'current workspace membership required' using errcode = '42501'; end if;
  perform 1 from public.memberships where organisation_id = target_organisation_id and user_id = actor for share;
  if not found then raise exception 'current workspace membership required' using errcode = '42501'; end if;
  select * into task from public.tasks where id = target_task_id and organisation_id = target_organisation_id for update;
  if not found or task.owner_id is distinct from actor then raise exception 'only the current task assignee may submit' using errcode = '42501'; end if;
  if expected_assignment_revision is null or task.assignment_revision <> expected_assignment_revision then raise exception 'task assignment changed; reload the task' using errcode = 'PT409'; end if;
  if task.status not in ('open','in_progress') then raise exception 'task is closed' using errcode = 'PT409'; end if;
  if submission_request_id is null or clean_note is null or char_length(clean_note) not between 1 and 10000 then raise exception 'invalid contribution note or request id' using errcode = '22023'; end if;
  select * into prior from public.task_contributions where submitter_id = actor and request_id = submission_request_id;
  if found then
    if prior.organisation_id <> target_organisation_id or prior.task_id <> target_task_id or prior.assignment_revision <> expected_assignment_revision or prior.note <> clean_note then
      raise exception 'request id already used with different submission' using errcode = '22023';
    end if;
    return prior.id;
  end if;
  if exists (select 1 from public.task_contributions where task_id = task.id and assignment_revision = task.assignment_revision and decision = 'pending') then
    raise exception 'a contribution is already awaiting review for this assignment' using errcode = 'PT409';
  end if;
  insert into public.task_contributions(organisation_id,task_id,submitter_id,assignment_revision,note,request_id)
  values(target_organisation_id,task.id,actor,task.assignment_revision,clean_note,submission_request_id) returning id into result;
  return result;
end $$;

create function public.review_task_contribution(
  target_organisation_id uuid, target_contribution_id uuid, review_decision text,
  review_rationale text, review_request_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); contribution public.task_contributions%rowtype; task public.tasks%rowtype;
  evidence_uuid uuid; clean_rationale text := btrim(review_rationale, E' \t\n\r\f');
begin
  if actor is null then raise exception 'only an independent workspace operator may review' using errcode = '42501'; end if;
  select * into contribution from public.task_contributions where id = target_contribution_id and organisation_id = target_organisation_id;
  if not found then raise exception 'contribution not found in workspace' using errcode = '42501'; end if;
  -- SHARE locks prevent concurrent removal and role demotion through commit.
  perform 1 from public.memberships where organisation_id = target_organisation_id and user_id in (actor, contribution.submitter_id) order by user_id for share;
  if not public.is_organisation_operator(target_organisation_id) or actor = contribution.submitter_id then
    raise exception 'only an independent workspace operator may review' using errcode = '42501';
  end if;
  select * into task from public.tasks where id = contribution.task_id and organisation_id = target_organisation_id for update;
  if not found or task.owner_id is distinct from contribution.submitter_id or task.assignment_revision <> contribution.assignment_revision
    or not exists (select 1 from public.memberships where organisation_id = target_organisation_id and user_id = contribution.submitter_id) then
    raise exception 'task assignment changed; reload the task' using errcode = 'PT409';
  end if;
  if task.status not in ('open','in_progress') then raise exception 'task is closed' using errcode = 'PT409'; end if;
  if review_decision is null or review_decision not in ('accepted','changes_requested') or review_request_id is null or clean_rationale is null or char_length(clean_rationale) not between 1 and 2000 then
    raise exception 'invalid review decision, rationale or request id' using errcode = '22023';
  end if;
  select * into contribution from public.task_contributions where id = target_contribution_id for update;
  if contribution.review_request_id = review_task_contribution.review_request_id and contribution.reviewer_id = actor then
    if contribution.decision <> review_decision or contribution.rationale <> clean_rationale then raise exception 'request id already used with different review' using errcode = '22023'; end if;
    return contribution.id;
  end if;
  if contribution.decision <> 'pending' then raise exception 'contribution already reviewed' using errcode = 'PT409'; end if;
  if exists (select 1 from public.task_contributions c where c.reviewer_id = actor and c.review_request_id = review_task_contribution.review_request_id) then
    raise exception 'request id already used with different review' using errcode = '22023';
  end if;
  if review_decision = 'accepted' then
    -- Historical authorship stays on contribution; null owner avoids blocking
    -- offboarding through immutable evidence's membership foreign key.
    insert into public.evidence(organisation_id,title,kind,description,collected_on,status,created_by)
    values(target_organisation_id,left('Contribution: ' || task.title,200),'note',contribution.note,current_date,'current',actor) returning id into evidence_uuid;
    insert into public.evidence_links(organisation_id,evidence_id,task_id,created_by)
    values(target_organisation_id,evidence_uuid,task.id,actor);
  end if;
  update public.task_contributions set decision = review_decision, rationale = clean_rationale,
    reviewer_id = actor, reviewed_at = now(), review_request_id = review_task_contribution.review_request_id, evidence_id = evidence_uuid
  where id = contribution.id;
  return contribution.id;
end $$;
revoke all on function public.submit_task_contribution(uuid,uuid,bigint,text,uuid), public.review_task_contribution(uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.submit_task_contribution(uuid,uuid,bigint,text,uuid), public.review_task_contribution(uuid,uuid,text,text,uuid) to authenticated;
