create type public.github_installation_status as enum (
  'active', 'suspended', 'revoked', 'needs_attention'
);

create type public.github_collection_status as enum (
  'running', 'succeeded', 'partial', 'failed', 'rate_limited'
);

create type public.github_observation_result as enum (
  'pass', 'fail', 'unknown', 'not_applicable'
);

create table public.github_installations (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider_installation_id bigint not null check (provider_installation_id > 0),
  account_id bigint not null check (account_id > 0),
  account_login text not null check (
    account_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
  ),
  account_type text not null check (account_type in ('Organization', 'User')),
  repository_selection text not null check (repository_selection in ('all', 'selected')),
  status public.github_installation_status not null default 'active',
  connected_by uuid,
  permissions jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(permissions) = 'object'),
  permissions_ok boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint github_installations_provider_id_key unique (provider_installation_id),
  constraint github_installations_id_organisation_key unique (id, organisation_id),
  constraint github_installations_id_full_ancestry_key
    unique (id, organisation_id, provider_installation_id),
  constraint github_installations_connector_tenant_fk
    foreign key (organisation_id, connected_by)
    references public.memberships(organisation_id, user_id)
    on delete set null (connected_by),
  constraint github_installations_revocation_check check (
    (status = 'revoked' and revoked_at is not null)
    or (status <> 'revoked' and revoked_at is null)
  )
);

create index github_installations_organisation_status_idx
on public.github_installations(organisation_id, status, created_at desc);

create table public.github_repositories (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  provider_repository_id bigint not null check (provider_repository_id > 0),
  owner_login text not null check (char_length(owner_login) between 1 and 100),
  name text not null check (char_length(name) between 1 and 100),
  full_name text not null check (char_length(full_name) between 3 and 201),
  html_url text not null check (
    char_length(html_url) <= 500
    and html_url ~ '^https://github[.]com/[^[:space:]/]+/[^[:space:]/]+/?$'
  ),
  visibility text not null check (visibility in ('public', 'private', 'internal')),
  default_branch text not null check (char_length(default_branch) between 1 and 255),
  archived boolean not null default false,
  selected boolean not null default false,
  available boolean not null default true,
  removed_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_repositories_installation_provider_key
    unique (installation_id, provider_repository_id),
  constraint github_repositories_id_organisation_key unique (id, organisation_id),
  constraint github_repositories_id_tenant_installation_key
    unique (id, organisation_id, installation_id),
  constraint github_repositories_id_full_ancestry_key
    unique (id, organisation_id, installation_id, provider_repository_id),
  constraint github_repositories_installation_tenant_fk
    foreign key (installation_id, organisation_id)
    references public.github_installations(id, organisation_id)
    on delete restrict,
  constraint github_repositories_availability_check check (
    (available and removed_at is null)
    or (not available and removed_at is not null)
  )
);

create index github_repositories_installation_tenant_idx
on public.github_repositories(installation_id, organisation_id);
create index github_repositories_organisation_selection_idx
on public.github_repositories(organisation_id, selected, archived, id);

create table public.github_collection_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  repository_id uuid not null,
  trigger_type text not null check (trigger_type in ('initial', 'scheduled', 'manual', 'webhook')),
  request_key text not null check (char_length(request_key) between 1 and 200),
  status public.github_collection_status not null default 'running',
  diagnostic_code text check (
    diagnostic_code is null
    or diagnostic_code in (
      'permission_denied', 'feature_unavailable', 'not_found', 'rate_limited',
      'provider_unavailable', 'invalid_response'
    )
  ),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  observation_count integer not null default 0 check (observation_count >= 0),
  passed_count integer not null default 0 check (passed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  unknown_count integer not null default 0 check (unknown_count >= 0),
  not_applicable_count integer not null default 0 check (not_applicable_count >= 0),
  constraint github_collection_runs_id_organisation_key unique (id, organisation_id),
  constraint github_collection_runs_id_full_ancestry_key
    unique (id, organisation_id, installation_id, repository_id),
  constraint github_collection_runs_repository_request_key
    unique (repository_id, request_key),
  constraint github_collection_runs_installation_tenant_fk
    foreign key (installation_id, organisation_id)
    references public.github_installations(id, organisation_id)
    on delete restrict,
  constraint github_collection_runs_repository_tenant_fk
    foreign key (repository_id, organisation_id, installation_id)
    references public.github_repositories(id, organisation_id, installation_id)
    on delete restrict,
  constraint github_collection_runs_count_consistency check (
    observation_count = passed_count + failed_count + unknown_count + not_applicable_count
  ),
  constraint github_collection_runs_completion_check check (
    (status = 'running' and completed_at is null and diagnostic_code is null)
    or (status in ('succeeded', 'partial') and completed_at is not null)
    or (status in ('failed', 'rate_limited') and completed_at is not null and diagnostic_code is not null)
  )
);

