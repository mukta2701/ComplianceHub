-- Phase C4: the ONLY elevated read for an unauthenticated auditor. Token-gated,
-- org-scoped inside the body (every query filtered by the resolved
-- organisation_id), returns no other tenant's data by construction. security
-- definer because an anon visitor has no RLS identity; this is NOT the
-- service-role client. Hashing mirrors public.accept_invitation. Refuses
-- expired / revoked / unknown tokens by returning null.

create or replace function public.audit_view_for_token(raw_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  token_row public.auditor_access_tokens;
  target_org uuid;
  latest_register uuid;
begin
  select * into token_row from public.auditor_access_tokens
  where token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'), 'hex')
    and revoked_at is null and expires_at > now();
  if not found then
    return null;
  end if;
  target_org := token_row.organisation_id;
  select id into latest_register from public.soa_registers
    where organisation_id = target_org order by version desc limit 1;
  return jsonb_build_object(
    'organisationName', (select name from public.organisations where id = target_org),
    'framework', token_row.framework,
    'generatedAt', now(),
    'soa', coalesce((select jsonb_agg(jsonb_build_object('status', i.status))
        from public.soa_items i where i.soa_register_id = latest_register), '[]'::jsonb),
    'risks', coalesce((select jsonb_agg(jsonb_build_object('likelihood', r.likelihood, 'impact', r.impact))
        from public.risks r where r.organisation_id = target_org), '[]'::jsonb),
    'tasks', jsonb_build_object(
        'open', (select count(*) from public.tasks t where t.organisation_id = target_org and t.status in ('open','in_progress')),
        'overdue', (select count(*) from public.tasks t where t.organisation_id = target_org and t.status in ('open','in_progress') and t.due_on is not null and t.due_on < current_date)),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object('status', e.status))
        from public.evidence e where e.organisation_id = target_org), '[]'::jsonb),
    'audits', coalesce((select jsonb_agg(jsonb_build_object('status', a.status))
        from public.audits a where a.organisation_id = target_org), '[]'::jsonb),
    'openNonConformities', (select count(*) from public.audit_findings f
        where f.organisation_id = target_org and f.status <> 'closed' and f.severity in ('minor_nc','major_nc')),
    'audit', case when token_row.audit_id is null then null else (
      select jsonb_build_object(
        'reference', a.reference, 'title', a.title, 'status', a.status, 'scope', a.scope,
        'checklist', coalesce((select jsonb_agg(jsonb_build_object(
            'area', c.area, 'clauseReference', c.clause_reference, 'checklistItem', c.checklist_item,
            'compliant', c.compliant, 'evidenceNote', c.evidence_note) order by c.position)
          from public.audit_checklist_items c where c.audit_id = a.id), '[]'::jsonb),
        'findings', coalesce((select jsonb_agg(jsonb_build_object('summary', f.summary, 'severity', f.severity, 'status', f.status) order by f.created_at)
          from public.audit_findings f where f.audit_id = a.id), '[]'::jsonb))
      from public.audits a where a.id = token_row.audit_id and a.organisation_id = target_org) end
  );
end;
$$;

revoke all on function public.audit_view_for_token(text) from public;
grant usage on schema public to anon;
grant execute on function public.audit_view_for_token(text) to anon, authenticated;
