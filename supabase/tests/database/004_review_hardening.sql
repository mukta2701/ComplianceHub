begin;
select plan(16);

select has_function('public', 'create_organisation_with_owner', array['text', 'text']);
select has_function('public', 'create_soa_draft', array['uuid', 'text']);
select has_function('public', 'create_soa_successor', array['uuid', 'text']);
select has_table('public', 'control_catalogue_versions', 'independent control catalogue exists');
select has_table('public', 'control_catalogue_controls', 'versioned controls exist');
select is((select count(*) from public.control_catalogue_controls where catalogue_version_id = '40000000-0000-4000-8000-000000000001'), 93::bigint, 'the beta control catalogue contains 93 independently worded controls');

select has_fk('public', 'assessment_responses', 'assessment_responses_session_tenant_fk');
select has_fk('public', 'assessment_responses', 'assessment_responses_question_version_fk');
select has_fk('public', 'soa_registers', 'soa_registers_assessment_tenant_fk');
select has_fk('public', 'soa_items', 'soa_items_register_tenant_fk');
select has_fk('public', 'risks', 'risks_owner_tenant_fk');
select has_fk('public', 'risks', 'risks_assessment_tenant_fk');
select has_fk('public', 'risks', 'risks_soa_tenant_fk');

select throws_ok(
  $$ select public.create_organisation_with_owner('No identity', 'no-identity') $$,
  '42501', 'authentication required', 'organisation RPC requires authentication'
);
select throws_ok(
  $$ select public.create_soa_draft(extensions.gen_random_uuid(), 'Invalid') $$,
  '42501', 'assessment not found', 'SoA draft RPC does not disclose inaccessible assessments'
);
select throws_ok(
  $$ select public.create_soa_successor(extensions.gen_random_uuid(), 'Invalid') $$,
  '42501', 'SoA snapshot not found', 'successor RPC does not disclose inaccessible snapshots'
);

select * from finish();
rollback;
