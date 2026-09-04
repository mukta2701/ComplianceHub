-- Additive native Jira forward port. Final leased lifecycle definitions from the resumed
-- implementation, composed after canonical history. Broker and official GitHub
-- identities, rows, privileges and workers remain authoritative.


create type public.integration_connection_health as enum (
  'never_synced',
  'healthy',
  'needs_attention'
);

alter table public.integration_connections
  add column provider_account_id text,
  add column provider_account_name text,
  add column token_expires_at timestamptz,
  add column health public.integration_connection_health not null default 'never_synced',
  add column last_sync_attempt_at timestamptz,
  add column last_sync_succeeded_at timestamptz,
  add column last_error text,
  add column jira_webhook_id text,
  add column jira_webhook_expires_at timestamptz,
  add constraint integration_connections_provider_account_id_check check (
    provider_account_id is null
    or (
      nullif(pg_catalog.btrim(provider_account_id), '') is not null
      and pg_catalog.char_length(provider_account_id) <= 255
    )
  ),
  add constraint integration_connections_provider_account_name_check check (
    provider_account_name is null
    or (
      nullif(pg_catalog.btrim(provider_account_name), '') is not null
      and pg_catalog.char_length(provider_account_name) <= 240
    )
  ),
  add constraint integration_connections_safe_error_check check (
    last_error is null
    or (
      pg_catalog.char_length(last_error) <= 500
      and last_error !~ '[\r\n]'
    )
  ),
  add constraint integration_connections_jira_webhook_id_check check (
    jira_webhook_id is null
    or (
      nullif(pg_catalog.btrim(jira_webhook_id), '') is not null
      and pg_catalog.char_length(jira_webhook_id) <= 255
    )
  );

create unique index integration_connections_one_active_native_provider
on public.integration_connections(organisation_id, provider)
where revoked_at is null
  and connection_mode in ('github_app', 'jira_oauth');

alter table public.integration_connections
  add constraint integration_connections_id_organisation_provider_key
    unique (id, organisation_id, provider);

