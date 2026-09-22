"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createInvitationCredential, inviteMember } from "@/features/organisations/application/organisation";
import { membershipRoles } from "@/features/organisations/domain/access";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";
import { invitationEmailDeliveryConfigured, sendInvitationEmail, type InvitationDeliveryOutcome } from "@/features/organisations/infrastructure/invitation-mail";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const issuedInvitationSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: z.enum(membershipRoles),
  jobTitle: z.string().nullable().optional(),
  expiresAt: z.string(),
});

type AppSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type IssuedInvitation = z.infer<typeof issuedInvitationSchema>;

async function deliverInvitation(
  supabase: AppSupabaseClient,
  organisationName: string,
  invitation: IssuedInvitation,
  rawToken: string,
  tokenHash: string,
): Promise<InvitationDeliveryOutcome> {
  const outcome = await sendInvitationEmail({
    invitationId: invitation.id,
    tokenHash,
    recipientEmail: invitation.email,
    organisationName,
    invitationUrl: `${siteUrl()}/invite/${rawToken}`,
  });
  const deliveryError = outcome.status === "failed"
    ? outcome.error
    : outcome.status === "not_configured"
      ? "Invitation email delivery is not configured."
      : null;
  const { error } = await supabase.rpc("record_invitation_delivery", {
    target_invitation_id: invitation.id,
    issued_token_hash: tokenHash,
    new_delivery_status: outcome.status,
    new_provider_message_id: outcome.status === "sent" ? outcome.providerMessageId : null,
    new_delivery_error: deliveryError,
  });
  if (error) throw new Error("Invitation saved, but its delivery result could not be recorded");
  return outcome;
}

function redirectToInvitationStatus(outcome: InvitationDeliveryOutcome, invitationId: string): never {
  redirect(`/app/settings?inviteStatus=${outcome.status}&inviteId=${invitationId}`);
}

export async function inviteMemberAction(formData: FormData) {
  const { supabase, user, membership, organisation } = await requireAppContext();
  // Keep target-role authorization in inviteMember after this rate limit. A broad
  // Settings gate would change both the denial message and the established order.
  await enforceRateLimit(`invite:${user.id}`, { limit: 10, windowMs: 60 * 60_000 });
  let issued: IssuedInvitation | undefined;
  let issuedTokenHash: string | undefined;
  const result = await inviteMember(
    { organisationId: organisation.id, email: formData.get("email"), role: formData.get("role"), jobTitle: formData.get("jobTitle") || undefined },
    {
      actorId: user.id,
      actorRole: membership.role,
      insertInvitation: async (row) => {
        const { data, error } = await supabase.rpc("issue_invitation", {
          target_organisation_id: row.organisationId,
          target_email: row.email,
          target_role: row.role,
          target_job_title: row.jobTitle ?? null,
          new_token_hash: row.tokenHash,
          new_expires_at: row.expiresAt,
        });
        if (error) throw new Error("Could not create the invitation");
        issued = issuedInvitationSchema.parse(data);
        issuedTokenHash = row.tokenHash;
        return { id: issued.id };
      },
    },
  );
  if (!issued || !issuedTokenHash) throw new Error("Could not create the invitation");
  revalidatePath("/app/settings");
  return {
    invitationId: issued.id,
    email: issued.email,
    expiresAt: issued.expiresAt,
    invitationPath: `/invite/${result.token}`,
  };
}

export async function revokeInvitationAction(formData: FormData) {
  const { supabase, membership, organisation } = await requireAppContext();
  workspaceAccess(membership.role).section("settings").requireManage("manage-invitations");
  const invitationId = z.uuid().safeParse(formData.get("invitationId"));
  if (!invitationId.success) throw new Error("Invalid invitation");
  const { data: invitation, error: invitationError } = await supabase.from("invitations").select("id")
    .eq("id", invitationId.data).eq("organisation_id", organisation.id).maybeSingle();
  if (invitationError || !invitation) throw new Error("Invitation not found");
  const { error } = await supabase.rpc("revoke_invitation", { target_invitation_id: invitationId.data });
  if (error) throw new Error("Could not revoke the invitation");
  revalidatePath("/app/settings");
}

export async function resendInvitationAction(formData: FormData) {
  const { supabase, user, membership, organisation } = await requireAppContext();
  workspaceAccess(membership.role).section("settings").requireManage("manage-invitations");
  const invitationId = z.uuid().safeParse(formData.get("invitationId"));
  if (!invitationId.success) throw new Error("Invalid invitation");
  await enforceRateLimit(`invite-resend:${user.id}`, { limit: 10, windowMs: 60 * 60_000 });
  const { data: invitation, error: invitationError } = await supabase.from("invitations").select("id")
    .eq("id", invitationId.data).eq("organisation_id", organisation.id).maybeSingle();
  if (invitationError || !invitation) throw new Error("Invitation not found");
  if (!invitationEmailDeliveryConfigured()) throw new Error("Invitation email delivery is not configured");

  const credential = createInvitationCredential();
  const { data, error } = await supabase.rpc("resend_invitation", {
    target_invitation_id: invitationId.data,
    new_token_hash: credential.tokenHash,
    new_expires_at: credential.expiresAt,
  });
  if (error) throw new Error("Could not resend the invitation");
  const issued = issuedInvitationSchema.parse(data);
  const outcome = await deliverInvitation(supabase, organisation.name, issued, credential.rawToken, credential.tokenHash);
  redirectToInvitationStatus(outcome, issued.id);
}
