import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { deriveEvidenceStatus } from "@/features/evidence/domain/evidence";
import { isPolicyReviewDue } from "@/features/policies/domain/review";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { Card, PageIntro, Pill } from "@/components/ui";
import { StatusLabel, type StatusTone } from "@/components/status-label";
import { Icon } from "@/components/icons";

const SOURCE_LABEL: Record<string, string> = {
  evidence_expiry: "Stale evidence",
  policy_review: "Policy review",
  system: "Compliance calendar",
  risk_treatment: "Risk treatment",
  gap: "Assessment gap",
  manual: "Manual",
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function MonitoringPage() {
  const { supabase, organisation } = await requireAppContext();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = addDays(today, 90);

  const { data: register } = await supabase
    .from("soa_registers").select("id").eq("organisation_id", organisation.id)
    .order("version", { ascending: false }).limit(1).maybeSingle();

  const [evidence, tasks, policies, soaItems, autoTasks] = await Promise.all([
    supabase.from("evidence").select("id,title,status,valid_until").eq("organisation_id", organisation.id).in("status", ["current", "expiring", "expired"]).limit(2000).then((r) => r.data ?? []),
    supabase.from("tasks").select("id,title,status,due_on,source").eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).limit(1000).then((r) => r.data ?? []),
    supabase.from("policies").select("id,reference,title,review_due").eq("organisation_id", organisation.id).eq("status", "approved").limit(1000).then((r) => r.data ?? []),
    register ? supabase.from("soa_items").select("id,control_code,control_title,applicable,status,justification,evidence").eq("organisation_id", organisation.id).eq("soa_register_id", register.id).then((r) => r.data ?? []) : Promise.resolve([] as Array<{ id: string; control_code: string; control_title: string; applicable: boolean; status: string; justification: string; evidence: string }>),
    supabase.from("tasks").select("id,title,due_on,source").eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).in("source", ["evidence_expiry", "policy_review", "system", "risk_treatment"]).order("created_at", { ascending: false }).limit(8).then((r) => r.data ?? []),
  ]);

  // Evidence freshness (live-derived from validity, so it is always current).
  const ev = { current: 0, expiring: 0, expired: 0 };
  for (const item of evidence) ev[deriveEvidenceStatus(item.valid_until, today)] += 1;
  const evTotal = ev.current + ev.expiring + ev.expired;

  // Overdue work.
  const overdue = tasks.filter((t) => isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today)).length;

  // Policy reviews.
  const reviewsDue = policies.filter((p) => isPolicyReviewDue(p.review_due, today)).length;

  // Control coverage / gaps on the live SoA.
  const applicable = soaItems.filter((i) => i.applicable);
  const undecided = soaItems.filter((i) => i.status === "pending").length;
  const missingEvidence = applicable.filter((i) => !i.evidence || !i.evidence.trim()).length;

  // Forward-looking calendar: everything with a date in the next 90 days.
  type Upcoming = { key: string; date: string; kind: string; label: string; href: string; tone: StatusTone };
  const upcoming: Upcoming[] = [];
  for (const e of evidence) {
    const st = deriveEvidenceStatus(e.valid_until, today);
    if (e.valid_until && e.valid_until >= today && e.valid_until <= horizon && st !== "expired") {
      upcoming.push({ key: `ev-${e.id}`, date: e.valid_until, kind: "Evidence expires", label: e.title, href: "/app/evidence", tone: st === "expiring" ? "attention" : "neutral" });
    }
  }
  for (const p of policies) {
    if (p.review_due && p.review_due >= today && p.review_due <= horizon) {
      upcoming.push({ key: `pol-${p.id}`, date: p.review_due, kind: "Policy review", label: `${p.reference}: ${p.title}`, href: `/app/policies/${p.id}`, tone: "neutral" });
    }
  }
  for (const t of tasks) {
    if (t.due_on && t.due_on >= today && t.due_on <= horizon) {
      upcoming.push({ key: `task-${t.id}`, date: t.due_on, kind: "Task due", label: t.title, href: `/app/tasks/${t.id}`, tone: "neutral" });
    }
  }
  upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const signals: Array<{ label: string; value: number; detail: string; tone: StatusTone; href: string }> = [
    { label: "Evidence health", value: ev.expiring + ev.expired, detail: ev.expiring + ev.expired === 0 ? `all ${evTotal} items current` : `${ev.expiring} expiring · ${ev.expired} expired`, tone: ev.expired > 0 ? "risk" : ev.expiring > 0 ? "attention" : "confirmed", href: "/app/evidence" },
    { label: "Overdue work", value: overdue, detail: overdue === 0 ? "nothing past due" : "tasks past their due date", tone: overdue > 0 ? "risk" : "confirmed", href: "/app/tasks?filter=overdue" },
    { label: "Reviews due", value: reviewsDue, detail: reviewsDue === 0 ? "no policy reviews due" : "policy reviews due or overdue", tone: reviewsDue > 0 ? "attention" : "confirmed", href: "/app/policies" },
    { label: "Control gaps", value: undecided + missingEvidence, detail: undecided + missingEvidence === 0 ? "every applicable control covered" : `${undecided} undecided · ${missingEvidence} without evidence`, tone: undecided + missingEvidence > 0 ? "attention" : "confirmed", href: register ? `/app/soa/${register.id}` : "/app/soa" },
  ];
  const allClear = signals.every((s) => s.value === 0);

  return <>
    <PageIntro
      eyebrow="MONITORING"
      title="Continuous monitoring"
      body="ComplianceHub watches your posture automatically — evidence freshness, overdue work, upcoming reviews, and control gaps. These signals recalculate live every time you look, and a daily automated sweep ages evidence and raises the work on its own."
    />

    <Card className="monitor-banner" style={{ marginBottom: "16px" }}>
      <span className={`monitor-dot ${allClear ? "ok" : "watch"}`} aria-hidden="true" />
      <div>
        <strong>{allClear ? "All monitored signals are healthy" : "Monitoring is flagging items that need attention"}</strong>
        <p>Automated daily sweep is active — it ages evidence to expiring/expired, raises replacement tasks, flags overdue work, and schedules policy reviews. Signals below are live as of {today}.</p>
      </div>
    </Card>

    <div className="monitor-signals">
      {signals.map((s) => <Link key={s.label} className="monitor-signal" href={s.href}>
        <span className="ms-label">{s.label}</span>
        <span className="ms-value">{s.value}</span>
        <StatusLabel tone={s.tone}>{s.detail}</StatusLabel>
      </Link>)}
    </div>

    <div className="dashboard-grid" style={{ marginTop: "16px" }}>
      <Card>
        <div className="card-head"><div><h3>Upcoming in the next 90 days</h3><p>Evidence expiries, policy reviews, and work coming due</p></div></div>
        {upcoming.length > 0
          ? <ul className="monitor-list">
              {upcoming.slice(0, 12).map((u) => <li key={u.key}>
                <Link href={u.href}>
                  <time>{u.date}</time>
                  <span className="ml-body"><strong>{u.label}</strong><StatusLabel tone={u.tone}>{u.kind}</StatusLabel></span>
                  <Icon name="arrow" />
                </Link>
              </li>)}
            </ul>
          : <p className="empty-note">Nothing scheduled in the next 90 days. New reviews and expiries appear here automatically as you add evidence and policies.</p>}
      </Card>

      <Card>
        <div className="card-head"><div><h3>Raised automatically</h3><p>Work the monitoring created for you</p></div><Link href="/app/tasks">All tasks</Link></div>
        {autoTasks.length > 0
          ? <ul className="monitor-list">
              {autoTasks.map((t) => <li key={t.id}>
                <Link href={`/app/tasks/${t.id}`}>
                  <span className="ml-body"><strong>{t.title}</strong><span className="ml-meta"><Pill tone="neutral">{SOURCE_LABEL[t.source] ?? "Automated"}</Pill>{t.due_on && <span>Due {t.due_on}</span>}</span></span>
                  <Icon name="arrow" />
                </Link>
              </li>)}
            </ul>
          : <p className="empty-note">Nothing raised automatically yet. As evidence ages or reviews fall due, the daily sweep opens owned tasks here without you asking.</p>}
      </Card>
    </div>
  </>;
}
