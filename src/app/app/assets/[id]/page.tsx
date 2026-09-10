import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { Card,PageIntro,Pill } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { collectIdPages,collectStringCursorPages } from "@/lib/supabase/paginate";
import { ASSET_CLASSIFICATION_LABEL,ASSET_VALUE_LABEL,CLASSIFICATION_TONE,VALUE_TONE,type AssetClassification,type AssetValue } from "@/features/assets/domain/assets";
import { calculateRiskScore,RISK_STATUS_LABEL,type RiskStatus } from "@/features/risks/domain/risks";
import { linkAssetRiskAction,unlinkAssetRiskAction,deleteAssetAction } from "../actions";
import styles from "../asset-workspace.module.css";

const CLASSIFICATION_HELP:Record<AssetClassification,string>={highly_confidential:"Restrict to named individuals; encrypt at rest and in transit; log every access.",confidential:"Limit to the teams that need it; share only over approved, access-controlled channels.",internal_use_only:"Suitable for staff use; keep it off public sites and external inboxes.",public:"Cleared for release; keep the published copy accurate."};
const VALUE_HELP:Record<AssetValue,string>={high:"Loss or extended unavailability could seriously disrupt the business.",medium:"The business can continue for a limited period while this asset is restored.",low:"Loss or unavailability has limited business impact."};
type Risk={id:string;reference:string;title:string;status:string;residual_likelihood:number;residual_impact:number};
type LinkRow={risk_id:string;risks:Risk|Risk[]|null};

