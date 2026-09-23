-- Snapshot-safe selection history starts at the first state we can observe.
-- Older entry-backed snapshots without such an event remain historical.
create table public.github_mapping_pack_selection_history (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  mapping_pack_id uuid references public.github_mapping_packs(id) on delete restrict,
  selected_by uuid references public.profiles(id) on delete restrict,
  event_kind text not null check (event_kind in ('selected', 'legacy_fallback')),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint github_mapping_pack_selection_history_state_check check (
    (event_kind = 'selected' and mapping_pack_id is not null and selected_by is not null)
    or (event_kind = 'legacy_fallback' and mapping_pack_id is null and selected_by is null)
  )
);
create index github_mapping_pack_selection_history_snapshot_idx
  on public.github_mapping_pack_selection_history(organisation_id, recorded_at desc, id desc);
alter table public.github_mapping_pack_selection_history enable row level security;
revoke all on public.github_mapping_pack_selection_history from public, anon, authenticated, service_role;

create function public.record_github_mapping_pack_selection_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.organisation_id is distinct from old.organisation_id
    or new.mapping_pack_id is distinct from old.mapping_pack_id
  then
    insert into public.github_mapping_pack_selection_history(
      organisation_id, mapping_pack_id, selected_by, event_kind, recorded_at
    ) values (
      new.organisation_id, new.mapping_pack_id, new.selected_by, 'selected', pg_catalog.clock_timestamp()
    );
  end if;
  return new;
end;
$$;
alter function public.record_github_mapping_pack_selection_history() owner to postgres;
revoke all on function public.record_github_mapping_pack_selection_history()
  from public, anon, authenticated, service_role;
create trigger github_mapping_pack_selection_history_record
  after insert or update on public.github_mapping_pack_selections
  for each row execute function public.record_github_mapping_pack_selection_history();

create function public.record_github_mapping_legacy_fallback_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.github_mapping_pack_selection_history(
    organisation_id, mapping_pack_id, selected_by, event_kind, recorded_at
  ) values (
    new.id, null, null, 'legacy_fallback', pg_catalog.clock_timestamp()
  );
  return new;
end;
$$;
alter function public.record_github_mapping_legacy_fallback_history() owner to postgres;
revoke all on function public.record_github_mapping_legacy_fallback_history()
  from public, anon, authenticated, service_role;
create trigger github_mapping_pack_selection_legacy_fallback_record
  after insert on public.organisations
  for each row execute function public.record_github_mapping_legacy_fallback_history();

-- These are migration-time observations, not claims about earlier selection.
insert into public.github_mapping_pack_selection_history(
  organisation_id, mapping_pack_id, selected_by, event_kind, recorded_at
)
select selection.organisation_id, selection.mapping_pack_id, selection.selected_by,
       'selected', pg_catalog.clock_timestamp()
from public.github_mapping_pack_selections selection;
insert into public.github_mapping_pack_selection_history(
  organisation_id, mapping_pack_id, selected_by, event_kind, recorded_at
)
select organisation.id, null, null, 'legacy_fallback', pg_catalog.clock_timestamp()
from public.organisations organisation
where not exists (
  select 1 from public.github_mapping_pack_selections selection
  where selection.organisation_id = organisation.id
);

