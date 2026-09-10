import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SubTabs } from "@/components/sub-tabs";
import { one } from "@/lib/supabase/one";
import { deleteAssetAction } from "./actions";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, CLASSIFICATION_TONE, VALUE_TONE, type AssetClassification, type AssetValue } from "@/features/assets/domain/assets";
import styles from "./asset-workspace.module.css";

type AssetRow = { id:string;reference:string;description:string;owner_location:string;owner_id:string|null;classification:AssetClassification;value_criticality:AssetValue;asset_categories:{name:string}|{name:string}[]|null };

export default async function AssetsPage() {
  const { supabase, organisation, membership } = await requireAppContext();
  const canManage = membership.role !== "member";
  const [assetsResult, highResult, sensitiveResult, unassignedResult, linksResult, membersResult] = await Promise.all([
    supabase.from("assets").select("id,reference,description,owner_location,owner_id,classification,value_criticality,asset_categories(name)", { count:"exact" }).eq("organisation_id", organisation.id).order("updated_at", { ascending:false }).limit(500),
    supabase.from("assets").select("id", { count:"exact",head:true }).eq("organisation_id", organisation.id).eq("value_criticality", "high"),
    supabase.from("assets").select("id", { count:"exact",head:true }).eq("organisation_id", organisation.id).eq("classification", "highly_confidential"),
    supabase.from("assets").select("id", { count:"exact",head:true }).eq("organisation_id", organisation.id).is("owner_id", null),
    supabase.from("asset_risks").select("asset_id,risk_id", { count:"exact" }).eq("organisation_id", organisation.id).order("asset_id").limit(1000),
    supabase.from("memberships").select("user_id,profiles(display_name)", { count:"exact" }).eq("organisation_id", organisation.id),
  ]);
  const results = [assetsResult,highResult,sensitiveResult,unassignedResult,linksResult,membersResult];
  if (results.some((result) => result.error) || [assetsResult.count,highResult.count,sensitiveResult.count,unassignedResult.count,linksResult.count,membersResult.count].some((count) => count === null)) throw new Error("Could not load the asset inventory");
  if ((membersResult.count ?? 0) > (membersResult.data?.length ?? 0)) throw new Error("Could not load the complete asset owner list");
  const assets = (assetsResult.data ?? []) as unknown as AssetRow[];
  const displayedTotal = assetsResult.count ?? assets.length;
  const capped = displayedTotal > assets.length || assets.length === 500;
  const linksCapped = (linksResult.count ?? 0) > (linksResult.data?.length ?? 0);
  const linksByAsset = new Map<string,number>();
  for (const link of linksResult.data ?? []) linksByAsset.set(link.asset_id,(linksByAsset.get(link.asset_id) ?? 0)+1);
  const ownerNames = new Map((membersResult.data ?? []).map((member) => [member.user_id,one(member.profiles)?.display_name ?? member.user_id] as const));
  return <>
    <PageIntro eyebrow="ASSETS" title="Asset inventory" body="Know what the company depends on, who is accountable, and which risks need attention." action={<span className={styles.headerActions}><a className="button secondary" href="/api/app/assets/export?format=xlsx"><Icon name="download" />Export XLSX</a><a className="button secondary" href="/api/app/assets/export?format=csv">Export CSV</a>{canManage && <Link className="button secondary" href="/app/assets/import">Import</Link>}{canManage && <Link className="button primary" href="/app/assets/new"><Icon name="plus" />Add asset</Link>}</span>} />
    <SubTabs tabs={[{href:"/app/risks",label:"Risks"},{href:"/app/assets",label:"Assets"}]} />
    {!assets.length ? <EmptyState icon="shield" title={canManage ? "Build your asset inventory" : "No assets recorded yet"} body={canManage ? "Record the systems, information and services the company relies on, then connect them to accountable owners and risks." : "Assets recorded by a workspace operator will appear here."} primary={canManage ? {href:"/app/assets/new",label:"Add your first asset"} : undefined} secondary={canManage ? {href:"/app/assets/import",label:"Import spreadsheet"} : undefined} /> : <>
      <div className={styles.summaryGrid}><Summary icon="shield" label="Total assets" value={displayedTotal} /><Summary icon="activity" label="High criticality" value={highResult.count ?? 0} tone="risk" /><Summary icon="lock" label="Highly confidential" value={sensitiveResult.count ?? 0} tone="attention" /><Summary icon="users" label="Unassigned" value={unassignedResult.count ?? 0} /></div>
      <Card className={styles.registerCard}><div className={styles.registerHeader}><div><h2>All assets</h2><p>Classification, business criticality and linked risk remain separate records.</p></div><span className={styles.populationNote}>{capped ? `Showing ${assets.length} most recently updated of ${displayedTotal} assets` : `${displayedTotal} asset${displayedTotal === 1 ? "" : "s"}`}</span></div>{linksCapped && <p className={styles.availability} role="alert">Linked-risk counts are unavailable because the full relationship list could not be loaded.</p>}
        <div className={styles.desktopTable}><div className="data-table-wrap" role="region" aria-label="Asset inventory table" tabIndex={0}><table className={styles.table}><thead><tr><th>Reference</th><th>Asset</th><th>In-app owner</th><th>Classification</th><th>Criticality</th><th>Linked risks</th><th>Actions</th></tr></thead><tbody>{assets.map((asset) => <AssetRowView key={asset.id} asset={asset} owner={ownerNames.get(asset.owner_id ?? "")} linkedCount={linksCapped ? null : linksByAsset.get(asset.id) ?? 0} canManage={canManage} />)}</tbody></table></div></div>
        <ul className={styles.mobileList} aria-label="Asset inventory cards">{assets.map((asset) => <AssetCard key={asset.id} asset={asset} owner={ownerNames.get(asset.owner_id ?? "")} linkedCount={linksCapped ? null : linksByAsset.get(asset.id) ?? 0} canManage={canManage} />)}</ul>
      </Card>
    </>}
  </>;
}

