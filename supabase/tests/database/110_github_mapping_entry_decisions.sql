begin;

select no_plan();

select has_table('public', 'github_mapping_pack_selections', 'each workspace selects a mapping pack separately from consent');
select has_table('public', 'github_mapping_entry_decisions', 'individual mapping decisions retain history');
select has_view('public', 'github_effective_mapping_entry_decisions', 'review and materialisation share effective decisions');
select has_function('public', 'github_mapping_entry_digest', array['uuid'], 'entry content has a stable digest');
select has_function('public', 'record_github_mapping_entry_decision_server', array['uuid','uuid','uuid','text','text','bigint'], 'server records an exact entry decision');
select has_function('public', 'select_github_mapping_pack_server', array['uuid','uuid','text','text','bigint'], 'server selects a published pack');
select ok(has_function_privilege('service_role', 'public.record_github_mapping_entry_decision_server(uuid,uuid,uuid,text,text,bigint)', 'EXECUTE'), 'server may record decisions');
select ok(not has_function_privilege('authenticated', 'public.record_github_mapping_entry_decision_server(uuid,uuid,uuid,text,text,bigint)', 'EXECUTE'), 'browser sessions cannot impersonate a decision actor');
select ok(not has_function_privilege('authenticated', 'public.select_github_mapping_pack_server(uuid,uuid,text,text,bigint)', 'EXECUTE'), 'browser sessions cannot choose a pack directly');
select ok(not has_table_privilege('authenticated', 'public.github_mapping_entry_decisions', 'INSERT,UPDATE,DELETE'), 'browser sessions cannot write decisions directly');
select ok(not has_table_privilege('service_role', 'public.github_mapping_entry_decisions', 'INSERT,UPDATE,DELETE'), 'service clients cannot bypass the decision function');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('74000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-entry-owner@example.test','',now(),'{}','{}'),
 ('74000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-entry-admin@example.test','',now(),'{}','{}'),
 ('74000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-entry-member@example.test','',now(),'{}','{}'),
 ('74000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','m2-entry-other-owner@example.test','',now(),'{}','{}');

insert into public.organisations(id,name,slug,created_by) values
 ('74000000-0000-4000-8000-000000000101','M2 entry Org A','m2-entry-org-a','74000000-0000-4000-8000-000000000001'),
 ('74000000-0000-4000-8000-000000000102','M2 entry Org B','m2-entry-org-b','74000000-0000-4000-8000-000000000004');
insert into public.memberships(organisation_id,user_id,role) values
 ('74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000001','owner'),
 ('74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000002','admin'),
 ('74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000003','member'),
 ('74000000-0000-4000-8000-000000000102','74000000-0000-4000-8000-000000000004','owner');

select set_config('m2.legacy_approval', public.approve_github_mapping_pack_server(
  '74000000-0000-4000-8000-000000000101',
  '74000000-0000-4000-8000-000000000001',
  'github-iso-27001-v1',
  (select checksum from public.github_mapping_packs where version='github-iso-27001-v1')
)::text, true);

select is(
  (select status from public.github_effective_mapping_entry_decisions
   where organisation_id='74000000-0000-4000-8000-000000000101'
     and check_id='github.branch.stale_approvals'),
  'approved', 'a current whole-pack receipt approves its exact historical entry'
);
select is(
  (select source from public.github_effective_mapping_entry_decisions
   where organisation_id='74000000-0000-4000-8000-000000000101'
     and check_id='github.branch.stale_approvals'),
  'legacy_pack', 'legacy consent remains identifiable without a fabricated entry decision'
);
select is((select count(*) from public.github_mapping_entry_decisions
           where organisation_id='74000000-0000-4000-8000-000000000101'),
          0::bigint, 'legacy consent creates no new decision receipt');

select set_config('m2.entry_digest', public.github_mapping_entry_digest(
  (select id from public.github_mapping_entries
   where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
     and check_id='github.branch.stale_approvals')
), true);
select set_config('m2.entry_id', (
  select id::text from public.github_mapping_entries
  where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1')
    and check_id='github.branch.stale_approvals'
), true);

