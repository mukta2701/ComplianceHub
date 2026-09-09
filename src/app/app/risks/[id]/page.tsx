import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { calculateRiskScore, riskBand, RISK_BAND_LABEL, DEFAULT_RISK_MATRIX_CONFIG, type RiskMatrixConfig } from "@/features/risks/domain/risks";
import { summariseRtpProgress, RTP_STATUS_LABEL, RTP_STATUS_TONE, type RtpStatus } from "@/features/risks/domain/rtp";
import { Card, PageIntro, Pill } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { createRtpAction, updateRtpStatusAction, deleteRtpAction } from "../rtp-actions";
import { AiSuggestionPanel } from "@/components/ai-suggestion-panel";

export default async function RiskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organisation, membership } = await requireAppContext();
  const canManage = membership.role !== "member";
  const { data: risk } = await supabase.from("risks").select("id,reference,title,description,owner_id,evidence,likelihood,impact,residual_likelihood,residual_impact,status,review_date,treatment,treatment_plan,risk_categories(name)").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (!risk) notFound();
  const [{ data: plans }, { data: cfg }, { data: members }, { data: controls }, { data: linkedAssets, error: linkedAssetsError }, { data: aiSettings }] = await Promise.all([
    supabase.from("risk_treatment_plans").select("id,reference,summary,treatment_measures,status,target_completion,actual_completion,assigned_lead_id").eq("risk_id", id).eq("organisation_id", organisation.id).order("reference"),
    supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").eq("organisation_id", organisation.id).maybeSingle(),
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("asset_risks").select("asset_id,assets(id,reference,description)").eq("risk_id", id).eq("organisation_id", organisation.id).order("asset_id"),
    supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  const config: RiskMatrixConfig = cfg ? { lowMax: cfg.low_max, moderateMax: cfg.moderate_max, highMax: cfg.high_max, appetite: cfg.appetite_threshold } : DEFAULT_RISK_MATRIX_CONFIG;
  const leadName = new Map((members ?? []).map((m) => { const p = one(m.profiles); return [m.user_id, p?.display_name ?? null] as const; }));
  const category = one(risk.risk_categories);
  const inherent = calculateRiskScore(risk.likelihood, risk.impact);
  const residual = calculateRiskScore(risk.residual_likelihood, risk.residual_impact);
  const progress = summariseRtpProgress((plans ?? []).map((p) => ({ status: p.status as RtpStatus })));
  const nextRef = `RTP-${String((plans?.length ?? 0) + 1).padStart(3, "0")}`;
  return <>
    <Link href="/app/risks" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to risks</Link>
    <PageIntro eyebrow={`RISK ${risk.reference}`} title={risk.title} body={risk.description} action={canManage && <Link className="button secondary" href={`/app/risks/${id}/edit`}>Edit risk</Link>} />
    <Card style={{ padding: "22px" }}><dl className="fact-grid">
      <div><dt>Category</dt><dd>{category?.name ?? "—"}</dd></div>
      <div><dt>Owner</dt><dd>{leadName.get(risk.owner_id) ?? "Unassigned"}</dd></div>
      <div><dt>Inherent</dt><dd>{inherent} · {RISK_BAND_LABEL[riskBand(inherent, config)]}</dd></div>
      <div><dt>Residual</dt><dd>{residual} · {RISK_BAND_LABEL[riskBand(residual, config)]}</dd></div>
      <div><dt>Status</dt><dd style={{ textTransform: "capitalize" }}>{risk.status}</dd></div>
      <div><dt>Treatment</dt><dd style={{ textTransform: "capitalize" }}>{risk.treatment}</dd></div>
      <div><dt>Review date</dt><dd>{risk.review_date ?? "—"}</dd></div>
    </dl>
      {risk.treatment_plan && <><h3 style={{ fontSize: "14px" }}>Treatment approach</h3><p style={{ whiteSpace: "pre-wrap" }}>{risk.treatment_plan}</p></>}
      {risk.evidence && <><h3 style={{ fontSize: "14px" }}>Evidence references</h3><p style={{ whiteSpace: "pre-wrap" }}>{risk.evidence}</p></>}
    </Card>
    <Card style={{ padding: "22px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 8px" }}>Linked assets</h2>
      <p style={{ color: "var(--ch-text-muted)", fontSize: "13px", margin: "0 0 12px" }}>See the information and systems connected to this exposure. Manage each relationship from its asset record.</p>
      {linkedAssetsError ? <p role="alert" style={{ color: "var(--ch-risk)", fontSize: "13px" }}>Linked assets could not be loaded. Reload this page to try again.</p> : <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
        {(linkedAssets ?? []).map((link) => {
          const asset = one(link.assets);
          return <li key={link.asset_id}>{asset ? <Link className="button secondary" style={{ justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: "100%" }} href={`/app/assets/${asset.id}`}>{asset.reference}: {asset.description}</Link> : <span>Linked asset unavailable.</span>}</li>;
        })}
        {!linkedAssets?.length && <li style={{ color: "var(--ch-text-muted)", fontSize: "13px" }}>No assets linked to this risk yet.</li>}
      </ul>}
    </Card>
    {aiSettings?.enabled && <AiSuggestionPanel target={{ targetType: "risk", targetId: risk.id }} />}
    <Card style={{ padding: "22px", marginTop: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div><h2 style={{ fontSize: "15px", margin: 0 }}>Treatment plans</h2><p style={{ fontSize: "12px", color: "#596273", margin: "3px 0 0" }}>{progress.total} plan(s) · {progress.open} open{progress.allComplete ? " · all complete" : ""}</p></div>
        {progress.allComplete && <Pill tone="green">All plans complete</Pill>}
      </div>
      <ul style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gap: "10px" }}>
        {plans?.map((p) => { const lead = leadName.get(p.assigned_lead_id); return <li key={p.id} className="card" style={{ padding: "14px", display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <span><b>{p.reference}</b>{p.summary && <> — {p.summary}</>}{p.treatment_measures && <span style={{ display: "block", whiteSpace: "pre-wrap", marginTop: "6px" }}>{p.treatment_measures}</span>}<small style={{ display: "block", color: "#596273" }}>Lead: {lead ?? "Unassigned"}{p.target_completion ? ` · target ${p.target_completion}` : ""}{p.actual_completion ? ` · done ${p.actual_completion}` : ""}</small></span>
          <span style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Pill tone={RTP_STATUS_TONE[p.status as RtpStatus]}>{RTP_STATUS_LABEL[p.status as RtpStatus]}</Pill>
            {canManage && <form action={updateRtpStatusAction} style={{ display: "flex", gap: "6px", alignItems: "center" }}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="riskId" value={id} /><select name="status" className="field" defaultValue={p.status} aria-label={`Status for ${p.reference}`}><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Save</button></form>}
            {canManage && <form action={deleteRtpAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="riskId" value={id} /><button style={{ color: "var(--red)", border: 0, background: "none" }} aria-label={`Delete ${p.reference}`}>Delete</button></form>}
          </span>
        </li>; })}
        {!plans?.length && <li style={{ color: "#596273", fontSize: "13px" }}>No treatment plans yet.</li>}
      </ul>
      {canManage && <form action={createRtpAction} className="app-form" style={{ marginTop: "16px", padding: "16px", borderTop: "1px solid #edf0f4" }}>
        <input type="hidden" name="riskId" value={id} />
        <h3 style={{ fontSize: "13px", margin: 0 }}>Add a treatment plan</h3>
        <div className="form-grid">
          <label>Reference<input name="reference" required maxLength={40} defaultValue={nextRef} /></label>
          <label>Assigned lead<select name="assignedLeadId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = one(m.profiles); return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
          <label>Control reference<select name="controlId" defaultValue=""><option value="">None</option>{controls?.map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title}</option>)}</select></label>
          <label>Target completion<input name="targetCompletion" type="date" /></label>
        </div>
        <label>Summary<input name="summary" maxLength={2000} /></label>
        <label>Treatment measures<textarea name="treatmentMeasures" maxLength={10000} /></label>
        <label style={{ display: "flex", gap: "8px", alignItems: "center", flexDirection: "row" }}><input type="checkbox" name="spawnTask" value="on" style={{ width: "auto", margin: 0 }} />Also create an owned, dated task for this plan</label>
        <button className="button primary">Add treatment plan</button>
      </form>}
    </Card>
  </>;
}
