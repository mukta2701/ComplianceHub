create table public.github_mapping_pack_selections (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  mapping_pack_id uuid not null references public.github_mapping_packs(id) on delete restrict,
  selected_by uuid not null references public.profiles(id) on delete restrict,
  selected_at timestamptz not null default pg_catalog.now(),
  revision bigint not null default 0 check (revision >= 0)
);

create table public.github_mapping_entry_decisions (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  mapping_pack_id uuid not null references public.github_mapping_packs(id) on delete restrict,
  mapping_entry_id uuid not null,
  check_id text not null,
  entry_digest text not null check (entry_digest ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('approved', 'rejected')),
  decided_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz not null default pg_catalog.now(),
  revision bigint not null check (revision > 0),
  constraint github_mapping_entry_decisions_entry_fk
    foreign key (mapping_entry_id, mapping_pack_id)
    references public.github_mapping_entries(id, mapping_pack_id) on delete restrict,
  constraint github_mapping_entry_decisions_org_revision_key unique (organisation_id, revision),
  constraint github_mapping_entry_decisions_ancestry_key
    unique (id, organisation_id, mapping_pack_id, mapping_entry_id, entry_digest)
);
create index github_mapping_entry_decisions_effective_idx
on public.github_mapping_entry_decisions(organisation_id, check_id, entry_digest, revision desc);

alter table public.github_mapping_pack_selections enable row level security;
alter table public.github_mapping_entry_decisions enable row level security;
create policy github_mapping_pack_selections_members_read
on public.github_mapping_pack_selections for select to authenticated
using (exists (
  select 1 from public.memberships membership
  where membership.organisation_id = github_mapping_pack_selections.organisation_id
    and membership.user_id = (select auth.uid())
    and membership.role in ('owner', 'admin')
));
create policy github_mapping_entry_decisions_members_read
on public.github_mapping_entry_decisions for select to authenticated
using (exists (
  select 1 from public.memberships membership
  where membership.organisation_id = github_mapping_entry_decisions.organisation_id
    and membership.user_id = (select auth.uid())
    and membership.role in ('owner', 'admin')
));

revoke all on public.github_mapping_pack_selections from public, anon, authenticated, service_role;
revoke all on public.github_mapping_entry_decisions from public, anon, authenticated, service_role;
grant select on public.github_mapping_pack_selections to authenticated, service_role;
grant select on public.github_mapping_entry_decisions to authenticated, service_role;

