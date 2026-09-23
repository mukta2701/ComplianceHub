-- A receipt describes one selected immutable entry and the exact older consent
-- that authorized a write. It is ancestry, not standing authorization: every
-- new write rechecks the current effective decision.
create table public.github_entry_materialisation_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  selected_mapping_pack_id uuid not null references public.github_mapping_packs(id) on delete restrict,
  selected_mapping_entry_id uuid not null,
  check_id text not null check (pg_catalog.char_length(check_id) between 1 and 120),
  source_mapping_pack_id uuid not null references public.github_mapping_packs(id) on delete restrict,
  source_mapping_entry_id uuid not null,
  entry_digest text not null check (entry_digest ~ '^[0-9a-f]{64}$'),
  entry_decision_id uuid,
  legacy_approval_id uuid,
  created_at timestamptz not null default pg_catalog.now(),
  constraint github_entry_receipts_one_source check
    ((entry_decision_id is not null) <> (legacy_approval_id is not null)),
  constraint github_entry_receipts_selected_fk foreign key
    (selected_mapping_entry_id, selected_mapping_pack_id)
    references public.github_mapping_entries(id, mapping_pack_id) on delete restrict,
  constraint github_entry_receipts_source_fk foreign key
    (source_mapping_entry_id, source_mapping_pack_id)
    references public.github_mapping_entries(id, mapping_pack_id) on delete restrict,
  constraint github_entry_receipts_decision_fk foreign key
    (entry_decision_id, organisation_id, source_mapping_pack_id,
     source_mapping_entry_id, entry_digest)
    references public.github_mapping_entry_decisions(
      id, organisation_id, mapping_pack_id, mapping_entry_id, entry_digest
    ) on delete restrict,
  constraint github_entry_receipts_legacy_fk foreign key
    (legacy_approval_id, organisation_id, source_mapping_pack_id)
    references public.github_mapping_approvals(id, organisation_id, mapping_pack_id)
    on delete restrict,
  constraint github_entry_receipts_id_ancestry_key
    unique (id, organisation_id, selected_mapping_pack_id, check_id)
);
create unique index github_entry_receipts_explicit_key
  on public.github_entry_materialisation_receipts(
    organisation_id, selected_mapping_entry_id, entry_decision_id
  ) where entry_decision_id is not null;
create unique index github_entry_receipts_legacy_key
  on public.github_entry_materialisation_receipts(
    organisation_id, selected_mapping_entry_id, legacy_approval_id
  ) where legacy_approval_id is not null;

create function public.guard_github_entry_materialisation_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  selected_entry public.github_mapping_entries;
  source_entry public.github_mapping_entries;
  effective_row record;
begin
  if tg_op <> 'INSERT' then
    raise exception 'GitHub entry materialisation receipts are immutable' using errcode = '42501';
  end if;
  select * into selected_entry from public.github_mapping_entries
  where id = new.selected_mapping_entry_id
    and mapping_pack_id = new.selected_mapping_pack_id;
  select * into source_entry from public.github_mapping_entries
  where id = new.source_mapping_entry_id
    and mapping_pack_id = new.source_mapping_pack_id;
  if selected_entry.id is null or source_entry.id is null
    or selected_entry.check_id is distinct from source_entry.check_id
    or selected_entry.check_id is distinct from new.check_id
    or public.github_mapping_entry_digest(selected_entry.id) is distinct from new.entry_digest
    or public.github_mapping_entry_digest(source_entry.id) is distinct from new.entry_digest
    or not exists (select 1 from public.github_mapping_packs pack
      where pack.id = new.selected_mapping_pack_id and pack.published_at is not null
        and pack.checksum = public.github_mapping_pack_checksum(pack.id))
  then
    raise exception 'selected and consent-source mapping entries do not match'
      using errcode = '22023';
  end if;
  select * into effective_row
  from public.github_effective_mapping_entry_decisions effective
  where effective.organisation_id = new.organisation_id
    and effective.mapping_pack_id = new.selected_mapping_pack_id
    and effective.mapping_entry_id = new.selected_mapping_entry_id
    and effective.entry_digest = new.entry_digest
    and effective.status = 'approved';
  if effective_row is null
    or (new.entry_decision_id is not null
      and (effective_row.source <> 'entry_decision'
        or effective_row.decision_id is distinct from new.entry_decision_id))
    or (new.legacy_approval_id is not null
      and (effective_row.source <> 'legacy_pack'
        or effective_row.legacy_approval_id is distinct from new.legacy_approval_id))
  then
    raise exception 'entry consent is no longer current' using errcode = '42501';
  end if;
  return new;
end;
$$;
alter function public.guard_github_entry_materialisation_receipt() owner to postgres;
revoke all on function public.guard_github_entry_materialisation_receipt()
  from public, anon, authenticated, service_role;
create trigger github_entry_receipts_guard
  before insert or update or delete on public.github_entry_materialisation_receipts
  for each row execute function public.guard_github_entry_materialisation_receipt();
alter table public.github_entry_materialisation_receipts enable row level security;
revoke all on public.github_entry_materialisation_receipts
  from public, anon, authenticated, service_role;
grant select on public.github_entry_materialisation_receipts to service_role;

-- Historical approval IDs and their composite FKs remain intact. New writes
-- instead point to a receipt whose selected pack may differ from its source.
alter table public.github_official_compliance_results
  alter column approval_id drop not null,
  add column entry_receipt_id uuid,
  add constraint github_official_results_one_consent check
    ((approval_id is not null) <> (entry_receipt_id is not null)),
  add constraint github_official_results_entry_receipt_fk foreign key
    (entry_receipt_id, organisation_id, mapping_pack_id, check_id)
    references public.github_entry_materialisation_receipts(
      id, organisation_id, selected_mapping_pack_id, check_id) on delete restrict;
alter table public.github_evidence_provenance
  alter column approval_id drop not null,
  add column entry_receipt_id uuid,
  add constraint github_evidence_provenance_one_consent check
    ((approval_id is not null) <> (entry_receipt_id is not null)),
  add constraint github_evidence_provenance_entry_receipt_fk foreign key
    (entry_receipt_id, organisation_id, mapping_pack_id, check_id)
    references public.github_entry_materialisation_receipts(
      id, organisation_id, selected_mapping_pack_id, check_id) on delete restrict;
