import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { AssetForm, type AssetFormValues } from "../asset-form";
import styles from "../../risks/risk-form.module.css";

export default async function NewAssetPage() {
  const { supabase,organisation,membership } = await requireAppContext();
  if (membership.role === "member") redirect("/app/assets");
  const [categoriesResult,membersResult] = await Promise.all([supabase.from("asset_categories").select("id,name").eq("organisation_id",organisation.id).order("position"),supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id",organisation.id)]);
  if (categoriesResult.error || membersResult.error) throw new Error("Could not load asset choices. Reload and try again.");
  const values:AssetFormValues = {reference:"",description:"",ownerLocation:"",ownerId:"",categoryId:"",classification:"internal_use_only",valueCriticality:"medium",securityControls:"",lifespan:"",lastUpdated:"",remarks:""};
  return <><Link href="/app/assets" className={styles.pageBack}><span aria-hidden="true">←</span> Back to asset inventory</Link><div className={styles.introGrid}><PageIntro eyebrow="ASSETS" title="Add asset" body="Record something the company depends on, who is accountable, and how it should be handled." /><Card className={styles.guidance}><h2>A useful asset record is clear</h2><ul><li>Name a recognisable asset</li><li>Assign accountability explicitly</li><li>Keep sensitivity and criticality separate</li></ul></Card></div><AssetForm mode="create" values={values} options={{categories:(categoriesResult.data ?? []).map((item)=>({id:item.id,label:item.name})),owners:(membersResult.data ?? []).map((item)=>({id:item.user_id,label:one(item.profiles)?.display_name ?? item.user_id}))}} cancelHref="/app/assets" /></>;
}