create index github_collection_runs_installation_tenant_idx
on public.github_collection_runs(installation_id, organisation_id, started_at desc);
create index github_collection_runs_repository_tenant_idx
on public.github_collection_runs(repository_id, organisation_id, installation_id, started_at desc);
create index github_collection_runs_organisation_time_idx
on public.github_collection_runs(organisation_id, started_at desc);

create table public.github_observations (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  installation_id uuid not null,
  repository_id uuid not null,
  provider_repository_id bigint not null check (provider_repository_id > 0),
  collection_run_id uuid not null,
  observation_key text not null check (char_length(observation_key) between 1 and 500),
  check_id text not null check (char_length(check_id) between 1 and 120),
  rule_version text not null check (char_length(rule_version) between 1 and 120),
  subject_type text not null check (subject_type = 'github_repository'),
  subject_id text not null check (char_length(subject_id) between 1 and 200),
  result public.github_observation_result not null,
  severity text check (severity is null or severity in ('low', 'medium', 'high', 'critical')),
  title text not null check (char_length(title) between 1 and 300),
  explanation text not null check (char_length(explanation) between 1 and 5000),
  remediation text check (remediation is null or char_length(remediation) between 1 and 5000),
  observed_at timestamptz not null,
  fresh_until timestamptz not null,
  source_url text not null check (
    char_length(source_url) <= 1000
    and source_url ~ '^https://[^[:space:]]+$'
  ),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  diagnostic_code text check (
    diagnostic_code is null
    or diagnostic_code in (
      'permission_denied', 'feature_unavailable', 'not_found', 'rate_limited',
      'provider_unavailable', 'invalid_response'
    )
  ),
  created_at timestamptz not null default now(),
  constraint github_observations_id_organisation_key unique (id, organisation_id),
  constraint github_observations_run_observation_key unique (collection_run_id, observation_key),
  constraint github_observations_installation_tenant_fk
    foreign key (installation_id, organisation_id)
    references public.github_installations(id, organisation_id)
    on delete restrict,
  constraint github_observations_repository_tenant_fk
    foreign key (repository_id, organisation_id, installation_id, provider_repository_id)
    references public.github_repositories(id, organisation_id, installation_id, provider_repository_id)
    on delete restrict,
  constraint github_observations_collection_run_tenant_fk
    foreign key (collection_run_id, organisation_id, installation_id, repository_id)
    references public.github_collection_runs(id, organisation_id, installation_id, repository_id)
    on delete restrict,
  constraint github_observations_freshness_check check (fresh_until > observed_at),
  constraint github_observations_result_diagnostic_check check (
    (result = 'unknown' and diagnostic_code is not null)
    or (result <> 'unknown' and diagnostic_code is null)
  )
);

create index github_observations_installation_tenant_idx
on public.github_observations(installation_id, organisation_id, observed_at desc);
create index github_observations_repository_tenant_idx
on public.github_observations(repository_id, organisation_id, installation_id, provider_repository_id, observed_at desc);
create index github_observations_collection_run_tenant_idx
on public.github_observations(collection_run_id, organisation_id, installation_id, repository_id);
create index github_observations_organisation_freshness_idx
on public.github_observations(organisation_id, fresh_until desc);

