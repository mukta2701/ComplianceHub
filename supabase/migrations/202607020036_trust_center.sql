-- Phase B4: public Trust Center. An owner-controlled, OFF-by-default, read-only
-- public page (a sales/trust asset). This mirrors Phase C's auditor-view
-- security model but is PUBLIC (no token) and exposes ONLY a tightly
-- whitelisted, positive summary — never sensitive detail.
--
-- trust_center_settings is an owner-only, one-row-per-organisation settings
-- table. A workspace is invisible publicly until an owner sets enabled = true
-- and picks a slug. The public read path is the security-definer
-- public.trust_center_view RPC below (granted to anon), NOT this table's RLS —
-- an unauthenticated visitor has no RLS identity.

create table public.trust_center_settings (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  enabled boolean not null default false,
  slug text unique check (slug is null or slug ~ '^[a-z0-9-]+$'),
  show_policy_titles boolean not null default false,
  headline text check (headline is null or char_length(headline) <= 280),
  updated_at timestamptz not null default now()
);

-- capture_audit_event derives entity_id from the row's 'id' (or 'user_id' for
-- membership-keyed tables). This table's primary key is organisation_id and it
-- has neither column, so extend the fallback chain to organisation_id. The new
-- final coalesce arm changes NOTHING for existing audited tables (they all
-- expose 'id' or 'user_id' earlier in the chain); it only rescues org-keyed
-- settings rows whose entity_id would otherwise be null and violate the
-- audit_events.entity_id not-null / length check.
create or replace function public.capture_audit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; org_id uuid; record_id text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  org_id := case tg_table_name
    when 'organisations' then (row_data ->> 'id')::uuid
    when 'assessment_responses' then (
      select organisation_id from public.assessment_sessions
      where id = (row_data ->> 'session_id')::uuid
    )
    when 'soa_items' then (
      select organisation_id from public.soa_registers
      where id = (row_data ->> 'soa_register_id')::uuid
    )
    else (row_data ->> 'organisation_id')::uuid
  end;
  record_id := coalesce(row_data ->> 'id', row_data ->> 'user_id', row_data ->> 'organisation_id');
  insert into public.audit_events (organisation_id, actor_id, action, entity_type, entity_id, metadata)
  values (org_id, (select auth.uid()), lower(tg_op), tg_table_name, record_id, '{}'::jsonb);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trust_center_settings_audit after insert or update or delete on public.trust_center_settings
for each row execute function public.capture_audit_event();

-- Owner-only management on every verb. is_organisation_owner gates both tenant
-- and role, so regular members can neither see nor change these settings.
alter table public.trust_center_settings enable row level security;
create policy trust_center_owner_select on public.trust_center_settings for select to authenticated
using (public.is_organisation_owner(organisation_id));
create policy trust_center_owner_insert on public.trust_center_settings for insert to authenticated
with check (public.is_organisation_owner(organisation_id));
create policy trust_center_owner_update on public.trust_center_settings for update to authenticated
using (public.is_organisation_owner(organisation_id)) with check (public.is_organisation_owner(organisation_id));
create policy trust_center_owner_delete on public.trust_center_settings for delete to authenticated
using (public.is_organisation_owner(organisation_id));

revoke all on public.trust_center_settings from anon, authenticated;
grant select, insert, update, delete on public.trust_center_settings to authenticated;

-- The ONLY public read path. security definer because an anon visitor has no
-- RLS identity; this is NOT the service-role client. Org-scoped inside the body
-- (every internal query filters by the resolved organisation_id), so no other
-- tenant's data is reachable by construction. Returns ONLY the safe whitelist,
-- and only when the slug maps to an ENABLED Trust Center; an unknown or disabled
-- slug returns null (no existence oracle beyond enabled-or-not).
create or replace function public.trust_center_view(target_slug text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  settings_row public.trust_center_settings;
  target_org uuid;
  latest_register uuid;
  readiness integer;
begin
  select * into settings_row from public.trust_center_settings
  where slug = target_slug and enabled = true;
  if not found then
    return null;
  end if;
  target_org := settings_row.organisation_id;

  -- Readiness % over the latest SoA register, using the same maturity weighting
  -- as summariseSoaReadiness (not_applicable excluded from the base).
  select id into latest_register from public.soa_registers
    where organisation_id = target_org order by version desc limit 1;
  select case when count(*) = 0 then 0 else round(
      sum(case i.status
        when 'in_progress' then 0.4 when 'established' then 0.7
        when 'operational' then 0.9 when 'advanced' then 1 else 0 end)
      / count(*) * 100) end
    into readiness
    from public.soa_items i
    where i.soa_register_id = latest_register and i.status <> 'not_applicable';

  return jsonb_build_object(
    'organisationName', (select name from public.organisations where id = target_org),
    'headline', settings_row.headline,
    'readinessPercent', coalesce(readiness, 0),
    'controlsInScope', (select count(*) from public.soa_items i
        where i.soa_register_id = latest_register and i.applicable = true),
    'approvedPolicyCount', (select count(*) from public.policies p
        where p.organisation_id = target_org and p.status = 'approved'),
    'policyTitles', case when settings_row.show_policy_titles then
        coalesce((select jsonb_agg(p.title order by p.reference)
          from public.policies p where p.organisation_id = target_org and p.status = 'approved'), '[]'::jsonb)
      else null end,
    'latestAuditDate', (select max(coalesce(a.planned_end, a.updated_at::date))
        from public.audits a where a.organisation_id = target_org and a.status = 'closed'),
    'updatedAt', settings_row.updated_at
  );
end;
$$;

revoke all on function public.trust_center_view(text) from public;
grant usage on schema public to anon;
grant execute on function public.trust_center_view(text) to anon, authenticated;
