-- Completion needs the session UPDATE privilege deliberately withheld from
-- authenticated clients. Keep the privileged implementation off the Data API.
create schema if not exists assessment_private;
revoke all on schema assessment_private from public, anon, authenticated;
grant usage on schema assessment_private to authenticated;

-- INSERT remains available to operators, so creation must not bypass the
-- answer validation and locking performed by the completion RPC.
create or replace function assessment_private.require_draft_assessment()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.state <> 'draft' or new.completed_at is not null then
    raise exception 'New assessments must start as drafts' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function assessment_private.require_draft_assessment() from public, anon, authenticated;
create trigger assessment_sessions_require_draft
  before insert on public.assessment_sessions
  for each row execute function assessment_private.require_draft_assessment();

create or replace function assessment_private.complete_assessment(
  target_organisation_id uuid, target_session_id uuid, expected_revision bigint
) returns bigint language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.membership_role;
  assessment public.assessment_sessions%rowtype;
begin
  if actor_id is null then
    raise exception 'Only workspace operators can complete assessments' using errcode = '42501';
  end if;
  -- Hold the membership while completing so concurrent offboarding or demotion
  -- cannot authorize a write after its role change commits.
  select role into actor_role from public.memberships
    where organisation_id = target_organisation_id and user_id = actor_id for share;
  if not found or actor_role not in ('owner', 'admin') then
    raise exception 'Only workspace operators can complete assessments' using errcode = '42501';
  end if;
  select * into assessment from public.assessment_sessions
    where id = target_session_id and organisation_id = target_organisation_id for update;
  if not found then
    raise exception 'Assessment not found in active workspace' using errcode = 'P0002';
  end if;
  if expected_revision is null or expected_revision < 0 or assessment.revision <> expected_revision then
    raise exception 'Assessment revision conflict' using errcode = '40001';
  end if;
  if assessment.state = 'completed' then return assessment.revision; end if;
  if not exists (select 1 from public.catalogue_questions where catalogue_version_id = assessment.catalogue_version_id)
    or exists (
      select 1 from public.catalogue_questions q
      where q.catalogue_version_id = assessment.catalogue_version_id
        and not exists (
          select 1 from public.assessment_responses r
          where r.session_id = assessment.id and r.organisation_id = assessment.organisation_id
            and r.question_id = q.id and r.answer is not null
        )
    ) then
    raise exception 'Answer every assessment question before completing' using errcode = '23514';
  end if;
  update public.assessment_sessions set state = 'completed', completed_at = now(), updated_at = now()
    where id = assessment.id and organisation_id = assessment.organisation_id;
  return assessment.revision;
end;
$$;
revoke all on function assessment_private.complete_assessment(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function assessment_private.complete_assessment(uuid, uuid, bigint) to authenticated;

create or replace function public.complete_assessment(
  target_organisation_id uuid, target_session_id uuid, expected_revision bigint
) returns bigint language sql security invoker set search_path = '' as $$
  select assessment_private.complete_assessment(target_organisation_id, target_session_id, expected_revision);
$$;
revoke all on function public.complete_assessment(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.complete_assessment(uuid, uuid, bigint) to authenticated;
