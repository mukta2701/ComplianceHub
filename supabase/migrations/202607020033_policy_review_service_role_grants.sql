-- Phase D (B6): scheduled policy review reminders. The daily automation sweep
-- (src/app/api/cron/daily/route.ts) now also flags approved policies whose
-- `review_due` date has arrived, raising a `policy_review` task and notifying the
-- policy owner. Two things the sweep needs are missing today:
--
-- 1. SELECT on public.policies for the service role. The 0009 grants (the only
--    prior service_role DML) never covered policies — that table arrived later in
--    Phase D1 and only granted `authenticated`. Without this the sweep's service
--    client gets "permission denied" reading policies. Grant is SELECT-only:
--    least-privilege, matching 0009 — the sweep never writes policies, so no
--    INSERT/UPDATE/DELETE is granted (the deliberate per-table speed bump stays).
--
-- 2. A durable link from a task to the policy it was raised for, so the sweep can
--    dedup exactly like evidence expiry does. public.tasks already carries a
--    `policy_id` column, but it was held null by the `tasks_policy_deferred`
--    check (Phase D deferred it, exactly as evidence_links.policy_id was deferred
--    until 202607020027 enabled it). Enable it the same way: drop the deferring
--    check, add a composite tenant FK into policies, and a per-source unique key
--    mirroring `tasks_evidence_source_key`. The unique key is the database
--    backstop that keeps the sweep from re-raising a policy_review task for the
--    same policy day after day; the sweep also skips any policy with an already
--    open policy_review task at the application layer.

grant select on public.policies to service_role;

alter table public.tasks drop constraint tasks_policy_deferred;
alter table public.tasks add constraint tasks_policy_tenant_fk foreign key (policy_id, organisation_id)
  references public.policies(id, organisation_id) on delete set null (policy_id);
alter table public.tasks add constraint tasks_policy_source_key
  unique (organisation_id, policy_id, source);
