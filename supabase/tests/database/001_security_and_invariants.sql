begin;
select plan(18);

select has_table('public', 'organisations', 'organisations exists');
select has_table('public', 'memberships', 'memberships exists');
select has_table('public', 'assessment_sessions', 'assessment sessions exist');
select has_table('public', 'assessment_responses', 'assessment responses exist');
select has_table('public', 'soa_snapshots', 'SoA snapshots exist');
select has_table('public', 'risks', 'risks exist');
select has_table('public', 'audit_events', 'audit events exist');

select ok((select relrowsecurity from pg_class where oid = 'public.organisations'::regclass), 'organisations RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.memberships'::regclass), 'memberships RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.assessment_sessions'::regclass), 'assessment sessions RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.assessment_responses'::regclass), 'assessment responses RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.soa_snapshots'::regclass), 'SoA snapshot RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.risks'::regclass), 'risk RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_events'::regclass), 'audit RLS is enabled');

select function_returns('public', 'is_organisation_member', array['uuid'], 'boolean');
select function_returns('public', 'is_organisation_owner', array['uuid'], 'boolean');

select throws_ok(
  $$ update public.audit_events set action = 'tampered' where false $$,
  'P0001', 'audit events are immutable', 'audit events reject updates'
);
select throws_ok(
  $$ delete from public.soa_snapshots where false $$,
  'P0001', 'finalised SoA snapshots are immutable', 'SoA snapshots reject deletes'
);

select * from finish();
rollback;
