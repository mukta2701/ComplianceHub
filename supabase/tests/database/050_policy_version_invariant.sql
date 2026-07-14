begin;
select plan(8);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('7a000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','version-owner@example.test','',now(),'{}','{}'),
 ('7a000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','version-member@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000001","email":"version-owner@example.test","role":"authenticated"}',true);
select set_config('app.version_org',public.create_organisation_with_owner('Version org','version-org')::text,true);
insert into public.memberships(organisation_id,user_id,role) values(current_setting('app.version_org')::uuid,'7a000000-0000-4000-8000-000000000002','member');
insert into public.policies(id,organisation_id,reference,title,body,version,status,created_by)
values('7a000000-0000-4000-8000-000000000101',current_setting('app.version_org')::uuid,'VER-1','Versioned policy','Original body',1,'approved','7a000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000002","email":"version-member@example.test","role":"authenticated"}',true);
select lives_ok($$ select public.accept_policy('7a000000-0000-4000-8000-000000000101') $$,'member accepts the original content');

select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000001","email":"version-owner@example.test","role":"authenticated"}',true);
select lives_ok($$ update public.policies set body='Changed body', version=1 where id='7a000000-0000-4000-8000-000000000101' $$,'direct material edit is accepted and database-managed');
select is((select version from public.policies where id='7a000000-0000-4000-8000-000000000101'),2,'a direct material body edit bumps exactly once from OLD.version');
select throws_ok(
  $$ update public.policies set version=99 where id='7a000000-0000-4000-8000-000000000101' $$,
  '42501','policy version is database-managed','version-only caller tampering is rejected'
);
select lives_ok($$ update public.policies set body='  Changed   body  ' where id='7a000000-0000-4000-8000-000000000101' $$,'normalised-whitespace-only edit is non-material');
select is((select version from public.policies where id='7a000000-0000-4000-8000-000000000101'),2,'non-material body formatting does not bump the version');
select results_eq(
  $$ update public.policies set body='stale overwrite' where id='7a000000-0000-4000-8000-000000000101' and version=1 returning id $$,
  $$ select null::uuid where false $$,
  'a stale optimistic update cannot overwrite a newer policy version'
);

select set_config('request.jwt.claims','{"sub":"7a000000-0000-4000-8000-000000000002","email":"version-member@example.test","role":"authenticated"}',true);
select is(
  (select accepted_version = (select version from public.policies where id='7a000000-0000-4000-8000-000000000101') from public.policy_acceptances),
  false,
  'acceptance of earlier content is no longer current after a material edit'
);

select * from finish();
rollback;
