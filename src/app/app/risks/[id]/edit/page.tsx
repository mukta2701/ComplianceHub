import { notFound, redirect } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { one } from "@/lib/supabase/one";
import { PageIntro } from "@/components/ui";
import { RiskForm } from "../../risk-form";
import { updateRiskAction } from "../../edit-actions";

export default async function EditRiskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") redirect(`/app/risks/${id}`);
  const { data: risk, error } = await supabase.from("risks")
    .select("id,reference,title,description,category_id,owner_id,likelihood,impact,residual_likelihood,residual_impact,treatment,treatment_plan,review_date,status,evidence")
    .eq("id", id).eq("organisation_id", organisation.id).maybeSingle();
  if (error) throw new Error("Could not load the risk");
  if (!risk) notFound();
  const [categories, members] = await Promise.all([
    supabase.from("risk_categories").select("id,name").eq("organisation_id", organisation.id).order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
  ]);
  if (categories.error || members.error) throw new Error("Could not load risk categories and owners");
  return <>
    <PageIntro eyebrow={`RISK ${risk.reference}`} title="Edit risk" body="Update ownership, treatment and residual exposure as your risk changes." />
    <RiskForm action={updateRiskAction} riskId={id} categories={categories.data ?? []}
      owners={(members.data ?? []).map((member) => ({ id: member.user_id, name: one(member.profiles)?.display_name ?? member.user_id }))}
      values={{ reference: risk.reference, title: risk.title, description: risk.description, categoryId: risk.category_id,
        ownerId: risk.owner_id, likelihood: risk.likelihood, impact: risk.impact,
        residualLikelihood: risk.residual_likelihood, residualImpact: risk.residual_impact,
        treatment: risk.treatment, treatmentPlan: risk.treatment_plan, reviewDate: risk.review_date ?? "",
        status: risk.status, evidence: risk.evidence }} />
  </>;
}
