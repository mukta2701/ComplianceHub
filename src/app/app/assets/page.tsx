import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { summariseAssets, ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, CLASSIFICATION_TONE, VALUE_TONE, type AssetClassification, type AssetValue } from "@/features/assets/domain/assets";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";

export default async function AssetsPage() {
  const { supabase } = await requireAppContext();
  const { data: assets } = await supabase.from("assets").select("id,reference,description,classification,value_criticality,owner_location,asset_categories(name)").order("reference");
  const rows = assets ?? [];
  const summary = summariseAssets(rows.map((a) => ({ classification: a.classification as AssetClassification, value_criticality: a.value_criticality as AssetValue })));
  return <>
    <PageIntro eyebrow="ASSETS" title="Asset inventory" body="Track information assets, their classification, and their criticality — and link them to the risks that threaten them." action={<Link className="button primary" href="/app/assets/new"><Icon name="plus" />Add asset</Link>} />
    <div className="stats-grid"><Stat label="ASSETS" value={summary.total} detail="in the inventory" /><Stat label="HIGH VALUE" value={summary.highValue} detail="business-critical" tone="red" /><Stat label="HIGHLY CONFIDENTIAL" value={summary.sensitive} detail="strictest handling" tone="amber" /></div>
    <Card><div className="data-table-wrap" role="region" aria-label="Asset inventory table" tabIndex={0}><table><thead><tr><th>Ref</th><th>Asset</th><th>Category</th><th>Classification</th><th>Value</th></tr></thead><tbody>
      {rows.map((a) => { const cat = Array.isArray(a.asset_categories) ? a.asset_categories[0] : a.asset_categories; const cls = a.classification as AssetClassification; const val = a.value_criticality as AssetValue; return <tr key={a.id}>
        <td>{a.reference}</td>
        <td><Link href={`/app/assets/${a.id}`}><b>{a.description}</b></Link>{a.owner_location && <small>{a.owner_location}</small>}</td>
        <td>{cat?.name ?? "—"}</td>
        <td><Pill tone={CLASSIFICATION_TONE[cls]}>{ASSET_CLASSIFICATION_LABEL[cls]}</Pill></td>
        <td><Pill tone={VALUE_TONE[val]}>{ASSET_VALUE_LABEL[val]}</Pill></td>
      </tr>; })}
      {!rows.length && <tr><td colSpan={5} style={{ color: "#596273" }}>No assets yet. Add your first information asset to start the inventory.</td></tr>}
    </tbody></table></div></Card>
  </>;
}
