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
import { Card, PageIntro, Pill, Progress, Ring } from "@/components/ui";
import { StatusLabel, type StatusTone } from "@/components/status-label";
import { Icon } from "@/components/icons";
import { acceptCalendarSeedAction } from "./tasks/actions";

const SOURCE_LABEL: Record<string, string> = {
  gap: "From assessment gap",
  evidence_expiry: "Evidence needs refreshing",
  system: "From compliance calendar",
  policy_review: "From policy review",
  risk_treatment: "From a treatment plan",
  manual: "Added manually",
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
  const { supabase, organisation } = await requireAppContext();
  const today = new Date().toISOString().slice(0, 10);

  // The latest SoA register anchors both the readiness ring and the pending
  // applicability decisions that block finalisation.
  const { data: register } = await supabase
    .from("soa_registers")
    .select("id")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const [
    pendingSoa,
    readinessItems,
    staleEvidence,
    reviewPolicies,
    dueTasks,
    recentChanges,
    { count: assessments },
    { count: openRisks },
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
      ? supabase.from("soa_items").select("id,control_code,control_title").eq("soa_register_id", register.id).eq("status", "pending").order("position").limit(25).then((r) => r.data)
      : Promise.resolve([] as { id: string; control_code: string; control_title: string }[]),
    register
      ? supabase.from("soa_items").select("status").eq("soa_register_id", register.id).then((r) => r.data)
      : Promise.resolve([] as { status: string }[]),
    supabase.from("evidence").select("id,title,status,valid_until").in("status", ["expiring", "expired"]).order("valid_until", { ascending: true, nullsFirst: false }).limit(25).then((r) => r.data),
    supabase.from("policies").select("id,reference,title,review_due").eq("status", "in_review").order("reference").limit(25).then((r) => r.data),
    supabase.from("tasks").select("id,title,due_on,source,owner_id").in("status", ["open", "in_progress"]).not("due_on", "is", null).order("due_on", { ascending: true }).limit(25).then((r) => r.data),
    supabase.from("audit_events").select("action,entity_type,occurred_at").order("occurred_at", { ascending: false }).limit(6).then((r) => r.data),
    supabase.from("assessment_sessions").select("id", { count: "exact", head: true }),
    supabase.from("risks").select("id", { count: "exact", head: true }).neq("status", "closed"),
    supabase.from("soa_snapshots").select("id", { count: "exact", head: true }),
    supabase.from("risks").select("id", { count: "exact", head: true }),
    supabase.from("evidence").select("id", { count: "exact", head: true }).in("status", ["current", "expiring", "expired"]),
    supabase.from("policies").select("id", { count: "exact", head: true }),
    supabase.from("soa_registers").select("id", { count: "exact", head: true }),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }),
    supabase.from("invitations").select("id", { count: "exact", head: true }),
    supabase.from("integration_connections").select("id", { count: "exact", head: true }).is("revoked_at", null),
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

  const readiness = summariseSoaReadiness((readinessItems ?? []).map((s) => ({ status: s.status as SoaStatus }))).percent;

  const checklist = buildOnboardingChecklist({
    hasAssessment: (assessments ?? 0) > 0,
    hasSoa: (soaRegisters ?? 0) > 0 || (snapshots ?? 0) > 0,
    hasRisk: (allRisks ?? 0) > 0,
    hasEvidence: (liveEvidence ?? 0) > 0,
    hasPolicy: (policies ?? 0) > 0,
    hasTeam: (members ?? 0) > 1 || (invites ?? 0) > 0,
    hasIntegration: (integrations ?? 0) > 0,
  });

  const primaryHref = topAction?.destination ?? ((assessments ?? 0) > 0 ? "/app/assessment" : "/app/assessment");
  const primaryLabel = topAction ? "Start next action" : (assessments ?? 0) > 0 ? "Continue assessment" : "Start assessment";

  return <>
    <PageIntro
      eyebrow={organisation.name.toUpperCase()}
      title="Readiness dashboard"
      body="Your highest-priority decisions first, then how your readiness is tracking. This is a readiness signal, not a certification."
      action={<Link className="button primary" href={primaryHref}>{primaryLabel} <Icon name="arrow" /></Link>}
    />

    {/* First viewport: what to do next, and where readiness stands. */}
    <div className="dashboard-grid dashboard-focus">
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

      <Card>
        <div className="card-head"><div><h3>Readiness confidence</h3><p>Share of applicable controls implemented on your latest SoA</p></div><Pill>Live</Pill></div>
        <div className="readiness-body">
          <Ring value={readiness} />
          <div className="lifecycle-stage">
            <b>{readinessStage(readiness)}</b>
            <StatusLabel tone={readiness >= 100 ? "confirmed" : readiness > 0 ? "attention" : "neutral"}>{readiness}% implemented</StatusLabel>
            <small style={{ color: "#6d7787", fontSize: "11px", lineHeight: 1.45 }}>Readiness reflects finalised SoA coverage. It is not an ISO 27001 certification or a guarantee of audit outcome.</small>
          </div>
        </div>
        <div className="card-foot"><span><Icon name="check" />Updated just now</span><Link href="/app/reports/readiness">Leadership report <Icon name="arrow" /></Link></div>
      </Card>
    </div>

    {/* Second viewport: what changed, readiness by outcome, and setup progress. */}
    <div className="dashboard-grid">
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

      <Card>
        <div className="card-head"><div><h3>Readiness by outcome</h3><p>The signals behind your readiness</p></div></div>
        <div style={{ padding: "18px 21px" }} className="category-bars">
          <div><label><span>Assessments run</span><b>{assessments ?? 0}</b></label></div>
          <div><label><span>Open risks</span><b>{openRisks ?? 0}</b></label></div>
          <div><label><span>Finalised SoAs</span><b>{snapshots ?? 0}</b></label></div>
        </div>
        <div className="card-foot"><Link href="/app/soa">Open SoA <Icon name="arrow" /></Link><Link href="/app/risks">Open risks <Icon name="arrow" /></Link></div>
      </Card>
    </div>

    {!checklist.complete && <Card className="onboarding-card">
      <div className="card-head"><div><h2>Get certification-ready</h2><p>A few high-value steps to activate your workspace — this guide hides itself once every step is done.</p></div><Pill tone={checklist.percent === 100 ? "green" : "blue"}>{checklist.doneCount} of {checklist.total} done</Pill></div>
      <div className="onboarding-progress"><Progress value={checklist.percent} tone="green" /></div>
      <ol className="onboarding-steps">
        {checklist.steps.map((step, index) => <li key={step.id} className={step.done ? "done" : ""}>
          <span className="marker">{step.done ? <Icon name="check" /> : index + 1}</span>
          <span className="step-body"><strong>{step.label}</strong>{!step.done && <small>{step.description}</small>}</span>
          {step.done ? <Pill tone="green"><Icon name="check" />Done</Pill> : <Link className="button secondary" href={step.href}>{step.cta} <Icon name="arrow" /></Link>}
        </li>)}
      </ol>
    </Card>}
  </>;
}
