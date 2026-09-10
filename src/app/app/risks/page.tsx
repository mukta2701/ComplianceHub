import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { acceptRiskSuggestionAction, deleteRiskAction } from "../actions";
import { RiskStatusSelect } from "./risk-status-select";
import { calculateRiskScore, riskBand, exceedsAppetite, RISK_BAND_LABEL, DEFAULT_RISK_MATRIX_CONFIG, type RiskMatrixConfig } from "@/features/risks/domain/risks";
import { updateRiskMatrixConfigAction } from "./config-actions";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import { Card, EmptyState, ModuleExplainer, PageIntro, Pill } from "@/components/ui";
import { getModuleGuidance } from "@/features/education/domain/guidance";
import { Icon } from "@/components/icons";
import { SubTabs } from "@/components/sub-tabs";
import { one } from "@/lib/supabase/one";
import { hasCapability } from "@/features/organisations/domain/access";
import styles from "./risk-workspace.module.css";

const BAND_TONE: Record<string, string> = { low:"green",moderate:"amber",high:"red",very_high:"critical" };
const BAND_COLOR: Record<string, string> = { low:"var(--rag-low)",moderate:"var(--rag-med)",high:"var(--rag-high)",very_high:"var(--rag-crit)" };
const STATUS_LABEL: Record<string, string> = { open:"Open",treating:"Treating",accepted:"Accepted",closed:"Closed" };