create table public.github_webhook_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade,
  installation_id uuid,
  repository_id uuid,
  provider_installation_id bigint check (
    provider_installation_id is null or provider_installation_id > 0
  ),
  provider_repository_id bigint check (provider_repository_id is null or provider_repository_id > 0),
  provider_delivery_id text not null check (char_length(provider_delivery_id) between 1 and 100),
  event_name text not null check (char_length(event_name) between 1 and 100),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'processed', 'ignored', 'failed')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  diagnostic_code text check (
    diagnostic_code is null
    or diagnostic_code in (
      'permission_denied', 'feature_unavailable', 'not_found', 'rate_limited',
      'provider_unavailable', 'invalid_response', 'invalid_payload',
      'unsupported_event', 'internal_error'
    )
  ),
  received_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  processed_at timestamptz,
  constraint github_webhook_deliveries_provider_id_key unique (provider_delivery_id),
  constraint github_webhook_deliveries_id_organisation_key unique (id, organisation_id),
  constraint github_webhook_deliveries_installation_tenant_fk
    foreign key (installation_id, organisation_id, provider_installation_id)
    references public.github_installations(id, organisation_id, provider_installation_id)
    on delete restrict,
  constraint github_webhook_deliveries_repository_tenant_fk
    foreign key (repository_id, organisation_id, installation_id, provider_repository_id)
    references public.github_repositories(id, organisation_id, installation_id, provider_repository_id)
    on delete restrict,
  constraint github_webhook_deliveries_resolution_check check (
    (provider_repository_id is null or provider_installation_id is not null)
    and (
      (organisation_id is null and installation_id is null and repository_id is null)
    or (
      organisation_id is not null
      and installation_id is not null
      and (repository_id is null or provider_repository_id is not null)
    )
    )
  ),
  constraint github_webhook_deliveries_lifecycle_check check (
    (status = 'queued' and provider_installation_id is not null and attempt_count = 0 and last_attempted_at is null and processed_at is null and diagnostic_code is null)
    or (status = 'processing' and provider_installation_id is not null and attempt_count between 1 and 10 and last_attempted_at is not null and processed_at is null and diagnostic_code is null)
    or (status = 'processed' and provider_installation_id is not null and attempt_count between 1 and 10 and last_attempted_at is not null and processed_at is not null and diagnostic_code is null)
    or (
      status = 'ignored'
      and processed_at is not null
      and diagnostic_code is null
      and (
        (attempt_count = 0 and last_attempted_at is null)
        or (attempt_count between 1 and 10 and last_attempted_at is not null)
      )
    )
    or (status = 'failed' and provider_installation_id is not null and attempt_count between 1 and 10 and last_attempted_at is not null and processed_at is not null and diagnostic_code is not null)
  ),
  constraint github_webhook_deliveries_timestamps_check check (
    (last_attempted_at is null or last_attempted_at >= received_at)
    and (processed_at is null or processed_at >= received_at)
  )
);

create table public.github_oauth_states (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  actor_id uuid not null,
  pending_provider_installation_id bigint not null check (pending_provider_installation_id > 0),
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint github_oauth_states_state_hash_key unique (state_hash),
  constraint github_oauth_states_id_organisation_key unique (id, organisation_id),
  constraint github_oauth_states_actor_tenant_fk
    foreign key (organisation_id, actor_id)
    references public.memberships(organisation_id, user_id)
    on delete cascade,
  constraint github_oauth_states_expiry_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '15 minutes'
    and (consumed_at is null or consumed_at >= created_at)
  )
);

create index github_webhook_deliveries_installation_tenant_idx
on public.github_webhook_deliveries(installation_id, organisation_id, received_at desc);
create index github_webhook_deliveries_repository_tenant_idx
on public.github_webhook_deliveries(repository_id, organisation_id, installation_id, received_at desc)
where repository_id is not null;
create index github_webhook_deliveries_recovery_idx
on public.github_webhook_deliveries(status, last_attempted_at, received_at)
where status in ('queued', 'processing', 'failed');
create index github_oauth_states_expiry_idx
on public.github_oauth_states(expires_at)
where consumed_at is null;

create or replace function public.touch_github_inventory_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.touch_github_inventory_updated_at() from public, anon, authenticated;

