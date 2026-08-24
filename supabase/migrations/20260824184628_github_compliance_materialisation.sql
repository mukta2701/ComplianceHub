-- Official GitHub compliance records are materialised only from immutable
-- observations and an active Owner-approved mapping pack. Shadow collection
-- remains independent; this migration does not write readiness, SoA,
-- assessment, risk, or leadership-report state.

alter type public.monitor_finding_status
  add value if not exists 'in_progress' after 'acknowledged';
alter type public.monitor_finding_status
  add value if not exists 'exception_requested' after 'in_progress';
alter type public.monitor_finding_status
  add value if not exists 'risk_accepted' after 'exception_requested';
alter type public.task_source add value if not exists 'github';

create or replace function public.github_iso_reference_array_is_valid(references_value text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.cardinality(references_value), 0) between 1 and 4
    and not exists (
      select 1
      from pg_catalog.unnest(references_value) reference_value
      where reference_value !~ '^A[.](5|6|7|8)[.][0-9]{1,2}$'
    )
    and pg_catalog.cardinality(references_value) = (
      select pg_catalog.count(distinct reference_value)::integer
      from pg_catalog.unnest(references_value) reference_value
    );
$$;

create or replace function public.github_mapping_treatments_are_valid(treatments_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(treatments_value) = 'object'
    and (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(treatments_value)
    ) = 4
    and treatments_value ?& array['pass','fail','unknown','not_applicable']
    and pg_catalog.jsonb_typeof(treatments_value -> 'pass') = 'object'
    and pg_catalog.jsonb_typeof(treatments_value -> 'fail') = 'object'
    and pg_catalog.jsonb_typeof(treatments_value -> 'unknown') = 'object'
    and pg_catalog.jsonb_typeof(treatments_value -> 'not_applicable') = 'object'
    and (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(treatments_value -> 'pass')
    ) = 2
    and (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(treatments_value -> 'fail')
    ) = 2
    and (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(treatments_value -> 'unknown')
    ) = 2
    and (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(treatments_value -> 'not_applicable')
    ) = 2
    and (treatments_value -> 'pass') ?& array['kind','summary']
    and (treatments_value -> 'fail') ?& array['kind','summary']
    and (treatments_value -> 'unknown') ?& array['kind','summary']
    and (treatments_value -> 'not_applicable') ?& array['kind','summary']
    and treatments_value #>> '{pass,kind}' = 'evidence'
    and treatments_value #>> '{fail,kind}' = 'finding'
    and treatments_value #>> '{unknown,kind}' = 'explanatory'
    and treatments_value #>> '{not_applicable,kind}' = 'explanatory'
    and pg_catalog.char_length(treatments_value #>> '{pass,summary}') between 1 and 280
    and pg_catalog.char_length(treatments_value #>> '{fail,summary}') between 1 and 280
    and pg_catalog.char_length(treatments_value #>> '{unknown,summary}') between 1 and 280
    and pg_catalog.char_length(treatments_value #>> '{not_applicable,summary}') between 1 and 280
    and (treatments_value #>> '{pass,summary}') !~ '[<>[:cntrl:]]'
    and (treatments_value #>> '{fail,summary}') !~ '[<>[:cntrl:]]'
    and (treatments_value #>> '{unknown,summary}') !~ '[<>[:cntrl:]]'
    and (treatments_value #>> '{not_applicable,summary}') !~ '[<>[:cntrl:]]';
$$;

revoke all on function public.github_iso_reference_array_is_valid(text[])
from public, anon, authenticated, service_role;
revoke all on function public.github_mapping_treatments_are_valid(jsonb)
from public, anon, authenticated, service_role;

create table public.github_mapping_packs (
  id uuid primary key default extensions.gen_random_uuid(),
  version text not null unique check (
    pg_catalog.char_length(version) between 1 and 80
    and version !~ '[<>[:cntrl:]]'
  ),
  title text not null check (
    pg_catalog.char_length(title) between 1 and 160
    and title !~ '[<>[:cntrl:]]'
  ),
  checksum text unique check (checksum is null or checksum ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint github_mapping_packs_sealed_state_check check (
    (checksum is null and published_at is null)
    or (checksum is not null and published_at is not null)
  ),
  constraint github_mapping_packs_id_version_key unique (id, version),
  constraint github_mapping_packs_id_checksum_key unique (id, checksum),
  constraint github_mapping_packs_id_identity_key unique (id, version, checksum)
);

create table public.github_mapping_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  mapping_pack_id uuid not null references public.github_mapping_packs(id) on delete restrict,
  check_id text not null check (
    pg_catalog.char_length(check_id) between 1 and 120
    and check_id !~ '[<>[:cntrl:]]'
  ),
  rule_version text not null check (
    pg_catalog.char_length(rule_version) between 1 and 80
    and rule_version !~ '[<>[:cntrl:]]'
  ),
  iso_control_references text[] not null check (
    public.github_iso_reference_array_is_valid(iso_control_references)
  ),
  failure_severity public.monitor_severity not null,
  remediation text not null check (
    pg_catalog.char_length(remediation) between 1 and 400
    and remediation !~ '[<>[:cntrl:]]'
  ),
  treatments jsonb not null check (
    public.github_mapping_treatments_are_valid(treatments)
  ),
  created_at timestamptz not null default pg_catalog.now(),
  constraint github_mapping_entries_pack_check_key unique (mapping_pack_id, check_id),
  constraint github_mapping_entries_id_pack_key unique (id, mapping_pack_id)
);

create index github_mapping_entries_pack_idx
on public.github_mapping_entries(mapping_pack_id, check_id);

create table public.github_mapping_approvals (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  mapping_pack_id uuid not null references public.github_mapping_packs(id) on delete restrict,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_at timestamptz not null default pg_catalog.now(),
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint github_mapping_approvals_id_organisation_key unique (id, organisation_id),
  constraint github_mapping_approvals_id_full_ancestry_key
    unique (id, organisation_id, mapping_pack_id),
  constraint github_mapping_approvals_revocation_check check (
    (revoked_by is null and revoked_at is null)
    or (revoked_by is not null and revoked_at is not null and revoked_at >= approved_at)
  )
);

create unique index github_mapping_approvals_one_active_org_idx
on public.github_mapping_approvals(organisation_id)
where revoked_at is null;
create index github_mapping_approvals_org_history_idx
on public.github_mapping_approvals(organisation_id, approved_at desc, id desc);
create index github_mapping_approvals_pack_idx
on public.github_mapping_approvals(mapping_pack_id);

alter table public.github_observations
  add constraint github_observations_id_materialisation_ancestry_key
  unique (id, organisation_id, installation_id, repository_id, collection_run_id);

create table public.github_evidence_provenance (
  id uuid primary key default extensions.gen_random_uuid(),
  evidence_id uuid not null,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  repository_id uuid not null,
  collection_run_id uuid not null,
  observation_id uuid not null,
  approval_id uuid not null,
  mapping_pack_id uuid not null references public.github_mapping_packs(id) on delete restrict,
  identity_key text not null check (identity_key ~ '^[0-9a-f]{64}$'),
  check_id text not null check (pg_catalog.char_length(check_id) between 1 and 120),
  rule_version text not null check (pg_catalog.char_length(rule_version) between 1 and 80),
  mapping_version text not null check (pg_catalog.char_length(mapping_version) between 1 and 80),
  supersedes_evidence_id uuid,
  observed_at timestamptz not null,
  fresh_until timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint github_evidence_provenance_id_organisation_key unique (id, organisation_id),
  constraint github_evidence_provenance_evidence_key unique (evidence_id),
  constraint github_evidence_provenance_observation_key unique (observation_id),
  constraint github_evidence_provenance_evidence_tenant_fk
    foreign key (evidence_id, organisation_id)
    references public.evidence(id, organisation_id) on delete restrict,
  constraint github_evidence_provenance_repository_ancestry_fk
    foreign key (repository_id, organisation_id, installation_id)
    references public.github_repositories(id, organisation_id, installation_id) on delete restrict,
  constraint github_evidence_provenance_run_ancestry_fk
    foreign key (collection_run_id, organisation_id, installation_id, repository_id)
    references public.github_collection_runs(id, organisation_id, installation_id, repository_id) on delete restrict,
  constraint github_evidence_provenance_observation_ancestry_fk
    foreign key (observation_id, organisation_id, installation_id, repository_id, collection_run_id)
    references public.github_observations(id, organisation_id, installation_id, repository_id, collection_run_id) on delete restrict,
  constraint github_evidence_provenance_approval_ancestry_fk
    foreign key (approval_id, organisation_id, mapping_pack_id)
    references public.github_mapping_approvals(id, organisation_id, mapping_pack_id) on delete restrict,
  constraint github_evidence_provenance_supersedes_tenant_fk
    foreign key (supersedes_evidence_id, organisation_id)
    references public.evidence(id, organisation_id) on delete restrict,
  constraint github_evidence_provenance_freshness_check check (fresh_until > observed_at)
);

create unique index github_evidence_provenance_single_successor_idx
on public.github_evidence_provenance(supersedes_evidence_id)
where supersedes_evidence_id is not null;
create index github_evidence_provenance_identity_latest_idx
on public.github_evidence_provenance(organisation_id, identity_key, observed_at desc, id desc);
create index github_evidence_provenance_run_idx
on public.github_evidence_provenance(collection_run_id, organisation_id);
create index github_evidence_provenance_approval_idx
on public.github_evidence_provenance(approval_id, organisation_id, mapping_pack_id);

alter table public.monitoring_findings
  drop constraint monitoring_findings_dedup_key,
  add column finding_origin text not null default 'legacy',
  add column provider_repository_id bigint,
  add column mapping_version text not null default 'legacy';

alter table public.monitoring_findings
  add column stable_subject_identity text generated always as (
    case
      when finding_origin = 'github' then provider_repository_id::text
      else subject_id
    end
  ) stored,
  add constraint monitoring_findings_origin_check
    check (finding_origin in ('legacy', 'github')),
  add constraint monitoring_findings_mapping_version_check check (
    pg_catalog.char_length(mapping_version) between 1 and 80
    and mapping_version !~ '[<>[:cntrl:]]'
  ),
  add constraint monitoring_findings_identity_shape_check check (
    (
      finding_origin = 'legacy'
      and provider_repository_id is null
      and mapping_version = 'legacy'
    )
    or (
      finding_origin = 'github'
      and provider_repository_id > 0
      and mapping_version <> 'legacy'
    )
  ),
  add constraint monitoring_findings_origin_dedup_key
    unique (
      organisation_id, finding_origin, stable_subject_identity,
      check_id
    );

create table public.github_finding_provenance (
  id uuid primary key default extensions.gen_random_uuid(),
  finding_id uuid not null,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  repository_id uuid not null,
  provider_repository_id bigint not null check (provider_repository_id > 0),
  identity_key text not null check (identity_key ~ '^[0-9a-f]{64}$'),
  check_id text not null check (pg_catalog.char_length(check_id) between 1 and 120),
  mapping_version text not null check (
    pg_catalog.char_length(mapping_version) between 1 and 80
    and mapping_version !~ '[<>[:cntrl:]]'
  ),
  subject_id text not null check (pg_catalog.char_length(subject_id) between 1 and 200),
  initial_collection_run_id uuid not null,
  initial_observation_id uuid not null,
  initial_approval_id uuid not null,
  initial_mapping_pack_id uuid not null references public.github_mapping_packs(id) on delete restrict,
  latest_installation_id uuid not null,
  latest_repository_id uuid not null,
  latest_collection_run_id uuid not null,
  latest_observation_id uuid not null,
  latest_approval_id uuid not null,
  latest_mapping_pack_id uuid not null references public.github_mapping_packs(id) on delete restrict,
  latest_failed_installation_id uuid not null,
  latest_failed_repository_id uuid not null,
  latest_failed_collection_run_id uuid not null,
  latest_failed_observation_id uuid not null,
  resolved_by_installation_id uuid,
  resolved_by_repository_id uuid,
  resolved_by_collection_run_id uuid,
  resolved_by_observation_id uuid,
  first_detected_at timestamptz not null,
  most_recent_detected_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint github_finding_provenance_id_organisation_key unique (id, organisation_id),
  constraint github_finding_provenance_finding_key unique (finding_id),
  constraint github_finding_provenance_org_identity_key unique (organisation_id, identity_key),
  constraint github_finding_provenance_stable_identity_key unique (
    organisation_id, provider_repository_id, check_id
  ),
  constraint github_finding_provenance_finding_tenant_fk
    foreign key (finding_id, organisation_id)
    references public.monitoring_findings(id, organisation_id) on delete restrict,
  constraint github_finding_provenance_repository_ancestry_fk
    foreign key (repository_id, organisation_id, installation_id, provider_repository_id)
    references public.github_repositories(id, organisation_id, installation_id, provider_repository_id) on delete restrict,
  constraint github_finding_provenance_initial_run_ancestry_fk
    foreign key (initial_collection_run_id, organisation_id, installation_id, repository_id)
    references public.github_collection_runs(id, organisation_id, installation_id, repository_id) on delete restrict,
  constraint github_finding_provenance_initial_observation_ancestry_fk
    foreign key (initial_observation_id, organisation_id, installation_id, repository_id, initial_collection_run_id)
    references public.github_observations(id, organisation_id, installation_id, repository_id, collection_run_id) on delete restrict,
  constraint github_finding_provenance_initial_approval_ancestry_fk
    foreign key (initial_approval_id, organisation_id, initial_mapping_pack_id)
    references public.github_mapping_approvals(id, organisation_id, mapping_pack_id) on delete restrict,
  constraint github_finding_provenance_latest_run_ancestry_fk
    foreign key (latest_collection_run_id, organisation_id, latest_installation_id, latest_repository_id)
    references public.github_collection_runs(id, organisation_id, installation_id, repository_id) on delete restrict,
  constraint github_finding_provenance_latest_repository_ancestry_fk
    foreign key (latest_repository_id, organisation_id, latest_installation_id, provider_repository_id)
    references public.github_repositories(id, organisation_id, installation_id, provider_repository_id) on delete restrict,
  constraint github_finding_provenance_latest_observation_ancestry_fk
    foreign key (latest_observation_id, organisation_id, latest_installation_id, latest_repository_id, latest_collection_run_id)
    references public.github_observations(id, organisation_id, installation_id, repository_id, collection_run_id) on delete restrict,
  constraint github_finding_provenance_latest_approval_ancestry_fk
    foreign key (latest_approval_id, organisation_id, latest_mapping_pack_id)
    references public.github_mapping_approvals(id, organisation_id, mapping_pack_id) on delete restrict,
  constraint github_finding_provenance_latest_fail_run_ancestry_fk
    foreign key (latest_failed_collection_run_id, organisation_id, latest_failed_installation_id, latest_failed_repository_id)
    references public.github_collection_runs(id, organisation_id, installation_id, repository_id) on delete restrict,
  constraint github_finding_provenance_latest_fail_repository_ancestry_fk
    foreign key (latest_failed_repository_id, organisation_id, latest_failed_installation_id, provider_repository_id)
    references public.github_repositories(id, organisation_id, installation_id, provider_repository_id) on delete restrict,
  constraint github_finding_provenance_latest_fail_observation_ancestry_fk
    foreign key (latest_failed_observation_id, organisation_id, latest_failed_installation_id, latest_failed_repository_id, latest_failed_collection_run_id)
    references public.github_observations(id, organisation_id, installation_id, repository_id, collection_run_id) on delete restrict,
  constraint github_finding_provenance_resolved_run_ancestry_fk
    foreign key (resolved_by_collection_run_id, organisation_id, resolved_by_installation_id, resolved_by_repository_id)
    references public.github_collection_runs(id, organisation_id, installation_id, repository_id) on delete restrict,
  constraint github_finding_provenance_resolved_repository_ancestry_fk
    foreign key (resolved_by_repository_id, organisation_id, resolved_by_installation_id, provider_repository_id)
    references public.github_repositories(id, organisation_id, installation_id, provider_repository_id) on delete restrict,
  constraint github_finding_provenance_resolved_observation_ancestry_fk
    foreign key (resolved_by_observation_id, organisation_id, resolved_by_installation_id, resolved_by_repository_id, resolved_by_collection_run_id)
    references public.github_observations(id, organisation_id, installation_id, repository_id, collection_run_id) on delete restrict,
  constraint github_finding_provenance_identity_key_check check (
    identity_key = pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.jsonb_build_array(
            organisation_id, provider_repository_id, check_id
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  ),
  constraint github_finding_provenance_detection_order_check
    check (most_recent_detected_at >= first_detected_at),
  constraint github_finding_provenance_resolution_check check (
    (
      resolved_by_installation_id is null
      and resolved_by_repository_id is null
      and resolved_by_collection_run_id is null
      and resolved_by_observation_id is null
      and resolved_at is null
    )
    or (
      resolved_by_installation_id is not null
      and resolved_by_repository_id is not null
      and resolved_by_collection_run_id is not null
      and resolved_by_observation_id is not null
      and resolved_at is not null
    )
  )
);

create index github_finding_provenance_repository_idx
on public.github_finding_provenance(provider_repository_id, organisation_id, check_id);
create index github_finding_provenance_latest_run_idx
on public.github_finding_provenance(latest_collection_run_id, organisation_id);
create index github_finding_provenance_latest_approval_idx
on public.github_finding_provenance(latest_approval_id, organisation_id, latest_mapping_pack_id);

create table public.github_finding_transitions (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  finding_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  from_status public.monitor_finding_status,
  to_status public.monitor_finding_status not null,
  reason text not null check (
    pg_catalog.char_length(reason) between 1 and 500
    and reason !~ '[<>[:cntrl:]]'
  ),
  observation_id uuid,
  approval_id uuid,
  mapping_pack_id uuid,
  mapping_version text check (
    mapping_version is null
    or (
      pg_catalog.char_length(mapping_version) between 1 and 80
      and mapping_version !~ '[<>[:cntrl:]]'
    )
  ),
  occurred_at timestamptz not null default pg_catalog.now(),
  constraint github_finding_transitions_finding_tenant_fk
    foreign key (finding_id, organisation_id)
    references public.monitoring_findings(id, organisation_id) on delete restrict,
  constraint github_finding_transitions_observation_tenant_fk
    foreign key (observation_id, organisation_id)
    references public.github_observations(id, organisation_id) on delete restrict,
  constraint github_finding_transitions_approval_ancestry_fk
    foreign key (approval_id, organisation_id, mapping_pack_id)
    references public.github_mapping_approvals(id, organisation_id, mapping_pack_id) on delete restrict,
  constraint github_finding_transitions_mapping_pack_identity_fk
    foreign key (mapping_pack_id, mapping_version)
    references public.github_mapping_packs(id, version) on delete restrict,
  constraint github_finding_transitions_automated_reason_check check (
    (
      observation_id is null
      and approval_id is null
      and mapping_pack_id is null
      and mapping_version is null
      and reason not in (
        'failed_observation_created','failed_observation_refreshed',
        'failed_observation_reopened','fresh_pass_resolved'
      )
    )
    or (
      observation_id is not null
      and approval_id is not null
      and mapping_pack_id is not null
      and mapping_version is not null
    )
  )
);

create index github_finding_transitions_finding_time_idx
on public.github_finding_transitions(finding_id, organisation_id, occurred_at desc, id desc);
create index github_finding_transitions_observation_idx
on public.github_finding_transitions(observation_id, organisation_id)
where observation_id is not null;
create index github_finding_transitions_approval_idx
on public.github_finding_transitions(approval_id, organisation_id, mapping_pack_id)
where approval_id is not null;

insert into public.github_mapping_packs(id, version, title, checksum, published_at)
values (
  '91000000-0000-4000-8000-000000000001',
  'github-iso-27001-v1',
  'Standard GitHub to ISO/IEC 27001:2022 mapping pack',
  'b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f',
  pg_catalog.now()
);

insert into public.github_mapping_entries(
  id, mapping_pack_id, check_id, rule_version, iso_control_references,
  failure_severity, remediation, treatments
) values
('91000000-0000-4000-8000-000000000101','91000000-0000-4000-8000-000000000001','github.repository.visibility','github-repository-v1',array['A.8.4'],'high','Restrict repository visibility unless public access is explicitly approved.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.repository.visibility observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.repository.visibility observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.repository.visibility; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.repository.visibility is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000102','91000000-0000-4000-8000-000000000001','github.repository.archived','github-repository-v1',array['A.8.32'],'low','Confirm the archive state before returning the repository to active service.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.repository.archived observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.repository.archived observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.repository.archived; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.repository.archived is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000103','91000000-0000-4000-8000-000000000001','github.branch.force_pushes','github-repository-v1',array['A.8.25','A.8.32'],'high','Block force pushes on the default branch.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.branch.force_pushes observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.branch.force_pushes observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.branch.force_pushes; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.branch.force_pushes is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000104','91000000-0000-4000-8000-000000000001','github.branch.deletions','github-repository-v1',array['A.8.25','A.8.32'],'high','Block deletion of the default branch.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.branch.deletions observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.branch.deletions observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.branch.deletions; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.branch.deletions is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000105','91000000-0000-4000-8000-000000000001','github.branch.approving_reviews','github-repository-v1',array['A.8.25','A.8.32'],'high','Require at least two approving reviews on the default branch.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.branch.approving_reviews observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.branch.approving_reviews observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.branch.approving_reviews; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.branch.approving_reviews is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000106','91000000-0000-4000-8000-000000000001','github.branch.stale_approvals','github-repository-v1',array['A.8.32'],'medium','Dismiss stale approvals when new commits are pushed.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.branch.stale_approvals observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.branch.stale_approvals observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.branch.stale_approvals; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.branch.stale_approvals is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000107','91000000-0000-4000-8000-000000000001','github.branch.code_owner_reviews','github-repository-v1',array['A.8.25'],'medium','Require review from code owners on the default branch.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.branch.code_owner_reviews observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.branch.code_owner_reviews observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.branch.code_owner_reviews; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.branch.code_owner_reviews is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000108','91000000-0000-4000-8000-000000000001','github.branch.status_checks','github-repository-v1',array['A.8.29','A.8.32'],'high','Require at least one status check on the default branch.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.branch.status_checks observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.branch.status_checks observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.branch.status_checks; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.branch.status_checks is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000109','91000000-0000-4000-8000-000000000001','github.dependabot.high_critical','github-repository-v1',array['A.8.8'],'high','Resolve or formally triage high and critical Dependabot alerts.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.dependabot.high_critical observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.dependabot.high_critical observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.dependabot.high_critical; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.dependabot.high_critical is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000110','91000000-0000-4000-8000-000000000001','github.code_scanning.high_critical','github-repository-v1',array['A.8.29'],'high','Resolve or formally triage high and critical code-scanning alerts.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.code_scanning.high_critical observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.code_scanning.high_critical observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.code_scanning.high_critical; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.code_scanning.high_critical is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000111','91000000-0000-4000-8000-000000000001','github.secret_scanning.enabled','github-repository-v1',array['A.8.12','A.8.28'],'critical','Enable GitHub secret scanning for this repository.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.secret_scanning.enabled observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.secret_scanning.enabled observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.secret_scanning.enabled; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.secret_scanning.enabled is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000112','91000000-0000-4000-8000-000000000001','github.secret_scanning.push_protection','github-repository-v1',array['A.8.12','A.8.28'],'critical','Enable push protection for GitHub secret scanning.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.secret_scanning.push_protection observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.secret_scanning.push_protection observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.secret_scanning.push_protection; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.secret_scanning.push_protection is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000113','91000000-0000-4000-8000-000000000001','github.secret_scanning.open_alerts','github-repository-v1',array['A.8.12','A.8.28'],'critical','Resolve or formally triage all open secret-scanning alerts.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.secret_scanning.open_alerts observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.secret_scanning.open_alerts observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.secret_scanning.open_alerts; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.secret_scanning.open_alerts is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000114','91000000-0000-4000-8000-000000000001','github.workflow.security','github-repository-v1',array['A.8.25','A.8.29'],'high','Enable an approved security workflow and resolve its failures.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.workflow.security observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.workflow.security observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.workflow.security; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.workflow.security is not applicable to the observed repository state.'))),
('91000000-0000-4000-8000-000000000115','91000000-0000-4000-8000-000000000001','github.administration.outside_collaborator_admins','github-repository-v1',array['A.5.18','A.8.2'],'high','Remove administrator access from outside collaborators.',pg_catalog.jsonb_build_object('pass',pg_catalog.jsonb_build_object('kind','evidence','summary','A passing github.administration.outside_collaborator_admins observation provides approved GitHub evidence.'),'fail',pg_catalog.jsonb_build_object('kind','finding','summary','A failed github.administration.outside_collaborator_admins observation creates or refreshes a finding.'),'unknown',pg_catalog.jsonb_build_object('kind','explanatory','summary','GitHub could not establish github.administration.outside_collaborator_admins; no compliance-positive record is created.'),'not_applicable',pg_catalog.jsonb_build_object('kind','explanatory','summary','github.administration.outside_collaborator_admins is not applicable to the observed repository state.')));

create or replace function public.github_mapping_pack_checksum(target_mapping_pack_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  with canonical_entries as (
    select
      entry.check_id,
      '{"checkId":' || pg_catalog.to_json(entry.check_id)::text
      || ',"failureSeverity":' || pg_catalog.to_json(entry.failure_severity::text)::text
      || ',"isoControlReferences":[' || (
        select pg_catalog.string_agg(
          pg_catalog.to_json(reference_value)::text,
          ',' order by reference_value collate pg_catalog."C"
        )
        from pg_catalog.unnest(entry.iso_control_references)
          as reference_list(reference_value)
      ) || ']'
      || ',"remediation":' || pg_catalog.to_json(entry.remediation)::text
      || ',"ruleVersion":' || pg_catalog.to_json(entry.rule_version)::text
      || ',"treatments":{'
      || '"fail":{"kind":' || pg_catalog.to_json(entry.treatments #>> '{fail,kind}')::text
      || ',"summary":' || pg_catalog.to_json(entry.treatments #>> '{fail,summary}')::text || '}'
      || ',"not_applicable":{"kind":' || pg_catalog.to_json(entry.treatments #>> '{not_applicable,kind}')::text
      || ',"summary":' || pg_catalog.to_json(entry.treatments #>> '{not_applicable,summary}')::text || '}'
      || ',"pass":{"kind":' || pg_catalog.to_json(entry.treatments #>> '{pass,kind}')::text
      || ',"summary":' || pg_catalog.to_json(entry.treatments #>> '{pass,summary}')::text || '}'
      || ',"unknown":{"kind":' || pg_catalog.to_json(entry.treatments #>> '{unknown,kind}')::text
      || ',"summary":' || pg_catalog.to_json(entry.treatments #>> '{unknown,summary}')::text || '}'
      || '}}' as canonical_entry
    from public.github_mapping_entries entry
    where entry.mapping_pack_id = target_mapping_pack_id
  ),
  canonical_pack as (
    select
      '{"mappings":['
      || pg_catalog.coalesce(
        pg_catalog.string_agg(
          canonical_entries.canonical_entry,
          ',' order by canonical_entries.check_id collate pg_catalog."C"
        ),
        ''
      )
      || '],"title":' || pg_catalog.to_json(pack.title)::text
      || ',"version":' || pg_catalog.to_json(pack.version)::text
      || '}' as canonical_value
    from public.github_mapping_packs pack
    left join canonical_entries on true
    where pack.id = target_mapping_pack_id
    group by pack.id, pack.title, pack.version
  )
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(canonical_pack.canonical_value, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
  from canonical_pack;
$$;

alter function public.github_mapping_pack_checksum(uuid) owner to postgres;
revoke all on function public.github_mapping_pack_checksum(uuid)
from public, anon, authenticated, service_role;

create or replace function public.guard_github_mapping_pack_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.published_at is not null then
    raise exception 'GitHub mapping packs are immutable' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.id is distinct from old.id
    or new.version is distinct from old.version
    or new.title is distinct from old.title
    or new.created_at is distinct from old.created_at
  then
    raise exception 'GitHub mapping pack draft identity is immutable' using errcode = 'P0001';
  end if;
  if new.checksum is not null or new.published_at is not null then
    if current_user <> 'postgres'
      or pg_catalog.coalesce(
        pg_catalog.current_setting('compliancehub.github_mapping_sealer', true), ''
      ) <> 'on'
      or new.checksum is null
      or new.published_at is null
    then
      raise exception 'GitHub mapping packs can only be sealed by the verified server workflow'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_github_mapping_entry_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_pack_id uuid;
  target_published_at timestamptz;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select pack.published_at into target_published_at
    from public.github_mapping_packs pack
    where pack.id = old.mapping_pack_id
    for key share;
    if target_published_at is not null then
      raise exception 'GitHub mapping entries are immutable' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and (
      new.id is distinct from old.id
      or new.mapping_pack_id is distinct from old.mapping_pack_id
      or new.created_at is distinct from old.created_at
    )
  then
    raise exception 'GitHub mapping entry draft identity is immutable' using errcode = 'P0001';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    target_pack_id := new.mapping_pack_id;
    select pack.published_at into target_published_at
    from public.github_mapping_packs pack
    where pack.id = target_pack_id
    for key share;
    if not found then
      raise exception 'GitHub mapping pack draft was not found' using errcode = '23503';
    end if;
    if target_published_at is not null then
      raise exception 'GitHub mapping entries are immutable' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.guard_github_mapping_approval_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'GitHub mapping approvals are immutable' using errcode = 'P0001';
  end if;
  if (pg_catalog.to_jsonb(new) - 'revoked_by' - 'revoked_at')
      is distinct from (pg_catalog.to_jsonb(old) - 'revoked_by' - 'revoked_at')
    or old.revoked_at is not null
    or new.revoked_by is null
    or new.revoked_at is null
  then
    raise exception 'GitHub mapping approval identity is immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.reject_github_evidence_provenance_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'GitHub evidence provenance is immutable' using errcode = 'P0001';
end;
$$;

create or replace function public.guard_github_finding_provenance_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'GitHub finding provenance cannot be deleted' using errcode = 'P0001';
  end if;
  if current_user <> 'postgres'
    or pg_catalog.coalesce(
      pg_catalog.current_setting('compliancehub.github_materialiser', true), ''
    ) <> 'on'
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
    or new.initial_mapping_pack_id is distinct from old.initial_mapping_pack_id
    or new.first_detected_at is distinct from old.first_detected_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'GitHub finding provenance identity is immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.reject_github_finding_transition_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'GitHub finding transitions are immutable' using errcode = 'P0001';
end;
$$;

create or replace function public.guard_official_github_finding_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  transition_mode text := pg_catalog.current_setting('compliancehub.github_finding_transition', true);
  materialiser_mode text := pg_catalog.current_setting('compliancehub.github_materialiser', true);
begin
  if tg_op = 'INSERT' then
    if new.finding_origin = 'github'
      and (
        current_user <> 'postgres'
        or pg_catalog.coalesce(transition_mode, '') <> 'materialiser'
        or pg_catalog.coalesce(materialiser_mode, '') <> 'on'
      )
    then
      raise exception 'official GitHub findings require verified materialisation'
        using errcode = 'P0001';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.finding_origin = 'github' then
      raise exception 'official GitHub findings cannot be deleted' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if new.finding_origin is distinct from old.finding_origin then
    raise exception 'monitoring finding origin is immutable' using errcode = 'P0001';
  end if;
  if old.finding_origin = 'github'
    and new.provider_repository_id is distinct from old.provider_repository_id
  then
    raise exception 'official GitHub finding identity is immutable' using errcode = 'P0001';
  end if;
  if old.finding_origin = 'github'
    and new.mapping_version is distinct from old.mapping_version
    and (
      current_user <> 'postgres'
      or pg_catalog.coalesce(transition_mode, '') <> 'materialiser'
      or pg_catalog.coalesce(materialiser_mode, '') <> 'on'
    )
  then
    raise exception 'official GitHub finding mapping metadata is server-managed'
      using errcode = 'P0001';
  end if;
  if old.finding_origin = 'github'
    and (
      current_user <> 'postgres'
      or pg_catalog.coalesce(transition_mode, '') not in ('materialiser', 'human', 'task')
    )
  then
    raise exception 'GitHub findings require a verified transition' using errcode = 'P0001';
  end if;
  if old.finding_origin = 'github'
    and (
      (new.status::text = 'resolved' and new.resolved_at is null)
      or (new.status::text <> 'resolved' and new.resolved_at is not null)
    )
  then
    raise exception 'GitHub finding resolution metadata is inconsistent' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_official_github_evidence_link_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_evidence_id uuid := case when tg_op = 'DELETE' then old.evidence_id else new.evidence_id end;
begin
  if exists (
    select 1 from public.github_evidence_provenance provenance
    where provenance.evidence_id = target_evidence_id
  ) and (
    current_user <> 'postgres'
    or pg_catalog.coalesce(
      pg_catalog.current_setting('compliancehub.github_materialiser', true), ''
    ) <> 'on'
  )
  then
    raise exception 'official GitHub evidence links are server-managed' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.guard_github_mapping_pack_change() from public, anon, authenticated, service_role;
revoke all on function public.guard_github_mapping_entry_change() from public, anon, authenticated, service_role;
revoke all on function public.guard_github_mapping_approval_change() from public, anon, authenticated, service_role;
revoke all on function public.reject_github_evidence_provenance_change() from public, anon, authenticated, service_role;
revoke all on function public.guard_github_finding_provenance_change() from public, anon, authenticated, service_role;
revoke all on function public.reject_github_finding_transition_change() from public, anon, authenticated, service_role;
revoke all on function public.guard_official_github_finding_change() from public, anon, authenticated, service_role;
revoke all on function public.guard_official_github_evidence_link_change() from public, anon, authenticated, service_role;

create trigger github_mapping_packs_immutable
before update or delete on public.github_mapping_packs
for each row execute function public.guard_github_mapping_pack_change();
create trigger github_mapping_entries_immutable
before insert or update or delete on public.github_mapping_entries
for each row execute function public.guard_github_mapping_entry_change();
create trigger github_mapping_approvals_guard
before update or delete on public.github_mapping_approvals
for each row execute function public.guard_github_mapping_approval_change();
create trigger github_evidence_provenance_immutable
before update or delete on public.github_evidence_provenance
for each statement execute function public.reject_github_evidence_provenance_change();
create trigger github_finding_provenance_guard
before update or delete on public.github_finding_provenance
for each row execute function public.guard_github_finding_provenance_change();
create trigger github_finding_transitions_immutable
before update or delete on public.github_finding_transitions
for each statement execute function public.reject_github_finding_transition_change();
create trigger monitoring_findings_github_guard
before insert or update or delete on public.monitoring_findings
for each row execute function public.guard_official_github_finding_change();
create trigger evidence_links_github_guard
before insert or update or delete on public.evidence_links
for each row execute function public.guard_official_github_evidence_link_change();

-- Preserve verified daily expiry transitions for official evidence while
-- keeping supersession/withdrawal exclusive to the materialiser.
create or replace function public.evidence_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_official_github_evidence boolean;
  is_materialiser boolean;
  is_verified_daily_expiry boolean;
begin
  is_official_github_evidence := exists (
    select 1 from public.github_evidence_provenance provenance
    where provenance.evidence_id = old.id
      and provenance.organisation_id = old.organisation_id
  );
  is_materialiser := current_user = 'postgres'
    and pg_catalog.coalesce(
      pg_catalog.current_setting('compliancehub.github_materialiser', true), ''
    ) = 'on';
  is_verified_daily_expiry := current_user = 'service_role'
    and (pg_catalog.to_jsonb(new) - 'status') = (pg_catalog.to_jsonb(old) - 'status')
    and (
      (
        new.status::text = 'expiring'
        and old.status::text in ('current', 'expiring')
        and new.valid_until >= current_date
        and new.valid_until <= current_date + 30
      )
      or (
        new.status::text = 'expired'
        and old.status::text in ('current', 'expiring', 'expired')
        and new.valid_until < current_date
      )
    );

  if is_official_github_evidence
    and not is_materialiser
    and not is_verified_daily_expiry
  then
    raise exception 'official GitHub evidence lifecycle is server-managed' using errcode = 'P0001';
  end if;
  if (pg_catalog.to_jsonb(new) - 'status') is distinct from (pg_catalog.to_jsonb(old) - 'status') then
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
end;
$$;

create trigger github_mapping_approvals_audit
after insert or update on public.github_mapping_approvals
for each row execute function public.capture_audit_event();
create trigger github_evidence_provenance_audit
after insert on public.github_evidence_provenance
for each row execute function public.capture_audit_event();
create trigger github_finding_provenance_audit
after insert or update on public.github_finding_provenance
for each row execute function public.capture_audit_event();
create trigger github_finding_transitions_audit
after insert on public.github_finding_transitions
for each row execute function public.capture_audit_event();

alter table public.github_mapping_packs enable row level security;
alter table public.github_mapping_entries enable row level security;
alter table public.github_mapping_approvals enable row level security;
alter table public.github_evidence_provenance enable row level security;
alter table public.github_finding_provenance enable row level security;
alter table public.github_finding_transitions enable row level security;

create policy github_mapping_packs_authenticated_read
on public.github_mapping_packs for select to authenticated
using (published_at is not null);
create policy github_mapping_entries_authenticated_read
on public.github_mapping_entries for select to authenticated
using (exists (
  select 1 from public.github_mapping_packs pack
  where pack.id = mapping_pack_id and pack.published_at is not null
));
create policy github_mapping_approvals_members_read
on public.github_mapping_approvals for select to authenticated
using ((select public.is_organisation_member(organisation_id)));
create policy github_evidence_provenance_members_read
on public.github_evidence_provenance for select to authenticated
using ((select public.is_organisation_member(organisation_id)));
create policy github_finding_provenance_members_read
on public.github_finding_provenance for select to authenticated
using ((select public.is_organisation_member(organisation_id)));
create policy github_finding_transitions_members_read
on public.github_finding_transitions for select to authenticated
using ((select public.is_organisation_member(organisation_id)));

revoke all on public.github_mapping_packs from public, anon, authenticated, service_role;
revoke all on public.github_mapping_entries from public, anon, authenticated, service_role;
revoke all on public.github_mapping_approvals from public, anon, authenticated, service_role;
revoke all on public.github_evidence_provenance from public, anon, authenticated, service_role;
revoke all on public.github_finding_provenance from public, anon, authenticated, service_role;
revoke all on public.github_finding_transitions from public, anon, authenticated, service_role;

grant select on public.github_mapping_packs to authenticated, service_role;
grant select on public.github_mapping_entries to authenticated, service_role;
grant select on public.github_mapping_approvals to authenticated, service_role;
grant select on public.github_evidence_provenance to authenticated, service_role;
grant select on public.github_finding_provenance to authenticated, service_role;
grant select on public.github_finding_transitions to authenticated, service_role;

create or replace function public.seal_github_mapping_pack_server(
  target_version text,
  target_checksum text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pack_row public.github_mapping_packs;
  baseline_pack_id uuid;
  canonical_checksum text;
begin
  if target_version is null
    or pg_catalog.char_length(target_version) not between 1 and 80
    or target_checksum is null
    or target_checksum !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid GitHub mapping pack seal request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-mapping-pack-seal:' || target_version, 0)
  );

  select * into pack_row
  from public.github_mapping_packs pack
  where pack.version = target_version
  for update;
  if not found then
    raise exception 'GitHub mapping pack draft was not found' using errcode = '22023';
  end if;
  if pack_row.published_at is not null then
    if pack_row.checksum = target_checksum then return pack_row.id; end if;
    raise exception 'GitHub mapping packs are immutable' using errcode = 'P0001';
  end if;

  select pack.id into baseline_pack_id
  from public.github_mapping_packs pack
  where pack.version = 'github-iso-27001-v1'
    and pack.published_at is not null;
  if baseline_pack_id is null
    or (
      select pg_catalog.count(*)
      from public.github_mapping_entries entry
      where entry.mapping_pack_id = pack_row.id
    ) <> (
      select pg_catalog.count(*)
      from public.github_mapping_entries entry
      where entry.mapping_pack_id = baseline_pack_id
    )
    or exists (
      select 1
      from public.github_mapping_entries baseline_entry
      where baseline_entry.mapping_pack_id = baseline_pack_id
        and not exists (
          select 1
          from public.github_mapping_entries draft_entry
          where draft_entry.mapping_pack_id = pack_row.id
            and draft_entry.check_id = baseline_entry.check_id
        )
      )
  then
    raise exception 'GitHub mapping pack is incomplete' using errcode = '22023';
  end if;

  canonical_checksum := public.github_mapping_pack_checksum(pack_row.id);
  if canonical_checksum is null or canonical_checksum <> target_checksum then
    raise exception 'GitHub mapping pack checksum does not match canonical content'
      using errcode = '22023';
  end if;

  perform pg_catalog.set_config('compliancehub.github_mapping_sealer', 'on', true);
  update public.github_mapping_packs
  set checksum = canonical_checksum,
      published_at = pg_catalog.now()
  where id = pack_row.id
    and published_at is null;
  if not found then
    raise exception 'GitHub mapping pack could not be sealed' using errcode = 'P0001';
  end if;
  return pack_row.id;
end;
$$;

alter function public.seal_github_mapping_pack_server(text,text) owner to postgres;
revoke all on function public.seal_github_mapping_pack_server(text,text)
from public, anon, authenticated, service_role;
grant execute on function public.seal_github_mapping_pack_server(text,text)
to service_role;

create or replace function public.approve_github_mapping_pack_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_version text,
  target_checksum text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pack_row public.github_mapping_packs;
  active_approval public.github_mapping_approvals;
  created_approval_id uuid;
begin
  if target_organisation_id is null or target_actor_id is null
    or target_version is null or target_checksum is null
    or target_checksum !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid GitHub mapping approval' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
  ) then
    raise exception 'GitHub mapping approval requires a current workspace Owner' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-mapping-approval:' || target_organisation_id::text, 0)
  );

  perform 1 from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for share;
  if not found then
    raise exception 'GitHub mapping approval requires a current workspace Owner' using errcode = '42501';
  end if;

  select * into pack_row
  from public.github_mapping_packs pack
  where pack.version = target_version
    and pack.checksum = target_checksum
    and pack.published_at is not null;
  if not found then
    raise exception 'reviewed GitHub mapping pack identity does not match' using errcode = '22023';
  end if;

  select * into active_approval
  from public.github_mapping_approvals approval
  where approval.organisation_id = target_organisation_id
    and approval.revoked_at is null
  for update;

  if found and active_approval.mapping_pack_id = pack_row.id then
    return active_approval.id;
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', target_actor_id::text, 'role', 'authenticated')::text,
    true
  );

  if found then
    update public.github_mapping_approvals
    set revoked_by = target_actor_id,
        revoked_at = pg_catalog.now()
    where id = active_approval.id
      and organisation_id = target_organisation_id
      and revoked_at is null;
  end if;

  insert into public.github_mapping_approvals(
    organisation_id, mapping_pack_id, approved_by
  ) values (
    target_organisation_id, pack_row.id, target_actor_id
  ) returning id into created_approval_id;

  return created_approval_id;
end;
$$;

alter function public.approve_github_mapping_pack_server(uuid,uuid,text,text) owner to postgres;
revoke all on function public.approve_github_mapping_pack_server(uuid,uuid,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.approve_github_mapping_pack_server(uuid,uuid,text,text)
to service_role;

create or replace function public.revoke_github_mapping_approval_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_approval_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval_row public.github_mapping_approvals;
begin
  if target_organisation_id is null or target_actor_id is null or target_approval_id is null
    or not exists (
      select 1 from public.memberships membership
      where membership.organisation_id = target_organisation_id
        and membership.user_id = target_actor_id
        and membership.role = 'owner'
    )
  then
    raise exception 'GitHub mapping revocation requires a current workspace Owner' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('github-mapping-approval:' || target_organisation_id::text, 0)
  );
  perform 1 from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for share;
  if not found then
    raise exception 'GitHub mapping revocation requires a current workspace Owner' using errcode = '42501';
  end if;

  select * into approval_row
  from public.github_mapping_approvals approval
  where approval.id = target_approval_id
    and approval.organisation_id = target_organisation_id
  for update;
  if not found then
    raise exception 'active GitHub mapping approval was not found' using errcode = '42501';
  end if;
  if approval_row.revoked_at is not null then return false; end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', target_actor_id::text, 'role', 'authenticated')::text,
    true
  );
  update public.github_mapping_approvals
  set revoked_by = target_actor_id,
      revoked_at = pg_catalog.now()
  where id = target_approval_id
    and organisation_id = target_organisation_id
    and revoked_at is null;
  return found;
end;
$$;

alter function public.revoke_github_mapping_approval_server(uuid,uuid,uuid) owner to postgres;
revoke all on function public.revoke_github_mapping_approval_server(uuid,uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.revoke_github_mapping_approval_server(uuid,uuid,uuid)
to service_role;

create or replace function public.materialise_github_observations_server(
  target_organisation_id uuid,
  target_actor_id uuid,
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
  approval_row public.github_mapping_approvals;
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
    or target_actor_id is null
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
  if decision_count not between 1 and 100 then
    raise exception 'GitHub materialisation requires between 1 and 100 decisions'
      using errcode = '22023';
  end if;

  -- The explicit actor is supplied by a trusted server route, but it is still
  -- revalidated before and after the organisation-scoped serialization lock.
  if not exists (
    select 1
    from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
  ) then
    raise exception 'GitHub materialisation requires a current workspace Owner'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'github-mapping-approval:' || target_organisation_id::text,
      0
    )
  );

  perform 1
  from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for share;
  if not found then
    raise exception 'GitHub materialisation requires a current workspace Owner'
      using errcode = '42501';
  end if;

  select approval.*
  into approval_row
  from public.github_mapping_approvals approval
  join public.github_mapping_packs pack
    on pack.id = approval.mapping_pack_id
  where approval.organisation_id = target_organisation_id
    and approval.revoked_at is null
    and pack.version = target_mapping_version
    and pack.checksum = target_mapping_checksum
    and pack.published_at is not null
  for update of approval;
  if not found then
    raise exception 'active GitHub mapping approval does not match the reviewed pack'
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

  if run_row.observation_count <> decision_count then
    raise exception 'materialisation decisions must cover the complete collection run'
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
    where entry.mapping_pack_id = approval_row.mapping_pack_id
      and entry.check_id = observation_row.check_id
      and entry.rule_version = observation_row.rule_version;
    if not found then
      raise exception 'observation does not match the approved GitHub mapping pack'
        using errcode = '22023';
    end if;

    expected_kind := case observation_row.result::text
      when 'pass' then 'evidence'
      when 'fail' then 'finding'
      else 'explanatory'
    end;
    select pg_catalog.coalesce(
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

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', target_actor_id::text,
      'role', 'authenticated'
    )::text,
    true
  );
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
      target_organisation_id, target_actor_id, 'github.materialise',
      'github_collection_runs', run_row.id::text,
      summary_value || pg_catalog.jsonb_build_object(
        'mapping_version', target_mapping_version,
        'mapping_checksum', target_mapping_checksum
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
    where entry.mapping_pack_id = approval_row.mapping_pack_id
      and entry.check_id = observation_row.check_id
      and entry.rule_version = observation_row.rule_version;

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
        target_actor_id,
        observation_row.observed_at::date,
        observation_row.fresh_until::date,
        'current',
        case when previous_evidence.id is null then null else previous_evidence.evidence_id end,
        target_actor_id
      ) returning id into created_evidence_id;

      insert into public.github_evidence_provenance(
        evidence_id, organisation_id, installation_id, repository_id,
        collection_run_id, observation_id, approval_id, mapping_pack_id,
        identity_key, check_id, rule_version, mapping_version,
        supersedes_evidence_id, observed_at, fresh_until
      ) values (
        created_evidence_id, target_organisation_id,
        observation_row.installation_id, observation_row.repository_id,
        run_row.id, observation_row.id, approval_row.id,
        approval_row.mapping_pack_id, evidence_identity,
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
        target_actor_id
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
          target_organisation_id, target_actor_id,
          'github.evidence_superseded', 'evidence',
          previous_evidence.evidence_id::text,
          pg_catalog.jsonb_build_object(
            'replacement_evidence_id', created_evidence_id,
            'identity_key', evidence_identity
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
              latest_approval_id = approval_row.id,
              latest_mapping_pack_id = approval_row.mapping_pack_id,
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
            reason, observation_id, approval_id, mapping_pack_id,
            mapping_version, occurred_at
          ) values (
            target_organisation_id, finding_row.id, target_actor_id,
            finding_row.status, 'resolved', 'fresh_pass_resolved',
            observation_row.id, approval_row.id, approval_row.mapping_pack_id,
            target_mapping_version, observation_row.observed_at
          );
          findings_resolved := findings_resolved + 1;
        end if;
      end if;
      continue;
    end if;

    -- A fail creates one stable finding, reopens a previously verified finding,
    -- or refreshes detection while preserving an unresolved human state.
    select provenance.*
    into finding_provenance
    from public.github_finding_provenance provenance
    where provenance.organisation_id = target_organisation_id
      and provenance.identity_key = finding_identity
    for update;

    if found and finding_provenance.most_recent_detected_at >= observation_row.observed_at then
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
        initial_approval_id, initial_mapping_pack_id,
        latest_installation_id, latest_repository_id,
        latest_collection_run_id, latest_observation_id,
        latest_approval_id, latest_mapping_pack_id,
        latest_failed_installation_id, latest_failed_repository_id,
        latest_failed_collection_run_id, latest_failed_observation_id,
        first_detected_at, most_recent_detected_at
      ) values (
        created_finding_id, target_organisation_id,
        observation_row.installation_id, observation_row.repository_id,
        observation_row.provider_repository_id, finding_identity,
        observation_row.check_id, target_mapping_version, observation_row.subject_id,
        run_row.id, observation_row.id, approval_row.id,
        approval_row.mapping_pack_id,
        observation_row.installation_id, observation_row.repository_id,
        run_row.id, observation_row.id,
        approval_row.id, approval_row.mapping_pack_id,
        observation_row.installation_id, observation_row.repository_id,
        run_row.id, observation_row.id,
        observation_row.observed_at, observation_row.observed_at
      );

      insert into public.github_finding_transitions(
        organisation_id, finding_id, actor_id, from_status, to_status,
        reason, observation_id, approval_id, mapping_pack_id,
        mapping_version, occurred_at
      ) values (
        target_organisation_id, created_finding_id, target_actor_id,
        null, 'open', 'failed_observation_created',
        observation_row.id, approval_row.id, approval_row.mapping_pack_id,
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
        latest_approval_id = approval_row.id,
        latest_mapping_pack_id = approval_row.mapping_pack_id,
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
        reason, observation_id, approval_id, mapping_pack_id,
        mapping_version, occurred_at
      ) values (
        target_organisation_id, finding_row.id, target_actor_id,
        finding_row.status, 'open', 'failed_observation_reopened',
        observation_row.id, approval_row.id, approval_row.mapping_pack_id,
        target_mapping_version, observation_row.observed_at
      );
      findings_reopened := findings_reopened + 1;
    else
      insert into public.github_finding_transitions(
        organisation_id, finding_id, actor_id, from_status, to_status,
        reason, observation_id, approval_id, mapping_pack_id,
        mapping_version, occurred_at
      ) values (
        target_organisation_id, finding_row.id, target_actor_id,
        finding_row.status, finding_row.status, 'failed_observation_refreshed',
        observation_row.id, approval_row.id, approval_row.mapping_pack_id,
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
    target_organisation_id, target_actor_id, 'github.materialise',
    'github_collection_runs', run_row.id::text,
    summary_value || pg_catalog.jsonb_build_object(
      'mapping_version', target_mapping_version,
      'mapping_checksum', target_mapping_checksum
    )
  );
  return summary_value;
end;
$$;

alter function public.materialise_github_observations_server(uuid,uuid,uuid,text,text,jsonb)
owner to postgres;
revoke all on function public.materialise_github_observations_server(uuid,uuid,uuid,text,text,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.materialise_github_observations_server(uuid,uuid,uuid,text,text,jsonb)
to service_role;

create or replace function public.transition_github_finding_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_finding_id uuid,
  target_status text,
  target_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  finding_row public.monitoring_findings;
begin
  if target_organisation_id is null
    or target_actor_id is null
    or target_finding_id is null
    or target_status is null
    or target_reason is null
    or pg_catalog.char_length(target_reason) not between 1 and 500
    or target_reason ~ '[<>[:cntrl:]]'
  then
    raise exception 'invalid GitHub finding transition' using errcode = '22023';
  end if;
  if target_status = 'resolved' then
    raise exception 'a GitHub finding resolves only through a newer fresh pass'
      using errcode = '22023';
  end if;
  if target_status not in (
    'open', 'acknowledged', 'in_progress',
    'exception_requested', 'risk_accepted'
  ) then
    raise exception 'invalid GitHub finding transition' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
  ) then
    raise exception 'GitHub finding transition requires a current workspace Owner'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'github-finding-transition:' || target_organisation_id::text || ':' || target_finding_id::text,
      0
    )
  );
  perform 1
  from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = target_actor_id
    and membership.role = 'owner'
  for share;
  if not found then
    raise exception 'GitHub finding transition requires a current workspace Owner'
      using errcode = '42501';
  end if;

  select finding.*
  into finding_row
  from public.monitoring_findings finding
  join public.github_finding_provenance provenance
    on provenance.finding_id = finding.id
   and provenance.organisation_id = finding.organisation_id
  where finding.id = target_finding_id
    and finding.organisation_id = target_organisation_id
    and finding.finding_origin = 'github'
  for update of finding;
  if not found then
    raise exception 'GitHub finding was not found in the active workspace'
      using errcode = '42501';
  end if;
  if finding_row.status::text = 'resolved' then
    raise exception 'a resolved GitHub finding reopens only through a newer failure'
      using errcode = '22023';
  end if;
  if finding_row.status::text = target_status then
    return false;
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', target_actor_id::text,
      'role', 'authenticated'
    )::text,
    true
  );
  perform pg_catalog.set_config('compliancehub.github_finding_transition', 'human', true);

  update public.monitoring_findings
  set status = target_status::public.monitor_finding_status,
      resolved_at = null
  where id = target_finding_id
    and organisation_id = target_organisation_id;

  insert into public.github_finding_transitions(
    organisation_id, finding_id, actor_id, from_status, to_status, reason
  ) values (
    target_organisation_id, target_finding_id, target_actor_id,
    finding_row.status, target_status::public.monitor_finding_status,
    target_reason
  );
  return true;
end;
$$;

alter function public.transition_github_finding_server(uuid,uuid,uuid,text,text)
owner to postgres;
revoke all on function public.transition_github_finding_server(uuid,uuid,uuid,text,text)
from public, anon, authenticated, service_role;
grant execute on function public.transition_github_finding_server(uuid,uuid,uuid,text,text)
to service_role;

-- Keep the established authenticated Owner entry point, but make task source
-- and finding-state handling provenance-aware without making tasks authoritative
-- for GitHub finding resolution.
create or replace function public.raise_monitoring_finding_task(
  target_organisation_id uuid,
  target_finding_id uuid,
  target_owner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  finding_row public.monitoring_findings;
  created_task_id uuid;
  actor_id uuid := (select auth.uid());
  task_source_value public.task_source;
  next_finding_status public.monitor_finding_status;
begin
  if actor_id is null then
    raise exception 'Finding not found in active workspace' using errcode = '42501';
  end if;

  perform 1
  from public.memberships membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = actor_id
    and membership.role = 'owner'
  for share;
  if not found then
    raise exception 'Finding not found in active workspace' using errcode = '42501';
  end if;

  if target_owner_id is not null then
    perform 1
    from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_owner_id
    for share;
    if not found then
      raise exception 'task owner must belong to the active workspace'
        using errcode = '42501';
    end if;
  end if;

  select finding.*
  into finding_row
  from public.monitoring_findings finding
  where finding.id = target_finding_id
    and finding.organisation_id = target_organisation_id
    and finding.status::text <> 'resolved'
  for update;
  if not found then
    raise exception 'Finding not found in active workspace' using errcode = '42501';
  end if;
  if finding_row.task_id is not null then
    raise exception 'This finding already has a remediation task' using errcode = '23505';
  end if;

  task_source_value := case
    when finding_row.finding_origin = 'github'
      then 'github'::public.task_source
    else 'system'::public.task_source
  end;
  next_finding_status := case
    when finding_row.status::text = 'open'
      then 'acknowledged'::public.monitor_finding_status
    else finding_row.status
  end;

  insert into public.tasks(
    organisation_id, title, detail, owner_id, source, created_by
  ) values (
    target_organisation_id,
    pg_catalog.left('Remediate: ' || finding_row.title, 200),
    pg_catalog.left(
      finding_row.detail || E'\n\nControl ' || finding_row.control_ref ||
      ' · ' || finding_row.subject_id || '. Raised from continuous monitoring.',
      10000
    ),
    target_owner_id,
    task_source_value,
    actor_id
  ) returning id into created_task_id;

  perform pg_catalog.set_config('compliancehub.github_finding_transition', 'task', true);
  update public.monitoring_findings
  set task_id = created_task_id,
      status = next_finding_status
  where id = target_finding_id
    and organisation_id = target_organisation_id
    and task_id is null;
  if not found then
    raise exception 'Monitoring remediation task could not be linked'
      using errcode = '40001';
  end if;

  if finding_row.finding_origin = 'github'
    and finding_row.status is distinct from next_finding_status
  then
    insert into public.github_finding_transitions(
      organisation_id, finding_id, actor_id, from_status, to_status, reason
    ) values (
      target_organisation_id, target_finding_id, actor_id,
      finding_row.status, next_finding_status, 'remediation_task_linked'
    );
  end if;
  return created_task_id;
end;
$$;

alter function public.raise_monitoring_finding_task(uuid,uuid,uuid) owner to postgres;
revoke all on function public.raise_monitoring_finding_task(uuid,uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.raise_monitoring_finding_task(uuid,uuid,uuid)
to authenticated;

-- Keep every non-resolved GitHub review state visible to MCP bundle readers.
-- One RLS-scoped SQL statement builds the bounded MCP readiness/digest bundle.
-- SECURITY INVOKER is deliberate: every base-table policy remains authoritative.
create or replace function public.get_mcp_compliance_bundle(
  target_organisation_id uuid,
  target_local_date date,
  attention_limit integer default 20,
  monitoring_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with
caller as materialized (
  select membership.role::text as role, organisation.name
  from public.memberships as membership
  join public.organisations as organisation on organisation.id = membership.organisation_id
  where membership.organisation_id = target_organisation_id
    and membership.user_id = (select auth.uid())
),
bounds as (
  select greatest(1, least(coalesce(attention_limit, 20), 50)) as attention_limit,
         greatest(1, least(coalesce(monitoring_limit, 20), 50)) as monitoring_limit
),
latest_report as materialized (
  select snapshot.id, snapshot.payload, snapshot.published_at
  from public.leadership_report_snapshots as snapshot
  cross join caller
  where snapshot.organisation_id = target_organisation_id
  order by snapshot.published_at desc, snapshot.id desc
  limit 1
),
risk_config as (
  select coalesce(config.low_max, 4) as low_max,
         coalesce(config.moderate_max, 9) as moderate_max,
         coalesce(config.high_max, 14) as high_max
  from caller
  left join public.risk_matrix_config as config on config.organisation_id = target_organisation_id
),
latest_register as (
  select register.id
  from public.soa_registers as register
  cross join caller
  where register.organisation_id = target_organisation_id
  order by register.version desc, register.id desc
  limit 1
),
soa_summary as (
  select count(*) filter (where item.status <> 'not_applicable')::integer as total,
         case when count(*) filter (where item.status <> 'not_applicable') = 0 then 0 else
           round(100 * sum(case item.status::text
             when 'in_progress' then 0.4 when 'established' then 0.7
             when 'operational' then 0.9 when 'advanced' then 1 else 0 end)
             filter (where item.status <> 'not_applicable')
             / count(*) filter (where item.status <> 'not_applicable'))::integer
         end as percent
  from latest_register as register
  left join public.soa_items as item
    on item.soa_register_id = register.id and item.organisation_id = target_organisation_id
),
risk_rows as materialized (
  select risk.id, risk.reference, risk.title, risk.review_date,
         (risk.residual_likelihood * risk.residual_impact)::integer as score
  from public.risks as risk
  cross join caller
  where risk.organisation_id = target_organisation_id and risk.status <> 'closed'
),
risk_summary as (
  select count(*) filter (where risk.score <= config.low_max)::integer as low,
         count(*) filter (where risk.score > config.low_max and risk.score <= config.moderate_max)::integer as moderate,
         count(*) filter (where risk.score > config.moderate_max and risk.score <= config.high_max)::integer as high,
         count(*) filter (where risk.score > config.high_max)::integer as very_high
  from risk_config as config left join risk_rows as risk on true
),
task_summary as (
  select count(*)::integer as open,
         count(*) filter (where task.due_on is not null and task.due_on < target_local_date)::integer as overdue
  from public.tasks as task cross join caller
  where task.organisation_id = target_organisation_id and task.status in ('open','in_progress')
),
evidence_summary as (
  select count(*)::integer as total,
         count(*) filter (where evidence.valid_until >= target_local_date and evidence.valid_until <= target_local_date + 30)::integer as expiring,
         count(*) filter (where evidence.valid_until < target_local_date)::integer as expired
  from public.evidence as evidence cross join caller
  where evidence.organisation_id = target_organisation_id and evidence.status not in ('superseded','withdrawn')
),
audit_summary as (
  select count(*)::integer as open
  from public.audits as audit cross join caller
  where audit.organisation_id = target_organisation_id and audit.status <> 'closed'
),
nonconformity_summary as (
  select count(*)::integer as open
  from public.audit_findings as finding cross join caller
  where finding.organisation_id = target_organisation_id and finding.status <> 'closed' and finding.severity <> 'observation'
),
live_overview as (
  select jsonb_build_object(
    'soaPercent', coalesce(soa.percent, 0), 'soaTotal', coalesce(soa.total, 0),
    'riskBands', jsonb_build_object('low', coalesce(risk.low, 0), 'moderate', coalesce(risk.moderate, 0), 'high', coalesce(risk.high, 0), 'very_high', coalesce(risk.very_high, 0)),
    'tasksOpen', task.open, 'tasksOverdue', task.overdue,
    'evidence', jsonb_build_object('total', evidence.total, 'expiring', evidence.expiring, 'expired', evidence.expired),
    'openAudits', audit.open, 'openNonConformities', nonconformity.open
  ) as payload
  from soa_summary soa cross join risk_summary risk cross join task_summary task
  cross join evidence_summary evidence cross join audit_summary audit cross join nonconformity_summary nonconformity
),
attention_candidates as materialized (
  select 'task:' || task.id::text as id, 'task'::text as source, 'overdue_task'::text as category,
         'high'::text as severity, 3 as severity_rank, 1 as category_rank,
         'Overdue task: ' || task.title as summary, task.due_on as due_on, null::timestamptz as observed_at
  from public.tasks task cross join caller
  where task.organisation_id = target_organisation_id and task.status in ('open','in_progress') and task.due_on < target_local_date
  union all
  select 'evidence:' || evidence.id::text, 'evidence', 'stale_evidence',
         case when evidence.valid_until < target_local_date then 'critical' else 'high' end,
         case when evidence.valid_until < target_local_date then 4 else 3 end, 2,
         case when evidence.valid_until < target_local_date then 'Expired evidence: ' else 'Expiring evidence: ' end || evidence.title,
         evidence.valid_until, null::timestamptz
  from public.evidence evidence cross join caller
  where evidence.organisation_id = target_organisation_id and evidence.status not in ('superseded','withdrawn')
    and evidence.valid_until is not null and evidence.valid_until <= target_local_date + 30
  union all
  select 'policy:' || policy.id::text, 'policy', 'policy_review', 'high', 3, 3,
         'Policy review due: ' || policy.reference || ' ' || policy.title, policy.review_due, null::timestamptz
  from public.policies policy cross join caller
  where policy.organisation_id = target_organisation_id and policy.status = 'approved' and policy.review_due <= target_local_date
  union all
  select 'risk:' || risk.id::text, 'risk', 'high_risk', case when risk.score > config.high_max then 'critical' else 'high' end,
         case when risk.score > config.high_max then 4 else 3 end, 4,
         case when risk.score > config.high_max then 'Very high residual risk: ' else 'High residual risk: ' end || risk.reference || ' ' || risk.title,
         risk.review_date, null::timestamptz
  from risk_rows risk cross join risk_config config where risk.score > config.moderate_max
  union all
  select 'audit_finding:' || finding.id::text, 'audit_finding', 'unresolved_finding',
         case finding.severity::text when 'major_nc' then 'critical' when 'minor_nc' then 'high' else 'medium' end,
         case finding.severity::text when 'major_nc' then 4 when 'minor_nc' then 3 else 2 end, 5,
         'Unresolved ' || case finding.severity::text when 'major_nc' then 'major non-conformity' when 'minor_nc' then 'minor non-conformity' else 'observation' end || ' in audit ' || audit.reference,
         null::date, finding.created_at
  from public.audit_findings finding join public.audits audit on audit.id = finding.audit_id and audit.organisation_id = finding.organisation_id
  cross join caller
  where finding.organisation_id = target_organisation_id and finding.status <> 'closed'
),
attention_top as (
  select candidate.* from attention_candidates candidate cross join bounds
  order by candidate.severity_rank desc,
    coalesce(candidate.due_on, (candidate.observed_at at time zone 'Europe/London')::date, 'infinity'::date),
    candidate.category_rank, candidate.source, candidate.id
  limit (select attention_limit + 1 from bounds)
),
attention_json as (
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', id, 'source', source, 'category', category, 'severity', severity, 'summary', summary,
    'dueOn', due_on, 'observedOn', observed_at
  )) order by severity_rank desc, coalesce(due_on, (observed_at at time zone 'Europe/London')::date, 'infinity'::date), category_rank, source, id), '[]'::jsonb) as items
  from attention_top
),
monitoring_top as (
  select finding.id, finding.control_ref, finding.severity::text as severity, finding.title, finding.status::text as status,
         (finding.task_id is not null) as has_remediation_task, finding.detected_at, finding.resolved_at
  from public.monitoring_findings finding cross join caller cross join bounds
  where finding.organisation_id = target_organisation_id and finding.status in ('open','acknowledged','in_progress','exception_requested','risk_accepted')
  order by finding.severity desc, finding.detected_at desc, finding.id
  limit (select monitoring_limit + 1 from bounds)
),
monitoring_json as (
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', 'monitoring_finding:' || id::text, 'severity', severity, 'status', status, 'title', title,
    'controlRef', nullif(control_ref, ''), 'detectedAt', detected_at, 'resolvedAt', resolved_at,
    'hasRemediationTask', has_remediation_task
  )) order by severity desc, detected_at desc, id), '[]'::jsonb) as items
  from monitoring_top
),
delivery as (
  select jsonb_build_object('id', delivery.id, 'status', delivery.status::text, 'deliveredAt', delivery.delivered_at) as value
  from public.daily_digest_deliveries delivery cross join caller
  where caller.role = 'owner' and delivery.organisation_id = target_organisation_id and delivery.digest_on = target_local_date
  limit 1
)
select jsonb_build_object(
  'schemaVersion', 1,
  'workspace', jsonb_build_object('id', target_organisation_id, 'name', caller.name, 'role', caller.role),
  'overviewSource', case when caller.role = 'member' then 'published' else 'live' end,
  'overview', case when caller.role = 'member' then latest_report.payload else live_overview.payload end,
  'attentionItems', attention_json.items,
  'monitoringFindings', monitoring_json.items,
  'latestLeadershipReport', case when latest_report.id is null then null else jsonb_build_object('id', latest_report.id, 'publishedAt', latest_report.published_at) end,
  'delivery', delivery.value
)
from caller
cross join live_overview cross join attention_json cross join monitoring_json
left join latest_report on true left join delivery on true;
$$;

alter function public.get_mcp_compliance_bundle(uuid,date,integer,integer) owner to postgres;
revoke all on function public.get_mcp_compliance_bundle(uuid,date,integer,integer) from public, anon, service_role;
grant execute on function public.get_mcp_compliance_bundle(uuid,date,integer,integer) to authenticated;
