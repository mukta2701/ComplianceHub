-- Resource references stay stable; observation keys distinguish dated results.
-- Nullable additions leave all existing row identities/facts/history untouched.
alter table public.evidence
  add column observation_key text
    constraint evidence_observation_key_format
    check (observation_key is null or observation_key ~ '^v1:[0-9a-f]{64}$');

-- Authenticated operators retain manual evidence INSERT, but cannot assert
-- collector provenance through the table API. Invoker current_user also lets
-- existing trusted postgres-owned review functions keep their write contract.
create function public.guard_collector_evidence_provenance()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.source_id is not null or new.external_ref is not null or new.observation_key is not null)
     and current_user not in ('service_role', 'postgres') then
    raise exception 'Collector evidence provenance is server-managed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_collector_evidence_provenance() from public, anon, authenticated, service_role;
create trigger evidence_collector_provenance_insert
  before insert on public.evidence
  for each row execute function public.guard_collector_evidence_provenance();

drop index public.evidence_source_external_ref_key;
create unique index evidence_source_external_ref_key
  on public.evidence(source_id, external_ref)
  where source_id is not null and external_ref is not null and observation_key is null;
create unique index evidence_source_observation_key
  on public.evidence(source_id, external_ref, observation_key)
  where source_id is not null and external_ref is not null and observation_key is not null;

alter table public.source_objects
  add column observation_key text
    constraint source_objects_observation_key_format
    check (observation_key is null or observation_key ~ '^v1:[0-9a-f]{64}$'),
  add column collected_on date,
  add constraint source_objects_observation_date_check
    check ((observation_key is null) = (collected_on is null));

alter table public.source_objects
  drop constraint source_objects_connection_id_external_ref_key;
create unique index source_objects_legacy_resource_key
  on public.source_objects(connection_id, external_ref)
  where observation_key is null;
create unique index source_objects_observation_key
  on public.source_objects(connection_id, external_ref, observation_key)
  where observation_key is not null;

-- Evidence's existing all-fields-except-status guard automatically covers its
-- new column. Source objects permit retention to change status, expires_at,
-- purged_at and content_ref; those changes must never rewrite source identity.
create function public.guard_source_observation_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.id, new.organisation_id, new.connection_id, new.external_ref, new.observation_key, new.collected_on)
     is distinct from
     row(old.id, old.organisation_id, old.connection_id, old.external_ref, old.observation_key, old.collected_on) then
    raise exception 'Source observation identity is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_source_observation_identity() from public, anon, authenticated, service_role;
create trigger source_objects_observation_identity_immutable
  before update on public.source_objects
  for each row execute function public.guard_source_observation_identity();

comment on column public.evidence.observation_key is
  'Versioned identity of a generic dated provider result. NULL retains legacy/manual semantics; not reconstructed history.';
comment on column public.source_objects.observation_key is
  'Versioned identity of a generic dated provider result. NULL is legacy observation identity unknown.';
comment on column public.source_objects.collected_on is
  'Recorded generic collection date at day precision; NULL for legacy observation identity unknown.';
