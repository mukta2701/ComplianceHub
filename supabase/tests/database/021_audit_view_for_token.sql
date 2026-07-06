begin;
select plan(6);

-- Two tenants, each seeded (by public.seed_default_risk_categories) with the
-- default category taxonomy on org insert. Tenant A gets ONE risk, tenant B
-- gets TWO. Three tokens are minted for tenant A: valid, expired, revoked. The
-- security-definer RPC must return ONLY tenant A's data through the valid token
-- and refuse the expired / revoked / unknown ones by returning null.
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

-- The default taxonomy already seeded 'Data Security' (position 0) for each org
-- via the org-insert trigger; reference that seeded category rather than
-- inserting a colliding duplicate.
insert into public.risks (organisation_id, reference, title, description, category_id, likelihood, impact, treatment, residual_likelihood, residual_impact, status, created_by) values
  ('20000000-0000-4000-8000-000000000001', 'R-001', 'Risk A', 'd', (select id from public.risk_categories where organisation_id='20000000-0000-4000-8000-000000000001' and name='Data Security'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'R-001', 'Risk B1', 'd', (select id from public.risk_categories where organisation_id='20000000-0000-4000-8000-000000000002' and name='Data Security'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000002', 'R-002', 'Risk B2', 'd', (select id from public.risk_categories where organisation_id='20000000-0000-4000-8000-000000000002' and name='Data Security'), 3, 3, 'mitigate', 2, 2, 'open', '10000000-0000-4000-8000-000000000002');
insert into public.auditor_access_tokens (organisation_id, token_hash, expires_at, revoked_at, created_by) values
  ('20000000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('valid-token-a','UTF8'),'sha256'),'hex'), now() + interval '7 days', null, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('expired-token-a','UTF8'),'sha256'),'hex'), now() - interval '1 day', null, '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('revoked-token-a','UTF8'),'sha256'),'hex'), now() + interval '7 days', now(), '10000000-0000-4000-8000-000000000001');

set local role anon;
select isnt(public.audit_view_for_token('valid-token-a'), null, 'a valid token returns a payload');
select is(public.audit_view_for_token('valid-token-a') ->> 'organisationName', 'Tenant A', 'the payload is scoped to the token''s organisation');
select is(jsonb_array_length(public.audit_view_for_token('valid-token-a') -> 'risks'), 1, 'the payload contains only the token org''s data (1 risk, not tenant B''s 2)');
select is(public.audit_view_for_token('expired-token-a'), null, 'an expired token is refused');
select is(public.audit_view_for_token('revoked-token-a'), null, 'a revoked token is refused');
select is(public.audit_view_for_token('never-issued'), null, 'an unknown token is refused');

select * from finish();
rollback;
