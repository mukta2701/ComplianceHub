import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { acceptRiskSuggestionAction, deleteRiskAction } from "../actions";
import { RiskStatusSelect } from "./risk-status-select";
import { calculateRiskScore, riskBand, exceedsAppetite, RISK_BAND_LABEL, DEFAULT_RISK_MATRIX_CONFIG, type RiskMatrixConfig } from "@/features/risks/domain/risks";
import { updateRiskMatrixConfigAction } from "./config-actions";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";

const BAND_TONE: Record<string, string> = { low: "green", moderate: "amber", high: "red", very_high: "critical" };

export default async function RisksPage() {
  const { supabase } = await requireAppContext();
  const [{ data }, { data: gaps }, { data: linkedTasks }, { data: evidenceLinks }, { data: cfg }] = await Promise.all([
    supabase.from("risks").select("id,reference,title,category_id,risk_categories(name),likelihood,impact,residual_likelihood,residual_impact,status,review_date").order("updated_at", { ascending: false }),
    supabase.from("assessment_responses").select("session_id,question_id,answer,catalogue_questions!assessment_responses_question_id_fkey(code,prompt)").in("answer", ["no", "partially"]).limit(10),
    supabase.from("tasks").select("id,title,risk_id,status").in("status", ["open", "in_progress"]).not("risk_id", "is", null),
    supabase.from("evidence_links").select("risk_id,evidence(status)").not("risk_id", "is", null),
    supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").maybeSingle(),
  ]);
  const config: RiskMatrixConfig = cfg ? { lowMax: cfg.low_max, moderateMax: cfg.moderate_max, highMax: cfg.high_max, appetite: cfg.appetite_threshold } : DEFAULT_RISK_MATRIX_CONFIG;
  const tasksByRisk = new Map<string, { id: string; title: string }[]>();
  for (const t of linkedTasks ?? []) { if (!t.risk_id) continue; const list = tasksByRisk.get(t.risk_id) ?? []; list.push({ id: t.id, title: t.title }); tasksByRisk.set(t.risk_id, list); }
  const evidenceByRisk = new Map<string, { status: EvidenceStatus }[]>();
  for (const link of evidenceLinks ?? []) { if (!link.risk_id) continue; const ev = Array.isArray(link.evidence) ? link.evidence[0] : link.evidence; if (!ev) continue; const list = evidenceByRisk.get(link.risk_id) ?? []; list.push({ status: ev.status as EvidenceStatus }); evidenceByRisk.set(link.risk_id, list); }
  return <>
    <PageIntro eyebrow="RISK" title="Risk register" body="Track inherent and residual exposure on a documented 5×5 matrix." action={<span style={{ display: "flex", gap: "8px" }}>
      <a className="button secondary" href="/api/app/risks/export?format=xlsx">Export XLSX</a>
      <a className="button secondary" href="/api/app/risks/export?format=csv">CSV</a>
      <Link className="button secondary" href="/app/risks/import">Import</Link>
      <Link className="button primary" href="/app/risks/new"><Icon name="plus" />Add risk</Link>
    </span>} />
    {Boolean(gaps?.length) && <Card style={{ padding: "20px", marginBottom: "16px", borderColor: "#efe1aa", background: "#fffbef" }}><h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Assessment gap suggestions</h2><p style={{ fontSize: "12px", color: "#596273", margin: 0 }}>Nothing is created until you accept it.</p>{gaps?.map((g) => { const q = Array.isArray(g.catalogue_questions) ? g.catalogue_questions[0] : g.catalogue_questions; return <div key={`${g.session_id}-${g.question_id}`} style={{ display: "flex", justifyContent: "space-between", gap: "16px", marginTop: "12px" }}><span style={{ fontSize: "13px" }}>{q?.code}: {q?.prompt}</span><span style={{ display: "flex", flexShrink: 0, gap: "16px" }}><form action={acceptRiskSuggestionAction}><input type="hidden" name="questionId" value={g.question_id} /><input type="hidden" name="sessionId" value={g.session_id} /><button style={{ color: "var(--blue)", fontWeight: 700, border: 0, background: "none" }}>Accept as risk</button></form><Link style={{ color: "var(--blue)", fontWeight: 700 }} href={`/app/tasks/from-gap?questionId=${g.question_id}`}>Accept as task</Link></span></div>; })}</Card>}
    {!data?.length ? (
      <Card style={{ padding: "48px 24px", textAlign: "center" }}>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--blue-pale)", color: "var(--blue)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}><Icon name="alert" /></div>
        <h2 style={{ fontSize: "16px", margin: "0 0 6px" }}>Start your risk register</h2>
        <p style={{ fontSize: "13px", color: "#596273", margin: "0 auto 18px", maxWidth: "440px" }}>Record the threats to your information — each scored for inherent and residual likelihood and impact on a documented 5×5 matrix. Add your first risk, or import a register you already keep in a spreadsheet.</p>
        <span style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
          <Link className="button primary" href="/app/risks/new"><Icon name="plus" />Add your first risk</Link>
          <Link className="button secondary" href="/app/risks/import">Import from spreadsheet</Link>
        </span>
      </Card>
    ) : (<>
    <Card style={{ padding: "18px", marginBottom: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>RAG band thresholds</h2>
      <p style={{ fontSize: "12px", color: "#596273", margin: "0 0 12px" }}>Set the top of each band on the 1–25 scale. Scores above your appetite are flagged Critical.</p>
      <form action={updateRiskMatrixConfigAction} className="rag-editor" style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ fontSize: "12px", fontWeight: 700 }}>Low ≤<input name="lowMax" type="number" min={1} max={23} defaultValue={config.lowMax} /></label>
        <label style={{ fontSize: "12px", fontWeight: 700 }}>Medium ≤<input name="moderateMax" type="number" min={2} max={24} defaultValue={config.moderateMax} /></label>
        <label style={{ fontSize: "12px", fontWeight: 700 }}>High ≤<input name="highMax" type="number" min={3} max={24} defaultValue={config.highMax} /></label>
        <label style={{ fontSize: "12px", fontWeight: 700 }}>Appetite<input name="appetite" type="number" min={1} max={25} defaultValue={config.appetite ?? ""} /></label>
        <button className="button secondary">Save thresholds</button>
      </form>
    </Card>
    <Card><div className="data-table-wrap" role="region" aria-label="Risk register table" tabIndex={0}><table><thead><tr><th>Ref</th><th>Risk</th><th>Inherent</th><th>Residual</th><th>Status</th><th>Review</th><th></th></tr></thead><tbody>
      {data?.map((r) => { const inherent = calculateRiskScore(r.likelihood, r.impact); const residual = calculateRiskScore(r.residual_likelihood, r.residual_impact); const linked = tasksByRisk.get(r.id) ?? []; const freshness = summariseEvidenceFreshness(evidenceByRisk.get(r.id) ?? []); return <tr key={r.id}>
        <td>{r.reference}</td>
        <td><b><Link href={`/app/risks/${r.id}`}>{r.title}</Link></b><small>{(Array.isArray(r.risk_categories) ? r.risk_categories[0] : r.risk_categories)?.name ?? "—"}</small>{linked.length > 0 && <small>Linked tasks: {linked.map((t, i) => <span key={t.id}>{i > 0 && ", "}<Link href={`/app/tasks/${t.id}`}>{t.title}</Link></span>)}</small>}{freshness.total > 0 && <small>Evidence: {freshness.total}{freshness.expiring > 0 ? ` · ${freshness.expiring} expiring` : ""}{freshness.expired > 0 ? ` · ${freshness.expired} expired` : ""}</small>}</td>
        <td>{(() => { const band = riskBand(inherent, config); return <Pill tone={exceedsAppetite(inherent, config) ? "critical" : (BAND_TONE[band] ?? "neutral")}>{inherent} · {RISK_BAND_LABEL[band]}</Pill>; })()}</td>
        <td>{(() => { const band = riskBand(residual, config); return <Pill tone={exceedsAppetite(residual, config) ? "critical" : (BAND_TONE[band] ?? "neutral")}>{residual} · {RISK_BAND_LABEL[band]}</Pill>; })()}</td>
        <td><RiskStatusSelect id={r.id} status={r.status} /></td>
        <td>{r.review_date ?? "—"}</td>
        <td><form action={deleteRiskAction}><input type="hidden" name="id" value={r.id} /><button style={{ color: "var(--red)", border: 0, background: "none" }}>Delete</button></form></td>
      </tr>; })}
    </tbody></table></div></Card>
    </>)}
  </>;
}
