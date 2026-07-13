-- Append-only access trail for public auditor links. The only write path is the
-- successful branch of public.audit_view_for_token; owners may read a bounded
-- projection through RLS, while anon/authenticated callers receive no writes.

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'auditor_access_tokens_id_org_key'
      and conrelid = 'public.auditor_access_tokens'::regclass
  ) then
    alter table public.auditor_access_tokens
      add constraint auditor_access_tokens_id_org_key unique (id, organisation_id);
  end if;
end;
$$;

create table if not exists public.auditor_access_log (
  id uuid primary key default extensions.gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  token_id uuid not null,
  viewed_at timestamptz not null default now(),
  constraint auditor_access_log_token_tenant_fk
    foreign key (token_id, organisation_id)
    references public.auditor_access_tokens(id, organisation_id) on delete restrict
);

-- Rebuild the FK on every application so databases that previously applied an
-- earlier CASCADE version are hardened too. Logged tokens must be revoked, not
-- deleted: retaining the parent preserves the immutable access history.
alter table public.auditor_access_log
  drop constraint if exists auditor_access_log_token_tenant_fk;
alter table public.auditor_access_log
  add constraint auditor_access_log_token_tenant_fk
  foreign key (token_id, organisation_id)
  references public.auditor_access_tokens(id, organisation_id) on delete restrict;

create index if not exists auditor_access_log_org_time_idx
  on public.auditor_access_log(organisation_id, viewed_at desc);
create index if not exists auditor_access_log_token_time_idx
  on public.auditor_access_log(token_id, viewed_at desc);

-- This table is itself the access trail. A capture_audit_event trigger would
-- duplicate each view into member-readable activity and flood that feed. The
-- drop also cleans up databases that applied an earlier migration revision.
drop trigger if exists auditor_access_log_audit on public.auditor_access_log;

alter table public.auditor_access_log enable row level security;
drop policy if exists auditor_access_log_owner_select on public.auditor_access_log;
create policy auditor_access_log_owner_select
on public.auditor_access_log for select to authenticated
using (public.is_organisation_owner(organisation_id));

revoke all on public.auditor_access_log from anon, authenticated;
grant select on public.auditor_access_log to authenticated;

-- Preserve the public token contract and payload. The log insert is deliberately
-- after the valid/unexpired/unrevoked lookup and before payload construction, so
-- failed token resolution returns null without recording an access.
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

  insert into public.auditor_access_log (organisation_id, token_id)
  values (target_org, token_row.id);

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
grant execute on function public.audit_view_for_token(text) to anon, authenticated;
