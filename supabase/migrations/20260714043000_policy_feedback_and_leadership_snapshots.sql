-- Tenant-safe policy collaboration and immutable leadership-report publication.

create table public.policy_feedback_threads (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  policy_id uuid not null,
  policy_version integer not null check (policy_version >= 1),
  author_id uuid not null references public.profiles(id),
  subject text not null check (char_length(subject) between 3 and 160 and subject = pg_catalog.btrim(subject)),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  unique (id, organisation_id),
  constraint policy_feedback_threads_policy_tenant_fk foreign key (policy_id, organisation_id)
    references public.policies(id, organisation_id) on delete cascade,
  constraint policy_feedback_threads_resolution_consistent check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status = 'resolved' and resolved_at is not null and resolved_by is not null)
  )
);

create table public.policy_feedback_comments (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  thread_id uuid not null,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000 and body = pg_catalog.btrim(body)),
  created_at timestamptz not null default now(),
  constraint policy_feedback_comments_thread_tenant_fk foreign key (thread_id, organisation_id)
    references public.policy_feedback_threads(id, organisation_id) on delete cascade
);

create index policy_feedback_threads_policy_idx
  on public.policy_feedback_threads(organisation_id, policy_id, created_at desc);
create index policy_feedback_comments_thread_idx
  on public.policy_feedback_comments(thread_id, created_at);

create trigger policy_feedback_comments_immutable
before update or delete on public.policy_feedback_comments
for each statement execute function public.reject_immutable_change('policy feedback comments are immutable');

create trigger policy_feedback_threads_audit
after insert or update on public.policy_feedback_threads
for each row execute function public.capture_audit_event();
create trigger policy_feedback_comments_audit
after insert on public.policy_feedback_comments
for each row execute function public.capture_audit_event();

alter table public.policy_feedback_threads enable row level security;
alter table public.policy_feedback_comments enable row level security;

create policy policy_feedback_threads_read on public.policy_feedback_threads
for select to authenticated
using (
  public.is_organisation_member(policy_feedback_threads.organisation_id)
  and exists (
    select 1 from public.policies as policy
    where policy.id = policy_feedback_threads.policy_id
      and policy.organisation_id = policy_feedback_threads.organisation_id
      and (public.is_organisation_operator(policy_feedback_threads.organisation_id) or policy.status = 'approved')
  )
);

create policy policy_feedback_comments_read on public.policy_feedback_comments
for select to authenticated
using (
  public.is_organisation_member(policy_feedback_comments.organisation_id)
  and
  exists (
    select 1 from public.policy_feedback_threads as thread
    where thread.id = policy_feedback_comments.thread_id
      and thread.organisation_id = policy_feedback_comments.organisation_id
  )
);

revoke all on public.policy_feedback_threads from public, anon, authenticated;
revoke all on public.policy_feedback_comments from public, anon, authenticated;
grant select on public.policy_feedback_threads, public.policy_feedback_comments to authenticated;

