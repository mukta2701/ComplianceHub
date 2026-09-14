"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";
import { loadReadinessInput } from "@/features/reports/application/load-readiness";
import { buildReadinessReport } from "@/features/reports/domain/readiness-report";
import { readinessReportSchema } from "@/features/reports/application/leadership-snapshots";

export async function publishLeadershipReportAction(formData: FormData) {
  void formData;
  const context = await requireAppContext();
  workspaceAccess(context.membership.role).section("leadership-report").requireManage();
  const { supabase, user, organisation } = context;
  await enforceRateLimit(`leadership-report:${user.id}`, { limit: 10, windowMs: 60_000 });
  const report = readinessReportSchema.parse(
    buildReadinessReport(await loadReadinessInput(supabase, organisation.id)),
  );
  const { error } = await supabase.rpc("publish_leadership_report", {
    target_organisation_id: organisation.id,
    report_payload: report,
  });
  if (error) throw new Error("Could not publish the leadership report");
  revalidatePath("/app/reports/readiness");
  revalidatePath("/app");
}