alter table public.github_finding_provenance
  alter column initial_approval_id drop not null,
  alter column latest_approval_id drop not null,
  add column initial_entry_receipt_id uuid,
  add column latest_entry_receipt_id uuid,
  add constraint github_finding_provenance_initial_one_consent check
    ((initial_approval_id is not null) <> (initial_entry_receipt_id is not null)),
  add constraint github_finding_provenance_latest_one_consent check
    ((latest_approval_id is not null) <> (latest_entry_receipt_id is not null)),
  add constraint github_finding_provenance_initial_entry_receipt_fk foreign key
    (initial_entry_receipt_id, organisation_id, initial_mapping_pack_id, check_id)
    references public.github_entry_materialisation_receipts(
      id, organisation_id, selected_mapping_pack_id, check_id) on delete restrict,
  add constraint github_finding_provenance_latest_entry_receipt_fk foreign key
    (latest_entry_receipt_id, organisation_id, latest_mapping_pack_id, check_id)
    references public.github_entry_materialisation_receipts(
      id, organisation_id, selected_mapping_pack_id, check_id) on delete restrict;
alter table public.github_finding_transitions
  add column entry_receipt_id uuid,
  add column check_id text,
  add constraint github_finding_transitions_receipt_check_shape check
    (entry_receipt_id is null or check_id is not null),
  add constraint github_finding_transitions_entry_receipt_fk foreign key
    (entry_receipt_id, organisation_id, mapping_pack_id, check_id)
    references public.github_entry_materialisation_receipts(
      id, organisation_id, selected_mapping_pack_id, check_id) on delete restrict;
alter table public.github_observations
  add constraint github_observations_id_check_key unique (id, organisation_id, check_id);
alter table public.github_official_compliance_results
  add constraint github_official_results_observation_check_fk foreign key
    (observation_id, organisation_id, check_id)
    references public.github_observations(id, organisation_id, check_id) on delete restrict;
alter table public.github_evidence_provenance
  add constraint github_evidence_provenance_observation_check_fk foreign key
    (observation_id, organisation_id, check_id)
    references public.github_observations(id, organisation_id, check_id) on delete restrict;
alter table public.github_finding_provenance
  add constraint github_finding_provenance_initial_observation_check_fk foreign key
    (initial_observation_id, organisation_id, check_id)
    references public.github_observations(id, organisation_id, check_id) on delete restrict,
  add constraint github_finding_provenance_latest_observation_check_fk foreign key
    (latest_observation_id, organisation_id, check_id)
    references public.github_observations(id, organisation_id, check_id) on delete restrict;
alter table public.github_finding_transitions
  add constraint github_finding_transitions_observation_check_fk foreign key
    (observation_id, organisation_id, check_id)
    references public.github_observations(id, organisation_id, check_id) on delete restrict;
alter table public.github_finding_transitions
  drop constraint github_finding_transitions_automated_reason_check,
  add constraint github_finding_transitions_automated_reason_check check (
    (observation_id is null and approval_id is null and entry_receipt_id is null
      and mapping_pack_id is null and mapping_version is null and actor_id is not null
      and reason not in ('failed_observation_created','failed_observation_refreshed',
        'failed_observation_reopened','fresh_pass_resolved'))
    or (observation_id is not null and
      ((approval_id is not null) <> (entry_receipt_id is not null))
      and mapping_pack_id is not null and mapping_version is not null
      and actor_id is null)
  );

create or replace function public.guard_github_finding_provenance_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'GitHub finding provenance cannot be deleted' using errcode = 'P0001';
  end if;
  if current_user <> 'postgres'
    or coalesce(pg_catalog.current_setting('compliancehub.github_materialiser', true), '') <> 'on'
  then
    raise exception 'GitHub finding provenance is server-managed' using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id
    or new.finding_id is distinct from old.finding_id
    or new.organisation_id is distinct from old.organisation_id
    or new.installation_id is distinct from old.installation_id
    or new.repository_id is distinct from old.repository_id
    or new.provider_repository_id is distinct from old.provider_repository_id
    or new.identity_key is distinct from old.identity_key
    or new.check_id is distinct from old.check_id
    or new.subject_id is distinct from old.subject_id
    or new.initial_collection_run_id is distinct from old.initial_collection_run_id
    or new.initial_observation_id is distinct from old.initial_observation_id
    or new.initial_approval_id is distinct from old.initial_approval_id
    or new.initial_entry_receipt_id is distinct from old.initial_entry_receipt_id
    or new.initial_mapping_pack_id is distinct from old.initial_mapping_pack_id
    or new.first_detected_at is distinct from old.first_detected_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'GitHub finding provenance identity is immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
alter function public.guard_github_finding_provenance_change() owner to postgres;

