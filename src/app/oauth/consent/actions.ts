"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isOAuthAuthorizationId, safeClientRedirect } from "@/features/auth/application/oauth-redirect";
import { validateRequestedIdentityScopes } from "@/features/auth/application/oauth-grants";

function consentMessage(value: string) {
  return `/oauth/consent?${new URLSearchParams({ message: value })}`;
}

export async function oauthConsentAction(formData: FormData) {
  const authorizationId = formData.get("authorizationId");
  const decision = formData.get("decision");
  if (!isOAuthAuthorizationId(authorizationId)) {
    redirect(consentMessage("That authorization request is invalid or expired."));
  }
  if (decision !== "approve" && decision !== "deny") redirect(consentMessage("Choose whether to approve or deny access."));
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);

  const detailsResult = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (detailsResult.error || !detailsResult.data || !("authorization_id" in detailsResult.data) || detailsResult.data.user.id !== user.id) {
    redirect(consentMessage("That authorization request is invalid or expired."));
  }
  if (!validateRequestedIdentityScopes(detailsResult.data.scope)) {
    redirect(consentMessage("That authorization request requests unsupported access."));
  }
  const result = decision === "approve"
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  const target = !result.error && result.data
    ? safeClientRedirect(result.data.redirect_url, detailsResult.data.redirect_uri)
    : null;
  if (!target) redirect(consentMessage("Could not complete that authorization request."));
  redirect(target);
}
