begin;
select no_plan();

select has_column('public','policies','edit_revision','policy metadata has an independent technical revision');
select ok(to_regprocedure('public.accept_policy(uuid)') is null,'unversioned acceptance RPC is no longer callable');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
('7b000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','decision-owner@example.test','',now(),'{}','{}'),
('7b000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','decision-member@example.test','',now(),'{}','{}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7b000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.policy_decision_org',public.create_organisation_with_owner('Policy decisions','policy-decisions')::text,true);
insert into public.memberships(organisation_id,user_id,role) values(current_setting('app.policy_decision_org')::uuid,'7b000000-0000-4000-8000-000000000002','member');
insert into public.policies(id,organisation_id,reference,title,body,status,owner_id,created_by)
values('7b000000-0000-4000-8000-000000000101',current_setting('app.policy_decision_org')::uuid,'DEC-1','Policy decisions','Original content','approved','7b000000-0000-4000-8000-000000000002','7b000000-0000-4000-8000-000000000001');

select is((select edit_revision from public.policies where reference='DEC-1'),1,'new policy starts at technical revision 1');
select results_eq($$ update public.policies set review_due='2026-12-01' where reference='DEC-1' and edit_revision=1 returning version,edit_revision $$,$$ values(1,2) $$,'metadata edit advances technical revision but preserves content version');
select results_eq($$ update public.policies set title='Stale title' where reference='DEC-1' and edit_revision=1 returning id $$,$$ select null::uuid where false $$,'old metadata draft cannot overwrite newer metadata');

select set_config('request.jwt.claims','{"sub":"7b000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select lives_ok($$ select public.accept_policy('7b000000-0000-4000-8000-000000000101',1) $$,'member accepts the displayed approved version');
select set_config('request.jwt.claims','{"sub":"7b000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select results_eq($$ update public.policies set body='Revised content' where reference='DEC-1' and edit_revision=2 returning version,edit_revision,status::text $$,$$ values(2,3,'approved'::text) $$,'material edit advances both revisions without introducing automatic reapproval');
select results_eq($$ update public.policies set status='archived' where reference='DEC-1' and edit_revision=2 returning id $$,$$ select null::uuid where false $$,'stale status decision does not apply to newer content');

select set_config('request.jwt.claims','{"sub":"7b000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$ select public.accept_policy('7b000000-0000-4000-8000-000000000101',1) $$,'22023','policy version changed; read the current policy before accepting','old displayed version cannot attest to new content without triggering a retry loop');
select is((select accepted_version from public.policy_acceptances where policy_id='7b000000-0000-4000-8000-000000000101'),1,'rejected stale acceptance preserves the earlier recorded acknowledgement');
select throws_ok($$ select public.accept_policy('7b000000-0000-4000-8000-000000000101',null) $$,'22023','expected policy version is required','missing version cannot bypass the displayed-version check');
select lives_ok($$ select public.accept_policy('7b000000-0000-4000-8000-000000000101',2) $$,'reading the latest version permits reacceptance');
select lives_ok($$ select public.accept_policy('7b000000-0000-4000-8000-000000000101',2) $$,'repeat acceptance retains the existing single-row contract');
select results_eq($$ select count(*)::integer,max(accepted_version) from public.policy_acceptances where policy_id='7b000000-0000-4000-8000-000000000101' $$,$$ values(1,2) $$,'acceptance records exactly the authoritative matching version');
select results_eq($$ update public.policies set title='Member rewrite' where reference='DEC-1' returning id $$,$$ select null::uuid where false $$,'Member policy mutation remains denied');

select set_config('request.jwt.claims','{"sub":"7b000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select results_eq($$ update public.policies set edit_revision=999 where reference='DEC-1' returning edit_revision $$,$$ values(4) $$,'caller cannot choose the next technical revision');
delete from public.memberships where organisation_id=current_setting('app.policy_decision_org')::uuid and user_id='7b000000-0000-4000-8000-000000000002';
select results_eq($$ select owner_id,edit_revision from public.policies where reference='DEC-1' $$,$$ values(null::uuid,5) $$,'removing the assigned member clears ownership and advances the edit revision');
select results_eq($$ update public.policies set title='Pre-removal draft' where reference='DEC-1' and edit_revision=4 returning id $$,$$ select null::uuid where false $$,'draft from before membership removal remains stale');

select * from finish();
rollback;
