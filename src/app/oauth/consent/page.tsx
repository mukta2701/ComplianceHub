import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safePostAuthPath } from "@/lib/auth-destination";
import { oauthConsentAction } from "./actions";
import { parseOAuthConsentSearchParams, safeClientRedirect } from "@/features/auth/application/oauth-redirect";
import { validateRequestedIdentityScopes } from "@/features/auth/application/oauth-grants";

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parsed = parseOAuthConsentSearchParams(await searchParams);
  if (!parsed) return <ConsentError message="That authorization request is invalid or expired." />;
  const { authorizationId, message } = parsed;
  const continuation = safePostAuthPath(authorizationId ? `/oauth/consent?authorization_id=${authorizationId}` : null, { allowOAuthConsent: true });
  if (continuation === "/app") return <ConsentError message={message ?? "That authorization request is invalid or expired."} />;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(continuation)}`);
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(String(authorizationId));
  if (error || !data) return <ConsentError message="That authorization request is invalid or expired." />;
  if (!("authorization_id" in data)) {
    const target = safeClientRedirect(data.redirect_url, data.redirect_url.split(/[?#]/, 1)[0]);
    if (target) redirect(target);
    return <ConsentError message="Could not continue that authorization request." />;
  }
  if (data.user.id !== user.id) return <ConsentError message="That authorization request belongs to another signed-in account." />;
  const clientName = data.client.name.trim().slice(0, 120) || "Connected application";
  const scopes = validateRequestedIdentityScopes(data.scope);
  if (!scopes) return <ConsentError message="That authorization request requests unsupported access." />;
  let redirectOrigin = "Registered application";
  try { redirectOrigin = new URL(data.redirect_uri).origin; } catch { /* Supabase validated it; display a safe fallback. */ }
  return <main style={{ maxWidth: "560px", margin: "64px auto", padding: "24px" }}>
    <section className="card" style={{ padding: "28px" }}>
      <p className="eyebrow">SECURE CONNECTION</p><h1>{clientName} wants to connect</h1>
      <p style={{ color: "#5b6473" }}>This application will act as your ComplianceHub account. Access remains limited by your workspace membership and can be revoked later.</p>
      <dl className="fact-grid" style={{ margin: "20px 0" }}><div><dt>Identity information</dt><dd>{scopes.join(", ")}</dd></div><div><dt>Return destination</dt><dd>{redirectOrigin}</dd></div></dl>
      <form action={oauthConsentAction} style={{ display: "flex", gap: "10px" }}>
        <input type="hidden" name="authorizationId" value={authorizationId} />
        <button className="button primary" name="decision" value="approve">Approve connection</button>
        <button className="button secondary" name="decision" value="deny">Deny</button>
      </form>
    </section>
  </main>;
}

function ConsentError({ message }: { message: string }) {
  return <main style={{ maxWidth: "560px", margin: "64px auto", padding: "24px" }}><section className="card" style={{ padding: "28px" }}><h1>Connection unavailable</h1><p role="alert">{message}</p></section></main>;
}
