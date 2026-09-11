begin;
select plan(11);

select ok(
  to_regclass('public.evidence_links_audit_item_org_created_idx') is not null,
  'linked evidence lookup has an audit checklist target index'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('10100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-proof-owner@example.test', '', now(), '{}', '{}'),
  ('10100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-proof-owner@example.test', '', now(), '{}', '{}');

insert into public.organisations (id, name, slug, created_by) values
  ('20100000-0000-4000-8000-000000000001', 'Audit Proof Ltd', 'audit-proof-ltd', '10100000-0000-4000-8000-000000000001'),
  ('20100000-0000-4000-8000-000000000002', 'Other Tenant Ltd', 'other-proof-tenant', '10100000-0000-4000-8000-000000000002');

insert into public.memberships (organisation_id, user_id, role) values
  ('20100000-0000-4000-8000-000000000001', '10100000-0000-4000-8000-000000000001', 'owner'),
  ('20100000-0000-4000-8000-000000000002', '10100000-0000-4000-8000-000000000002', 'owner');

insert into public.audits (id, organisation_id, reference, title, scope, framework, created_by)
values ('30100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000001', 'AUD-PROOF', 'Proof traceability audit', 'Identity controls', 'SOC 2 Type II', '10100000-0000-4000-8000-000000000001');

insert into public.audit_checklist_items (id, organisation_id, audit_id, area, clause_reference, checklist_item, compliant, evidence_note, position)
values ('40100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000001', '30100000-0000-4000-8000-000000000001', 'Access', 'A.5', 'Review privileged access', 'compliant', 'Human review completed', 0);

insert into public.evidence (id, organisation_id, title, kind, description, status, collected_on, valid_until, created_by) values
  ('50100000-0000-4000-8000-000000000001', '20100000-0000-4000-8000-000000000001', 'Privileged access review export', 'note', 'Fictional audit proof', 'current', current_date - 30, current_date - 1, '10100000-0000-4000-8000-000000000001'),
  ('50100000-0000-4000-8000-000000000003', '20100000-0000-4000-8000-000000000001', 'Upcoming access review expiry', 'note', 'Fictional expiring proof', 'current', current_date - 2, current_date + 30, '10100000-0000-4000-8000-000000000001'),
  ('50100000-0000-4000-8000-000000000002', '20100000-0000-4000-8000-000000000002', 'Other Tenant proof', 'note', 'Must never be exposed', 'current', current_date, current_date + 30, '10100000-0000-4000-8000-000000000002');

insert into public.evidence_links (organisation_id, evidence_id, audit_checklist_item_id, created_by) values
  ('20100000-0000-4000-8000-000000000001', '50100000-0000-4000-8000-000000000001', '40100000-0000-4000-8000-000000000001', '10100000-0000-4000-8000-000000000001'),
  ('20100000-0000-4000-8000-000000000001', '50100000-0000-4000-8000-000000000003', '40100000-0000-4000-8000-000000000001', '10100000-0000-4000-8000-000000000001');

insert into public.auditor_access_tokens (organisation_id, token_hash, audit_id, framework, expires_at, created_by) values
  ('20100000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('audit-proof-token','UTF8'),'sha256'),'hex'), '30100000-0000-4000-8000-000000000001', 'Wrong stored label', now() + interval '7 days', '10100000-0000-4000-8000-000000000001'),
  ('20100000-0000-4000-8000-000000000001', encode(extensions.digest(convert_to('org-proof-token','UTF8'),'sha256'),'hex'), null, 'Misleading audit framework', now() + interval '7 days', '10100000-0000-4000-8000-000000000001');

set local role anon;

select is(
  public.audit_view_for_token('audit-proof-token') ->> 'accessScope',
  'audit',
  'an audit token identifies its narrow access scope'
);
select is(
  public.audit_view_for_token('audit-proof-token') ->> 'framework',
  'SOC 2 Type II',
  'an audit token reports the linked audit framework'
);
select is(
  public.audit_view_for_token('org-proof-token') ->> 'framework',
  'Workspace readiness',
  'an organisation token uses a neutral workspace label'
);
select is(
  jsonb_array_length(public.audit_view_for_token('audit-proof-token') -> 'evidence'),
  0,
  'an audit token omits organisation-wide evidence totals'
);
select is(
  jsonb_array_length(public.audit_view_for_token('audit-proof-token') -> 'risks'),
  0,
  'an audit token omits organisation-wide risk totals'
);
select is(
  jsonb_array_length(public.audit_view_for_token('audit-proof-token') -> 'audit' -> 'checklist' -> 0 -> 'linkedEvidence'),
  2,
  'the scoped auditor checklist includes its linked proof'
);
select is(
  public.audit_view_for_token('audit-proof-token') -> 'audit' -> 'checklist' -> 0 -> 'linkedEvidence' -> 0 ->> 'title',
  'Privileged access review export',
  'linked proof retains its title'
);
select is(
  public.audit_view_for_token('audit-proof-token') -> 'audit' -> 'checklist' -> 0 -> 'linkedEvidence' -> 0 ->> 'status',
  'expired',
  'linked proof uses date-effective freshness'
);
select is(
  public.audit_view_for_token('audit-proof-token') -> 'audit' -> 'checklist' -> 0 -> 'linkedEvidence' -> 1 ->> 'status',
  'expiring',
  'linked proof uses the 30-day warning window'
);
select is(
  position('Other Tenant proof' in public.audit_view_for_token('audit-proof-token')::text),
  0,
  'the token payload excludes another tenant evidence'
);

select * from finish();
rollback;
