import "server-only";

const clientIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const standardScopes = new Set(["openid", "email", "profile"]);
const MAX_DISPLAYED_SCOPES = 20;
const MAX_SCOPE_LENGTH = 80;
// RFC 6749 scope-token permits printable ASCII except DQUOTE and backslash.
// The settings UI uses a conservative, interoperable subset that also excludes
// markup punctuation while retaining common URI/resource scope separators.
const safeScopeToken = /^[A-Za-z0-9][A-Za-z0-9._~:/-]*$/;

export function displayOAuthGrantScopes(scopes: readonly unknown[]): string[] {
  const displayed = scopes.slice(0, MAX_DISPLAYED_SCOPES).map((scope) => {
    if (typeof scope !== "string" || scope.length === 0 || scope.length > MAX_SCOPE_LENGTH || !safeScopeToken.test(scope)) {
      return "Invalid scope (redacted)";
    }
    return scope;
  });
  const omitted = scopes.length - MAX_DISPLAYED_SCOPES;
  if (omitted > 0) displayed.push(`${omitted} more scopes omitted`);
  return displayed;
}

export function validateRequestedIdentityScopes(scope: string): string[] | null {
  const scopes = [...new Set(scope.trim().split(/\s+/).filter(Boolean))];
  if (!scopes.length || scopes.some((value) => !standardScopes.has(value))) return null;
  return scopes;
}

type OAuthApi = {
  auth: { oauth: {
    listGrants: () => Promise<{ data: Array<{ client: { id: string; name: string }; scopes: string[]; granted_at: string }> | null; error: unknown }>;
    revokeGrant: (options: { clientId: string }) => Promise<{ error: unknown }>;
  } };
};

export async function listUserOAuthGrants(client: OAuthApi) {
  const { data, error } = await client.auth.oauth.listGrants();
  if (error || !data) return { status: "error" as const, grants: [] };
  const grants = data.filter((grant) => clientIdPattern.test(grant.client.id)).slice(0, 50).map((grant) => {
    return {
      clientId: grant.client.id,
      clientName: grant.client.name.trim().slice(0, 120) || "Connected application",
      scopes: displayOAuthGrantScopes(grant.scopes),
      grantedAt: grant.granted_at,
    };
  });
  return { status: "loaded" as const, grants };
}

export async function revokeUserOAuthGrant(client: OAuthApi, clientId: string) {
  if (!clientIdPattern.test(clientId) || clientId.length > 64) return { ok: false as const };
  const { error } = await client.auth.oauth.revokeGrant({ clientId });
  return { ok: !error } as const;
}