create or replace function public.protect_github_installation_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.organisation_id is distinct from old.organisation_id
    or new.provider_installation_id is distinct from old.provider_installation_id
  then
    raise exception 'GitHub installation ownership is immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_github_installation_identity()
from public, anon, authenticated, service_role;

create trigger github_installations_protect_identity
before update on public.github_installations
for each row execute function public.protect_github_installation_identity();

create trigger github_installations_touch_updated_at
before update on public.github_installations
for each row execute function public.touch_github_inventory_updated_at();

create trigger github_repositories_touch_updated_at
before update on public.github_repositories
for each row execute function public.touch_github_inventory_updated_at();

create or replace function public.reject_github_observation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'GitHub observations are append-only' using errcode = 'P0001';
end;
$$;

revoke all on function public.reject_github_observation_change() from public, anon, authenticated, service_role;

create trigger github_observations_append_only
before update or delete on public.github_observations
for each row execute function public.reject_github_observation_change();

create trigger github_installations_audit
after insert or update or delete on public.github_installations
for each row execute function public.capture_audit_event();

create trigger github_repositories_audit
after insert or update or delete on public.github_repositories
for each row execute function public.capture_audit_event();

alter table public.github_installations enable row level security;
alter table public.github_repositories enable row level security;
alter table public.github_collection_runs enable row level security;
alter table public.github_observations enable row level security;
alter table public.github_webhook_deliveries enable row level security;
alter table public.github_oauth_states enable row level security;

create policy github_installations_members_select
on public.github_installations for select to authenticated
using ((select public.is_organisation_member(organisation_id)));

create policy github_repositories_members_select
on public.github_repositories for select to authenticated
using ((select public.is_organisation_member(organisation_id)));

create policy github_collection_runs_members_select
on public.github_collection_runs for select to authenticated
using ((select public.is_organisation_member(organisation_id)));

create policy github_observations_members_select
on public.github_observations for select to authenticated
using ((select public.is_organisation_member(organisation_id)));

revoke all on public.github_installations from public, anon, authenticated, service_role;
revoke all on public.github_repositories from public, anon, authenticated, service_role;
revoke all on public.github_collection_runs from public, anon, authenticated, service_role;
revoke all on public.github_observations from public, anon, authenticated, service_role;
revoke all on public.github_webhook_deliveries from public, anon, authenticated, service_role;
revoke all on public.github_oauth_states from public, anon, authenticated, service_role;

grant select (
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status, permissions_ok, created_at,
  updated_at, revoked_at
) on public.github_installations to authenticated;

grant select (
  id, organisation_id, installation_id, provider_repository_id, owner_login,
  name, full_name, html_url, visibility, default_branch, archived, selected,
  available, removed_at, last_seen_at, created_at, updated_at
) on public.github_repositories to authenticated;

grant select (
  id, organisation_id, installation_id, repository_id, trigger_type, status,
  diagnostic_code, started_at, completed_at, observation_count, passed_count,
  failed_count, unknown_count, not_applicable_count
) on public.github_collection_runs to authenticated;

grant select (
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  collection_run_id, observation_key, check_id, rule_version, subject_type,
  subject_id, result, severity, title, explanation, remediation, observed_at,
  fresh_until, source_url, fingerprint, diagnostic_code, created_at
) on public.github_observations to authenticated;

grant select on public.github_installations to service_role;
grant update (
  status, updated_at, revoked_at
) on public.github_installations to service_role;

grant select on public.github_repositories to service_role;
grant update (
  owner_login, name, full_name, html_url, visibility, default_branch, archived,
  last_seen_at, updated_at
) on public.github_repositories to service_role;

grant select on public.github_collection_runs to service_role;
grant insert (
  organisation_id, installation_id, repository_id, trigger_type, request_key,
  status, diagnostic_code, started_at, completed_at, observation_count,
  passed_count, failed_count, unknown_count, not_applicable_count
) on public.github_collection_runs to service_role;
grant update (
  status, diagnostic_code, completed_at, observation_count, passed_count,
  failed_count, unknown_count, not_applicable_count
) on public.github_collection_runs to service_role;

