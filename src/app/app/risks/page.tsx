import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { acceptRiskSuggestionAction, deleteRiskAction, updateRiskStatusAction } from "../actions";
import { calculateRiskScore, riskBand } from "@/features/risks/domain/risks";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";

const BAND_TONE: Record<string, string> = { low: "green", medium: "amber", high: "red", very_high: "critical" };

export default async function RisksPage() {
  const { supabase } = await requireAppContext();
  const [{ data }, { data: gaps }, { data: linkedTasks }, { data: evidenceLinks }] = await Promise.all([
    supabase.from("risks").select("id,reference,title,category_id,risk_categories(name),likelihood,impact,residual_likelihood,residual_impact,status,review_date").order("updated_at", { ascending: false }),
    supabase.from("assessment_responses").select("session_id,question_id,answer,catalogue_questions!assessment_responses_question_id_fkey(code,prompt)").in("answer", ["no", "partially"]).limit(10),
    supabase.from("tasks").select("id,title,risk_id,status").in("status", ["open", "in_progress"]).not("risk_id", "is", null),
    supabase.from("evidence_links").select("risk_id,evidence(status)").not("risk_id", "is", null),
  ]);
  const tasksByRisk = new Map<string, { id: string; title: string }[]>();
  for (const t of linkedTasks ?? []) { if (!t.risk_id) continue; const list = tasksByRisk.get(t.risk_id) ?? []; list.push({ id: t.id, title: t.title }); tasksByRisk.set(t.risk_id, list); }
  const evidenceByRisk = new Map<string, { status: EvidenceStatus }[]>();
  for (const link of evidenceLinks ?? []) { if (!link.risk_id) continue; const ev = Array.isArray(link.evidence) ? link.evidence[0] : link.evidence; if (!ev) continue; const list = evidenceByRisk.get(link.risk_id) ?? []; list.push({ status: ev.status as EvidenceStatus }); evidenceByRisk.set(link.risk_id, list); }
  return <>
    <PageIntro eyebrow="RISK" title="Risk register" body="Track inherent and residual exposure on a documented 5×5 matrix." action={<Link className="button primary" href="/app/risks/new"><Icon name="plus" />Add risk</Link>} />
    {Boolean(gaps?.length) && <Card style={{ padding: "20px", marginBottom: "16px", borderColor: "#efe1aa", background: "#fffbef" }}><h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Assessment gap suggestions</h2><p style={{ fontSize: "12px", color: "#596273", margin: 0 }}>Nothing is created until you accept it.</p>{gaps?.map((g) => { const q = Array.isArray(g.catalogue_questions) ? g.catalogue_questions[0] : g.catalogue_questions; return <div key={`${g.session_id}-${g.question_id}`} style={{ display: "flex", justifyContent: "space-between", gap: "16px", marginTop: "12px" }}><span style={{ fontSize: "13px" }}>{q?.code}: {q?.prompt}</span><span style={{ display: "flex", flexShrink: 0, gap: "16px" }}><form action={acceptRiskSuggestionAction}><input type="hidden" name="questionId" value={g.question_id} /><input type="hidden" name="sessionId" value={g.session_id} /><button style={{ color: "var(--blue)", fontWeight: 700, border: 0, background: "none" }}>Accept as risk</button></form><Link style={{ color: "var(--blue)", fontWeight: 700 }} href={`/app/tasks/from-gap?questionId=${g.question_id}`}>Accept as task</Link></span></div>; })}</Card>}
    <Card><div className="data-table-wrap" role="region" aria-label="Risk register table" tabIndex={0}><table><thead><tr><th>Ref</th><th>Risk</th><th>Inherent</th><th>Residual</th><th>Status</th><th>Review</th><th></th></tr></thead><tbody>
      {data?.map((r) => { const inherent = calculateRiskScore(r.likelihood, r.impact); const residual = calculateRiskScore(r.residual_likelihood, r.residual_impact); const linked = tasksByRisk.get(r.id) ?? []; const freshness = summariseEvidenceFreshness(evidenceByRisk.get(r.id) ?? []); return <tr key={r.id}>
        <td>{r.reference}</td>
        <td><b>{r.title}</b><small>{(Array.isArray(r.risk_categories) ? r.risk_categories[0] : r.risk_categories)?.name ?? "—"}</small>{linked.length > 0 && <small>Linked tasks: {linked.map((t, i) => <span key={t.id}>{i > 0 && ", "}<Link href={`/app/tasks/${t.id}`}>{t.title}</Link></span>)}</small>}{freshness.total > 0 && <small>Evidence: {freshness.total}{freshness.expiring > 0 ? ` · ${freshness.expiring} expiring` : ""}{freshness.expired > 0 ? ` · ${freshness.expired} expired` : ""}</small>}</td>
        <td><Pill tone={BAND_TONE[riskBand(inherent)] ?? "neutral"}>{inherent} · {riskBand(inherent).replace("_", " ")}</Pill></td>
        <td><Pill tone={BAND_TONE[riskBand(residual)] ?? "neutral"}>{residual} · {riskBand(residual).replace("_", " ")}</Pill></td>
        <td><form action={updateRiskStatusAction}><input type="hidden" name="id" value={r.id} /><select name="status" defaultValue={r.status} onChange={(e) => e.currentTarget.form?.requestSubmit()}><option value="open">Open</option><option value="treating">Treating</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select></form></td>
        <td>{r.review_date ?? "—"}</td>
        <td><form action={deleteRiskAction}><input type="hidden" name="id" value={r.id} /><button style={{ color: "var(--red)", border: 0, background: "none" }}>Delete</button></form></td>
      </tr>; })}
    </tbody></table></div></Card>
  </>;
}
