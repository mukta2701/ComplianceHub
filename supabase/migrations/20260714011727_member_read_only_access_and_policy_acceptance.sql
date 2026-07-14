-- Member portal authorization foundation.
--
-- Ordinary Members retain tenant-scoped read access to curated operational
-- records, but every direct operational mutation is restricted to Owner/Admin
-- operators. Lifecycle/self-service policies (workspace bootstrap, invitation
-- acceptance, delegated membership management, own profile and notification
-- state) are deliberately outside the operational policy inventory below.

do $migration$
declare
  policy_row record;
  operator_using text;
  operator_check text;
begin
  for policy_row in
    select p.tablename, p.policyname, p.cmd, p.qual, p.with_check
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(array[
        'alert_channels', 'assessment_responses', 'assessment_sessions',
        'asset_categories', 'asset_risks', 'assets', 'audit_checklist_items',
        'audit_findings', 'auditor_access_tokens', 'audits',
        'control_crosswalks', 'evidence', 'evidence_links', 'evidence_sources',
        'integration_connections', 'kpi_measurements', 'kpis', 'monitor_sources',
        'monitoring_findings', 'policies', 'risk_categories',
        'risk_matrix_config', 'risk_treatment_plans', 'risks', 'soa_items',
        'soa_registers', 'soa_snapshots', 'task_tickets', 'tasks',
        'trust_center_settings'
      ])
      and p.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    order by p.tablename, p.policyname
  loop
    operator_using := pg_catalog.regexp_replace(
      policy_row.qual,
      '(public\.)?is_organisation_(member|owner)',
      'public.is_organisation_operator',
      'g'
    );
    operator_check := pg_catalog.regexp_replace(
      policy_row.with_check,
      '(public\.)?is_organisation_(member|owner)',
      'public.is_organisation_operator',
      'g'
    );

    if policy_row.cmd = 'INSERT' then
      execute pg_catalog.format(
        'alter policy %I on public.%I with check (%s)',
        policy_row.policyname,
        policy_row.tablename,
        operator_check
      );
    elsif policy_row.cmd = 'DELETE' then
      execute pg_catalog.format(
        'alter policy %I on public.%I using (%s)',
        policy_row.policyname,
        policy_row.tablename,
        operator_using
      );
    else
      execute pg_catalog.format(
        'alter policy %I on public.%I using (%s) with check (%s)',
        policy_row.policyname,
        policy_row.tablename,
        operator_using,
        operator_check
      );
    end if;
  end loop;
end;
$migration$;

-- These legacy ALL policies now gate operators. Add narrow SELECT policies so
-- Members can still read the curated assessment and SoA data in their tenant.
create policy assessment_sessions_member_select
on public.assessment_sessions for select to authenticated
using (public.is_organisation_member(organisation_id));

create policy assessment_responses_member_select
on public.assessment_responses for select to authenticated
using (public.is_organisation_member(organisation_id));

create policy soa_registers_member_select
on public.soa_registers for select to authenticated
using (public.is_organisation_member(organisation_id));

create policy soa_items_member_select
on public.soa_items for select to authenticated
using (public.is_organisation_member(organisation_id));

-- Sensitive connection/source/alert configuration and external-auditor access
-- metadata are visible to operators only. Admin gains the same operational
-- connection control as Owner.
do $migration$
declare
  policy_row record;
  operator_using text;
begin
  for policy_row in
    select p.tablename, p.policyname, p.qual
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(array[
        'alert_channels', 'auditor_access_log', 'auditor_access_tokens',
        'evidence_sources', 'integration_connections', 'monitor_sources',
        'trust_center_settings'
      ])
      and p.cmd = 'SELECT'
  loop
    operator_using := pg_catalog.regexp_replace(
      policy_row.qual,
      '(public\.)?is_organisation_(member|owner)',
      'public.is_organisation_operator',
      'g'
    );
    execute pg_catalog.format(
      'alter policy %I on public.%I using (%s)',
      policy_row.policyname,
      policy_row.tablename,
      operator_using
    );
  end loop;
end;
$migration$;

