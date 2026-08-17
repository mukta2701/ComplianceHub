begin;
select no_plan();

select has_column(
  'public', 'github_repository_shadow_summaries', 'last_completed_collection_at',
  'shadow summaries expose an independent completed-collection timestamp'
);
select is(
  (
    select reloptions
    from pg_catalog.pg_class
    where oid = pg_catalog.to_regclass('public.github_repository_shadow_summaries')
  ),
  array['security_invoker=true'],
  'shadow summaries continue to execute with caller RLS and privileges'
);
select is(
  (
    select pg_catalog.array_agg(privilege_type::text order by privilege_type)
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'github_repository_shadow_summaries'
      and grantee = 'authenticated'
  ),
  array['SELECT']::text[],
  'authenticated receives only an explicit SELECT grant on the summary view'
);
select ok(
  not has_table_privilege('anon', 'public.github_repository_shadow_summaries', 'SELECT'),
  'anonymous callers cannot read shadow summaries'
);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('8e000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shadow-ui-owner@example.test', '', now(), '{}', '{}'),
  ('8e000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shadow-ui-other@example.test', '', now(), '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8e000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config(
  'app.github_shadow_ui_org',
  public.create_organisation_with_owner('GitHub Shadow UI', 'github-shadow-ui')::text,
  true
);
select set_config('request.jwt.claims', '{"sub":"8e000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select set_config(
  'app.github_shadow_ui_other_org',
  public.create_organisation_with_owner('Other GitHub Shadow UI', 'other-github-shadow-ui')::text,
  true
);

reset role;
insert into public.github_installations(
  id, organisation_id, provider_installation_id, account_id, account_login,
  account_type, repository_selection, status, connected_by, permissions,
  permissions_ok
) values (
  '8e000000-0000-4000-8000-000000000101',
  current_setting('app.github_shadow_ui_org')::uuid,
  88101, 88201, 'Shadow-UI', 'Organization', 'selected', 'active',
  '8e000000-0000-4000-8000-000000000001',
  '{"contents":"read","metadata":"read"}', true
);
insert into public.github_repositories(
  id, organisation_id, installation_id, provider_repository_id, owner_login,
  name, full_name, html_url, visibility, default_branch, archived, selected
) values (
  '8e000000-0000-4000-8000-000000000201',
  current_setting('app.github_shadow_ui_org')::uuid,
  '8e000000-0000-4000-8000-000000000101',
  88301, 'Shadow-UI', 'application', 'Shadow-UI/application',
  'https://github.com/Shadow-UI/application', 'private', 'main', false, true
);
insert into public.github_collection_runs(
  id, organisation_id, installation_id, repository_id, provider_repository_id,
  trigger_type, request_key, status, started_at, completed_at,
  observation_count, passed_count, failed_count, unknown_count,
  not_applicable_count, lease_token, lease_expires_at, attempt
) values
  (
    '8e000000-0000-4000-8000-000000000301',
    current_setting('app.github_shadow_ui_org')::uuid,
    '8e000000-0000-4000-8000-000000000101',
    '8e000000-0000-4000-8000-000000000201', 88301,
    'scheduled', 'scheduled:completed', 'succeeded',
    '2026-08-15T20:00:00Z', '2026-08-15T20:01:00Z',
    15, 14, 1, 0, 0,
    '8e000000-0000-4000-8000-000000000401',
    '2026-08-15T20:02:00Z', 1
  ),
  (
    '8e000000-0000-4000-8000-000000000302',
    current_setting('app.github_shadow_ui_org')::uuid,
    '8e000000-0000-4000-8000-000000000101',
    '8e000000-0000-4000-8000-000000000201', 88301,
    'manual', 'manual:running', 'running',
    '2026-08-17T18:00:00Z', null,
    0, 0, 0, 0, 0,
    '8e000000-0000-4000-8000-000000000402',
    '2026-08-17T20:00:00Z', 1
  );

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8e000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(
  (
    select latest_status::text
    from public.github_repository_shadow_summaries
    where repository_id = '8e000000-0000-4000-8000-000000000201'
  ),
  'running',
  'the latest run remains the independently selected running run'
);
select is(
  (
    select latest_completed_at
    from public.github_repository_shadow_summaries
    where repository_id = '8e000000-0000-4000-8000-000000000201'
  ),
  null::timestamptz,
  'a newest running run has no latest completion timestamp'
);
select is(
  (
    select last_completed_collection_at
    from public.github_repository_shadow_summaries
    where repository_id = '8e000000-0000-4000-8000-000000000201'
  ),
  '2026-08-15T20:01:00Z'::timestamptz,
  'freshness retains the older completed collection behind a newer running run'
);
select is(
  (
    select count(*)::integer
    from public.github_repository_shadow_summaries
    where organisation_id = current_setting('app.github_shadow_ui_org')::uuid
  ),
  1,
  'the workspace Owner sees its repository summary through underlying RLS'
);

select set_config('request.jwt.claims', '{"sub":"8e000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(
  (
    select count(*)::integer
    from public.github_repository_shadow_summaries
    where organisation_id = current_setting('app.github_shadow_ui_org')::uuid
  ),
  0,
  'a cross-tenant Owner cannot read another workspace summary through the view'
);

select * from finish();
rollback;
