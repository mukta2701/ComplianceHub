import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { summariseSoaReadiness } from "@/features/soa/domain/readiness";
import type { SoaStatus } from "@/features/soa/domain/soa";
import { buildOnboardingChecklist } from "@/features/onboarding/domain/checklist";
import {
  prioritiseDashboardActions,
  type DashboardActionInput,
  type PrioritisedAction,
} from "@/features/dashboard/application/prioritise-actions";
import {
  riskBand,
  DEFAULT_RISK_MATRIX_CONFIG,
  type RiskBand,
  type RiskMatrixConfig,
} from "@/features/risks/domain/risks";
import { Card, PageIntro, Pill, Progress } from "@/components/ui";
import { StatusLabel, type StatusTone } from "@/components/status-label";
import { Icon } from "@/components/icons";
import { acceptCalendarSeedAction } from "./tasks/actions";
import { loadMemberOverview } from "@/features/dashboard/application/load-member-overview";
import { MemberOverview } from "@/features/dashboard/components/member-overview";

const SOURCE_LABEL: Record<string, string> = {
  gap: "From assessment gap",
  evidence_expiry: "Evidence needs refreshing",
  system: "From compliance calendar",
  policy_review: "From policy review",
  risk_treatment: "From a treatment plan",
  manual: "Added manually",
};

// Control maturity buckets for the implementation bar. "pending" (undecided) and
// "absent" (decided, not implemented) both mean 0% implemented, so they fold into
// one "Not started" segment; the five blue steps are a validated ordinal ramp.
const MATURITY: ReadonlyArray<{ key: string; label: string; color: string; statuses: SoaStatus[] }> = [
  { key: "not_started", label: "Not started", color: "var(--ch-s1)", statuses: ["pending", "absent"] },
  { key: "in_progress", label: "In progress", color: "var(--ch-s2)", statuses: ["in_progress"] },
  { key: "established", label: "Established", color: "var(--ch-s3)", statuses: ["established"] },
  { key: "operational", label: "Operational", color: "var(--ch-s4)", statuses: ["operational"] },
  { key: "advanced", label: "Advanced", color: "var(--ch-s5)", statuses: ["advanced"] },
  { key: "not_applicable", label: "Not applicable", color: "var(--ch-sNA)", statuses: ["not_applicable"] },
];

const BAND_COLOR: Record<RiskBand, string> = {
  low: "var(--rag-low)",
  moderate: "var(--rag-med)",
  high: "var(--rag-high)",
  very_high: "var(--rag-crit)",
};

// The priority reason drives the queue's colour cue — never colour alone (each
// row also carries the reason as text, per the accessibility gate).
function toneForAction(action: PrioritisedAction): StatusTone {
  if (action.severity === "blocker" || action.priorityReason === "Overdue") return "risk";
  if (action.priorityReason === "Due today") return "attention";
  if (action.kind === "soa_decision" || action.kind === "evidence_review") return "attention";
  return "neutral";
}

function readinessStage(percent: number): string {
  if (percent <= 0) return "Not started";
  if (percent < 34) return "Getting ready";
  if (percent < 67) return "Building evidence";
  if (percent < 100) return "Almost audit-ready";
  return "Audit-ready";
}

