-- One RLS-scoped SQL statement builds the bounded MCP readiness/digest bundle.
-- SECURITY INVOKER is deliberate: every base-table policy remains authoritative.
create or replace function public.get_mcp_compliance_bundle(
  target_organisation_id uuid,
  target_local_date date,
  attention_limit integer default 20,
  monitoring_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '5s'
as $$
with
caller as materialized (
  select membership.role::text as role, organisation.name
  from public.memberships as membership
  join public.organisations as organisation on organisation.id = membership.organisation_id
  where membership.organisation_id = target_organisation_id
    and membership.user_id = (select auth.uid())
),
bounds as (
  select greatest(1, least(coalesce(attention_limit, 20), 50)) as attention_limit,
         greatest(1, least(coalesce(monitoring_limit, 20), 50)) as monitoring_limit
),
latest_report as materialized (
  select snapshot.id, snapshot.payload, snapshot.published_at
  from public.leadership_report_snapshots as snapshot
  cross join caller
  where snapshot.organisation_id = target_organisation_id
  order by snapshot.published_at desc, snapshot.id desc
  limit 1
),
risk_config as (
  select coalesce(config.low_max, 4) as low_max,
         coalesce(config.moderate_max, 9) as moderate_max,
         coalesce(config.high_max, 14) as high_max
  from caller
  left join public.risk_matrix_config as config on config.organisation_id = target_organisation_id
),
latest_register as (
  select register.id
  from public.soa_registers as register
  cross join caller
  where register.organisation_id = target_organisation_id
  order by register.version desc, register.id desc
  limit 1
),
soa_summary as (
  select count(*) filter (where item.status <> 'not_applicable')::integer as total,
         case when count(*) filter (where item.status <> 'not_applicable') = 0 then 0 else
           round(100 * sum(case item.status::text
             when 'in_progress' then 0.4 when 'established' then 0.7
             when 'operational' then 0.9 when 'advanced' then 1 else 0 end)
             filter (where item.status <> 'not_applicable')
             / count(*) filter (where item.status <> 'not_applicable'))::integer
         end as percent
  from latest_register as register
  left join public.soa_items as item
    on item.soa_register_id = register.id and item.organisation_id = target_organisation_id
),
risk_rows as materialized (
  select risk.id, risk.reference, risk.title, risk.review_date,
         (risk.residual_likelihood * risk.residual_impact)::integer as score
  from public.risks as risk
  cross join caller
  where risk.organisation_id = target_organisation_id and risk.status <> 'closed'
),
risk_summary as (
  select count(*) filter (where risk.score <= config.low_max)::integer as low,
         count(*) filter (where risk.score > config.low_max and risk.score <= config.moderate_max)::integer as moderate,
         count(*) filter (where risk.score > config.moderate_max and risk.score <= config.high_max)::integer as high,
         count(*) filter (where risk.score > config.high_max)::integer as very_high
  from risk_config as config left join risk_rows as risk on true
),
task_summary as (
  select count(*)::integer as open,
         count(*) filter (where task.due_on is not null and task.due_on < target_local_date)::integer as overdue
  from public.tasks as task cross join caller
  where task.organisation_id = target_organisation_id and task.status in ('open','in_progress')
),
evidence_summary as (
  select count(*)::integer as total,
         count(*) filter (where evidence.valid_until >= target_local_date and evidence.valid_until <= target_local_date + 30)::integer as expiring,
         count(*) filter (where evidence.valid_until < target_local_date)::integer as expired
  from public.evidence as evidence cross join caller
  where evidence.organisation_id = target_organisation_id and evidence.status not in ('superseded','withdrawn')
),
audit_summary as (
  select count(*)::integer as open
  from public.audits as audit cross join caller
  where audit.organisation_id = target_organisation_id and audit.status <> 'closed'
),
nonconformity_summary as (
  select count(*)::integer as open
  from public.audit_findings as finding cross join caller
  where finding.organisation_id = target_organisation_id and finding.status <> 'closed' and finding.severity <> 'observation'
),
live_overview as (
  select jsonb_build_object(
    'soaPercent', coalesce(soa.percent, 0), 'soaTotal', coalesce(soa.total, 0),
    'riskBands', jsonb_build_object('low', coalesce(risk.low, 0), 'moderate', coalesce(risk.moderate, 0), 'high', coalesce(risk.high, 0), 'very_high', coalesce(risk.very_high, 0)),
    'tasksOpen', task.open, 'tasksOverdue', task.overdue,
    'evidence', jsonb_build_object('total', evidence.total, 'expiring', evidence.expiring, 'expired', evidence.expired),
    'openAudits', audit.open, 'openNonConformities', nonconformity.open
  ) as payload
  from soa_summary soa cross join risk_summary risk cross join task_summary task
  cross join evidence_summary evidence cross join audit_summary audit cross join nonconformity_summary nonconformity
),
attention_candidates as materialized (
  select 'task:' || task.id::text as id, 'task'::text as source, 'overdue_task'::text as category,
         'high'::text as severity, 3 as severity_rank, 1 as category_rank,
         'Overdue task: ' || task.title as summary, task.due_on as due_on, null::timestamptz as observed_at
  from public.tasks task cross join caller
  where task.organisation_id = target_organisation_id and task.status in ('open','in_progress') and task.due_on < target_local_date
  union all
  select 'evidence:' || evidence.id::text, 'evidence', 'stale_evidence',
         case when evidence.valid_until < target_local_date then 'critical' else 'high' end,
         case when evidence.valid_until < target_local_date then 4 else 3 end, 2,
         case when evidence.valid_until < target_local_date then 'Expired evidence: ' else 'Expiring evidence: ' end || evidence.title,
         evidence.valid_until, null::timestamptz
  from public.evidence evidence cross join caller
  where evidence.organisation_id = target_organisation_id and evidence.status not in ('superseded','withdrawn')
    and evidence.valid_until is not null and evidence.valid_until <= target_local_date + 30
  union all
  select 'policy:' || policy.id::text, 'policy', 'policy_review', 'high', 3, 3,
         'Policy review due: ' || policy.reference || ' ' || policy.title, policy.review_due, null::timestamptz
  from public.policies policy cross join caller
  where policy.organisation_id = target_organisation_id and policy.status = 'approved' and policy.review_due <= target_local_date
  union all
  select 'risk:' || risk.id::text, 'risk', 'high_risk', case when risk.score > config.high_max then 'critical' else 'high' end,
         case when risk.score > config.high_max then 4 else 3 end, 4,
         case when risk.score > config.high_max then 'Very high residual risk: ' else 'High residual risk: ' end || risk.reference || ' ' || risk.title,
         risk.review_date, null::timestamptz
  from risk_rows risk cross join risk_config config where risk.score > config.moderate_max
  union all
  select 'audit_finding:' || finding.id::text, 'audit_finding', 'unresolved_finding',
         case finding.severity::text when 'major_nc' then 'critical' when 'minor_nc' then 'high' else 'medium' end,
         case finding.severity::text when 'major_nc' then 4 when 'minor_nc' then 3 else 2 end, 5,
         'Unresolved ' || case finding.severity::text when 'major_nc' then 'major non-conformity' when 'minor_nc' then 'minor non-conformity' else 'observation' end || ' in audit ' || audit.reference,
         null::date, finding.created_at
  from public.audit_findings finding join public.audits audit on audit.id = finding.audit_id and audit.organisation_id = finding.organisation_id
  cross join caller
  where finding.organisation_id = target_organisation_id and finding.status <> 'closed'
),
attention_top as (
  select candidate.* from attention_candidates candidate cross join bounds
  order by candidate.severity_rank desc,
    coalesce(candidate.due_on::timestamp at time zone 'Europe/London', candidate.observed_at, 'infinity'::timestamptz),
    candidate.category_rank, candidate.source, candidate.id
  limit (select attention_limit + 1 from bounds)
),
attention_json as (
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', id, 'source', source, 'category', category, 'severity', severity, 'summary', summary,
    'dueOn', due_on, 'observedOn', observed_at
  )) order by severity_rank desc, coalesce(due_on::timestamp at time zone 'Europe/London', observed_at, 'infinity'::timestamptz), category_rank, source, id), '[]'::jsonb) as items
  from attention_top
),
monitoring_top as (
  select finding.id, finding.control_ref, finding.severity::text as severity, finding.title, finding.status::text as status,
         (finding.task_id is not null) as has_remediation_task, finding.detected_at, finding.resolved_at
  from public.monitoring_findings finding cross join caller cross join bounds
  where finding.organisation_id = target_organisation_id and finding.status in ('open','acknowledged')
  order by finding.severity desc, finding.detected_at desc, finding.id
  limit (select monitoring_limit + 1 from bounds)
),
monitoring_json as (
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', 'monitoring_finding:' || id::text, 'severity', severity, 'status', status, 'title', title,
    'controlRef', nullif(control_ref, ''), 'detectedAt', detected_at, 'resolvedAt', resolved_at,
    'hasRemediationTask', has_remediation_task
  )) order by severity desc, detected_at desc, id), '[]'::jsonb) as items
  from monitoring_top
),
delivery as (
  select jsonb_build_object('id', delivery.id, 'status', delivery.status::text, 'deliveredAt', delivery.delivered_at) as value
  from public.daily_digest_deliveries delivery cross join caller
  where caller.role = 'owner' and delivery.organisation_id = target_organisation_id and delivery.digest_on = target_local_date
  limit 1
)
select jsonb_build_object(
  'schemaVersion', 1,
  'workspace', jsonb_build_object('id', target_organisation_id, 'name', caller.name, 'role', caller.role),
  'overviewSource', case when caller.role = 'member' then 'published' else 'live' end,
  'overview', case when caller.role = 'member' then latest_report.payload else live_overview.payload end,
  'attentionItems', attention_json.items,
  'monitoringFindings', monitoring_json.items,
  'latestLeadershipReport', case when latest_report.id is null then null else jsonb_build_object('id', latest_report.id, 'publishedAt', latest_report.published_at) end,
  'delivery', delivery.value
)
from caller
cross join live_overview cross join attention_json cross join monitoring_json
left join latest_report on true left join delivery on true;
$$;

alter function public.get_mcp_compliance_bundle(uuid,date,integer,integer) owner to postgres;
revoke all on function public.get_mcp_compliance_bundle(uuid,date,integer,integer) from public, anon, service_role;
grant execute on function public.get_mcp_compliance_bundle(uuid,date,integer,integer) to authenticated;
