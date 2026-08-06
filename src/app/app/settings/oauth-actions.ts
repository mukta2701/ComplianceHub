"use server";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { revokeUserOAuthGrant } from "@/features/auth/application/oauth-grants";

export async function revokeOAuthGrantAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  const result = await revokeUserOAuthGrant(supabase, String(formData.get("clientId") ?? ""));
  redirect(`/app/settings?oauthStatus=${result.ok ? "revoked" : "failed"}#connected-apps`);
}
