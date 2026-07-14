begin;

select plan(52);

-- The inventory is intentionally explicit. Adding an organisation-scoped public
-- table without classifying it here must fail this suite instead of silently
-- inheriting an unsafe default.
select is(
  (
    select pg_catalog.string_agg(c.relname, ',' order by c.relname)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and a.attname = 'organisation_id'
      and a.attnum > 0
      and not a.attisdropped
  ),
  'alert_channels,assessment_responses,assessment_sessions,asset_categories,asset_risks,assets,audit_checklist_items,audit_events,audit_findings,auditor_access_log,auditor_access_tokens,audits,control_crosswalks,evidence,evidence_links,evidence_sources,integration_connections,invitations,kpi_measurements,kpis,leadership_report_snapshots,memberships,monitor_sources,monitoring_findings,notifications,policies,policy_acceptances,policy_feedback_comments,policy_feedback_threads,risk_categories,risk_matrix_config,risk_treatment_plans,risks,soa_items,soa_registers,soa_snapshots,task_tickets,tasks,trust_center_settings',
  'every organisation-scoped public table is present in the reviewed access inventory'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(array[
        'alert_channels', 'assessment_responses', 'assessment_sessions',
        'asset_categories', 'asset_risks', 'assets', 'audit_checklist_items',
        'audit_findings', 'auditor_access_tokens', 'audits',
        'control_crosswalks', 'evidence', 'evidence_links', 'evidence_sources',
        'integration_connections', 'kpi_measurements', 'kpis', 'monitor_sources',
        'monitoring_findings', 'policies', 'risk_categories',
        'risk_matrix_config', 'risk_treatment_plans', 'risks', 'soa_items',
        'soa_registers', 'soa_snapshots', 'task_tickets', 'tasks',
        'trust_center_settings'
      ])
      and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and (
        coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
      ) not like '%is_organisation_operator%'
  ),
  0::bigint,
  'every operational mutation policy is explicitly operator-gated'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(array[
        'alert_channels', 'assessment_responses', 'assessment_sessions',
        'asset_categories', 'asset_risks', 'assets', 'audit_checklist_items',
        'audit_findings', 'auditor_access_tokens', 'audits',
        'control_crosswalks', 'evidence', 'evidence_links', 'evidence_sources',
        'integration_connections', 'kpi_measurements', 'kpis', 'monitor_sources',
        'monitoring_findings', 'policies', 'risk_categories',
        'risk_matrix_config', 'risk_treatment_plans', 'risks', 'soa_items',
        'soa_registers', 'soa_snapshots', 'task_tickets', 'tasks',
        'trust_center_settings'
      ])
      and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  ),
  74::bigint,
  'the reviewed operational mutation policy inventory cannot pass by removing policies'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.cmd = 'INSERT'
      and coalesce(p.with_check, '') not like '%is_organisation_operator%'
  ),
  0::bigint,
  'evidence uploads are operator-only'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.cmd = 'INSERT'
      and coalesce(p.with_check, '') like '%is_organisation_operator%'
  ),
  1::bigint,
  'the operator evidence-upload policy remains installed'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and (p.tablename, p.policyname) in (
        ('memberships', 'memberships_update_delegated'),
        ('invitations', 'invitations_select_operators'),
        ('notifications', 'notifications_update_own')
      )
  ),
  3::bigint,
  'delegated membership, invitation, and own-notification lifecycle policies remain installed'
);

select is(
  (
    select count(*)
    from (values
      ('public.create_organisation_with_owner(text,text)'::pg_catalog.regprocedure),
      ('public.accept_invitation(text)'::pg_catalog.regprocedure)
    ) as lifecycle(function_oid)
    where pg_catalog.has_function_privilege('authenticated', lifecycle.function_oid, 'execute')
  ),
  2::bigint,
  'authenticated onboarding and invitation-acceptance lifecycle RPCs remain callable'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'complete_recurring_task', 'create_evidence_record', 'create_soa_draft',
        'create_soa_successor', 'finalise_soa', 'notify_policy_reaccept',
        'save_assessment_response'
      ])
      and pg_catalog.pg_get_functiondef(p.oid) not like '%is_organisation_operator%'
  ),
  0::bigint,
  'authenticated operational mutation RPCs perform an operator check'
);

