create type public.assessment_answer as enum ('yes', 'partially', 'no', 'not_applicable');
create type public.assessment_state as enum ('draft', 'completed');

create table public.catalogue_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  version text not null unique,
  title text not null,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.catalogue_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  catalogue_version_id uuid not null references public.catalogue_versions(id) on delete restrict,
  code text not null,
  title text not null,
  position integer not null check (position >= 0),
  unique (catalogue_version_id, code), unique (catalogue_version_id, position)
);
create table public.catalogue_questions (
  id uuid primary key default extensions.gen_random_uuid(),
  catalogue_version_id uuid not null references public.catalogue_versions(id) on delete restrict,
  category_id uuid not null references public.catalogue_categories(id) on delete restrict,
  code text not null,
  prompt text not null,
  guidance text not null default '',
  remediation text not null default '',
  weight numeric(5,2) not null default 1 check (weight > 0),
  position integer not null check (position >= 0),
  unique (catalogue_version_id, code), unique (category_id, position)
);

create table public.assessment_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  catalogue_version_id uuid not null references public.catalogue_versions(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 160),
  state public.assessment_state not null default 'draft',
  revision bigint not null default 0 check (revision >= 0),
  created_by uuid not null references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'completed') = (completed_at is not null))
);
create table public.assessment_responses (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  session_id uuid not null references public.assessment_sessions(id) on delete cascade,
  question_id uuid not null references public.catalogue_questions(id) on delete restrict,
  answer public.assessment_answer,
  evidence_note text not null default '' check (char_length(evidence_note) <= 10000),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (session_id, question_id)
);
create index assessment_sessions_org_idx on public.assessment_sessions(organisation_id, updated_at desc);
create index assessment_responses_session_idx on public.assessment_responses(session_id);

create trigger catalogue_versions_immutable before update or delete on public.catalogue_versions
for each statement execute function public.reject_immutable_change('catalogue versions are immutable');
create trigger catalogue_categories_immutable before update or delete on public.catalogue_categories
for each statement execute function public.reject_immutable_change('catalogue categories are immutable');
create trigger catalogue_questions_immutable before update or delete on public.catalogue_questions
for each statement execute function public.reject_immutable_change('catalogue questions are immutable');

create or replace function public.save_assessment_response(
  target_session_id uuid, target_question_id uuid, target_answer public.assessment_answer,
  target_evidence_note text, expected_revision bigint
) returns bigint language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; target_org uuid; target_catalogue uuid;
begin
  if char_length(coalesce(target_evidence_note, '')) > 10000 then raise exception 'evidence note is too long'; end if;
  select organisation_id, catalogue_version_id into target_org, target_catalogue
  from public.assessment_sessions where id = target_session_id;
  if not found or not public.is_organisation_member(target_org) then
    raise exception 'assessment not found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.catalogue_questions q
    where q.id = target_question_id and q.catalogue_version_id = target_catalogue
  ) then raise exception 'question does not belong to assessment catalogue'; end if;
  update public.assessment_sessions
    set revision = revision + 1, updated_at = now()
    where id = target_session_id and revision = expected_revision and state = 'draft'
    returning revision into current_revision;
  if not found then raise exception 'assessment revision conflict' using errcode = '40001'; end if;
  insert into public.assessment_responses (organisation_id, session_id, question_id, answer, evidence_note, updated_by)
  values (target_org, target_session_id, target_question_id, target_answer, coalesce(target_evidence_note, ''), (select auth.uid()))
  on conflict (session_id, question_id) do update set answer = excluded.answer,
    evidence_note = excluded.evidence_note, updated_by = excluded.updated_by, updated_at = now();
  return current_revision;
end;
$$;
revoke all on function public.save_assessment_response(uuid, uuid, public.assessment_answer, text, bigint) from public;
grant execute on function public.save_assessment_response(uuid, uuid, public.assessment_answer, text, bigint) to authenticated;
revoke update on public.assessment_sessions from authenticated;
revoke insert, update, delete on public.assessment_responses from authenticated;

alter table public.catalogue_versions enable row level security;
alter table public.catalogue_categories enable row level security;
alter table public.catalogue_questions enable row level security;
alter table public.assessment_sessions enable row level security;
alter table public.assessment_responses enable row level security;
create policy catalogue_versions_read on public.catalogue_versions for select to authenticated using (published_at is not null);
create policy catalogue_categories_read on public.catalogue_categories for select to authenticated using (exists (select 1 from public.catalogue_versions v where v.id = catalogue_version_id and v.published_at is not null));
create policy catalogue_questions_read on public.catalogue_questions for select to authenticated using (exists (select 1 from public.catalogue_versions v where v.id = catalogue_version_id and v.published_at is not null));
create policy assessment_sessions_members_all on public.assessment_sessions for all to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy assessment_responses_members_all on public.assessment_responses for all to authenticated
using (public.is_organisation_member(organisation_id)) with check (
  public.is_organisation_member(organisation_id) and exists (
    select 1 from public.assessment_sessions s where s.id = session_id and s.organisation_id = organisation_id and s.state = 'draft'
  )
);