export default async function AppHome() {
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role === "member") {
    const overview = await loadMemberOverview(supabase, {
      organisationId: organisation.id,
      organisationName: organisation.name,
      jobTitle: membership.job_title,
    });
    return <MemberOverview data={overview} />;
  }
  const today = new Date().toISOString().slice(0, 10);

  // The latest SoA register anchors readiness, the maturity chart, and the
  // pending applicability decisions that block finalisation.
  const { data: register } = await supabase
    .from("soa_registers")
    .select("id")
    .eq("organisation_id", organisation.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [
    pendingSoa,
    registerItems,
    staleEvidence,
    reviewPolicies,
    dueTasks,
    recentChanges,
    evidenceStatuses,
    risksForHeat,
    riskConfigRow,
    { count: assessments },
    { count: snapshots },
    { count: allRisks },
    { count: liveEvidence },
    { count: policies },
    { count: soaRegisters },
    { count: members },
    { count: invites },
    { count: integrations },
  ] = await Promise.all([
    register
      ? supabase.from("soa_items").select("id,control_code,control_title").eq("organisation_id", organisation.id).eq("soa_register_id", register.id).eq("status", "pending").order("position").limit(25).then((r) => r.data)
      : Promise.resolve([] as { id: string; control_code: string; control_title: string }[]),
    register
      ? supabase.from("soa_items").select("status").eq("organisation_id", organisation.id).eq("soa_register_id", register.id).then((r) => r.data)
      : Promise.resolve([] as { status: string }[]),
    supabase.from("evidence").select("id,title,status,valid_until").eq("organisation_id", organisation.id).in("status", ["expiring", "expired"]).order("valid_until", { ascending: true, nullsFirst: false }).limit(25).then((r) => r.data),
    supabase.from("policies").select("id,reference,title,review_due").eq("organisation_id", organisation.id).eq("status", "in_review").order("reference").limit(25).then((r) => r.data),
    supabase.from("tasks").select("id,title,due_on,source,owner_id").eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).not("due_on", "is", null).order("due_on", { ascending: true }).limit(25).then((r) => r.data),
    supabase.from("audit_events").select("action,entity_type,occurred_at").eq("organisation_id", organisation.id).order("occurred_at", { ascending: false }).limit(6).then((r) => r.data),
    supabase.from("evidence").select("status").eq("organisation_id", organisation.id).in("status", ["current", "expiring", "expired"]).limit(3000).then((r) => r.data),
    supabase.from("risks").select("likelihood,impact,residual_likelihood,residual_impact").eq("organisation_id", organisation.id).neq("status", "closed").limit(500).then((r) => r.data),
    supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").maybeSingle().then((r) => r.data),
    supabase.from("assessment_sessions").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id),
    supabase.from("soa_snapshots").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id),
    supabase.from("risks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id),
    supabase.from("evidence").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["current", "expiring", "expired"]),
    supabase.from("policies").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id),
    supabase.from("soa_registers").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("organisation_id", organisation.id),
    supabase.from("invitations").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id),
    supabase.from("integration_connections").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).is("revoked_at", null),
  ]);

  const actionInputs: DashboardActionInput[] = [
    ...(pendingSoa ?? []).map((item): DashboardActionInput => ({
      id: `soa-${item.id}`,
      kind: "soa_decision",
      severity: "blocker",
      label: `Decide applicability: ${item.control_code}`,
      explanation: `${item.control_title} still needs an applicability decision before you can finalise the SoA.`,
      destination: register ? `/app/soa/${register.id}` : "/app/soa",
      source: "Statement of Applicability",
      dueOn: null,
    })),
    ...(staleEvidence ?? []).map((item): DashboardActionInput => ({
      id: `evidence-${item.id}`,
      kind: "evidence_review",
      severity: item.status === "expired" ? "high" : "normal",
      label: `Refresh evidence: ${item.title}`,
      explanation: item.status === "expired"
        ? "This evidence has expired and no longer proves its control."
        : "This evidence is expiring soon — refresh it to keep the control covered.",
      destination: "/app/evidence",
      source: "Evidence vault",
      dueOn: item.valid_until ?? null,
    })),
    ...(reviewPolicies ?? []).map((item): DashboardActionInput => ({
      id: `policy-${item.id}`,
      kind: "approval",
      label: `Approve policy: ${item.reference}`,
      explanation: `${item.title} is in review and waiting for your approval.`,
      destination: `/app/policies/${item.id}`,
      source: "Policies",
      dueOn: item.review_due ?? null,
    })),
    ...(dueTasks ?? []).map((item): DashboardActionInput => ({
      id: `task-${item.id}`,
      kind: "task",
      label: item.title,
      explanation: SOURCE_LABEL[item.source] ?? "Open remediation task",
      destination: `/app/tasks/${item.id}`,
      source: SOURCE_LABEL[item.source] ?? "Tasks",
      dueOn: item.due_on ?? null,
      owner: item.owner_id ?? null,
    })),
  ];

  const actions = prioritiseDashboardActions(actionInputs, today);
  const topAction = actions[0] ?? null;

  const readiness = summariseSoaReadiness((registerItems ?? []).map((s) => ({ status: s.status as SoaStatus }))).percent;

  // Control-maturity distribution for the implementation bar.
  const statusCounts = new Map<string, number>();
  for (const item of registerItems ?? []) statusCounts.set(item.status, (statusCounts.get(item.status) ?? 0) + 1);
  const maturity = MATURITY.map((bucket) => ({ ...bucket, count: bucket.statuses.reduce((sum, status) => sum + (statusCounts.get(status) ?? 0), 0) }));
  const totalControls = maturity.reduce((sum, bucket) => sum + bucket.count, 0);
  const maturityShown = maturity.filter((bucket) => bucket.count > 0);

  // Evidence freshness donut.
  const evidence = { current: 0, expiring: 0, expired: 0 };
  for (const item of evidenceStatuses ?? []) {
    const status = item.status as string;
    if (status === "current" || status === "expiring" || status === "expired") evidence[status] += 1;
  }
  const evidenceTotal = evidence.current + evidence.expiring + evidence.expired;

  // Risk heat map: residual likelihood × impact, banded with the org's matrix
  // config (same logic the risk register uses), counts overlaid per cell.
  const config: RiskMatrixConfig = riskConfigRow
    ? { lowMax: riskConfigRow.low_max, moderateMax: riskConfigRow.moderate_max, highMax: riskConfigRow.high_max, appetite: riskConfigRow.appetite_threshold ?? null }
    : DEFAULT_RISK_MATRIX_CONFIG;
  const grid: number[][] = Array.from({ length: 6 }, () => Array(6).fill(0));
  let riskTotal = 0;
  for (const risk of risksForHeat ?? []) {
    const l = (risk.residual_likelihood ?? risk.likelihood) as number | null;
    const i = (risk.residual_impact ?? risk.impact) as number | null;
    if (Number.isInteger(l) && Number.isInteger(i) && (l as number) >= 1 && (l as number) <= 5 && (i as number) >= 1 && (i as number) <= 5) {
      grid[l as number][i as number] += 1;
      riskTotal += 1;
    }
  }

  const checklist = buildOnboardingChecklist({
    hasAssessment: (assessments ?? 0) > 0,
    hasSoa: (soaRegisters ?? 0) > 0 || (snapshots ?? 0) > 0,
    hasRisk: (allRisks ?? 0) > 0,
    hasEvidence: (liveEvidence ?? 0) > 0,
    hasPolicy: (policies ?? 0) > 0,
    hasTeam: (members ?? 0) > 1 || (invites ?? 0) > 0,
    hasIntegration: (integrations ?? 0) > 0,
  });

  const primaryHref = topAction?.destination ?? "/app/assessment";
  const primaryLabel = topAction ? "Start next action" : (assessments ?? 0) > 0 ? "Continue assessment" : "Start assessment";

  const gaugeR = 80;
  const gaugeC = 2 * Math.PI * gaugeR;

  return <>
    <PageIntro
      eyebrow={organisation.name.toUpperCase()}
      title="Readiness dashboard"
      body="Your highest-priority decisions first, then how your readiness is tracking. This is a readiness signal, not a certification."
      action={<Link className="button primary" href={primaryHref}>{primaryLabel} <Icon name="arrow" /></Link>}
    />

    {/* Hero: readiness gauge + what to do next. */}
    <div className="dash-hero">
      <Card className="gauge-card">
        <div className="card-head"><div><h3>Readiness confidence</h3><p>Applicable controls implemented</p></div><Pill>Live</Pill></div>
        <div className="gauge">
          <div className="gauge-ring">
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <circle className="g-track" cx="100" cy="100" r={gaugeR} />
              <circle className="g-arc" cx="100" cy="100" r={gaugeR} style={{ strokeDasharray: gaugeC, strokeDashoffset: gaugeC * (1 - readiness / 100) }} />
            </svg>
            <div className="gauge-center">
              <div className="g-pct">{readiness}<span>%</span></div>
              <div className="g-stage">{readinessStage(readiness)}</div>
            </div>
          </div>
          <p className="g-cap">Reflects finalised SoA coverage. Not an ISO 27001 certification.</p>
        </div>
        <div className="card-foot"><span><Icon name="check" />Updated just now</span><Link href="/app/reports/readiness">Leadership report <Icon name="arrow" /></Link></div>
      </Card>

      <Card className="action-queue">
        <div className="card-head"><div><h3>Do this next</h3><p>Blockers first, then decisions to review, then work that is due.</p></div><Link href="/app/tasks">All tasks</Link></div>
        {actions.length > 0
          ? <ol className="action-list">
              {actions.map((action, index) => <li key={action.id}>
                <Link href={action.destination}>
                  <b className="action-rank">{index + 1}</b>
                  <span className="action-body">
                    <strong>{action.label}</strong>
                    <small>{action.explanation}</small>
                    <span className="action-meta">
                      <StatusLabel tone={toneForAction(action)}>{action.priorityReason}</StatusLabel>
                      <span>{action.source}</span>
                      <span>{action.dueContext}</span>
                    </span>
                  </span>
                  <Icon name="arrow" />
                </Link>
              </li>)}
            </ol>
          : <p className="empty-note">You are all caught up — no decisions or due work are waiting. New items appear here automatically as evidence ages, tasks fall due, or policies enter review.</p>}
        <div className="card-foot">
          {topAction
            ? <Link className="button primary" href={topAction.destination}>Start next action <Icon name="arrow" /></Link>
            : <form action={acceptCalendarSeedAction}><button className="button secondary">Add starter calendar</button></form>}
          <span className="quick-actions"><Link href="/app/evidence/new">Add evidence</Link><Link href="/app/risks">Review risks</Link></span>
        </div>
      </Card>
    </div>

    {/* Charts: control maturity, evidence freshness, risk posture. */}
    <div className="dash-charts">
      <Card>
        <div className="card-head"><div><h3>Control implementation</h3><p>{totalControls > 0 ? `${totalControls} controls by maturity on your latest SoA` : "Control maturity on your latest SoA"}</p></div><Link href="/app/soa">Open SoA</Link></div>
        {totalControls > 0
          ? <>
              <div className="segbar" role="img" aria-label="Control maturity distribution">
                {maturityShown.map((bucket) => <span key={bucket.key} title={`${bucket.label} — ${bucket.count}`} style={{ flexGrow: bucket.count, background: bucket.color }} />)}
              </div>
              <div className="seg-legend">
                {maturityShown.map((bucket) => <div key={bucket.key} className="seg-row"><span className="seg-dot" style={{ background: bucket.color }} />{bucket.label}<b>{bucket.count}</b></div>)}
              </div>
            </>
          : <p className="empty-note">Generate a Statement of Applicability to see how your controls are maturing.</p>}
      </Card>

      <Card>
        <div className="card-head"><div><h3>Evidence freshness</h3><p>{evidenceTotal} {evidenceTotal === 1 ? "item" : "items"} in your vault</p></div></div>
        <div className="donut">
          <div className="donut-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <g transform="rotate(-90 60 60)">
                {evidenceTotal === 0
                  ? <circle className="d-empty" cx="60" cy="60" r="46" />
                  : (() => {
                      const C = 2 * Math.PI * 46;
                      const parts = [{ v: evidence.current, cls: "d-good" }, { v: evidence.expiring, cls: "d-warn" }, { v: evidence.expired, cls: "d-risk" }].filter((p) => p.v > 0);
                      const gap = parts.length > 1 ? 3 : 0;
                      let acc = 0;
                      return parts.map((p, idx) => {
                        const len = (p.v / evidenceTotal) * C;
                        const dash = Math.max(len - gap, 0.5);
                        const seg = <circle key={idx} className={p.cls} cx="60" cy="60" r="46" style={{ strokeDasharray: `${dash} ${C - dash}`, strokeDashoffset: -acc }} />;
                        acc += len;
                        return seg;
                      });
                    })()}
              </g>
            </svg>
            <div className="donut-center"><div className="d-count">{evidenceTotal}</div><div className="d-sub">items</div></div>
          </div>
          <div className="donut-legend">
            <div className="seg-row"><span className="seg-dot" style={{ background: "var(--green)" }} />Current<b>{evidence.current}</b></div>
            <div className="seg-row"><span className="seg-dot" style={{ background: "var(--amber)" }} />Expiring<b>{evidence.expiring}</b></div>
            <div className="seg-row"><span className="seg-dot" style={{ background: "var(--red)" }} />Expired<b>{evidence.expired}</b></div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="card-head"><div><h3>Risk posture</h3><p>{riskTotal > 0 ? "Residual exposure, likelihood × impact" : "Residual exposure — no open risks yet"}</p></div></div>
        <div className="heatmap">
          <div className="heat-axis heat-axis-y">Likelihood →</div>
          {[5, 4, 3, 2, 1].map((l) => [1, 2, 3, 4, 5].map((i) => {
            const count = grid[l][i];
            const style = { background: BAND_COLOR[riskBand(l * i, config)] };
            const label = `Likelihood ${l} × Impact ${i}${count ? ` — ${count} risk${count > 1 ? "s" : ""}` : ""}`;
            return count > 0
              ? <Link key={`${l}-${i}`} className="heat-cell" style={style} href="/app/risks" title={label}>{count}</Link>
              : <span key={`${l}-${i}`} className="heat-cell empty" style={style} title={label} />;
          }))}
          <div className="heat-axis heat-axis-x">Impact →</div>
        </div>
        <div className="heat-legend">
          <span><i style={{ background: "var(--rag-low)" }} />Low</span>
          <span><i style={{ background: "var(--rag-med)" }} />Medium</span>
          <span><i style={{ background: "var(--rag-high)" }} />High</span>
          <span><i style={{ background: "var(--rag-crit)" }} />Critical</span>
        </div>
      </Card>
    </div>

    {/* Activity + setup progress. */}
    <div className={checklist.complete ? "dash-lower-single" : "dashboard-grid"}>
      <Card>
        <div className="card-head"><div><h3>What changed</h3><p>Recent activity across your workspace</p></div><Link href="/app/activity">Full audit trail</Link></div>
        {(recentChanges ?? []).length > 0
          ? <ul className="change-list">
              {(recentChanges ?? []).map((change, index) => <li key={index}>
                <span>{change.action.replace(/_/g, " ")} · {change.entity_type.replace(/_/g, " ")}</span>
                <time>{typeof change.occurred_at === "string" ? change.occurred_at.slice(0, 10) : ""}</time>
              </li>)}
            </ul>
          : <p className="empty-note">Nothing has changed yet. Activity shows here as you and your team make decisions.</p>}
      </Card>

      {!checklist.complete && <Card className="onboarding-card">
        <div className="card-head"><div><h2>Get certification-ready</h2><p>Steps disappear as you complete them.</p></div><Pill tone={checklist.percent === 100 ? "green" : "blue"}>{checklist.doneCount} of {checklist.total} done</Pill></div>
        <div className="onboarding-progress"><Progress value={checklist.percent} tone="green" /></div>
        <ol className="onboarding-steps">
          {checklist.steps.filter((step) => !step.done).map((step, index) => <li key={step.id}>
            <span className="marker">{index + 1}</span>
            <span className="step-body"><strong>{step.label}</strong><small>{step.description}</small></span>
            <Link className="button secondary" href={step.href}>{step.cta} <Icon name="arrow" /></Link>
          </li>)}
        </ol>
      </Card>}
    </div>
  </>;
}
