import { notFound,redirect } from "next/navigation";
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card,PageIntro } from "@/components/ui";
import { one } from "@/lib/supabase/one";
import { AssetForm } from "../../asset-form";
import styles from "../../../risks/risk-form.module.css";

export default async function EditAssetPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const {supabase,organisation,membership}=await requireAppContext();
  if (membership.role === "member") redirect(`/app/assets/${id}`);
  const {data:asset,error}=await supabase.from("assets").select("id,reference,description,owner_location,owner_id,classification,value_criticality,category_id,security_controls,lifespan,last_updated,remarks,updated_at").eq("id",id).eq("organisation_id", organisation.id).maybeSingle();
  if (error) throw new Error("Could not load the asset"); if (!asset) notFound();
  const [categoriesResult,membersResult,selectedCategoryResult,selectedOwnerResult]=await Promise.all([
    supabase.from("asset_categories").select("id,name").eq("organisation_id", organisation.id).order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
    asset.category_id ? supabase.from("asset_categories").select("id,name").eq("id",asset.category_id).eq("organisation_id", organisation.id).maybeSingle() : Promise.resolve({data:null,error:null}),
    asset.owner_id ? supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id).eq("user_id",asset.owner_id).maybeSingle() : Promise.resolve({data:null,error:null}),
  ]);
  if (categoriesResult.error || membersResult.error || selectedCategoryResult.error || selectedOwnerResult.error) throw new Error("Could not load asset choices. Reload and try again.");
  if (asset.category_id && !selectedCategoryResult.data) throw new Error("The saved asset category is no longer available. Reload and review the record before saving.");
  if (asset.owner_id && !selectedOwnerResult.data) throw new Error("The saved asset owner is no longer available. Reload and review the record before saving.");
  const categories=[...(categoriesResult.data ?? [])]; if(selectedCategoryResult.data && !categories.some((item)=>item.id===selectedCategoryResult.data!.id)) categories.push(selectedCategoryResult.data);
  const members=[...(membersResult.data ?? [])]; if(selectedOwnerResult.data && !members.some((item)=>item.user_id===selectedOwnerResult.data!.user_id)) members.push(selectedOwnerResult.data);
  return <><Link href={`/app/assets/${asset.id}`} className={styles.pageBack}><span aria-hidden="true">←</span> Back to asset</Link><div className={styles.introGrid}><PageIntro eyebrow={`ASSET ${asset.reference}`} title="Edit asset" body={`Update ${asset.description} without treating recorded safeguards as reviewed evidence.`} /><Card className={styles.guidance}><h2>Keep the record reviewable</h2><ul><li>Keep accountability current</li><li>Explain handling expectations</li><li>Use the recorded date deliberately</li></ul></Card></div><AssetForm mode="edit" assetId={asset.id} expectedUpdatedAt={asset.updated_at} cancelHref={`/app/assets/${asset.id}`} values={{reference:asset.reference,description:asset.description,ownerLocation:asset.owner_location ?? "",ownerId:asset.owner_id ?? "",categoryId:asset.category_id ?? "",classification:asset.classification,valueCriticality:asset.value_criticality,securityControls:asset.security_controls ?? "",lifespan:asset.lifespan ?? "",lastUpdated:asset.last_updated ?? "",remarks:asset.remarks ?? ""}} options={{categories:categories.map((item)=>({id:item.id,label:item.name})),owners:members.map((item)=>({id:item.user_id,label:one(item.profiles)?.display_name ?? item.user_id}))}} /></>;
}
