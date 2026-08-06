import "server-only";

const clientIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const standardScopes = new Set(["openid", "email", "profile"]);

type OAuthApi = {
  auth: { oauth: {
    listGrants: () => Promise<{ data: Array<{ client: { id: string; name: string }; scopes: string[]; granted_at: string }> | null; error: unknown }>;
    revokeGrant: (options: { clientId: string }) => Promise<{ error: unknown }>;
  } };
};

export async function listUserOAuthGrants(client: OAuthApi) {
  const { data, error } = await client.auth.oauth.listGrants();
  if (error || !data) return [];
  return data.filter((grant) => clientIdPattern.test(grant.client.id)).slice(0, 50).map((grant) => ({
    clientId: grant.client.id,
    clientName: grant.client.name.trim().slice(0, 120) || "Connected application",
    scopes: grant.scopes.filter((scope) => standardScopes.has(scope)).slice(0, 3),
    grantedAt: grant.granted_at,
  }));
}

export async function revokeUserOAuthGrant(client: OAuthApi, clientId: string) {
  if (!clientIdPattern.test(clientId) || clientId.length > 64) return { ok: false as const };
  const { error } = await client.auth.oauth.revokeGrant({ clientId });
  return { ok: !error } as const;
}