function Summary({icon,label,value,tone}:{icon:string;label:string;value:number;tone?:string}) { return <Card className={styles.summaryCard}><span className={styles.summaryIcon} data-tone={tone}><Icon name={icon} /></span><span><small>{label}</small><strong>{value}</strong></span></Card>; }
function linkLabel(count:number|null) { return count === null ? "Unavailable" : `${count} linked risk${count === 1 ? "" : "s"}`; }
function AssetRowView({asset,owner,linkedCount,canManage}:{asset:AssetRow;owner?:string;linkedCount:number|null;canManage:boolean}) { return <tr><td>{asset.reference}</td><td className={styles.assetCell}><strong><Link href={`/app/assets/${asset.id}`}>{asset.description}</Link></strong><small>{one(asset.asset_categories)?.name ?? "Uncategorised"}</small>{asset.owner_location && <small>Location: {asset.owner_location}</small>}</td><td><span className={owner ? undefined : styles.missing}>{owner ?? "Unassigned"}</span></td><td><Pill tone={CLASSIFICATION_TONE[asset.classification]}>{ASSET_CLASSIFICATION_LABEL[asset.classification]}</Pill></td><td><Pill tone={VALUE_TONE[asset.value_criticality]}>{ASSET_VALUE_LABEL[asset.value_criticality]}</Pill></td><td>{linkLabel(linkedCount)}</td><td>{canManage && <form action={deleteAssetAction}><input type="hidden" name="id" value={asset.id} /><button className={styles.deleteAction} aria-label={`Delete ${asset.description}`}>Delete</button></form>}</td></tr>; }
function AssetCard({asset,owner,linkedCount,canManage}:{asset:AssetRow;owner?:string;linkedCount:number|null;canManage:boolean}) { return <li className={styles.mobileCard}><div className={styles.mobileTop}><span><small>{asset.reference}</small><strong><Link href={`/app/assets/${asset.id}`}>{asset.description}</Link></strong></span><Pill tone={VALUE_TONE[asset.value_criticality]}>{ASSET_VALUE_LABEL[asset.value_criticality]} criticality</Pill></div><dl className={styles.mobileMeta}><div><dt>In-app owner</dt><dd className={owner ? undefined : styles.missing}>{owner ?? "Unassigned"}</dd></div><div><dt>Category</dt><dd>{one(asset.asset_categories)?.name ?? "Uncategorised"}</dd></div><div><dt>Classification</dt><dd><Pill tone={CLASSIFICATION_TONE[asset.classification]}>{ASSET_CLASSIFICATION_LABEL[asset.classification]}</Pill></dd></div><div><dt>Linked risks</dt><dd>{linkLabel(linkedCount)}</dd></div></dl>{asset.owner_location && <p className={styles.location}><strong>Owner & location</strong>{asset.owner_location}</p>}{canManage && <form action={deleteAssetAction}><input type="hidden" name="id" value={asset.id} /><button className={styles.deleteAction} aria-label={`Delete ${asset.description}`}>Delete asset</button></form>}</li>; }
