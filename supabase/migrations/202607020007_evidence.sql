-- §4.2 evidence vault. Evidence records are immutable after creation apart
-- from guarded status transitions; superseding evidence creates a new record.
-- Files live in the private `evidence` bucket under an organisation prefix.

create type public.evidence_kind as enum ('file', 'link', 'note');
create type public.evidence_status as enum ('current', 'expiring', 'expired', 'superseded', 'withdrawn');

create table public.evidence (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  kind public.evidence_kind not null,
  storage_path text check (storage_path is null or char_length(storage_path) <= 1024),
  url text check (url is null or url ~ '^https?://'),
  description text not null default '' check (char_length(description) <= 10000),
  owner_id uuid references public.profiles(id) on delete set null,
  collected_on date not null default current_date,
  valid_until date,
  review_interval public.task_recurrence,
  status public.evidence_status not null default 'current',
  replaces_evidence_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (id, organisation_id),
  constraint evidence_owner_tenant_fk foreign key (organisation_id, owner_id)
    references public.memberships(organisation_id, user_id) on delete set null (owner_id),
  constraint evidence_replaces_tenant_fk foreign key (replaces_evidence_id, organisation_id)
    references public.evidence(id, organisation_id) on delete restrict,
  check (
    (kind = 'file' and storage_path is not null and url is null)
    or (kind = 'link' and url is not null and storage_path is null)
    or (kind = 'note' and storage_path is null and url is null)
  )
);
create index evidence_org_status_idx on public.evidence(organisation_id, status, valid_until);

create table public.evidence_links (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  evidence_id uuid not null,
  control_id uuid references public.controls(id) on delete restrict,
  risk_id uuid,
  task_id uuid,
  policy_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint evidence_links_evidence_tenant_fk foreign key (evidence_id, organisation_id)
    references public.evidence(id, organisation_id) on delete cascade,
  constraint evidence_links_risk_tenant_fk foreign key (risk_id, organisation_id)
    references public.risks(id, organisation_id) on delete cascade,
  constraint evidence_links_task_tenant_fk foreign key (task_id, organisation_id)
    references public.tasks(id, organisation_id) on delete cascade,
  constraint evidence_links_policy_deferred check (policy_id is null),
  check (num_nonnulls(control_id, risk_id, task_id, policy_id) = 1),
  unique (evidence_id, control_id),
  unique (evidence_id, risk_id),
  unique (evidence_id, task_id),
  unique (evidence_id, policy_id)
);

alter table public.tasks add column evidence_id uuid;
alter table public.tasks add constraint tasks_evidence_tenant_fk foreign key (evidence_id, organisation_id)
  references public.evidence(id, organisation_id) on delete set null (evidence_id);
alter table public.tasks add constraint tasks_evidence_source_key
  unique (organisation_id, evidence_id, source);

-- Immutable core: only status may change, and only along the audit-honest
-- lifecycle (fresh -> stale by the sweep; anything live -> superseded/withdrawn).
create or replace function public.evidence_guard_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'evidence records are immutable except for status';
  end if;
  if new.status = old.status then return new; end if;
  if old.status in ('superseded', 'withdrawn') then
    raise exception 'superseded or withdrawn evidence cannot change status';
  end if;
  if new.status not in ('expiring', 'expired', 'superseded', 'withdrawn') then
    raise exception 'invalid evidence status transition';
  end if;
  return new;
end $$;
create trigger evidence_guard_update before update on public.evidence
for each row execute function public.evidence_guard_update();
create trigger evidence_no_delete before delete on public.evidence
for each statement execute function public.reject_immutable_change('evidence is never deleted; supersede or withdraw it');

create trigger evidence_audit after insert or update on public.evidence
for each row execute function public.capture_audit_event();
create trigger evidence_links_audit after insert or update or delete on public.evidence_links
for each row execute function public.capture_audit_event();

alter table public.evidence enable row level security;
alter table public.evidence_links enable row level security;
create policy evidence_members_select on public.evidence for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy evidence_members_insert on public.evidence for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy evidence_members_update on public.evidence for update to authenticated
using (public.is_organisation_member(organisation_id)) with check (public.is_organisation_member(organisation_id));
create policy evidence_links_members_select on public.evidence_links for select to authenticated
using (public.is_organisation_member(organisation_id));
create policy evidence_links_members_insert on public.evidence_links for insert to authenticated
with check (public.is_organisation_member(organisation_id) and created_by = (select auth.uid()));
create policy evidence_links_members_delete on public.evidence_links for delete to authenticated
using (public.is_organisation_member(organisation_id));

revoke all on public.evidence, public.evidence_links from anon, authenticated;
grant select, insert on public.evidence to authenticated;
grant update (status) on public.evidence to authenticated;
grant select, insert, delete on public.evidence_links to authenticated;

-- Private storage bucket; path convention: <organisation_id>/<uuid>/<filename>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 26214400, array[
  'application/pdf', 'image/png', 'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain'
]);
create policy evidence_objects_members_select on storage.objects for select to authenticated
using (bucket_id = 'evidence' and public.is_organisation_member(((storage.foldername(name))[1])::uuid));
create policy evidence_objects_members_insert on storage.objects for insert to authenticated
with check (bucket_id = 'evidence' and public.is_organisation_member(((storage.foldername(name))[1])::uuid));
-- No update/delete policies: uploaded files are immutable to clients.

-- DB-atomic creation + supersession. RLS still applies because this is a
-- SECURITY INVOKER function. The application validates the JSON shape first.
create or replace function public.create_evidence_record(payload jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare created_id uuid;
begin
  insert into public.evidence (
    organisation_id, title, kind, storage_path, url, description, owner_id,
    collected_on, valid_until, review_interval, status, replaces_evidence_id, created_by
  ) values (
    (payload->>'organisation_id')::uuid, payload->>'title', (payload->>'kind')::public.evidence_kind,
    nullif(payload->>'storage_path',''), nullif(payload->>'url',''), coalesce(payload->>'description',''),
    nullif(payload->>'owner_id','')::uuid, (payload->>'collected_on')::date,
    nullif(payload->>'valid_until','')::date, nullif(payload->>'review_interval','')::public.task_recurrence,
    (payload->>'status')::public.evidence_status, nullif(payload->>'replaces_evidence_id','')::uuid,
    (select auth.uid())
  ) returning id into created_id;
  if nullif(payload->>'replaces_evidence_id','') is not null then
    update public.evidence set status = 'superseded'
    where id = (payload->>'replaces_evidence_id')::uuid
      and organisation_id = (payload->>'organisation_id')::uuid;
    if not found then raise exception 'replacement evidence not found'; end if;
  end if;
  return created_id;
end $$;
revoke all on function public.create_evidence_record(jsonb) from public;
grant execute on function public.create_evidence_record(jsonb) to authenticated;