create or replace function public.create_policy_feedback(target_policy_id uuid, feedback_subject text, feedback_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_organisation_id uuid;
  target_version integer;
  target_status public.policy_status;
  clean_subject text := pg_catalog.btrim(feedback_subject);
  clean_body text := pg_catalog.btrim(feedback_body);
  new_thread_id uuid;
  event_time timestamptz := pg_catalog.clock_timestamp();
begin
  if actor_id is null then
    raise exception 'policy is not available for feedback' using errcode = '42501';
  end if;
  if clean_subject is null or pg_catalog.char_length(clean_subject) not between 3 and 160 then
    raise exception 'feedback subject must be between 3 and 160 characters' using errcode = '22023';
  end if;
  if clean_body is null or pg_catalog.char_length(clean_body) not between 1 and 4000 then
    raise exception 'feedback comment must be between 1 and 4000 characters' using errcode = '22023';
  end if;

  select policy.organisation_id, policy.version, policy.status
  into target_organisation_id, target_version, target_status
  from public.policies as policy
  where policy.id = target_policy_id
  for share;

  if not found then
    raise exception 'policy is not available for feedback' using errcode = '42501';
  end if;

  perform 1
  from public.memberships as membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = actor_id
  for share;

  if not found or target_status <> 'approved' then
    raise exception 'policy is not available for feedback' using errcode = '42501';
  end if;

  insert into public.policy_feedback_threads (
    organisation_id, policy_id, policy_version, author_id, subject, created_at
  ) values (
    target_organisation_id, target_policy_id, target_version, actor_id, clean_subject, event_time
  ) returning id into new_thread_id;

  insert into public.policy_feedback_comments (
    organisation_id, thread_id, author_id, body, created_at
  ) values (
    target_organisation_id, new_thread_id, actor_id, clean_body, event_time
  );

  return new_thread_id;
end;
$$;

create or replace function public.reply_policy_feedback(target_thread_id uuid, feedback_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_organisation_id uuid;
  thread_status text;
  policy_status public.policy_status;
  clean_body text := pg_catalog.btrim(feedback_body);
  new_comment_id uuid;
begin
  if clean_body is null or pg_catalog.char_length(clean_body) not between 1 and 4000 then
    raise exception 'feedback comment must be between 1 and 4000 characters' using errcode = '22023';
  end if;

  select thread.organisation_id, thread.status, policy.status
  into target_organisation_id, thread_status, policy_status
  from public.policy_feedback_threads as thread
  join public.policies as policy
    on policy.id = thread.policy_id and policy.organisation_id = thread.organisation_id
  where thread.id = target_thread_id
  for update of thread
  for share of policy;

  if not found then
    raise exception 'feedback thread is not available' using errcode = '42501';
  end if;

  perform 1
  from public.memberships as membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = actor_id
  for share;

  if not found or policy_status <> 'approved' then
    raise exception 'feedback thread is not available' using errcode = '42501';
  end if;
  if thread_status <> 'open' then
    raise exception 'feedback thread is closed' using errcode = '22023';
  end if;

  insert into public.policy_feedback_comments (organisation_id, thread_id, author_id, body)
  values (target_organisation_id, target_thread_id, actor_id, clean_body)
  returning id into new_comment_id;
  return new_comment_id;
end;
$$;

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
  if actor_id is null or not found then
    raise exception 'only workspace operators can change feedback status' using errcode = '42501';
  end if;

  update public.policy_feedback_threads
  set status = case when resolved then 'resolved' else 'open' end,
      resolved_at = case when resolved then pg_catalog.clock_timestamp() else null end,
      resolved_by = case when resolved then actor_id else null end
  where id = target_thread_id;
  return target_thread_id;
end;
$$;

alter function public.create_policy_feedback(uuid,text,text) owner to postgres;
alter function public.reply_policy_feedback(uuid,text) owner to postgres;
alter function public.set_policy_feedback_status(uuid,boolean) owner to postgres;
revoke all on function public.create_policy_feedback(uuid,text,text) from public, anon;
revoke all on function public.reply_policy_feedback(uuid,text) from public, anon;
revoke all on function public.set_policy_feedback_status(uuid,boolean) from public, anon;
grant execute on function public.create_policy_feedback(uuid,text,text) to authenticated;
grant execute on function public.reply_policy_feedback(uuid,text) to authenticated;
grant execute on function public.set_policy_feedback_status(uuid,boolean) to authenticated;

create or replace function public.is_valid_readiness_report(payload jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(payload) is distinct from 'object' then false
    when not (payload ?& array['soaPercent','soaTotal','riskBands','tasksOpen','tasksOverdue','evidence','openAudits','openNonConformities']) then false
    when payload - array['soaPercent','soaTotal','riskBands','tasksOpen','tasksOverdue','evidence','openAudits','openNonConformities'] <> '{}'::jsonb then false
    when pg_catalog.jsonb_typeof(payload->'riskBands') is distinct from 'object' then false
    when not (payload->'riskBands' ?& array['low','moderate','high','very_high']) then false
    when (payload->'riskBands') - array['low','moderate','high','very_high'] <> '{}'::jsonb then false
    when pg_catalog.jsonb_typeof(payload->'evidence') is distinct from 'object' then false
    when not (payload->'evidence' ?& array['total','expiring','expired']) then false
    when (payload->'evidence') - array['total','expiring','expired'] <> '{}'::jsonb then false
    when pg_catalog.jsonb_typeof(payload->'soaPercent') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload->'soaTotal') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload->'tasksOpen') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload->'tasksOverdue') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload->'openAudits') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload->'openNonConformities') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload#>'{riskBands,low}') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload#>'{riskBands,moderate}') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload#>'{riskBands,high}') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload#>'{riskBands,very_high}') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload#>'{evidence,total}') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload#>'{evidence,expiring}') is distinct from 'number'
      or pg_catalog.jsonb_typeof(payload#>'{evidence,expired}') is distinct from 'number'
    then false
    else
      pg_catalog.pg_column_size(payload) <= 8192
      and (payload->>'soaPercent')::numeric = pg_catalog.trunc((payload->>'soaPercent')::numeric)
      and (payload->>'soaPercent')::numeric between 0 and 100
      and (payload->>'soaTotal')::numeric = pg_catalog.trunc((payload->>'soaTotal')::numeric)
      and (payload->>'soaTotal')::numeric between 0 and 1000000
      and (payload->>'tasksOpen')::numeric = pg_catalog.trunc((payload->>'tasksOpen')::numeric)
      and (payload->>'tasksOpen')::numeric between 0 and 1000000
      and (payload->>'tasksOverdue')::numeric = pg_catalog.trunc((payload->>'tasksOverdue')::numeric)
      and (payload->>'tasksOverdue')::numeric between 0 and (payload->>'tasksOpen')::numeric
      and (payload->>'openAudits')::numeric = pg_catalog.trunc((payload->>'openAudits')::numeric)
      and (payload->>'openAudits')::numeric between 0 and 1000000
      and (payload->>'openNonConformities')::numeric = pg_catalog.trunc((payload->>'openNonConformities')::numeric)
      and (payload->>'openNonConformities')::numeric between 0 and 1000000
      and (payload#>>'{riskBands,low}')::numeric = pg_catalog.trunc((payload#>>'{riskBands,low}')::numeric)
      and (payload#>>'{riskBands,low}')::numeric between 0 and 1000000
      and (payload#>>'{riskBands,moderate}')::numeric = pg_catalog.trunc((payload#>>'{riskBands,moderate}')::numeric)
      and (payload#>>'{riskBands,moderate}')::numeric between 0 and 1000000
      and (payload#>>'{riskBands,high}')::numeric = pg_catalog.trunc((payload#>>'{riskBands,high}')::numeric)
      and (payload#>>'{riskBands,high}')::numeric between 0 and 1000000
      and (payload#>>'{riskBands,very_high}')::numeric = pg_catalog.trunc((payload#>>'{riskBands,very_high}')::numeric)
      and (payload#>>'{riskBands,very_high}')::numeric between 0 and 1000000
      and (payload#>>'{evidence,total}')::numeric = pg_catalog.trunc((payload#>>'{evidence,total}')::numeric)
      and (payload#>>'{evidence,total}')::numeric between 0 and 1000000
      and (payload#>>'{evidence,expiring}')::numeric = pg_catalog.trunc((payload#>>'{evidence,expiring}')::numeric)
      and (payload#>>'{evidence,expiring}')::numeric between 0 and 1000000
      and (payload#>>'{evidence,expired}')::numeric = pg_catalog.trunc((payload#>>'{evidence,expired}')::numeric)
      and (payload#>>'{evidence,expired}')::numeric between 0 and 1000000
      and (payload#>>'{evidence,expiring}')::numeric + (payload#>>'{evidence,expired}')::numeric <= (payload#>>'{evidence,total}')::numeric
  end;
$$;

revoke all on function public.is_valid_readiness_report(jsonb) from public, anon, authenticated;

create table public.leadership_report_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  organisation_name text not null check (char_length(organisation_name) between 1 and 200),
  payload jsonb not null check (public.is_valid_readiness_report(payload)),
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now()
);

create index leadership_report_snapshots_latest_idx
  on public.leadership_report_snapshots(organisation_id, published_at desc, id desc);

create trigger leadership_report_snapshots_immutable
before update or delete on public.leadership_report_snapshots
for each statement execute function public.reject_immutable_change('leadership report snapshots are immutable');
create trigger leadership_report_snapshots_audit
after insert on public.leadership_report_snapshots
for each row execute function public.capture_audit_event();

alter table public.leadership_report_snapshots enable row level security;
create policy leadership_report_snapshots_member_read on public.leadership_report_snapshots
for select to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.leadership_report_snapshots from public, anon, authenticated;
grant select on public.leadership_report_snapshots to authenticated;

create or replace function public.publish_leadership_report(target_organisation_id uuid, report_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  name_snapshot text;
  new_snapshot_id uuid;
begin
  perform 1
  from public.memberships as membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = actor_id
    and membership.role in ('owner', 'admin')
  for share;
  if actor_id is null or not found then
    raise exception 'only workspace operators can publish leadership reports' using errcode = '42501';
  end if;
  if not public.is_valid_readiness_report(report_payload) then
    raise exception 'invalid readiness report payload' using errcode = '22023';
  end if;

  select organisation.name into name_snapshot
  from public.organisations as organisation
  where organisation.id = target_organisation_id
  for share;
  if not found then
    raise exception 'only workspace operators can publish leadership reports' using errcode = '42501';
  end if;

  insert into public.leadership_report_snapshots (
    organisation_id, organisation_name, payload, published_by, published_at
  ) values (
    target_organisation_id, name_snapshot, report_payload, actor_id, pg_catalog.clock_timestamp()
  ) returning id into new_snapshot_id;
  return new_snapshot_id;
end;
$$;

alter function public.publish_leadership_report(uuid,jsonb) owner to postgres;
revoke all on function public.publish_leadership_report(uuid,jsonb) from public, anon;
grant execute on function public.publish_leadership_report(uuid,jsonb) to authenticated;
