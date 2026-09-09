import Link from "next/link";
import type { CSSProperties } from "react";
import styles from "./overview.module.css";
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
// one "Not started" segment; the coloured steps follow the recorded maturity levels.
const MATURITY: ReadonlyArray<{ key: string; label: string; color: string; statuses: SoaStatus[] }> = [
  { key: "not_started", label: "Not started", color: "#b9c5d6", statuses: ["pending", "absent"] },
  { key: "in_progress", label: "In progress", color: "#9fbef5", statuses: ["in_progress"] },
  { key: "established", label: "Established", color: "#718ce2", statuses: ["established"] },
  { key: "operational", label: "Operational", color: "#35a69f", statuses: ["operational"] },
  { key: "advanced", label: "Advanced", color: "#147f79", statuses: ["advanced"] },
  { key: "not_applicable", label: "Not applicable", color: "#e0e5ee", statuses: ["not_applicable"] },
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
  if (action.kind === "soa_decision") return "attention";
  if (action.severity === "blocker" || action.priorityReason === "Overdue") return "risk";
  if (action.priorityReason === "Due today") return "attention";
  if (action.kind === "evidence_review") return "attention";
  return "neutral";
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
  const requireDashboardData = <T,>({ data, error }: { data: T; error: unknown }) => {
    if (error) throw new Error("Could not load dashboard");
    return data;
  };
  const requireDashboardCount = ({ count, error }: { count: number | null; error: unknown }) => {
    if (error) throw new Error("Could not load dashboard");
    return count;
  };

  // The latest SoA register anchors readiness, the maturity chart, and the
  // pending applicability decisions that block finalisation.
  const { data: register, error: registerError } = await supabase
    .from("soa_registers")
    .select("id")
    .eq("organisation_id", organisation.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (registerError) throw new Error("Could not load dashboard control maturity");

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
    assessments,
    snapshots,
    allRisks,
    liveEvidence,
    policies,
    soaRegisters,
    members,
    invites,
    openRiskCount,
    overdueTaskCount,
    reviewPolicyCount,
    expiringEvidenceCount,
  ] = await Promise.all([
    register
      ? supabase.from("soa_items").select("id,control_code,control_title").eq("organisation_id", organisation.id).eq("soa_register_id", register.id).eq("status", "pending").order("position").limit(25).then(requireDashboardData)
      : Promise.resolve([] as { id: string; control_code: string; control_title: string }[]),
    register
      ? supabase.from("soa_items").select("status").eq("organisation_id", organisation.id).eq("soa_register_id", register.id).then((r) => {
          if (r.error) throw new Error("Could not load dashboard control maturity");
          return r.data;
        })
      : Promise.resolve([] as { status: string }[]),
    supabase.from("evidence").select("id,title,status,valid_until,machine_provenance:github_evidence_provenance!github_evidence_provenance_evidence_tenant_fk()").eq("organisation_id", organisation.id).in("status", ["expiring", "expired"]).is("machine_provenance", null).order("valid_until", { ascending: true, nullsFirst: false }).limit(25).then(requireDashboardData),
    supabase.from("policies").select("id,reference,title,review_due").eq("organisation_id", organisation.id).eq("status", "in_review").order("reference").limit(25).then(requireDashboardData),
    supabase.from("tasks").select("id,title,due_on,source,owner_id").eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).not("due_on", "is", null).order("due_on", { ascending: true }).limit(25).then(requireDashboardData),
    supabase.from("audit_events").select("action,entity_type,occurred_at").eq("organisation_id", organisation.id).order("occurred_at", { ascending: false }).limit(6).then(requireDashboardData),
    supabase.from("evidence").select("status").eq("organisation_id", organisation.id).in("status", ["current", "expiring", "expired"]).limit(3000).then(requireDashboardData),
    supabase.from("risks").select("likelihood,impact,residual_likelihood,residual_impact").eq("organisation_id", organisation.id).neq("status", "closed").limit(500).then(requireDashboardData),
    supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").eq("organisation_id", organisation.id).maybeSingle().then(requireDashboardData),
    supabase.from("assessment_sessions").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).then(requireDashboardCount),
    supabase.from("soa_snapshots").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).then(requireDashboardCount),
    supabase.from("risks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).then(requireDashboardCount),
    supabase.from("evidence").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["current", "expiring", "expired"]).then(requireDashboardCount),
    supabase.from("policies").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).then(requireDashboardCount),
    supabase.from("soa_registers").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).then(requireDashboardCount),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("organisation_id", organisation.id).then(requireDashboardCount),
    supabase.from("invitations").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).then(requireDashboardCount),
    supabase.from("risks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).neq("status", "closed").then(requireDashboardCount),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).lt("due_on", today).then(requireDashboardCount),
    supabase.from("policies").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).eq("status", "in_review").then(requireDashboardCount),
    supabase.from("evidence").select("id", { count: "exact", head: true }).eq("organisation_id", organisation.id).eq("status", "expiring").then(requireDashboardCount),
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
    ...(staleEvidence ?? []).filter((item) => (
      Array.isArray(item.machine_provenance)
        ? item.machine_provenance.length === 0
        : !item.machine_provenance
    )).map((item): DashboardActionInput => ({
      id: `evidence-${item.id}`,
      kind: "evidence_review",
      severity: item.status === "expired" ? "high" : "normal",
      label: `Refresh evidence: ${item.title}`,
      explanation: item.status === "expired"
        ? "Its validity date has passed. Review it and add a current replacement."
        : "Its validity date is approaching. Review it and arrange a replacement.",
      destination: `/app/evidence?evidence=${encodeURIComponent(item.id)}`,
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

  const readinessSummary = summariseSoaReadiness((registerItems ?? []).map((s) => ({ status: s.status as SoaStatus })));
  const readiness = readinessSummary.percent;

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
  });


  const unscoredRisks = (risksForHeat ?? []).length - riskTotal;
  const upcomingTasks = (dueTasks ?? []).filter((task) => task.due_on && task.due_on >= today).slice(0, 4);

  const attention = [
    { label: "Open risks", value: openRiskCount, detail: "All risks not closed", href: "/app/risks", icon: "alert", tone: "risk" },
    { label: "Overdue tasks", value: overdueTaskCount, detail: "Open work past its due date", href: "/app/tasks?filter=overdue", icon: "clipboard", tone: "attention" },
    { label: "Policies in review", value: reviewPolicyCount, detail: "Policies awaiting a decision", href: "/app/policies", icon: "users", tone: "review" },
    { label: "Evidence expiring", value: expiringEvidenceCount, detail: "Records marked expiring", href: "/app/evidence", icon: "file", tone: "info" },
  ];

  return <div className={styles.overview}>
    <PageIntro
      eyebrow={organisation.name.toUpperCase()}
      title="Programme overview"
      body="What needs attention, where your programme stands, and what comes next."
      action={<><Link className="button secondary" href="/app/baseline">Continue your baseline</Link><Link className="button primary" href="/app/reports/readiness"><Icon name="file" />View report</Link></>}
    />

    <nav aria-label="Programme attention" className={styles.attention}>
      {attention.map((item) => <Link key={item.label} href={item.href} className={styles.metric}>
        <span className={styles.metricIcon} data-tone={item.value === 0 ? "neutral" : item.tone}><Icon name={item.icon} /></span>
        <span className={styles.metricBody}><span>{item.label}</span><strong>{item.value == null ? "—" : item.value.toLocaleString("en-GB")}</strong><small>{item.value == null ? "Count unavailable" : item.detail}</small></span>
        <Icon name="arrow" className={styles.metricArrow} />
      </Link>)}
    </nav>

    {/* Hero: readiness gauge + what to do next. */}
    <div className="dash-hero">
      <Card className={styles.positionCard}>
        <div className="card-head"><div><h3>Control maturity score</h3><p>Current position · latest Statement of Applicability</p></div><Link href={register ? `/app/soa/${register.id}` : "/app/soa"}>View controls <Icon name="arrow" /></Link></div>
        <div className={styles.positionSummary}>
          <div><div className={`g-pct ${styles.score}`}>{readinessSummary.total > 0 ? <>{readiness}<span>%</span></> : "—"}</div><p>{readinessSummary.total > 0 ? "Weighted maturity" : "No controls to score"}</p></div>
          <p>{readinessSummary.total > 0
            ? `${readinessSummary.total} controls scored · ${totalControls - readinessSummary.total} excluded as not applicable.`
            : totalControls > 0 ? "All controls are marked not applicable, so there is no maturity score." : "Add controls to your SoA to start measuring maturity."} Does not verify evidence or audit readiness.</p>
        </div>
        {totalControls > 0 ? <div className={styles.maturityBars} aria-label="Control maturity distribution">
          {maturityShown.map((bucket) => <div className={styles.maturityRow} key={bucket.key}>
            <span>{bucket.label}</span><span className={styles.barTrack} aria-hidden="true"><span style={{ width: `${bucket.count / totalControls * 100}%`, background: bucket.color }} /></span><b>{bucket.count}</b>
          </div>)}
        </div> : <div className={styles.noControls}><Icon name="clipboard" /><p>Your control picture starts here</p><small>Generate a Statement of Applicability to see how your controls are maturing.</small><Link href="/app/soa">Set up controls <Icon name="arrow" /></Link></div>}
        <details className={styles.scoreExplanation}><summary>How this score works</summary><p>Latest SoA statuses, including draft decisions: not started 0%, in progress 40%, established 70%, operational 90%, advanced 100%. Pending decisions count as zero; not applicable controls are excluded. The average is rounded to a whole percent.</p></details>
      </Card>

      <Card className="action-queue">
        <div className="card-head"><div><h3>Needs your attention</h3><p>Highest-priority decisions and due work.</p></div><Link href="/app/tasks">All tasks</Link></div>
        {actions.length > 0
          ? <ol className="action-list">
              {actions.slice(0, 3).map((action, index) => <li key={action.id}>
                <Link href={action.destination}>
                  <b className="action-rank">{index + 1}</b>
                  <span className="action-body">
                    <strong>{action.label}</strong>
                    <span className="action-meta">
                      <StatusLabel tone={toneForAction(action)}>{action.kind === "soa_decision" ? "Decision needed" : action.priorityReason}</StatusLabel>
                      <span>{action.source}</span>
                      <span>{action.dueContext}</span>
                    </span>
                  </span>
                  <Icon name="arrow" />
                </Link>
                {action.explanation !== action.source && <details className={styles.actionReason}><summary>Why this needs attention</summary><p>{action.explanation}</p></details>}
              </li>)}
            </ol>
          : <p className="empty-note">No priority items are shown. Review All tasks for the full work list, including tasks without due dates.</p>}
        <div className="card-foot">
          {topAction
            ? <Link className="button primary" href={topAction.destination}>Start next action <Icon name="arrow" /></Link>
            : <form action={acceptCalendarSeedAction}><button className="button secondary">Add starter calendar</button></form>}
          <span className="quick-actions"><Link href="/app/evidence/new">Add evidence</Link><Link href="/app/assessment">{(assessments ?? 0) > 0 ? "Continue assessment" : "Start assessment"}</Link></span>
        </div>
      </Card>
    </div>

    {/* Charts: control maturity, evidence freshness, risk posture. */}
    <div className="dash-charts">
      <Card>
        <div className="card-head"><div><h3>Evidence freshness</h3><p>{evidenceTotal} {evidenceTotal === 1 ? "item" : "items"} in your vault{(liveEvidence ?? 0) > evidenceTotal ? ` · showing ${evidenceTotal} of ${liveEvidence}` : ""}</p></div></div>
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
            <div className="seg-row"><span className="seg-dot" style={{ background: "#168b83" }} />Current<b>{evidence.current}</b></div>
            <div className="seg-row"><span className="seg-dot" style={{ background: "var(--amber)" }} />Expiring<b>{evidence.expiring}</b></div>
            <div className="seg-row"><span className="seg-dot" style={{ background: "var(--red)" }} />Expired<b>{evidence.expired}</b></div>
          </div>
        </div>
        <div className="card-foot"><span>Recorded freshness, not human approval</span><Link href="/app/evidence">Open evidence <Icon name="arrow" /></Link></div>
      </Card>

      <Card>
        <div className="card-head"><div><h3>Risk posture</h3><p>{(risksForHeat ?? []).length > 0 ? `${riskTotal} scored risks shown · likelihood × impact` : openRiskCount === 0 ? "Residual exposure — no open risks yet" : "Risk scores unavailable"}</p></div></div>
        <div className="heatmap">
          <div className="heat-axis heat-axis-y">Likelihood 1 → 5</div>
          {[5, 4, 3, 2, 1].map((l) => [1, 2, 3, 4, 5].map((i) => {
            const count = grid[l][i];
            const style = { "--cell-color": BAND_COLOR[riskBand(l * i, config)] } as CSSProperties;
            const label = `Likelihood ${l} × Impact ${i}${count ? ` — ${count} risk${count > 1 ? "s" : ""}` : ""}`;
            return count > 0
              ? <Link key={`${l}-${i}`} className="heat-cell" style={style} href="/app/risks" title={label} aria-label={label}>{count}</Link>
              : <span key={`${l}-${i}`} className="heat-cell empty" style={style} title={label}>0</span>;
          }))}
          <div className="heat-axis heat-axis-x">Impact 1 → 5</div>
        </div>
        {unscoredRisks > 0 && <p className={styles.chartNote}>{unscoredRisks} shown {unscoredRisks === 1 ? "risk has" : "risks have"} no complete score</p>}
        <p className={styles.chartNote}>Residual scores where recorded; otherwise inherent.{(openRiskCount ?? 0) > (risksForHeat ?? []).length ? ` Showing ${(risksForHeat ?? []).length} of ${openRiskCount} open risks.` : ""}</p>
        <div className="heat-legend">
          <span><i style={{ background: "var(--rag-low)" }} />Low</span>
          <span><i style={{ background: "var(--rag-med)" }} />Medium</span>
          <span><i style={{ background: "var(--rag-high)" }} />High</span>
          <span><i style={{ background: "var(--rag-crit)" }} />Critical</span>
        </div>
        <div className="card-foot"><Link href="/app/risks">Open risk register <Icon name="arrow" /></Link></div>
      </Card>
      <Card className={styles.upcomingCard}>
        <div className="card-head"><div><h3>Coming up</h3><p>Upcoming work from the next 25 dated open tasks</p></div></div>
        {upcomingTasks.length > 0 ? <ul className={styles.upcomingList}>{upcomingTasks.map((task) => <li key={task.id}><Link href={`/app/tasks/${task.id}`}><span className={styles.dateTile}><b>{task.due_on!.slice(8, 10)}</b><small>{new Date(`${task.due_on}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</small></span><span><strong>{task.title}</strong><small>{SOURCE_LABEL[task.source] ?? "Tasks"}</small><time dateTime={task.due_on!}>{task.due_on}</time></span><Icon name="arrow" /></Link></li>)}</ul> : <p className="empty-note">No upcoming dates in this shortlist. Open all tasks to see the full schedule.</p>}
        <div className="card-foot"><Link href="/app/tasks">Open all tasks <Icon name="arrow" /></Link></div>
      </Card>
    </div>

    {/* Activity + setup progress. */}
    <div className={checklist.complete ? "dash-lower-single" : "dashboard-grid"}>
      <Card>
        <div className="card-head"><div><h3>What changed</h3><p>Recent activity across your workspace</p></div><Link href="/app/activity">Full audit trail</Link></div>
        {(recentChanges ?? []).length > 0
          ? <ul className="change-list">
              {(recentChanges ?? []).map((change, index) => <li key={index}>
                <span>{change.action === "export" && change.entity_type === "export" ? "Export generated" : `${change.action.replace(/_/g, " ")} · ${change.entity_type.replace(/_/g, " ")}`}</span>
                <time>{typeof change.occurred_at === "string" ? change.occurred_at.slice(0, 10) : ""}</time>
              </li>)}
            </ul>
          : <p className="empty-note">Nothing has changed yet. Activity shows here as you and your team make decisions.</p>}
      </Card>

      {!checklist.complete && <Card className="onboarding-card">
        <div className="card-head"><div><h2>Build your programme</h2><p>Steps disappear as you complete them.</p></div><Pill tone={checklist.percent === 100 ? "green" : "blue"}>{checklist.doneCount} of {checklist.total} done</Pill></div>
        <div className="onboarding-progress"><Progress value={checklist.percent} tone="green" /></div>
        <ol className="onboarding-steps">
          {checklist.steps.filter((step) => !step.done).map((step, index) => <li key={step.id}>
            <span className="marker">{index + 1}</span>
            <span className="step-body"><strong>{step.label}</strong><small>{step.description}</small></span>
            <Link className="button secondary" href={step.href}>{step.cta} <Icon name="arrow" /></Link>
          </li>)}
        </ol>
      </Card>}
      {!checklist.complete && <Card>
        <div className="card-head"><div><h2>Reduce admin later</h2><p>Integrations are optional. Connect your systems when you want to collect evidence and prepare drafts for review.</p></div></div>
        <Link className="button secondary" href="/app/setup">Explore integrations <Icon name="arrow" /></Link>
      </Card>}
    </div>
  </div>;
}