-- Members can see only the live approved policy. Operators retain full draft,
-- review, approved, and archived visibility for policy management.
drop policy if exists policies_members_select on public.policies;
create policy policies_curated_select
on public.policies for select to authenticated
using (
  public.is_organisation_operator(organisation_id)
  or (
    public.is_organisation_member(organisation_id)
    and status = 'approved'
  )
);

-- Audit rows are trigger-generated facts. No authenticated client, including an
-- operator, may forge them directly.
drop policy if exists audit_events_insert_members on public.audit_events;
revoke insert on public.audit_events from authenticated;

-- Evidence files remain readable by tenant Members, but upload is an
-- operational mutation and therefore operator-only.
drop policy if exists evidence_objects_members_insert on storage.objects;
create policy evidence_objects_operator_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'evidence'
  and public.is_organisation_operator(((storage.foldername(name))[1])::uuid)
);

-- Existing authenticated mutation RPCs that used SECURITY DEFINER and only
-- checked membership must check the stronger operator capability. Rebuild from
-- each installed definition so prior concurrency and invariant hardening remains
-- byte-for-byte intact apart from this authorization predicate.
do $migration$
declare
  function_row record;
  hardened_definition text;
begin
  for function_row in
    select p.oid, p.proname, pg_catalog.pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'create_soa_draft', 'create_soa_successor', 'finalise_soa',
        'notify_policy_reaccept', 'save_assessment_response'
      ])
  loop
    if function_row.definition not like '%public.is_organisation_member(%' then
      raise exception 'expected member authorization guard is missing from %', function_row.proname;
    end if;

    hardened_definition := pg_catalog.replace(
      function_row.definition,
      'public.is_organisation_member(',
      'public.is_organisation_operator('
    );
    if function_row.proname = 'notify_policy_reaccept' then
      hardened_definition := pg_catalog.replace(
        hardened_definition,
        'not a member of the policy organisation',
        'not an operator of the policy organisation'
      );
    end if;
    execute hardened_definition;
  end loop;
end;
$migration$;

