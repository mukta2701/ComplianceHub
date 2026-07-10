import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, type AssetClassification, type AssetValue } from "@/features/assets/domain/assets";
import { one } from "@/lib/supabase/one";
import { updateAssetAction } from "../../actions";

export default async function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAppContext();
  const [{ data: asset }, { data: categories }, { data: members }] = await Promise.all([
    supabase.from("assets").select("id,reference,description,owner_location,owner_id,classification,value_criticality,category_id,security_controls,lifespan,last_updated,remarks").eq("id", id).maybeSingle(),
    supabase.from("asset_categories").select("id,name").order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
  ]);
  if (!asset) notFound();
  const classifications = Object.keys(ASSET_CLASSIFICATION_LABEL) as AssetClassification[];
  const values = Object.keys(ASSET_VALUE_LABEL) as AssetValue[];
  return <>
    <PageIntro eyebrow={`ASSET ${asset.reference}`} title="Edit asset" body="Classification and value are independent — set them from what the asset holds and how critical it is." />
    <form action={updateAssetAction} className="card app-form">
      <input type="hidden" name="id" value={id} />
      <div className="form-grid">
        <label>Reference<input name="reference" required maxLength={40} defaultValue={asset.reference} placeholder="AST-001" /></label>
        <label>Description<input name="description" required maxLength={200} defaultValue={asset.description} /></label>
        <label>Owner &amp; location<input name="ownerLocation" maxLength={200} defaultValue={asset.owner_location ?? ""} /></label>
        <label>In-app owner<select name="ownerId" defaultValue={asset.owner_id ?? ""}><option value="">Unassigned</option>{members?.map((m) => { const p = one(m.profiles); return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Category<select name="categoryId" defaultValue={asset.category_id ?? ""}><option value="">Uncategorised</option>{categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Classification<select name="classification" defaultValue={asset.classification}>{classifications.map((c) => <option key={c} value={c}>{ASSET_CLASSIFICATION_LABEL[c]}</option>)}</select></label>
        <label>Value (criticality)<select name="valueCriticality" defaultValue={asset.value_criticality}>{values.map((v) => <option key={v} value={v}>{ASSET_VALUE_LABEL[v]}</option>)}</select></label>
        <label>Lifespan<input name="lifespan" maxLength={120} defaultValue={asset.lifespan ?? ""} placeholder="e.g. 3 years" /></label>
        <label>Last updated<input name="lastUpdated" type="date" defaultValue={asset.last_updated ?? ""} /></label>
      </div>
      <label>Security controls<textarea name="securityControls" maxLength={10000} defaultValue={asset.security_controls ?? ""} /></label>
      <label>Remarks<textarea name="remarks" maxLength={10000} defaultValue={asset.remarks ?? ""} /></label>
      <button className="button primary">Save changes</button>
    </form>
  </>;
}