create function public.github_mapping_entry_digest(target_entry_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'checkId', entry.check_id,
          'ruleVersion', entry.rule_version,
          'isoControlReferences', (
            select pg_catalog.jsonb_agg(reference_value order by reference_value collate pg_catalog."C")
            from pg_catalog.unnest(entry.iso_control_references) refs(reference_value)
          ),
          'failureSeverity', entry.failure_severity::text,
          'remediation', entry.remediation,
          'treatments', entry.treatments
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.github_mapping_entries entry
  where entry.id = target_entry_id;
$$;
alter function public.github_mapping_entry_digest(uuid) owner to postgres;
revoke all on function public.github_mapping_entry_digest(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.github_mapping_entry_digest(uuid)
to authenticated, service_role;

create view public.github_effective_mapping_entry_decisions
with (security_invoker = true)
as
select
  organisation.id as organisation_id,
  pack.id as mapping_pack_id,
  entry.id as mapping_entry_id,
  entry.check_id,
  identity.entry_digest,
  case
    when latest.id is not null then latest.decision
    when legacy.id is not null then 'approved'
    else 'pending'
  end as status,
  case
    when latest.id is not null then 'entry_decision'
    when legacy.id is not null then 'legacy_pack'
    else 'none'
  end as source,
  latest.id as decision_id,
  case when latest.id is null then legacy.id end as legacy_approval_id,
  coalesce(latest.decided_by, legacy.approved_by) as reviewer_id,
  coalesce(latest.decided_at, legacy.approved_at) as reviewed_at,
  coalesce(selection.revision, 0) as revision,
  case
    when latest.id is not null or legacy.id is not null then null
    when exists (
      select 1 from public.github_mapping_entry_decisions previous
      where previous.organisation_id = organisation.id
        and previous.check_id = entry.check_id
        and previous.entry_digest <> identity.entry_digest
    ) or exists (
      select 1 from public.github_mapping_approvals previous_approval
      join public.github_mapping_entries previous_entry
        on previous_entry.mapping_pack_id = previous_approval.mapping_pack_id
      where previous_approval.organisation_id = organisation.id
        and previous_entry.check_id = entry.check_id
        and public.github_mapping_entry_digest(previous_entry.id) <> identity.entry_digest
    ) then 'changed'
    else 'not_reviewed'
  end as change_reason
from public.organisations organisation
left join public.github_mapping_pack_selections selection
  on selection.organisation_id = organisation.id
left join public.github_mapping_approvals active_approval
  on active_approval.organisation_id = organisation.id
  and active_approval.revoked_at is null
join public.github_mapping_packs pack
  on pack.id = coalesce(
    selection.mapping_pack_id,
    active_approval.mapping_pack_id,
    (select baseline.id from public.github_mapping_packs baseline
     where baseline.version = 'github-iso-27001-v1')
  )
  and pack.published_at is not null
join public.github_mapping_entries entry on entry.mapping_pack_id = pack.id
cross join lateral (
  select public.github_mapping_entry_digest(entry.id) as entry_digest
) identity
left join lateral (
  select decision.*
  from public.github_mapping_entry_decisions decision
  where decision.organisation_id = organisation.id
    and decision.check_id = entry.check_id
    and decision.entry_digest = identity.entry_digest
  order by decision.revision desc
  limit 1
) latest on true
left join lateral (
  select approval.id, approval.approved_by, approval.approved_at
  from public.github_mapping_approvals approval
  join public.github_mapping_entries approved_entry
    on approved_entry.mapping_pack_id = approval.mapping_pack_id
  where approval.organisation_id = organisation.id
    and approval.revoked_at is null
    and approved_entry.check_id = entry.check_id
    and public.github_mapping_entry_digest(approved_entry.id) = identity.entry_digest
  order by approval.approved_at desc, approval.id desc
  limit 1
) legacy on true
where current_user in ('postgres', 'service_role')
  or exists (
    select 1 from public.memberships viewer
    where viewer.organisation_id = organisation.id
      and viewer.user_id = (select auth.uid())
      and viewer.role in ('owner', 'admin')
  );

revoke all on public.github_effective_mapping_entry_decisions
from public, anon, authenticated, service_role;
grant select on public.github_effective_mapping_entry_decisions
to authenticated, service_role;

create function public.record_github_mapping_entry_decision_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_mapping_entry_id uuid,
  target_entry_digest text,
  target_decision text,
  expected_revision bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selection_row public.github_mapping_pack_selections;
  selected_pack_id uuid;
  entry_row public.github_mapping_entries;
  created_decision_id uuid;
begin
  if target_organisation_id is null or target_actor_id is null or target_mapping_entry_id is null
    or target_entry_digest !~ '^[0-9a-f]{64}$'
    or target_decision not in ('approved', 'rejected')
    or expected_revision is null or expected_revision < 0
  then
    raise exception 'invalid GitHub mapping entry decision' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
  ) then
    raise exception 'GitHub mapping decision requires a current workspace Owner' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-mapping-review:' || target_organisation_id::text, 0)
  );
  perform 1 from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for share;
  if not found then
    raise exception 'GitHub mapping decision requires a current workspace Owner' using errcode = '42501';
  end if;

  select * into selection_row
  from public.github_mapping_pack_selections selection
  where selection.organisation_id = target_organisation_id
  for update;
  if coalesce(selection_row.revision, 0) <> expected_revision then
    raise exception 'GitHub mapping review changed; refresh before deciding' using errcode = '40001';
  end if;

  selected_pack_id := coalesce(
    selection_row.mapping_pack_id,
    (select approval.mapping_pack_id from public.github_mapping_approvals approval
     where approval.organisation_id = target_organisation_id and approval.revoked_at is null),
    (select pack.id from public.github_mapping_packs pack
     where pack.version = 'github-iso-27001-v1' and pack.published_at is not null)
  );
  select * into entry_row
  from public.github_mapping_entries entry
  where entry.id = target_mapping_entry_id
    and entry.mapping_pack_id = selected_pack_id;
  if not found or public.github_mapping_entry_digest(entry_row.id) is distinct from target_entry_digest then
    raise exception 'reviewed GitHub mapping entry changed' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.github_mapping_packs pack
    where pack.id = selected_pack_id and pack.published_at is not null
      and pack.checksum = public.github_mapping_pack_checksum(pack.id)
  ) then
    raise exception 'selected GitHub mapping pack is not published' using errcode = '22023';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', target_actor_id::text, 'role', 'authenticated')::text,
    true
  );
  if selection_row.organisation_id is null then
    insert into public.github_mapping_pack_selections(
      organisation_id, mapping_pack_id, selected_by, revision
    ) values (
      target_organisation_id, selected_pack_id, target_actor_id, 0
    );
  end if;
  insert into public.github_mapping_entry_decisions(
    organisation_id, mapping_pack_id, mapping_entry_id, check_id,
    entry_digest, decision, decided_by, revision
  ) values (
    target_organisation_id, selected_pack_id, entry_row.id, entry_row.check_id,
    target_entry_digest, target_decision, target_actor_id, expected_revision + 1
  ) returning id into created_decision_id;
  update public.github_mapping_pack_selections
  set revision = expected_revision + 1
  where organisation_id = target_organisation_id;
  return created_decision_id;
