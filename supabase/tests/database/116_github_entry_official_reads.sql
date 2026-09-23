begin;

select plan(4);

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('82000000-0000-4000-8000-000000000011',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'entry-reads-owner@example.test', '', now(), '{}', '{}'),
  ('82000000-0000-4000-8000-000000000012',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'entry-reads-admin@example.test', '', now(), '{}', '{}'),
  ('82000000-0000-4000-8000-000000000013',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'entry-reads-member@example.test', '', now(), '{}', '{}'),
  ('82000000-0000-4000-8000-000000000014',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'entry-reads-outsider@example.test', '', now(), '{}', '{}');

insert into public.organisations(id, name, slug, created_by) values (
  '82000000-0000-4000-8000-000000000001',
  'Entry Read Workspace',
  'entry-read-workspace',
  '82000000-0000-4000-8000-000000000011'
);
insert into public.memberships(organisation_id, user_id, role) values
  ('82000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000011', 'owner'),
  ('82000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000012', 'admin'),
  ('82000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000013', 'member');

insert into public.github_mapping_approvals(organisation_id, mapping_pack_id, approved_by)
select '82000000-0000-4000-8000-000000000001', pack.id,
       '82000000-0000-4000-8000-000000000011'
from public.github_mapping_packs pack
where pack.version = 'github-iso-27001-v1';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000013","role":"authenticated"}',
  true
);

select is(
  (select pg_catalog.count(*) from public.github_mapping_approvals
   where organisation_id = '82000000-0000-4000-8000-000000000001'),
  0::bigint,
  'Members cannot read the legacy whole-pack approval rows directly'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000011","role":"authenticated"}',
  true
);
select is(
  (select pg_catalog.count(*) from public.github_mapping_approvals
   where organisation_id = '82000000-0000-4000-8000-000000000001'),
  1::bigint,
  'Owners retain direct approval access'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000012","role":"authenticated"}',
  true
);
select is(
  (select pg_catalog.count(*) from public.github_mapping_approvals
   where organisation_id = '82000000-0000-4000-8000-000000000001'),
  1::bigint,
  'Admins retain direct approval access'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000014","role":"authenticated"}',
  true
);
select is(
  (select pg_catalog.count(*) from public.github_mapping_approvals
   where organisation_id = '82000000-0000-4000-8000-000000000001'),
  0::bigint,
  'Workspace outsider cannot read approval records'
);

reset role;
select * from finish();
rollback;
