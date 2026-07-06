begin;
select plan(6);

-- B3 Stage 2: the evidence-collection cron runs as the service role (bypasses
-- RLS, tenant-scoped per row via the source's organisation_id). This proves the
-- new SELECT grant lets the service role read active sources, that it can insert
-- an auto-collected evidence row for a source, that the source is tenant-bound
-- (a cross-tenant source_id is rejected by the composite FK), and that the
-- (source_id, external_ref) dedup index rejects a duplicate re-collect — the DB
-- guarantee the cron's look-up-first upsert relies on to stay idempotent.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b', '10000000-0000-4000-8000-000000000002');
insert into public.memberships (organisation_id, user_id, role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'owner');

-- One active source in tenant A and one revoked source in tenant A.
insert into public.evidence_sources (id, organisation_id, provider, label, connected_by, revoked_at) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'google_workspace', 'Corp GWS', '10000000-0000-4000-8000-000000000001', null),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'github', 'Old GitHub', '10000000-0000-4000-8000-000000000001', now());

set local role service_role;

-- (1) The service role can read sources (the new grant) and (2) the cron's
-- "active only" filter (revoked_at is null) surfaces exactly the one live source.
select is(
  (select count(*) from public.evidence_sources),
  2::bigint, 'the service role can read every source (RLS bypassed)');
select is(
  (select count(*) from public.evidence_sources where revoked_at is null),
  1::bigint, 'the active-source filter surfaces exactly the live source');

-- (3) The service role inserts an auto-collected evidence row for a source,
-- tenant-scoped to the source's organisation.
select lives_ok(
  $$ insert into public.evidence (organisation_id, title, kind, description, status, collected_on, valid_until, source_id, external_ref, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'MFA enforcement report', 'note', 'Auto-collected', 'current', '2026-01-01', '2026-04-01', '60000000-0000-4000-8000-000000000001', 'AUTO-MFA', '10000000-0000-4000-8000-000000000001') $$,
  'the service role inserts auto-collected evidence for a source');

-- (4) The dedup index rejects a duplicate re-collect of the same item — the
-- guarantee that makes the look-up-first cron idempotent.
select throws_ok(
  $$ insert into public.evidence (organisation_id, title, kind, description, status, collected_on, valid_until, source_id, external_ref, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'MFA enforcement report', 'note', 'Auto-collected', 'current', '2026-01-01', '2026-04-01', '60000000-0000-4000-8000-000000000001', 'AUTO-MFA', '10000000-0000-4000-8000-000000000001') $$,
  '23505', null, 're-collecting the same (source_id, external_ref) is rejected as a duplicate');

-- (5) The composite tenant FK rejects an evidence row that references a source
-- from another tenant — one org's cron can never mis-attribute proof to another.
select throws_ok(
  $$ insert into public.evidence (organisation_id, title, kind, description, status, collected_on, valid_until, source_id, external_ref, created_by)
     values ('20000000-0000-4000-8000-000000000002', 'Cross-tenant collect', 'note', 'Auto-collected', 'current', '2026-01-01', '2026-04-01', '60000000-0000-4000-8000-000000000001', 'AUTO-X', '10000000-0000-4000-8000-000000000002') $$,
  '23503', null, 'evidence cannot reference a source from another tenant');

-- (6) A distinct external_ref from the same source is accepted (a second item).
select lives_ok(
  $$ insert into public.evidence (organisation_id, title, kind, description, status, collected_on, valid_until, source_id, external_ref, created_by)
     values ('20000000-0000-4000-8000-000000000001', 'Access review export', 'note', 'Auto-collected', 'current', '2026-01-01', '2026-04-01', '60000000-0000-4000-8000-000000000001', 'AUTO-ACCESS', '10000000-0000-4000-8000-000000000001') $$,
  'a distinct external_ref from the same source is a separate evidence row');

reset role;

select * from finish();
rollback;