create or replace function public.materialise_github_approved_entries_inner_server(
  target_organisation_id uuid,
  target_collection_run_id uuid,
  target_mapping_version text,
  target_mapping_checksum text,
  target_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_pack_id uuid;
  effective_row record;
  source_pack_id uuid;
  source_entry_id uuid;
  consent_reviewer_id uuid;
  entry_receipt_id uuid;
  operational_owner_id uuid;
  run_row public.github_collection_runs;
  observation_row public.github_observations;
  mapping_row public.github_mapping_entries;
  previous_evidence public.github_evidence_provenance;
  finding_provenance public.github_finding_provenance;
  finding_row public.monitoring_findings;
  decision_value jsonb;
  decision_references text[];
  expected_kind text;
  evidence_identity text;
  finding_identity text;
  created_evidence_id uuid;
  created_finding_id uuid;
  decision_count integer;
  approved_count integer;
  evidence_created integer := 0;
  evidence_refreshed integer := 0;
  findings_created integer := 0;
  findings_refreshed integer := 0;
  findings_reopened integer := 0;
  findings_resolved integer := 0;
  skipped integer := 0;
  summary_value jsonb;
begin
  if target_organisation_id is null
    or target_collection_run_id is null
    or target_mapping_version is null
    or target_mapping_checksum is null
    or target_mapping_checksum !~ '^[0-9a-f]{64}$'
    or target_decisions is null
    or pg_catalog.jsonb_typeof(target_decisions) is distinct from 'array'
  then
    raise exception 'invalid GitHub materialisation request' using errcode = '22023';
  end if;

  decision_count := pg_catalog.jsonb_array_length(target_decisions);
  if decision_count > 100 then
    raise exception 'GitHub materialisation accepts at most 100 decisions'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-mapping-review:' || target_organisation_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-mapping-approval:' || target_organisation_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-materialisation-approval:' || target_organisation_id::text, 0)
  );

  select effective.mapping_pack_id into selected_pack_id
  from public.github_effective_mapping_entry_decisions effective
  where effective.organisation_id = target_organisation_id
  limit 1;
  if selected_pack_id is null or not exists (
    select 1 from public.github_mapping_packs pack
    where pack.id = selected_pack_id
      and pack.version = target_mapping_version
      and pack.checksum = target_mapping_checksum
      and pack.published_at is not null
      and pack.checksum = public.github_mapping_pack_checksum(pack.id)
  ) then
    raise exception 'selected GitHub mapping pack does not match the request'
      using errcode = '42501';
  end if;

  select run.*
  into run_row
  from public.github_collection_runs run
  where run.id = target_collection_run_id
    and run.organisation_id = target_organisation_id
  for update;
  if not found then
    raise exception 'GitHub collection run was not found in the active workspace'
      using errcode = '42501';
  end if;

  if run_row.observation_count <> 15 or (
    select pg_catalog.count(*) from public.github_observations observation
    where observation.collection_run_id = run_row.id
      and observation.organisation_id = target_organisation_id
      and observation.installation_id = run_row.installation_id
      and observation.repository_id = run_row.repository_id
      and observation.provider_repository_id = run_row.provider_repository_id
  ) <> 15 or (
    select pg_catalog.count(distinct observation.check_id)
    from public.github_observations observation
    join public.github_mapping_entries entry
      on entry.mapping_pack_id = selected_pack_id
      and entry.check_id = observation.check_id
      and entry.rule_version = observation.rule_version
    where observation.collection_run_id = run_row.id
      and observation.organisation_id = target_organisation_id
      and observation.installation_id = run_row.installation_id
      and observation.repository_id = run_row.repository_id
  ) <> 15 then
    raise exception 'materialisation requires the complete 15-check collection run'
      using errcode = '22023';
  end if;
  if (
    select pg_catalog.count(distinct (decision ->> 'observation_id'))
    from pg_catalog.jsonb_array_elements(target_decisions) as decisions(decision)
  ) <> decision_count then
    raise exception 'materialisation decisions contain duplicate observations'
      using errcode = '22023';
  end if;
  if (
    select pg_catalog.count(*)
    from public.github_observations observation
    where observation.collection_run_id = run_row.id
      and observation.organisation_id = target_organisation_id
      and observation.installation_id = run_row.installation_id
      and observation.repository_id = run_row.repository_id
      and observation.id in (
        select (decision ->> 'observation_id')::uuid
        from pg_catalog.jsonb_array_elements(target_decisions) as decisions(decision)
      )
  ) <> decision_count then
    raise exception 'materialisation decisions do not match the collection run observations'
      using errcode = '22023';
  end if;

  -- Validate the entire application decision set and every catalogue mapping
  -- before the first official record is written. A single missing requirement
  -- mapping therefore aborts the transaction without partial evidence.
  for decision_value in
    select decision
    from pg_catalog.jsonb_array_elements(target_decisions) as decisions(decision)
    order by decision ->> 'observation_id'
  loop
    if pg_catalog.jsonb_typeof(decision_value) <> 'object'
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(decision_value)
      ) <> 5
      or not (
        decision_value ?& array[
          'observation_id', 'treatment_kind', 'iso_control_references',
          'failure_severity', 'remediation'
        ]
      )
      or pg_catalog.jsonb_typeof(decision_value -> 'iso_control_references')
        is distinct from 'array'
    then
      raise exception 'invalid GitHub materialisation decision' using errcode = '22023';
    end if;

    select observation.*
    into observation_row
    from public.github_observations observation
    where observation.id = (decision_value ->> 'observation_id')::uuid
      and observation.organisation_id = target_organisation_id
      and observation.installation_id = run_row.installation_id
      and observation.repository_id = run_row.repository_id
      and observation.collection_run_id = run_row.id;
    if not found then
      raise exception 'materialisation decision observation ancestry is invalid'
        using errcode = '22023';
    end if;

    select entry.*
    into mapping_row
    from public.github_mapping_entries entry
    where entry.mapping_pack_id = selected_pack_id
      and entry.check_id = observation_row.check_id
      and entry.rule_version = observation_row.rule_version;
    if not found then
      raise exception 'observation does not match the selected GitHub mapping pack'
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.github_effective_mapping_entry_decisions effective
      where effective.organisation_id = target_organisation_id
        and effective.mapping_pack_id = selected_pack_id
        and effective.mapping_entry_id = mapping_row.id
        and effective.entry_digest = public.github_mapping_entry_digest(mapping_row.id)
        and effective.status = 'approved'
    ) then
      raise exception 'GitHub mapping entry is not currently approved'
        using errcode = '42501';
    end if;

    expected_kind := case observation_row.result::text
      when 'pass' then 'evidence'
      when 'fail' then 'finding'
      else 'explanatory'
    end;
    select coalesce(
      pg_catalog.array_agg(reference_value order by ordinal_value),
      array[]::text[]
    )
    into decision_references
    from pg_catalog.jsonb_array_elements_text(
      decision_value -> 'iso_control_references'
    ) with ordinality as supplied(reference_value, ordinal_value);

    if (decision_value ->> 'treatment_kind') is distinct from expected_kind
      or (mapping_row.treatments #>> array[observation_row.result::text, 'kind'])
        is distinct from expected_kind
      or decision_references is distinct from mapping_row.iso_control_references
      or (decision_value ->> 'failure_severity')
        is distinct from mapping_row.failure_severity::text
      or (decision_value ->> 'remediation') is distinct from mapping_row.remediation
    then
      raise exception 'application decision does not match the approved GitHub mapping entry'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from pg_catalog.unnest(mapping_row.iso_control_references)
        as references_list(reference_value)
      where not exists (
        select 1
        from public.requirements requirement
        join public.frameworks framework
          on framework.id = requirement.framework_id
        join public.requirement_control_mappings requirement_mapping
          on requirement_mapping.requirement_id = requirement.id
        join public.controls control
          on control.id = requirement_mapping.control_id
        where framework.slug = 'iso-27001'
          and framework.version = '2022'
          and framework.published_at is not null
          and requirement.code = pg_catalog.regexp_replace(
            reference_value,
            '^A[.]',
            ''
          )
      )
    ) then
      raise exception 'approved ISO requirement has no internal control mapping'
        using errcode = 'P0001';
    end if;
  end loop;

  select pg_catalog.count(*) into approved_count
  from public.github_observations observation
  join public.github_effective_mapping_entry_decisions effective
    on effective.organisation_id = target_organisation_id
   and effective.mapping_pack_id = selected_pack_id
   and effective.check_id = observation.check_id
   and effective.status = 'approved'
  where observation.collection_run_id = run_row.id
    and observation.organisation_id = target_organisation_id;
  if approved_count <> decision_count then
    raise exception 'decisions must cover every currently approved entry in the run'
      using errcode = '42501';
  end if;

  if decision_count = 0 then
    return pg_catalog.jsonb_build_object(
      'evidence_created', 0,
      'evidence_refreshed', 0,
      'findings_created', 0,
      'findings_refreshed', 0,
      'findings_reopened', 0,
      'findings_resolved', 0,
      'skipped', 0
    );
  end if;

  -- SECURITY DEFINER must not let a stale/caller-supplied sub leak into audit
  -- triggers. The service execution is automated; the approval lineage below
  -- records the human authorization separately and immutably.
  perform pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform pg_catalog.set_config('compliancehub.github_materialiser', 'on', true);
  perform pg_catalog.set_config('compliancehub.github_finding_transition', 'materialiser', true);

  -- Failed and rate-limited runs are valid immutable observations but can
  -- never affect official compliance state.
  if run_row.status::text not in ('succeeded', 'partial') then
    skipped := decision_count;
    summary_value := pg_catalog.jsonb_build_object(
      'evidence_created', evidence_created,
      'evidence_refreshed', evidence_refreshed,
      'findings_created', findings_created,
      'findings_refreshed', findings_refreshed,
      'findings_reopened', findings_reopened,
      'findings_resolved', findings_resolved,
      'skipped', skipped
    );
    insert into public.audit_events(
      organisation_id, actor_id, action, entity_type, entity_id, metadata
    ) values (
      target_organisation_id, null, 'github.materialise',
      'github_collection_runs', run_row.id::text,
      summary_value || pg_catalog.jsonb_build_object(
        'mapping_version', target_mapping_version,
        'mapping_checksum', target_mapping_checksum,
        'approval_id', null,
        'approval_scope', 'entry',
        'automated', true
      )
    );
    return summary_value;
  end if;

  for decision_value in
    select decision
    from pg_catalog.jsonb_array_elements(target_decisions) as decisions(decision)
    order by decision ->> 'observation_id'
  loop
    select observation.*
    into observation_row
    from public.github_observations observation
    where observation.id = (decision_value ->> 'observation_id')::uuid
      and observation.organisation_id = target_organisation_id
      and observation.installation_id = run_row.installation_id
      and observation.repository_id = run_row.repository_id
      and observation.collection_run_id = run_row.id;
    select entry.*
    into mapping_row
    from public.github_mapping_entries entry
    where entry.mapping_pack_id = selected_pack_id
      and entry.check_id = observation_row.check_id
      and entry.rule_version = observation_row.rule_version;
    select effective.* into effective_row
    from public.github_effective_mapping_entry_decisions effective
    where effective.organisation_id = target_organisation_id
      and effective.mapping_pack_id = selected_pack_id
      and effective.mapping_entry_id = mapping_row.id
      and effective.entry_digest = public.github_mapping_entry_digest(mapping_row.id)
      and effective.status = 'approved';
    if not found then
      raise exception 'GitHub mapping entry is no longer approved'
        using errcode = '42501';
    end if;
    if effective_row.source = 'entry_decision' then
      select decision.mapping_pack_id, decision.mapping_entry_id, decision.decided_by
      into source_pack_id, source_entry_id, consent_reviewer_id
      from public.github_mapping_entry_decisions decision
      where decision.id = effective_row.decision_id
        and decision.organisation_id = target_organisation_id;
    else
      select approval.mapping_pack_id, source_entry.id, approval.approved_by
      into source_pack_id, source_entry_id, consent_reviewer_id
      from public.github_mapping_approvals approval
      join public.github_mapping_entries source_entry
        on source_entry.mapping_pack_id = approval.mapping_pack_id
       and source_entry.check_id = mapping_row.check_id
       and public.github_mapping_entry_digest(source_entry.id) = effective_row.entry_digest
      where approval.id = effective_row.legacy_approval_id
        and approval.organisation_id = target_organisation_id
        and approval.revoked_at is null;
    end if;
    if source_entry_id is null or consent_reviewer_id is null then
      raise exception 'GitHub mapping consent source is unavailable'
        using errcode = '42501';
    end if;
    insert into public.github_entry_materialisation_receipts(
      organisation_id, selected_mapping_pack_id, selected_mapping_entry_id,
      check_id, source_mapping_pack_id, source_mapping_entry_id, entry_digest,
      entry_decision_id, legacy_approval_id
    ) values (
      target_organisation_id, selected_pack_id, mapping_row.id,
      mapping_row.check_id, source_pack_id, source_entry_id, effective_row.entry_digest,
      effective_row.decision_id, effective_row.legacy_approval_id
    ) on conflict do nothing;
    select receipt.id into entry_receipt_id
    from public.github_entry_materialisation_receipts receipt
    where receipt.organisation_id = target_organisation_id
      and receipt.selected_mapping_entry_id = mapping_row.id
      and receipt.entry_digest = effective_row.entry_digest
      and receipt.entry_decision_id is not distinct from effective_row.decision_id
      and receipt.legacy_approval_id is not distinct from effective_row.legacy_approval_id;
    if entry_receipt_id is null then
      raise exception 'GitHub mapping consent receipt is unavailable'
        using errcode = 'P0001';
    end if;
    select membership.user_id into operational_owner_id
    from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = consent_reviewer_id
    for key share;

    finding_identity := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_array(
            target_organisation_id,
            observation_row.provider_repository_id,
            observation_row.check_id
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    evidence_identity := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_array(
            target_organisation_id,
            observation_row.installation_id,
            observation_row.repository_id,
            observation_row.check_id,
            observation_row.subject_id,
            target_mapping_version
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    -- The advisory key is derived from stable provenance, not a possibly
    -- absent evidence/finding row, so first writers serialize correctly.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'github-compliance-identity:' || finding_identity,
        0
      )
    );

    if observation_row.result::text in ('unknown', 'not_applicable') then
      skipped := skipped + 1;
      continue;
    end if;

    if observation_row.result::text = 'pass' then
      if observation_row.fresh_until <= pg_catalog.now() then
        skipped := skipped + 1;
        continue;
      end if;

      if exists (
        select 1
        from public.github_evidence_provenance provenance
        where provenance.observation_id = observation_row.id
      ) then
        skipped := skipped + 1;
        continue;
      end if;

      select provenance.*
      into previous_evidence
      from public.github_evidence_provenance provenance
      where provenance.organisation_id = target_organisation_id
        and provenance.identity_key = evidence_identity
      order by provenance.observed_at desc, provenance.id desc
      limit 1
      for update;
      if found and previous_evidence.observed_at >= observation_row.observed_at then
        skipped := skipped + 1;
        continue;
      end if;

      insert into public.evidence(
        organisation_id, title, kind, url, description, owner_id,
        collected_on, valid_until, status, replaces_evidence_id, created_by
      ) values (
        target_organisation_id,
        pg_catalog.left('GitHub: ' || observation_row.title, 200),
        'link',
        observation_row.source_url,
        pg_catalog.left(
          observation_row.explanation || E'\n\nVerified from an approved immutable GitHub observation.',
          10000
        ),
        operational_owner_id,
        observation_row.observed_at::date,
        observation_row.fresh_until::date,
        'current',
        case when previous_evidence.id is null then null else previous_evidence.evidence_id end,
        consent_reviewer_id
      ) returning id into created_evidence_id;

      insert into public.github_evidence_provenance(
        evidence_id, organisation_id, installation_id, repository_id,
        collection_run_id, observation_id, approval_id, entry_receipt_id, mapping_pack_id,
        identity_key, check_id, rule_version, mapping_version,
        supersedes_evidence_id, observed_at, fresh_until
      ) values (
        created_evidence_id, target_organisation_id,
        observation_row.installation_id, observation_row.repository_id,
        run_row.id, observation_row.id, null, entry_receipt_id,
        selected_pack_id, evidence_identity,
        observation_row.check_id, observation_row.rule_version,
        target_mapping_version,
        case when previous_evidence.id is null then null else previous_evidence.evidence_id end,
        observation_row.observed_at, observation_row.fresh_until
      );

      insert into public.evidence_links(
        organisation_id, evidence_id, control_id, created_by
      )
      select distinct
        target_organisation_id,
        created_evidence_id,
        control.id,
        consent_reviewer_id
      from pg_catalog.unnest(mapping_row.iso_control_references)
        as references_list(reference_value)
      join public.frameworks framework
        on framework.slug = 'iso-27001'
       and framework.version = '2022'
       and framework.published_at is not null
      join public.requirements requirement
        on requirement.framework_id = framework.id
       and requirement.code = pg_catalog.regexp_replace(reference_value, '^A[.]', '')
      join public.requirement_control_mappings requirement_mapping
        on requirement_mapping.requirement_id = requirement.id
      join public.controls control
        on control.id = requirement_mapping.control_id;

      if previous_evidence.id is null then
        evidence_created := evidence_created + 1;
      else
        if exists (
          select 1
          from public.evidence existing_evidence
          where existing_evidence.id = previous_evidence.evidence_id
            and existing_evidence.organisation_id = target_organisation_id
            and existing_evidence.status::text not in ('superseded', 'withdrawn')
        ) then
          update public.evidence
          set status = 'superseded'
          where id = previous_evidence.evidence_id
            and organisation_id = target_organisation_id;
        end if;
        insert into public.audit_events(
          organisation_id, actor_id, action, entity_type, entity_id, metadata
        ) values (
          target_organisation_id, null,
          'github.evidence_superseded', 'evidence',
          previous_evidence.evidence_id::text,
          pg_catalog.jsonb_build_object(
            'replacement_evidence_id', created_evidence_id,
            'identity_key', evidence_identity,
            'approval_id', null,
            'approved_by', consent_reviewer_id,
            'automated', true
          )
        );
        evidence_refreshed := evidence_refreshed + 1;
      end if;

      select provenance.*
      into finding_provenance
      from public.github_finding_provenance provenance
      where provenance.organisation_id = target_organisation_id
        and provenance.identity_key = finding_identity
      for update;
      if found
        and observation_row.observed_at > finding_provenance.most_recent_detected_at
      then
        select finding.*
        into finding_row
        from public.monitoring_findings finding
        where finding.id = finding_provenance.finding_id
          and finding.organisation_id = target_organisation_id
        for update;
        if found and finding_row.status::text <> 'resolved' then
          update public.monitoring_findings
          set status = 'resolved',
              resolved_at = observation_row.observed_at,
              mapping_version = target_mapping_version
          where id = finding_row.id
            and organisation_id = target_organisation_id;

          update public.github_finding_provenance
          set latest_installation_id = observation_row.installation_id,
              latest_repository_id = observation_row.repository_id,
              latest_collection_run_id = run_row.id,
              latest_observation_id = observation_row.id,
              latest_approval_id = null,
              latest_entry_receipt_id = entry_receipt_id,
              latest_mapping_pack_id = selected_pack_id,
              mapping_version = target_mapping_version,
              resolved_by_installation_id = observation_row.installation_id,
              resolved_by_repository_id = observation_row.repository_id,
              resolved_by_collection_run_id = run_row.id,
              resolved_by_observation_id = observation_row.id,
              resolved_at = observation_row.observed_at,
              updated_at = pg_catalog.now()
          where id = finding_provenance.id
            and organisation_id = target_organisation_id;

          insert into public.github_finding_transitions(
            organisation_id, finding_id, actor_id, from_status, to_status,
            reason, observation_id, approval_id, entry_receipt_id, check_id, mapping_pack_id,
            mapping_version, occurred_at
          ) values (
            target_organisation_id, finding_row.id, null,
            finding_row.status, 'resolved', 'fresh_pass_resolved',
            observation_row.id, null, entry_receipt_id, observation_row.check_id, selected_pack_id,
            target_mapping_version, observation_row.observed_at
          );
          findings_resolved := findings_resolved + 1;
        end if;
      end if;
      continue;
    end if;

    -- A fail creates one stable finding, reopens a previously verified finding,
    -- or refreshes detection while preserving an unresolved human state.
    if exists (
      select 1
      from public.github_official_compliance_results newer_result
      where newer_result.organisation_id = target_organisation_id
        and newer_result.provider_repository_id = observation_row.provider_repository_id
        and newer_result.check_id = observation_row.check_id
        and newer_result.observed_at >= observation_row.observed_at
    ) then
      skipped := skipped + 1;
      continue;
    end if;
    select provenance.*
    into finding_provenance
    from public.github_finding_provenance provenance
    where provenance.organisation_id = target_organisation_id
      and provenance.identity_key = finding_identity
    for update;

    if found and (
      finding_provenance.most_recent_detected_at >= observation_row.observed_at
      or exists (
        select 1
        from public.github_observations latest_observation
        where latest_observation.id = finding_provenance.latest_observation_id
          and latest_observation.organisation_id = target_organisation_id
          and latest_observation.observed_at >= observation_row.observed_at
      )
    ) then
      skipped := skipped + 1;
      continue;
    end if;

    if not found then
      insert into public.monitoring_findings(
        organisation_id, source_id, check_id, control_ref, subject_type,
        subject_id, severity, title, detail, status, detected_at,
        resolved_at, finding_origin, provider_repository_id, mapping_version
      ) values (
        target_organisation_id, null, observation_row.check_id,
        pg_catalog.array_to_string(mapping_row.iso_control_references, ', '),
        observation_row.subject_type, observation_row.subject_id,
        mapping_row.failure_severity, observation_row.title,
        pg_catalog.left(
          observation_row.explanation || E'\n\nApproved remediation: ' || mapping_row.remediation,
          4000
        ),
        'open', observation_row.observed_at, null, 'github',
        observation_row.provider_repository_id, target_mapping_version
      ) returning id into created_finding_id;

      insert into public.github_finding_provenance(
        finding_id, organisation_id, installation_id, repository_id,
        provider_repository_id, identity_key, check_id, mapping_version, subject_id,
        initial_collection_run_id, initial_observation_id,
        initial_approval_id, initial_entry_receipt_id, initial_mapping_pack_id,
        latest_installation_id, latest_repository_id,
        latest_collection_run_id, latest_observation_id,
        latest_approval_id, latest_entry_receipt_id, latest_mapping_pack_id,
        latest_failed_installation_id, latest_failed_repository_id,
        latest_failed_collection_run_id, latest_failed_observation_id,
        first_detected_at, most_recent_detected_at
      ) values (
        created_finding_id, target_organisation_id,
        observation_row.installation_id, observation_row.repository_id,
        observation_row.provider_repository_id, finding_identity,
        observation_row.check_id, target_mapping_version, observation_row.subject_id,
        run_row.id, observation_row.id, null, entry_receipt_id,
        selected_pack_id,
        observation_row.installation_id, observation_row.repository_id,
        run_row.id, observation_row.id,
        null, entry_receipt_id, selected_pack_id,
        observation_row.installation_id, observation_row.repository_id,
        run_row.id, observation_row.id,
        observation_row.observed_at, observation_row.observed_at
      );

      insert into public.github_finding_transitions(
        organisation_id, finding_id, actor_id, from_status, to_status,
        reason, observation_id, approval_id, entry_receipt_id, check_id, mapping_pack_id,
        mapping_version, occurred_at
      ) values (
        target_organisation_id, created_finding_id, null,
        null, 'open', 'failed_observation_created',
        observation_row.id, null, entry_receipt_id, observation_row.check_id, selected_pack_id,
        target_mapping_version, observation_row.observed_at
      );
      findings_created := findings_created + 1;
      continue;
    end if;

    select finding.*
    into finding_row
    from public.monitoring_findings finding
    where finding.id = finding_provenance.finding_id
      and finding.organisation_id = target_organisation_id
    for update;
    if not found then
      raise exception 'GitHub finding provenance is incomplete' using errcode = 'P0001';
    end if;

    update public.monitoring_findings
    set control_ref = pg_catalog.array_to_string(mapping_row.iso_control_references, ', '),
        subject_type = observation_row.subject_type,
        subject_id = observation_row.subject_id,
        severity = mapping_row.failure_severity,
        title = observation_row.title,
        detail = pg_catalog.left(
          observation_row.explanation || E'\n\nApproved remediation: ' || mapping_row.remediation,
          4000
        ),
        status = case
          when finding_row.status::text = 'resolved'
            then 'open'::public.monitor_finding_status
          else finding_row.status
        end,
        detected_at = observation_row.observed_at,
        resolved_at = null,
        mapping_version = target_mapping_version
    where id = finding_row.id
      and organisation_id = target_organisation_id;

    update public.github_finding_provenance
    set latest_installation_id = observation_row.installation_id,
        latest_repository_id = observation_row.repository_id,
        latest_collection_run_id = run_row.id,
        latest_observation_id = observation_row.id,
        latest_approval_id = null,
        latest_entry_receipt_id = entry_receipt_id,
        latest_mapping_pack_id = selected_pack_id,
        mapping_version = target_mapping_version,
        latest_failed_installation_id = observation_row.installation_id,
        latest_failed_repository_id = observation_row.repository_id,
        latest_failed_collection_run_id = run_row.id,
        latest_failed_observation_id = observation_row.id,
        most_recent_detected_at = observation_row.observed_at,
        resolved_by_installation_id = null,
        resolved_by_repository_id = null,
        resolved_by_collection_run_id = null,
        resolved_by_observation_id = null,
        resolved_at = null,
        updated_at = pg_catalog.now()
    where id = finding_provenance.id
      and organisation_id = target_organisation_id;

    if finding_row.status::text = 'resolved' then
      insert into public.github_finding_transitions(
        organisation_id, finding_id, actor_id, from_status, to_status,
        reason, observation_id, approval_id, entry_receipt_id, check_id, mapping_pack_id,
        mapping_version, occurred_at
      ) values (
        target_organisation_id, finding_row.id, null,
        finding_row.status, 'open', 'failed_observation_reopened',
        observation_row.id, null, entry_receipt_id, observation_row.check_id, selected_pack_id,
        target_mapping_version, observation_row.observed_at
      );
      findings_reopened := findings_reopened + 1;
    else
      insert into public.github_finding_transitions(
        organisation_id, finding_id, actor_id, from_status, to_status,
        reason, observation_id, approval_id, entry_receipt_id, check_id, mapping_pack_id,
        mapping_version, occurred_at
      ) values (
        target_organisation_id, finding_row.id, null,
        finding_row.status, finding_row.status, 'failed_observation_refreshed',
        observation_row.id, null, entry_receipt_id, observation_row.check_id, selected_pack_id,
        target_mapping_version, observation_row.observed_at
      );
      findings_refreshed := findings_refreshed + 1;
    end if;
  end loop;

  summary_value := pg_catalog.jsonb_build_object(
    'evidence_created', evidence_created,
    'evidence_refreshed', evidence_refreshed,
    'findings_created', findings_created,
    'findings_refreshed', findings_refreshed,
    'findings_reopened', findings_reopened,
    'findings_resolved', findings_resolved,
    'skipped', skipped
  );
  insert into public.audit_events(
    organisation_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    target_organisation_id, null, 'github.materialise',
    'github_collection_runs', run_row.id::text,
    summary_value || pg_catalog.jsonb_build_object(
      'mapping_version', target_mapping_version,
      'mapping_checksum', target_mapping_checksum,
      'approval_id', null,
      'approval_scope', 'entry',
      'automated', true
    )
  );
  return summary_value;
