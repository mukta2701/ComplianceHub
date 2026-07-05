import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, CLASSIFICATION_TONE, VALUE_TONE, type AssetClassification, type AssetValue } from "@/features/assets/domain/assets";
import { Card, PageIntro, Pill } from "@/components/ui";
import { linkAssetRiskAction, unlinkAssetRiskAction, deleteAssetAction } from "../actions";

// Original en-GB handling guidance (reworded, NOT copied from the toolkit).
const CLASSIFICATION_HELP: Record<AssetClassification, string> = {
  highly_confidential: "Restrict to named individuals; encrypt at rest and in transit; log every access.",
  confidential: "Limit to the teams that need it; share only over approved, access-controlled channels.",
  internal_use_only: "Fine for staff generally, but keep it off public sites and external inboxes.",
  public: "Cleared for release; no handling restrictions beyond keeping the published copy accurate.",
};
const VALUE_HELP: Record<AssetValue, string> = {
  high: "Losing it would seriously disrupt the business — prioritise resilience and recovery.",
  medium: "Useful and worth protecting, but the business can keep running without it for a while.",
  low: "Minor impact if lost or unavailable; standard safeguards are enough.",
};

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAppContext();
  const { data: asset } = await supabase.from("assets").select("id,reference,description,owner_location,owner_id,classification,value_criticality,security_controls,lifespan,last_updated,remarks,asset_categories(name)").eq("id", id).maybeSingle();
  if (!asset) notFound();
  const [{ data: linked }, { data: allRisks }, { data: owner }] = await Promise.all([
    supabase.from("asset_risks").select("risk_id,risks(id,reference,title)").eq("asset_id", id),
    supabase.from("risks").select("id,reference,title").order("reference"),
    asset.owner_id ? supabase.from("profiles").select("display_name").eq("id", asset.owner_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const cls = asset.classification as AssetClassification;
  const val = asset.value_criticality as AssetValue;
  const cat = Array.isArray(asset.asset_categories) ? asset.asset_categories[0] : asset.asset_categories;
  const linkedRiskIds = new Set((linked ?? []).map((l) => l.risk_id));
  return <>
    <Link href="/app/assets" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to assets</Link>
    <PageIntro eyebrow={`ASSET ${asset.reference}`} title={asset.description} body={asset.owner_location || "Information asset"} action={<Link className="button secondary" href={`/app/assets/${id}/edit`}>Edit</Link>} />
    <Card style={{ padding: "22px" }}><dl className="fact-grid">
      <div><dt>Category</dt><dd>{cat?.name ?? "—"}</dd></div>
      <div><dt>In-app owner</dt><dd>{owner?.display_name ?? "Unassigned"}</dd></div>
      <div><dt>Classification</dt><dd><Pill tone={CLASSIFICATION_TONE[cls]}>{ASSET_CLASSIFICATION_LABEL[cls]}</Pill><small style={{ display: "block", marginTop: "6px", color: "#596273" }}>{CLASSIFICATION_HELP[cls]}</small></dd></div>
      <div><dt>Value</dt><dd><Pill tone={VALUE_TONE[val]}>{ASSET_VALUE_LABEL[val]}</Pill><small style={{ display: "block", marginTop: "6px", color: "#596273" }}>{VALUE_HELP[val]}</small></dd></div>
      <div><dt>Lifespan</dt><dd>{asset.lifespan || "—"}</dd></div>
      <div><dt>Last updated</dt><dd>{asset.last_updated ?? "—"}</dd></div>
    </dl>{asset.security_controls && <p style={{ marginTop: "14px", fontSize: "13px" }}><b>Security controls:</b> {asset.security_controls}</p>}{asset.remarks && <p style={{ marginTop: "8px", fontSize: "13px", color: "#596273" }}>{asset.remarks}</p>}</Card>
    <Card style={{ padding: "22px", marginTop: "16px" }}>
      <h2 style={{ fontSize: "15px", margin: "0 0 10px" }}>Linked risks</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
        {(linked ?? []).map((l) => { const r = Array.isArray(l.risks) ? l.risks[0] : l.risks; return <li key={l.risk_id} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}><Link href={`/app/risks/${r?.id}`}>{r?.reference}: {r?.title}</Link><form action={unlinkAssetRiskAction}><input type="hidden" name="assetId" value={id} /><input type="hidden" name="riskId" value={l.risk_id} /><button style={{ color: "var(--red)", border: 0, background: "none" }} aria-label={`Unlink ${r?.reference}`}>Unlink</button></form></li>; })}
        {!linked?.length && <li style={{ color: "#596273", fontSize: "13px" }}>No risks linked yet.</li>}
      </ul>
      <form action={linkAssetRiskAction} style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center" }}><input type="hidden" name="assetId" value={id} /><select name="riskId" required defaultValue="" aria-label={`Link a risk to ${asset.description}`}><option value="" disabled>Select a risk…</option>{(allRisks ?? []).filter((r) => !linkedRiskIds.has(r.id)).map((r) => <option key={r.id} value={r.id}>{r.reference}: {r.title}</option>)}</select><button className="button secondary">Link risk</button></form>
    </Card>
    <form action={deleteAssetAction} style={{ marginTop: "16px" }}><input type="hidden" name="id" value={id} /><button style={{ color: "var(--red)", border: 0, background: "none", fontWeight: 700 }}>Delete asset</button></form>
  </>;
}
