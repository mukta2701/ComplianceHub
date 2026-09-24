-- Materialise alert decisions already made by the application rule builder.
-- This migration stores state/events and in-app notices only; it does not send Slack.

-- The existing member-facing status function applies the same lineage rules but
-- requires auth.uid() membership. Alert workers need the predicate without a
-- browser identity, so keep a service-only core and preserve the member wrapper.
create function public.github_official_result_mapping_status_at_core(
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
    and target_snapshot_at is not null;
$$;
alter function public.github_official_result_mapping_status_at_core(uuid,uuid,timestamptz)
  owner to postgres;
revoke all on function public.github_official_result_mapping_status_at_core(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.github_official_result_mapping_status_at_core(uuid,uuid,timestamptz)
  to service_role;

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
    select 1 from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = (select auth.uid())
  ) then public.github_official_result_mapping_status_at_core(
    target_organisation_id, target_result_id, target_snapshot_at
  ) end
  where target_organisation_id is not null
    and target_result_id is not null
    and target_snapshot_at is not null;
$$;
alter function public.github_official_result_mapping_status_at(uuid,uuid,timestamptz)
  owner to postgres;
revoke all on function public.github_official_result_mapping_status_at(uuid,uuid,timestamptz)
  from public, anon, service_role;
grant execute on function public.github_official_result_mapping_status_at(uuid,uuid,timestamptz)
  to authenticated;

alter table public.github_official_compliance_results
  add constraint github_official_results_alert_state_key
  unique (id, organisation_id, repository_id, check_id);

create table public.github_compliance_result_alert_states (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  repository_id uuid not null,
  check_id text not null,
  current_result_id uuid not null,
  current_outcome public.github_observation_result not null,
  actionable_unknown_since timestamptz,
  active_incident_kind text,
  active_incident_key text,
  active_incident_started_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  next_evaluation_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (organisation_id, repository_id, check_id),
  constraint github_compliance_result_alert_states_repository_fk
    foreign key (repository_id, organisation_id)
    references public.github_repositories(id, organisation_id) on delete cascade,
  constraint github_compliance_result_alert_states_result_fk
    foreign key (current_result_id, organisation_id, repository_id, check_id)
    references public.github_official_compliance_results(id, organisation_id, repository_id, check_id) on delete restrict,
  constraint github_compliance_result_alert_states_check_id_check
    check (check_id ~ '^github\.[a-z0-9_.]+$' and pg_catalog.char_length(check_id) <= 120),
  constraint github_compliance_result_alert_states_incident_check check (
    (active_incident_kind is null and active_incident_key is null and active_incident_started_at is null)
    or (active_incident_kind in ('failure', 'sustained_unknown', 'stale')
      and active_incident_key ~ '^[0-9a-f]{64}$' and active_incident_started_at is not null)
  ),
  constraint github_compliance_result_alert_states_unknown_check
    check (actionable_unknown_since is null or current_outcome = 'unknown')
);
create index github_compliance_result_alert_states_due_idx
  on public.github_compliance_result_alert_states(next_evaluation_at, organisation_id, repository_id, check_id)
  where next_evaluation_at is not null;

create table public.github_compliance_result_alert_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null,
  repository_id uuid not null,
  check_id text not null,
  incident_key text not null check (incident_key ~ '^[0-9a-f]{64}$'),
  event_kind text not null check (event_kind in ('failure', 'sustained_unknown', 'stale', 'recovery')),
  idempotency_key text not null check (idempotency_key ~ '^[0-9a-f]{64}$'),
  result_id uuid not null,
  incident_started_at timestamptz not null,
  event_at timestamptz not null,
  notification_message text not null check (
    pg_catalog.char_length(notification_message) between 1 and 500
    and notification_message !~ '[\r\n]'
  ),
  created_at timestamptz not null default pg_catalog.now(),
  constraint github_compliance_result_alert_events_state_fk
    foreign key (organisation_id, repository_id, check_id)
    references public.github_compliance_result_alert_states(organisation_id, repository_id, check_id) on delete cascade,
  constraint github_compliance_result_alert_events_result_fk
    foreign key (result_id, organisation_id, repository_id, check_id)
    references public.github_official_compliance_results(id, organisation_id, repository_id, check_id) on delete restrict,
  constraint github_compliance_result_alert_events_idempotency_key
    unique (organisation_id, idempotency_key),
  constraint github_compliance_result_alert_events_transition_key
    unique (organisation_id, incident_key, event_kind, result_id)
);
create index github_compliance_result_alert_events_recent_idx
  on public.github_compliance_result_alert_events(organisation_id, event_at desc, id desc);

