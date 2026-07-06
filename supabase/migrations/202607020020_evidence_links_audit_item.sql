-- Phase C1: allow an evidence record to be linked to an audit checklist item.
-- evidence_links already models "evidence attached to exactly one of {control,
-- risk, task, policy}"; we add audit_checklist_item as a fifth target. It
-- reuses the table's organisation_id, composite tenant FKs, split RLS and audit
-- trigger, so no new table is warranted.
--
-- The existing "exactly one target" check is AUTO-NAMED by Postgres (currently
-- evidence_links_check). Rather than trust that generated name, we DISCOVER it
-- at migration time: the sole check on public.evidence_links whose definition
-- mentions num_nonnulls. We drop it by its real name and re-add the widened
-- rule under an EXPLICIT name (evidence_links_one_target) so future migrations
-- are not brittle. Mirrors how Phase B Task 6 handled the SoA auto-named check.

alter table public.evidence_links add column audit_checklist_item_id uuid;

alter table public.evidence_links
  add constraint evidence_links_audit_item_tenant_fk foreign key (audit_checklist_item_id, organisation_id)
    references public.audit_checklist_items(id, organisation_id) on delete cascade;

do $$
declare
  target_constraint text;
begin
  select conname into target_constraint
  from pg_constraint
  where conrelid = 'public.evidence_links'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%num_nonnulls%';

  if target_constraint is null then
    raise exception 'could not find the num_nonnulls one-target check on public.evidence_links';
  end if;

  execute format('alter table public.evidence_links drop constraint %I', target_constraint);
end $$;

alter table public.evidence_links
  add constraint evidence_links_one_target check (
    num_nonnulls(control_id, risk_id, task_id, policy_id, audit_checklist_item_id) = 1);

alter table public.evidence_links add constraint evidence_links_evidence_audit_item_key
  unique (evidence_id, audit_checklist_item_id);