create or replace function public.complete_recurring_task(target_task_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_task public.tasks;
  successor_due_on date;
  target_organisation_id uuid;
begin
  select task.organisation_id
  into target_organisation_id
  from public.tasks as task
  where task.id = target_task_id;

  if not found then
    return false;
  end if;
  if not public.is_organisation_operator(target_organisation_id) then
    raise exception 'only workspace operators can complete recurring tasks'
      using errcode = '42501';
  end if;

  select task.*
  into source_task
  from public.tasks as task
  where task.id = target_task_id
  for update;

  if not found then
    return false;
  end if;
  if source_task.status = 'done' then
    return false;
  end if;
  if source_task.recurrence is null or source_task.due_on is null then
    raise exception 'Task is not recurring' using errcode = '22023';
  end if;

  successor_due_on := case source_task.recurrence
    when 'weekly' then source_task.due_on + 7
    when 'monthly' then (source_task.due_on + interval '1 month')::date
    when 'quarterly' then (source_task.due_on + interval '3 months')::date
    when 'semiannually' then (source_task.due_on + interval '6 months')::date
    when 'annually' then (source_task.due_on + interval '1 year')::date
  end;

  update public.tasks
  set status = 'done', updated_at = pg_catalog.now()
  where id = source_task.id;

  insert into public.tasks (
    organisation_id, title, detail, owner_id, due_on, recurrence, source,
    control_id, risk_id, created_by
  ) values (
    source_task.organisation_id,
    source_task.title,
    source_task.detail,
    source_task.owner_id,
    successor_due_on,
    source_task.recurrence,
    source_task.source,
    source_task.control_id,
    source_task.risk_id,
    (select auth.uid())
  );
  return true;
end;
$$;

create or replace function public.create_evidence_record(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
  target_organisation_id uuid;
begin
  target_organisation_id := nullif(payload ->> 'organisation_id', '')::uuid;
  if target_organisation_id is null
    or not public.is_organisation_operator(target_organisation_id)
  then
    raise exception 'only workspace operators can create evidence'
      using errcode = '42501';
  end if;

  insert into public.evidence (
    organisation_id, title, kind, storage_path, url, description, owner_id,
    collected_on, valid_until, review_interval, status, replaces_evidence_id,
    created_by
  ) values (
    target_organisation_id,
    payload ->> 'title',
    (payload ->> 'kind')::public.evidence_kind,
    nullif(payload ->> 'storage_path', ''),
    nullif(payload ->> 'url', ''),
    coalesce(payload ->> 'description', ''),
    nullif(payload ->> 'owner_id', '')::uuid,
    (payload ->> 'collected_on')::date,
    nullif(payload ->> 'valid_until', '')::date,
    nullif(payload ->> 'review_interval', '')::public.task_recurrence,
    (payload ->> 'status')::public.evidence_status,
    nullif(payload ->> 'replaces_evidence_id', '')::uuid,
    (select auth.uid())
  )
  returning id into created_id;

  if nullif(payload ->> 'replaces_evidence_id', '') is not null then
    update public.evidence
    set status = 'superseded'
    where id = (payload ->> 'replaces_evidence_id')::uuid
      and organisation_id = target_organisation_id;
    if not found then
      raise exception 'replacement evidence not found';
    end if;
  end if;
  return created_id;
end;
$$;

-- RLS is the primary gate, and this trigger is defense in depth: a policy row
-- may be changed only by an Owner/Admin operator. Assignment as policy owner is
-- metadata, not a write-capability grant to an ordinary Member.
create or replace function public.enforce_policy_update_authz()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.to_jsonb(new) is distinct from pg_catalog.to_jsonb(old)
    and not public.is_organisation_operator(old.organisation_id)
  then
    raise exception 'only workspace operators can edit or approve policies'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Policy acceptance is deliberately not a table mutation surface. The RPC
-- derives every security-sensitive field, holds the policy and membership stable
-- for the transaction, and upserts one row safely under concurrent requests.
drop policy if exists policy_acceptances_members_select on public.policy_acceptances;
drop policy if exists policy_acceptances_members_insert on public.policy_acceptances;
drop policy if exists policy_acceptances_members_update on public.policy_acceptances;
drop policy if exists policy_acceptances_members_delete on public.policy_acceptances;

create policy policy_acceptances_operator_select
on public.policy_acceptances for select to authenticated
using (public.is_organisation_operator(organisation_id));

create policy policy_acceptances_member_own_select
on public.policy_acceptances for select to authenticated
using (
  public.is_organisation_member(organisation_id)
  and user_id = (select auth.uid())
);

revoke all privileges on table public.policy_acceptances from public, anon, authenticated;
grant select on public.policy_acceptances to authenticated;

create or replace function public.accept_policy(target_policy_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_organisation_id uuid;
  target_version integer;
  acceptance_id uuid;
begin
  if actor_id is null or not exists (
    select 1
    from auth.users as account
    where account.id = actor_id
      and account.email_confirmed_at is not null
  ) then
    raise exception 'verified authentication required' using errcode = '42501';
  end if;

  select policy.organisation_id, policy.version
  into target_organisation_id, target_version
  from public.policies as policy
  where policy.id = target_policy_id
    and policy.status = 'approved'
  for share;

  if not found then
    raise exception 'policy is not available for acceptance' using errcode = '42501';
  end if;

  perform 1
  from public.memberships as membership
  where membership.organisation_id = target_organisation_id
    and membership.user_id = actor_id
  for share;

  if not found then
    raise exception 'policy is not available for acceptance' using errcode = '42501';
  end if;

  insert into public.policy_acceptances (
    organisation_id,
    policy_id,
    user_id,
    accepted_version,
    accepted_at
  ) values (
    target_organisation_id,
    target_policy_id,
    actor_id,
    target_version,
    pg_catalog.clock_timestamp()
  )
  on conflict (policy_id, user_id) do update
  set organisation_id = excluded.organisation_id,
      accepted_version = excluded.accepted_version,
      accepted_at = excluded.accepted_at
  returning id into acceptance_id;

  return acceptance_id;
end;
$$;

alter function public.accept_policy(uuid) owner to postgres;
revoke all on function public.accept_policy(uuid) from public;
revoke all on function public.accept_policy(uuid) from anon;
grant execute on function public.accept_policy(uuid) to authenticated;
