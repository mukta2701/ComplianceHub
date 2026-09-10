import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { one } from "@/lib/supabase/one";
import { Card, PageIntro } from "@/components/ui";
import { RiskForm, type RiskFormValues } from "../risk-form";
import styles from "../risk-form.module.css";

export default async function NewRiskPage({ searchParams }: { searchParams: Promise<{ title?: string; description?: string; treatmentPlan?: string; sourceAssessmentSessionId?: string }> }) {
  const suggested = await searchParams;
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") redirect("/app/risks");
  const [categoriesResult, membersResult] = await Promise.all([
    supabase.from("risk_categories").select("id,name").eq("organisation_id", organisation.id).order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
  ]);
  if (categoriesResult.error || membersResult.error) throw new Error("Could not load risk choices. Reload and try again.");
  const values: RiskFormValues = {
    reference: "", title: suggested.title ?? "", description: suggested.description ?? "", categoryId: "", ownerId: "", reviewDate: "",
    likelihood: "3", impact: "3", residualLikelihood: "3", residualImpact: "3", treatment: "mitigate", status: "open",
    treatmentPlan: suggested.treatmentPlan ?? "", evidence: "", sourceAssessmentSessionId: suggested.sourceAssessmentSessionId ?? "",
  };
  return <>
    <Link href="/app/risks" className={styles.pageBack}><span aria-hidden="true">←</span> Back to risk register</Link>
    <div className={styles.introGrid}>
      <PageIntro eyebrow="RISK" title="Add risk" body="Record an exposure, assign accountability and document what should reduce it." />
      <Card className={styles.guidance}><h2>A useful risk is actionable</h2><ul><li>Describe a clear scenario</li><li>Separate inherent and residual exposure</li><li>Set an owner and next review</li></ul></Card>
    </div>
    <RiskForm mode="create" values={values} options={{ categories: (categoriesResult.data ?? []).map((item) => ({ id: item.id, label: item.name })), owners: (membersResult.data ?? []).map((item) => ({ id: item.user_id, label: one(item.profiles)?.display_name ?? item.user_id })) }} cancelHref="/app/risks" />
  </>;
}
