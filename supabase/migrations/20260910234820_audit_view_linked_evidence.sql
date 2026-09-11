-- Keep the anonymous auditor payload date-honest and let an audit-scoped link
-- expose only the structured evidence already attached to that audit's
-- checklist. The function remains the single token-gated, tenant-bounded read.
create index if not exists evidence_links_audit_item_org_created_idx
  on public.evidence_links(audit_checklist_item_id, organisation_id, created_at);

create or replace function public.audit_view_for_token(raw_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  token_row public.auditor_access_tokens;
  target_org uuid;
  latest_register uuid;
begin
  if raw_token is null or octet_length(raw_token) = 0 or octet_length(raw_token) > 256 then
    return null;
  end if;
  if public.increment_rate_limit('auditor:global', 60000) > 300 then
    return null;
  end if;

  select * into token_row from public.auditor_access_tokens
  where token_hash = pg_catalog.encode(extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'), 'hex')
    and revoked_at is null and expires_at > now();
  if not found then
    return null;
  end if;

  if public.increment_rate_limit('auditor:token:' || token_row.id::text, 60000) > 30 then
    return null;
  end if;

  target_org := token_row.organisation_id;

  insert into public.auditor_access_log (organisation_id, token_id)
  values (target_org, token_row.id);

  select id into latest_register from public.soa_registers
    where organisation_id = target_org order by version desc limit 1;

  return jsonb_build_object(
    'organisationName', (select name from public.organisations where id = target_org),
    'accessScope', case when token_row.audit_id is null then 'organisation' else 'audit' end,
    'framework', case when token_row.audit_id is null then 'Workspace readiness' else coalesce((select a.framework from public.audits a where a.id = token_row.audit_id and a.organisation_id = target_org), token_row.framework) end,
    'generatedAt', now(),
    'soa', case when token_row.audit_id is null then coalesce((select jsonb_agg(jsonb_build_object('status', i.status))
        from public.soa_items i where i.soa_register_id = latest_register), '[]'::jsonb) else '[]'::jsonb end,
    'risks', case when token_row.audit_id is null then coalesce((select jsonb_agg(jsonb_build_object('likelihood', r.likelihood, 'impact', r.impact))
        from public.risks r where r.organisation_id = target_org), '[]'::jsonb) else '[]'::jsonb end,
    'tasks', case when token_row.audit_id is null then jsonb_build_object(
        'open', (select count(*) from public.tasks t where t.organisation_id = target_org and t.status in ('open','in_progress')),
        'overdue', (select count(*) from public.tasks t where t.organisation_id = target_org and t.status in ('open','in_progress') and t.due_on is not null and t.due_on < current_date))
      else jsonb_build_object('open', 0, 'overdue', 0) end,
    'evidence', case when token_row.audit_id is null then coalesce((select jsonb_agg(jsonb_build_object(
        'status', case
          when e.status in ('withdrawn','superseded') then e.status
          when e.status = 'expired' or (e.valid_until is not null and e.valid_until < current_date) then 'expired'::public.evidence_status
          when e.status = 'expiring' or (e.valid_until is not null and e.valid_until <= current_date + 30) then 'expiring'::public.evidence_status
          else 'current'::public.evidence_status
        end)) from public.evidence e where e.organisation_id = target_org), '[]'::jsonb) else '[]'::jsonb end,
    'audits', case when token_row.audit_id is null then coalesce((select jsonb_agg(jsonb_build_object('status', a.status))
        from public.audits a where a.organisation_id = target_org), '[]'::jsonb) else '[]'::jsonb end,
    'openNonConformities', case when token_row.audit_id is null then (select count(*) from public.audit_findings f
        where f.organisation_id = target_org and f.status <> 'closed' and f.severity in ('minor_nc','major_nc')) else 0 end,
    'audit', case when token_row.audit_id is null then null else (
      select jsonb_build_object(
        'reference', a.reference,
        'title', a.title,
        'status', a.status,
        'scope', a.scope,
        'checklist', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'area', c.area,
            'clauseReference', c.clause_reference,
            'checklistItem', c.checklist_item,
            'compliant', c.compliant,
            'evidenceNote', c.evidence_note,
            'linkedEvidence', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', e.id,
                'title', e.title,
                'kind', e.kind,
                'status', case
                  when e.status in ('withdrawn','superseded') then e.status
                  when e.status = 'expired' or (e.valid_until is not null and e.valid_until < current_date) then 'expired'::public.evidence_status
                  when e.status = 'expiring' or (e.valid_until is not null and e.valid_until <= current_date + 30) then 'expiring'::public.evidence_status
                  else 'current'::public.evidence_status
                end,
                'collectedOn', e.collected_on,
                'validUntil', e.valid_until,
                'sourceProvider', s.provider,
                'sourceLabel', s.label,
                'linkedOn', el.created_at
              ) order by el.created_at)
              from public.evidence_links el
              join public.evidence e on e.id = el.evidence_id and e.organisation_id = target_org
              left join public.evidence_sources s on s.id = e.source_id and s.organisation_id = target_org
              where el.audit_checklist_item_id = c.id
                and el.organisation_id = target_org
            ), '[]'::jsonb)
          ) order by c.position)
          from public.audit_checklist_items c
          where c.audit_id = a.id and c.organisation_id = target_org), '[]'::jsonb),
        'findings', coalesce((select jsonb_agg(jsonb_build_object(
            'summary', f.summary,
            'severity', f.severity,
            'status', f.status,
            'checklistItemId', f.checklist_item_id
          ) order by f.created_at)
          from public.audit_findings f
          where f.audit_id = a.id and f.organisation_id = target_org), '[]'::jsonb))
      from public.audits a
      where a.id = token_row.audit_id and a.organisation_id = target_org
    ) end
  );
end;
$$;

revoke all on function public.audit_view_for_token(text) from public;
grant execute on function public.audit_view_for_token(text) to anon, authenticated;