create or replace function public.github_official_result_mapping_status_at(
  target_organisation_id uuid,
  target_result_id uuid,
  target_snapshot_at timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1
    from public.github_official_compliance_results result
    join public.github_mapping_packs pack
      on pack.id = result.mapping_pack_id
     and pack.version = result.mapping_version
     and pack.checksum = result.mapping_checksum
     and pack.published_at is not null
     and pack.published_at <= target_snapshot_at
    where result.id = target_result_id
      and result.organisation_id = target_organisation_id
      and result.materialised_at <= target_snapshot_at
      and exists (
        select 1 from public.memberships membership
        where membership.organisation_id = target_organisation_id
          and membership.user_id = (select auth.uid())
      )
      and exists (
        select 1 from public.github_mapping_pack_selection_history history
        where history.organisation_id = target_organisation_id
          and history.recorded_at <= target_snapshot_at
          and history.id = (
            select latest.id
            from public.github_mapping_pack_selection_history latest
            where latest.organisation_id = target_organisation_id
              and latest.recorded_at <= target_snapshot_at
            order by latest.recorded_at desc, latest.id desc
            limit 1
          )
          and (
            (history.event_kind = 'selected' and history.mapping_pack_id = result.mapping_pack_id)
            or (history.event_kind = 'legacy_fallback' and (
              result.approval_id is not null or exists (
                select 1 from public.github_entry_materialisation_receipts legacy_receipt
                where legacy_receipt.id = result.entry_receipt_id
                  and legacy_receipt.legacy_approval_id is not null
              )
            ))
          )
      )
      and (
        (result.entry_receipt_id is null and exists (
          select 1
          from public.github_mapping_approvals approval
          where approval.id = result.approval_id
            and approval.organisation_id = result.organisation_id
            and approval.mapping_pack_id = result.mapping_pack_id
            and approval.approved_at <= target_snapshot_at
            and (approval.revoked_at is null or approval.revoked_at > target_snapshot_at)
            and not exists (
              select 1 from public.github_mapping_entries approved_entry
              join public.github_mapping_entry_decisions decision
                on decision.organisation_id = result.organisation_id
               and decision.check_id = approved_entry.check_id
               and decision.entry_digest = public.github_mapping_entry_digest(approved_entry.id)
              where approved_entry.mapping_pack_id = result.mapping_pack_id
                and approved_entry.check_id = result.check_id
                and decision.decided_at <= target_snapshot_at
            )
        ))
        or (result.entry_receipt_id is not null and exists (
          select 1
          from public.github_entry_materialisation_receipts receipt
          join public.github_mapping_entries selected_entry
            on selected_entry.id = receipt.selected_mapping_entry_id
           and selected_entry.mapping_pack_id = receipt.selected_mapping_pack_id
           and selected_entry.check_id = receipt.check_id
          join public.github_mapping_entries source_entry
            on source_entry.id = receipt.source_mapping_entry_id
           and source_entry.mapping_pack_id = receipt.source_mapping_pack_id
           and source_entry.check_id = receipt.check_id
          where receipt.id = result.entry_receipt_id
            and receipt.organisation_id = result.organisation_id
            and receipt.selected_mapping_pack_id = result.mapping_pack_id
            and receipt.check_id = result.check_id
            and receipt.created_at <= target_snapshot_at
            and public.github_mapping_entry_digest(selected_entry.id) = receipt.entry_digest
            and public.github_mapping_entry_digest(source_entry.id) = receipt.entry_digest
            and exists (
              select 1 from public.github_mapping_pack_selection_history selected
              where selected.organisation_id = target_organisation_id
                and selected.recorded_at <= target_snapshot_at
                and selected.id = (
                  select latest.id
                  from public.github_mapping_pack_selection_history latest
                  where latest.organisation_id = target_organisation_id
                    and latest.recorded_at <= target_snapshot_at
                  order by latest.recorded_at desc, latest.id desc
                  limit 1
                )
                and (
                  (selected.event_kind = 'selected'
                    and selected.mapping_pack_id = receipt.selected_mapping_pack_id)
                  or (selected.event_kind = 'legacy_fallback'
                    and receipt.legacy_approval_id is not null
                    and receipt.selected_mapping_pack_id = receipt.source_mapping_pack_id)
                )
            )
            and (
              (receipt.entry_decision_id is not null and exists (
                select 1 from public.github_mapping_entry_decisions decision
                where decision.id = receipt.entry_decision_id
                  and decision.organisation_id = receipt.organisation_id
                  and decision.mapping_pack_id = receipt.source_mapping_pack_id
                  and decision.mapping_entry_id = receipt.source_mapping_entry_id
                  and decision.check_id = receipt.check_id
                  and decision.entry_digest = receipt.entry_digest
                  and decision.decision = 'approved'
                  and decision.decided_at <= target_snapshot_at
                  and not exists (
                    select 1 from public.github_mapping_entry_decisions later
                    where later.organisation_id = decision.organisation_id
                      and later.check_id = decision.check_id
                      and later.entry_digest = decision.entry_digest
                      and later.decided_at <= target_snapshot_at
                      and (later.revision, later.id) > (decision.revision, decision.id)
                  )
              ))
              or (receipt.legacy_approval_id is not null and exists (
                select 1 from public.github_mapping_approvals approval
                where approval.id = receipt.legacy_approval_id
                  and approval.organisation_id = receipt.organisation_id
                  and approval.mapping_pack_id = receipt.source_mapping_pack_id
                  and approval.approved_at <= target_snapshot_at
                  and (approval.revoked_at is null or approval.revoked_at > target_snapshot_at)
                  and not exists (
                    select 1 from public.github_mapping_entry_decisions decision
                    where decision.organisation_id = receipt.organisation_id
                      and decision.check_id = receipt.check_id
                      and decision.entry_digest = receipt.entry_digest
                      and decision.decided_at <= target_snapshot_at
                  )
              ))
            )
        ))
      )
  ) then 'active' else 'historical' end
  where target_organisation_id is not null
    and target_result_id is not null
    and target_snapshot_at is not null
    and exists (
      select 1 from public.memberships membership
      where membership.organisation_id = target_organisation_id
        and membership.user_id = (select auth.uid())
    );
