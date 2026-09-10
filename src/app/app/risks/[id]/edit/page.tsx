import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { one } from "@/lib/supabase/one";
import { Card, PageIntro } from "@/components/ui";
import { RiskForm } from "../../risk-form";
import styles from "../../risk-form.module.css";

export default async function EditRiskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") redirect(`/app/risks/${id}`);
  const { data: risk, error } = await supabase.from("risks")
    .select("id,reference,title,description,category_id,owner_id,likelihood,impact,residual_likelihood,residual_impact,treatment,treatment_plan,review_date,status,evidence,updated_at")
    .eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (error) throw new Error("Could not load the risk");
  if (!risk) notFound();
  const [categoriesResult, membersResult, selectedCategoryResult, selectedOwnerResult] = await Promise.all([
    supabase.from("risk_categories").select("id,name").eq("organisation_id", organisation.id).order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
    supabase.from("risk_categories").select("id,name").eq("id", risk.category_id).eq("organisation_id", organisation.id).maybeSingle(),
    risk.owner_id ? supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id).eq("user_id", risk.owner_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (categoriesResult.error || membersResult.error || selectedCategoryResult.error || selectedOwnerResult.error) throw new Error("Could not load risk choices. Reload and try again.");
  const categories = [...(categoriesResult.data ?? [])];
  if (selectedCategoryResult.data && !categories.some((item) => item.id === selectedCategoryResult.data!.id)) categories.push(selectedCategoryResult.data);
  const members = [...(membersResult.data ?? [])];
  if (selectedOwnerResult.data && !members.some((item) => item.user_id === selectedOwnerResult.data!.user_id)) members.push(selectedOwnerResult.data);
  return <>
    <Link href={`/app/risks/${risk.id}`} className={styles.pageBack}><span aria-hidden="true">←</span> Back to risk</Link>
    <div className={styles.introGrid}>
      <PageIntro eyebrow={`RISK ${risk.reference}`} title="Edit risk" body={`Update ${risk.title} without implying that treatment or evidence has been independently verified.`} />
      <Card className={styles.guidance}><h2>Keep the decision reviewable</h2><ul><li>Keep ownership current</li><li>Explain changed exposure</li><li>Set the next review date</li></ul></Card>
    </div>
    <RiskForm mode="edit" riskId={risk.id} expectedUpdatedAt={risk.updated_at} cancelHref={`/app/risks/${risk.id}`}
      values={{ reference:risk.reference,title:risk.title,description:risk.description,categoryId:risk.category_id,ownerId:risk.owner_id ?? "",reviewDate:risk.review_date ?? "",likelihood:String(risk.likelihood),impact:String(risk.impact),residualLikelihood:String(risk.residual_likelihood),residualImpact:String(risk.residual_impact),treatment:risk.treatment,status:risk.status,treatmentPlan:risk.treatment_plan,evidence:risk.evidence,sourceAssessmentSessionId:"" }}
      options={{ categories: categories.map((item) => ({ id:item.id,label:item.name })), owners: members.map((item) => ({ id:item.user_id,label:one(item.profiles)?.display_name ?? item.user_id })) }} />
  </>;
}
