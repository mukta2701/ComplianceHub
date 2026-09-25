begin;
select no_plan();

select has_column('public', 'policy_feedback_threads', 'decision', 'feedback stores an explicit decision');
select has_table('public', 'policy_feedback_decisions', 'append-only decision history exists');
select has_function('public', 'decide_policy_feedback', array['uuid','text','text'], 'decision uses a guarded RPC');
select has_trigger('public', 'policy_feedback_threads', 'policy_feedback_threads_audit', 'feedback decisions retain audit events');
select ok(not has_table_privilege('authenticated', 'public.policy_feedback_threads', 'UPDATE'), 'portal roles cannot update decisions directly');
select ok(not has_table_privilege('authenticated', 'public.policy_feedback_decisions', 'INSERT'), 'portal roles cannot write history directly');
select ok(not has_table_privilege('authenticated', 'public.policy_feedback_decisions', 'UPDATE'), 'portal roles cannot edit history directly');
select ok(not has_table_privilege('authenticated', 'public.policy_feedback_decisions', 'DELETE'), 'portal roles cannot delete history directly');
select has_trigger('public', 'policy_feedback_decisions', 'policy_feedback_decisions_immutable', 'history rejects mutation even by a privileged actor');
select ok(not has_function_privilege('anon', 'public.decide_policy_feedback(uuid,text,text)', 'EXECUTE'), 'anonymous callers cannot decide');
select ok(not has_function_privilege('public', 'public.decide_policy_feedback(uuid,text,text)', 'EXECUTE'), 'PUBLIC cannot decide');
select ok(not has_function_privilege('service_role', 'public.decide_policy_feedback(uuid,text,text)', 'EXECUTE'), 'service role is not part of the decision API');
select ok(has_function_privilege('authenticated', 'public.decide_policy_feedback(uuid,text,text)', 'EXECUTE'), 'authenticated callers reach the guarded RPC');
select is((select proowner::regrole::text from pg_proc where oid = 'public.decide_policy_feedback(uuid,text,text)'::regprocedure), 'postgres', 'decision RPC has a trusted owner');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.decide_policy_feedback(uuid,text,text)'::regprocedure), 'decision RPC pins an empty search path');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values
 ('7c000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','feedback-decision-owner@example.test','',now(),'{}','{}'),
 ('7c000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','feedback-decision-admin@example.test','',now(),'{}','{}'),
 ('7c000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','feedback-decision-member@example.test','',now(),'{}','{}'),
 ('7c000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','feedback-decision-outsider@example.test','',now(),'{}','{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('app.feedback_decision_org', public.create_organisation_with_owner('Feedback decisions', 'feedback-decisions')::text, true);
insert into public.memberships(organisation_id,user_id,role) values
 (current_setting('app.feedback_decision_org')::uuid,'7c000000-0000-4000-8000-000000000002','admin'),
 (current_setting('app.feedback_decision_org')::uuid,'7c000000-0000-4000-8000-000000000003','member');
insert into public.policies(id,organisation_id,reference,title,body,status,created_by) values
 ('7c000000-0000-4000-8000-000000000101',current_setting('app.feedback_decision_org')::uuid,'FD-1','Feedback decision policy','Original document','approved','7c000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('app.feedback_decision_thread', public.create_policy_feedback('7c000000-0000-4000-8000-000000000101','Clarify contractor scope','Please include contractors.')::text, true);
select throws_ok($$ select public.decide_policy_feedback(current_setting('app.feedback_decision_thread')::uuid,'accepted','Add a contractor section') $$,'42501','only workspace operators can decide feedback','Member cannot accept feedback');

select set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$ select public.decide_policy_feedback(current_setting('app.feedback_decision_thread')::uuid,'declined','Not applicable') $$,'42501','only workspace operators can decide feedback','outsider cannot decide another workspace thread');
select is((select count(*) from public.policy_feedback_decisions), 0::bigint, 'outsider cannot read decision history');

select set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$ select public.decide_policy_feedback(current_setting('app.feedback_decision_thread')::uuid,'accepted','   ') $$,'22023','a decision reason is required','blank reason is refused');
select throws_ok($$ select public.decide_policy_feedback(current_setting('app.feedback_decision_thread')::uuid,'maybe','Reason') $$,'22023','choose accept or decline','unknown decision is refused');
select lives_ok($$ select public.decide_policy_feedback(current_setting('app.feedback_decision_thread')::uuid,'accepted','  Review at the next policy cycle.  ') $$,'Admin can accept with a reason');
select results_eq(
  $$ select status, decision, decision_rationale, resolved_by, decided_by, decided_at is not null from public.policy_feedback_threads where id = current_setting('app.feedback_decision_thread')::uuid $$,
  $$ values('resolved'::text,'accepted'::text,'Review at the next policy cycle.'::text,'7c000000-0000-4000-8000-000000000002'::uuid,'7c000000-0000-4000-8000-000000000002'::uuid,true) $$,
  'decision, reason and operator are recorded together'
);
select is((select body from public.policies where reference = 'FD-1'), 'Original document', 'accepting feedback does not edit the policy');
select results_eq(
  $$ select decision,rationale,decided_by,decided_at is not null from public.policy_feedback_decisions where thread_id = current_setting('app.feedback_decision_thread')::uuid $$,
  $$ values('accepted'::text,'Review at the next policy cycle.'::text,'7c000000-0000-4000-8000-000000000002'::uuid,true) $$,
  'first decision has its own reason, actor, and time'
);
select throws_ok($$ update public.policy_feedback_decisions set rationale = 'Tampered' $$,'42501',null,'portal caller cannot update history directly');
select throws_ok($$ delete from public.policy_feedback_decisions $$,'42501',null,'portal caller cannot delete history directly');
select set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*) from public.policy_feedback_decisions), 1::bigint, 'Member can read the decision about the approved policy');
select set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.policy_feedback_decisions), 0::bigint, 'outsider cannot read a populated decision history');
select set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$ select public.set_policy_feedback_status(current_setting('app.feedback_decision_thread')::uuid,true) $$,'22023','close feedback with an explicit decision','legacy status RPC cannot erase an explicit decision');
select throws_ok($$ select public.decide_policy_feedback(current_setting('app.feedback_decision_thread')::uuid,'declined','Changed mind') $$,'22023','feedback thread is closed','a closed thread cannot be silently re-decided');
select lives_ok($$ select public.set_policy_feedback_status(current_setting('app.feedback_decision_thread')::uuid,false) $$,'operator can reopen for reconsideration');
select results_eq(
  $$ select status,decision,decision_rationale from public.policy_feedback_threads where id = current_setting('app.feedback_decision_thread')::uuid $$,
  $$ values('open'::text,null::text,null::text) $$,
  'reopening clears the current decision'
);
select is((select count(*) from public.policy_feedback_decisions where decision = 'accepted'), 1::bigint, 'reopening preserves the accepted decision history');
select set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$ select public.decide_policy_feedback(current_setting('app.feedback_decision_thread')::uuid,'declined','Outside this policy.') $$,'Owner can decline with a reason');
select results_eq(
  $$ select decision,decision_rationale,decided_by from public.policy_feedback_threads where id = current_setting('app.feedback_decision_thread')::uuid $$,
  $$ values('declined'::text,'Outside this policy.'::text,'7c000000-0000-4000-8000-000000000001'::uuid) $$,
  'new Owner decision is visible to members of the workspace'
);
select results_eq(
  $$ select decision,rationale,decided_by from public.policy_feedback_decisions where thread_id = current_setting('app.feedback_decision_thread')::uuid order by decided_at $$,
  $$ values('accepted'::text,'Review at the next policy cycle.'::text,'7c000000-0000-4000-8000-000000000002'::uuid),('declined'::text,'Outside this policy.'::text,'7c000000-0000-4000-8000-000000000001'::uuid) $$,
  'both decisions retain reason and actor after reconsideration'
);
select lives_ok($$ select public.set_policy_feedback_status(current_setting('app.feedback_decision_thread')::uuid,false) $$,'operator can reopen the thread again');
select throws_ok($$ select public.set_policy_feedback_status(current_setting('app.feedback_decision_thread')::uuid,true) $$,'22023','close feedback with an explicit decision','legacy status RPC cannot close a new suggestion');
set local role postgres;
update public.policy_feedback_threads set status = 'resolved', resolved_at = pg_catalog.clock_timestamp(), resolved_by = '7c000000-0000-4000-8000-000000000001'::uuid
where id = current_setting('app.feedback_decision_thread')::uuid;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"7c000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select results_eq(
  $$ select status,decision from public.policy_feedback_threads where id = current_setting('app.feedback_decision_thread')::uuid $$,
  $$ values('resolved'::text,null::text) $$,
  'legacy resolution remains distinct from an explicit decision'
);
select is((select count(*) from public.policy_feedback_decisions), 2::bigint, 'legacy resolution does not erase history');