end;
$$;
alter function public.record_github_mapping_entry_decision_server(uuid,uuid,uuid,text,text,bigint)
owner to postgres;
revoke all on function public.record_github_mapping_entry_decision_server(uuid,uuid,uuid,text,text,bigint)
from public, anon, authenticated, service_role;
grant execute on function public.record_github_mapping_entry_decision_server(uuid,uuid,uuid,text,text,bigint)
to service_role;

create function public.select_github_mapping_pack_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_version text,
  target_checksum text,
  expected_revision bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selection_row public.github_mapping_pack_selections;
  pack_row public.github_mapping_packs;
begin
  if target_organisation_id is null or target_actor_id is null
    or target_version is null or target_checksum !~ '^[0-9a-f]{64}$'
    or expected_revision is null or expected_revision < 0
  then
    raise exception 'invalid GitHub mapping pack selection' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
  ) then
    raise exception 'GitHub mapping pack selection requires a current workspace Owner' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-mapping-review:' || target_organisation_id::text, 0)
  );
  perform 1 from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for share;
  if not found then
    raise exception 'GitHub mapping pack selection requires a current workspace Owner' using errcode = '42501';
  end if;
  select * into selection_row
  from public.github_mapping_pack_selections selection
  where selection.organisation_id = target_organisation_id
  for update;
  if coalesce(selection_row.revision, 0) <> expected_revision then
    raise exception 'GitHub mapping review changed; refresh before selecting' using errcode = '40001';
  end if;
  select * into pack_row
  from public.github_mapping_packs pack
  where pack.version = target_version
    and pack.checksum = target_checksum
    and pack.published_at is not null;
  if not found or pack_row.checksum is distinct from public.github_mapping_pack_checksum(pack_row.id) then
    raise exception 'reviewed GitHub mapping pack identity does not match' using errcode = '22023';
  end if;
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', target_actor_id::text, 'role', 'authenticated')::text,
    true
  );
  insert into public.github_mapping_pack_selections(
    organisation_id, mapping_pack_id, selected_by, selected_at, revision
  ) values (
    target_organisation_id, pack_row.id, target_actor_id, pg_catalog.now(), expected_revision + 1
  )
  on conflict (organisation_id) do update
  set mapping_pack_id = excluded.mapping_pack_id,
      selected_by = excluded.selected_by,
      selected_at = excluded.selected_at,
      revision = excluded.revision;
  return pack_row.id;
end;
$$;
alter function public.select_github_mapping_pack_server(uuid,uuid,text,text,bigint)
owner to postgres;
revoke all on function public.select_github_mapping_pack_server(uuid,uuid,text,text,bigint)
from public, anon, authenticated, service_role;
grant execute on function public.select_github_mapping_pack_server(uuid,uuid,text,text,bigint)
to service_role;
