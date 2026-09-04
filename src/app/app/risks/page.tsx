import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { acceptRiskSuggestionAction, deleteRiskAction } from "../actions";
import { RiskStatusSelect } from "./risk-status-select";
import { calculateRiskScore, riskBand, exceedsAppetite, RISK_BAND_LABEL, DEFAULT_RISK_MATRIX_CONFIG, type RiskMatrixConfig } from "@/features/risks/domain/risks";
import { updateRiskMatrixConfigAction } from "./config-actions";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import { Card, EmptyState, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubTabs } from "@/components/sub-tabs";
import { one } from "@/lib/supabase/one";
import { hasCapability } from "@/features/organisations/domain/access";

const BAND_TONE: Record<string, string> = { low: "green", moderate: "amber", high: "red", very_high: "critical" };

export default async function RisksPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  const canManage = membership.role !== "member";
  const [{ data }, { data: gaps }, { data: linkedTasks }, { data: evidenceLinks }, { data: cfg }] = await Promise.all([
    supabase.from("risks").select("id,reference,title,category_id,risk_categories(name),likelihood,impact,residual_likelihood,residual_impact,status,review_date").eq("organisation_id", organisation.id).order("updated_at", { ascending: false }).limit(500),
    supabase.from("assessment_responses").select("session_id,question_id,answer,catalogue_questions!assessment_responses_question_id_fkey(code,prompt)").eq("organisation_id", organisation.id).in("answer", ["no", "partially"]).limit(10),
    supabase.from("tasks").select("id,title,risk_id,status").eq("organisation_id", organisation.id).in("status", ["open", "in_progress"]).not("risk_id", "is", null),
    supabase.from("evidence_links").select("risk_id,evidence(status)").eq("organisation_id", organisation.id).not("risk_id", "is", null),
    supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  const config: RiskMatrixConfig = cfg ? { lowMax: cfg.low_max, moderateMax: cfg.moderate_max, highMax: cfg.high_max, appetite: cfg.appetite_threshold } : DEFAULT_RISK_MATRIX_CONFIG;
  // Residual-exposure heat map: same 5×5 banding the register uses, so the
  // overview and the table agree.
  const BAND_COLOR: Record<string, string> = { low: "var(--rag-low)", moderate: "var(--rag-med)", high: "var(--rag-high)", very_high: "var(--rag-crit)" };
  const grid: number[][] = Array.from({ length: 6 }, () => Array(6).fill(0));
  let riskTotal = 0;
  for (const r of data ?? []) {
    if (r.status === "closed") continue;
    const l = (r.residual_likelihood ?? r.likelihood) as number;
    const i = (r.residual_impact ?? r.impact) as number;
    if (Number.isInteger(l) && Number.isInteger(i) && l >= 1 && l <= 5 && i >= 1 && i <= 5) { grid[l][i] += 1; riskTotal += 1; }
  }
  const tasksByRisk = new Map<string, { id: string; title: string }[]>();
  for (const t of linkedTasks ?? []) { if (!t.risk_id) continue; const list = tasksByRisk.get(t.risk_id) ?? []; list.push({ id: t.id, title: t.title }); tasksByRisk.set(t.risk_id, list); }
  const evidenceByRisk = new Map<string, { status: EvidenceStatus }[]>();
  for (const link of evidenceLinks ?? []) { if (!link.risk_id) continue; const ev = one(link.evidence); if (!ev) continue; const list = evidenceByRisk.get(link.risk_id) ?? []; list.push({ status: ev.status as EvidenceStatus }); evidenceByRisk.set(link.risk_id, list); }
  const gapSuggestions = (gaps ?? []).map((gap) => {
    const question = one(gap.catalogue_questions);
    return { key: `${gap.session_id}-${gap.question_id}`, questionId: gap.question_id, sessionId: gap.session_id, label: [question?.code, question?.prompt].filter(Boolean).join(": ") };
  });
  return <>
    <PageIntro eyebrow="RISK" title="Risk register" body="Track inherent and residual exposure on a documented 5×5 matrix." action={<span style={{ display: "flex", gap: "8px" }}>
      <a className="button secondary" href="/api/app/risks/export?format=xlsx">Export XLSX</a>
      <a className="button secondary" href="/api/app/risks/export?format=csv">CSV</a>
      {canManage && <Link className="button secondary" href="/app/risks/import">Import</Link>}
      {canManage && <Link className="button primary" href="/app/risks/new"><Icon name="plus" />Add risk</Link>}
    </span>} />
    <SubTabs tabs={[{ href: "/app/risks", label: "Risks" }, { href: "/app/assets", label: "Assets" }]} />
    {Boolean(gapSuggestions.length) && <Card style={{ padding: "20px", marginBottom: "16px", borderColor: "#efe1aa", background: "#fffbef" }}><h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Assessment gap suggestions</h2><p style={{ fontSize: "12px", color: "#596273", margin: 0 }}>{canManage ? "Nothing is created until you accept it." : "Workspace owners and admins can accept these gaps as risks or tasks."}</p>{gapSuggestions.map((gap) => <div key={gap.key} style={{ display: "flex", justifyContent: "space-between", gap: "16px", marginTop: "12px" }}><span style={{ fontSize: "13px" }}>{gap.label}</span><span style={{ display: "flex", flexShrink: 0, gap: "16px" }}>{canManage && <form action={acceptRiskSuggestionAction}><input type="hidden" name="questionId" value={gap.questionId} /><input type="hidden" name="sessionId" value={gap.sessionId} /><button style={{ color: "var(--blue)", fontWeight: 700, border: 0, background: "none" }}>Accept as risk</button></form>}{canManage && <Link style={{ color: "var(--blue)", fontWeight: 700 }} href={`/app/tasks/from-gap?questionId=${gap.questionId}`}>Accept as task</Link>}</span></div>)}</Card>}
    {!data?.length ? (
      <EmptyState icon="alert" title={canManage ? "Start your risk register" : "No risks recorded yet"} body={canManage ? "Record the threats to your information — each scored for inherent and residual likelihood and impact on a documented 5×5 matrix. Add your first risk, or import a register you already keep in a spreadsheet." : "Risks recorded by a workspace owner or admin will appear here with their exposure and treatment status."} primary={canManage ? { href: "/app/risks/new", label: "Add your first risk" } : undefined} secondary={canManage ? { href: "/app/risks/import", label: "Import from spreadsheet" } : undefined} />
    ) : (<>
    <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Risk posture</h2>
      <p style={{ fontSize: "12px", color: "#596273", margin: "0 0 14px" }}>Residual exposure across the 5×5 matrix — {riskTotal} open risk{riskTotal === 1 ? "" : "s"} by likelihood × impact.</p>
      <div className="heatmap" style={{ maxWidth: "380px" }}>
        <div className="heat-axis heat-axis-y">Likelihood →</div>
        {[5, 4, 3, 2, 1].map((l) => [1, 2, 3, 4, 5].map((i) => { const c = grid[l][i]; return <span key={`${l}-${i}`} className={`heat-cell${c ? "" : " empty"}`} style={{ background: BAND_COLOR[riskBand(l * i, config)] }} title={`Likelihood ${l} × Impact ${i}${c ? ` — ${c} risk${c > 1 ? "s" : ""}` : ""}`}>{c || ""}</span>; }))}
        <div className="heat-axis heat-axis-x">Impact →</div>
      </div>
      <div className="heat-legend">
        <span><i style={{ background: "var(--rag-low)" }} />Low</span>
        <span><i style={{ background: "var(--rag-med)" }} />Medium</span>
        <span><i style={{ background: "var(--rag-high)" }} />High</span>
        <span><i style={{ background: "var(--rag-crit)" }} />Critical</span>
      </div>
    </Card>
    <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>RAG band thresholds</h2>
      <p style={{ fontSize: "12px", color: "#596273", margin: "0 0 12px" }}>Set the top of each band on the 1–25 scale. Scores above your appetite are flagged Critical.</p>
      {hasCapability(membership.role, "manage_risk_matrix") ? <form action={updateRiskMatrixConfigAction} className="rag-editor" style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ fontSize: "12px", fontWeight: 700 }}>Low ≤<input name="lowMax" type="number" min={1} max={23} defaultValue={config.lowMax} /></label>
        <label style={{ fontSize: "12px", fontWeight: 700 }}>Medium ≤<input name="moderateMax" type="number" min={2} max={24} defaultValue={config.moderateMax} /></label>
        <label style={{ fontSize: "12px", fontWeight: 700 }}>High ≤<input name="highMax" type="number" min={3} max={24} defaultValue={config.highMax} /></label>
        <label style={{ fontSize: "12px", fontWeight: 700 }}>Appetite<input name="appetite" type="number" min={1} max={25} defaultValue={config.appetite ?? ""} /></label>
        <button className="button secondary">Save thresholds</button>
      </form> : <p style={{ fontSize: "12px", color: "#596273", margin: 0 }}>Only workspace operators can change these thresholds.</p>}
    </Card>
    <Card><div className="data-table-wrap" role="region" aria-label="Risk register table" tabIndex={0}><table><thead><tr><th>Ref</th><th>Risk</th><th>Inherent</th><th>Residual</th><th>Status</th><th>Review</th><th></th></tr></thead><tbody>
      {data?.map((r) => { const inherent = calculateRiskScore(r.likelihood, r.impact); const residual = calculateRiskScore(r.residual_likelihood, r.residual_impact); const linked = tasksByRisk.get(r.id) ?? []; const freshness = summariseEvidenceFreshness(evidenceByRisk.get(r.id) ?? []); return <tr key={r.id}>
        <td>{r.reference}</td>
        <td><b><Link href={`/app/risks/${r.id}`}>{r.title}</Link></b><small>{one(r.risk_categories)?.name ?? "—"}</small>{linked.length > 0 && <small>Linked tasks: {linked.map((t, i) => <span key={t.id}>{i > 0 && ", "}<Link href={`/app/tasks/${t.id}`}>{t.title}</Link></span>)}</small>}{freshness.total > 0 && <small>Evidence: {freshness.total}{freshness.expiring > 0 ? ` · ${freshness.expiring} expiring` : ""}{freshness.expired > 0 ? ` · ${freshness.expired} expired` : ""}</small>}</td>
        <td>{(() => { const band = riskBand(inherent, config); return <Pill tone={exceedsAppetite(inherent, config) ? "critical" : (BAND_TONE[band] ?? "neutral")}>{inherent} · {RISK_BAND_LABEL[band]}</Pill>; })()}</td>
        <td>{(() => { const band = riskBand(residual, config); return <Pill tone={exceedsAppetite(residual, config) ? "critical" : (BAND_TONE[band] ?? "neutral")}>{residual} · {RISK_BAND_LABEL[band]}</Pill>; })()}</td>
        <td>{canManage ? <RiskStatusSelect id={r.id} status={r.status} /> : <span style={{ textTransform: "capitalize" }}>{r.status}</span>}</td>
        <td>{r.review_date ?? "—"}</td>
        <td>{canManage && <form action={deleteRiskAction}><input type="hidden" name="id" value={r.id} /><button style={{ color: "var(--red)", border: 0, background: "none" }}>Delete</button></form>}</td>
      </tr>; })}
    </tbody></table></div></Card>
    </>)}
  </>;
}
