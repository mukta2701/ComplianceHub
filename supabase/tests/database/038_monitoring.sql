begin;
select plan(10);

-- Monitoring runs on the RLS-bypassing service client, so tenant isolation rests
-- entirely on the tables' own RLS. This suite proves that safety net directly:
-- owner-only management, member-read / owner-write on findings, the dedup key,
-- and cross-tenant invisibility.

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('60000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mon-owner-a@example.test','',now(),'{}','{}'),
 ('60000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mon-member-a@example.test','',now(),'{}','{}'),
 ('60000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mon-owner-b@example.test','',now(),'{}','{}');

set local role authenticated;

-- Org A + owner-a, plus a plain member.
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000001","email":"mon-owner-a@example.test","role":"authenticated"}',true);
select set_config('app.org_a',public.create_organisation_with_owner('Mon Org A','mon-a')::text,true);
insert into public.memberships(organisation_id,user_id,role)
values(current_setting('app.org_a')::uuid,'60000000-0000-4000-8000-000000000002','member');

select lives_ok(
  $$ insert into public.monitor_sources(organisation_id,provider,label,connected_by)
     values(current_setting('app.org_a')::uuid,'github','A repo','60000000-0000-4000-8000-000000000001') $$,
  'an owner can connect a monitor source');
select set_config('app.src_a',(select id::text from public.monitor_sources where organisation_id=current_setting('app.org_a')::uuid),true);

-- A plain member may NOT connect a source (owner-only insert policy).
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000002","email":"mon-member-a@example.test","role":"authenticated"}',true);
select throws_ok(
  $$ insert into public.monitor_sources(organisation_id,provider,label,connected_by)
     values(current_setting('app.org_a')::uuid,'github','sneaky','60000000-0000-4000-8000-000000000002') $$,
  '42501', NULL, 'a non-owner member cannot connect a source');

-- Seed a finding as the service role (findings are service-inserted).
set local role postgres;
insert into public.monitoring_findings(organisation_id,source_id,check_id,control_ref,subject_type,subject_id,severity,title)
values(current_setting('app.org_a')::uuid,current_setting('app.src_a')::uuid,'github.branch_protection','A.8.32','github_repo','acme/isms','critical','Unprotected');

-- The (organisation_id, check_id, subject_id) dedup key blocks a duplicate.
select throws_ok(
  $$ insert into public.monitoring_findings(organisation_id,check_id,subject_type,subject_id,severity,title)
     values(current_setting('app.org_a')::uuid,'github.branch_protection','github_repo','acme/isms','high','dup') $$,
  '23505', NULL, 'the dedup key blocks a duplicate finding on the same subject');

set local role authenticated;

-- A member can READ the org's findings.
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000002","email":"mon-member-a@example.test","role":"authenticated"}',true);
select is((select count(*)::int from public.monitoring_findings where organisation_id=current_setting('app.org_a')::uuid),
  1, 'a member can read the org findings');

-- A member CANNOT resolve a finding (owner-only UPDATE policy → silent no-op).
update public.monitoring_findings set status='resolved' where organisation_id=current_setting('app.org_a')::uuid;
select is((select status::text from public.monitoring_findings where organisation_id=current_setting('app.org_a')::uuid limit 1),
  'open', 'a member cannot resolve a finding (owner-only update)');

-- The owner CAN resolve it.
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000001","email":"mon-owner-a@example.test","role":"authenticated"}',true);
update public.monitoring_findings set status='resolved',resolved_at=now() where organisation_id=current_setting('app.org_a')::uuid;
select is((select status::text from public.monitoring_findings where organisation_id=current_setting('app.org_a')::uuid limit 1),
  'resolved', 'an owner can resolve a finding');

-- An owner can add an alert channel.
select lives_ok(
  $$ insert into public.alert_channels(organisation_id,type,label,min_severity,connected_by)
     values(current_setting('app.org_a')::uuid,'slack','A slack','high','60000000-0000-4000-8000-000000000001') $$,
  'an owner can add an alert channel');

-- A different organisation (owner-b) sees NONE of org A's monitoring rows.
select set_config('request.jwt.claims','{"sub":"60000000-0000-4000-8000-000000000003","email":"mon-owner-b@example.test","role":"authenticated"}',true);
select set_config('app.org_b',public.create_organisation_with_owner('Mon Org B','mon-b')::text,true);
select is((select count(*)::int from public.monitor_sources where organisation_id=current_setting('app.org_a')::uuid),
  0, 'a different org cannot see the monitor source (RLS)');
select is((select count(*)::int from public.monitoring_findings where organisation_id=current_setting('app.org_a')::uuid)
        + (select count(*)::int from public.alert_channels where organisation_id=current_setting('app.org_a')::uuid),
  0, 'a different org cannot see findings or alert channels (RLS)');

select * from finish();
rollback;
