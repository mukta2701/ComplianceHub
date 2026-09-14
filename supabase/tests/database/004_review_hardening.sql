begin;
select plan(16);

select has_function('public', 'create_organisation_with_owner', array['text', 'text']);
select has_function('public', 'create_or_reuse_soa_review', array['uuid']);
select has_function('public', 'create_or_reuse_soa_successor', array['uuid']);
select has_table('public', 'control_catalogue_versions', 'independent control catalogue exists');
select has_table('public', 'control_catalogue_controls', 'versioned controls exist');
select is((select count(*) from public.control_catalogue_controls where catalogue_version_id = '40000000-0000-4000-8000-000000000001'), 93::bigint, 'the beta control catalogue contains 93 independently worded controls');

select ok((select contype='f' and conrelid='public.assessment_responses'::regclass from pg_catalog.pg_constraint where conname='assessment_responses_session_tenant_fk'));
select ok((select contype='f' and conrelid='public.assessment_responses'::regclass from pg_catalog.pg_constraint where conname='assessment_responses_question_version_fk'));
select ok((select contype='f' and conrelid='public.soa_registers'::regclass from pg_catalog.pg_constraint where conname='soa_registers_assessment_tenant_fk'));
select ok((select contype='f' and conrelid='public.soa_items'::regclass from pg_catalog.pg_constraint where conname='soa_items_register_tenant_fk'));
select ok((select contype='f' and conrelid='public.risks'::regclass from pg_catalog.pg_constraint where conname='risks_owner_tenant_fk'));
select ok((select contype='f' and conrelid='public.risks'::regclass from pg_catalog.pg_constraint where conname='risks_assessment_tenant_fk'));
select ok((select contype='f' and conrelid='public.risks'::regclass from pg_catalog.pg_constraint where conname='risks_soa_tenant_fk'));

select throws_ok(
  $$ select public.create_organisation_with_owner('No identity', 'no-identity') $$,
  '42501', 'authentication required', 'organisation RPC requires authentication'
);
select throws_ok(
  $$ select public.create_or_reuse_soa_review(extensions.gen_random_uuid()) $$,
  '42501', 'Assessment unavailable', 'control review RPC does not disclose inaccessible assessments'
);
select throws_ok(
  $$ select public.create_or_reuse_soa_successor(extensions.gen_random_uuid()) $$,
  '42501', 'Finalised statement unavailable', 'successor RPC does not disclose inaccessible registers'
);

select * from finish();
rollback;
