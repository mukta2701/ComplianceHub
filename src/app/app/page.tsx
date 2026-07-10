import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { summariseSoaReadiness } from "@/features/soa/domain/readiness";
import type { SoaStatus } from "@/features/soa/domain/soa";
import { buildOnboardingChecklist } from "@/features/onboarding/domain/checklist";
import { Card, PageIntro, Pill, Progress, Ring, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { one } from "@/lib/supabase/one";
import { acceptCalendarSeedAction } from "./tasks/actions";

const STALE_EVIDENCE = new Set(["expired", "withdrawn", "superseded"]);
const SOURCE_LABEL: Record<string, string> = { gap: "From assessment gap", evidence_expiry: "Evidence needs refreshing", system: "From compliance calendar", policy_review: "From policy review", risk_treatment: "From a treatment plan", manual: "Added manually" };

export default async function AppHome() {
  const { supabase, organisation } = await requireAppContext();
  const today = new Date().toISOString().slice(0, 10);
  const [{ count: assessments }, { count: risks }, { count: snapshots }, { count: openTasks }, { count: overdue }, { count: liveEvidence }, { count: expiring }, { data: controls }, { count: allRisks }, { count: policies }, { count: soaRegisters }, { count: members }, { count: invites }, { count: integrations }] = await Promise.all([
    supabase.from("assessment_sessions").select("id", { count: "exact", head: true }),
    supabase.from("risks").select("id", { count: "exact", head: true }).neq("status", "closed"),
    supabase.from("soa_snapshots").select("id", { count: "exact", head: true }),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]).not("due_on", "is", null).lt("due_on", today),
    supabase.from("evidence").select("id", { count: "exact", head: true }).in("status", ["current", "expiring", "expired"]),
    supabase.from("evidence").select("id", { count: "exact", head: true }).in("status", ["expiring", "expired"]),
    supabase.from("controls").select("id,code,title,evidence_links(evidence_id,evidence(status)),tasks(id,status,due_on,source)"),
    // Onboarding-checklist signals (all RLS-scoped, head/count-only). allRisks is
    // unfiltered — a risk that was added then closed still counts as "added".
    supabase.from("risks").select("id", { count: "exact", head: true }),
    supabase.from("policies").select("id", { count: "exact", head: true }),
    supabase.from("soa_registers").select("id", { count: "exact", head: true }),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }),
    supabase.from("invitations").select("id", { count: "exact", head: true }),
    supabase.from("integration_connections").select("id", { count: "exact", head: true }).is("revoked_at", null),
  ]);
  const checklist = buildOnboardingChecklist({
    hasAssessment: (assessments ?? 0) > 0,
    hasSoa: (soaRegisters ?? 0) > 0 || (snapshots ?? 0) > 0,
    hasRisk: (allRisks ?? 0) > 0,
    hasEvidence: (liveEvidence ?? 0) > 0,
    hasPolicy: (policies ?? 0) > 0,
    hasTeam: (members ?? 0) > 1 || (invites ?? 0) > 0,
    hasIntegration: (integrations ?? 0) > 0,
  });
  const attention = (controls ?? []).flatMap((control) => {
    const statuses = (control.evidence_links ?? []).map((link) => { const ev = one(link.evidence); return ev?.status ?? null; });
    const staleEvidence = statuses.length > 0 && statuses.every((s) => s !== null && STALE_EVIDENCE.has(s));
    const overdueTasks = (control.tasks ?? []).filter((task) => isOverdue({ status: task.status as TaskStatus, dueOn: task.due_on }, today));
    if (!staleEvidence && overdueTasks.length === 0) return [];
    const source = staleEvidence ? "evidence_expiry" : (overdueTasks[0]?.source ?? "manual");
    const reasons: string[] = [];
    if (staleEvidence) reasons.push("linked evidence is out of date");
    if (overdueTasks.length > 0) reasons.push("a remediation task is overdue");
    return [{ id: control.id, code: control.code, title: control.title, reason: reasons.join(" and "), source: SOURCE_LABEL[source] ?? "Needs review" }];
  });
  // Readiness is the SAME measure the Leadership report shows — the share of
  // applicable controls implemented on the latest SoA register — so the two
  // surfaces never contradict. A workspace with no finalised SoA reads 0%
  // ("not started"), never a misleading 100%. The operational "needs attention"
  // signal lives in its own widget below, not in this ring.
  const { data: register } = await supabase.from("soa_registers").select("id").order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: soaItems } = register
    ? await supabase.from("soa_items").select("status").eq("soa_register_id", register.id)
    : { data: [] as { status: string }[] };
  const readiness = summariseSoaReadiness((soaItems ?? []).map((s) => ({ status: s.status as SoaStatus }))).percent;
  return <>
    <PageIntro eyebrow={organisation.name.toUpperCase()} title="Readiness dashboard" body="Your live view of open work, evidence freshness, and anything that needs attention." action={<Link className="button primary" href="/app/assessment">{(assessments ?? 0) > 0 ? "Continue assessment" : "Start assessment"} <Icon name="arrow" /></Link>} />
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
    <div className="stats-grid"><Stat label="OPEN TASKS" value={openTasks ?? 0} detail="in progress or to do" /><Stat label="OVERDUE" value={overdue ?? 0} detail="past their due date" tone="red" /><Stat label="EVIDENCE ITEMS" value={liveEvidence ?? 0} detail="files, links and notes" tone="green" /><Stat label="EXPIRING / EXPIRED" value={expiring ?? 0} detail="need fresh proof" tone="amber" /></div>
    <div className="dashboard-grid">
      <Card><div className="card-head"><div><h3>Needs attention</h3><p>What needs attention — start here.</p></div><Link href="/app/tasks">All tasks</Link></div>
        {attention.length > 0 ? <div className="gap-list">{attention.slice(0, 6).map((item) => <Link key={item.id} href={`/app/soa?control=${item.id}`}><b><Icon name="alert" /></b><span><strong>{item.code}: {item.title}</strong><small>{item.reason}</small></span><Pill tone="amber">{item.source}</Pill><Icon name="arrow" /></Link>)}</div> : <p style={{ padding: "22px", color: "#596273", fontSize: "13px" }}>Nothing needs attention right now. New items appear here automatically as things fall due or evidence ages.</p>}
        <div className="card-foot"><form action={acceptCalendarSeedAction}><button className="button secondary">Add starter calendar</button></form><span className="quick-actions"><Link href="/app/evidence/new">Add evidence</Link><Link href="/app/risks">Review gaps</Link></span></div>
      </Card>
      <Card><div className="card-head"><div><h3>Overall readiness</h3><p>Share of applicable controls implemented on your SoA</p></div><Pill>Live</Pill></div><div className="readiness-body"><Ring value={readiness} /><div className="category-bars"><div><label><span>Assessments</span><b>{assessments ?? 0}</b></label></div><div><label><span>Open risks</span><b>{risks ?? 0}</b></label></div><div><label><span>Finalised SoAs</span><b>{snapshots ?? 0}</b></label></div></div></div><div className="card-foot"><span><Icon name="check" />Updated just now</span><Link href="/app/soa">Open SoA <Icon name="arrow" /></Link></div></Card>
    </div>
  </>;
}