select throws_ok(
  $$ select public.record_github_mapping_entry_decision_server(
    '74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000001',
    current_setting('m2.entry_id')::uuid,repeat('f',64),'rejected',0
  ) $$,
  '22023', null, 'a stale entry digest cannot be approved or rejected'
);
select throws_ok(
  $$ select public.record_github_mapping_entry_decision_server(
    '74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000002',
    current_setting('m2.entry_id')::uuid,current_setting('m2.entry_digest'),'rejected',0
  ) $$,
  '42501', null, 'Admin cannot decide a mapping'
);
select throws_ok(
  $$ select public.record_github_mapping_entry_decision_server(
    '74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000003',
    current_setting('m2.entry_id')::uuid,current_setting('m2.entry_digest'),'rejected',0
  ) $$,
  '42501', null, 'Member cannot decide a mapping'
);
select throws_ok(
  $$ select public.record_github_mapping_entry_decision_server(
    '74000000-0000-4000-8000-000000000102','74000000-0000-4000-8000-000000000001',
    current_setting('m2.entry_id')::uuid,current_setting('m2.entry_digest'),'rejected',0
  ) $$,
  '42501', null, 'an Owner cannot write another workspace decision'
);

select set_config('m2.rejection', public.record_github_mapping_entry_decision_server(
  '74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000001',
  current_setting('m2.entry_id')::uuid,current_setting('m2.entry_digest'),'rejected',0
)::text, true);
select is(
  (select status from public.github_effective_mapping_entry_decisions
   where organisation_id='74000000-0000-4000-8000-000000000101'
     and check_id='github.branch.stale_approvals'),
  'rejected', 'an explicit reject overrides an active whole-pack approval'
);
select is((select count(*) from public.github_mapping_approvals
           where id=current_setting('m2.legacy_approval')::uuid and revoked_at is null),
          1::bigint, 'explicit rejection does not rewrite the historical pack receipt');
select is(
  (select revision from public.github_effective_mapping_entry_decisions
   where organisation_id='74000000-0000-4000-8000-000000000101'
     and check_id='github.branch.stale_approvals'),
  1::bigint, 'a decision advances the workspace review revision'
);
select throws_ok(
  $$ select public.record_github_mapping_entry_decision_server(
    '74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000001',
    current_setting('m2.entry_id')::uuid,current_setting('m2.entry_digest'),'approved',0
  ) $$,
  '40001', null, 'a stale form cannot overwrite the newer rejection'
);
select set_config('m2.approval', public.record_github_mapping_entry_decision_server(
  '74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000001',
  current_setting('m2.entry_id')::uuid,current_setting('m2.entry_digest'),'approved',1
)::text, true);
select is((select count(*) from public.github_mapping_entry_decisions
           where organisation_id='74000000-0000-4000-8000-000000000101'),
          2::bigint, 'a later approval appends a second receipt');
select is(
  (select status from public.github_effective_mapping_entry_decisions
   where organisation_id='74000000-0000-4000-8000-000000000101'
     and check_id='github.branch.stale_approvals'),
  'approved', 'latest exact entry decision is effective'
);

insert into public.github_mapping_packs(id,version,title) values (
  '74000000-0000-4000-8000-000000000501','github-m2-entry-v2','M2 entry test pack'
);
insert into public.github_mapping_entries(
  mapping_pack_id,check_id,rule_version,iso_control_references,failure_severity,remediation,treatments
)
select '74000000-0000-4000-8000-000000000501',check_id,rule_version,
  iso_control_references,failure_severity,
  case when check_id='github.branch.stale_approvals' then 'Review the changed mapping before use.' else remediation end,
  treatments
from public.github_mapping_entries
where mapping_pack_id=(select id from public.github_mapping_packs where version='github-iso-27001-v1');
select public.seal_github_mapping_pack_server(
  'github-m2-entry-v2',
  public.github_mapping_pack_checksum('74000000-0000-4000-8000-000000000501')
);
select set_config('m2.v2_checksum', (select checksum from public.github_mapping_packs
  where version='github-m2-entry-v2'), true);
