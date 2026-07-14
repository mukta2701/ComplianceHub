"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearActiveOrganisationCookie, setActiveOrganisationCookie } from "@/lib/app-context";
import { clearInvitationTokenCookie, readInvitationTokenCookie } from "@/lib/invitation-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const INVITATION_UNAVAILABLE_PATH = "/invite?status=unavailable";

export async function acceptInvitationAction(_formData: FormData): Promise<void> {
  void _formData;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Finvite");
  if (!user.email_confirmed_at) redirect(INVITATION_UNAVAILABLE_PATH);

  const rawToken = await readInvitationTokenCookie();
  if (!rawToken) redirect(INVITATION_UNAVAILABLE_PATH);

  const { data, error } = await supabase.rpc("accept_invitation", { raw_token: rawToken });
  const organisationId = z.uuid().safeParse(data);
  if (error || !organisationId.success) redirect(INVITATION_UNAVAILABLE_PATH);

  // Acceptance is already committed. Cookie persistence failures must surface
  // as operational errors rather than inviting a duplicate acceptance retry.
  await setActiveOrganisationCookie(organisationId.data);
  await clearInvitationTokenCookie();
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function switchInvitationAccountAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error("Could not sign out");

  // The invitation cookie intentionally survives this account switch.
  await clearActiveOrganisationCookie();
  redirect("/sign-in?next=%2Finvite");
}
