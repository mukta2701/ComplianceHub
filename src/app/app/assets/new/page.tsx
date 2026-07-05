import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL, type AssetClassification, type AssetValue } from "@/features/assets/domain/assets";
import { createAssetAction } from "../actions";

export default async function NewAssetPage() {
  const { supabase } = await requireAppContext();
  const [{ data: categories }, { data: members }] = await Promise.all([
    supabase.from("asset_categories").select("id,name").order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)"),
  ]);
  const classifications = Object.keys(ASSET_CLASSIFICATION_LABEL) as AssetClassification[];
  const values = Object.keys(ASSET_VALUE_LABEL) as AssetValue[];
  return <>
    <PageIntro eyebrow="ASSETS" title="Add asset" body="Classification and value are independent — set them from what the asset holds and how critical it is." />
    <form action={createAssetAction} className="card app-form">
      <div className="form-grid">
        <label>Reference<input name="reference" required maxLength={40} placeholder="AST-001" /></label>
        <label>Description<input name="description" required maxLength={200} /></label>
        <label>Owner &amp; location<input name="ownerLocation" maxLength={200} /></label>
        <label>In-app owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Category<select name="categoryId" defaultValue=""><option value="">Uncategorised</option>{categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Classification<select name="classification" defaultValue="internal_use_only">{classifications.map((c) => <option key={c} value={c}>{ASSET_CLASSIFICATION_LABEL[c]}</option>)}</select></label>
        <label>Value (criticality)<select name="valueCriticality" defaultValue="medium">{values.map((v) => <option key={v} value={v}>{ASSET_VALUE_LABEL[v]}</option>)}</select></label>
        <label>Lifespan<input name="lifespan" maxLength={120} placeholder="e.g. 3 years" /></label>
        <label>Last updated<input name="lastUpdated" type="date" /></label>
      </div>
      <label>Security controls<textarea name="securityControls" maxLength={10000} /></label>
      <label>Remarks<textarea name="remarks" maxLength={10000} /></label>
      <button className="button primary">Save asset</button>
    </form>
  </>;
}