export default async function RisksPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  const canManage = membership.role !== "member";
  const [risksResult, gapsResult, tasksResult, evidenceResult, configResult, membersResult] = await Promise.all([
    supabase.from("risks").select("id,reference,title,category_id,owner_id,risk_categories(name),likelihood,impact,residual_likelihood,residual_impact,status,review_date", { count:"exact" }).eq("organisation_id", organisation.id).order("updated_at", { ascending:false }).limit(500),
    supabase.from("assessment_responses").select("session_id,question_id,answer,catalogue_questions!assessment_responses_question_id_fkey(code,prompt)").eq("organisation_id", organisation.id).in("answer", ["no","partially"]).limit(10),
    supabase.from("tasks").select("id,title,risk_id,status").eq("organisation_id", organisation.id).in("status", ["open","in_progress"]).not("risk_id", "is", null),
    supabase.from("evidence_links").select("risk_id,evidence(status)").eq("organisation_id", organisation.id).not("risk_id", "is", null),
    supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").eq("organisation_id", organisation.id).maybeSingle(),
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
  ]);
  if (risksResult.error || gapsResult.error || tasksResult.error || evidenceResult.error || configResult.error || membersResult.error) {
    throw new Error("Could not load the risk register");
  }

  const data = risksResult.data ?? [];
  const cfg = configResult.data;
  const config: RiskMatrixConfig = cfg ? { lowMax:cfg.low_max,moderateMax:cfg.moderate_max,highMax:cfg.high_max,appetite:cfg.appetite_threshold } : DEFAULT_RISK_MATRIX_CONFIG;
  const ownerName = new Map((membersResult.data ?? []).map((member) => [member.user_id, one(member.profiles)?.display_name ?? member.user_id] as const));
  const grid: number[][] = Array.from({ length:6 }, () => Array(6).fill(0));
  const nonClosed = data.filter((risk) => risk.status !== "closed");
  for (const risk of nonClosed) grid[risk.residual_likelihood][risk.residual_impact] += 1;

  const tasksByRisk = new Map<string,{id:string;title:string}[]>();
  for (const task of tasksResult.data ?? []) {
    if (!task.risk_id) continue;
    const list = tasksByRisk.get(task.risk_id) ?? [];
    list.push({ id:task.id,title:task.title });
    tasksByRisk.set(task.risk_id,list);
  }
  const evidenceByRisk = new Map<string,{status:EvidenceStatus}[]>();
  for (const link of evidenceResult.data ?? []) {
    if (!link.risk_id) continue;
    const evidence = one(link.evidence);
    if (!evidence) continue;
    const list = evidenceByRisk.get(link.risk_id) ?? [];
    list.push({ status:evidence.status as EvidenceStatus });
    evidenceByRisk.set(link.risk_id,list);
  }
  const gapSuggestions = (gapsResult.data ?? []).map((gap) => {
    const question = one(gap.catalogue_questions);
    return { key:`${gap.session_id}-${gap.question_id}`,questionId:gap.question_id,sessionId:gap.session_id,label:[question?.code,question?.prompt].filter(Boolean).join(": ") };
  });
  const today = new Date().toISOString().slice(0,10);
  const aboveAppetite = nonClosed.filter((risk) => exceedsAppetite(calculateRiskScore(risk.residual_likelihood,risk.residual_impact),config)).length;
  const overdue = nonClosed.filter((risk) => Boolean(risk.review_date && risk.review_date < today)).length;
  const unassigned = nonClosed.filter((risk) => !risk.owner_id).length;
  const attention = nonClosed.map((risk) => {
    const score = calculateRiskScore(risk.residual_likelihood,risk.residual_impact);
    const reason = exceedsAppetite(score,config) ? "Above appetite" : risk.review_date && risk.review_date < today ? "Review overdue" : !risk.owner_id ? "Unassigned" : null;
    return { risk,score,reason };
  }).filter((item) => item.reason).sort((a,b) => b.score-a.score).slice(0,3);
  const displayedTotal = risksResult.count ?? data.length;
  const capped = displayedTotal > data.length || data.length === 500;

  return <>
    <PageIntro eyebrow="RISK" title="Risk register" body="Understand current exposure, decide what needs attention, and keep treatment work moving." action={<span className={styles.headerActions}>
      <a className="button secondary" href="/api/app/risks/export?format=xlsx"><Icon name="download" />Export</a>
      {canManage && <Link className="button secondary" href="/app/risks/import">Import</Link>}
      {canManage && <Link className="button primary" href="/app/risks/new"><Icon name="plus" />Add risk</Link>}
    </span>} />
    <SubTabs tabs={[{ href:"/app/risks",label:"Risks" },{ href:"/app/assets",label:"Assets" }]} />
    <details className="section-guide"><summary>How to review risks</summary><ModuleExplainer guidance={getModuleGuidance("risks")} /></details>

    {Boolean(gapSuggestions.length) && <Card className={styles.gapCard}><h2>Follow up assessment gaps</h2><p>{canManage ? "These No or Partially answers need a human decision. Nothing is added until you choose." : "A workspace operator can turn these assessment gaps into risks or tasks."}</p>{gapSuggestions.map((gap) => <div key={gap.key} className={styles.gapRow}><span>{gap.label}</span><span className={styles.gapActions}>{canManage && <form action={acceptRiskSuggestionAction}><input type="hidden" name="questionId" value={gap.questionId} /><input type="hidden" name="sessionId" value={gap.sessionId} /><button className={styles.textAction}>Accept as risk</button></form>}{canManage && <Link href={`/app/tasks/from-gap?questionId=${gap.questionId}`}>Create task</Link>}</span></div>)}</Card>}

    {!data.length ? <EmptyState icon="alert" title={canManage ? "Start your risk register" : "No risks recorded yet"} body={canManage ? "Record a clear exposure, score it and assign the next decision. You can also import an existing spreadsheet." : "Risks recorded by a workspace operator will appear here."} primary={canManage ? { href:"/app/risks/new",label:"Add your first risk" } : undefined} secondary={canManage ? { href:"/app/risks/import",label:"Import spreadsheet" } : undefined} /> : <>
      <div className={styles.summaryGrid}>
        <Summary icon="activity" label={capped ? "Displayed exposure" : "Current exposure"} value={nonClosed.length} />
        <Summary icon="alert" label="Above appetite" value={config.appetite === null ? "Not set" : aboveAppetite} tone={config.appetite === null ? undefined : "risk"} />
        <Summary icon="bell" label="Reviews overdue" value={overdue} tone="attention" />
        <Summary icon="users" label="Unassigned" value={unassigned} />
      </div>

      <div className={styles.analysisGrid}>
        <Card className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Residual risk posture</h2><p>Remaining exposure for {nonClosed.length} {capped ? "displayed " : ""}current risk{nonClosed.length === 1 ? "" : "s"}, scored by likelihood × impact.</p></div></div>
          <div className={styles.heatmapWrap}>
            <div className={styles.heatmap}>
              <div className={`${styles.heatAxis} ${styles.heatAxisY}`}>Likelihood →</div>
              {[5,4,3,2,1].flatMap((likelihood) => [1,2,3,4,5].map((impact) => {
                const count = grid[likelihood][impact];
                return <span key={`${likelihood}-${impact}`} className={styles.heatCell} data-empty={!count} style={{ background:BAND_COLOR[riskBand(likelihood*impact,config)] }} title={`Likelihood ${likelihood} × Impact ${impact}${count ? ` — ${count} risk${count === 1 ? "" : "s"}` : ""}`}>{count || ""}</span>;
              }))}
              <div className={`${styles.heatAxis} ${styles.heatAxisX}`}>Impact →</div>
            </div>
            <div className={styles.legend}>{(["low","moderate","high","very_high"] as const).map((band) => <span key={band}><i style={{ background:BAND_COLOR[band] }} />{RISK_BAND_LABEL[band]}</span>)}</div>
          </div>
        </Card>

        <Card className={styles.panel}>
          <div className={styles.panelHeader}><div><h2>Risks needing attention</h2><p>{config.appetite === null ? "Highest residual exposures with an overdue review or missing owner. Set an appetite threshold to add above-appetite risks." : "Highest residual exposures with an overdue review, missing owner or score above appetite."}</p></div></div>
          {attention.length ? <ul className={styles.attentionList}>{attention.map(({ risk,score,reason }) => <li key={risk.id}><Link className={styles.attentionLink} href={`/app/risks/${risk.id}`}><span className={styles.attentionMain}><strong>{risk.title}</strong><small>{risk.reference} · {ownerName.get(risk.owner_id) ?? "Unassigned"}</small></span><span className={styles.attentionMeta}><Pill tone={reason === "Above appetite" ? "red" : "amber"}>{reason}</Pill><b>{score}</b><Icon name="arrow" /></span></Link></li>)}</ul> : <p className={styles.emptyLine}>No displayed risks currently match these attention rules.</p>}
        </Card>
      </div>

      <Card className={styles.registerCard}>
        <div className={styles.registerHeader}><div><h2>All risks</h2><p>Scores are recorded judgements; linked work and evidence remain separate records.</p></div><span className={styles.populationNote}>{capped ? `Showing ${data.length} most recently updated of ${displayedTotal} risks` : `${displayedTotal} risk${displayedTotal === 1 ? "" : "s"}`}</span></div>
        <div className={styles.desktopTable}><div className="data-table-wrap" role="region" aria-label="Risk register table" tabIndex={0}><table className={styles.table}><thead><tr><th>Reference</th><th>Risk</th><th>Owner</th><th>Inherent</th><th>Residual</th><th>Status</th><th>Next review</th><th></th></tr></thead><tbody>
          {data.map((risk) => <RiskRow key={risk.id} risk={risk} config={config} owner={ownerName.get(risk.owner_id)} tasks={tasksByRisk.get(risk.id) ?? []} evidence={evidenceByRisk.get(risk.id) ?? []} canManage={canManage} />)}
        </tbody></table></div></div>
        <ul className={styles.mobileList}>{data.map((risk) => <RiskCard key={risk.id} risk={risk} config={config} owner={ownerName.get(risk.owner_id)} canManage={canManage} />)}</ul>
      </Card>

      <details className={styles.config}>
        <summary>Risk bands and appetite</summary>
        <div className={styles.configBody}><p>Set the highest score for each band on the 1–25 scale. Scores above appetite are highlighted for attention.</p>
          {hasCapability(membership.role, "manage_risk_matrix") ? <form action={updateRiskMatrixConfigAction} className={styles.configForm}>
            <label>Low up to<input name="lowMax" type="number" min={1} max={23} defaultValue={config.lowMax} /></label>
            <label>Medium up to<input name="moderateMax" type="number" min={2} max={24} defaultValue={config.moderateMax} /></label>
            <label>High up to<input name="highMax" type="number" min={3} max={24} defaultValue={config.highMax} /></label>
            <label>Appetite above<input name="appetite" type="number" min={1} max={25} defaultValue={config.appetite ?? ""} /></label>
            <button className="button secondary">Save risk bands</button>
          </form> : <p>Only workspace operators can change these thresholds.</p>}
        </div>
      </details>
    </>}
  </>;
}

