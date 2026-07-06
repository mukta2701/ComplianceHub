-- Phase D1: enable evidence -> policy links. evidence_links.policy_id already
-- exists and is already counted by the one-target check evidence_links_one_target
-- (widened in 202607020020); unique (evidence_id, policy_id) already exists too.
-- policy_id was only held null by the named check evidence_links_policy_deferred,
-- and it lacked a tenant FK. Drop the deferral and add the composite tenant FK.

alter table public.evidence_links drop constraint if exists evidence_links_policy_deferred;

alter table public.evidence_links
  add constraint evidence_links_policy_tenant_fk foreign key (policy_id, organisation_id)
    references public.policies(id, organisation_id) on delete cascade;
