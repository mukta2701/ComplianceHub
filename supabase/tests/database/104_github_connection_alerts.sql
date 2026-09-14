begin;
select no_plan();

select has_table(
  'public', 'github_connection_incidents',
  'GitHub installation incidents are durable records'
);
select has_column('public', 'alert_deliveries', 'github_installation_id', 'Slack deliveries retain GitHub installation ancestry');
select has_function(
  'public', 'project_github_connection_notice_server',
  array['uuid','uuid','text','text','text','timestamp with time zone']
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.github_connection_incidents'::regclass
      and conname = 'github_connection_incidents_installation_tenant_fk'
      and contype = 'f'
  ),
  'incidents bind installation and workspace ancestry'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'github_connection_incidents'
      and indexname = 'github_connection_incidents_one_open_diagnostic'
      and indexdef like '%WHERE (resolved_at IS NULL)%'
  ),
  'only one open incident exists for an installation diagnostic'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.project_github_connection_notice_server(uuid,uuid,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'the service boundary may replay the safe projection idempotently'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.project_github_connection_notice_server(uuid,uuid,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated users cannot forge connection notices'
);
select ok(
  not has_table_privilege('authenticated', 'public.github_connection_incidents', 'INSERT,UPDATE,DELETE'),
  'authenticated users cannot forge or resolve incidents'
);
select ok(
  not has_table_privilege('service_role', 'public.github_connection_incidents', 'INSERT,UPDATE,DELETE'),
  'service workers cannot bypass the atomic projection boundary'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('b6000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'github-alert-owner@example.test', '', now(), '{}', '{}'),
  ('b6000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'github-alert-admin@example.test', '', now(), '{}', '{}'),
  ('b6000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'github-alert-member@example.test', '', now(), '{}', '{}'),
  ('b6000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'github-alert-other@example.test', '', now(), '{}', '{}');
insert into public.organisations(id, name, slug, created_by) values
  ('b6100000-0000-4000-8000-000000000001', 'GitHub alert workspace', 'github-alert-workspace', 'b6000000-0000-4000-8000-000000000001'),
  ('b6100000-0000-4000-8000-000000000002', 'Other GitHub alert workspace', 'other-github-alert-workspace', 'b6000000-0000-4000-8000-000000000004');
insert into public.memberships(organisation_id, user_id, role) values
  ('b6100000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001', 'owner'),
  ('b6100000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000002', 'admin'),
  ('b6100000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000003', 'member'),
  ('b6100000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000004', 'owner');
insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status, connected_by, permissions,
  permissions_ok, health, next_reconciliation_at
) values
  ('b6200000-0000-4000-8000-000000000001', 'b6100000-0000-4000-8000-000000000001', 860001, 870001, 'Alert-Company', 'Organization', 'selected', 'active', 'b6000000-0000-4000-8000-000000000001', '{"metadata":"read"}', true, 'healthy', now() + interval '1 day'),
  ('b6200000-0000-4000-8000-000000000002', 'b6100000-0000-4000-8000-000000000002', 860002, 870002, 'No-Slack-Company', 'Organization', 'selected', 'active', 'b6000000-0000-4000-8000-000000000004', '{"metadata":"read"}', true, 'healthy', now() + interval '1 day'),
  ('b6200000-0000-4000-8000-000000000003', 'b6100000-0000-4000-8000-000000000001', 860003, 870003, 'Retry-Company', 'Organization', 'selected', 'active', 'b6000000-0000-4000-8000-000000000001', '{"metadata":"read"}', true, 'healthy', now() + interval '1 day');
insert into public.alert_channels(
  id, organisation_id, type, label, config, min_severity, connected_by, enabled
) values (
  'b6300000-0000-4000-8000-000000000001',
  'b6100000-0000-4000-8000-000000000001',
  'slack', 'GitHub incidents', '{}', 'high',
  'b6000000-0000-4000-8000-000000000001', true
);

create temporary table github_alert_compliance_counts as
select
  (select count(*) from public.evidence) as evidence_count,
  (select count(*) from public.tasks) as task_count,
  (select count(*) from public.monitoring_findings) as finding_count,
  (select count(*) from public.audit_findings) as audit_finding_count,
  (select count(*) from public.automation_signals) as signal_count,
  (select count(*) from public.automation_proposals) as proposal_count;

create or replace function pg_temp.prepare_alert_run(
  run_id uuid,
  organisation_id uuid,
  installation_id uuid,
  worker_id uuid,
  attempted_at timestamptz,
  request_key text
)
returns void
language plpgsql
as $$
begin
  update public.github_installations
  set reconciliation_locked_by = worker_id,
      reconciliation_locked_until = now() + interval '5 minutes',
      last_reconciliation_attempt_at = attempted_at
  where id = installation_id and github_installations.organisation_id = prepare_alert_run.organisation_id;
  insert into public.github_connection_reconciliation_runs(
    id, organisation_id, installation_id, reconciliation_version, trigger,
    request_key, status, started_at, last_attempted_at
  ) values (
    run_id, organisation_id, installation_id, 1, 'scheduled',
    request_key, 'running', attempted_at, attempted_at
  );
end;
$$;

select pg_temp.prepare_alert_run(
  'b6400000-0000-4000-8000-000000000001',
  'b6100000-0000-4000-8000-000000000001',
  'b6200000-0000-4000-8000-000000000001',
  'b6500000-0000-4000-8000-000000000001',
  '2026-09-14T12:00:00Z', 'alert-serious-open'
);
set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    'b6400000-0000-4000-8000-000000000001',
    'b6500000-0000-4000-8000-000000000001',
    'action_required', 'permission_mismatch', null, '[]'::jsonb
  ) ->> 'incidentTransition',
  'opened',
  'a serious access failure opens immediately'
);
reset role;

select is((select count(*)::integer from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000001' and resolved_at is null), 1, 'the opening transition creates one durable open incident');
select is((select diagnostic_code from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000001' and resolved_at is null), 'permission_mismatch', 'the incident stores only the safe diagnostic');
select is((select last_observed_at from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000001' and resolved_at is null), '2026-09-14T12:00:00Z'::timestamptz, 'the incident records the authoritative occurrence time');
select is((select count(*)::integer from public.notifications where organisation_id = 'b6100000-0000-4000-8000-000000000001' and kind = 'github_connection_incident'), 2, 'current Owner and Admin receive one in-app incident notice');
select is((select count(*)::integer from public.notifications where user_id = 'b6000000-0000-4000-8000-000000000003' and kind = 'github_connection_incident'), 0, 'a Member receives no connection incident notice');
select is((select count(*)::integer from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000001'), 1, 'one Slack incident is queued for the active destination');
select is((select subject_type from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000001'), 'github_installation', 'Slack uses the distinct GitHub installation subject');
select ok((select connection_id is null and target_id is null from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000001'), 'GitHub ancestry never masquerades as an integration connection');
select is((select safe_payload ->> 'subjectId' from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000001'), 'Alert-Company', 'the Slack payload contains only the safe account name as subject');
select ok((select safe_payload ->> 'detail' like '%2026-09-14T12:00:00.000Z%/app/integrations%' from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000001'), 'the Slack payload contains the occurrence and authenticated connection path');
select ok((select (select count(*) from pg_catalog.jsonb_object_keys(delivery.safe_payload)) = 6 from public.alert_deliveries delivery where github_installation_id = 'b6200000-0000-4000-8000-000000000001'), 'the Slack payload has only the bounded safe contract fields');
select ok((select safe_payload::text !~* '(token|secret|credential|stack|aws|repository|webhook)' from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000001'), 'the Slack payload excludes forbidden provider, repository, stack and infrastructure data');

set local role service_role;
select is(
  public.project_github_connection_notice_server(
    'b6100000-0000-4000-8000-000000000001',
    'b6200000-0000-4000-8000-000000000001',
    'incident', 'owner_action_required', 'permission_mismatch',
    '2026-09-14T12:00:00Z'
  ),
  jsonb_build_object('inAppQueued', 0, 'slackQueued', 0),
  'replaying an already projected transition is idempotent'
);
reset role;
select is((select count(*)::integer from public.notifications where organisation_id = 'b6100000-0000-4000-8000-000000000001' and kind = 'github_connection_incident'), 2, 'a replay does not duplicate in-app notices');
select is((select count(*)::integer from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000001'), 1, 'a replay does not duplicate Slack delivery');

select pg_temp.prepare_alert_run(
  'b6400000-0000-4000-8000-000000000002',
  'b6100000-0000-4000-8000-000000000001',
  'b6200000-0000-4000-8000-000000000001',
  'b6500000-0000-4000-8000-000000000002',
  '2026-09-14T12:15:00Z', 'alert-serious-repeat'
);
set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    'b6400000-0000-4000-8000-000000000002',
    'b6500000-0000-4000-8000-000000000002',
    'action_required', 'permission_mismatch', null, '[]'::jsonb
  ) ->> 'incidentTransition',
  'remained_open',
  'a repeated observation remains open'
);
reset role;
select is((select count(*)::integer from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000001' and resolved_at is null), 1, 'a repeated observation preserves one open incident');
select is((select last_observed_at from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000001' and resolved_at is null), '2026-09-14T12:15:00Z'::timestamptz, 'a repeated observation advances last observed time');
select is((select count(*)::integer from public.notifications where organisation_id = 'b6100000-0000-4000-8000-000000000001' and kind = 'github_connection_incident'), 2, 'a repeated observation creates no repeated in-app notice');
select is((select count(*)::integer from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000001'), 1, 'a repeated observation creates no repeated Slack notice');

select pg_temp.prepare_alert_run(
  'b6400000-0000-4000-8000-000000000003',
  'b6100000-0000-4000-8000-000000000001',
  'b6200000-0000-4000-8000-000000000001',
  'b6500000-0000-4000-8000-000000000003',
  '2026-09-14T13:00:00Z', 'alert-recovery'
);
set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    'b6400000-0000-4000-8000-000000000003',
    'b6500000-0000-4000-8000-000000000003',
    'success', null, '2026-09-15T13:00:00Z', '[]'::jsonb
  ) ->> 'incidentTransition',
  'recovered',
  'only verified provider success recovers the open incident'
);
reset role;
select is((select resolved_at from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000001'), '2026-09-14T13:00:00Z'::timestamptz, 'verified recovery resolves the incident once');
select is((select count(*)::integer from public.notifications where organisation_id = 'b6100000-0000-4000-8000-000000000001' and kind = 'github_connection_recovery'), 2, 'current Owner and Admin receive one recovery notice');
select is((select count(*)::integer from public.notifications where user_id = 'b6000000-0000-4000-8000-000000000003' and kind = 'github_connection_recovery'), 0, 'a Member receives no recovery notice');
select is((select count(*)::integer from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000001' and safe_payload ->> 'title' = 'GitHub connection recovered'), 1, 'one matching Slack recovery is queued');
select is((select count(distinct idempotency_key)::integer from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000001'), 2, 'incident and recovery use deterministic distinct idempotency identities');

select pg_temp.prepare_alert_run(
  'b6400000-0000-4000-8000-000000000011',
  'b6100000-0000-4000-8000-000000000001',
  'b6200000-0000-4000-8000-000000000003',
  'b6500000-0000-4000-8000-000000000011',
  '2026-09-14T13:01:00Z', 'alert-temporary-one'
);
set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    'b6400000-0000-4000-8000-000000000011',
    'b6500000-0000-4000-8000-000000000011',
    'temporary_failure', 'provider_temporary_failure',
    '2026-09-14T13:02:00Z', '[]'::jsonb
  ) ->> 'incidentTransition',
  'none',
  'a one-off temporary failure stays quiet'
);
reset role;
select is((select count(*)::integer from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000003'), 0, 'one temporary failure creates no incident');

select pg_temp.prepare_alert_run(
  'b6400000-0000-4000-8000-000000000012',
  'b6100000-0000-4000-8000-000000000001',
  'b6200000-0000-4000-8000-000000000003',
  'b6500000-0000-4000-8000-000000000012',
  '2026-09-14T13:06:00Z', 'alert-temporary-two'
);
set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    'b6400000-0000-4000-8000-000000000012',
    'b6500000-0000-4000-8000-000000000012',
    'temporary_failure', 'provider_temporary_failure',
    '2026-09-14T13:11:00Z', '[]'::jsonb
  ) ->> 'incidentTransition',
  'none',
  'a second temporary failure remains below the alert threshold'
);
reset role;
select is((select count(*)::integer from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000003'), 0, 'two temporary failures create no incident or notice');

select pg_temp.prepare_alert_run(
  'b6400000-0000-4000-8000-000000000013',
  'b6100000-0000-4000-8000-000000000001',
  'b6200000-0000-4000-8000-000000000003',
  'b6500000-0000-4000-8000-000000000013',
  '2026-09-14T13:26:00Z', 'alert-temporary-three'
);
set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    'b6400000-0000-4000-8000-000000000013',
    'b6500000-0000-4000-8000-000000000013',
    'temporary_failure', 'provider_temporary_failure',
    '2026-09-14T13:41:00Z', '[]'::jsonb
  ) ->> 'incidentTransition',
  'opened',
  'the third consecutive temporary failure opens through the atomic threshold transition'
);
reset role;
select is((select count(*)::integer from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000003' and resolved_at is null), 1, 'the persistent temporary failure creates one open incident');
select is((select count(*)::integer from public.notifications where subject_type = 'github_installation' and subject_id = (select id::text from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000003')), 2, 'only the threshold transition queues Owner/Admin in-app notices');
select is((select count(*)::integer from public.alert_deliveries where github_installation_id = 'b6200000-0000-4000-8000-000000000003'), 1, 'only the threshold transition queues one Slack notice');

select pg_temp.prepare_alert_run(
  'b6400000-0000-4000-8000-000000000004',
  'b6100000-0000-4000-8000-000000000002',
  'b6200000-0000-4000-8000-000000000002',
  'b6500000-0000-4000-8000-000000000004',
  '2026-09-14T14:00:00Z', 'alert-no-slack'
);
set local role service_role;
select is(
  public.finalize_github_connection_reconciliation_server(
    'b6400000-0000-4000-8000-000000000004',
    'b6500000-0000-4000-8000-000000000004',
    'disconnected', 'installation_revoked', null, '[]'::jsonb
  ) ->> 'incidentTransition',
  'opened',
  'a disconnected installation opens immediately without a Slack destination'
);
reset role;
select is((select count(*)::integer from public.github_connection_incidents where installation_id = 'b6200000-0000-4000-8000-000000000002' and resolved_at is null), 1, 'missing Slack does not lose incident truth');
select is((select count(*)::integer from public.notifications where organisation_id = 'b6100000-0000-4000-8000-000000000002' and kind = 'github_connection_incident'), 1, 'missing Slack does not lose the Owner in-app notice');
select is((select count(*)::integer from public.alert_deliveries where organisation_id = 'b6100000-0000-4000-8000-000000000002'), 0, 'missing Slack creates no unsafe placeholder delivery');

set local role service_role;
select throws_ok(
  $$ select public.project_github_connection_notice_server(
       'b6100000-0000-4000-8000-000000000002',
       'b6200000-0000-4000-8000-000000000001',
       'incident', 'owner_action_required', 'permission_mismatch',
       '2026-09-14T12:00:00Z'
     ) $$,
  '22023', 'GitHub connection alert input is invalid',
  'cross-workspace installation projection is rejected'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b6000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_connection_incidents), 2, 'an Owner can inspect only their workspace incident history');
select set_config('request.jwt.claims', '{"sub":"b6000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_connection_incidents), 2, 'an Admin can inspect safe incident history');
select set_config('request.jwt.claims', '{"sub":"b6000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*)::integer from public.github_connection_incidents), 0, 'a Member cannot inspect connection incidents');
reset role;

select is(
  (select row(evidence_count, task_count, finding_count, audit_finding_count, signal_count, proposal_count) from github_alert_compliance_counts),
  row(
    (select count(*) from public.evidence),
    (select count(*) from public.tasks),
    (select count(*) from public.monitoring_findings),
    (select count(*) from public.audit_findings),
    (select count(*) from public.automation_signals),
    (select count(*) from public.automation_proposals)
  ),
  'connection incidents create no Evidence, Task, Finding, readiness or Automation outcome'
);
select ok((select count(*) >= 3 from public.audit_events where entity_type = 'github_connection_incidents' and organisation_id = 'b6100000-0000-4000-8000-000000000001'), 'incident opening, observation and resolution preserve audit history');

select * from finish();
rollback;