select throws_ok(
  $$ select public.select_github_mapping_pack_server(
    '74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000002',
    'github-m2-entry-v2',current_setting('m2.v2_checksum'),2
  ) $$,
  '42501', null, 'Admin cannot select a mapping pack'
);
select throws_ok(
  $$ select public.select_github_mapping_pack_server(
    '74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000003',
    'github-m2-entry-v2',current_setting('m2.v2_checksum'),2
  ) $$,
  '42501', null, 'Member cannot select a mapping pack'
);
select throws_ok(
  $$ select public.select_github_mapping_pack_server(
    '74000000-0000-4000-8000-000000000102','74000000-0000-4000-8000-000000000001',
    'github-m2-entry-v2',current_setting('m2.v2_checksum'),0
  ) $$,
  '42501', null, 'an Owner cannot select a pack for another workspace'
);
select throws_ok(
  $$ select public.select_github_mapping_pack_server(
    '74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000001',
    'github-m2-entry-v2',current_setting('m2.v2_checksum'),1
  ) $$,
  '40001', null, 'a stale selection cannot replace the current pack'
);
select public.select_github_mapping_pack_server(
  '74000000-0000-4000-8000-000000000101','74000000-0000-4000-8000-000000000001',
  'github-m2-entry-v2',current_setting('m2.v2_checksum'),2
);
select is(
  (select status from public.github_effective_mapping_entry_decisions
   where organisation_id='74000000-0000-4000-8000-000000000101'
     and check_id='github.branch.stale_approvals'),
  'pending', 'a changed entry requires a new Owner decision'
);
select is(
  (select change_reason from public.github_effective_mapping_entry_decisions
   where organisation_id='74000000-0000-4000-8000-000000000101'
     and check_id='github.branch.stale_approvals'),
  'changed', 'the changed entry explains why review is pending'
);
select is(
  (select status from public.github_effective_mapping_entry_decisions
   where organisation_id='74000000-0000-4000-8000-000000000101'
     and check_id='github.repository.visibility'),
  'approved', 'unchanged entry content keeps the legacy approval across pack versions'
);
select is(
  (select count(*) from public.github_mapping_approvals
   where id=current_setting('m2.legacy_approval')::uuid),
  1::bigint, 'the old whole-pack approval remains untouched'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"74000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.github_effective_mapping_entry_decisions
  where organisation_id='74000000-0000-4000-8000-000000000101'),
  15::bigint, 'a workspace Owner can read all selected entry review states');
select is((select count(*) from public.github_effective_mapping_entry_decisions
  where organisation_id='74000000-0000-4000-8000-000000000102'),
  0::bigint, 'a member of one workspace cannot read another workspace decisions');
select set_config('request.jwt.claims',
  '{"sub":"74000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.github_mapping_pack_selections
  where organisation_id='74000000-0000-4000-8000-000000000101'),
  0::bigint, 'a Member cannot read the workspace mapping-pack choice');
select is((select count(*) from public.github_mapping_entry_decisions
  where organisation_id='74000000-0000-4000-8000-000000000101'),
  0::bigint, 'a Member cannot read individual mapping decisions or reviewer identities');
select is((select count(*) from public.github_effective_mapping_entry_decisions
  where organisation_id='74000000-0000-4000-8000-000000000101'),
  0::bigint, 'a Member cannot read effective mapping decisions');
select set_config('request.jwt.claims',
  '{"sub":"74000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.github_effective_mapping_entry_decisions
  where organisation_id='74000000-0000-4000-8000-000000000101'),
  15::bigint, 'an Admin retains read-only mapping review access');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{}', true);
select is((select count(*) from public.github_effective_mapping_entry_decisions
  where organisation_id='74000000-0000-4000-8000-000000000101'),
  15::bigint, 'the server can read effective decisions without a user session');
reset role;

select * from finish();
rollback;
