"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { automationSetupSchema, buildSetupSelections } from "@/features/automation/application/setup";

const evidenceProviders = new Set(["google_workspace", "github", "aws"]);

export async function saveAutomationSetupAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (membership.role !== "owner") throw new Error("Only workspace owners can set up automation");
  await enforceRateLimit(`automation-setup:${user.id}`, { limit: 5, windowMs: 60_000 });
  const setup = automationSetupSchema.parse({
    providers: formData.getAll("providers"),
    identityOwnerId: formData.get("identityOwnerId"),
    engineeringOwnerId: formData.get("engineeringOwnerId"),
    cloudOwnerId: formData.get("cloudOwnerId"),
    complianceOwnerId: formData.get("complianceOwnerId"),
  });
  const selections = buildSetupSelections(setup);
  const { data: members, error: memberError } = await supabase.from("memberships").select("user_id");
  if (memberError) throw new Error("Could not load workspace members");
  const memberIds = new Set((members ?? []).map((item) => item.user_id));
  if (selections.assignments.some((assignment) => !memberIds.has(assignment.ownerId))) throw new Error("Automation owners must be current workspace members");

  const { error: assignmentError } = await supabase.from("automation_assignments").upsert(
    selections.assignments.map((assignment) => ({ organisation_id: organisation.id, area: assignment.area, owner_id: assignment.ownerId, assigned_by: user.id })),
    { onConflict: "organisation_id,area" },
  );
  if (assignmentError) throw new Error("Could not assign automation owners");

  const { data: existing, error: existingError } = await supabase.from("connector_connections")
    .select("id,provider").neq("status", "revoked");
  if (existingError) throw new Error("Could not load automation connections");
  const existingProviders = new Set((existing ?? []).map((connection) => connection.provider));

  for (const connection of selections.connections) {
    if (existingProviders.has(connection.provider)) continue;
    const { data: created, error: connectionError } = await supabase.from("connector_connections").insert({
      organisation_id: organisation.id,
      provider: connection.provider,
      label: connection.label,
      consent: connection.consent,
      owner_id: connection.ownerId,
      connected_by: user.id,
      status: evidenceProviders.has(connection.provider) ? "connected" : "setup",
    }).select("id").single();
    if (connectionError || !created) throw new Error(`Could not prepare ${connection.label}`);
    if (evidenceProviders.has(connection.provider)) {
      const { error: sourceError } = await supabase.from("evidence_sources").insert({
        organisation_id: organisation.id,
        provider: connection.provider,
        label: `${connection.label} automation source`,
        config: { automationConnectionId: created.id },
        connected_by: user.id,
      });
      if (sourceError) throw new Error(`Could not prepare ${connection.label} evidence collection`);
    }
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/setup");
  revalidatePath("/app/automation");
  revalidatePath("/app/integrations");
  redirect("/app/automation?message=Your%20automation%20setup%20is%20ready.%20Generate%20a%20baseline%20when%20you%20are%20ready.");
}