set local role postgres;
select ok((select confdeltype = 'r' from pg_catalog.pg_constraint where conname = 'policy_feedback_decisions_thread_tenant_fk'), 'decision history explicitly restricts deleting its parent thread');
select ok((select confdeltype = 'r' from pg_catalog.pg_constraint where conname = 'policy_feedback_decisions_organisation_id_fkey'), 'decision history explicitly restricts deleting its workspace');
select throws_ok($$ delete from public.policy_feedback_threads where id = current_setting('app.feedback_decision_thread')::uuid $$, 'P0001', 'policy feedback comments are immutable', 'a decided feedback thread cannot be silently deleted');
select throws_ok($$ delete from public.policies where id = '7c000000-0000-4000-8000-000000000101'::uuid $$, 'P0001', 'policy feedback comments are immutable', 'a decided policy cannot cascade away its feedback history');
select is((select count(*) from public.policy_feedback_decisions), 2::bigint, 'decision history survives rejected parent deletes');
select throws_ok($$ update public.policy_feedback_decisions set rationale = 'Tampered' $$, 'P0001', 'policy feedback decisions are immutable', 'privileged update cannot change history');
select throws_ok($$ delete from public.policy_feedback_decisions $$, 'P0001', 'policy feedback decisions are immutable', 'privileged delete cannot erase history');

select * from finish();
rollback;