alter table public.github_compliance_result_alert_states enable row level security;
alter table public.github_compliance_result_alert_events enable row level security;
revoke all on public.github_compliance_result_alert_states,
  public.github_compliance_result_alert_events from public, anon, authenticated, service_role;

create function public.load_github_compliance_result_alert_candidates(
  target_evaluated_at timestamptz,
  target_collection_run_id uuid default null,
  target_organisation_id uuid default null,
  target_after_organisation_id uuid default null,
  target_after_repository_id uuid default null,
  target_after_check_id text default null,
  target_limit integer default 100
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result_value jsonb;
begin
  if target_evaluated_at is null
    or target_limit not between 1 and 100
    or ((target_collection_run_id is null) <> (target_organisation_id is null))
    or ((target_after_organisation_id is null) <> (target_after_repository_id is null))
    or ((target_after_organisation_id is null) <> (target_after_check_id is null)) then
    raise exception 'invalid GitHub compliance alert scope' using errcode = '22023';
  end if;

  with target_keys as (
    select result.organisation_id, result.repository_id, result.check_id
    from public.github_official_compliance_results result
    where target_collection_run_id is not null
      and result.collection_run_id = target_collection_run_id
      and result.organisation_id = target_organisation_id
    union
    select state.organisation_id, state.repository_id, state.check_id
    from public.github_compliance_result_alert_states state
    where target_collection_run_id is null
      and state.next_evaluation_at <= target_evaluated_at
  ), latest as (
    select distinct on (result.organisation_id, result.repository_id, result.check_id)
      result.id, result.organisation_id, result.repository_id, result.check_id,
      result.collection_run_id, result.outcome, result.observed_at, result.fresh_until,
      result.finding_id, result.evidence_id, result.failure_severity,
      repository.full_name as repository_slug
    from target_keys
    join lateral (
      select candidate.*
      from public.github_official_compliance_results candidate
      where candidate.organisation_id = target_keys.organisation_id
        and candidate.repository_id = target_keys.repository_id
        and candidate.check_id = target_keys.check_id
      order by candidate.observed_at desc, candidate.id desc
      limit 1
    ) result on true
    join public.github_repositories repository
      on repository.id = result.repository_id
     and repository.organisation_id = result.organisation_id
     and repository.selected and repository.available
    join public.github_installations installation
      on installation.id = result.installation_id
     and installation.organisation_id = result.organisation_id
     and installation.status = 'active'
     and installation.permissions_ok
     and installation.repository_selection = 'selected'
    where public.github_official_result_mapping_status_at_core(
      result.organisation_id, result.id, target_evaluated_at
    ) = 'active'
    order by result.organisation_id, result.repository_id, result.check_id,
      result.observed_at desc, result.id desc
  ), candidates as (
    select latest.*, state.revision, state.current_result_id,
      state.current_outcome, state.actionable_unknown_since,
      state.active_incident_kind, state.active_incident_key,
      state.active_incident_started_at
    from latest
    left join public.github_compliance_result_alert_states state
      on state.organisation_id = latest.organisation_id
     and state.repository_id = latest.repository_id
     and state.check_id = latest.check_id
    where ((
        target_collection_run_id is not null
        and latest.collection_run_id = target_collection_run_id
        and latest.organisation_id = target_organisation_id
        and state.current_result_id is distinct from latest.id
      ) or (
        target_collection_run_id is null
        and state.next_evaluation_at <= target_evaluated_at
      ))
      and (target_after_organisation_id is null or
        (latest.organisation_id, latest.repository_id, latest.check_id)
          > (target_after_organisation_id, target_after_repository_id, target_after_check_id))
    order by latest.organisation_id, latest.repository_id, latest.check_id
    limit target_limit + 1
  ), numbered as (
    select candidates.*, pg_catalog.row_number() over (
      order by organisation_id, repository_id, check_id
    ) as page_number
    from candidates
  )
  select pg_catalog.jsonb_build_object(
    'candidates', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'collectionRunId', collection_run_id,
      'organisationId', organisation_id,
      'repositoryId', repository_id,
      'repositorySlug', repository_slug,
      'checkId', check_id,
      'result', pg_catalog.jsonb_build_object(
        'id', id, 'outcome', outcome, 'observedAt', observed_at,
        'freshUntil', fresh_until, 'findingId', finding_id,
        'evidenceId', evidence_id, 'severity', failure_severity
      ),
      'state', pg_catalog.jsonb_build_object(
        'revision', revision, 'currentResultId', current_result_id,
        'currentOutcome', current_outcome,
        'actionableUnknownSince', actionable_unknown_since,
        'activeIncident', case when active_incident_key is null then null
          else pg_catalog.jsonb_build_object(
            'kind', active_incident_kind, 'incidentKey', active_incident_key,
            'startedAt', active_incident_started_at
          ) end
      )
    ) order by organisation_id, repository_id, check_id)
      filter (where page_number <= target_limit), '[]'::jsonb),
    'hasMore', coalesce(pg_catalog.bool_or(page_number > target_limit), false)
  ) into result_value
  from numbered;

  return result_value;