select function_returns('public', 'accept_policy', array['uuid'], 'uuid');
select ok(
  (select p.prosecdef from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.accept_policy(uuid)')),
  'accept_policy is SECURITY DEFINER'
);
select is(
  (select pg_catalog.pg_get_userbyid(p.proowner) from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.accept_policy(uuid)')),
  'postgres',
  'accept_policy has the expected trusted owner'
);
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid = pg_catalog.to_regprocedure('public.accept_policy(uuid)')),
  'accept_policy pins an empty search path'
);
select ok(not pg_catalog.has_function_privilege('anon', pg_catalog.to_regprocedure('public.accept_policy(uuid)'), 'execute'), 'anon cannot execute accept_policy');
select ok(pg_catalog.has_function_privilege('authenticated', pg_catalog.to_regprocedure('public.accept_policy(uuid)'), 'execute'), 'authenticated may invoke the guarded accept_policy RPC');
select ok(pg_catalog.has_table_privilege('authenticated', 'public.policy_acceptances', 'select'), 'authenticated can select policy acceptances through RLS');
select ok(not pg_catalog.has_table_privilege('anon', 'public.policy_acceptances', 'insert'), 'anon cannot insert policy acceptances directly');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.policy_acceptances', 'insert'), 'authenticated cannot insert policy acceptances directly');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.policy_acceptances', 'update'), 'authenticated cannot update policy acceptances directly');
select ok(not pg_catalog.has_table_privilege('authenticated', 'public.policy_acceptances', 'delete'), 'authenticated cannot delete policy acceptances directly');

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('77000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'access-owner-a@example.test', '', now(), '{}', '{}'),
  ('77000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'access-admin-a@example.test', '', now(), '{}', '{}'),
  ('77000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'access-member-a@example.test', '', now(), '{}', '{}'),
  ('77000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'access-owner-b@example.test', '', now(), '{}', '{}'),
  ('77000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'access-unverified@example.test', '', null, '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000001","email":"access-owner-a@example.test","role":"authenticated"}', true);
select set_config('app.access_org_a', public.create_organisation_with_owner('Access Org A', 'access-org-a')::text, true);
insert into public.memberships(organisation_id, user_id, role) values
  (current_setting('app.access_org_a')::uuid, '77000000-0000-4000-8000-000000000002', 'admin'),
  (current_setting('app.access_org_a')::uuid, '77000000-0000-4000-8000-000000000003', 'member'),
  (current_setting('app.access_org_a')::uuid, '77000000-0000-4000-8000-000000000005', 'member');

select lives_ok(
  $$ insert into public.policies(id, organisation_id, reference, title, body, version, status, created_by)
     values
       ('77000000-0000-4000-8000-000000000101', current_setting('app.access_org_a')::uuid, 'PUB-001', 'Published policy', 'approved body', 3, 'approved', '77000000-0000-4000-8000-000000000001'),
       ('77000000-0000-4000-8000-000000000102', current_setting('app.access_org_a')::uuid, 'DRF-001', 'Draft policy', 'draft body', 8, 'draft', '77000000-0000-4000-8000-000000000001') $$,
  'an owner can author operational policy rows'
);
select lives_ok(
  $$ update public.policies set title = 'Published policy updated' where id = '77000000-0000-4000-8000-000000000101' $$,
  'an owner can update operational policy rows'
);

select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000004","email":"access-owner-b@example.test","role":"authenticated"}', true);
select set_config('app.access_org_b', public.create_organisation_with_owner('Access Org B', 'access-org-b')::text, true);
insert into public.policies(id, organisation_id, reference, title, body, version, status, created_by)
values ('77000000-0000-4000-8000-000000000103', current_setting('app.access_org_b')::uuid, 'PUB-002', 'Other tenant policy', 'other', 2, 'approved', '77000000-0000-4000-8000-000000000004');

select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000002","email":"access-admin-a@example.test","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.integration_connections(id, organisation_id, provider, label, connected_by)
     values ('77000000-0000-4000-8000-000000000201', current_setting('app.access_org_a')::uuid, 'github', 'Admin GitHub', '77000000-0000-4000-8000-000000000002') $$,
  'an admin can manage a connection'
);
select lives_ok(
  $$ insert into public.alert_channels(id, organisation_id, type, label, connected_by)
     values ('77000000-0000-4000-8000-000000000202', current_setting('app.access_org_a')::uuid, 'in_app', 'Admin alerts', '77000000-0000-4000-8000-000000000002') $$,
  'an admin can manage an alert channel'
);
select is((select count(*) from public.integration_connections where organisation_id = current_setting('app.access_org_a')::uuid), 1::bigint, 'admin can read connection configuration');
select is((select count(*) from public.alert_channels where organisation_id = current_setting('app.access_org_a')::uuid), 1::bigint, 'admin can read alert-channel configuration');

set local role postgres;
insert into public.monitor_sources(id, organisation_id, provider, label, connected_by)
values ('77000000-0000-4000-8000-000000000203', current_setting('app.access_org_a')::uuid, 'github', 'Sensitive monitor', '77000000-0000-4000-8000-000000000001');
insert into public.evidence_sources(id, organisation_id, provider, label, connected_by)
values ('77000000-0000-4000-8000-000000000204', current_setting('app.access_org_a')::uuid, 'github', 'Sensitive evidence source', '77000000-0000-4000-8000-000000000001');
insert into public.tasks(id, organisation_id, title, due_on, recurrence, created_by)
values ('77000000-0000-4000-8000-000000000301', current_setting('app.access_org_a')::uuid, 'Recurring task', current_date, 'weekly', '77000000-0000-4000-8000-000000000001');
insert into public.assessment_sessions(id, organisation_id, catalogue_version_id, title, created_by)
select '77000000-0000-4000-8000-000000000302', current_setting('app.access_org_a')::uuid, id, 'Member bypass target', '77000000-0000-4000-8000-000000000001'
from public.catalogue_versions where published_at is not null order by created_at limit 1;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000003","email":"access-member-a@example.test","role":"authenticated"}', true);

select results_eq(
  $$ select title from public.policies order by title $$,
  $$ values ('Published policy updated'::text) $$,
  'a member sees only approved policies in their tenant'
);
select is(
  (select count(*) from public.integration_connections)
  + (select count(*) from public.monitor_sources)
  + (select count(*) from public.evidence_sources)
  + (select count(*) from public.alert_channels),
  0::bigint,
  'a member cannot read sensitive connection, source, or alert configuration'
);
select throws_ok(
  $$ insert into public.policies(organisation_id, reference, title, created_by)
     values (current_setting('app.access_org_a')::uuid, 'FORGED', 'Forged policy', '77000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'a member cannot insert operational policy data'
);
select lives_ok(
  $$ update public.policies set title = 'Forged edit' where id = '77000000-0000-4000-8000-000000000101' $$,
  'a denied member policy update is a safe no-op'
);
select is(
  (select title from public.policies where id = '77000000-0000-4000-8000-000000000101'),
  'Published policy updated',
  'a member cannot update operational policy data'
);
select results_eq(
  $$ delete from public.policies where id = '77000000-0000-4000-8000-000000000101' returning id $$,
  $$ select null::uuid where false $$,
  'a member cannot delete operational policy data'
);
select throws_ok(
  $$ insert into public.policy_acceptances(organisation_id, policy_id, user_id, accepted_version, accepted_at)
     values (current_setting('app.access_org_a')::uuid, '77000000-0000-4000-8000-000000000101', '77000000-0000-4000-8000-000000000003', 999, '2000-01-01') $$,
  '42501', null, 'a member cannot forge a direct acceptance insert'
);
select throws_ok($$ update public.policy_acceptances set accepted_version = 999 $$, '42501', null, 'a member cannot forge a direct acceptance update');
select throws_ok($$ delete from public.policy_acceptances $$, '42501', null, 'a member cannot delete acceptance history directly');
select lives_ok($$ select public.accept_policy('77000000-0000-4000-8000-000000000101') $$, 'a verified member can accept an approved policy');
select results_eq(
  $$ select organisation_id, policy_id, user_id, accepted_version from public.policy_acceptances $$,
  $$ values (
    current_setting('app.access_org_a')::uuid,
    '77000000-0000-4000-8000-000000000101'::uuid,
    '77000000-0000-4000-8000-000000000003'::uuid,
    3
  ) $$,
  'accept_policy derives tenant, user, and version from authoritative rows'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000001","email":"access-owner-a@example.test","role":"authenticated"}', true);
update public.policies set body = 'approved body, revised' where id = '77000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000003","email":"access-member-a@example.test","role":"authenticated"}', true);
select lives_ok($$ select public.accept_policy('77000000-0000-4000-8000-000000000101') $$, 're-accepting is idempotent and refreshes the authoritative version');
select results_eq(
  $$ select count(*)::bigint, max(accepted_version)::integer from public.policy_acceptances $$,
  $$ values (1::bigint, 4::integer) $$,
  're-accept uses one row and the current authoritative policy version'
);
select throws_ok($$ select public.accept_policy('77000000-0000-4000-8000-000000000102') $$, '42501', 'policy is not available for acceptance', 'a member cannot accept a draft policy');
select throws_ok($$ select public.accept_policy('77000000-0000-4000-8000-000000000103') $$, '42501', 'policy is not available for acceptance', 'a member cannot accept another tenant policy');
select throws_ok($$ select public.notify_policy_reaccept('77000000-0000-4000-8000-000000000101', '') $$, '42501', 'not an operator of the policy organisation', 'member cannot bypass policy notification writes');
select throws_ok($$ select public.create_soa_draft('77000000-0000-4000-8000-000000000302', 'Bypass') $$, '42501', 'assessment not found', 'member cannot bypass SoA writes through create_soa_draft');
select throws_ok(
  $$ select public.save_assessment_response(
       '77000000-0000-4000-8000-000000000302',
       (select q.id from public.catalogue_questions q join public.assessment_sessions s on s.catalogue_version_id = q.catalogue_version_id where s.id = '77000000-0000-4000-8000-000000000302' order by q.position limit 1),
       'yes', '', 0
     ) $$,
  '42501', 'assessment not found', 'member cannot bypass assessment writes through save_assessment_response'
);
select throws_ok($$ select public.complete_recurring_task('77000000-0000-4000-8000-000000000301') $$, '42501', 'only workspace operators can complete recurring tasks', 'member cannot bypass task writes through complete_recurring_task');
select throws_ok(
  $$ select public.create_evidence_record(jsonb_build_object(
       'organisation_id', current_setting('app.access_org_a'), 'title', 'Forged evidence',
       'kind', 'note', 'description', '', 'collected_on', current_date, 'status', 'current'
     )) $$,
  '42501', 'only workspace operators can create evidence', 'member cannot bypass evidence writes through create_evidence_record'
);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id, provider, connected_by)
     values (current_setting('app.access_org_a')::uuid, 'jira', '77000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'a member cannot manage connections'
);

select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000005","email":"access-unverified@example.test","role":"authenticated"}', true);
select throws_ok($$ select public.accept_policy('77000000-0000-4000-8000-000000000101') $$, '42501', 'verified authentication required', 'an unverified member cannot accept a policy');

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.accept_policy('77000000-0000-4000-8000-000000000101') $$, '42501', 'verified authentication required', 'an authenticated request without a user cannot accept a policy');

select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000001","email":"access-owner-a@example.test","role":"authenticated"}', true);
select lives_ok($$ select public.accept_policy('77000000-0000-4000-8000-000000000101') $$, 'an operator can also acknowledge an approved policy');
select is((select count(*) from public.policy_acceptances), 2::bigint, 'operators can read organisation-wide acceptance reporting');

select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000003","email":"access-member-a@example.test","role":"authenticated"}', true);
select is((select count(*) from public.policy_acceptances), 1::bigint, 'members can read only their own acceptance');

select set_config('request.jwt.claims', '{"sub":"77000000-0000-4000-8000-000000000004","email":"access-owner-b@example.test","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.integration_connections(organisation_id, provider, connected_by)
     values (current_setting('app.access_org_a')::uuid, 'jira', '77000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'an operator cannot manage another tenant connection'
);

select * from finish();
rollback;