function Summary({ icon,label,value,tone }: { icon:string;label:string;value:number|string;tone?:string }) {
  return <Card className={styles.summaryCard}><span className={styles.summaryIcon} data-tone={tone}><Icon name={icon} /></span><span><small className={styles.summaryLabel}>{label}</small><strong className={styles.summaryValue}>{value}</strong></span></Card>;
}

type RegisterRisk = {
  id:string;reference:string;title:string;owner_id:string|null;likelihood:number;impact:number;residual_likelihood:number;residual_impact:number;status:string;review_date:string|null;risk_categories:{name:string}|{name:string}[]|null;
};
function scorePill(score:number,config:RiskMatrixConfig) {
  const band = riskBand(score,config);
  return <Pill tone={exceedsAppetite(score,config) ? "critical" : BAND_TONE[band] ?? "neutral"}>{score} · {RISK_BAND_LABEL[band]}</Pill>;
}
function RiskRow({ risk,config,owner,tasks,evidence,canManage }: { risk:RegisterRisk;config:RiskMatrixConfig;owner?:string;tasks:{id:string;title:string}[];evidence:{status:EvidenceStatus}[];canManage:boolean }) {
  const inherent = calculateRiskScore(risk.likelihood,risk.impact);
  const residual = calculateRiskScore(risk.residual_likelihood,risk.residual_impact);
  const freshness = summariseEvidenceFreshness(evidence);
  return <tr>
    <td>{risk.reference}</td>
    <td className={styles.riskCell}><strong><Link href={`/app/risks/${risk.id}`}>{risk.title}</Link></strong><small>{one(risk.risk_categories)?.name ?? "Uncategorised"}</small>{tasks.length > 0 && <small>Open work: {tasks.map((task,index) => <span key={task.id}>{index ? ", " : ""}<Link href={`/app/tasks/${task.id}`}>{task.title}</Link></span>)}</small>}{freshness.total > 0 && <small>Evidence: {freshness.total}{freshness.expiring ? ` · ${freshness.expiring} expiring` : ""}{freshness.expired ? ` · ${freshness.expired} expired` : ""}</small>}</td>
    <td className={styles.ownerCell}><span className={owner ? undefined : styles.missing}>{owner ?? "Unassigned"}</span></td>
    <td>{scorePill(inherent,config)}</td><td>{scorePill(residual,config)}</td>
    <td>{canManage ? <RiskStatusSelect id={risk.id} status={risk.status} title={risk.title} /> : <span className={styles.statusText}>{STATUS_LABEL[risk.status] ?? risk.status}</span>}</td>
    <td><span className={risk.review_date ? undefined : styles.missing}>{risk.review_date ?? "Not scheduled"}</span></td>
    <td>{canManage && <form action={deleteRiskAction}><input type="hidden" name="id" value={risk.id} /><button className={styles.deleteAction} aria-label={`Delete ${risk.title}`}>Delete</button></form>}</td>
  </tr>;
}
function RiskCard({ risk,config,owner,canManage }: { risk:RegisterRisk;config:RiskMatrixConfig;owner?:string;canManage:boolean }) {
  const inherent = calculateRiskScore(risk.likelihood,risk.impact);
  const residual = calculateRiskScore(risk.residual_likelihood,risk.residual_impact);
  return <li className={styles.mobileCard}><div className={styles.mobileTop}><span><small>{risk.reference}</small><strong><Link href={`/app/risks/${risk.id}`}>{risk.title}</Link></strong></span>{scorePill(residual,config)}</div><div className={styles.mobileScores}><span><small>Inherent</small>{scorePill(inherent,config)}</span><span><small>Residual</small>{scorePill(residual,config)}</span></div><dl className={styles.mobileMeta}><div><dt>Owner</dt><dd className={owner ? undefined : styles.missing}>{owner ?? "Unassigned"}</dd></div><div><dt>Next review</dt><dd className={risk.review_date ? undefined : styles.missing}>{risk.review_date ?? "Not scheduled"}</dd></div><div><dt>Status</dt><dd>{canManage ? <RiskStatusSelect id={risk.id} status={risk.status} title={risk.title} /> : STATUS_LABEL[risk.status] ?? risk.status}</dd></div><div><dt>Category</dt><dd>{one(risk.risk_categories)?.name ?? "Uncategorised"}</dd></div></dl></li>;
}