$$;
alter function public.github_official_result_mapping_status_at(uuid,uuid,timestamptz)
  owner to postgres;
revoke all on function public.github_official_result_mapping_status_at(uuid,uuid,timestamptz)
  from public, anon, service_role;
grant execute on function public.github_official_result_mapping_status_at(uuid,uuid,timestamptz)
  to authenticated;

-- Keep the control-room's existing payload shape, adding only snapshot-derived
-- mapping consent and freshness to each official result.
alter function public.get_github_compliance_control_room_v1(uuid,integer,integer)
  rename to get_github_compliance_control_room_base_v1;

create function public.get_github_compliance_control_room_v1(
  target_organisation_id uuid,
  target_offset integer default 0,
  target_limit integer default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  payload jsonb;
  snapshot_at timestamptz;
begin
  payload := public.get_github_compliance_control_room_base_v1(
    target_organisation_id, target_offset, target_limit
  );
  if payload is null then return null; end if;
  snapshot_at := (payload ->> 'asOf')::timestamptz;
  return pg_catalog.jsonb_set(
    payload,
    '{repositories}',
    coalesce((
      select pg_catalog.jsonb_agg(
        repository.value || pg_catalog.jsonb_build_object(
          'officialResults', coalesce((
            select pg_catalog.jsonb_agg(
              result.value || pg_catalog.jsonb_build_object(
                'mappingStatus', coalesce(public.github_official_result_mapping_status_at(
                  target_organisation_id, (result.value ->> 'id')::uuid, snapshot_at
                ), 'historical'),
                'freshness', case
                  when (result.value ->> 'freshUntil')::timestamptz > snapshot_at then 'current'
                  else 'stale'
                end
              ) order by result.value ->> 'checkId'
            )
            from pg_catalog.jsonb_array_elements(
              coalesce(repository.value -> 'officialResults', '[]'::jsonb)
            ) result(value)
            where (result.value ->> 'materialisedAt')::timestamptz <= snapshot_at
          ), '[]'::jsonb)
        ) order by repository.ordinality
      )
      from pg_catalog.jsonb_array_elements(payload -> 'repositories')
        with ordinality repository(value, ordinality)
    ), '[]'::jsonb), true
  );
end;
$$;
alter function public.get_github_compliance_control_room_v1(uuid,integer,integer)
  owner to postgres;
revoke all on function public.get_github_compliance_control_room_v1(uuid,integer,integer)
  from public, anon, service_role;
grant execute on function public.get_github_compliance_control_room_v1(uuid,integer,integer)
  to authenticated;