end;
$$;
alter function public.load_github_compliance_result_alert_candidates(
  timestamptz, uuid, uuid, uuid, uuid, text, integer
) owner to postgres;
revoke all on function public.load_github_compliance_result_alert_candidates(
  timestamptz, uuid, uuid, uuid, uuid, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.load_github_compliance_result_alert_candidates(
  timestamptz, uuid, uuid, uuid, uuid, text, integer
) to service_role;

create function public.record_github_compliance_result_alert_decisions(
  target_decisions jsonb,
  target_evaluated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  decision jsonb;
  event_value jsonb;
  expected_revision bigint;
  v_current_result_id uuid;
  v_current_outcome public.github_observation_result;
  v_organisation_id uuid;
  v_repository_id uuid;
  v_installation_id uuid;
  v_check_id text;
  v_actionable_unknown_since timestamptz;
  v_active_incident_kind text;
  v_active_incident_key text;
  v_active_incident_started_at timestamptz;
  v_next_evaluation_at timestamptz;
  state_saved boolean;
  event_inserted integer;
  notices_inserted integer;
  processed_count integer := 0;
  conflict_count integer := 0;
  event_count integer := 0;
  notification_count integer := 0;
  event_kind text;
  event_incident_key text;
  event_idempotency_key text;
  event_result_id uuid;
  event_started_at timestamptz;
  notification_message text;
begin
  if target_evaluated_at is null or pg_catalog.jsonb_typeof(target_decisions) <> 'array'
    or pg_catalog.jsonb_array_length(target_decisions) > 100 then
    raise exception 'invalid GitHub compliance alert decisions' using errcode = '22023';
  end if;

  for decision in
    select item.value
    from pg_catalog.jsonb_array_elements(target_decisions) item(value)
    order by item.value ->> 'organisationId', item.value ->> 'repositoryId', item.value ->> 'checkId'
  loop
    if pg_catalog.jsonb_typeof(decision) <> 'object'
      or pg_catalog.jsonb_typeof(decision -> 'event') not in ('object', 'null') then
      raise exception 'invalid GitHub compliance alert decision' using errcode = '22023';
    end if;
    v_organisation_id := (decision ->> 'organisationId')::uuid;
    v_repository_id := (decision ->> 'repositoryId')::uuid;
    v_check_id := decision ->> 'checkId';
    v_current_result_id := (decision ->> 'currentResultId')::uuid;
    v_current_outcome := (decision ->> 'currentOutcome')::public.github_observation_result;
    expected_revision := nullif(decision ->> 'expectedRevision', '')::bigint;
    v_actionable_unknown_since := nullif(decision ->> 'actionableUnknownSince', '')::timestamptz;
    v_next_evaluation_at := nullif(decision ->> 'nextEvaluationAt', '')::timestamptz;
    v_active_incident_kind := decision -> 'nextActiveIncident' ->> 'kind';
    v_active_incident_key := decision -> 'nextActiveIncident' ->> 'incidentKey';
    v_active_incident_started_at := nullif(decision -> 'nextActiveIncident' ->> 'startedAt', '')::timestamptz;

    if v_check_id is null or v_check_id !~ '^github\.[a-z0-9_.]+$'
      or (v_actionable_unknown_since is not null and v_current_outcome <> 'unknown')
      or (v_active_incident_key is null and (v_active_incident_kind is not null or v_active_incident_started_at is not null))
      or (v_active_incident_key is not null and (
        v_active_incident_key !~ '^[0-9a-f]{64}$'
        or v_active_incident_kind not in ('failure', 'sustained_unknown', 'stale')
        or v_active_incident_started_at is null
      )) then
      raise exception 'invalid GitHub compliance alert decision' using errcode = '22023';
    end if;

    -- Serialize with mapping approvals/reviews and repository selection so a
    -- candidate that became historical or was deselected after load cannot
    -- create an event, clear an incident, or replace the last saved state.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('github-mapping-review:' || v_organisation_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('github-mapping-approval:' || v_organisation_id::text, 0)
    );
    select repository.installation_id into v_installation_id
    from public.github_repositories repository
    where repository.id = v_repository_id
      and repository.organisation_id = v_organisation_id;
    if not found then
      conflict_count := conflict_count + 1;
      continue;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_installation_id::text, 0)
    );
    perform 1 from public.github_installations installation
    where installation.id = v_installation_id
      and installation.organisation_id = v_organisation_id
      and installation.status = 'active'
      and installation.permissions_ok
      and installation.repository_selection = 'selected'
    for update;
    if not found then
      conflict_count := conflict_count + 1;
      continue;
    end if;
    perform 1 from public.github_repositories repository
    where repository.id = v_repository_id
      and repository.organisation_id = v_organisation_id
      and repository.installation_id = v_installation_id
      and repository.selected
      and repository.available
    for update;
    if not found or public.github_official_result_mapping_status_at_core(
      v_organisation_id, v_current_result_id, pg_catalog.clock_timestamp()
    ) is distinct from 'active' then
      conflict_count := conflict_count + 1;
      continue;
    end if;

    if not exists (
      select 1 from public.github_official_compliance_results result
      where result.id = v_current_result_id
        and result.organisation_id = v_organisation_id
        and result.repository_id = v_repository_id
        and result.check_id = v_check_id
        and result.outcome = v_current_outcome
        and not exists (
          select 1 from public.github_official_compliance_results newer
          where newer.organisation_id = result.organisation_id
            and newer.repository_id = result.repository_id
            and newer.check_id = result.check_id
            and (newer.observed_at, newer.id) > (result.observed_at, result.id)
        )
    ) then
      raise exception 'GitHub compliance alert result is no longer current' using errcode = '40001';
    end if;

    state_saved := false;
    if expected_revision is null then
      insert into public.github_compliance_result_alert_states(
        organisation_id, repository_id, check_id, current_result_id, current_outcome,
        actionable_unknown_since, active_incident_kind, active_incident_key,
        active_incident_started_at, revision, next_evaluation_at, updated_at
      ) values (
        v_organisation_id, v_repository_id, v_check_id, v_current_result_id, v_current_outcome,
        v_actionable_unknown_since, v_active_incident_kind, v_active_incident_key,
        v_active_incident_started_at, 1, v_next_evaluation_at, target_evaluated_at
      ) on conflict (organisation_id, repository_id, check_id) do nothing;
      get diagnostics event_inserted = row_count;
      state_saved := event_inserted = 1;
    else
      update public.github_compliance_result_alert_states state
      set current_result_id = v_current_result_id,
          current_outcome = v_current_outcome,
          actionable_unknown_since = v_actionable_unknown_since,
          active_incident_kind = v_active_incident_kind,
          active_incident_key = v_active_incident_key,
          active_incident_started_at = v_active_incident_started_at,
          revision = state.revision + 1,
          next_evaluation_at = v_next_evaluation_at,
          updated_at = target_evaluated_at
      where state.organisation_id = v_organisation_id
        and state.repository_id = v_repository_id
        and state.check_id = v_check_id
        and state.revision = expected_revision;
      get diagnostics event_inserted = row_count;
      state_saved := event_inserted = 1;
    end if;

    if not state_saved then
      conflict_count := conflict_count + 1;
      continue;
    end if;
    processed_count := processed_count + 1;

    event_value := decision -> 'event';
    if pg_catalog.jsonb_typeof(event_value) = 'object' then
      event_kind := event_value ->> 'kind';
      event_incident_key := event_value ->> 'incidentKey';
      event_idempotency_key := event_value ->> 'idempotencyKey';
      event_result_id := (event_value ->> 'resultId')::uuid;
      event_started_at := (event_value ->> 'incidentStartedAt')::timestamptz;
      notification_message := event_value ->> 'notificationMessage';
      if event_kind not in ('failure', 'sustained_unknown', 'stale', 'recovery')
        or event_incident_key !~ '^[0-9a-f]{64}$'
        or event_idempotency_key !~ '^[0-9a-f]{64}$'
        or event_idempotency_key <> pg_catalog.encode(extensions.digest(
          event_kind || E'\n' || event_incident_key, 'sha256'), 'hex')
        or event_result_id <> v_current_result_id
        or notification_message is null
        or pg_catalog.char_length(notification_message) not between 1 and 500
        or notification_message ~ '[\r\n]'
        or (event_kind = 'failure' and v_current_outcome <> 'fail')
        or (event_kind = 'recovery' and v_current_outcome <> 'pass')
        or (event_kind = 'sustained_unknown' and v_current_outcome <> 'unknown') then
        raise exception 'invalid GitHub compliance alert event' using errcode = '22023';
      end if;

      insert into public.github_compliance_result_alert_events(
        organisation_id, repository_id, check_id, incident_key, event_kind,
        idempotency_key, result_id, incident_started_at, event_at, notification_message
      ) values (
        v_organisation_id, v_repository_id, v_check_id, event_incident_key, event_kind,
        event_idempotency_key, event_result_id, event_started_at, target_evaluated_at, notification_message
      ) on conflict (organisation_id, idempotency_key) do nothing;
      get diagnostics event_inserted = row_count;
      if event_inserted = 1 then
        event_count := event_count + 1;
        insert into public.notifications(
          organisation_id, user_id, kind, subject_type, subject_id, message, sweep_on
        )
        select v_organisation_id, membership.user_id,
          'github_compliance_' || event_kind,
          'github_official_compliance_result', v_current_result_id::text,
          notification_message, (target_evaluated_at at time zone 'UTC')::date
        from public.memberships membership
        where membership.organisation_id = v_organisation_id
          and membership.role in ('owner', 'admin')
        on conflict (user_id, kind, subject_type, subject_id, sweep_on) do nothing;
        get diagnostics notices_inserted = row_count;
        notification_count := notification_count + notices_inserted;
      end if;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'processed', processed_count,
    'conflicts', conflict_count,
    'eventsCreated', event_count,
    'notificationsCreated', notification_count
  );
end;
$$;
alter function public.record_github_compliance_result_alert_decisions(jsonb, timestamptz) owner to postgres;
revoke all on function public.record_github_compliance_result_alert_decisions(jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_github_compliance_result_alert_decisions(jsonb, timestamptz)
  to service_role;
