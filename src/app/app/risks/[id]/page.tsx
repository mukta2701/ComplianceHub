import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { calculateRiskScore, riskBand, RISK_BAND_LABEL, RISK_STATUS_LABEL, DEFAULT_RISK_MATRIX_CONFIG, type RiskMatrixConfig, type RiskStatus } from "@/features/risks/domain/risks";
import { nextRtpReference, summariseRtpProgress, RTP_STATUS_LABEL, RTP_STATUS_TONE, type RtpStatus } from "@/features/risks/domain/rtp";
import { Card, PageIntro, Pill } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { createRtpAction, updateRtpStatusAction, deleteRtpAction } from "../rtp-actions";
import { AiSuggestionPanel } from "@/components/ai-suggestion-panel";
import styles from "../risk-workspace.module.css";

const TREATMENT_LABEL: Record<string, string> = { mitigate: "Mitigate", avoid: "Avoid", transfer: "Transfer", accept: "Accept" };
const EVIDENCE_TONE: Record<string, string> = { current: "green", expiring: "amber", expired: "red", withdrawn: "neutral" };

export default async function RiskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organisation, membership } = await requireAppContext();
  const canManage = membership.role !== "member";
  const { data: risk, error: riskError } = await supabase.from("risks").select("id,reference,title,description,owner_id,evidence,likelihood,impact,residual_likelihood,residual_impact,status,review_date,treatment,treatment_plan,risk_categories(name)").eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (riskError) throw new Error("Could not load the risk");
  if (!risk) notFound();

  const referencesPromise = (async () => {
    const references: string[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const result = await supabase.from("risk_treatment_plans").select("reference").eq("organisation_id", organisation.id).order("reference").range(from, from + pageSize - 1);
      if (result.error) return { data: null, error: result.error };
      references.push(...(result.data ?? []).map((item) => item.reference));
      if ((result.data?.length ?? 0) < pageSize) return { data: references, error: null };
    }
  })();

  const [plansResult, configResult, membersResult, controlsResult, assetsResult, tasksResult, evidenceResult, referencesResult, aiResult] = await Promise.all([
    supabase.from("risk_treatment_plans").select("id,reference,summary,treatment_measures,status,target_completion,actual_completion,assigned_lead_id").eq("risk_id", id).eq("organisation_id", organisation.id).order("reference"),
    supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").eq("organisation_id", organisation.id).maybeSingle(),
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("asset_risks").select("asset_id,assets(id,reference,description)").eq("risk_id", id).eq("organisation_id", organisation.id).order("asset_id"),
    supabase.from("tasks").select("id,title,status,due_on").eq("risk_id", id).eq("organisation_id", organisation.id).order("due_on"),
    supabase.from("evidence_links").select("id,evidence(id,title,status,kind)").eq("risk_id", id).eq("organisation_id", organisation.id),
    referencesPromise,
    supabase.from("ai_workspace_settings").select("enabled").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  if (configResult.error) throw new Error("Could not load the risk scoring thresholds");
  if (membersResult.error) throw new Error("Could not load risk ownership");
  if (aiResult.error) throw new Error("Could not load the risk workspace");
  const cfg = configResult.data;
  const config: RiskMatrixConfig = cfg ? { lowMax: cfg.low_max, moderateMax: cfg.moderate_max, highMax: cfg.high_max, appetite: cfg.appetite_threshold } : DEFAULT_RISK_MATRIX_CONFIG;
  const members = membersResult.data ?? [];
  const leadName = new Map(members.map((member) => { const profile = one(member.profiles); return [member.user_id, profile?.display_name ?? null] as const; }));
  const category = one(risk.risk_categories);
  const inherent = calculateRiskScore(risk.likelihood, risk.impact);
  const residual = calculateRiskScore(risk.residual_likelihood, risk.residual_impact);
  const inherentBand = riskBand(inherent, config);
  const residualBand = riskBand(residual, config);
  const plans = plansResult.data ?? [];
  const progress = plansResult.error ? null : summariseRtpProgress(plans.map((plan) => ({ status: plan.status as RtpStatus })));
  const nextRef = referencesResult.error ? "" : nextRtpReference(referencesResult.data ?? []);

  return <>
    <Link href="/app/risks" className={styles.pageBack}><span aria-hidden="true">←</span> Back to risk register</Link>
    <PageIntro eyebrow={`RISK ${risk.reference}`} title={risk.title} body={risk.description} action={canManage && <Link className="button secondary" href={`/app/risks/${id}/edit`}>Edit risk</Link>} />

    <div className={styles.detailHero}>
      <Card className={styles.exposureCard}>
        <h2>Exposure decision</h2>
        <div className={styles.exposureFlow}>
          <div className={styles.exposureBox}><small>Inherent · before safeguards</small><strong>{inherent} · {RISK_BAND_LABEL[inherentBand]}</strong></div>
          <div className={styles.exposureArrow} aria-hidden="true">→</div>
          <div className={styles.exposureBox}><small>Residual · after safeguards</small><strong>{residual} · {RISK_BAND_LABEL[residualBand]}</strong></div>
        </div>
        <p className={styles.exposureCaption}>The residual score records the expected remaining exposure. It does not independently verify that safeguards are operating.</p>
      </Card>
      <Card className={styles.decisionCard}>
        <h2>Accountability and review</h2>
        <dl className={styles.decisionGrid}>
          <div><dt>Owner</dt><dd className={risk.owner_id ? undefined : styles.missing}>{leadName.get(risk.owner_id) ?? "Unassigned"}</dd></div>
          <div><dt>Next review</dt><dd className={risk.review_date ? undefined : styles.missing}>{risk.review_date ?? "Not scheduled"}</dd></div>
          <div><dt>Status</dt><dd>{RISK_STATUS_LABEL[risk.status as RiskStatus] ?? risk.status}</dd></div>
          <div><dt>Treatment</dt><dd>{TREATMENT_LABEL[risk.treatment] ?? risk.treatment}</dd></div>
          <div><dt>Category</dt><dd>{category?.name ?? "Not recorded"}</dd></div>
        </dl>
      </Card>
    </div>

    <div className={styles.detailGrid}>
      <div>
        <Card className={styles.contentCard}>
          <h2>Treatment context</h2>
          <h3>Overall approach</h3>
          <p>{risk.treatment_plan || "No overall treatment approach has been documented."}</p>
          <h3>Free-text evidence references</h3>
          <p>{risk.evidence || "No supporting references have been recorded."}</p>
          <p className={styles.supportNote}>Free-text references are supporting notes. Linked evidence below has its own freshness and review state.</p>
        </Card>
        {aiResult.data?.enabled && <AiSuggestionPanel target={{ targetType: "risk", targetId: risk.id }} />}
      </div>

      <aside>
        <Card className={styles.contentCard}>
          <section className={styles.linkedSection}>
            <h2>Linked tasks</h2>
            <p>Accountable work created to reduce or review this exposure.</p>
            {tasksResult.error ? <p role="alert">Linked tasks could not be loaded. Reload this page to try again.</p> : <ul className={styles.linkedList}>
              {(tasksResult.data ?? []).map((task) => <li className={styles.linkedItem} key={task.id}><Link href={`/app/tasks/${task.id}`}>{task.title}</Link><small>{task.due_on ?? "No due date"} · {RISK_STATUS_LABEL[task.status as RiskStatus] ?? task.status.replaceAll("_", " ")}</small></li>)}
              {!tasksResult.data?.length && <li className={styles.emptyLine}>No tasks linked to this risk yet.</li>}
            </ul>}
          </section>
          <section className={styles.linkedSection}>
            <h2>Linked evidence</h2>
            <p>Managed evidence records; freshness remains separate from human review.</p>
            {evidenceResult.error ? <p role="alert">Linked evidence could not be loaded. Reload this page to try again.</p> : <ul className={styles.linkedList}>
              {(evidenceResult.data ?? []).map((link) => { const evidence = one(link.evidence); return <li className={styles.linkedItem} key={link.id}>{evidence ? <><Link href={`/app/evidence?evidence=${evidence.id}#evidence-${evidence.id}`}>{evidence.title}</Link><Pill tone={EVIDENCE_TONE[evidence.status] ?? "neutral"}>{evidence.status}</Pill></> : <span>Linked evidence unavailable.</span>}</li>; })}
              {!evidenceResult.data?.length && <li className={styles.emptyLine}>No managed evidence linked to this risk yet.</li>}
            </ul>}
          </section>
          <section className={styles.linkedSection}>
            <h2>Linked assets</h2>
            <p>Information and systems connected to this exposure.</p>
            {assetsResult.error ? <p role="alert">Linked assets could not be loaded. Reload this page to try again.</p> : <ul className={styles.linkedList}>
              {(assetsResult.data ?? []).map((link) => { const asset = one(link.assets); return <li className={styles.linkedItem} key={link.asset_id}>{asset ? <Link href={`/app/assets/${asset.id}`}>{asset.reference}: {asset.description}</Link> : <span>Linked asset unavailable.</span>}</li>; })}
              {!assetsResult.data?.length && <li className={styles.emptyLine}>No assets linked to this risk yet.</li>}
            </ul>}
          </section>
        </Card>
      </aside>
    </div>

    <Card className={styles.treatmentCard}>
      <div className={styles.sectionHeader}>
        <div><h2>Treatment plans</h2><p>Deliverables can reduce exposure, but completing them does not automatically close this risk.</p></div>
        {progress && <div className={styles.progressPills}><Pill>{progress.open} outstanding</Pill><Pill tone="green">{progress.completed} completed</Pill>{progress.cancelled > 0 && <Pill tone="neutral">{progress.cancelled} cancelled</Pill>}{progress.allComplete && <Pill tone="green">All plans complete</Pill>}</div>}
      </div>
      {plansResult.error ? <p role="alert">Treatment plans could not be loaded. Reload this page to try again.</p> : <ul className={styles.planList}>
        {plans.map((plan) => { const lead = leadName.get(plan.assigned_lead_id); return <li key={plan.id} className={styles.planItem}>
          <div className={styles.planBody}><strong>{plan.reference}{plan.summary ? ` — ${plan.summary}` : ""}</strong>{plan.treatment_measures && <span>{plan.treatment_measures}</span>}<small>Lead: {lead ?? "Unassigned"}{plan.target_completion ? ` · target ${plan.target_completion}` : ""}{plan.actual_completion ? ` · completed ${plan.actual_completion}` : ""}</small></div>
          <div className={styles.planActions}><Pill tone={RTP_STATUS_TONE[plan.status as RtpStatus]}>{RTP_STATUS_LABEL[plan.status as RtpStatus]}</Pill>
            {canManage && <form action={updateRtpStatusAction}><input type="hidden" name="id" value={plan.id} /><input type="hidden" name="riskId" value={id} /><select name="status" className="field" defaultValue={plan.status} aria-label={`Status for ${plan.reference}`}><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><button className="button secondary">Save</button></form>}
            {canManage && <form action={deleteRtpAction}><input type="hidden" name="id" value={plan.id} /><input type="hidden" name="riskId" value={id} /><button className={styles.deleteAction} aria-label={`Delete ${plan.reference}`}>Delete</button></form>}
          </div>
        </li>; })}
        {!plans.length && <li className={styles.emptyLine}>No treatment plans yet.</li>}
      </ul>}

      {canManage && <details className={styles.addPlan}>
        <summary>Add a treatment plan</summary>
        {referencesResult.error || controlsResult.error ? <p role="alert">Treatment-plan choices could not be loaded. Reload this page to try again.</p> : <form action={createRtpAction} className="app-form">
          <input type="hidden" name="riskId" value={id} />
          <div className="form-grid">
            <label>Reference<input name="reference" required maxLength={40} defaultValue={nextRef} /></label>
            <label>Assigned lead<select name="assignedLeadId" defaultValue=""><option value="">Unassigned</option>{members.map((member) => { const profile = one(member.profiles); return <option key={member.user_id} value={member.user_id}>{profile?.display_name ?? member.user_id}</option>; })}</select></label>
            <label>Control reference<select name="controlId" defaultValue=""><option value="">None</option>{(controlsResult.data ?? []).map((control) => <option key={control.id} value={control.id}>{control.code}: {control.title}</option>)}</select></label>
            <label>Target completion<input name="targetCompletion" type="date" /></label>
          </div>
          <label>Summary<input name="summary" maxLength={2000} /></label>
          <label>Treatment measures<textarea name="treatmentMeasures" maxLength={10000} /></label>
          <label style={{ display:"flex",gap:"8px",alignItems:"center",flexDirection:"row" }}><input type="checkbox" name="spawnTask" value="on" style={{ width:"auto",margin:0 }} />Also create an owned, dated task for this plan</label>
          <button className="button primary">Add treatment plan</button>
        </form>}
      </details>}
    </Card>
  </>;
}
