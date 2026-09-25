-- Record an operator's decision on a suggestion without editing the policy.
-- Legacy resolved threads retain a null decision and their existing audit history.
alter table public.policy_feedback_threads
  add column decision text check (decision in ('accepted', 'declined')),
  add column decision_rationale text,
  add column decided_at timestamptz,
  add column decided_by uuid references public.profiles(id),
  add constraint policy_feedback_decision_consistent check (
    (decision is null and decision_rationale is null and decided_at is null and decided_by is null)
    or (
      decision is not null and status = 'resolved'
      and decision_rationale is not null
      and pg_catalog.char_length(decision_rationale) between 1 and 4000
      and decision_rationale = pg_catalog.btrim(decision_rationale)
      and decided_at is not null and decided_by is not null
    )
  );

-- Keep every explicit decision, including decisions later reopened. Portal
-- callers may read visible history but cannot insert, change, or erase it.
create table public.policy_feedback_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  thread_id uuid not null,
  decision text not null check (decision in ('accepted', 'declined')),
  rationale text not null check (pg_catalog.char_length(rationale) between 1 and 4000 and rationale = pg_catalog.btrim(rationale)),
  decided_at timestamptz not null,
  decided_by uuid not null references public.profiles(id),
  constraint policy_feedback_decisions_thread_tenant_fk foreign key (thread_id, organisation_id)
    references public.policy_feedback_threads(id, organisation_id) on delete cascade
);
create index policy_feedback_decisions_thread_idx
  on public.policy_feedback_decisions(thread_id, decided_at desc);
create trigger policy_feedback_decisions_immutable
before update or delete on public.policy_feedback_decisions
for each statement execute function public.reject_immutable_change('policy feedback decisions are immutable');
create trigger policy_feedback_decisions_audit
after insert on public.policy_feedback_decisions
for each row execute function public.capture_audit_event();

alter table public.policy_feedback_decisions enable row level security;
create policy policy_feedback_decisions_read on public.policy_feedback_decisions
for select to authenticated
using (
  public.is_organisation_member(policy_feedback_decisions.organisation_id)
  and exists (
    select 1 from public.policy_feedback_threads as thread
    where thread.id = policy_feedback_decisions.thread_id
      and thread.organisation_id = policy_feedback_decisions.organisation_id
  )
);
revoke all on public.policy_feedback_decisions from public, anon, authenticated;
grant select on public.policy_feedback_decisions to authenticated;

create function public.decide_policy_feedback(target_thread_id uuid, feedback_decision text, feedback_rationale text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_organisation_id uuid;
  thread_status text;
  clean_rationale text := pg_catalog.btrim(feedback_rationale);
  decision_time timestamptz := pg_catalog.clock_timestamp();
begin
  if feedback_decision is null or feedback_decision not in ('accepted', 'declined') then
    raise exception 'choose accept or decline' using errcode = '22023';
  end if;
  if clean_rationale is null or pg_catalog.char_length(clean_rationale) not between 1 and 4000 then
    raise exception 'a decision reason is required' using errcode = '22023';
  end if;
  if actor_id is null then
    raise exception 'only workspace operators can decide feedback' using errcode = '42501';
  end if;

  select thread.organisation_id, thread.status
  into target_organisation_id, thread_status
  from public.policy_feedback_threads as thread
  where thread.id = target_thread_id
  for update;
  if not found then
    raise exception 'feedback thread is not available' using errcode = '42501';
  end if;

  perform 1
  from public.memberships as membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = actor_id
    and membership.role in ('owner', 'admin')
  for share;
  if not found then
    raise exception 'only workspace operators can decide feedback' using errcode = '42501';
  end if;
  if thread_status <> 'open' then
    raise exception 'feedback thread is closed' using errcode = '22023';
  end if;

  update public.policy_feedback_threads
  set status = 'resolved', resolved_at = decision_time, resolved_by = actor_id,
      decision = feedback_decision, decision_rationale = clean_rationale,
      decided_at = decision_time, decided_by = actor_id
  where id = target_thread_id;
  insert into public.policy_feedback_decisions (
    organisation_id, thread_id, decision, rationale, decided_at, decided_by
  ) values (
    target_organisation_id, target_thread_id, feedback_decision, clean_rationale, decision_time, actor_id
  );
  return target_thread_id;
end;
$$;

-- Reopening an earlier decision clears the current decision but preserves the
-- old audit event; the operator may then make a new explicit decision.
create or replace function public.set_policy_feedback_status(target_thread_id uuid, resolved boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_organisation_id uuid;
begin
  if actor_id is null then
    raise exception 'only workspace operators can change feedback status' using errcode = '42501';
  end if;
  select thread.organisation_id into target_organisation_id
  from public.policy_feedback_threads as thread
  where thread.id = target_thread_id
  for update;
  if not found then
    raise exception 'feedback thread is not available' using errcode = '42501';
  end if;
  perform 1
  from public.memberships as membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = actor_id
    and membership.role in ('owner', 'admin')
  for share;
  if not found then
    raise exception 'only workspace operators can change feedback status' using errcode = '42501';
  end if;
  if resolved is distinct from false then
    raise exception 'close feedback with an explicit decision' using errcode = '22023';
  end if;
  update public.policy_feedback_threads
  set status = 'open', resolved_at = null, resolved_by = null,
      decision = null, decision_rationale = null, decided_at = null, decided_by = null
  where id = target_thread_id;
  return target_thread_id;
end;
$$;

alter function public.decide_policy_feedback(uuid,text,text) owner to postgres;
revoke all on function public.decide_policy_feedback(uuid,text,text) from public, anon, service_role;
grant execute on function public.decide_policy_feedback(uuid,text,text) to authenticated;