grant select on public.github_observations to service_role;
grant insert (
  organisation_id, installation_id, repository_id, provider_repository_id,
  collection_run_id, observation_key, check_id, rule_version, subject_type,
  subject_id, result, severity, title, explanation, remediation, observed_at,
  fresh_until, source_url, fingerprint, diagnostic_code
) on public.github_observations to service_role;

grant select on public.github_webhook_deliveries to service_role;
grant insert (
  organisation_id, installation_id, repository_id, provider_installation_id,
  provider_repository_id, provider_delivery_id, event_name, payload_sha256,
  status, attempt_count, diagnostic_code,
  received_at, last_attempted_at, processed_at
) on public.github_webhook_deliveries to service_role;

grant select on public.github_oauth_states to service_role;
grant insert (
  organisation_id, actor_id, pending_provider_installation_id, state_hash,
  created_at, expires_at
) on public.github_oauth_states to service_role;

create or replace function public.set_github_repository_selected(
  target_repository_id uuid,
  target_selected boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organisation_id uuid;
  target_installation_id uuid;
  repository_row public.github_repositories;
  selected_count integer;
begin
  if target_repository_id is null or target_selected is null then
    raise exception 'repository selection requires a workspace operator' using errcode = '42501';
  end if;

  select organisation_id, installation_id
  into target_organisation_id, target_installation_id
  from public.github_repositories
  where id = target_repository_id;

  if target_organisation_id is null
    or not public.is_organisation_operator(target_organisation_id)
  then
    raise exception 'repository selection requires a workspace operator' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_installation_id::text, 0)
  );

  select * into repository_row
  from public.github_repositories
  where id = target_repository_id
    and organisation_id = target_organisation_id
    and installation_id = target_installation_id
  for update;

  if not found or not public.is_organisation_operator(target_organisation_id) then
    raise exception 'repository selection requires a workspace operator' using errcode = '42501';
  end if;

  if not repository_row.available and target_selected then
    raise exception 'an unavailable GitHub repository cannot be selected'
      using errcode = '23514';
  end if;

  if not repository_row.selected and target_selected then
    select count(*) into selected_count
    from public.github_repositories
    where installation_id = target_installation_id
      and organisation_id = target_organisation_id
      and selected;

    if selected_count >= 100 then
      raise exception 'a GitHub installation may select at most 100 repositories'
        using errcode = '23514';
    end if;
  end if;

  if repository_row.selected is distinct from target_selected then
    update public.github_repositories
    set selected = target_selected
    where id = target_repository_id
      and organisation_id = target_organisation_id;
  end if;

  return true;
end;
$$;

