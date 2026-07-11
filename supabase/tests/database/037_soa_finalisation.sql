begin;
select plan(8);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('91000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'soa-owner-a@example.test', '', now(), '{}', '{}'),
  ('91000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'soa-owner-b@example.test', '', now(), '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","email":"soa-owner-a@example.test","role":"authenticated"}', true);
select set_config('app.org_a', public.create_organisation_with_owner('SoA Finalisation A', 'soa-finalisation-a')::text, true);
insert into public.assessment_sessions (organisation_id, catalogue_version_id, title, created_by)
values (
  current_setting('app.org_a')::uuid,
  '00000000-0000-4000-8000-000000000001',
  'SoA finalisation assessment',
  '91000000-0000-4000-8000-000000000001'
);
select set_config('app.session_a', (
  select id::text from public.assessment_sessions
  where organisation_id = current_setting('app.org_a')::uuid
), true);

select set_config('app.register_pending', public.create_soa_draft(current_setting('app.session_a')::uuid, 'Pending status')::text, true);
select set_config('app.register_owner', public.create_soa_draft(current_setting('app.session_a')::uuid, 'Missing owner')::text, true);
select set_config('app.register_rationale', public.create_soa_draft(current_setting('app.session_a')::uuid, 'Missing rationale')::text, true);
select set_config('app.register_missing_evidence', public.create_soa_draft(current_setting('app.session_a')::uuid, 'Missing evidence')::text, true);
select set_config('app.register_expired', public.create_soa_draft(current_setting('app.session_a')::uuid, 'Expired evidence')::text, true);
select set_config('app.register_mixed', public.create_soa_draft(current_setting('app.session_a')::uuid, 'Mixed evidence')::text, true);
select set_config('app.register_valid', public.create_soa_draft(current_setting('app.session_a')::uuid, 'Valid review')::text, true);

update public.soa_items
set applicable = false,
    status = 'not_applicable',
    justification = 'Reviewed and not applicable',
    owner_id = '91000000-0000-4000-8000-000000000001'
where organisation_id = current_setting('app.org_a')::uuid;

select set_config('app.requirement_mixed', (
  select control_id::text from public.soa_items
  where soa_register_id = current_setting('app.register_mixed')::uuid and position = 0
), true);
select set_config('app.requirement_missing', (
  select control_id::text from public.soa_items
  where soa_register_id = current_setting('app.register_missing_evidence')::uuid and position = 1
), true);
select set_config('app.requirement_expired', (
  select control_id::text from public.soa_items
  where soa_register_id = current_setting('app.register_expired')::uuid and position = 2
), true);
select set_config('app.requirement_live', (
  select control_id::text from public.soa_items
  where soa_register_id = current_setting('app.register_valid')::uuid and position = 3
), true);
select set_config('app.control_mixed', (
  select control_id::text from public.requirement_control_mappings
  where requirement_id = current_setting('app.requirement_mixed')::uuid limit 1
), true);
select set_config('app.control_expired', (
  select control_id::text from public.requirement_control_mappings
  where requirement_id = current_setting('app.requirement_expired')::uuid limit 1
), true);
select set_config('app.control_live', (
  select control_id::text from public.requirement_control_mappings
  where requirement_id = current_setting('app.requirement_live')::uuid limit 1
), true);

insert into public.evidence (id, organisation_id, title, kind, description, status, created_by) values
  ('92000000-0000-4000-8000-000000000001', current_setting('app.org_a')::uuid, 'Mixed current evidence', 'note', '', 'current', '91000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000002', current_setting('app.org_a')::uuid, 'Mixed expired evidence', 'note', '', 'expired', '91000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000003', current_setting('app.org_a')::uuid, 'Expired evidence', 'note', '', 'expired', '91000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000004', current_setting('app.org_a')::uuid, 'Live evidence', 'note', '', 'expiring', '91000000-0000-4000-8000-000000000001');
insert into public.evidence_links (organisation_id, evidence_id, control_id, created_by) values
  (current_setting('app.org_a')::uuid, '92000000-0000-4000-8000-000000000001', current_setting('app.control_mixed')::uuid, '91000000-0000-4000-8000-000000000001'),
  (current_setting('app.org_a')::uuid, '92000000-0000-4000-8000-000000000002', current_setting('app.control_mixed')::uuid, '91000000-0000-4000-8000-000000000001'),
  (current_setting('app.org_a')::uuid, '92000000-0000-4000-8000-000000000003', current_setting('app.control_expired')::uuid, '91000000-0000-4000-8000-000000000001'),
  (current_setting('app.org_a')::uuid, '92000000-0000-4000-8000-000000000004', current_setting('app.control_live')::uuid, '91000000-0000-4000-8000-000000000001');

update public.soa_items set applicable = true, status = 'pending'
where soa_register_id = current_setting('app.register_pending')::uuid and position = 3;
update public.soa_items set applicable = true, status = 'operational', owner_id = null
where soa_register_id = current_setting('app.register_owner')::uuid and position = 3;
update public.soa_items set applicable = true, status = 'operational', justification = ' '
where soa_register_id = current_setting('app.register_rationale')::uuid and position = 3;
update public.soa_items set applicable = true, status = 'operational'
where soa_register_id = current_setting('app.register_missing_evidence')::uuid and position = 1;
update public.soa_items set applicable = true, status = 'operational'
where soa_register_id = current_setting('app.register_expired')::uuid and position = 2;
update public.soa_items set applicable = true, status = 'operational'
where soa_register_id = current_setting('app.register_mixed')::uuid and position = 0;
update public.soa_items set applicable = true, status = 'operational'
where soa_register_id = current_setting('app.register_valid')::uuid and position = 3;

select throws_ok(
  format($$ select public.finalise_soa(%L) $$, current_setting('app.register_pending')),
  'P0001', 'SoA cannot be finalised: pending controls', 'direct RPC blocks pending controls'
);
select throws_ok(
  format($$ select public.finalise_soa(%L) $$, current_setting('app.register_owner')),
  'P0001', 'SoA cannot be finalised: missing owners', 'direct RPC blocks missing owners'
);
select throws_ok(
  format($$ select public.finalise_soa(%L) $$, current_setting('app.register_rationale')),
  'P0001', 'SoA cannot be finalised: missing rationales', 'direct RPC blocks missing rationales'
);
select throws_ok(
  format($$ select public.finalise_soa(%L) $$, current_setting('app.register_missing_evidence')),
  'P0001', 'SoA cannot be finalised: missing live evidence', 'direct RPC blocks applicable controls without live evidence'
);
select throws_ok(
  format($$ select public.finalise_soa(%L) $$, current_setting('app.register_expired')),
  'P0001', 'SoA cannot be finalised: expired evidence', 'direct RPC blocks expired-only evidence'
);
select throws_ok(
  format($$ select public.finalise_soa(%L) $$, current_setting('app.register_mixed')),
  'P0001', 'SoA cannot be finalised: expired evidence', 'direct RPC blocks mixed live and expired evidence'
);

select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000002","email":"soa-owner-b@example.test","role":"authenticated"}', true);
select set_config('app.org_b', public.create_organisation_with_owner('SoA Finalisation B', 'soa-finalisation-b')::text, true);
select throws_ok(
  format($$ select public.finalise_soa(%L) $$, current_setting('app.register_valid')),
  '42501', 'SoA register not found', 'direct RPC blocks cross-tenant finalisation'
);

select set_config('request.jwt.claims', '{"sub":"91000000-0000-4000-8000-000000000001","email":"soa-owner-a@example.test","role":"authenticated"}', true);
select lives_ok(
  format($$ select public.finalise_soa(%L) $$, current_setting('app.register_valid')),
  'direct RPC finalises a complete valid review'
);

select * from finish();
rollback;