create table public.integration_connection_targets (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  connection_id uuid not null,
  provider public.integration_provider not null check (provider = 'jira'),
  kind text not null,
  external_id text not null,
  display_name text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  unique (id, organisation_id, provider),
  constraint integration_connection_targets_connection_tenant_fk
    foreign key (connection_id, organisation_id, provider)
    references public.integration_connections(id, organisation_id, provider)
    on delete cascade,
  constraint integration_connection_targets_creator_tenant_fk
    foreign key (organisation_id, created_by)
    references public.memberships(organisation_id, user_id)
    on delete set null (created_by),
  constraint integration_connection_targets_kind_check check (
    (provider = 'github' and kind = 'repository')
    or (provider = 'jira' and kind = 'project')
  ),
  constraint integration_connection_targets_external_id_check check (
    nullif(pg_catalog.btrim(external_id), '') is not null
    and pg_catalog.char_length(external_id) <= 255
    and external_id ~ '^[A-Za-z0-9._:/-]+$'
  ),
  constraint integration_connection_targets_display_name_check check (
    nullif(pg_catalog.btrim(display_name), '') is not null
    and pg_catalog.char_length(display_name) <= 240
  ),
  constraint integration_connection_targets_safe_config_check check (
    coalesce(
      case provider
        when 'github' then
          kind = 'repository'
          and pg_catalog.jsonb_typeof(config) = 'object'
          and config = pg_catalog.jsonb_build_object(
            'owner', config -> 'owner',
            'repo', config -> 'repo'
          )
          and pg_catalog.jsonb_typeof(config -> 'owner') = 'string'
          and pg_catalog.jsonb_typeof(config -> 'repo') = 'string'
          and (config ->> 'owner') ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
          and (config ->> 'repo') ~ '^[A-Za-z0-9._-]{1,100}$'
          and (config ->> 'repo') not in ('.', '..')
        when 'jira' then
          kind = 'project'
          and pg_catalog.jsonb_typeof(config) = 'object'
          and config = pg_catalog.jsonb_build_object(
            'baseUrl', config -> 'baseUrl',
            'cloudId', config -> 'cloudId',
            'projectKey', config -> 'projectKey'
          )
          and pg_catalog.jsonb_typeof(config -> 'baseUrl') = 'string'
          and pg_catalog.jsonb_typeof(config -> 'cloudId') = 'string'
          and pg_catalog.jsonb_typeof(config -> 'projectKey') = 'string'
          and (config ->> 'baseUrl') ~* '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.atlassian\.net/?$'
          and pg_catalog.char_length(config ->> 'baseUrl') <= 255
          and (config ->> 'cloudId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and (config ->> 'projectKey') ~ '^[A-Z][A-Z0-9_]{0,79}$'
        else false
      end,
      false
    )
  )
);

create unique index integration_connection_targets_one_active_external_id
on public.integration_connection_targets(connection_id, external_id)
where revoked_at is null;

create index integration_connection_targets_org_active_idx
on public.integration_connection_targets(organisation_id, provider)
where revoked_at is null and enabled;

alter table public.integration_connection_targets enable row level security;

create policy integration_connection_targets_members_select
on public.integration_connection_targets for select to authenticated
using (public.is_organisation_member(organisation_id));

create policy integration_connection_targets_operators_insert
on public.integration_connection_targets for insert to authenticated
with check (
  public.is_organisation_operator(organisation_id)
  and created_by = (select auth.uid())
  and revoked_at is null
);

create policy integration_connection_targets_operators_update
on public.integration_connection_targets for update to authenticated
using (public.is_organisation_operator(organisation_id))
with check (public.is_organisation_operator(organisation_id));

revoke all on public.integration_connection_targets from public, anon, authenticated;

grant select, insert, update on public.integration_connection_targets to authenticated;

grant select, insert, update on public.integration_connection_targets to service_role;

alter table public.monitor_sources
  drop constraint if exists monitor_sources_connection_tenant_fk,
  drop constraint if exists monitor_sources_mode_check,
  add column integration_connection_target_id uuid,
  add constraint monitor_sources_connection_tenant_fk
    foreign key (integration_connection_id, organisation_id)
    references public.integration_connections(id, organisation_id)
    on delete cascade,
  add constraint monitor_sources_target_tenant_fk
    foreign key (integration_connection_target_id, organisation_id)
    references public.integration_connection_targets(id, organisation_id)
    on delete cascade,
  add constraint monitor_sources_mode_check check (
    (
      connection_mode = 'sandbox'
      and integration_connection_id is null
      and integration_connection_target_id is null
      and broker_connection_id is null
      and broker_provider_config_key is null
    )
    or (
      connection_mode = 'jira_oauth'
      and provider::text = 'jira'
      and integration_connection_id is not null
      and integration_connection_target_id is not null
      and access_token is null
      and refresh_token is null
      and broker_connection_id is null
      and broker_provider_config_key is null
    )
    or (
      connection_mode = 'oauth'
      and integration_connection_id is not null
      and integration_connection_target_id is null
      and nullif(pg_catalog.btrim(broker_connection_id), '') is not null
      and nullif(pg_catalog.btrim(broker_provider_config_key), '') is not null
      and access_token is null
      and refresh_token is null
    )
  );

create unique index monitor_sources_integration_target_unique
on public.monitor_sources(integration_connection_target_id)
where integration_connection_target_id is not null;

grant select (integration_connection_target_id)
on public.monitor_sources to authenticated;

-- Preserve the canonical Member-facing source summary contract. Native Jira
-- adds rows to the existing monitor_sources table, so the stable, narrow RPC
-- remains valid and must not be dropped during the forward migration.

create table public.integration_authorization_states (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null,
  user_id uuid not null,
  provider public.integration_provider not null check (provider = 'jira'),
  state_hash text not null unique,
  purpose text not null,
  continuation jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint integration_authorization_states_membership_fk
    foreign key (organisation_id, user_id)
    references public.memberships(organisation_id, user_id)
    on delete cascade,
  constraint integration_authorization_states_state_hash_check check (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint integration_authorization_states_purpose_check check (
    purpose ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  constraint integration_authorization_states_continuation_check check (
    pg_catalog.jsonb_typeof(continuation) = 'object'
    and pg_catalog.octet_length(continuation::text) <= 4096
  ),
  constraint integration_authorization_states_lifetime_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '10 minutes'
  ),
  constraint integration_authorization_states_consumed_check check (
    consumed_at is null
    or (consumed_at >= created_at and consumed_at < expires_at)
  )
);

create index integration_authorization_states_expiry_idx
on public.integration_authorization_states(expires_at)
where consumed_at is null;

alter table public.integration_authorization_states enable row level security;

revoke all on public.integration_authorization_states from public, anon, authenticated, service_role;

grant insert (
  organisation_id, user_id, provider, state_hash, purpose,
  continuation, expires_at
) on public.integration_authorization_states to service_role;

alter table public.integration_connection_targets
  add constraint integration_connection_targets_id_org_provider_connection_key
  unique (id, organisation_id, provider, connection_id);

create table public.integration_webhook_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider public.integration_provider not null check (provider = 'jira'),
  connection_id uuid,
  target_id uuid,
  delivery_key text not null,
  event_type text not null,
  payload jsonb not null,
  payload_hash text not null,
  status text not null default 'received',
  received_at timestamptz not null default pg_catalog.now(),
  processed_at timestamptz,
  unique (organisation_id, provider, delivery_key),
  constraint integration_webhook_deliveries_connection_tenant_fk
    foreign key (connection_id, organisation_id, provider)
    references public.integration_connections(id, organisation_id, provider)
    on delete cascade,
  constraint integration_webhook_deliveries_target_tenant_fk
    foreign key (target_id, organisation_id, provider, connection_id)
    references public.integration_connection_targets(id, organisation_id, provider, connection_id)
    on delete cascade,
  constraint integration_webhook_deliveries_target_connection_check check (
    target_id is null or connection_id is not null
  ),
  constraint integration_webhook_deliveries_delivery_key_check check (
    nullif(pg_catalog.btrim(delivery_key), '') is not null
    and pg_catalog.char_length(delivery_key) <= 255
    and delivery_key !~ '[\r\n]'
  ),
  constraint integration_webhook_deliveries_event_type_check check (
    event_type ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
  ),
  constraint integration_webhook_deliveries_payload_check check (
    pg_catalog.jsonb_typeof(payload) = 'object'
    and pg_catalog.octet_length(payload::text) <= 262144
  ),
  constraint integration_webhook_deliveries_payload_hash_check check (
    payload_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint integration_webhook_deliveries_status_check check (
    status in ('received', 'processing', 'processed', 'failed')
  ),
  constraint integration_webhook_deliveries_processed_state_check check (
    (status = 'processed' and processed_at is not null and processed_at >= received_at)
    or (status <> 'processed' and processed_at is null)
  )
);

create index integration_webhook_deliveries_pending_idx
on public.integration_webhook_deliveries(received_at, id)
where status in ('received', 'failed');

alter table public.integration_webhook_deliveries enable row level security;

revoke all on public.integration_webhook_deliveries from public, anon, authenticated, service_role;

grant select (
  id, organisation_id, provider, connection_id, target_id, delivery_key,
  event_type, payload, payload_hash, status, received_at, processed_at
) on public.integration_webhook_deliveries to service_role;

grant insert (
  organisation_id, provider, connection_id, target_id, delivery_key,
  event_type, payload, payload_hash
) on public.integration_webhook_deliveries to service_role;

grant update (status, processed_at)
on public.integration_webhook_deliveries to service_role;

create table public.integration_sync_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  provider public.integration_provider not null check (provider = 'jira'),
  connection_id uuid not null,
  target_id uuid,
  kind text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default pg_catalog.now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  safe_error text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organisation_id, provider, idempotency_key),
  constraint integration_sync_jobs_connection_tenant_fk
    foreign key (connection_id, organisation_id, provider)
    references public.integration_connections(id, organisation_id, provider)
    on delete cascade,
  constraint integration_sync_jobs_target_tenant_fk
    foreign key (target_id, organisation_id, provider, connection_id)
    references public.integration_connection_targets(id, organisation_id, provider, connection_id)
    on delete cascade,
  constraint integration_sync_jobs_kind_check check (
    kind ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  constraint integration_sync_jobs_idempotency_key_check check (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$'
  ),
  constraint integration_sync_jobs_payload_check check (
    pg_catalog.jsonb_typeof(payload) = 'object'
    and pg_catalog.octet_length(payload::text) <= 32768
  ),
  constraint integration_sync_jobs_status_check check (
    status in ('queued', 'running', 'completed', 'failed')
  ),
  constraint integration_sync_jobs_attempt_count_check check (
    attempt_count between 0 and 20
  ),
  constraint integration_sync_jobs_locked_by_check check (
    locked_by is null
    or (
      nullif(pg_catalog.btrim(locked_by), '') is not null
      and pg_catalog.char_length(locked_by) <= 120
      and locked_by !~ '[\r\n]'
    )
  ),
  constraint integration_sync_jobs_safe_error_check check (
    safe_error is null
    or (
      nullif(pg_catalog.btrim(safe_error), '') is not null
      and pg_catalog.char_length(safe_error) <= 500
      and safe_error !~ '[\r\n]'
    )
  ),
  constraint integration_sync_jobs_state_check check (
    (
      status = 'queued'
      and attempt_count = 0
      and locked_at is null
      and locked_by is null
      and completed_at is null
      and safe_error is null
    )
    or (
      status = 'running'
      and attempt_count between 1 and 20
      and locked_at is not null
      and locked_by is not null
      and completed_at is null
      and safe_error is null
    )
    or (
      status = 'completed'
      and attempt_count between 1 and 20
      and locked_at is null
      and locked_by is null
      and completed_at is not null
      and completed_at >= created_at
      and safe_error is null
    )
    or (
      status = 'failed'
      and attempt_count between 1 and 20
      and locked_at is null
      and locked_by is null
      and completed_at is null
      and safe_error is not null
    )
  )
);

create index integration_sync_jobs_due_idx
on public.integration_sync_jobs(next_attempt_at, created_at, id)
where status in ('queued', 'failed') and attempt_count < 20;

alter table public.integration_sync_jobs enable row level security;

revoke all on public.integration_sync_jobs from public, anon, authenticated, service_role;

grant select (
  id, organisation_id, provider, connection_id, target_id, kind,
  idempotency_key, payload, status, attempt_count, next_attempt_at,
  locked_at, locked_by, completed_at, safe_error, created_at, updated_at
) on public.integration_sync_jobs to service_role;

grant insert (
  organisation_id, provider, connection_id, target_id, kind,
  idempotency_key, payload, next_attempt_at
) on public.integration_sync_jobs to service_role;

grant update (
  status, attempt_count, next_attempt_at, locked_at, locked_by,
  completed_at, safe_error
) on public.integration_sync_jobs to service_role;

alter table public.integration_connections
  add column jira_webhook_callback_hash text,
  add column jira_refresh_lease_id uuid,
  add column jira_refresh_lease_expires_at timestamptz,
  add column jira_refresh_generation integer not null default 0,
  add constraint integration_connections_jira_callback_hash_check check (
    jira_webhook_callback_hash is null
    or (
      connection_mode = 'jira_oauth'
      and provider = 'jira'
      and jira_webhook_callback_hash ~ '^[0-9a-f]{64}$'
    )
  ),
  add constraint integration_connections_jira_refresh_generation_check check (
    jira_refresh_generation between 0 and 2147483646
    and (
      (connection_mode = 'jira_oauth' and provider = 'jira')
      or jira_refresh_generation = 0
    )
  ),
  add constraint integration_connections_jira_refresh_lease_check check (
    (
      jira_refresh_lease_id is null
      and jira_refresh_lease_expires_at is null
    )
    or (
      connection_mode = 'jira_oauth'
      and provider = 'jira'
      and jira_refresh_lease_id is not null
      and jira_refresh_lease_expires_at is not null
    )
  );

alter table public.integration_webhook_deliveries
  drop constraint integration_webhook_deliveries_processed_state_check,
  add column processing_started_at timestamptz,
  add column processing_lock_token uuid,
  add constraint integration_webhook_deliveries_id_org_provider_key
    unique (id, organisation_id, provider);

alter table public.integration_webhook_deliveries
  add constraint integration_webhook_deliveries_lifecycle_check check (
    (
      status = 'received'
      and processing_started_at is null
      and processing_lock_token is null
      and processed_at is null
    )
    or (
      status = 'processing'
      and processing_started_at is not null
      and processing_lock_token is not null
      and processed_at is null
    )
    or (
      status = 'failed'
      and processing_started_at is null
      and processing_lock_token is null
      and processed_at is null
    )
    or (
      status = 'processed'
      and processing_started_at is null
      and processing_lock_token is null
      and processed_at is not null
      and processed_at >= received_at
    )
  );

alter table public.integration_sync_jobs
  drop constraint integration_sync_jobs_state_check,
  drop constraint integration_sync_jobs_status_check,
  add column webhook_delivery_id uuid,
  add column lock_token uuid,
  add constraint integration_sync_jobs_status_check check (
    status in ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  add constraint integration_sync_jobs_delivery_tenant_fk
    foreign key (webhook_delivery_id, organisation_id, provider)
    references public.integration_webhook_deliveries(id, organisation_id, provider)
    on delete cascade;

alter table public.integration_sync_jobs
  add constraint integration_sync_jobs_state_check check (
    (
      status = 'queued'
      and attempt_count = 0
      and locked_at is null
      and locked_by is null
      and lock_token is null
      and completed_at is null
      and safe_error is null
    )
    or (
      status = 'running'
      and attempt_count between 1 and 20
      and locked_at is not null
      and locked_by is not null
      and lock_token is not null
      and completed_at is null
      and safe_error is null
    )
    or (
      status = 'completed'
      and attempt_count between 1 and 20
      and locked_at is null
      and locked_by is null
      and lock_token is null
      and completed_at is not null
      and completed_at >= created_at
      and safe_error is null
    )
    or (
      status = 'failed'
      and attempt_count between 1 and 20
      and locked_at is null
      and locked_by is null
      and lock_token is null
      and completed_at is null
      and safe_error is not null
    )
    or (
      status = 'cancelled'
      and attempt_count between 0 and 20
      and locked_at is null
      and locked_by is null
      and lock_token is null
      and completed_at is not null
      and completed_at >= created_at
      and safe_error = 'Connection or target is inactive.'
    )
  );

create unique index integration_sync_jobs_one_per_webhook_delivery
on public.integration_sync_jobs(webhook_delivery_id)
where webhook_delivery_id is not null;

create index integration_sync_jobs_stale_running_idx
on public.integration_sync_jobs(locked_at, id)
where status = 'running';

revoke all on public.integration_webhook_deliveries from service_role;

grant select (
  id, organisation_id, provider, connection_id, target_id, delivery_key,
  event_type, payload, payload_hash, status, received_at, processed_at,
  processing_started_at
) on public.integration_webhook_deliveries to service_role;

revoke all on public.integration_sync_jobs from service_role;

grant select (
  id, organisation_id, provider, connection_id, target_id, kind,
  idempotency_key, payload, status, attempt_count, next_attempt_at,
  locked_at, locked_by, completed_at, safe_error,
  webhook_delivery_id, created_at, updated_at
) on public.integration_sync_jobs to service_role;

grant insert (
  organisation_id, provider, connection_id, target_id, kind,
  idempotency_key, payload, next_attempt_at
) on public.integration_sync_jobs to service_role;

alter table public.integration_connection_targets
  drop constraint integration_connection_targets_safe_config_check,
  add constraint integration_connection_targets_safe_config_check check (
    coalesce(
      case provider
        when 'github' then
          kind = 'repository'
          and pg_catalog.jsonb_typeof(config) = 'object'
          and config = pg_catalog.jsonb_build_object(
            'owner', config -> 'owner',
            'repo', config -> 'repo'
          )
          and pg_catalog.jsonb_typeof(config -> 'owner') = 'string'
          and pg_catalog.jsonb_typeof(config -> 'repo') = 'string'
          and (config ->> 'owner') ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'
          and (config ->> 'repo') ~ '^[A-Za-z0-9._-]{1,100}$'
          and (config ->> 'repo') not in ('.', '..')
        when 'jira' then
          kind = 'project'
          and pg_catalog.jsonb_typeof(config) = 'object'
          and config = pg_catalog.jsonb_build_object(
            'baseUrl', config -> 'baseUrl',
            'cloudId', config -> 'cloudId',
            'projectKey', config -> 'projectKey'
          )
          and pg_catalog.jsonb_typeof(config -> 'baseUrl') = 'string'
          and pg_catalog.jsonb_typeof(config -> 'cloudId') = 'string'
          and pg_catalog.jsonb_typeof(config -> 'projectKey') = 'string'
          and (config ->> 'baseUrl') ~* '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.atlassian\.net/?$'
          and pg_catalog.char_length(config ->> 'baseUrl') <= 255
          and (config ->> 'cloudId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and (config ->> 'projectKey') ~ '^[A-Z][A-Z0-9_]{0,79}$'
        else false
      end,
      false
    )
  );

create table public.pending_jira_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  accessible_sites jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint pending_jira_authorizations_member_fk
    foreign key (organisation_id, user_id)
    references public.memberships(organisation_id, user_id)
    on delete cascade,
  constraint pending_jira_authorizations_lifecycle_check check (
    (
      consumed_at is null
      and access_token is not null
      and refresh_token is not null
      and access_token ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
      and refresh_token ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
      and pg_catalog.char_length(access_token) <= 8192
      and pg_catalog.char_length(refresh_token) <= 8192
      and token_expires_at is not null
    )
    or (
      consumed_at is not null
      and access_token is null
      and refresh_token is null
      and token_expires_at is null
    )
  ),
  constraint pending_jira_authorizations_expiry_check check (
    expires_at > created_at
  )
);

create index pending_jira_authorizations_expiry_idx
on public.pending_jira_authorizations(expires_at)
where consumed_at is null;

alter table public.pending_jira_authorizations enable row level security;

revoke all on public.pending_jira_authorizations from public, anon, authenticated, service_role;

revoke insert, update, delete
on public.integration_connection_targets
from authenticated;

create unique index integration_connections_unique_jira_callback_hash
on public.integration_connections(jira_webhook_callback_hash)
where jira_webhook_callback_hash is not null;

alter table public.integration_connections
  add column jira_webhook_generation integer not null default 0,
  add column jira_cleanup_credentials_pending boolean not null default false;

alter table public.integration_connections
  drop constraint integration_connections_mode_check,
  add constraint integration_connections_mode_check check (
    (
      connection_mode = 'sandbox'
      and broker_connection_id is null
      and broker_provider_config_key is null
      and provider_account_id is null
      and provider_account_name is null
      and token_expires_at is null
      and not jira_cleanup_credentials_pending
    )
    or (
      connection_mode = 'jira_oauth'
      and provider = 'jira'
      and config = '{}'::jsonb
      and provider_account_id is not null
      and provider_account_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and nullif(pg_catalog.btrim(provider_account_name), '') is not null
      and broker_connection_id is null
      and broker_provider_config_key is null
      and (
        (
          revoked_at is null
          and not jira_cleanup_credentials_pending
          and access_token is not null
          and refresh_token is not null
          and access_token ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
          and refresh_token ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
          and pg_catalog.char_length(access_token) <= 8192
          and pg_catalog.char_length(refresh_token) <= 8192
          and token_expires_at is not null
        )
        or (
          revoked_at is not null
          and not enabled
          and (
            (
              not jira_cleanup_credentials_pending
              and access_token is null
              and refresh_token is null
              and token_expires_at is null
            )
            or (
              jira_cleanup_credentials_pending
              and access_token is not null
              and refresh_token is not null
              and access_token ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
              and refresh_token ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
              and pg_catalog.char_length(access_token) <= 8192
              and pg_catalog.char_length(refresh_token) <= 8192
              and token_expires_at is not null
            )
          )
        )
      )
    )
    or (
      connection_mode = 'oauth'
      and nullif(pg_catalog.btrim(broker_connection_id), '') is not null
      and pg_catalog.char_length(broker_connection_id) <= 255
      and nullif(pg_catalog.btrim(broker_provider_config_key), '') is not null
      and pg_catalog.char_length(broker_provider_config_key) <= 255
      and access_token is null
      and refresh_token is null
      and provider_account_id is null
      and provider_account_name is null
      and token_expires_at is null
      and not jira_cleanup_credentials_pending
    )
  );

alter table public.integration_connections
  drop constraint if exists integration_connections_jira_webhook_id_check,
  drop constraint if exists integration_connections_jira_callback_hash_check,
  add constraint integration_connections_jira_webhook_generation_check check (
    jira_webhook_generation between 0 and 2147483646
    and (
      (provider = 'jira' and connection_mode = 'jira_oauth')
      or jira_webhook_generation = 0
    )
  ),
  add constraint integration_connections_jira_webhook_metadata_check check (
    (
      jira_webhook_id is null
      and jira_webhook_expires_at is null
      and jira_webhook_callback_hash is null
    )
    or (
      provider = 'jira'
      and connection_mode = 'jira_oauth'
      and jira_webhook_id ~ '^[1-9][0-9]{0,15}$'
      and jira_webhook_expires_at is not null
      and jira_webhook_callback_hash ~ '^[0-9a-f]{64}$'
    )
  );

alter table public.integration_connection_targets
  add column health public.integration_connection_health not null default 'never_synced',
  add column last_sync_attempt_at timestamptz,
  add column last_sync_succeeded_at timestamptz,
  add column last_error text,
  add constraint integration_connection_targets_safe_error_check check (
    last_error is null
    or (
      pg_catalog.char_length(last_error) <= 500
      and last_error !~ '[\r\n]'
    )
  );

create table public.jira_webhook_cleanup_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  credential_connection_id uuid not null references public.integration_connections(id) on delete cascade,
  cloud_id text not null,
  webhook_id text,
  callback_hash text,
  ownership_token uuid,
  reason text not null,
  provider_expires_at timestamptz not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  absent_observations integer not null default 0,
  next_attempt_at timestamptz not null default pg_catalog.now(),
  locked_at timestamptz,
  locked_by text,
  lock_token uuid,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint jira_webhook_cleanup_cloud_check check (
    cloud_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  constraint jira_webhook_cleanup_webhook_check check (
    webhook_id is null or webhook_id ~ '^[1-9][0-9]{0,15}$'
  ),
  constraint jira_webhook_cleanup_callback_check check (
    callback_hash is null or callback_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint jira_webhook_cleanup_reason_check check (reason in ('replaced', 'disconnect', 'candidate')),
  constraint jira_webhook_cleanup_attempt_check check (attempt_count between 0 and 20),
  constraint jira_webhook_cleanup_absent_check check (absent_observations between 0 and 2),
  constraint jira_webhook_cleanup_identity_check check (
    (reason = 'candidate' and callback_hash is not null and ownership_token is not null)
    or (reason in ('replaced', 'disconnect') and webhook_id is not null and callback_hash is null and ownership_token is null)
  ),
  constraint jira_webhook_cleanup_state_check check (
    (status in ('prepared', 'queued') and attempt_count = 0 and locked_at is null and locked_by is null and lock_token is null and completed_at is null)
    or (status = 'running' and attempt_count between 1 and 20 and locked_at is not null and locked_by is not null and lock_token is not null and completed_at is null)
    or (status = 'failed' and attempt_count between 1 and 20 and locked_at is null and locked_by is null and lock_token is null and completed_at is null)
    or (status in ('completed', 'promoted') and locked_at is null and locked_by is null and lock_token is null and completed_at is not null)
  )
);

create unique index jira_webhook_cleanup_candidate_hash_unique
on public.jira_webhook_cleanup_jobs(organisation_id, cloud_id, callback_hash)
where callback_hash is not null;

create unique index jira_webhook_cleanup_nonterminal_webhook_unique
on public.jira_webhook_cleanup_jobs(organisation_id, cloud_id, webhook_id)
where webhook_id is not null and status not in ('completed', 'promoted');

create index jira_webhook_cleanup_due_idx
on public.jira_webhook_cleanup_jobs(next_attempt_at, created_at, id)
where status in ('prepared', 'queued', 'failed') and attempt_count < 20;

alter table public.jira_webhook_cleanup_jobs enable row level security;

revoke all on public.jira_webhook_cleanup_jobs from public, anon, authenticated, service_role;

revoke all on public.integration_connection_targets
  from public, anon, authenticated, service_role;

grant select on public.integration_connection_targets to authenticated, service_role;

grant insert (
  id, organisation_id, connection_id, provider, kind, external_id,
  display_name, config, enabled, revoked_at, created_by, created_at, updated_at
) on public.integration_connection_targets to service_role;

grant update (
  id, organisation_id, connection_id, provider, kind, external_id,
  display_name, config, enabled, revoked_at, created_by, created_at, updated_at
) on public.integration_connection_targets to service_role;

create table public.integration_sync_claim_organisations (
  organisation_id uuid primary key
    references public.organisations(id) on delete cascade,
  last_claimed_at timestamptz not null default '-infinity'::timestamptz
);

create table public.integration_sync_claim_connections (
  connection_id uuid primary key,
  organisation_id uuid not null,
  provider public.integration_provider not null check (provider = 'jira'),
  last_claimed_at timestamptz not null default '-infinity'::timestamptz,
  constraint integration_sync_claim_connections_tenant_fk
    foreign key (connection_id, organisation_id, provider)
    references public.integration_connections(id, organisation_id, provider)
    on delete cascade
);

create index integration_sync_claim_connections_org_fair_idx
on public.integration_sync_claim_connections(
  organisation_id, last_claimed_at, connection_id
);

alter table public.integration_sync_claim_organisations enable row level security;

alter table public.integration_sync_claim_connections enable row level security;

revoke all on public.integration_sync_claim_organisations
  from public, anon, authenticated, service_role;

revoke all on public.integration_sync_claim_connections
  from public, anon, authenticated, service_role;

alter table public.integration_sync_jobs
  add constraint integration_sync_jobs_id_org_provider_key
  unique (id, organisation_id, provider);

alter table public.integration_webhook_deliveries
  add column coalesced_job_id uuid,
  add constraint integration_webhook_deliveries_coalesced_job_fk
    foreign key (coalesced_job_id, organisation_id, provider)
    references public.integration_sync_jobs(id, organisation_id, provider)
    on delete set null (coalesced_job_id);

create index integration_webhook_deliveries_connection_retention_idx
on public.integration_webhook_deliveries(connection_id, received_at, id);

create index integration_webhook_deliveries_coalesced_job_idx
on public.integration_webhook_deliveries(coalesced_job_id)
where coalesced_job_id is not null;

create table public.integration_webhook_delivery_rollups (
  connection_id uuid primary key,
  organisation_id uuid not null,
  provider public.integration_provider not null check (provider = 'jira'),
  accepted_unique_count bigint not null default 0,
  compacted_count bigint not null default 0,
  last_delivery_id uuid,
  last_delivery_key_hash text,
  last_received_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint integration_webhook_delivery_rollups_count_check check (
    accepted_unique_count >= 0
    and compacted_count >= 0
    and compacted_count <= accepted_unique_count
  ),
  constraint integration_webhook_delivery_rollups_hash_check check (
    last_delivery_key_hash is null
    or last_delivery_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint integration_webhook_delivery_rollups_tenant_fk
    foreign key (connection_id, organisation_id, provider)
    references public.integration_connections(id, organisation_id, provider)
    on delete cascade
);

alter table public.integration_webhook_delivery_rollups enable row level security;

revoke all on public.integration_webhook_delivery_rollups
  from public, anon, authenticated, service_role;

alter table public.jira_webhook_cleanup_jobs
  add column callback_origin text;

create index integration_sync_jobs_parent_child_due_idx
on public.integration_sync_jobs(
  (payload ->> 'parentJobId'), next_attempt_at, created_at, id
)
where kind = 'target_sync';

-- Final definition: 20260714170000_native_connections_and_targets.sql
create or replace function public.list_native_jira_connection_summaries(target_organisation_id uuid)
returns table (
  id uuid,
  provider text,
  label text,
  provider_account_name text,
  enabled boolean,
  health text,
  connected_at timestamptz,
  last_sync_succeeded_at timestamptz,
  target_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    connection.id,
    connection.provider::text,
    connection.label,
    connection.provider_account_name,
    connection.enabled,
    connection.health::text,
    connection.created_at,
    connection.last_sync_succeeded_at,
    count(target.id)
  from public.integration_connections as connection
  left join public.integration_connection_targets as target
    on target.connection_id = connection.id
   and target.organisation_id = connection.organisation_id
   and target.revoked_at is null
  where connection.organisation_id = target_organisation_id
    and connection.revoked_at is null
    and connection.connection_mode in ('jira_oauth')
    and exists (
      select 1
      from public.memberships as membership
      where membership.organisation_id = target_organisation_id
        and membership.user_id = (select auth.uid())
    )
  group by connection.id
  order by connection.created_at, connection.id;
$$;

alter function public.list_native_jira_connection_summaries(uuid) owner to postgres;

revoke all on function public.list_native_jira_connection_summaries(uuid) from public, anon, authenticated;

grant execute on function public.list_native_jira_connection_summaries(uuid) to authenticated;

-- Final definition: 20260714170000_native_connections_and_targets.sql
create or replace function public.enforce_native_connection_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.connection_mode <> 'jira_oauth' then return new; end if;
  if new.organisation_id is distinct from old.organisation_id
     or new.provider is distinct from old.provider
     or new.connection_mode is distinct from old.connection_mode
     or new.provider_account_id is distinct from old.provider_account_id then
    raise exception using
      errcode = 'P0001',
      message = 'Native connection identity is immutable';
  end if;

  if old.connection_mode = 'oauth'
     and (
       new.broker_connection_id is distinct from old.broker_connection_id
       or new.broker_provider_config_key is distinct from old.broker_provider_config_key
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'Historical broker identity is immutable';
  end if;

  if old.revoked_at is not null and new.revoked_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'A revoked connection cannot be restored';
  end if;

  return new;
end;
$$;

alter function public.enforce_native_connection_identity() owner to postgres;

revoke all on function public.enforce_native_connection_identity() from public, anon, authenticated, service_role;

-- Final definition: 20260714170000_native_connections_and_targets.sql
create or replace function public.prepare_integration_connection_target()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_mode text;
  parent_revoked_at timestamptz;
  parent_provider_account_id text;
begin
  select
    connection.connection_mode,
    connection.revoked_at,
    connection.provider_account_id
  into parent_mode, parent_revoked_at, parent_provider_account_id
  from public.integration_connections as connection
  where connection.id = new.connection_id
    and connection.organisation_id = new.organisation_id
    and connection.provider = new.provider;

  if not found then
    return new;
  end if;

  if (new.provider = 'github' and parent_mode <> 'github_app')
     or (new.provider = 'jira' and parent_mode <> 'jira_oauth') then
    raise exception using
      errcode = '23514',
      message = 'Target requires an active native provider connection';
  end if;

  if parent_revoked_at is not null
     and not (
       tg_op = 'UPDATE'
       and not new.enabled
       and new.revoked_at is not null
     ) then
    raise exception using
      errcode = '23514',
      message = 'Target requires an active native provider connection';
  end if;

  if new.provider = 'jira'
     and (new.config ->> 'cloudId') is distinct from parent_provider_account_id then
    raise exception using
      errcode = '23514',
      message = 'Jira target cloudId must match its parent connection';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.organisation_id is distinct from old.organisation_id
       or new.connection_id is distinct from old.connection_id
       or new.provider is distinct from old.provider
       or new.kind is distinct from old.kind
       or new.external_id is distinct from old.external_id then
      raise exception using
        errcode = 'P0001',
        message = 'Connection target identity is immutable';
    end if;
    if new.created_by is distinct from old.created_by
       and not (
         old.created_by is not null
         and new.created_by is null
         and not exists (
           select 1
           from public.memberships as creator_membership
           where creator_membership.organisation_id = old.organisation_id
             and creator_membership.user_id = old.created_by
         )
       ) then
      raise exception using
        errcode = 'P0001',
        message = 'Connection target creator provenance is immutable';
    end if;
    if old.revoked_at is not null and new.revoked_at is null then
      raise exception using
        errcode = 'P0001',
        message = 'A revoked connection target cannot be restored';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

alter function public.prepare_integration_connection_target() owner to postgres;

revoke all on function public.prepare_integration_connection_target() from public, anon, authenticated, service_role;

-- Final definition: 20260714170000_native_connections_and_targets.sql
create or replace function public.sync_native_target_monitor_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent record;
begin
  select
    connection.id,
    connection.connection_mode,
    connection.connected_by,
    connection.enabled,
    connection.revoked_at
  into parent
  from public.integration_connections as connection
  where connection.id = new.connection_id
    and connection.organisation_id = new.organisation_id
    and connection.provider = new.provider;

  if not found then
    return new;
  end if;

  if new.enabled
     and new.revoked_at is null
     and parent.enabled
     and parent.revoked_at is null then
    insert into public.monitor_sources (
      organisation_id,
      provider,
      label,
      config,
      access_token,
      refresh_token,
      connected_by,
      revoked_at,
      enabled,
      connection_mode,
      integration_connection_id,
      integration_connection_target_id,
      broker_connection_id,
      broker_provider_config_key
    ) values (
      new.organisation_id,
      new.provider::text::public.monitor_provider,
      new.display_name,
      new.config,
      null,
      null,
      coalesce(new.created_by, parent.connected_by),
      null,
      true,
      parent.connection_mode,
      parent.id,
      new.id,
      null,
      null
    )
    on conflict (integration_connection_target_id)
      where integration_connection_target_id is not null
    do update set
      label = excluded.label,
      config = excluded.config,
      access_token = null,
      refresh_token = null,
      connected_by = excluded.connected_by,
      revoked_at = null,
      enabled = true,
      connection_mode = excluded.connection_mode,
      integration_connection_id = excluded.integration_connection_id,
      broker_connection_id = null,
      broker_provider_config_key = null;
  else
    update public.monitor_sources
    set label = new.display_name,
        config = new.config,
        connected_by = coalesce(new.created_by, parent.connected_by),
        enabled = false,
        revoked_at = case
          when new.revoked_at is not null or parent.revoked_at is not null
            then coalesce(revoked_at, new.revoked_at, parent.revoked_at, now())
          else revoked_at
        end
    where integration_connection_target_id = new.id
      and organisation_id = new.organisation_id;
  end if;

  return new;
end;
$$;

alter function public.sync_native_target_monitor_source() owner to postgres;

revoke all on function public.sync_native_target_monitor_source() from public, anon, authenticated, service_role;

-- Final definition: 20260714170000_native_connections_and_targets.sql
create or replace function public.sync_native_connection_monitor_sources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.connection_mode not in ('jira_oauth') then
    return new;
  end if;

  if new.revoked_at is not null then
    update public.integration_connection_targets
    set enabled = false,
        revoked_at = coalesce(revoked_at, new.revoked_at)
    where connection_id = new.id
      and organisation_id = new.organisation_id
      and revoked_at is null;
  else
    if new.enabled then
      insert into public.monitor_sources (
        organisation_id,
        provider,
        label,
        config,
        access_token,
        refresh_token,
        connected_by,
        revoked_at,
        enabled,
        connection_mode,
        integration_connection_id,
        integration_connection_target_id,
        broker_connection_id,
        broker_provider_config_key
      )
      select
        target.organisation_id,
        target.provider::text::public.monitor_provider,
        target.display_name,
        target.config,
        null,
        null,
        coalesce(target.created_by, new.connected_by),
        null,
        true,
        new.connection_mode,
        new.id,
        target.id,
        null,
        null
      from public.integration_connection_targets as target
      where target.connection_id = new.id
        and target.organisation_id = new.organisation_id
        and target.enabled
        and target.revoked_at is null
      on conflict (integration_connection_target_id)
        where integration_connection_target_id is not null
      do update set
        provider = excluded.provider,
        label = excluded.label,
        config = excluded.config,
        access_token = null,
        refresh_token = null,
        connected_by = excluded.connected_by,
        revoked_at = null,
        enabled = true,
        connection_mode = excluded.connection_mode,
        integration_connection_id = excluded.integration_connection_id,
        broker_connection_id = null,
        broker_provider_config_key = null;
    end if;

    update public.monitor_sources as source
    set enabled = new.enabled and target.enabled and target.revoked_at is null,
        revoked_at = case
          when target.revoked_at is not null
            then coalesce(source.revoked_at, target.revoked_at)
          else null
        end
    from public.integration_connection_targets as target
    where source.integration_connection_target_id = target.id
      and source.integration_connection_id = new.id
      and source.organisation_id = new.organisation_id;
  end if;

  return new;
end;
$$;

alter function public.sync_native_connection_monitor_sources() owner to postgres;

revoke all on function public.sync_native_connection_monitor_sources() from public, anon, authenticated, service_role;

-- Final definition: 20260714173000_bind_authorization_state_purpose.sql
create function public.consume_integration_authorization_state(
  candidate_state_hash text,
  expected_organisation_id uuid,
  expected_user_id uuid,
  expected_provider public.integration_provider,
  expected_purpose text
)
returns table (
  id uuid,
  organisation_id uuid,
  user_id uuid,
  provider public.integration_provider,
  purpose text,
  continuation jsonb,
  created_at timestamptz,
  expires_at timestamptz,
  consumed_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.integration_authorization_states as authorization_state
  set consumed_at = pg_catalog.now()
  where authorization_state.state_hash = candidate_state_hash
    and authorization_state.organisation_id = expected_organisation_id
    and authorization_state.user_id = expected_user_id
    and authorization_state.provider = expected_provider
    and authorization_state.purpose = expected_purpose
    and authorization_state.consumed_at is null
    and authorization_state.expires_at > pg_catalog.now()
  returning
    authorization_state.id,
    authorization_state.organisation_id,
    authorization_state.user_id,
    authorization_state.provider,
    authorization_state.purpose,
    authorization_state.continuation,
    authorization_state.created_at,
    authorization_state.expires_at,
    authorization_state.consumed_at;
$$;

alter function public.consume_integration_authorization_state(
  text, uuid, uuid, public.integration_provider, text
) owner to postgres;

revoke all on function public.consume_integration_authorization_state(
  text, uuid, uuid, public.integration_provider, text
) from public, anon, authenticated, service_role;

grant execute on function public.consume_integration_authorization_state(
  text, uuid, uuid, public.integration_provider, text
) to service_role;

-- Final definition: 20260714172000_native_job_orchestration.sql
create or replace function public.enforce_native_service_state_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_connection_mode text;
  stored_connection_enabled boolean;
  stored_connection_revoked_at timestamptz;
  stored_target_enabled boolean;
  stored_target_revoked_at timestamptz;
  required_connection_mode text;
begin
  if new.connection_id is null then
    return new;
  end if;

  select connection.connection_mode, connection.enabled, connection.revoked_at
  into stored_connection_mode, stored_connection_enabled, stored_connection_revoked_at
  from public.integration_connections as connection
  where connection.id = new.connection_id
    and connection.organisation_id = new.organisation_id
    and connection.provider = new.provider;



  if not found then
    return new;
  end if;

  required_connection_mode := case new.provider
    when 'github'::public.integration_provider then 'github_app'
    when 'jira'::public.integration_provider then 'jira_oauth'
  end;

  if stored_connection_mode <> required_connection_mode then
    raise exception using
      errcode = '23514',
      message = case tg_table_name
        when 'integration_webhook_deliveries'
          then 'Webhook state requires a native provider connection'
        else 'Synchronization state requires a native provider connection'
      end;
  end if;

  if not stored_connection_enabled or stored_connection_revoked_at is not null then
    raise exception using
      errcode = '23514',
      message = case tg_table_name
        when 'integration_webhook_deliveries'
          then 'Webhook state requires an active provider connection'
        else 'Synchronization state requires an active provider connection'
      end;
  end if;

  if new.target_id is not null then
    select target.enabled, target.revoked_at
    into stored_target_enabled, stored_target_revoked_at
    from public.integration_connection_targets as target
    where target.id = new.target_id
      and target.organisation_id = new.organisation_id
      and target.connection_id = new.connection_id
      and target.provider = new.provider;



    if not found then
      return new;
    end if;

    if not stored_target_enabled or stored_target_revoked_at is not null then
      raise exception using
        errcode = '23514',
        message = case tg_table_name
          when 'integration_webhook_deliveries'
            then 'Webhook state requires an active provider target'
          else 'Synchronization state requires an active provider target'
        end;
    end if;
  end if;

  return new;
end;
$$;

alter function public.enforce_native_service_state_connection() owner to postgres;

revoke all on function public.enforce_native_service_state_connection()
  from public, anon, authenticated, service_role;

-- Final definition: 20260714171000_native_authorization_and_sync_state.sql
create or replace function public.touch_integration_sync_job_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

alter function public.touch_integration_sync_job_updated_at() owner to postgres;

revoke all on function public.touch_integration_sync_job_updated_at() from public, anon, authenticated, service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create or replace function public.claim_jira_refresh_lease(target_connection_id uuid)
returns table (
  lease_id uuid,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  refresh_generation integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare claimed_lease_id uuid := extensions.gen_random_uuid();
begin
  return query
  update public.integration_connections as connection
  set jira_refresh_lease_id = claimed_lease_id,
      jira_refresh_lease_expires_at = pg_catalog.now() + interval '90 seconds'
  where connection.id = target_connection_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null
    and (
      connection.enabled
      or not exists (
        select 1
        from public.integration_connection_targets as target
        where target.connection_id = connection.id
          and target.organisation_id = connection.organisation_id
          and target.provider = 'jira'
          and target.revoked_at is null
      )
    )
    and (connection.jira_refresh_lease_id is null
         or connection.jira_refresh_lease_expires_at <= pg_catalog.now())
  returning connection.jira_refresh_lease_id, connection.access_token,
            connection.refresh_token, connection.token_expires_at,
            connection.jira_refresh_generation;
end;
$$;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create or replace function public.complete_jira_refresh_lease(
  target_connection_id uuid,
  claimed_lease_id uuid,
  new_encrypted_access_token text,
  new_encrypted_refresh_token text,
  new_token_expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare affected_rows bigint;
begin
  if new_encrypted_access_token is null
     or new_encrypted_access_token !~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
     or pg_catalog.char_length(new_encrypted_access_token) > 8192
     or new_encrypted_refresh_token is null
     or new_encrypted_refresh_token !~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
     or pg_catalog.char_length(new_encrypted_refresh_token) > 8192
     or new_token_expires_at is null
     or new_token_expires_at <= pg_catalog.now() then
    raise exception using errcode = '22023', message = 'Jira refresh result is invalid';
  end if;
  update public.integration_connections as connection
  set access_token = new_encrypted_access_token,
      refresh_token = new_encrypted_refresh_token,
      token_expires_at = new_token_expires_at,
      jira_refresh_lease_id = null,
      jira_refresh_lease_expires_at = null,
      jira_refresh_generation = connection.jira_refresh_generation + 1,
      health = case when connection.enabled then 'healthy'::public.integration_connection_health else connection.health end,
      last_sync_attempt_at = case when connection.enabled then pg_catalog.now() else connection.last_sync_attempt_at end,
      last_sync_succeeded_at = case when connection.enabled then pg_catalog.now() else connection.last_sync_succeeded_at end,
      last_error = case when connection.enabled then null else connection.last_error end
  where connection.id = target_connection_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null
    and connection.jira_refresh_lease_id = claimed_lease_id;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

-- Final definition: 20260714175000_jira_oauth_persistence.sql
create or replace function public.release_jira_refresh_lease(
  target_connection_id uuid,
  claimed_lease_id uuid,
  safe_failure text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_rows bigint;
  safe_failure_message text;
begin
  safe_failure_message := case safe_failure
    when 'provider_unavailable' then 'Jira is temporarily unavailable. Try again shortly.'
    when 'authorization_expired' then 'Jira access needs to be reconnected.'
    when 'rate_limited' then 'Jira is rate limiting requests. Try again shortly.'
    when 'configuration_error' then 'Jira connection settings need attention.'
    when 'unexpected_error' then 'Jira could not refresh the connection. Try again.'
    else null
  end;

  if safe_failure_message is null then
    raise exception using errcode = '22023', message = 'Jira refresh failure is invalid';
  end if;

  update public.integration_connections as connection
  set jira_refresh_lease_id = null,
      jira_refresh_lease_expires_at = null,
      enabled = case
        when safe_failure = 'authorization_expired' then false
        else connection.enabled
      end,
      health = 'needs_attention'::public.integration_connection_health,
      last_sync_attempt_at = pg_catalog.now(),
      last_error = safe_failure_message
  where connection.id = target_connection_id
    and connection.provider = 'jira'::public.integration_provider
    and connection.connection_mode = 'jira_oauth'
    and connection.jira_refresh_lease_id = claimed_lease_id;

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

alter function public.release_jira_refresh_lease(uuid, uuid, text) owner to postgres;

revoke all on function public.release_jira_refresh_lease(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.release_jira_refresh_lease(uuid, uuid, text)
  to service_role;

-- Final definition: 20260715013000_native_parent_fanout_hardening.sql
create function public.record_integration_webhook_and_enqueue(
  target_organisation_id uuid,
  target_provider public.integration_provider,
  target_connection_id uuid,
  target_id uuid,
  provider_delivery_key text,
  provider_event_type text,
  provider_payload jsonb,
  provider_payload_hash text,
  sync_kind text,
  sync_payload jsonb
)
returns table (delivery_id uuid, job_id uuid, created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
<<orchestrate>>
declare
  admitted record;
  admitted_status text;
  successor_job_id uuid;
  webhook_count integer;
begin
  if sync_kind not in ('provider_webhook', 'connection_reconciliation') then
    raise exception using
      errcode = '22023', message = 'Webhook synchronization kind is invalid';
  end if;

  select previous.*
  into admitted
  from public.record_integration_webhook_and_enqueue_before_lost_wakeup(
    target_organisation_id, target_provider, target_connection_id,
    $4, provider_delivery_key, provider_event_type,
    provider_payload, provider_payload_hash, sync_kind, sync_payload
  ) as previous;

  if not admitted.created then
    return query select admitted.delivery_id, admitted.job_id, false;
    return;
  end if;

  select job.status
  into admitted_status
  from public.integration_sync_jobs as job
  where job.id = admitted.job_id
  for update of job;



  if admitted_status = 'queued'
     or (
       admitted_status = 'failed'
       and exists (
         select 1
         from public.integration_sync_jobs as job
         where job.id = admitted.job_id
           and job.attempt_count < 20
       )
     ) then
    return query select admitted.delivery_id, admitted.job_id, true;
    return;
  end if;



  select job.id
  into successor_job_id
  from public.integration_sync_jobs as job
  where job.organisation_id = target_organisation_id
    and job.provider = target_provider
    and job.connection_id = target_connection_id
    and job.target_id is not distinct from $4
    and job.kind = sync_kind
    and (
      job.status = 'queued'
      or (job.status = 'failed' and job.attempt_count < 20)
    )
  order by job.created_at, job.id
  for update of job
  limit 1;

  if successor_job_id is null then
    select pg_catalog.count(*)
    into webhook_count
    from public.integration_sync_jobs as job
    where job.organisation_id = target_organisation_id
      and job.provider = target_provider
      and job.connection_id = target_connection_id
      and job.kind in ('provider_webhook', 'connection_reconciliation')
      and (
        job.status in ('queued', 'running')
        or (job.status = 'failed' and job.attempt_count < 20)
      );
    if webhook_count >= 50 then
      raise exception using
        errcode = 'P0001', message = 'Webhook synchronization backlog is full';
    end if;

    insert into public.integration_sync_jobs(
      organisation_id, provider, connection_id, target_id,
      webhook_delivery_id, kind, idempotency_key, payload
    ) values (
      target_organisation_id, target_provider, target_connection_id,
      $4, admitted.delivery_id, sync_kind,
      'webhook:' || admitted.delivery_id::text, sync_payload
    )
    returning id into successor_job_id;

    update public.integration_webhook_deliveries as delivery
    set status = 'received',
        processing_started_at = null,
        processing_lock_token = null,
        processed_at = null,
        coalesced_job_id = null
    where delivery.id = admitted.delivery_id;
  else
    update public.integration_webhook_deliveries as delivery
    set status = 'processed', processed_at = pg_catalog.clock_timestamp(),
        coalesced_job_id = successor_job_id
    where delivery.id = admitted.delivery_id;
  end if;

  return query select admitted.delivery_id, successor_job_id, true;
end;
$$;

alter function public.record_integration_webhook_and_enqueue(
  uuid, public.integration_provider, uuid, uuid, text, text,
  jsonb, text, text, jsonb
) owner to postgres;

revoke all on function public.record_integration_webhook_and_enqueue(
  uuid, public.integration_provider, uuid, uuid, text, text,
  jsonb, text, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.record_integration_webhook_and_enqueue(
  uuid, public.integration_provider, uuid, uuid, text, text,
  jsonb, text, text, jsonb
) to service_role;

-- Final definition: 20260715001146_native_worker_fairness.sql
create or replace function public.claim_integration_sync_job(worker_id text)
returns table (
  job_id uuid,
  organisation_id uuid,
  provider public.integration_provider,
  connection_id uuid,
  target_id uuid,
  kind text,
  payload jsonb,
  attempt_count integer,
  locked_by text,
  lock_token uuid,
  webhook_delivery_id uuid,
  idempotency_key text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_job record;
  selected_organisation_id uuid;
  selected_connection_id uuid;
  claimed_lock_token uuid := extensions.gen_random_uuid();
  claim_time timestamptz := pg_catalog.clock_timestamp();
  affected_rows bigint;
begin
  if worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception using
      errcode = '22023', message = 'Worker identity is invalid';
  end if;

  with inactive as (
    update public.integration_sync_jobs as job
    set status = 'cancelled',
        locked_at = null,
        locked_by = null,
        lock_token = null,
        completed_at = pg_catalog.clock_timestamp(),
        safe_error = 'Connection or target is inactive.'
    where job.status in ('queued', 'failed', 'running')
      and (
        not exists (
          select 1
          from public.integration_connections as connection
          where connection.id = job.connection_id
            and connection.organisation_id = job.organisation_id
            and connection.provider = job.provider
            and connection.enabled
            and connection.revoked_at is null
        )
        or (
          job.target_id is not null
          and not exists (
            select 1
            from public.integration_connection_targets as target
            where target.id = job.target_id
              and target.organisation_id = job.organisation_id
              and target.connection_id = job.connection_id
              and target.provider = job.provider
              and target.enabled
              and target.revoked_at is null
          )
        )
      )
    returning job.webhook_delivery_id
  )
  update public.integration_webhook_deliveries as delivery
  set status = 'failed',
      processing_started_at = null,
      processing_lock_token = null,
      processed_at = null
  where delivery.id in (
    select inactive.webhook_delivery_id
    from inactive
    where inactive.webhook_delivery_id is not null
  )
    and delivery.status in ('received', 'processing', 'failed');

  with exhausted as (
    update public.integration_sync_jobs as job
    set status = 'failed',
        locked_at = null,
        locked_by = null,
        lock_token = null,
        safe_error = 'Retry limit reached.',
        next_attempt_at = pg_catalog.clock_timestamp()
    where job.status = 'running'
      and job.attempt_count >= 20
      and job.locked_at
        <= pg_catalog.clock_timestamp() - interval '5 minutes'
    returning job.webhook_delivery_id
  )
  update public.integration_webhook_deliveries as delivery
  set status = 'failed',
      processing_started_at = null,
      processing_lock_token = null,
      processed_at = null
  where delivery.id in (
    select exhausted.webhook_delivery_id
    from exhausted
    where exhausted.webhook_delivery_id is not null
  )
    and delivery.status = 'processing';

  insert into public.integration_sync_claim_organisations(
    organisation_id, last_claimed_at
  )
  select distinct job.organisation_id, '-infinity'::timestamptz
  from public.integration_sync_jobs as job
  where (
      (
        job.status in ('queued', 'failed')
        and job.next_attempt_at <= pg_catalog.clock_timestamp()
        and job.attempt_count < 20
      )
      or (
        job.status = 'running'
        and job.locked_at
          <= pg_catalog.clock_timestamp() - interval '5 minutes'
        and job.attempt_count < 20
      )
    )
    and exists (
      select 1
      from public.integration_connections as connection
      where connection.id = job.connection_id
        and connection.organisation_id = job.organisation_id
        and connection.provider = job.provider
        and connection.enabled
        and connection.revoked_at is null
    )
    and (
      job.target_id is null
      or exists (
        select 1
        from public.integration_connection_targets as target
        where target.id = job.target_id
          and target.organisation_id = job.organisation_id
          and target.connection_id = job.connection_id
          and target.provider = job.provider
          and target.enabled
          and target.revoked_at is null
      )
    )
  on conflict on constraint integration_sync_claim_organisations_pkey
    do nothing;

  insert into public.integration_sync_claim_connections(
    connection_id, organisation_id, provider, last_claimed_at
  )
  select distinct job.connection_id, job.organisation_id, job.provider,
         '-infinity'::timestamptz
  from public.integration_sync_jobs as job
  where (
      (
        job.status in ('queued', 'failed')
        and job.next_attempt_at <= pg_catalog.clock_timestamp()
        and job.attempt_count < 20
      )
      or (
        job.status = 'running'
        and job.locked_at
          <= pg_catalog.clock_timestamp() - interval '5 minutes'
        and job.attempt_count < 20
      )
    )
    and exists (
      select 1
      from public.integration_connections as connection
      where connection.id = job.connection_id
        and connection.organisation_id = job.organisation_id
        and connection.provider = job.provider
        and connection.enabled
        and connection.revoked_at is null
    )
    and (
      job.target_id is null
      or exists (
        select 1
        from public.integration_connection_targets as target
        where target.id = job.target_id
          and target.organisation_id = job.organisation_id
          and target.connection_id = job.connection_id
          and target.provider = job.provider
          and target.enabled
          and target.revoked_at is null
      )
    )
  on conflict on constraint integration_sync_claim_connections_pkey
    do nothing;

  select organisation_state.organisation_id
  into selected_organisation_id
  from public.integration_sync_claim_organisations as organisation_state
  where exists (
    select 1
    from public.integration_sync_jobs as job
    where job.organisation_id = organisation_state.organisation_id
      and (
        (
          job.status in ('queued', 'failed')
          and job.next_attempt_at <= pg_catalog.clock_timestamp()
          and job.attempt_count < 20
        )
        or (
          job.status = 'running'
          and job.locked_at
            <= pg_catalog.clock_timestamp() - interval '5 minutes'
          and job.attempt_count < 20
        )
      )
      and exists (
        select 1
        from public.integration_connections as connection
        where connection.id = job.connection_id
          and connection.organisation_id = job.organisation_id
          and connection.provider = job.provider
          and connection.enabled
          and connection.revoked_at is null
      )
      and (
        job.target_id is null
        or exists (
          select 1
          from public.integration_connection_targets as target
          where target.id = job.target_id
            and target.organisation_id = job.organisation_id
            and target.connection_id = job.connection_id
            and target.provider = job.provider
            and target.enabled
            and target.revoked_at is null
        )
      )
  )
  order by organisation_state.last_claimed_at,
           organisation_state.organisation_id
  for update of organisation_state skip locked
  limit 1;
  if not found then return; end if;

  select connection_state.connection_id
  into selected_connection_id
  from public.integration_sync_claim_connections as connection_state
  where connection_state.organisation_id = selected_organisation_id
    and exists (
      select 1
      from public.integration_sync_jobs as job
      where job.connection_id = connection_state.connection_id
        and job.organisation_id = connection_state.organisation_id
        and job.provider = connection_state.provider
        and (
          (
            job.status in ('queued', 'failed')
            and job.next_attempt_at <= pg_catalog.clock_timestamp()
            and job.attempt_count < 20
          )
          or (
            job.status = 'running'
            and job.locked_at
              <= pg_catalog.clock_timestamp() - interval '5 minutes'
            and job.attempt_count < 20
          )
        )
        and exists (
          select 1
          from public.integration_connections as connection
          where connection.id = job.connection_id
            and connection.organisation_id = job.organisation_id
            and connection.provider = job.provider
            and connection.enabled
            and connection.revoked_at is null
        )
        and (
          job.target_id is null
          or exists (
            select 1
            from public.integration_connection_targets as target
            where target.id = job.target_id
              and target.organisation_id = job.organisation_id
              and target.connection_id = job.connection_id
              and target.provider = job.provider
              and target.enabled
              and target.revoked_at is null
          )
        )
    )
  order by connection_state.last_claimed_at,
           connection_state.connection_id
  for update of connection_state skip locked
  limit 1;
  if not found then return; end if;

  select job.*
  into selected_job
  from public.integration_sync_jobs as job
  where job.organisation_id = selected_organisation_id
    and job.connection_id = selected_connection_id
    and (
      (
        job.status in ('queued', 'failed')
        and job.next_attempt_at <= pg_catalog.clock_timestamp()
        and job.attempt_count < 20
      )
      or (
        job.status = 'running'
        and job.locked_at
          <= pg_catalog.clock_timestamp() - interval '5 minutes'
        and job.attempt_count < 20
      )
    )
    and exists (
      select 1
      from public.integration_connections as connection
      where connection.id = job.connection_id
        and connection.organisation_id = job.organisation_id
        and connection.provider = job.provider
        and connection.enabled
        and connection.revoked_at is null
    )
    and (
      job.target_id is null
      or exists (
        select 1
        from public.integration_connection_targets as target
        where target.id = job.target_id
          and target.organisation_id = job.organisation_id
          and target.connection_id = job.connection_id
          and target.provider = job.provider
          and target.enabled
          and target.revoked_at is null
      )
    )
  order by
    case when job.status = 'running' then 0 else 1 end,
    job.next_attempt_at, job.created_at, job.id
  for update of job skip locked
  limit 1;
  if not found then return; end if;

  claim_time := pg_catalog.clock_timestamp();
  update public.integration_sync_jobs as job
  set status = 'running',
      attempt_count = selected_job.attempt_count + 1,
      locked_at = claim_time,
      locked_by = worker_id,
      lock_token = claimed_lock_token,
      completed_at = null,
      safe_error = null
  where job.id = selected_job.id;

  update public.integration_sync_claim_organisations as organisation_state
  set last_claimed_at = claim_time
  where organisation_state.organisation_id = selected_organisation_id;
  update public.integration_sync_claim_connections as connection_state
  set last_claimed_at = claim_time
  where connection_state.connection_id = selected_connection_id;

  if selected_job.webhook_delivery_id is not null then
    update public.integration_webhook_deliveries as delivery
    set status = 'processing',
        processing_started_at = claim_time,
        processing_lock_token = claimed_lock_token,
        processed_at = null
    where delivery.id = selected_job.webhook_delivery_id
      and delivery.organisation_id = selected_job.organisation_id
      and delivery.provider = selected_job.provider
      and (
        delivery.status in ('received', 'failed')
        or (
          delivery.status = 'processing'
          and delivery.processing_started_at
            <= pg_catalog.clock_timestamp() - interval '5 minutes'
        )
      );
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using
        errcode = 'P0001', message = 'Webhook delivery lease is unavailable';
    end if;
  end if;

  return query
  select job.id, job.organisation_id, job.provider, job.connection_id,
         job.target_id, job.kind, job.payload, job.attempt_count,
         job.locked_by, job.lock_token, job.webhook_delivery_id,
         job.idempotency_key
  from public.integration_sync_jobs as job
  where job.id = selected_job.id;
end;
$$;

alter function public.claim_integration_sync_job(text) owner to postgres;

revoke all on function public.claim_integration_sync_job(text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_integration_sync_job(text) to service_role;

-- Final definition: 20260714172000_native_job_orchestration.sql
create or replace function public.renew_integration_sync_job_lease(
  target_job_id uuid,
  claimed_lock_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_delivery_id uuid;
  affected_rows bigint;
begin
  select job.webhook_delivery_id
  into stored_delivery_id
  from public.integration_sync_jobs as job
  where job.id = target_job_id
    and job.status = 'running'
    and job.lock_token = claimed_lock_token
    and exists (
      select 1
      from public.integration_connections as connection
      where connection.id = job.connection_id
        and connection.organisation_id = job.organisation_id
        and connection.provider = job.provider
        and connection.enabled
        and connection.revoked_at is null
    )
    and (
      job.target_id is null
      or exists (
        select 1
        from public.integration_connection_targets as target
        where target.id = job.target_id
          and target.organisation_id = job.organisation_id
          and target.connection_id = job.connection_id
          and target.provider = job.provider
          and target.enabled
          and target.revoked_at is null
      )
    )
  for update;

  if not found then
    return false;
  end if;

  update public.integration_sync_jobs as job
  set locked_at = pg_catalog.now()
  where job.id = target_job_id;

  if stored_delivery_id is not null then
    update public.integration_webhook_deliveries as delivery
    set processing_started_at = pg_catalog.now()
    where delivery.id = stored_delivery_id
      and delivery.status = 'processing'
      and delivery.processing_lock_token = claimed_lock_token;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'Webhook delivery lease is unavailable';
    end if;
  end if;

  return true;
end;
$$;

alter function public.renew_integration_sync_job_lease(uuid, uuid) owner to postgres;

revoke all on function public.renew_integration_sync_job_lease(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.renew_integration_sync_job_lease(uuid, uuid)
  to service_role;

-- Final definition: 20260715013000_native_parent_fanout_hardening.sql
create or replace function public.complete_integration_sync_job(
  target_job_id uuid,
  claimed_lock_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_job record;
  affected_rows bigint;
  should_mark_connection_success boolean := false;
  parent_job_id text;
  completed_time timestamptz := pg_catalog.clock_timestamp();
begin
  select job.* into selected_job
  from public.integration_sync_jobs as job
  where job.id = target_job_id
    and job.status = 'running'
    and job.lock_token = claimed_lock_token
  for update;
  if not found then return false; end if;



  perform 1
  from public.integration_connections as connection
  where connection.id = selected_job.connection_id
    and connection.organisation_id = selected_job.organisation_id
    and connection.provider = selected_job.provider
    and connection.enabled
    and connection.revoked_at is null
  for update;
  if not found then
    raise exception using
      errcode = 'P0001', message = 'Synchronization connection is unavailable';
  end if;

  update public.integration_sync_jobs as job
  set status = 'completed', locked_at = null, locked_by = null,
      lock_token = null, completed_at = completed_time, safe_error = null
  where job.id = target_job_id;

  if selected_job.webhook_delivery_id is not null then
    update public.integration_webhook_deliveries as delivery
    set status = 'processed', processing_started_at = null,
        processing_lock_token = null, processed_at = completed_time
    where delivery.id = selected_job.webhook_delivery_id
      and delivery.status = 'processing'
      and delivery.processing_lock_token = claimed_lock_token;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using
        errcode = 'P0001', message = 'Webhook delivery lease is unavailable';
    end if;
  end if;

  if selected_job.target_id is not null then
    update public.integration_connection_targets as target
    set health = 'healthy'::public.integration_connection_health,
        last_sync_attempt_at = completed_time,
        last_sync_succeeded_at = completed_time,
        last_error = null
    where target.id = selected_job.target_id
      and target.organisation_id = selected_job.organisation_id
      and target.connection_id = selected_job.connection_id
      and target.provider = selected_job.provider
      and target.enabled
      and target.revoked_at is null;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using
        errcode = 'P0001', message = 'Synchronization target is unavailable';
    end if;
  end if;

  if selected_job.target_id is null then
    select not exists (
      select 1
      from public.integration_sync_jobs as child
      where child.organisation_id = selected_job.organisation_id
        and child.provider = selected_job.provider
        and child.connection_id = selected_job.connection_id
        and child.kind = 'target_sync'
        and child.payload ->> 'parentJobId' = selected_job.id::text
        and child.status <> 'completed'
    )
    into should_mark_connection_success;
  elsif selected_job.kind = 'target_sync'
    and pg_catalog.jsonb_typeof(selected_job.payload -> 'parentJobId') = 'string'
  then
    parent_job_id := selected_job.payload ->> 'parentJobId';
    select exists (
      select 1
      from public.integration_sync_jobs as parent
      where parent.id::text = parent_job_id
        and parent.organisation_id = selected_job.organisation_id
        and parent.provider = selected_job.provider
        and parent.connection_id = selected_job.connection_id
        and parent.target_id is null
        and parent.status = 'completed'
    ) and not exists (
      select 1
      from public.integration_sync_jobs as child
      where child.organisation_id = selected_job.organisation_id
        and child.provider = selected_job.provider
        and child.connection_id = selected_job.connection_id
        and child.kind = 'target_sync'
        and child.payload ->> 'parentJobId' = parent_job_id
        and child.status <> 'completed'
    )
    into should_mark_connection_success;
  else
    should_mark_connection_success := true;
  end if;

  update public.integration_connections as connection
  set health = case
        when should_mark_connection_success
          then 'healthy'::public.integration_connection_health
        else connection.health
      end,
      last_sync_attempt_at = completed_time,
      last_sync_succeeded_at = case
        when should_mark_connection_success then completed_time
        else connection.last_sync_succeeded_at
      end,
      last_error = case
        when should_mark_connection_success then null
        else connection.last_error
      end
  where connection.id = selected_job.connection_id
    and connection.organisation_id = selected_job.organisation_id
    and connection.provider = selected_job.provider
    and connection.enabled
    and connection.revoked_at is null;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using
      errcode = 'P0001', message = 'Synchronization connection is unavailable';
  end if;
  return true;
end;
$$;

alter function public.complete_integration_sync_job(uuid, uuid)
  owner to postgres;

revoke all on function public.complete_integration_sync_job(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.complete_integration_sync_job(uuid, uuid)
  to service_role;

-- Final definition: 20260714223000_native_webhook_worker_hardening.sql
create or replace function public.fail_integration_sync_job(
  target_job_id uuid,
  claimed_lock_token uuid,
  failure_code text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_job record;
  safe_failure_message text;
  retry_delay_seconds integer;
  affected_rows bigint;
begin
  safe_failure_message := case failure_code
    when 'provider_unavailable' then 'Provider is temporarily unavailable. Try again shortly.'
    when 'rate_limited' then 'Provider rate limit reached. Retry scheduled.'
    when 'invalid_response' then 'Provider returned an invalid response. Retry scheduled.'
    when 'configuration_error' then 'Connection settings need attention.'
    when 'pipeline_error' then 'Synchronization processing failed. Retry scheduled.'
    when 'unexpected_error' then 'Synchronization failed unexpectedly. Retry scheduled.'
    else null
  end;
  if safe_failure_message is null then
    raise exception using errcode = '22023', message = 'Synchronization failure is invalid';
  end if;

  select job.* into selected_job
  from public.integration_sync_jobs as job
  where job.id = target_job_id
    and job.status = 'running'
    and job.lock_token = claimed_lock_token
  for update;
  if not found then return false; end if;

  retry_delay_seconds := least(3600, (
    60 * pg_catalog.power(2::numeric, selected_job.attempt_count - 1)
  )::integer);
  if selected_job.attempt_count >= 20 then
    safe_failure_message := 'Retry limit reached.';
    retry_delay_seconds := 0;
  end if;

  update public.integration_sync_jobs as job
  set status = 'failed',
      locked_at = null,
      locked_by = null,
      lock_token = null,
      completed_at = null,
      safe_error = safe_failure_message,
      next_attempt_at = pg_catalog.now() + pg_catalog.make_interval(secs => retry_delay_seconds)
  where job.id = target_job_id;

  if selected_job.webhook_delivery_id is not null then
    update public.integration_webhook_deliveries as delivery
    set status = 'failed',
        processing_started_at = null,
        processing_lock_token = null,
        processed_at = null
    where delivery.id = selected_job.webhook_delivery_id
      and delivery.status = 'processing'
      and delivery.processing_lock_token = claimed_lock_token;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using errcode = 'P0001', message = 'Webhook delivery lease is unavailable';
    end if;
  end if;
  return true;
end;
$$;

alter function public.fail_integration_sync_job(uuid, uuid, text) owner to postgres;

revoke all on function public.fail_integration_sync_job(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.fail_integration_sync_job(uuid, uuid, text) to service_role;

-- Final definition: 20260714174500_authorization_state_retention.sql
create function public.prune_integration_authorization_states()
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.integration_authorization_states as authorization_state
    where (
      authorization_state.consumed_at is not null
      and authorization_state.consumed_at < pg_catalog.now() - interval '1 day'
    ) or (
      authorization_state.consumed_at is null
      and authorization_state.expires_at < pg_catalog.now() - interval '1 day'
    )
    returning 1
  )
  select pg_catalog.count(*) from deleted;
$$;

alter function public.prune_integration_authorization_states() owner to postgres;

revoke all on function public.prune_integration_authorization_states()
  from public, anon, authenticated, service_role;

grant execute on function public.prune_integration_authorization_states()
  to service_role;

-- Final definition: 20260714175000_jira_oauth_persistence.sql
create function public.prune_pending_jira_authorizations()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cleared_rows bigint;
begin
  update public.pending_jira_authorizations
  set consumed_at = pg_catalog.now(),
      access_token = null,
      refresh_token = null,
      token_expires_at = null
  where consumed_at is null
    and expires_at <= pg_catalog.now();
  get diagnostics cleared_rows = row_count;

  delete from public.pending_jira_authorizations
  where consumed_at is not null
    and created_at < pg_catalog.now() - interval '1 day';

  return cleared_rows;
end;
$$;

alter function public.prune_pending_jira_authorizations() owner to postgres;

revoke all on function public.prune_pending_jira_authorizations()
  from public, anon, authenticated, service_role;

grant execute on function public.prune_pending_jira_authorizations() to service_role;

-- Final definition: 20260714175000_jira_oauth_persistence.sql
create function public.connect_jira_oauth(
  target_organisation_id uuid,
  target_user_id uuid,
  target_cloud_id text,
  target_site_name text,
  encrypted_access_token text,
  encrypted_refresh_token text,
  target_token_expires_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_connection_id uuid;
  stored_cloud_id text;
begin
  if not exists (
    select 1
    from public.memberships as membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_user_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'Workspace operator required';
  end if;

  if target_cloud_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or nullif(pg_catalog.btrim(target_site_name), '') is null
     or pg_catalog.char_length(target_site_name) > 240
     or target_site_name ~ '[\r\n]'
     or $5 is null
     or $5 !~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
     or pg_catalog.char_length($5) > 8192
     or $6 is null
     or $6 !~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
     or pg_catalog.char_length($6) > 8192
     or target_token_expires_at is null
     or target_token_expires_at <= pg_catalog.now()
     or target_token_expires_at > pg_catalog.now() + interval '7 days' then
    raise exception using errcode = '22023', message = 'Jira authorization metadata is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('jira-workspace:' || target_organisation_id::text, 0)
  );

  select connection.id, connection.provider_account_id
  into stored_connection_id, stored_cloud_id
  from public.integration_connections as connection
  where connection.organisation_id = target_organisation_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null
  for update;

  if found then
    if stored_cloud_id <> target_cloud_id then
      raise exception using errcode = 'P0001', message = 'Jira connection already exists for this workspace';
    end if;
    update public.integration_connections as connection
    set provider_account_name = target_site_name,
        access_token = $5,
        refresh_token = $6,
        token_expires_at = target_token_expires_at,
        connected_by = target_user_id,
        jira_refresh_lease_id = null,
        jira_refresh_lease_expires_at = null,
        health = case
          when connection.health = 'needs_attention'
            then 'never_synced'::public.integration_connection_health
          else connection.health
        end,
        last_error = null
    where connection.id = stored_connection_id;
  else
    insert into public.integration_connections(
      organisation_id, provider, label, config, access_token, refresh_token,
      connected_by, enabled, connection_mode, provider_account_id,
      provider_account_name, token_expires_at
    ) values (
      target_organisation_id, 'jira', 'Jira', '{}'::jsonb, $5, $6,
      target_user_id, false, 'jira_oauth', target_cloud_id,
      target_site_name, target_token_expires_at
    )
    returning id into stored_connection_id;
  end if;

  return stored_connection_id;
end;
$$;

alter function public.connect_jira_oauth(uuid, uuid, text, text, text, text, timestamptz) owner to postgres;

revoke all on function public.connect_jira_oauth(uuid, uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.connect_jira_oauth(uuid, uuid, text, text, text, text, timestamptz)
  to service_role;

-- Final definition: 20260714175000_jira_oauth_persistence.sql
create function public.save_pending_jira_authorization(
  target_organisation_id uuid,
  target_user_id uuid,
  encrypted_access_token text,
  encrypted_refresh_token text,
  target_token_expires_at timestamptz,
  accessible_sites jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_setup_id uuid;
  setup_expires_at timestamptz;
begin
  if not exists (
    select 1
    from public.memberships as membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_user_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'Workspace operator required';
  end if;

  perform public.prune_pending_jira_authorizations();

  if $3 is null
     or $3 !~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
     or pg_catalog.char_length($3) > 8192
     or $4 is null
     or $4 !~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
     or pg_catalog.char_length($4) > 8192
     or target_token_expires_at is null
     or target_token_expires_at <= pg_catalog.now()
     or target_token_expires_at > pg_catalog.now() + interval '7 days' then
    raise exception using errcode = '22023', message = 'Jira authorization metadata is invalid';
  end if;

  if pg_catalog.jsonb_typeof(accessible_sites) <> 'array'
     or pg_catalog.jsonb_array_length(accessible_sites) < 2
     or pg_catalog.jsonb_array_length(accessible_sites) > 100
     or pg_catalog.octet_length(accessible_sites::text) > 65536
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(accessible_sites) as selected(value)
       where pg_catalog.jsonb_typeof(selected.value) <> 'object'
          or selected.value <> pg_catalog.jsonb_build_object(
            'cloudId', selected.value -> 'cloudId',
            'name', selected.value -> 'name',
            'url', selected.value -> 'url',
            'scopes', selected.value -> 'scopes'
          )
          or pg_catalog.jsonb_typeof(selected.value -> 'cloudId') <> 'string'
          or (selected.value ->> 'cloudId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or pg_catalog.jsonb_typeof(selected.value -> 'name') <> 'string'
          or nullif(pg_catalog.btrim(selected.value ->> 'name'), '') is null
          or pg_catalog.char_length(selected.value ->> 'name') > 240
          or (selected.value ->> 'name') ~ '[\r\n]'
          or pg_catalog.jsonb_typeof(selected.value -> 'url') <> 'string'
          or (selected.value ->> 'url') !~* '^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net/?$'
          or pg_catalog.char_length(selected.value ->> 'url') > 255
          or pg_catalog.jsonb_typeof(selected.value -> 'scopes') <> 'array'
          or pg_catalog.jsonb_array_length(selected.value -> 'scopes') < 2
          or pg_catalog.jsonb_array_length(selected.value -> 'scopes') > 100
          or not ((selected.value -> 'scopes') ? 'read:jira-work')
          or not ((selected.value -> 'scopes') ? 'manage:jira-webhook')
          or ((selected.value -> 'scopes') ? 'write:jira-work')
          or exists (
            select 1
            from pg_catalog.jsonb_array_elements(selected.value -> 'scopes') as scope(value)
            where pg_catalog.jsonb_typeof(scope.value) <> 'string'
               or (scope.value #>> '{}') !~ '^[A-Za-z0-9:._-]{1,160}$'
          )
     )
     or (
       select pg_catalog.count(*) <> pg_catalog.count(distinct selected.value ->> 'cloudId')
       from pg_catalog.jsonb_array_elements(accessible_sites) as selected(value)
     ) then
    raise exception using errcode = '22023', message = 'Accessible Jira sites are invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'jira-pending:' || target_organisation_id::text || ':' || target_user_id::text,
      0
    )
  );

  update public.pending_jira_authorizations
  set consumed_at = pg_catalog.now(),
      access_token = null,
      refresh_token = null,
      token_expires_at = null
  where organisation_id = target_organisation_id
    and user_id = target_user_id
    and consumed_at is null;

  delete from public.pending_jira_authorizations
  where (consumed_at is not null or expires_at <= pg_catalog.now())
    and created_at < pg_catalog.now() - interval '1 day';

  setup_expires_at := case
    when target_token_expires_at < pg_catalog.now() + interval '15 minutes'
      then target_token_expires_at
    else pg_catalog.now() + interval '15 minutes'
  end;
  insert into public.pending_jira_authorizations(
    organisation_id, user_id, access_token, refresh_token,
    token_expires_at, accessible_sites, expires_at
  ) values (
    target_organisation_id, target_user_id, $3, $4,
    target_token_expires_at, accessible_sites, setup_expires_at
  )
  returning id into stored_setup_id;
  return stored_setup_id;
end;
$$;

alter function public.save_pending_jira_authorization(uuid, uuid, text, text, timestamptz, jsonb) owner to postgres;

revoke all on function public.save_pending_jira_authorization(uuid, uuid, text, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.save_pending_jira_authorization(uuid, uuid, text, text, timestamptz, jsonb)
  to service_role;

-- Final definition: 20260714175000_jira_oauth_persistence.sql
create function public.read_pending_jira_sites(
  target_organisation_id uuid,
  target_user_id uuid,
  target_setup_id uuid
)
returns table (sites jsonb, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select pending.accessible_sites, pending.expires_at
  from public.pending_jira_authorizations as pending
  where pending.id = target_setup_id
    and pending.organisation_id = target_organisation_id
    and pending.user_id = target_user_id
    and pending.consumed_at is null
    and pending.expires_at > pg_catalog.now()
    and exists (
      select 1
      from public.memberships as membership
      where membership.organisation_id = target_organisation_id
        and membership.user_id = target_user_id
        and membership.role in ('owner', 'admin')
    );
$$;

alter function public.read_pending_jira_sites(uuid, uuid, uuid) owner to postgres;

revoke all on function public.read_pending_jira_sites(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.read_pending_jira_sites(uuid, uuid, uuid) to service_role;

-- Final definition: 20260714175000_jira_oauth_persistence.sql
create function public.finalize_pending_jira_authorization(
  target_organisation_id uuid,
  target_user_id uuid,
  target_setup_id uuid,
  selected_cloud_id text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pending_access_token text;
  pending_refresh_token text;
  pending_token_expires_at timestamptz;
  selected_site_name text;
  stored_connection_id uuid;
begin
  if not exists (
    select 1
    from public.memberships as membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_user_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'Workspace operator required';
  end if;

  select pending.access_token, pending.refresh_token, pending.token_expires_at
  into pending_access_token, pending_refresh_token, pending_token_expires_at
  from public.pending_jira_authorizations as pending
  where pending.id = target_setup_id
    and pending.organisation_id = target_organisation_id
    and pending.user_id = target_user_id
    and pending.consumed_at is null
    and pending.expires_at > pg_catalog.now()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Pending Jira authorization is invalid or expired';
  end if;

  select selected.value ->> 'name'
  into selected_site_name
  from public.pending_jira_authorizations as pending
  cross join lateral pg_catalog.jsonb_array_elements(pending.accessible_sites) as selected(value)
  where pending.id = target_setup_id
    and selected.value ->> 'cloudId' = selected_cloud_id;
  if not found then
    raise exception using errcode = '22023', message = 'Selected Jira site is invalid';
  end if;

  stored_connection_id := public.connect_jira_oauth(
    target_organisation_id,
    target_user_id,
    selected_cloud_id,
    selected_site_name,
    pending_access_token,
    pending_refresh_token,
    pending_token_expires_at
  );

  update public.pending_jira_authorizations
  set consumed_at = pg_catalog.now(),
      access_token = null,
      refresh_token = null,
      token_expires_at = null
  where id = target_setup_id;
  return stored_connection_id;
end;
$$;

alter function public.finalize_pending_jira_authorization(uuid, uuid, uuid, text) owner to postgres;

revoke all on function public.finalize_pending_jira_authorization(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.finalize_pending_jira_authorization(uuid, uuid, uuid, text)
  to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create or replace function public.read_jira_access_credential(target_connection_id uuid)
returns table (
  encrypted_access_token text,
  token_expires_at timestamptz,
  refresh_generation integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select connection.access_token, connection.token_expires_at,
         connection.jira_refresh_generation
  from public.integration_connections as connection
  where connection.id = target_connection_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null
    and connection.access_token is not null
    and (
      connection.enabled
      or not exists (
        select 1
        from public.integration_connection_targets as target
        where target.connection_id = connection.id
          and target.organisation_id = connection.organisation_id
          and target.provider = 'jira'
          and target.revoked_at is null
      )
    );
$$;

-- Final definition: 20260715001146_native_worker_fairness.sql
create or replace function public.disconnect_jira_oauth(
  target_organisation_id uuid,
  target_user_id uuid,
  target_connection_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_connection record;
  retain_cleanup_credential boolean := false;
  retry_webhook_id text;
begin
  if not exists (
    select 1
    from public.memberships as membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_user_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception using
      errcode = '42501', message = 'Workspace operator required';
  end if;

  select connection.jira_webhook_id, connection.jira_webhook_expires_at,
         connection.provider_account_id
  into stored_connection
  from public.integration_connections as connection
  where connection.id = target_connection_id
    and connection.organisation_id = target_organisation_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null
  for update;

  if not found then
    if exists (
      select 1
      from public.integration_connections as connection
      where connection.id = target_connection_id
        and connection.organisation_id = target_organisation_id
        and connection.provider = 'jira'
        and connection.connection_mode = 'jira_oauth'
        and connection.revoked_at is not null
    ) then
      select cleanup.webhook_id
      into retry_webhook_id
      from public.jira_webhook_cleanup_jobs as cleanup
      where cleanup.credential_connection_id = target_connection_id
        and cleanup.organisation_id = target_organisation_id
        and cleanup.reason = 'disconnect'
        and cleanup.status not in ('completed', 'promoted')
        and cleanup.provider_expires_at + interval '2 days'
          > pg_catalog.clock_timestamp()
      order by cleanup.created_at desc, cleanup.id
      limit 1;
      return retry_webhook_id;
    end if;
    raise exception using
      errcode = 'P0001', message = 'Jira connection is unavailable';
  end if;

  if stored_connection.jira_webhook_id is not null
     and stored_connection.jira_webhook_expires_at
       > pg_catalog.clock_timestamp() then
    insert into public.jira_webhook_cleanup_jobs(
      organisation_id, credential_connection_id, cloud_id, webhook_id,
      reason, provider_expires_at
    ) values (
      target_organisation_id, target_connection_id,
      stored_connection.provider_account_id,
      stored_connection.jira_webhook_id,
      'disconnect', stored_connection.jira_webhook_expires_at
    )
    on conflict (organisation_id, cloud_id, webhook_id)
      where webhook_id is not null
        and status not in ('completed', 'promoted')
      do nothing;
  end if;

  select exists (
    select 1
    from public.jira_webhook_cleanup_jobs as cleanup
    where cleanup.credential_connection_id = target_connection_id
      and cleanup.organisation_id = target_organisation_id
      and cleanup.status not in ('completed', 'promoted')
      and cleanup.provider_expires_at + interval '2 days'
        > pg_catalog.clock_timestamp()
  ) into retain_cleanup_credential;

  update public.integration_connections as connection
  set enabled = false,
      revoked_at = pg_catalog.clock_timestamp(),
      access_token = case
        when retain_cleanup_credential then connection.access_token
        else null
      end,
      refresh_token = case
        when retain_cleanup_credential then connection.refresh_token
        else null
      end,
      token_expires_at = case
        when retain_cleanup_credential then connection.token_expires_at
        else null
      end,
      jira_cleanup_credentials_pending = retain_cleanup_credential,
      jira_webhook_id = null,
      jira_webhook_expires_at = null,
      jira_webhook_callback_hash = null,
      jira_webhook_generation = connection.jira_webhook_generation + 1,
      jira_refresh_lease_id = null,
      jira_refresh_lease_expires_at = null,
      last_error = null
  where connection.id = target_connection_id;

  return stored_connection.jira_webhook_id;
end;
$$;

alter function public.disconnect_jira_oauth(uuid, uuid, uuid) owner to postgres;

revoke all on function public.disconnect_jira_oauth(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.disconnect_jira_oauth(uuid, uuid, uuid)
  to service_role;

-- Final definition: 20260714211149_native_connection_management.sql
create function public.list_native_jira_target_summaries(
  target_organisation_id uuid
)
returns table (
  id uuid,
  connection_id uuid,
  provider text,
  display_name text,
  enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    target.id,
    target.connection_id,
    target.provider::text,
    target.display_name,
    target.enabled
  from public.integration_connection_targets as target
  join public.integration_connections as connection
    on connection.id = target.connection_id
   and connection.organisation_id = target.organisation_id
   and connection.provider = target.provider
  where target.organisation_id = target_organisation_id
    and target.revoked_at is null
    and connection.revoked_at is null
    and connection.connection_mode in ('jira_oauth')
    and exists (
      select 1
      from public.memberships as membership
      where membership.organisation_id = target_organisation_id
        and membership.user_id = (select auth.uid())
    )
  order by target.provider, target.display_name, target.id;
$$;

alter function public.list_native_jira_target_summaries(uuid) owner to postgres;

revoke all on function public.list_native_jira_target_summaries(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.list_native_jira_target_summaries(uuid)
  to authenticated;

-- Final definition: 20260714211149_native_connection_management.sql
create function public.configure_jira_project_targets(
  target_organisation_id uuid,
  target_user_id uuid,
  target_connection_id uuid,
  verified_projects jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_connection record;
  selected_project record;
  affected_rows bigint;
begin
  if not exists (
    select 1
    from public.memberships as membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_user_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'Workspace operator required';
  end if;

  if verified_projects is null
     or pg_catalog.jsonb_typeof(verified_projects) <> 'array'
     or pg_catalog.jsonb_array_length(verified_projects) < 1
     or pg_catalog.jsonb_array_length(verified_projects) > 100
     or pg_catalog.octet_length(verified_projects::text) > 131072 then
    raise exception using errcode = '22023', message = 'Jira project selection is invalid';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(verified_projects) as selected(value)
    where pg_catalog.jsonb_typeof(selected.value) <> 'object'
       or selected.value <> pg_catalog.jsonb_build_object(
         'externalId', selected.value -> 'externalId',
         'displayName', selected.value -> 'displayName',
         'baseUrl', selected.value -> 'baseUrl',
         'cloudId', selected.value -> 'cloudId',
         'projectKey', selected.value -> 'projectKey'
       )
       or pg_catalog.jsonb_typeof(selected.value -> 'externalId') <> 'string'
       or (selected.value ->> 'externalId') !~ '^[1-9][0-9]{0,39}$'
       or pg_catalog.jsonb_typeof(selected.value -> 'displayName') <> 'string'
       or nullif(pg_catalog.btrim(selected.value ->> 'displayName'), '') is null
       or selected.value ->> 'displayName' <> pg_catalog.btrim(selected.value ->> 'displayName')
       or pg_catalog.char_length(selected.value ->> 'displayName') > 240
       or (selected.value ->> 'displayName') ~ '[\r\n]'
       or pg_catalog.jsonb_typeof(selected.value -> 'baseUrl') <> 'string'
       or (selected.value ->> 'baseUrl') !~* '^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net/?$'
       or pg_catalog.char_length(selected.value ->> 'baseUrl') > 255
       or pg_catalog.jsonb_typeof(selected.value -> 'cloudId') <> 'string'
       or (selected.value ->> 'cloudId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or pg_catalog.jsonb_typeof(selected.value -> 'projectKey') <> 'string'
       or (selected.value ->> 'projectKey') !~ '^[A-Z][A-Z0-9_]{0,79}$'
  )
     or (
       select pg_catalog.count(*) <> pg_catalog.count(distinct selected.value ->> 'externalId')
       from pg_catalog.jsonb_array_elements(verified_projects) as selected(value)
     )
     or (
       select pg_catalog.count(*) <> pg_catalog.count(distinct selected.value ->> 'projectKey')
       from pg_catalog.jsonb_array_elements(verified_projects) as selected(value)
     ) then
    raise exception using errcode = '22023', message = 'Jira project selection is invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('jira-targets:' || target_organisation_id::text, 0)
  );

  select
    connection.id,
    connection.provider_account_id,
    connection.access_token,
    connection.refresh_token,
    connection.token_expires_at
  into stored_connection
  from public.integration_connections as connection
  where connection.id = target_connection_id
    and connection.organisation_id = target_organisation_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null
  for update;

  if not found then
    return false;
  end if;

  if stored_connection.access_token is null
     or stored_connection.refresh_token is null
     or stored_connection.token_expires_at is null
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(verified_projects) as selected(value)
       where selected.value ->> 'cloudId' is distinct from stored_connection.provider_account_id
     ) then
    raise exception using errcode = '22023', message = 'Jira project selection is invalid';
  end if;

  update public.integration_connection_targets as target
  set enabled = false,
      revoked_at = coalesce(target.revoked_at, pg_catalog.now())
  where target.connection_id = target_connection_id
    and target.organisation_id = target_organisation_id
    and target.provider = 'jira'
    and target.revoked_at is null
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(verified_projects) as selected(value)
      where selected.value ->> 'externalId' = target.external_id
    );

  for selected_project in
    select
      selected.value ->> 'externalId' as external_id,
      selected.value ->> 'displayName' as display_name,
      selected.value ->> 'baseUrl' as base_url,
      selected.value ->> 'cloudId' as cloud_id,
      selected.value ->> 'projectKey' as project_key
    from pg_catalog.jsonb_array_elements(verified_projects) as selected(value)
    order by selected.value ->> 'externalId'
  loop
    update public.integration_connection_targets as target
    set display_name = selected_project.display_name,
        config = pg_catalog.jsonb_build_object(
          'baseUrl', selected_project.base_url,
          'cloudId', selected_project.cloud_id,
          'projectKey', selected_project.project_key
        ),
        enabled = true
    where target.connection_id = target_connection_id
      and target.organisation_id = target_organisation_id
      and target.provider = 'jira'
      and target.external_id = selected_project.external_id
      and target.revoked_at is null;
    get diagnostics affected_rows = row_count;

    if affected_rows = 0 then
      insert into public.integration_connection_targets(
        organisation_id, connection_id, provider, kind, external_id,
        display_name, config, enabled, created_by
      ) values (
        target_organisation_id, target_connection_id, 'jira', 'project',
        selected_project.external_id, selected_project.display_name,
        pg_catalog.jsonb_build_object(
          'baseUrl', selected_project.base_url,
          'cloudId', selected_project.cloud_id,
          'projectKey', selected_project.project_key
        ),
        true, target_user_id
      );
    end if;
  end loop;

  update public.integration_connections as connection
  set enabled = true,
      health = 'never_synced'::public.integration_connection_health,
      last_sync_attempt_at = null,
      last_sync_succeeded_at = null,
      last_error = null
  where connection.id = target_connection_id
    and connection.organisation_id = target_organisation_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null;

  return true;
end;
$$;

alter function public.configure_jira_project_targets(uuid, uuid, uuid, jsonb) owner to postgres;

revoke all on function public.configure_jira_project_targets(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.configure_jira_project_targets(uuid, uuid, uuid, jsonb)
  to service_role;

-- Final definition: 20260714211149_native_connection_management.sql
create function public.set_native_connection_enabled(
  target_organisation_id uuid,
  target_user_id uuid,
  target_connection_id uuid,
  target_enabled boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_connection record;
begin
  if not exists (
    select 1
    from public.memberships as membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_user_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'Workspace operator required';
  end if;

  if target_enabled is null then
    raise exception using errcode = '22023', message = 'Connection state is invalid';
  end if;

  select
    connection.id,
    connection.provider,
    connection.connection_mode,
    connection.health,
    connection.provider_account_id,
    connection.access_token,
    connection.refresh_token,
    connection.token_expires_at
  into stored_connection
  from public.integration_connections as connection
  where connection.id = target_connection_id
    and connection.organisation_id = target_organisation_id
    and connection.revoked_at is null
    and (
      (connection.provider = 'github' and connection.connection_mode = 'github_app')
      or (connection.provider = 'jira' and connection.connection_mode = 'jira_oauth')
    )
  for update;

  if not found then
    return false;
  end if;

  if target_enabled then
    if stored_connection.health = 'needs_attention'::public.integration_connection_health then
      raise exception using errcode = 'P0001', message = 'Connection needs to be reconnected';
    end if;

    if stored_connection.provider = 'github'::public.integration_provider
       and stored_connection.provider_account_id is null then
      raise exception using errcode = 'P0001', message = 'Connection needs to be reconnected';
    end if;

    if stored_connection.provider = 'jira'::public.integration_provider then
      if stored_connection.access_token is null
         or stored_connection.refresh_token is null
         or stored_connection.token_expires_at is null then
        raise exception using errcode = 'P0001', message = 'Connection needs to be reconnected';
      end if;
      if not exists (
        select 1
        from public.integration_connection_targets as target
        where target.connection_id = target_connection_id
          and target.organisation_id = target_organisation_id
          and target.provider = 'jira'
          and target.enabled
          and target.revoked_at is null
      ) then
        raise exception using errcode = 'P0001', message = 'Jira requires at least one selected project';
      end if;
    end if;
  end if;




  update public.integration_connections as connection
  set enabled = target_enabled
  where connection.id = target_connection_id
    and connection.organisation_id = target_organisation_id
    and connection.revoked_at is null;

  return true;
end;
$$;

alter function public.set_native_connection_enabled(uuid, uuid, uuid, boolean) owner to postgres;

revoke all on function public.set_native_connection_enabled(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.set_native_connection_enabled(uuid, uuid, uuid, boolean)
  to service_role;

-- Final definition: 20260715001146_native_worker_fairness.sql
create or replace function public.enqueue_manual_connection_sync(
  target_organisation_id uuid,
  target_user_id uuid,
  target_connection_id uuid,
  manual_batch_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_connection record;
  queued_job_id uuid;
  job_key text;
  recent_manual_count integer;
  outstanding_count integer;
begin
  if not exists (
    select 1
    from public.memberships as membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_user_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception using
      errcode = '42501', message = 'Workspace operator required';
  end if;
  if manual_batch_id is null
     or manual_batch_id::text
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '22023', message = 'Manual sync batch is invalid';
  end if;

  job_key := 'manual:' || manual_batch_id::text || ':'
    || target_connection_id::text;
  select job.id
  into queued_job_id
  from public.integration_sync_jobs as job
  where job.organisation_id = target_organisation_id
    and job.connection_id = target_connection_id
    and job.idempotency_key = job_key;
  if found then return queued_job_id; end if;

  select connection.id, connection.provider
  into stored_connection
  from public.integration_connections as connection
  where connection.id = target_connection_id
    and connection.organisation_id = target_organisation_id
    and connection.enabled
    and connection.revoked_at is null
    and (
      (connection.provider = 'github'
        and connection.connection_mode = 'github_app')
      or (connection.provider = 'jira'
        and connection.connection_mode = 'jira_oauth')
    )
  for update;
  if not found then return null; end if;

  select job.id
  into queued_job_id
  from public.integration_sync_jobs as job
  where job.organisation_id = target_organisation_id
    and job.provider = stored_connection.provider
    and job.connection_id = target_connection_id
    and job.kind = 'manual_sync'
    and (
      job.status in ('queued', 'running')
      or (job.status = 'failed' and job.attempt_count < 20)
    )
  order by job.created_at, job.id
  limit 1;
  if found then return queued_job_id; end if;

  select pg_catalog.count(*)
  into recent_manual_count
  from public.integration_sync_jobs as job
  where job.organisation_id = target_organisation_id
    and job.provider = stored_connection.provider
    and job.connection_id = target_connection_id
    and job.kind = 'manual_sync'
    and job.created_at >= pg_catalog.clock_timestamp() - interval '1 minute';
  if recent_manual_count >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'Manual synchronization rate limit reached';
  end if;

  select pg_catalog.count(*)
  into outstanding_count
  from public.integration_sync_jobs as job
  where job.organisation_id = target_organisation_id
    and job.provider = stored_connection.provider
    and job.connection_id = target_connection_id
    and (
      job.status in ('queued', 'running')
      or (job.status = 'failed' and job.attempt_count < 20)
    );
  if outstanding_count >= 100 then
    raise exception using
      errcode = 'P0001', message = 'Synchronization queue is busy';
  end if;

  insert into public.integration_sync_jobs(
    organisation_id, provider, connection_id, target_id,
    kind, idempotency_key, payload
  ) values (
    target_organisation_id, stored_connection.provider,
    target_connection_id, null, 'manual_sync', job_key,
    '{"source":"manual"}'::jsonb
  )
  on conflict (organisation_id, provider, idempotency_key) do nothing
  returning id into queued_job_id;

  if queued_job_id is null then
    select job.id into queued_job_id
    from public.integration_sync_jobs as job
    where job.organisation_id = target_organisation_id
      and job.provider = stored_connection.provider
      and job.connection_id = target_connection_id
      and job.idempotency_key = job_key;
  end if;
  return queued_job_id;
end;
$$;

alter function public.enqueue_manual_connection_sync(uuid, uuid, uuid, uuid)
  owner to postgres;

revoke all on function public.enqueue_manual_connection_sync(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.enqueue_manual_connection_sync(uuid, uuid, uuid, uuid)
  to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.resolve_active_jira_webhook_connection(candidate_callback_hash text)
returns table (
  id uuid,
  organisation_id uuid,
  provider public.integration_provider,
  jira_webhook_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select connection.id, connection.organisation_id, connection.provider,
         connection.jira_webhook_id
  from public.integration_connections as connection
  where candidate_callback_hash ~ '^[0-9a-f]{64}$'
    and connection.jira_webhook_callback_hash = candidate_callback_hash
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.enabled
    and connection.revoked_at is null
    and connection.jira_webhook_id is not null
$$;

alter function public.resolve_active_jira_webhook_connection(text) owner to postgres;

revoke all on function public.resolve_active_jira_webhook_connection(text)
  from public, anon, authenticated, service_role;

grant execute on function public.resolve_active_jira_webhook_connection(text) to service_role;

-- Final definition: 20260714223000_native_webhook_worker_hardening.sql
create function public.claim_integration_sync_job_by_id(worker_id text, target_job_id uuid)
returns table (
  job_id uuid,
  organisation_id uuid,
  provider public.integration_provider,
  connection_id uuid,
  target_id uuid,
  kind text,
  payload jsonb,
  attempt_count integer,
  locked_by text,
  lock_token uuid,
  webhook_delivery_id uuid,
  idempotency_key text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_job record;
  claimed_lock_token uuid := extensions.gen_random_uuid();
  affected_rows bigint;
begin
  if worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception using errcode = '22023', message = 'Worker identity is invalid';
  end if;

  select job.*
  into selected_job
  from public.integration_sync_jobs as job
  where job.id = target_job_id
    and job.status in ('queued', 'failed')
    and job.next_attempt_at <= pg_catalog.now()
    and job.attempt_count < 20
    and exists (
      select 1 from public.integration_connections as connection
      where connection.id = job.connection_id
        and connection.organisation_id = job.organisation_id
        and connection.provider = job.provider
        and connection.enabled
        and connection.revoked_at is null
    )
    and (
      job.target_id is null
      or exists (
        select 1 from public.integration_connection_targets as target
        where target.id = job.target_id
          and target.organisation_id = job.organisation_id
          and target.connection_id = job.connection_id
          and target.provider = job.provider
          and target.enabled
          and target.revoked_at is null
      )
    )
  for update skip locked;

  if not found then return; end if;

  update public.integration_sync_jobs as job
  set status = 'running',
      attempt_count = selected_job.attempt_count + 1,
      locked_at = pg_catalog.now(),
      locked_by = worker_id,
      lock_token = claimed_lock_token,
      completed_at = null,
      safe_error = null
  where job.id = selected_job.id;

  if selected_job.webhook_delivery_id is not null then
    update public.integration_webhook_deliveries as delivery
    set status = 'processing',
        processing_started_at = pg_catalog.now(),
        processing_lock_token = claimed_lock_token,
        processed_at = null
    where delivery.id = selected_job.webhook_delivery_id
      and delivery.organisation_id = selected_job.organisation_id
      and delivery.provider = selected_job.provider
      and delivery.status in ('received', 'failed');
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using errcode = 'P0001', message = 'Webhook delivery lease is unavailable';
    end if;
  end if;

  return query
  select
    job.id, job.organisation_id, job.provider, job.connection_id,
    job.target_id, job.kind, job.payload, job.attempt_count,
    job.locked_by, job.lock_token, job.webhook_delivery_id,
    job.idempotency_key
  from public.integration_sync_jobs as job
  where job.id = selected_job.id;
end;
$$;

alter function public.claim_integration_sync_job_by_id(text, uuid) owner to postgres;

revoke all on function public.claim_integration_sync_job_by_id(text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_integration_sync_job_by_id(text, uuid) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.clear_finished_jira_cleanup_credentials(target_connection_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.integration_connections as connection
  set access_token = null,
      refresh_token = null,
      token_expires_at = null,
      jira_cleanup_credentials_pending = false,
      jira_refresh_lease_id = null,
      jira_refresh_lease_expires_at = null
  where connection.id = target_connection_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is not null
    and not exists (
      select 1 from public.jira_webhook_cleanup_jobs as cleanup
      where cleanup.credential_connection_id = connection.id
        and cleanup.status not in ('completed', 'promoted')
        and cleanup.provider_expires_at + interval '2 days' > pg_catalog.now()
    );
end;
$$;

alter function public.clear_finished_jira_cleanup_credentials(uuid) owner to postgres;

revoke all on function public.clear_finished_jira_cleanup_credentials(uuid)
  from public, anon, authenticated, service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.enforce_jira_webhook_configuration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent record;
begin
  if tg_table_name = 'integration_connections' then
    if new.provider = 'jira'
       and new.connection_mode = 'jira_oauth'
       and new.enabled
       and new.revoked_at is null
       and exists (
         select 1
         from public.integration_connection_targets as target
         where target.connection_id = new.id
           and target.organisation_id = new.organisation_id
           and target.provider = 'jira'
           and target.enabled
           and target.revoked_at is null
       )
       and (
         new.jira_webhook_id is null
         or new.jira_webhook_expires_at is null
         or new.jira_webhook_callback_hash is null
       ) then
      raise exception using
        errcode = '23514',
        message = 'Enabled Jira targets require a configured webhook';
    end if;
    return new;
  end if;

  if new.provider = 'jira' and new.enabled and new.revoked_at is null then
    select connection.enabled, connection.revoked_at,
           connection.jira_webhook_id, connection.jira_webhook_expires_at,
           connection.jira_webhook_callback_hash
    into parent
    from public.integration_connections as connection
    where connection.id = new.connection_id
      and connection.organisation_id = new.organisation_id
      and connection.provider = 'jira';

    if found and parent.enabled and parent.revoked_at is null
       and (
         parent.jira_webhook_id is null
         or parent.jira_webhook_expires_at is null
         or parent.jira_webhook_callback_hash is null
       ) then
      raise exception using
        errcode = '23514',
        message = 'Enabled Jira targets require a configured webhook';
    end if;
  end if;
  return new;
end;
$$;

alter function public.enforce_jira_webhook_configuration() owner to postgres;

revoke all on function public.enforce_jira_webhook_configuration()
  from public, anon, authenticated, service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.commit_jira_webhook_configuration(
  target_organisation_id uuid,
  target_user_id uuid,
  target_connection_id uuid,
  expected_generation integer,
  expected_webhook_id text,
  candidate_cleanup_id uuid,
  candidate_ownership_token uuid,
  verified_projects jsonb,
  new_webhook_id text,
  new_webhook_expires_at timestamptz,
  new_callback_hash text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_rows bigint;
  stored_connection record;
begin
  if not exists (
    select 1 from public.memberships as membership
    where membership.organisation_id = target_organisation_id
      and membership.user_id = target_user_id
      and membership.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'Workspace operator required';
  end if;
  if expected_generation is null or expected_generation not between 0 and 2147483645
     or (expected_webhook_id is not null and expected_webhook_id !~ '^[1-9][0-9]{0,15}$')
     or new_webhook_id !~ '^[1-9][0-9]{0,15}$'
     or new_callback_hash !~ '^[0-9a-f]{64}$'
     or new_webhook_expires_at is null
     or new_webhook_expires_at <= pg_catalog.now()
     or new_webhook_expires_at > pg_catalog.now() + interval '31 days' then
    raise exception using errcode = '22023', message = 'Jira webhook metadata is invalid';
  end if;

  select connection.organisation_id, connection.provider_account_id,
         connection.jira_webhook_generation, connection.jira_webhook_id,
         connection.jira_webhook_expires_at
  into stored_connection
  from public.integration_connections as connection
  where connection.id = target_connection_id
    and connection.organisation_id = target_organisation_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null
  for update;
  if not found
     or stored_connection.jira_webhook_generation <> expected_generation
     or stored_connection.jira_webhook_id is distinct from expected_webhook_id then
    return false;
  end if;

  update public.jira_webhook_cleanup_jobs as cleanup
  set status = 'promoted', completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where cleanup.id = candidate_cleanup_id
    and cleanup.ownership_token = candidate_ownership_token
    and cleanup.organisation_id = stored_connection.organisation_id
    and cleanup.credential_connection_id = target_connection_id
    and cleanup.cloud_id = stored_connection.provider_account_id
    and cleanup.webhook_id = new_webhook_id
    and cleanup.callback_hash = new_callback_hash
    and cleanup.reason = 'candidate'
    and cleanup.status = 'prepared';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then return false; end if;

  if stored_connection.jira_webhook_id is not null
     and stored_connection.jira_webhook_id <> new_webhook_id then
    insert into public.jira_webhook_cleanup_jobs(
      organisation_id, credential_connection_id, cloud_id, webhook_id,
      reason, provider_expires_at
    ) values (
      stored_connection.organisation_id, target_connection_id,
      stored_connection.provider_account_id, stored_connection.jira_webhook_id,
      'replaced', stored_connection.jira_webhook_expires_at
    ) on conflict (organisation_id, cloud_id, webhook_id)
      where webhook_id is not null and status not in ('completed', 'promoted')
      do nothing;
  end if;

  update public.integration_connections as connection
  set jira_webhook_id = new_webhook_id,
      jira_webhook_expires_at = new_webhook_expires_at,
      jira_webhook_callback_hash = new_callback_hash,
      jira_webhook_generation = connection.jira_webhook_generation + 1,
      health = 'never_synced'::public.integration_connection_health,
      last_error = null
  where connection.id = target_connection_id
    and connection.organisation_id = target_organisation_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then return false; end if;

  if not public.configure_jira_project_targets(
    target_organisation_id, target_user_id, target_connection_id, verified_projects
  ) then
    raise exception using errcode = 'P0001', message = 'Jira webhook configuration could not be committed';
  end if;
  return true;
end;
$$;

alter function public.commit_jira_webhook_configuration(
  uuid, uuid, uuid, integer, text, uuid, uuid, jsonb, text, timestamptz, text
) owner to postgres;

revoke all on function public.commit_jira_webhook_configuration(
  uuid, uuid, uuid, integer, text, uuid, uuid, jsonb, text, timestamptz, text
) from public, anon, authenticated, service_role;

grant execute on function public.commit_jira_webhook_configuration(
  uuid, uuid, uuid, integer, text, uuid, uuid, jsonb, text, timestamptz, text
) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.replace_jira_webhook_metadata(
  target_connection_id uuid,
  expected_generation integer,
  expected_webhook_id text,
  candidate_cleanup_id uuid,
  candidate_ownership_token uuid,
  new_webhook_id text,
  new_webhook_expires_at timestamptz,
  new_callback_hash text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_rows bigint;
  stored_connection record;
begin
  if expected_generation is null or expected_generation not between 0 and 2147483645
     or (expected_webhook_id is not null and expected_webhook_id !~ '^[1-9][0-9]{0,15}$')
     or new_webhook_id !~ '^[1-9][0-9]{0,15}$'
     or new_callback_hash !~ '^[0-9a-f]{64}$'
     or new_webhook_expires_at is null
     or new_webhook_expires_at <= pg_catalog.now()
     or new_webhook_expires_at > pg_catalog.now() + interval '31 days' then
    raise exception using errcode = '22023', message = 'Jira webhook metadata is invalid';
  end if;
  select connection.organisation_id, connection.provider_account_id,
         connection.jira_webhook_generation, connection.jira_webhook_id,
         connection.jira_webhook_expires_at
  into stored_connection
  from public.integration_connections as connection
  where connection.id = target_connection_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null
  for update;
  if not found
     or stored_connection.jira_webhook_generation <> expected_generation
     or stored_connection.jira_webhook_id is distinct from expected_webhook_id then
    return false;
  end if;

  update public.jira_webhook_cleanup_jobs as cleanup
  set status = 'promoted', completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where cleanup.id = candidate_cleanup_id
    and cleanup.ownership_token = candidate_ownership_token
    and cleanup.organisation_id = stored_connection.organisation_id
    and cleanup.credential_connection_id = target_connection_id
    and cleanup.cloud_id = stored_connection.provider_account_id
    and cleanup.webhook_id = new_webhook_id
    and cleanup.callback_hash = new_callback_hash
    and cleanup.reason = 'candidate'
    and cleanup.status = 'prepared';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then return false; end if;

  if stored_connection.jira_webhook_id is not null
     and stored_connection.jira_webhook_id <> new_webhook_id then
    insert into public.jira_webhook_cleanup_jobs(
      organisation_id, credential_connection_id, cloud_id, webhook_id,
      reason, provider_expires_at
    ) values (
      stored_connection.organisation_id, target_connection_id,
      stored_connection.provider_account_id, stored_connection.jira_webhook_id,
      'replaced', stored_connection.jira_webhook_expires_at
    ) on conflict (organisation_id, cloud_id, webhook_id)
      where webhook_id is not null and status not in ('completed', 'promoted')
      do nothing;
  end if;

  update public.integration_connections as connection
  set jira_webhook_id = new_webhook_id,
      jira_webhook_expires_at = new_webhook_expires_at,
      jira_webhook_callback_hash = new_callback_hash,
      jira_webhook_generation = connection.jira_webhook_generation + 1,
      health = 'never_synced'::public.integration_connection_health,
      last_error = null
  where connection.id = target_connection_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

alter function public.replace_jira_webhook_metadata(uuid, integer, text, uuid, uuid, text, timestamptz, text) owner to postgres;

revoke all on function public.replace_jira_webhook_metadata(uuid, integer, text, uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated, service_role;

grant execute on function public.replace_jira_webhook_metadata(uuid, integer, text, uuid, uuid, text, timestamptz, text)
  to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.refresh_jira_webhook_expiry(
  target_connection_id uuid,
  expected_generation integer,
  expected_webhook_id text,
  new_webhook_expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare affected_rows bigint;
begin
  if expected_generation is null or expected_generation not between 0 and 2147483646
     or expected_webhook_id !~ '^[1-9][0-9]{0,15}$'
     or new_webhook_expires_at is null
     or new_webhook_expires_at <= pg_catalog.now()
     or new_webhook_expires_at > pg_catalog.now() + interval '31 days' then
    raise exception using errcode = '22023', message = 'Jira webhook metadata is invalid';
  end if;
  update public.integration_connections as connection
  set jira_webhook_expires_at = new_webhook_expires_at
  where connection.id = target_connection_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null
    and connection.jira_webhook_generation = expected_generation
    and connection.jira_webhook_id = expected_webhook_id;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

alter function public.refresh_jira_webhook_expiry(uuid, integer, text, timestamptz) owner to postgres;

revoke all on function public.refresh_jira_webhook_expiry(uuid, integer, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.refresh_jira_webhook_expiry(uuid, integer, text, timestamptz)
  to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.list_due_jira_webhook_configurations(result_limit integer)
returns table (
  organisation_id uuid,
  connection_id uuid,
  cloud_id text,
  webhook_generation integer,
  webhook_id text,
  webhook_expires_at timestamptz,
  callback_hash text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if result_limit is null or result_limit not between 1 and 25 then
    raise exception using errcode = '22023', message = 'Jira webhook reconciliation limit is invalid';
  end if;
  return query
  select connection.organisation_id, connection.id,
         connection.provider_account_id, connection.jira_webhook_generation,
         connection.jira_webhook_id, connection.jira_webhook_expires_at,
         connection.jira_webhook_callback_hash
  from public.integration_connections as connection
  where connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.enabled
    and connection.revoked_at is null
    and exists (
      select 1 from public.integration_connection_targets as target
      where target.connection_id = connection.id
        and target.organisation_id = connection.organisation_id
        and target.provider = 'jira'
        and target.enabled
        and target.revoked_at is null
    )
    and (
      connection.jira_webhook_id is null
      or connection.jira_webhook_expires_at is null
      or connection.jira_webhook_callback_hash is null
      or connection.jira_webhook_expires_at <= pg_catalog.now() + interval '7 days'
    )
  order by connection.jira_webhook_expires_at nulls first, connection.id
  limit result_limit;
end;
$$;

alter function public.list_due_jira_webhook_configurations(integer) owner to postgres;

revoke all on function public.list_due_jira_webhook_configurations(integer)
  from public, anon, authenticated, service_role;

grant execute on function public.list_due_jira_webhook_configurations(integer) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.read_jira_webhook_project_keys(
  target_connection_id uuid,
  expected_generation integer
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.array_agg(target.config ->> 'projectKey' order by target.config ->> 'projectKey')
  from public.integration_connection_targets as target
  join public.integration_connections as connection
    on connection.id = target.connection_id
   and connection.organisation_id = target.organisation_id
   and connection.provider = target.provider
  where connection.id = target_connection_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.revoked_at is null
    and connection.jira_webhook_generation = expected_generation
    and target.provider = 'jira'
    and target.enabled
    and target.revoked_at is null
  having pg_catalog.count(*) between 1 and 100;
$$;

alter function public.read_jira_webhook_project_keys(uuid, integer) owner to postgres;

revoke all on function public.read_jira_webhook_project_keys(uuid, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.read_jira_webhook_project_keys(uuid, integer) to service_role;

-- Final definition: 20260715001146_native_worker_fairness.sql
create function public.prepare_jira_webhook_candidate(
  target_organisation_id uuid,
  target_connection_id uuid,
  target_cloud_id text,
  target_callback_hash text,
  target_provider_expires_at timestamptz,
  target_callback_origin text
)
returns table (cleanup_id uuid, ownership_token uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_connection_id uuid;
  stored_cleanup_id uuid;
  candidate_ownership_token uuid := extensions.gen_random_uuid();
begin
  if target_cloud_id
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or target_callback_hash !~ '^[0-9a-f]{64}$'
     or target_provider_expires_at is null
     or target_provider_expires_at <= pg_catalog.clock_timestamp()
     or target_provider_expires_at
       > pg_catalog.clock_timestamp() + interval '31 days'
     or not public.is_valid_native_callback_origin(target_callback_origin) then
    raise exception using
      errcode = '22023',
      message = 'Jira webhook callback origin is invalid';
  end if;

  select connection.id
  into stored_connection_id
  from public.integration_connections as connection
  where connection.id = target_connection_id
    and connection.organisation_id = target_organisation_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.provider_account_id = target_cloud_id
    and connection.revoked_at is null
    and connection.access_token is not null
    and connection.refresh_token is not null
  for update;
  if not found then
    raise exception using
      errcode = 'P0001', message = 'Jira cleanup credential is unavailable';
  end if;

  insert into public.jira_webhook_cleanup_jobs(
    organisation_id, credential_connection_id, cloud_id, callback_hash,
    callback_origin, ownership_token, reason, provider_expires_at, status
  ) values (
    target_organisation_id, stored_connection_id, target_cloud_id,
    target_callback_hash, target_callback_origin,
    candidate_ownership_token, 'candidate',
    target_provider_expires_at, 'prepared'
  )
  returning id into stored_cleanup_id;

  return query select stored_cleanup_id, candidate_ownership_token;
end;
$$;

alter function public.prepare_jira_webhook_candidate(
  uuid, uuid, text, text, timestamptz, text
) owner to postgres;

revoke all on function public.prepare_jira_webhook_candidate(
  uuid, uuid, text, text, timestamptz, text
) from public, anon, authenticated, service_role;

grant execute on function public.prepare_jira_webhook_candidate(
  uuid, uuid, text, text, timestamptz, text
) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.record_jira_webhook_candidate(
  target_cleanup_id uuid,
  candidate_ownership_token uuid,
  target_webhook_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare affected_rows bigint;
begin
  if target_webhook_id !~ '^[1-9][0-9]{0,15}$' then
    raise exception using errcode = '22023', message = 'Jira webhook cleanup is invalid';
  end if;
  update public.jira_webhook_cleanup_jobs as cleanup
  set webhook_id = target_webhook_id, updated_at = pg_catalog.now()
  where cleanup.id = target_cleanup_id
    and cleanup.reason = 'candidate'
    and cleanup.status = 'prepared'
    and cleanup.ownership_token = candidate_ownership_token
    and cleanup.webhook_id is null;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

alter function public.record_jira_webhook_candidate(uuid, uuid, text) owner to postgres;

revoke all on function public.record_jira_webhook_candidate(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.record_jira_webhook_candidate(uuid, uuid, text) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.read_jira_webhook_candidate_state(
  target_cleanup_id uuid,
  candidate_ownership_token uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select cleanup.status
  from public.jira_webhook_cleanup_jobs as cleanup
  where cleanup.id = target_cleanup_id
    and cleanup.reason = 'candidate'
    and cleanup.ownership_token = candidate_ownership_token;
$$;

alter function public.read_jira_webhook_candidate_state(uuid, uuid) owner to postgres;

revoke all on function public.read_jira_webhook_candidate_state(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.read_jira_webhook_candidate_state(uuid, uuid) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.acknowledge_jira_webhook_cleanup(
  target_organisation_id uuid,
  target_cloud_id text,
  target_webhook_id text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_connection_id uuid;
begin
  update public.jira_webhook_cleanup_jobs as cleanup
  set status = 'completed', locked_at = null, locked_by = null,
      lock_token = null, completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where cleanup.organisation_id = target_organisation_id
    and cleanup.cloud_id = target_cloud_id
    and cleanup.webhook_id = target_webhook_id
    and cleanup.status in ('prepared', 'queued', 'failed', 'running')
  returning cleanup.credential_connection_id into stored_connection_id;
  if not found then return false; end if;
  perform public.clear_finished_jira_cleanup_credentials(stored_connection_id);
  return true;
end;
$$;

alter function public.acknowledge_jira_webhook_cleanup(uuid, text, text) owner to postgres;

revoke all on function public.acknowledge_jira_webhook_cleanup(uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.acknowledge_jira_webhook_cleanup(uuid, text, text) to service_role;

-- Final definition: 20260715001146_native_worker_fairness.sql
create function public.claim_jira_webhook_cleanup(worker_id text)
returns table (
  cleanup_id uuid,
  organisation_id uuid,
  connection_id uuid,
  cloud_id text,
  webhook_id text,
  callback_hash text,
  callback_origin text,
  lock_token uuid,
  attempt_count integer,
  absent_observations integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_cleanup record;
  claimed_lock_token uuid := extensions.gen_random_uuid();
  expired_cleanup record;
begin
  if worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception using
      errcode = '22023', message = 'Cleanup worker identity is invalid';
  end if;

  for expired_cleanup in
    update public.jira_webhook_cleanup_jobs as cleanup
    set status = 'completed', locked_at = null, locked_by = null,
        lock_token = null, completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where cleanup.status not in ('completed', 'promoted')
      and cleanup.provider_expires_at + interval '2 days'
        <= pg_catalog.clock_timestamp()
    returning cleanup.credential_connection_id
  loop
    perform public.clear_finished_jira_cleanup_credentials(
      expired_cleanup.credential_connection_id
    );
  end loop;

  update public.jira_webhook_cleanup_jobs as cleanup
  set status = 'failed', locked_at = null, locked_by = null,
      lock_token = null, next_attempt_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where cleanup.status = 'running'
    and cleanup.locked_at
      <= pg_catalog.clock_timestamp() - interval '5 minutes';

  select cleanup.*
  into selected_cleanup
  from public.jira_webhook_cleanup_jobs as cleanup
  join public.integration_connections as connection
    on connection.id = cleanup.credential_connection_id
   and connection.organisation_id = cleanup.organisation_id
   and connection.provider = 'jira'
   and connection.connection_mode = 'jira_oauth'
   and connection.provider_account_id = cleanup.cloud_id
  where cleanup.status in ('prepared', 'queued', 'failed')
    and (
      cleanup.status <> 'prepared'
      or cleanup.created_at
        <= pg_catalog.clock_timestamp() - interval '2 minutes'
    )
    and cleanup.attempt_count < 20
    and cleanup.next_attempt_at <= pg_catalog.clock_timestamp()
    and cleanup.provider_expires_at + interval '2 days'
      > pg_catalog.clock_timestamp()
    and connection.access_token is not null
    and connection.refresh_token is not null
  order by cleanup.next_attempt_at, cleanup.created_at, cleanup.id
  for update of cleanup skip locked
  limit 1;
  if not found then return; end if;

  update public.jira_webhook_cleanup_jobs as cleanup
  set status = 'running',
      attempt_count = selected_cleanup.attempt_count + 1,
      locked_at = pg_catalog.clock_timestamp(),
      locked_by = worker_id,
      lock_token = claimed_lock_token,
      updated_at = pg_catalog.clock_timestamp()
  where cleanup.id = selected_cleanup.id;

  return query
  select selected_cleanup.id, selected_cleanup.organisation_id,
         selected_cleanup.credential_connection_id,
         selected_cleanup.cloud_id, selected_cleanup.webhook_id,
         selected_cleanup.callback_hash, selected_cleanup.callback_origin,
         claimed_lock_token, selected_cleanup.attempt_count + 1,
         selected_cleanup.absent_observations;
end;
$$;

alter function public.claim_jira_webhook_cleanup(text) owner to postgres;

revoke all on function public.claim_jira_webhook_cleanup(text)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_jira_webhook_cleanup(text)
  to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.complete_jira_webhook_cleanup(
  target_cleanup_id uuid,
  claimed_lock_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare stored_connection_id uuid;
begin
  update public.jira_webhook_cleanup_jobs as cleanup
  set status = 'completed', locked_at = null, locked_by = null,
      lock_token = null, completed_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where cleanup.id = target_cleanup_id
    and cleanup.status = 'running'
    and cleanup.lock_token = claimed_lock_token
  returning cleanup.credential_connection_id into stored_connection_id;
  if not found then return false; end if;
  perform public.clear_finished_jira_cleanup_credentials(stored_connection_id);
  return true;
end;
$$;

alter function public.complete_jira_webhook_cleanup(uuid, uuid) owner to postgres;

revoke all on function public.complete_jira_webhook_cleanup(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.complete_jira_webhook_cleanup(uuid, uuid) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.fail_jira_webhook_cleanup(
  target_cleanup_id uuid,
  claimed_lock_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare affected_rows bigint;
begin
  update public.jira_webhook_cleanup_jobs as cleanup
  set status = 'failed', locked_at = null, locked_by = null, lock_token = null,
      next_attempt_at = pg_catalog.now() + pg_catalog.make_interval(
        secs => least(3600, 60 * pg_catalog.power(2::numeric, cleanup.attempt_count - 1)::integer)
      ),
      updated_at = pg_catalog.now()
  where cleanup.id = target_cleanup_id
    and cleanup.status = 'running'
    and cleanup.lock_token = claimed_lock_token;
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

alter function public.fail_jira_webhook_cleanup(uuid, uuid) owner to postgres;

revoke all on function public.fail_jira_webhook_cleanup(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.fail_jira_webhook_cleanup(uuid, uuid) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.observe_jira_webhook_cleanup_absent(
  target_cleanup_id uuid,
  claimed_lock_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  stored_connection_id uuid;
  completed boolean;
begin
  update public.jira_webhook_cleanup_jobs as cleanup
  set absent_observations = least(2, cleanup.absent_observations + 1),
      status = case when cleanup.absent_observations + 1 >= 2 then 'completed' else 'failed' end,
      locked_at = null,
      locked_by = null,
      lock_token = null,
      completed_at = case when cleanup.absent_observations + 1 >= 2 then pg_catalog.now() else null end,
      next_attempt_at = case
        when cleanup.absent_observations + 1 >= 2 then cleanup.next_attempt_at
        else pg_catalog.now() + interval '2 minutes'
      end,
      updated_at = pg_catalog.now()
  where cleanup.id = target_cleanup_id
    and cleanup.status = 'running'
    and cleanup.lock_token = claimed_lock_token
    and cleanup.reason = 'candidate'
    and cleanup.webhook_id is null
  returning cleanup.credential_connection_id, cleanup.status = 'completed'
  into stored_connection_id, completed;
  if not found then return false; end if;
  if completed then perform public.clear_finished_jira_cleanup_credentials(stored_connection_id); end if;
  return completed;
end;
$$;

alter function public.observe_jira_webhook_cleanup_absent(uuid, uuid) owner to postgres;

revoke all on function public.observe_jira_webhook_cleanup_absent(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.observe_jira_webhook_cleanup_absent(uuid, uuid) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.read_jira_cleanup_access_credential(
  target_connection_id uuid,
  target_cleanup_id uuid,
  cleanup_lock_token uuid
)
returns table (
  encrypted_access_token text,
  token_expires_at timestamptz,
  refresh_generation integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select connection.access_token, connection.token_expires_at,
         connection.jira_refresh_generation
  from public.integration_connections as connection
  where connection.id = target_connection_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.access_token is not null
    and exists (
      select 1 from public.jira_webhook_cleanup_jobs as cleanup
      where cleanup.id = target_cleanup_id
        and cleanup.credential_connection_id = connection.id
        and cleanup.status = 'running'
        and cleanup.lock_token = cleanup_lock_token
        and cleanup.provider_expires_at + interval '2 days' > pg_catalog.now()
    );
$$;

alter function public.read_jira_cleanup_access_credential(uuid, uuid, uuid) owner to postgres;

revoke all on function public.read_jira_cleanup_access_credential(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.read_jira_cleanup_access_credential(uuid, uuid, uuid) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.claim_jira_cleanup_refresh_lease(
  target_connection_id uuid,
  target_cleanup_id uuid,
  cleanup_lock_token uuid
)
returns table (
  lease_id uuid,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  refresh_generation integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare claimed_lease_id uuid := extensions.gen_random_uuid();
begin
  return query
  update public.integration_connections as connection
  set jira_refresh_lease_id = claimed_lease_id,
      jira_refresh_lease_expires_at = pg_catalog.now() + interval '90 seconds'
  where connection.id = target_connection_id
    and connection.provider = 'jira'
    and connection.connection_mode = 'jira_oauth'
    and connection.access_token is not null
    and connection.refresh_token is not null
    and (connection.jira_refresh_lease_id is null
         or connection.jira_refresh_lease_expires_at <= pg_catalog.now())
    and exists (
      select 1 from public.jira_webhook_cleanup_jobs as cleanup
      where cleanup.id = target_cleanup_id
        and cleanup.credential_connection_id = connection.id
        and cleanup.status = 'running'
        and cleanup.lock_token = cleanup_lock_token
    )
  returning connection.jira_refresh_lease_id, connection.access_token,
            connection.refresh_token, connection.token_expires_at,
            connection.jira_refresh_generation;
end;
$$;

alter function public.claim_jira_cleanup_refresh_lease(uuid, uuid, uuid) owner to postgres;

revoke all on function public.claim_jira_cleanup_refresh_lease(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_jira_cleanup_refresh_lease(uuid, uuid, uuid) to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.complete_jira_cleanup_refresh_lease(
  target_connection_id uuid,
  target_cleanup_id uuid,
  cleanup_lock_token uuid,
  claimed_lease_id uuid,
  new_encrypted_access_token text,
  new_encrypted_refresh_token text,
  new_token_expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare affected_rows bigint;
begin
  if new_encrypted_access_token is null
     or new_encrypted_access_token !~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
     or pg_catalog.char_length(new_encrypted_access_token) > 8192
     or new_encrypted_refresh_token is null
     or new_encrypted_refresh_token !~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
     or pg_catalog.char_length(new_encrypted_refresh_token) > 8192
     or new_token_expires_at is null
     or new_token_expires_at <= pg_catalog.now() then
    raise exception using errcode = '22023', message = 'Jira refresh result is invalid';
  end if;
  update public.integration_connections as connection
  set access_token = new_encrypted_access_token,
      refresh_token = new_encrypted_refresh_token,
      token_expires_at = new_token_expires_at,
      jira_refresh_lease_id = null,
      jira_refresh_lease_expires_at = null,
      jira_refresh_generation = connection.jira_refresh_generation + 1
  where connection.id = target_connection_id
    and connection.jira_refresh_lease_id = claimed_lease_id
    and exists (
      select 1 from public.jira_webhook_cleanup_jobs as cleanup
      where cleanup.id = target_cleanup_id
        and cleanup.credential_connection_id = connection.id
        and cleanup.status = 'running'
        and cleanup.lock_token = cleanup_lock_token
    );
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

alter function public.complete_jira_cleanup_refresh_lease(uuid, uuid, uuid, uuid, text, text, timestamptz) owner to postgres;

revoke all on function public.complete_jira_cleanup_refresh_lease(uuid, uuid, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function public.complete_jira_cleanup_refresh_lease(uuid, uuid, uuid, uuid, text, text, timestamptz)
  to service_role;

-- Final definition: 20260714224000_native_webhook_lifecycle.sql
create function public.release_jira_cleanup_refresh_lease(
  target_connection_id uuid,
  target_cleanup_id uuid,
  cleanup_lock_token uuid,
  claimed_lease_id uuid,
  safe_failure text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare affected_rows bigint;
begin
  if safe_failure not in ('provider_unavailable', 'authorization_expired', 'rate_limited', 'unexpected_error') then
    raise exception using errcode = '22023', message = 'Jira refresh failure is invalid';
  end if;
  update public.integration_connections as connection
  set jira_refresh_lease_id = null, jira_refresh_lease_expires_at = null
  where connection.id = target_connection_id
    and connection.jira_refresh_lease_id = claimed_lease_id
    and exists (
      select 1 from public.jira_webhook_cleanup_jobs as cleanup
      where cleanup.id = target_cleanup_id
        and cleanup.credential_connection_id = connection.id
        and cleanup.status = 'running'
        and cleanup.lock_token = cleanup_lock_token
    );
  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

alter function public.release_jira_cleanup_refresh_lease(uuid, uuid, uuid, uuid, text) owner to postgres;

revoke all on function public.release_jira_cleanup_refresh_lease(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.release_jira_cleanup_refresh_lease(uuid, uuid, uuid, uuid, text)
  to service_role;

-- Final definition: 20260715001146_native_worker_fairness.sql
create function public.enqueue_due_jira_reconciliations(result_limit integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_connection record;
  queued_count integer := 0;
begin
  if result_limit is null or result_limit not between 1 and 25 then
    raise exception using
      errcode = '22023',
      message = 'Jira reconciliation limit is invalid';
  end if;

  for selected_connection in
    select connection.id, connection.organisation_id
    from public.integration_connections as connection
    where connection.provider = 'jira'
      and connection.connection_mode = 'jira_oauth'
      and connection.enabled
      and connection.revoked_at is null
      and exists (
        select 1
        from public.integration_connection_targets as target
        where target.connection_id = connection.id
          and target.organisation_id = connection.organisation_id
          and target.provider = 'jira'
          and target.enabled
          and target.revoked_at is null
      )
      and (
        connection.jira_webhook_id is null
        or connection.jira_webhook_expires_at is null
        or connection.jira_webhook_callback_hash is null
        or connection.jira_webhook_expires_at
          <= pg_catalog.clock_timestamp() + interval '7 days'
      )
      and not exists (
        select 1
        from public.integration_sync_jobs as pending
        where pending.organisation_id = connection.organisation_id
          and pending.provider = 'jira'
          and pending.connection_id = connection.id
          and pending.target_id is null
          and pending.kind in (
            'scheduled_reconciliation', 'manual_sync',
            'connection_reconciliation'
          )
          and (
            pending.status in ('queued', 'running')
            or (pending.status = 'failed' and pending.attempt_count < 20)
          )
      )
    order by coalesce(
      connection.last_sync_attempt_at,
      connection.last_sync_succeeded_at,
      connection.created_at
    ), connection.id
    for update of connection skip locked
    limit result_limit
  loop
    insert into public.integration_sync_jobs(
      organisation_id, provider, connection_id, target_id,
      kind, idempotency_key, payload
    ) values (
      selected_connection.organisation_id, 'jira', selected_connection.id,
      null, 'scheduled_reconciliation',
      'scheduled:' || selected_connection.id::text || ':'
        || extensions.gen_random_uuid()::text,
      '{"source":"scheduled"}'::jsonb
    );

    update public.integration_connections as connection
    set last_sync_attempt_at = pg_catalog.clock_timestamp()
    where connection.id = selected_connection.id;
    queued_count := queued_count + 1;
  end loop;

  return queued_count;
end;
$$;

alter function public.enqueue_due_jira_reconciliations(integer) owner to postgres;

revoke all on function public.enqueue_due_jira_reconciliations(integer)
  from public, anon, authenticated, service_role;

grant execute on function public.enqueue_due_jira_reconciliations(integer)
  to service_role;

-- Final definition: 20260715001146_native_worker_fairness.sql
create function public.is_valid_native_callback_origin(candidate_origin text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    candidate_origin = pg_catalog.btrim(candidate_origin)
    and pg_catalog.char_length(candidate_origin) between 8 and 255
    and candidate_origin !~ '[\r\n]'
    and (
      (
        candidate_origin
          ~ '^https://[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[1-9][0-9]{0,4})?$'
        and (
          candidate_origin !~ ':[0-9]+$'
          or pg_catalog.substring(candidate_origin, ':([0-9]{1,5})$')::integer
            between 1 and 65535
        )
      )
      or (
        candidate_origin ~ '^http://localhost(?::[1-9][0-9]{0,4})?$'
        and (
          candidate_origin = 'http://localhost'
          or pg_catalog.substring(candidate_origin, ':([0-9]{1,5})$')::integer
            between 1 and 65535
        )
      )
    ),
    false
  );
$$;

alter function public.is_valid_native_callback_origin(text) owner to postgres;

revoke all on function public.is_valid_native_callback_origin(text)
  from public, anon, authenticated, service_role;

-- Final definition: 20260715013000_native_parent_fanout_hardening.sql
create or replace function public.prune_native_integration_history(
  row_limit integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  removed_total integer := 0;
  remaining_limit integer;
  removed_rows bigint;
begin
  if row_limit is null or row_limit not between 1 and 1000 then
    raise exception using
      errcode = '22023', message = 'Integration retention limit is invalid';
  end if;
  remaining_limit := row_limit;

  with selected_cleanup as (
    select cleanup.id
    from public.jira_webhook_cleanup_jobs as cleanup
    where cleanup.status in ('completed', 'promoted')
      and cleanup.updated_at
        < pg_catalog.clock_timestamp() - interval '30 days'
      and cleanup.provider_expires_at + interval '2 days'
        <= pg_catalog.clock_timestamp()
    order by cleanup.updated_at, cleanup.id
    for update of cleanup skip locked
    limit remaining_limit
  )
  delete from public.jira_webhook_cleanup_jobs as cleanup
  using selected_cleanup
  where cleanup.id = selected_cleanup.id;
  get diagnostics removed_rows = row_count;
  removed_total := removed_total + removed_rows::integer;
  remaining_limit := remaining_limit - removed_rows::integer;

  if remaining_limit > 0 then
    with selected_delivery as (
      select delivery.id
      from public.integration_webhook_deliveries as delivery
      join public.integration_sync_jobs as job
        on job.id = delivery.coalesced_job_id
       and job.organisation_id = delivery.organisation_id
       and job.provider = delivery.provider
      where delivery.status = 'processed'
        and delivery.received_at
          < pg_catalog.clock_timestamp() - interval '30 days'
        and (
          job.status in ('completed', 'cancelled')
          or (job.status = 'failed' and job.attempt_count >= 20)
        )
      order by delivery.received_at, delivery.id
      for update of delivery skip locked
      limit remaining_limit
    )
    delete from public.integration_webhook_deliveries as delivery
    using selected_delivery
    where delivery.id = selected_delivery.id;
    get diagnostics removed_rows = row_count;
    removed_total := removed_total + removed_rows::integer;
    remaining_limit := remaining_limit - removed_rows::integer;
  end if;

  if remaining_limit > 0 then
    with selected_delivery as (
      select delivery.id
      from public.integration_webhook_deliveries as delivery
      where delivery.received_at
          < pg_catalog.clock_timestamp() - interval '30 days'
        and exists (
          select 1
          from public.integration_sync_jobs as owning_job
          where owning_job.webhook_delivery_id = delivery.id
            and (
              owning_job.status in ('completed', 'cancelled')
              or (
                owning_job.status = 'failed'
                and owning_job.attempt_count >= 20
              )
            )
            and not exists (
              select 1
              from public.integration_webhook_deliveries as shared_delivery
              where shared_delivery.coalesced_job_id = owning_job.id
            )
        )
      order by delivery.received_at, delivery.id
      for update of delivery skip locked
      limit remaining_limit
    )
    delete from public.integration_webhook_deliveries as delivery
    using selected_delivery
    where delivery.id = selected_delivery.id;
    get diagnostics removed_rows = row_count;
    removed_total := removed_total + removed_rows::integer;
    remaining_limit := remaining_limit - removed_rows::integer;
  end if;

  if remaining_limit > 0 then
    with selected_job as (
      select job.id
      from public.integration_sync_jobs as job
      where job.created_at
          < pg_catalog.clock_timestamp() - interval '30 days'
        and (
          job.status in ('completed', 'cancelled')
          or (job.status = 'failed' and job.attempt_count >= 20)
        )
        and job.webhook_delivery_id is null
        and not exists (
          select 1
          from public.integration_webhook_deliveries as delivery
          where delivery.coalesced_job_id = job.id
        )
      order by job.created_at, job.id
      for update of job skip locked
      limit remaining_limit
    )
    delete from public.integration_sync_jobs as job
    using selected_job
    where job.id = selected_job.id;
    get diagnostics removed_rows = row_count;
    removed_total := removed_total + removed_rows::integer;
  end if;

  return removed_total;
end;
$$;

alter function public.prune_native_integration_history(integer)
  owner to postgres;

revoke all on function public.prune_native_integration_history(integer)
  from public, anon, authenticated, service_role;

grant execute on function public.prune_native_integration_history(integer)
  to service_role;

-- Final definition: 20260715013000_native_parent_fanout_hardening.sql
create function public.fan_out_integration_sync_job(
  target_parent_job_id uuid,
  claimed_lock_token uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_parent record;
  missing_count integer;
  outstanding_count integer;
  owned_child_count integer;
begin
  select job.*
  into selected_parent
  from public.integration_sync_jobs as job
  where job.id = target_parent_job_id
    and job.status = 'running'
    and job.lock_token = claimed_lock_token
    and job.target_id is null
    and job.kind in (
      'provider_webhook', 'manual_sync',
      'connection_reconciliation', 'scheduled_reconciliation'
    )
    and exists (
      select 1
      from public.integration_connections as connection
      where connection.id = job.connection_id
        and connection.organisation_id = job.organisation_id
        and connection.provider = job.provider
        and connection.enabled
        and connection.revoked_at is null
        and (
          (connection.provider = 'github'
            and connection.connection_mode = 'github_app')
          or (connection.provider = 'jira'
            and connection.connection_mode = 'jira_oauth')
        )
    )
  for update of job;
  if not found then
    raise exception using
      errcode = 'P0001', message = 'Synchronization parent lease is unavailable';
  end if;




  perform 1
  from public.integration_connections as connection
  where connection.id = selected_parent.connection_id
    and connection.organisation_id = selected_parent.organisation_id
    and connection.provider = selected_parent.provider
    and connection.enabled
    and connection.revoked_at is null
  for update;
  if not found then
    raise exception using
      errcode = 'P0001', message = 'Synchronization connection is unavailable';
  end if;

  select pg_catalog.count(*)
  into missing_count
  from public.integration_connection_targets as target
  where target.organisation_id = selected_parent.organisation_id
    and target.connection_id = selected_parent.connection_id
    and target.provider = selected_parent.provider
    and target.enabled
    and target.revoked_at is null
    and not exists (
      select 1
      from public.integration_sync_jobs as child
      where child.organisation_id = selected_parent.organisation_id
        and child.provider = selected_parent.provider
        and child.connection_id = selected_parent.connection_id
        and child.target_id = target.id
        and child.kind = 'target_sync'
        and child.idempotency_key =
          'fanout:' || selected_parent.id::text || ':' || target.id::text
    );

  select pg_catalog.count(*)
  into outstanding_count
  from public.integration_sync_jobs as job
  where job.organisation_id = selected_parent.organisation_id
    and job.provider = selected_parent.provider
    and job.connection_id = selected_parent.connection_id
    and job.target_id is not null
    and (
      job.status in ('queued', 'running')
      or (job.status = 'failed' and job.attempt_count < 20)
    );
  if outstanding_count + missing_count > 10000 then
    raise exception using
      errcode = 'P0001', message = 'Synchronization target queue is busy';
  end if;

  insert into public.integration_sync_jobs(
    organisation_id, provider, connection_id, target_id,
    kind, idempotency_key, payload
  )
  select selected_parent.organisation_id, selected_parent.provider,
         selected_parent.connection_id, target.id, 'target_sync',
         'fanout:' || selected_parent.id::text || ':' || target.id::text,
         pg_catalog.jsonb_build_object(
           'parentJobId', selected_parent.id::text,
           'source', selected_parent.kind
         )
  from public.integration_connection_targets as target
  where target.organisation_id = selected_parent.organisation_id
    and target.connection_id = selected_parent.connection_id
    and target.provider = selected_parent.provider
    and target.enabled
    and target.revoked_at is null
  order by target.id
  on conflict (organisation_id, provider, idempotency_key) do nothing;

  select pg_catalog.count(*)
  into owned_child_count
  from public.integration_sync_jobs as child
  where child.organisation_id = selected_parent.organisation_id
    and child.provider = selected_parent.provider
    and child.connection_id = selected_parent.connection_id
    and child.kind = 'target_sync'
    and child.payload ->> 'parentJobId' = selected_parent.id::text;
  return owned_child_count;
end;
$$;

alter function public.fan_out_integration_sync_job(uuid, uuid)
  owner to postgres;

revoke all on function public.fan_out_integration_sync_job(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.fan_out_integration_sync_job(uuid, uuid)
  to service_role;

-- Final definition: 20260715060000_scoped_manual_sync_processing.sql
create function public.claim_integration_sync_child_job(
  worker_id text,
  target_parent_job_id uuid
)
returns table (
  job_id uuid,
  organisation_id uuid,
  provider public.integration_provider,
  connection_id uuid,
  target_id uuid,
  kind text,
  payload jsonb,
  attempt_count integer,
  locked_by text,
  lock_token uuid,
  webhook_delivery_id uuid,
  idempotency_key text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_job record;
  claimed_lock_token uuid := extensions.gen_random_uuid();
begin
  if worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' then
    raise exception using
      errcode = '22023', message = 'Worker identity is invalid';
  end if;

  select child.*
  into selected_job
  from public.integration_sync_jobs as parent
  join public.integration_sync_jobs as child
    on child.organisation_id = parent.organisation_id
   and child.provider = parent.provider
   and child.connection_id = parent.connection_id
   and child.kind = 'target_sync'
   and child.payload ->> 'parentJobId' = parent.id::text
  where parent.id = target_parent_job_id
    and parent.target_id is null
    and parent.status = 'completed'
    and parent.kind in (
      'provider_webhook', 'manual_sync',
      'connection_reconciliation', 'scheduled_reconciliation'
    )
    and child.target_id is not null
    and child.idempotency_key =
      'fanout:' || parent.id::text || ':' || child.target_id::text
    and child.status in ('queued', 'failed')
    and child.next_attempt_at <= pg_catalog.now()
    and child.attempt_count < 20
    and exists (
      select 1
      from public.integration_connections as connection
      where connection.id = child.connection_id
        and connection.organisation_id = child.organisation_id
        and connection.provider = child.provider
        and connection.enabled
        and connection.revoked_at is null
    )
    and exists (
      select 1
      from public.integration_connection_targets as target
      where target.id = child.target_id
        and target.organisation_id = child.organisation_id
        and target.connection_id = child.connection_id
        and target.provider = child.provider
        and target.enabled
        and target.revoked_at is null
    )
  order by child.next_attempt_at, child.created_at, child.id
  limit 1
  for update of child skip locked;

  if not found then return; end if;

  update public.integration_sync_jobs as child
  set status = 'running',
      attempt_count = selected_job.attempt_count + 1,
      locked_at = pg_catalog.now(),
      locked_by = worker_id,
      lock_token = claimed_lock_token,
      completed_at = null,
      safe_error = null
  where child.id = selected_job.id;

  return query
  select
    child.id, child.organisation_id, child.provider, child.connection_id,
    child.target_id, child.kind, child.payload, child.attempt_count,
    child.locked_by, child.lock_token, child.webhook_delivery_id,
    child.idempotency_key
  from public.integration_sync_jobs as child
  where child.id = selected_job.id;
end;
$$;

alter function public.claim_integration_sync_child_job(text, uuid)
  owner to postgres;

revoke all on function public.claim_integration_sync_child_job(text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.claim_integration_sync_child_job(text, uuid)
  to service_role;

-- Final definition: 20260715060000_scoped_manual_sync_processing.sql
create function public.integration_sync_job_tree_status(
  target_parent_job_id uuid
)
returns table (
  root_status text,
  child_total integer,
  child_completed integer,
  child_queued integer,
  child_running integer,
  child_retrying integer,
  child_terminal integer,
  tree_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_parent record;
  counts record;
begin
  select parent.id, parent.organisation_id, parent.provider,
         parent.connection_id, parent.status, parent.attempt_count
  into selected_parent
  from public.integration_sync_jobs as parent
  where parent.id = target_parent_job_id
    and parent.target_id is null
    and parent.kind in (
      'provider_webhook', 'manual_sync',
      'connection_reconciliation', 'scheduled_reconciliation'
    );
  if not found then
    raise exception using
      errcode = 'P0001', message = 'Synchronization parent is unavailable';
  end if;

  select
    pg_catalog.count(*)::integer as total_count,
    pg_catalog.count(*) filter (where child.status = 'completed')::integer
      as completed_count,
    pg_catalog.count(*) filter (where child.status = 'queued')::integer
      as queued_count,
    pg_catalog.count(*) filter (where child.status = 'running')::integer
      as running_count,
    pg_catalog.count(*) filter (
      where child.status = 'failed' and child.attempt_count < 20
    )::integer as retrying_count,
    pg_catalog.count(*) filter (
      where child.status = 'cancelled'
         or (child.status = 'failed' and child.attempt_count >= 20)
    )::integer as terminal_count
  into counts
  from public.integration_sync_jobs as child
  where child.organisation_id = selected_parent.organisation_id
    and child.provider = selected_parent.provider
    and child.connection_id = selected_parent.connection_id
    and child.kind = 'target_sync'
    and child.payload ->> 'parentJobId' = selected_parent.id::text;

  return query select
    selected_parent.status::text,
    counts.total_count, counts.completed_count, counts.queued_count,
    counts.running_count, counts.retrying_count, counts.terminal_count,
    case
      when selected_parent.status = 'cancelled'
        or (selected_parent.status = 'failed'
            and selected_parent.attempt_count >= 20)
        then 'terminal'
      when selected_parent.status = 'failed' then 'retrying'
      when selected_parent.status = 'queued' then 'queued'
      when selected_parent.status = 'running' then 'running'
      when counts.terminal_count > 0 then 'terminal'
      when counts.running_count > 0 then 'running'
      when counts.retrying_count > 0 then 'retrying'
      when counts.queued_count > 0 then 'queued'
      when selected_parent.status = 'completed'
        and counts.total_count = counts.completed_count then 'completed'
      else 'terminal'
    end;
end;
$$;

alter function public.integration_sync_job_tree_status(uuid)
  owner to postgres;

revoke all on function public.integration_sync_job_tree_status(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.integration_sync_job_tree_status(uuid)
  to service_role;

drop index if exists public.monitor_sources_integration_connection_unique;
create unique index monitor_sources_integration_connection_unique on public.monitor_sources(integration_connection_id) where integration_connection_id is not null and integration_connection_target_id is null;

alter table public.jira_webhook_cleanup_jobs
  add constraint jira_webhook_cleanup_callback_origin_check check (
    callback_origin is null
    or public.is_valid_native_callback_origin(callback_origin)
  ) not valid;

create trigger integration_connection_targets_audit
after insert or update or delete on public.integration_connection_targets
for each row execute function public.capture_audit_event();

create trigger integration_connections_enforce_native_identity
before update of organisation_id, provider, connection_mode, provider_account_id, revoked_at,
  broker_connection_id, broker_provider_config_key
on public.integration_connections
for each row execute function public.enforce_native_connection_identity();

create trigger integration_connection_targets_prepare
before insert or update on public.integration_connection_targets
for each row execute function public.prepare_integration_connection_target();

create trigger integration_connection_targets_sync_monitor
after insert or update of display_name, config, enabled, revoked_at
on public.integration_connection_targets
for each row execute function public.sync_native_target_monitor_source();

create trigger integration_connections_sync_native_monitors
after update of enabled, revoked_at on public.integration_connections
for each row execute function public.sync_native_connection_monitor_sources();

create trigger integration_webhook_deliveries_require_native_connection
before insert or update of organisation_id, provider, connection_id
on public.integration_webhook_deliveries
for each row execute function public.enforce_native_service_state_connection();

create trigger integration_sync_jobs_require_native_connection
before insert or update of organisation_id, provider, connection_id
on public.integration_sync_jobs
for each row execute function public.enforce_native_service_state_connection();

create trigger integration_sync_jobs_touch_updated_at
before update on public.integration_sync_jobs
for each row execute function public.touch_integration_sync_job_updated_at();

create trigger integration_connections_enforce_jira_webhook
before insert or update of enabled, revoked_at, jira_webhook_id,
  jira_webhook_expires_at, jira_webhook_callback_hash
on public.integration_connections
for each row execute function public.enforce_jira_webhook_configuration();

create trigger integration_targets_enforce_jira_webhook
before insert or update of enabled, revoked_at
on public.integration_connection_targets
for each row execute function public.enforce_jira_webhook_configuration();

-- Extend the canonical enabled-target rule without loosening broker validation.
do $coexist$
declare definition text;
begin
 select pg_get_constraintdef(oid) into definition from pg_constraint
 where conrelid='public.integration_connections'::regclass and conname='integration_connections_enabled_target_check';
 if definition is null then raise exception 'Canonical broker target constraint missing'; end if;
 execute 'alter table public.integration_connections drop constraint integration_connections_enabled_target_check';
 execute 'alter table public.integration_connections add constraint integration_connections_enabled_target_check check (connection_mode = ''jira_oauth'' or ' || substring(definition from 7) || ')';
 -- Broker lifecycle retains its exact implementation, with explicit Jira dispatch.
 select pg_get_functiondef('public.enforce_linked_oauth_monitor_source()'::regprocedure) into definition;
 definition := regexp_replace(definition, E'begin\n', E'begin\n  if new.connection_mode = ''jira_oauth'' then return new; end if;\n', 'i');
 execute definition;
 select pg_get_functiondef('public.sync_github_oauth_monitor_source()'::regprocedure) into definition;
 definition := replace(definition, 'on conflict (integration_connection_id) where integration_connection_id is not null',
 'on conflict (integration_connection_id) where integration_connection_id is not null and integration_connection_target_id is null');
 execute definition;
end;
$coexist$;
-- Only additional safe columns are granted; canonical column privileges remain intact.
grant select(provider_account_id,provider_account_name,health,last_sync_attempt_at,last_sync_succeeded_at,last_error,jira_webhook_expires_at) on public.integration_connections to authenticated;