alter function public.set_github_repository_selected(uuid, boolean) owner to postgres;
revoke all on function public.set_github_repository_selected(uuid, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.set_github_repository_selected(uuid, boolean)
to authenticated;

create or replace function public.consume_github_oauth_state_server(
  target_state_hash text,
  target_organisation_id uuid,
  target_actor_id uuid,
  target_pending_provider_installation_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if target_state_hash is null
    or target_state_hash !~ '^[0-9a-f]{64}$'
    or target_organisation_id is null
    or target_actor_id is null
    or target_pending_provider_installation_id is null
    or target_pending_provider_installation_id <= 0
  then
    return false;
  end if;

  update public.github_oauth_states
  set consumed_at = pg_catalog.now()
  where state_hash = target_state_hash
    and organisation_id = target_organisation_id
    and actor_id = target_actor_id
    and pending_provider_installation_id = target_pending_provider_installation_id
    and consumed_at is null
    and expires_at > pg_catalog.now();
  get diagnostics changed = row_count;

  return changed = 1;
end;
$$;

alter function public.consume_github_oauth_state_server(text, uuid, uuid, bigint)
owner to postgres;
revoke all on function public.consume_github_oauth_state_server(text, uuid, uuid, bigint)
from public, anon, authenticated, service_role;
grant execute on function public.consume_github_oauth_state_server(text, uuid, uuid, bigint)
to service_role;

create or replace function public.claim_github_webhook_deliveries_server(
  target_limit integer
)
returns setof public.github_webhook_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  claimed_delivery public.github_webhook_deliveries;
  resolved_installation public.github_installations;
  resolved_repository_id uuid;
begin
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'webhook claim limit must be between 1 and 100'
      using errcode = '22023';
  end if;

  for candidate in
    select delivery.id
    from public.github_webhook_deliveries delivery
    where delivery.attempt_count < 10
      and (
        delivery.status in ('queued', 'failed')
        or (
          delivery.status = 'processing'
          and delivery.last_attempted_at < pg_catalog.now() - interval '15 minutes'
        )
      )
    order by delivery.received_at, delivery.id
    limit target_limit
    for update skip locked
  loop
    select * into resolved_installation
    from public.github_installations installation
    where installation.provider_installation_id = (
      select delivery.provider_installation_id
      from public.github_webhook_deliveries delivery
      where delivery.id = candidate.id
    )
      and installation.status = 'active'
      and installation.permissions_ok;

    resolved_repository_id := null;
    if found then
      select repository.id into resolved_repository_id
      from public.github_repositories repository
      where repository.installation_id = resolved_installation.id
        and repository.organisation_id = resolved_installation.organisation_id
        and repository.selected
        and repository.available
        and repository.provider_repository_id = (
          select delivery.provider_repository_id
          from public.github_webhook_deliveries delivery
          where delivery.id = candidate.id
        );
    end if;

    update public.github_webhook_deliveries delivery
    set organisation_id = resolved_installation.organisation_id,
        installation_id = resolved_installation.id,
        repository_id = resolved_repository_id,
        status = 'processing',
        attempt_count = delivery.attempt_count + 1,
        diagnostic_code = null,
        last_attempted_at = pg_catalog.now(),
        processed_at = null
    where delivery.id = candidate.id
    returning delivery.* into claimed_delivery;

    return next claimed_delivery;
  end loop;
end;
$$;

alter function public.claim_github_webhook_deliveries_server(integer) owner to postgres;
revoke all on function public.claim_github_webhook_deliveries_server(integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_github_webhook_deliveries_server(integer)
to service_role;

create or replace function public.finalize_github_webhook_delivery_server(
  target_delivery_id uuid,
  target_attempt_count integer,
  target_status text,
  target_diagnostic_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery public.github_webhook_deliveries;
begin
  if target_delivery_id is null
    or target_attempt_count is null
    or target_attempt_count < 1
    or target_attempt_count > 10
    or target_status is null
    or target_status not in ('processed', 'ignored', 'failed')
    or (target_status = 'processed' and target_diagnostic_code is not null)
    or (target_status = 'ignored' and target_diagnostic_code is not null)
    or (
      target_status = 'failed'
      and (
        target_diagnostic_code is null
        or target_diagnostic_code not in (
          'permission_denied', 'feature_unavailable', 'not_found', 'rate_limited',
          'provider_unavailable', 'invalid_response', 'invalid_payload',
          'unsupported_event', 'internal_error'
        )
      )
    )
  then
    raise exception 'invalid webhook delivery outcome' using errcode = '22023';
  end if;

  select * into delivery
  from public.github_webhook_deliveries
  where id = target_delivery_id
  for update;

  if not found
    or delivery.status <> 'processing'
    or delivery.attempt_count <> target_attempt_count
  then
    return false;
  end if;

  update public.github_webhook_deliveries
  set status = target_status,
      diagnostic_code = target_diagnostic_code,
      processed_at = pg_catalog.now()
  where id = target_delivery_id
    and status = 'processing'
    and attempt_count = target_attempt_count;

  return found;
end;
$$;

alter function public.finalize_github_webhook_delivery_server(uuid, integer, text, text)
owner to postgres;
revoke all on function public.finalize_github_webhook_delivery_server(uuid, integer, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.finalize_github_webhook_delivery_server(uuid, integer, text, text)
to service_role;

create or replace function public.claim_github_installation_server(
  target_organisation_id uuid,
  target_actor_id uuid,
  target_provider_installation_id bigint,
  target_account_id bigint,
  target_account_login text,
  target_account_type text,
  target_repository_selection text,
  target_permissions jsonb,
  target_permissions_ok boolean,
  target_repositories jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_installation public.github_installations;
  installation_exists boolean;
  claimed_installation_id uuid;
  repository_value jsonb;
  repository_count integer;
  distinct_repository_count integer;
begin
  if target_organisation_id is null
    or target_actor_id is null
    or target_provider_installation_id is null
    or target_provider_installation_id <= 0
    or target_account_id is null
    or target_account_id <= 0
    or target_repository_selection <> 'selected'
    or target_permissions_ok is not true
    or pg_catalog.jsonb_typeof(target_permissions) <> 'object'
    or pg_catalog.jsonb_typeof(target_repositories) <> 'array'
  then
    raise exception 'invalid verified GitHub installation claim' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_actor_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception 'GitHub installation claim requires a current workspace operator'
      using errcode = '42501';
  end if;

  repository_count := pg_catalog.jsonb_array_length(target_repositories);
  if repository_count > 100 then
    raise exception 'a verified GitHub installation claim may contain at most 100 repositories'
      using errcode = '23514';
  end if;

  for repository_value in
    select value from pg_catalog.jsonb_array_elements(target_repositories)
  loop
    if pg_catalog.jsonb_typeof(repository_value) <> 'object'
      or not (repository_value ?& array[
        'id', 'owner', 'name', 'fullName', 'htmlUrl', 'visibility', 'archived', 'defaultBranch'
      ])
      or pg_catalog.jsonb_typeof(repository_value -> 'id') <> 'number'
      or pg_catalog.jsonb_typeof(repository_value -> 'owner') <> 'string'
      or pg_catalog.jsonb_typeof(repository_value -> 'name') <> 'string'
      or pg_catalog.jsonb_typeof(repository_value -> 'fullName') <> 'string'
      or pg_catalog.jsonb_typeof(repository_value -> 'htmlUrl') <> 'string'
      or pg_catalog.jsonb_typeof(repository_value -> 'visibility') <> 'string'
      or pg_catalog.jsonb_typeof(repository_value -> 'archived') <> 'boolean'
      or pg_catalog.jsonb_typeof(repository_value -> 'defaultBranch') <> 'string'
      or (repository_value ->> 'id') !~ '^[1-9][0-9]*$'
      or repository_value ->> 'fullName' <> (repository_value ->> 'owner') || '/' || (repository_value ->> 'name')
      or repository_value ->> 'htmlUrl' <> 'https://github.com/' || (repository_value ->> 'fullName')
      or repository_value ->> 'visibility' not in ('public', 'private', 'internal')
    then
      raise exception 'invalid canonical GitHub repository inventory' using errcode = '22023';
    end if;
  end loop;

  select count(distinct (value ->> 'id'))
  into distinct_repository_count
  from pg_catalog.jsonb_array_elements(target_repositories);
  if distinct_repository_count <> repository_count then
    raise exception 'GitHub repository inventory contains duplicate provider ids'
      using errcode = '22023';
  end if;

  select count(distinct pg_catalog.lower(value ->> 'fullName'))
  into distinct_repository_count
  from pg_catalog.jsonb_array_elements(target_repositories);
  if distinct_repository_count <> repository_count then
    raise exception 'GitHub repository inventory contains duplicate canonical names'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'github-installation:' || target_provider_installation_id::text,
      0
    )
  );

  if not exists (
    select 1
    from public.memberships membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_actor_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception 'GitHub installation claim requires a current workspace operator'
      using errcode = '42501';
  end if;

  select * into existing_installation
  from public.github_installations
  where provider_installation_id = target_provider_installation_id
  for update;

  installation_exists := found;

  if installation_exists and existing_installation.organisation_id <> target_organisation_id then
    raise exception 'GitHub installation is already claimed by another workspace'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', target_actor_id::text,
      'role', 'authenticated'
    )::text,
    true
  );

  if installation_exists then
    update public.github_installations
    set account_id = target_account_id,
        account_login = target_account_login,
        account_type = target_account_type,
        repository_selection = target_repository_selection,
        status = 'active',
        connected_by = target_actor_id,
        permissions = target_permissions,
        permissions_ok = true,
        revoked_at = null
    where id = existing_installation.id
    returning id into claimed_installation_id;
  else
    insert into public.github_installations(
      organisation_id, provider_installation_id, account_id, account_login,
      account_type, repository_selection, status, connected_by, permissions,
      permissions_ok
    ) values (
      target_organisation_id, target_provider_installation_id, target_account_id,
      target_account_login, target_account_type, target_repository_selection,
      'active', target_actor_id, target_permissions, true
    ) returning id into claimed_installation_id;
  end if;

  for repository_value in
    select value from pg_catalog.jsonb_array_elements(target_repositories)
  loop
    insert into public.github_repositories(
      organisation_id, installation_id, provider_repository_id, owner_login,
      name, full_name, html_url, visibility, default_branch, archived,
      available, removed_at, last_seen_at
    ) values (
      target_organisation_id,
      claimed_installation_id,
      (repository_value ->> 'id')::bigint,
      repository_value ->> 'owner',
      repository_value ->> 'name',
      repository_value ->> 'fullName',
      repository_value ->> 'htmlUrl',
      repository_value ->> 'visibility',
      repository_value ->> 'defaultBranch',
      (repository_value ->> 'archived')::boolean,
      true,
      null,
      pg_catalog.now()
    )
    on conflict (installation_id, provider_repository_id) do update
    set owner_login = excluded.owner_login,
        name = excluded.name,
        full_name = excluded.full_name,
        html_url = excluded.html_url,
        visibility = excluded.visibility,
        default_branch = excluded.default_branch,
        archived = excluded.archived,
        available = true,
        removed_at = null,
        last_seen_at = excluded.last_seen_at;
  end loop;

  update public.github_repositories repository
  set available = false,
      removed_at = pg_catalog.now()
  where repository.installation_id = claimed_installation_id
    and repository.organisation_id = target_organisation_id
    and repository.available
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(target_repositories) inventory(value)
      where (inventory.value ->> 'id')::bigint = repository.provider_repository_id
    );

  return claimed_installation_id;
end;
$$;

alter function public.claim_github_installation_server(
  uuid, uuid, bigint, bigint, text, text, text, jsonb, boolean, jsonb
) owner to postgres;
revoke all on function public.claim_github_installation_server(
  uuid, uuid, bigint, bigint, text, text, text, jsonb, boolean, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.claim_github_installation_server(
  uuid, uuid, bigint, bigint, text, text, text, jsonb, boolean, jsonb
) to service_role;

create view public.github_repository_shadow_summaries
with (security_invoker = true)
as
select
  repository.id as repository_id,
  repository.organisation_id,
  repository.installation_id,
  repository.provider_repository_id,
  repository.owner_login,
  repository.name,
  repository.full_name,
  repository.html_url,
  repository.visibility,
  repository.default_branch,
  repository.archived,
  repository.selected,
  repository.available,
  repository.removed_at,
  repository.last_seen_at,
  latest_run.id as latest_run_id,
  latest_run.trigger_type as latest_trigger_type,
  latest_run.status as latest_status,
  latest_run.diagnostic_code as latest_diagnostic_code,
  latest_run.started_at as latest_started_at,
  latest_run.completed_at as latest_completed_at,
  latest_run.observation_count as latest_observation_count,
  latest_run.passed_count as latest_passed_count,
  latest_run.failed_count as latest_failed_count,
  latest_run.unknown_count as latest_unknown_count,
  latest_run.not_applicable_count as latest_not_applicable_count
from public.github_repositories repository
left join lateral (
  select
    collection_run.id,
    collection_run.trigger_type,
    collection_run.status,
    collection_run.diagnostic_code,
    collection_run.started_at,
    collection_run.completed_at,
    collection_run.observation_count,
    collection_run.passed_count,
    collection_run.failed_count,
    collection_run.unknown_count,
    collection_run.not_applicable_count
  from public.github_collection_runs collection_run
  where collection_run.repository_id = repository.id
    and collection_run.organisation_id = repository.organisation_id
    and collection_run.installation_id = repository.installation_id
  order by collection_run.started_at desc, collection_run.id desc
  limit 1
) latest_run on true;

revoke all on public.github_repository_shadow_summaries from public, anon, authenticated, service_role;
grant select on public.github_repository_shadow_summaries to authenticated, service_role;
