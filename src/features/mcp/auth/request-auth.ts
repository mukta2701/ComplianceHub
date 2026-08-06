import "server-only";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions, type JWTVerifyGetKey, type JWTPayload } from "jose";
import { McpError } from "./errors";
import { getMcpOAuthConfig, type McpOAuthConfig } from "./oauth-config";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clientId = /^[A-Za-z0-9._~-]{1,200}$/;

export function parseBearerToken(header: string | null): string {
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  if (!match) throw new McpError(header ? "INVALID_TOKEN" : "AUTH_REQUIRED");
  return match[1];
}

export async function verifyMcpJwt(token: string, config: McpOAuthConfig, keySet: JWTVerifyGetKey): Promise<JWTPayload & { sub: string; client_id: string; session_id: string }> {
  try {
    const options: JWTVerifyOptions = {
      issuer: config.authorizationServer,
      audience: config.resource,
      algorithms: config.algorithms,
      clockTolerance: 5,
    };
    const { payload } = await jwtVerify(token, keySet, options);
    if (!payload.sub || !uuid.test(payload.sub)) throw new Error("invalid subject");
    if (typeof payload.client_id !== "string" || !clientId.test(payload.client_id)) throw new Error("invalid client");
    if (payload.role !== "authenticated") throw new Error("invalid role");
    if (typeof payload.session_id !== "string" || !uuid.test(payload.session_id)) throw new Error("invalid session");
    return payload as JWTPayload & { sub: string; client_id: string; session_id: string };
  } catch {
    throw new McpError("INVALID_TOKEN");
  }
}

export function createUserTokenSupabaseClient(config: McpOAuthConfig, token: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

type AuthDependencies = {
  config?: McpOAuthConfig;
  keySet?: JWTVerifyGetKey;
  createUserClient?: (config: McpOAuthConfig, token: string) => SupabaseClient;
};

export async function authenticateMcpRequest(request: Request, dependencies: AuthDependencies = {}): Promise<{
  user: User; claims: JWTPayload & { sub: string; client_id: string; session_id: string }; supabase: SupabaseClient;
}> {
  const config = dependencies.config ?? getMcpOAuthConfig();
  const token = parseBearerToken(request.headers.get("authorization"));
  const keySet = dependencies.keySet ?? createRemoteJWKSet(new URL(config.jwksUrl));
  const claims = await verifyMcpJwt(token, config, keySet);
  const supabase = (dependencies.createUserClient ?? createUserTokenSupabaseClient)(config, token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || data.user.id !== claims.sub) throw new McpError("INVALID_TOKEN");
  return { user: data.user, claims, supabase };
}