export default async function AssetDetailPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const {supabase,organisation,membership}=await requireAppContext(); const canManage=membership.role!=="member";
  const {data:asset,error:assetError}=await supabase.from("assets").select("id,reference,description,owner_location,owner_id,classification,value_criticality,security_controls,lifespan,last_updated,remarks,created_at,updated_at,asset_categories(name)").eq("id",id).eq("organisation_id", organisation.id).maybeSingle();
  if(assetError) throw new Error("Could not load the asset"); if(!asset) notFound();
  let linked:LinkRow[]=[]; let linkedError=false;
  try { linked=await collectStringCursorPages(async(after,limit)=>{let query=supabase.from("asset_risks").select("risk_id,risks(id,reference,title,status,residual_likelihood,residual_impact)").eq("asset_id",id).eq("organisation_id", organisation.id).order("risk_id").limit(limit);if(after)query=query.gt("risk_id",after);const result=await query;if(result.error)throw new Error("linked risks unavailable");return (result.data ?? []) as unknown as LinkRow[];},(row)=>row.risk_id); } catch { linkedError=true; }
  let allRisks:Risk[]=[]; let choicesError=false;
  if(canManage) { try { allRisks=await collectIdPages(async(after,limit)=>{let query=supabase.from("risks").select("id,reference,title,status,residual_likelihood,residual_impact").eq("organisation_id", organisation.id).order("id").limit(limit);if(after)query=query.gt("id",after);const result=await query;if(result.error)throw new Error("risk choices unavailable");return (result.data ?? []) as unknown as Risk[];}); } catch { choicesError=true; } }
  const ownerResult=asset.owner_id ? await supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id).eq("user_id",asset.owner_id).maybeSingle() : {data:null,error:null};
  const ownerUnavailable=Boolean(ownerResult.error || (asset.owner_id && !ownerResult.data));
  const displayName=one(ownerResult.data?.profiles)?.display_name?.trim();
  const owner=ownerUnavailable ? null : asset.owner_id ? displayName || asset.owner_id : null;
  const linkedIds=new Set(linked.map((item)=>item.risk_id)); const availableRisks=allRisks.filter((risk)=>!linkedIds.has(risk.id));
  const cls=asset.classification as AssetClassification; const val=asset.value_criticality as AssetValue; const category=one(asset.asset_categories);
  return <>
    <Link href="/app/assets" className={styles.pageBack}><span aria-hidden="true">←</span> Back to asset inventory</Link>
    <PageIntro eyebrow={`ASSET ${asset.reference}`} title={asset.description} body="Recorded asset context, accountability and connected exposure." action={canManage && <Link className="button secondary" href={`/app/assets/${id}/edit`}>Edit asset</Link>} />
    <div className={styles.detailHero}>
      <Card className={styles.card}><h2>Handling profile</h2><p className={styles.cardLead}>Classification and criticality are separate recorded judgements.</p><div className={styles.handlingGrid}><section className={styles.handlingBox}><small>Classification</small><strong><Pill tone={CLASSIFICATION_TONE[cls]}>{ASSET_CLASSIFICATION_LABEL[cls]}</Pill></strong><p>{CLASSIFICATION_HELP[cls]}</p></section><section className={styles.handlingBox}><small>Business criticality</small><strong><Pill tone={VALUE_TONE[val]}>{ASSET_VALUE_LABEL[val]}</Pill></strong><p>{VALUE_HELP[val]}</p></section></div><p className={styles.supportNote}>This information guides handling and priorities. It does not prove that safeguards were checked.</p></Card>
      <Card className={styles.card}><h2>Accountability and record</h2><p className={styles.cardLead}>Assignment remains distinct from descriptive location text.</p><dl className={styles.facts}><div><dt>In-app owner</dt><dd className={owner ? undefined : styles.missing}>{ownerUnavailable ? "Owner unavailable" : owner ?? "Unassigned"}</dd></div><div><dt>Owner & location</dt><dd>{asset.owner_location || "Not recorded"}</dd></div><div><dt>Category</dt><dd>{category?.name ?? "Uncategorised"}</dd></div><div><dt>Expected lifespan</dt><dd>{asset.lifespan || "Not recorded"}</dd></div><div><dt>Recorded information date</dt><dd>{asset.last_updated ?? "Not recorded"}</dd></div><div><dt>System record updated</dt><dd>{new Date(asset.updated_at).toLocaleDateString("en-GB")}</dd></div></dl>{ownerUnavailable && <p className={styles.availability} role="alert">The accountable owner could not be loaded. Reload before making a decision from this record.</p>}</Card>
    </div>
    <div className={styles.detailGrid}>
      <Card className={styles.card}><h2>Safeguards and notes</h2><section className={styles.copySection}><h3>Recorded security controls</h3><p>{asset.security_controls || "No security controls recorded."}</p><p className={styles.supportNote}>Recorded controls are descriptive. Managed evidence and human review establish separate assurance.</p></section><section className={styles.copySection}><h3>Remarks</h3><p>{asset.remarks || "No additional remarks."}</p></section></Card>
      <Card className={styles.card}><h2>Linked risks</h2><p className={styles.cardLead}>Trace the exposures connected to this asset without treating a link as evidence or completed work.</p>
        {linkedError ? <p className={styles.availability} role="alert">Linked risks could not be loaded. Reload this page to try again.</p> : <ul className={styles.linkedList}>{linked.map((item)=>{const risk=one(item.risks);return risk ? <li key={item.risk_id} className={styles.linkedItem}><div><Link href={`/app/risks/${risk.id}`}>{risk.reference}: {risk.title}</Link><span className={styles.riskMeta}><Pill tone="neutral">{RISK_STATUS_LABEL[risk.status as RiskStatus] ?? risk.status}</Pill><span>Residual exposure {calculateRiskScore(risk.residual_likelihood,risk.residual_impact)}</span></span></div>{canManage && <form action={unlinkAssetRiskAction}><input type="hidden" name="assetId" value={id}/><input type="hidden" name="riskId" value={item.risk_id}/><button className={styles.deleteAction} aria-label={`Unlink ${risk.reference}`}>Unlink</button></form>}</li> : <li key={item.risk_id} className={styles.linkedItem}>Linked risk unavailable.</li>;})}{!linked.length && <li className={styles.emptyLine}>No risks linked yet.</li>}</ul>}
        {canManage && !linkedError && (choicesError ? <p className={styles.availability} role="alert">Risk choices could not be loaded. Reload before linking another risk.</p> : availableRisks.length ? <form action={linkAssetRiskAction} className={styles.linkForm}><input type="hidden" name="assetId" value={id}/><label>Risk to link<select name="riskId" required defaultValue=""><option value="" disabled>Select a risk…</option>{availableRisks.map((risk)=><option key={risk.id} value={risk.id}>{risk.reference}: {risk.title}</option>)}</select></label><button className="button secondary">Link risk</button></form> : <p className={styles.emptyLine}>All current workspace risks are already linked.</p>)}
      </Card>
    </div>
    {canManage && <form action={deleteAssetAction} className={styles.danger}><input type="hidden" name="id" value={id}/><button>Delete asset</button></form>}
  </>;
}
