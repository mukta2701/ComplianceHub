begin;
select no_plan();

-- Real persistence boundary: legacy rows coexist with identified observations,
-- while retries, immutable identity and workspace isolation remain enforced.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
('10000000-0000-4000-8000-000000000991', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dated-owner-a@example.test', '', now(), '{}', '{}'),
('10000000-0000-4000-8000-000000000992', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dated-owner-b@example.test', '', now(), '{}', '{}'),
('10000000-0000-4000-8000-000000000993', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dated-member-a@example.test', '', now(), '{}', '{}');
insert into public.organisations (id, name, slug, created_by) values
('20000000-0000-4000-8000-000000000991', 'Dated Tenant A', 'dated-tenant-a', '10000000-0000-4000-8000-000000000991'),
('20000000-0000-4000-8000-000000000992', 'Dated Tenant B', 'dated-tenant-b', '10000000-0000-4000-8000-000000000992');
insert into public.memberships (organisation_id, user_id, role) values
('20000000-0000-4000-8000-000000000991', '10000000-0000-4000-8000-000000000991', 'owner'),
('20000000-0000-4000-8000-000000000992', '10000000-0000-4000-8000-000000000992', 'owner'),
('20000000-0000-4000-8000-000000000991', '10000000-0000-4000-8000-000000000993', 'member');
insert into public.evidence_sources (id, organisation_id, provider, label, connected_by) values
('30000000-0000-4000-8000-000000000991', '20000000-0000-4000-8000-000000000991', 'github', 'Dated source A', '10000000-0000-4000-8000-000000000991'),
('30000000-0000-4000-8000-000000000992', '20000000-0000-4000-8000-000000000992', 'github', 'Dated source B', '10000000-0000-4000-8000-000000000992');
insert into public.connector_connections (id, organisation_id, provider, label, owner_id, connected_by, consent) values
('40000000-0000-4000-8000-000000000991', '20000000-0000-4000-8000-000000000991', 'github', 'Dated connector A', '10000000-0000-4000-8000-000000000991', '10000000-0000-4000-8000-000000000991', '{}'),
('40000000-0000-4000-8000-000000000992', '20000000-0000-4000-8000-000000000992', 'github', 'Dated connector B', '10000000-0000-4000-8000-000000000992', '10000000-0000-4000-8000-000000000992', '{}');

insert into public.evidence (id, organisation_id, title, kind, description, collected_on, valid_until, source_id, external_ref, created_by) values
('50000000-0000-4000-8000-000000000991', '20000000-0000-4000-8000-000000000991', 'August observation', 'note', 'One protected branch', '2026-08-01', '2026-08-31', '30000000-0000-4000-8000-000000000991', 'github:fictional/app:protected-branches', '10000000-0000-4000-8000-000000000991');
insert into public.source_objects (id, organisation_id, connection_id, external_ref, title, content_ref, content_hash, classification, expires_at) values
('60000000-0000-4000-8000-000000000991', '20000000-0000-4000-8000-000000000991', '40000000-0000-4000-8000-000000000991', 'github:fictional/app:protected-branches', 'August observation', 'evidence://github:fictional/app:protected-branches', 'legacy-hash', 'metadata', '2026-08-31T00:00:00Z');
insert into public.tasks (id, organisation_id, title, created_by) values
('70000000-0000-4000-8000-000000000991', '20000000-0000-4000-8000-000000000991', 'Previously linked review work', '10000000-0000-4000-8000-000000000991');
insert into public.evidence_links (id, organisation_id, evidence_id, task_id, created_by) values
('71000000-0000-4000-8000-000000000991', '20000000-0000-4000-8000-000000000991', '50000000-0000-4000-8000-000000000991', '70000000-0000-4000-8000-000000000991', '10000000-0000-4000-8000-000000000991');
insert into public.automation_signals (id, organisation_id, connection_id, source_object_id, signal_type, summary, confidence, occurred_at) values
('80000000-0000-4000-8000-000000000991', '20000000-0000-4000-8000-000000000991', '40000000-0000-4000-8000-000000000991', '60000000-0000-4000-8000-000000000991', 'github.branch_protection', 'One protected branch', 'high', '2026-08-01T00:00:00Z');
insert into public.automation_proposals (id, organisation_id, signal_id, target_type, assigned_to, created_by, input_snapshot, output, source_references) values
('90000000-0000-4000-8000-000000000991', '20000000-0000-4000-8000-000000000991', '80000000-0000-4000-8000-000000000991', 'scope_fact', '10000000-0000-4000-8000-000000000991', '10000000-0000-4000-8000-000000000991', '{"summary":"One protected branch"}', '{"summary":"Previously reviewed observation"}', '[{"type":"source_object","id":"60000000-0000-4000-8000-000000000991"}]');
insert into public.automation_proposal_sources (proposal_id, source_object_id, organisation_id) values
('90000000-0000-4000-8000-000000000991', '60000000-0000-4000-8000-000000000991', '20000000-0000-4000-8000-000000000991');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000991","role":"authenticated"}', true);
update public.automation_proposals set status = 'accepted', reviewer_id = '10000000-0000-4000-8000-000000000991' where id = '90000000-0000-4000-8000-000000000991';
select set_config('request.jwt.claims', '{}', true);
create temporary table original_evidence as select to_jsonb(e) - 'observation_key' as row_value from public.evidence e where id = '50000000-0000-4000-8000-000000000991';
create temporary table original_source as select to_jsonb(s) - array['observation_key', 'collected_on'] as row_value from public.source_objects s where id = '60000000-0000-4000-8000-000000000991';
create temporary table original_history as
select 'task' as kind, to_jsonb(t) as row_value from public.tasks t where id = '70000000-0000-4000-8000-000000000991'
union all select 'evidence_link', to_jsonb(l) from public.evidence_links l where id = '71000000-0000-4000-8000-000000000991'
union all select 'signal', to_jsonb(s) from public.automation_signals s where id = '80000000-0000-4000-8000-000000000991'
union all select 'accepted_proposal', to_jsonb(p) from public.automation_proposals p where id = '90000000-0000-4000-8000-000000000991'
union all select 'proposal_source', to_jsonb(l) from public.automation_proposal_sources l where proposal_id = '90000000-0000-4000-8000-000000000991';

-- Optional pre-migration proof: psql -v verify_observation_upgrade=1 -f <this file>.
-- It applies the actual migration after old-compatible fixtures/snapshots, then
-- rolls everything back at EOF. Normal pgTAP execution uses the applied schema.
\if :{?verify_observation_upgrade}
\ir ../../migrations/20260909202805_dated_collector_observations.sql
\endif

-- Fixture helpers only construct real INSERTs. Constraints and grants under test
-- belong to the actual tables; these invoker functions add no test-only bypass.
create function pg_temp.insert_dated_evidence(key text, checked date default '2026-09-01', tenant uuid default '20000000-0000-4000-8000-000000000991', source uuid default '30000000-0000-4000-8000-000000000991') returns void language sql as $$
insert into public.evidence (organisation_id, title, kind, description, collected_on, valid_until, source_id, external_ref, observation_key, created_by)
values (tenant, 'September observation', 'note', 'Two protected branches', checked, '2026-10-01', source, 'github:fictional/app:protected-branches', key, '10000000-0000-4000-8000-000000000991');
$$;
create function pg_temp.insert_dated_source(key text, checked date default '2026-09-01', tenant uuid default '20000000-0000-4000-8000-000000000991', connection uuid default '40000000-0000-4000-8000-000000000991') returns void language sql as $$
insert into public.source_objects (organisation_id, connection_id, external_ref, title, content_ref, content_hash, classification, expires_at, observation_key, collected_on)
values (tenant, connection, 'github:fictional/app:protected-branches', 'September observation', 'evidence://github:fictional/app:protected-branches', 'new-hash', 'metadata', '2026-10-01T00:00:00Z', key, checked);
$$;

set local role service_role;
select lives_ok($$select pg_temp.insert_dated_evidence('v1:' || repeat('a', 64))$$, 'a keyed evidence observation coexists with the legacy resource');
select lives_ok($$select pg_temp.insert_dated_source('v1:' || repeat('a', 64))$$, 'a keyed source observation coexists with the legacy resource');
select lives_ok($$select pg_temp.insert_dated_evidence('v1:' || repeat('b', 64), '2026-09-02')$$, 'later dated evidence is a separate record');
select lives_ok($$select pg_temp.insert_dated_source('v1:' || repeat('b', 64), '2026-09-02')$$, 'later dated source observation is a separate record');
select lives_ok($$select pg_temp.insert_dated_evidence('v1:' || repeat('c', 64))$$, 'different same-day evidence identity is retained');
select lives_ok($$select pg_temp.insert_dated_source('v1:' || repeat('c', 64))$$, 'different same-day source identity is retained');
select throws_ok($$select pg_temp.insert_dated_evidence('v1:' || repeat('a', 64))$$, '23505', null, 'an identical evidence retry cannot duplicate its observation');
select throws_ok($$select pg_temp.insert_dated_source('v1:' || repeat('a', 64))$$, '23505', null, 'an identical source retry cannot duplicate its observation');
select throws_ok($$select pg_temp.insert_dated_evidence(null)$$, '23505', null, 'legacy evidence still allows only one unkeyed resource record');
select throws_ok($$select pg_temp.insert_dated_source(null, null)$$, '23505', null, 'legacy source still allows only one unkeyed resource record');
select throws_ok($$select pg_temp.insert_dated_evidence('v1:' || repeat('A', 64))$$, '23514', null, 'evidence rejects noncanonical observation keys');
select throws_ok($$select pg_temp.insert_dated_source('v1:short')$$, '23514', null, 'source objects reject noncanonical observation keys');
select throws_ok($$select pg_temp.insert_dated_source('v1:' || repeat('d', 64), null)$$, '23514', null, 'keyed source observations require their recorded collection date');
select throws_ok($$select pg_temp.insert_dated_source(null, '2026-09-01')$$, '23514', null, 'unkeyed legacy source identity is not given an invented checked date');

select throws_ok($$update public.evidence set observation_key = 'v1:' || repeat('d', 64) where id = '50000000-0000-4000-8000-000000000991'$$, 'P0001', null, 'legacy evidence cannot be rewritten with a guessed identity');
select throws_ok($$update public.evidence set observation_key = 'v1:' || repeat('d', 64) where observation_key = 'v1:' || repeat('a', 64) and organisation_id = '20000000-0000-4000-8000-000000000991'$$, 'P0001', null, 'keyed evidence identity remains immutable');
select throws_ok($$update public.source_objects set observation_key = 'v1:' || repeat('d', 64), collected_on = '2026-09-01' where id = '60000000-0000-4000-8000-000000000991'$$, '42501', null, 'legacy source identity cannot be rewritten with a guessed observation');
select throws_ok($$update public.source_objects set observation_key = 'v1:' || repeat('d', 64) where observation_key = 'v1:' || repeat('a', 64) and organisation_id = '20000000-0000-4000-8000-000000000991'$$, '42501', null, 'keyed source identity remains immutable');
select throws_ok($$update public.source_objects set collected_on = '2026-09-03' where observation_key = 'v1:' || repeat('a', 64) and organisation_id = '20000000-0000-4000-8000-000000000991'$$, '42501', null, 'source checked date remains immutable');
select throws_ok($$update public.source_objects set external_ref = 'another-resource' where observation_key = 'v1:' || repeat('a', 64) and organisation_id = '20000000-0000-4000-8000-000000000991'$$, '42501', null, 'source resource identity remains immutable');
select throws_ok($$update public.source_objects set organisation_id = '20000000-0000-4000-8000-000000000992', connection_id = '40000000-0000-4000-8000-000000000992' where observation_key = 'v1:' || repeat('a', 64) and organisation_id = '20000000-0000-4000-8000-000000000991'$$, '42501', null, 'even a collector cannot move observations to another valid tenant/connection');
select lives_ok($$update public.evidence set status = 'expired' where observation_key = 'v1:' || repeat('a', 64) and organisation_id = '20000000-0000-4000-8000-000000000991'$$, 'existing evidence freshness transitions still work');
select lives_ok($$update public.source_objects set status = 'retained' where observation_key = 'v1:' || repeat('a', 64) and organisation_id = '20000000-0000-4000-8000-000000000991'$$, 'acceptance can still retain a source observation');
select lives_ok($$update public.source_objects set status = 'purged', purged_at = now(), content_ref = 'purged://new-hash' where observation_key = 'v1:' || repeat('b', 64) and organisation_id = '20000000-0000-4000-8000-000000000991'$$, 'existing retention purge can still replace only the content reference');

select throws_ok($$select pg_temp.insert_dated_evidence('v1:' || repeat('d', 64), '2026-09-01', '20000000-0000-4000-8000-000000000992')$$, '23503', null, 'keyed evidence cannot use another tenant source');
select throws_ok($$select pg_temp.insert_dated_source('v1:' || repeat('d', 64), '2026-09-01', '20000000-0000-4000-8000-000000000992')$$, '23503', null, 'keyed source observation cannot use another tenant connection');
select lives_ok($$select pg_temp.insert_dated_evidence('v1:' || repeat('a', 64), '2026-09-01', '20000000-0000-4000-8000-000000000992', '30000000-0000-4000-8000-000000000992')$$, 'the same observation key under a separate valid source is independent');
select lives_ok($$select pg_temp.insert_dated_source('v1:' || repeat('a', 64), '2026-09-01', '20000000-0000-4000-8000-000000000992', '40000000-0000-4000-8000-000000000992')$$, 'the same observation key under a separate valid connection is independent');

reset role;
select is((select to_jsonb(e) - 'observation_key' from public.evidence e where id = '50000000-0000-4000-8000-000000000991'), (select row_value from original_evidence), 'migration and later collection leave every original legacy evidence field unchanged');
select is((select to_jsonb(s) - array['observation_key', 'collected_on'] from public.source_objects s where id = '60000000-0000-4000-8000-000000000991'), (select row_value from original_source), 'migration and later collection leave every original legacy source field unchanged');
select ok((select observation_key is null from public.evidence where id = '50000000-0000-4000-8000-000000000991'), 'legacy evidence observation identity remains unknown');
select ok((select observation_key is null and collected_on is null from public.source_objects where id = '60000000-0000-4000-8000-000000000991'), 'legacy source observation identity and checked date remain unknown');
select results_eq(
  $$select 'task' as kind, to_jsonb(t) as row_value from public.tasks t where id = '70000000-0000-4000-8000-000000000991'
    union all select 'evidence_link', to_jsonb(l) from public.evidence_links l where id = '71000000-0000-4000-8000-000000000991'
    union all select 'signal', to_jsonb(s) from public.automation_signals s where id = '80000000-0000-4000-8000-000000000991'
    union all select 'accepted_proposal', to_jsonb(p) from public.automation_proposals p where id = '90000000-0000-4000-8000-000000000991'
    union all select 'proposal_source', to_jsonb(l) from public.automation_proposal_sources l where proposal_id = '90000000-0000-4000-8000-000000000991'
    order by kind$$,
  $$select kind, row_value from original_history order by kind$$,
  'migration and new observations preserve existing tasks, links, signals and accepted decisions byte-for-byte');
select is((select count(*) from public.evidence where organisation_id = '20000000-0000-4000-8000-000000000991'), 4::bigint, 'exactly one legacy and three distinct keyed evidence records remain');
select is((select count(*) from public.source_objects where organisation_id = '20000000-0000-4000-8000-000000000991'), 4::bigint, 'exactly one legacy and three distinct keyed source records remain');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000992","role":"authenticated"}', true);
select is((select count(*) from public.evidence where organisation_id = '20000000-0000-4000-8000-000000000991'), 0::bigint, 'another workspace cannot read the observation evidence');
select is((select count(*) from public.source_objects where organisation_id = '20000000-0000-4000-8000-000000000991'), 0::bigint, 'another workspace cannot read the source observation metadata');
select is((select count(*) from public.source_objects where organisation_id = '20000000-0000-4000-8000-000000000992' and observation_key is not null), 1::bigint, 'existing authorised reads include own-workspace observation metadata');
select throws_ok($$update public.source_objects set collected_on = '2026-09-03' where organisation_id = '20000000-0000-4000-8000-000000000992'$$, '42501', null, 'authenticated users gain no source observation mutation grant');
select throws_ok($$update public.evidence set observation_key = null where organisation_id = '20000000-0000-4000-8000-000000000992'$$, '42501', null, 'authenticated users gain no evidence identity mutation grant');

-- Provenance is server-owned even though operators may insert manual evidence.
-- Check each protected attribute so a partial forged record cannot bypass the
-- guard. Current database role, not an editable request claim, is authoritative.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000991","role":"authenticated"}', true);
select throws_ok($$select pg_temp.insert_dated_evidence('v1:' || repeat('d', 64))$$, '42501', 'Collector evidence provenance is server-managed', 'Owner cannot insert forged keyed collector evidence');
select throws_ok(
  $$insert into public.evidence (organisation_id, title, kind, created_by, source_id) values ('20000000-0000-4000-8000-000000000991', 'Forged source only', 'note', '10000000-0000-4000-8000-000000000991', '30000000-0000-4000-8000-000000000991')$$,
  '42501', 'Collector evidence provenance is server-managed', 'Owner cannot supply only a collector source');
select throws_ok(
  $$insert into public.evidence (organisation_id, title, kind, created_by, external_ref) values ('20000000-0000-4000-8000-000000000991', 'Forged reference only', 'note', '10000000-0000-4000-8000-000000000991', 'forged-ref')$$,
  '42501', 'Collector evidence provenance is server-managed', 'Owner cannot supply only a collector reference');
select throws_ok(
  $$insert into public.evidence (organisation_id, title, kind, created_by, observation_key) values ('20000000-0000-4000-8000-000000000991', 'Forged key only', 'note', '10000000-0000-4000-8000-000000000991', 'v1:' || repeat('d', 64))$$,
  '42501', 'Collector evidence provenance is server-managed', 'Owner cannot supply only an observation key');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000991","role":"service_role"}', true);
select throws_ok($$select pg_temp.insert_dated_evidence('v1:' || repeat('d', 64))$$, '42501', 'Collector evidence provenance is server-managed', 'a forged service-role claim does not change the authenticated database role');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000991","role":"authenticated"}', true);
select lives_ok(
  $$insert into public.evidence (organisation_id, title, kind, created_by) values ('20000000-0000-4000-8000-000000000991', 'Owner manual evidence', 'note', '10000000-0000-4000-8000-000000000991')$$,
  'Owner can still create ordinary manual evidence');
select ok((select source_id is null and external_ref is null and observation_key is null from public.evidence where organisation_id = '20000000-0000-4000-8000-000000000991' and title = 'Owner manual evidence'), 'manual evidence carries no collector attribution');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000993","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.evidence (organisation_id, title, kind, created_by, source_id, external_ref, observation_key) values ('20000000-0000-4000-8000-000000000991', 'Member forged evidence', 'note', '10000000-0000-4000-8000-000000000993', '30000000-0000-4000-8000-000000000991', 'member-forged-ref', 'v1:' || repeat('d', 64))$$,
  '42501', 'Collector evidence provenance is server-managed', 'Member cannot insert forged collector provenance');
select throws_ok(
  $$insert into public.evidence (organisation_id, title, kind, created_by) values ('20000000-0000-4000-8000-000000000991', 'Member manual evidence', 'note', '10000000-0000-4000-8000-000000000993')$$,
  '42501', null, 'Member direct manual evidence restriction remains unchanged');

-- Existing trusted review writes still work through their actual authorised RPC.
reset role;
insert into public.automation_proposals (id, organisation_id, target_type, assigned_to, created_by, input_snapshot, output, source_references) values
('90000000-0000-4000-8000-000000000993', '20000000-0000-4000-8000-000000000991', 'evidence', '10000000-0000-4000-8000-000000000991', '10000000-0000-4000-8000-000000000991', '{}', '{"title":"Trusted review evidence","why":"Fictional review"}', '[]');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000991","role":"authenticated"}', true);
select lives_ok($$select public.review_automation_proposal('90000000-0000-4000-8000-000000000993', 'accepted', null)$$, 'existing security-definer review still creates its permitted evidence');
select is((select count(*) from public.evidence where organisation_id = '20000000-0000-4000-8000-000000000991' and title = 'Trusted review evidence' and source_id is null and external_ref is null and observation_key is null), 1::bigint, 'review-created evidence remains separate from provider provenance');

reset role;
select * from finish();
rollback;
