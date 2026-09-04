import { redirect } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { one } from "@/lib/supabase/one";
import { PageIntro } from "@/components/ui";
import { createRiskAction } from "../../actions";
import { RiskForm } from "../risk-form";

export default async function NewRiskPage({ searchParams }: { searchParams: Promise<{ title?: string; description?: string; treatmentPlan?: string; sourceAssessmentSessionId?: string }> }) {
  const suggested = await searchParams;
  const { supabase, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner" && membership.role !== "admin") redirect("/app/risks");
  const [categories, members] = await Promise.all([
    supabase.from("risk_categories").select("id,name").eq("organisation_id", organisation.id).order("position"),
    supabase.from("memberships").select("user_id,profiles(display_name)").eq("organisation_id", organisation.id),
  ]);
  if (categories.error || members.error) throw new Error("Could not load risk categories and owners");
  return <>
    <PageIntro eyebrow="RISK" title="Add risk" body="Record inherent and residual exposure on the documented 5×5 matrix." />
    <RiskForm action={createRiskAction} categories={categories.data ?? []}
      owners={(members.data ?? []).map((member) => ({ id: member.user_id, name: one(member.profiles)?.display_name ?? member.user_id }))}
      values={suggested} />
  </>;
}