end;
$$;
alter function public.materialise_github_approved_entries_inner_server(uuid,uuid,text,text,jsonb) owner to postgres;
revoke all on function public.materialise_github_approved_entries_inner_server(uuid,uuid,text,text,jsonb)
  from public, anon, authenticated, service_role;

create function public.materialise_github_approved_entries_server(
  target_organisation_id uuid, target_collection_run_id uuid,
  target_mapping_version text, target_mapping_checksum text, target_decisions jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  summary_value jsonb;
  expected_count integer;
  matching_count integer;
  run_status public.github_collection_status;
begin
  summary_value := public.materialise_github_approved_entries_inner_server(
    target_organisation_id, target_collection_run_id,
    target_mapping_version, target_mapping_checksum, target_decisions);
  select run.status into run_status
  from public.github_collection_runs run
  where run.id = target_collection_run_id
    and run.organisation_id = target_organisation_id;
  if run_status not in ('succeeded', 'partial') then
    return summary_value;
  end if;
  insert into public.github_official_compliance_results(
    organisation_id, installation_id, repository_id, provider_repository_id,
    collection_run_id, observation_id, approval_id, entry_receipt_id,
    mapping_pack_id, mapping_version, mapping_checksum, check_id, rule_version,
    outcome, failure_severity, catalogue_summary, observed_at, fresh_until,
    evidence_id, finding_id
  )
  select observation.organisation_id, observation.installation_id,
    observation.repository_id, observation.provider_repository_id,
    observation.collection_run_id, observation.id, null, receipt.id,
    pack.id, pack.version, pack.checksum, observation.check_id,
    observation.rule_version, observation.result,
    case when observation.result = 'fail' then entry.failure_severity else null end,
    entry.treatments #>> array[observation.result::text, 'summary'],
    observation.observed_at, observation.fresh_until,
    evidence_provenance.evidence_id, finding_transition.finding_id
  from pg_catalog.jsonb_array_elements(target_decisions) supplied(decision)
  join public.github_observations observation
    on observation.id = (supplied.decision ->> 'observation_id')::uuid
   and observation.organisation_id = target_organisation_id
   and observation.collection_run_id = target_collection_run_id
  join public.github_effective_mapping_entry_decisions effective
    on effective.organisation_id = target_organisation_id
   and effective.check_id = observation.check_id
   and effective.status = 'approved'
  join public.github_mapping_packs pack
    on pack.id = effective.mapping_pack_id
   and pack.version = target_mapping_version
   and pack.checksum = target_mapping_checksum
  join public.github_mapping_entries entry
    on entry.id = effective.mapping_entry_id
   and entry.mapping_pack_id = pack.id
   and entry.rule_version = observation.rule_version
  join public.github_entry_materialisation_receipts receipt
    on receipt.organisation_id = target_organisation_id
   and receipt.selected_mapping_pack_id = pack.id
   and receipt.selected_mapping_entry_id = entry.id
   and receipt.entry_digest = effective.entry_digest
   and receipt.entry_decision_id is not distinct from effective.decision_id
   and receipt.legacy_approval_id is not distinct from effective.legacy_approval_id
  left join public.github_evidence_provenance evidence_provenance
    on evidence_provenance.observation_id = observation.id
  left join lateral (
    select transition.finding_id
    from public.github_finding_transitions transition
    where transition.organisation_id = observation.organisation_id
      and transition.observation_id = observation.id
    order by transition.occurred_at desc, transition.id desc
    limit 1
  ) finding_transition on true
  on conflict (observation_id) do nothing;

  expected_count := pg_catalog.jsonb_array_length(target_decisions);
  select pg_catalog.count(*) into matching_count
  from pg_catalog.jsonb_array_elements(target_decisions) supplied(decision)
  join public.github_observations observation
    on observation.id = (supplied.decision ->> 'observation_id')::uuid
   and observation.organisation_id = target_organisation_id
   and observation.collection_run_id = target_collection_run_id
  join public.github_official_compliance_results result
    on result.observation_id = observation.id
   and result.organisation_id = target_organisation_id
   and result.collection_run_id = target_collection_run_id
  left join public.github_entry_materialisation_receipts receipt
    on receipt.id = result.entry_receipt_id
   and receipt.organisation_id = result.organisation_id
   and receipt.selected_mapping_pack_id = result.mapping_pack_id
   and receipt.check_id = result.check_id
  join public.github_mapping_entries entry
    on entry.mapping_pack_id = result.mapping_pack_id
   and entry.check_id = result.check_id
   and entry.rule_version = result.rule_version
  left join public.github_mapping_approvals legacy_approval
    on legacy_approval.id = result.approval_id
   and legacy_approval.organisation_id = result.organisation_id
   and legacy_approval.mapping_pack_id = result.mapping_pack_id
  left join public.github_evidence_provenance evidence_provenance
    on evidence_provenance.observation_id = observation.id
  left join lateral (
    select transition.finding_id
    from public.github_finding_transitions transition
    where transition.organisation_id = observation.organisation_id
      and transition.observation_id = observation.id
    order by transition.occurred_at desc, transition.id desc
    limit 1
  ) finding_transition on true
  where (receipt.id is not null or legacy_approval.id is not null)
    and (receipt.id is null or receipt.selected_mapping_entry_id = entry.id)
    and result.mapping_version = target_mapping_version
    and result.mapping_checksum = target_mapping_checksum
    and result.check_id = observation.check_id
    and result.rule_version = observation.rule_version
    and result.outcome = observation.result
    and result.failure_severity is not distinct from
      case when observation.result = 'fail' then entry.failure_severity else null end
    and result.catalogue_summary = entry.treatments #>> array[observation.result::text, 'summary']
    and result.observed_at = observation.observed_at
    and result.fresh_until = observation.fresh_until
    and result.evidence_id is not distinct from evidence_provenance.evidence_id
    and result.finding_id is not distinct from finding_transition.finding_id;
  if expected_count <> matching_count then
    raise exception 'official GitHub result ledger is incomplete or conflicts'
      using errcode = 'P0001';
  end if;
  return summary_value;
end;
$$;
alter function public.materialise_github_approved_entries_server(uuid,uuid,text,text,jsonb)
  owner to postgres;
revoke all on function public.materialise_github_approved_entries_server(uuid,uuid,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.materialise_github_approved_entries_server(uuid,uuid,text,text,jsonb)
  to service_role;

-- Preserve the old lifecycle implementation for historical all-legacy calls,
-- but make its public service boundary consult today's effective decisions.
alter function public.materialise_github_observations_server(uuid,uuid,text,text,jsonb)
  rename to materialise_github_observations_legacy_unchecked;
revoke all on function public.materialise_github_observations_legacy_unchecked(uuid,uuid,text,text,jsonb)
  from public, anon, authenticated, service_role;

create function public.materialise_github_observations_server(
  target_organisation_id uuid, target_collection_run_id uuid,
  target_mapping_version text, target_mapping_checksum text, target_decisions jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  selected_pack_id uuid;
  decision_count integer;
  legacy_count integer;
begin
  if target_organisation_id is null or target_collection_run_id is null
    or target_mapping_version is null or target_mapping_checksum is null
    or target_decisions is null or pg_catalog.jsonb_typeof(target_decisions) <> 'array'
  then
    raise exception 'invalid GitHub materialisation request' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-mapping-review:' || target_organisation_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-mapping-approval:' || target_organisation_id::text, 0));
  decision_count := pg_catalog.jsonb_array_length(target_decisions);
  select effective.mapping_pack_id into selected_pack_id
  from public.github_effective_mapping_entry_decisions effective
  where effective.organisation_id = target_organisation_id
  limit 1;
  if selected_pack_id is null or not exists (
    select 1 from public.github_mapping_packs pack
    where pack.id = selected_pack_id and pack.version = target_mapping_version
      and pack.checksum = target_mapping_checksum and pack.published_at is not null
  ) then
    raise exception 'selected GitHub mapping pack does not match the request'
      using errcode = '42501';
  end if;
  select pg_catalog.count(*) into legacy_count
  from pg_catalog.jsonb_array_elements(target_decisions) supplied(decision)
  join public.github_observations observation
    on observation.id = (supplied.decision ->> 'observation_id')::uuid
   and observation.organisation_id = target_organisation_id
   and observation.collection_run_id = target_collection_run_id
  join public.github_effective_mapping_entry_decisions effective
    on effective.organisation_id = target_organisation_id
   and effective.mapping_pack_id = selected_pack_id
   and effective.check_id = observation.check_id
   and effective.status = 'approved' and effective.source = 'legacy_pack'
  join public.github_mapping_approvals approval
    on approval.id = effective.legacy_approval_id
   and approval.organisation_id = target_organisation_id
   and approval.mapping_pack_id = selected_pack_id
   and approval.revoked_at is null;
  if legacy_count <> decision_count then
    raise exception 'an entry decision changed the old whole-pack approval'
      using errcode = '42501';
  end if;
  return public.materialise_github_observations_legacy_unchecked(
    target_organisation_id, target_collection_run_id,
    target_mapping_version, target_mapping_checksum, target_decisions);
end;
$$;
alter function public.materialise_github_observations_server(uuid,uuid,text,text,jsonb) owner to postgres;
revoke all on function public.materialise_github_observations_server(uuid,uuid,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.materialise_github_observations_server(uuid,uuid,text,text,jsonb)
  to service_role;
