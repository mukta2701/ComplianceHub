// Supabase treats authorization IDs as opaque values. Current hosted OAuth
// requests use lowercase alphanumeric IDs, while older/local fixtures use
// UUIDs. Keep the accepted surface bounded to URI-unreserved characters and
// let Supabase perform the authoritative existence/ownership check.
const authorizationIdPattern = /^[A-Za-z0-9._~-]{16,128}$/;
const consentMessages = new Set([
  "That authorization request is invalid or expired.",
  "Choose whether to approve or deny access.",
  "Could not complete that authorization request.",
  "That authorization request requests unsupported access.",
]);

export function parseOAuthConsentSearchParams(value: Record<string, string | string[] | undefined>) {
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "authorization_id" && key !== "message")) return null;
  const authorizationId = value.authorization_id;
  const message = value.message;
  if (message !== undefined && (typeof message !== "string" || message.length > 200 || !consentMessages.has(message))) return null;
  if (authorizationId === undefined) return message === undefined ? null : { message };
  if (!isOAuthAuthorizationId(authorizationId)) return null;
  return message === undefined ? { authorizationId } : { authorizationId, message };
}

export function isOAuthAuthorizationId(value: unknown): value is string {
  return typeof value === "string" && authorizationIdPattern.test(value);
}

export function safeClientRedirect(value: unknown, registeredRedirect: string): string | null {
  try {
    if (typeof value !== "string" || value.length > 4096) return null;
    const target = new URL(value);
    const registered = new URL(registeredRedirect);
    if (target.username || target.password || registered.username || registered.password) return null;
    const loopback = target.hostname === "localhost" || target.hostname === "127.0.0.1" || target.hostname === "[::1]";
    if (target.protocol !== "https:" && !(loopback && target.protocol === "http:" && registered.protocol === "http:")) return null;
    if (target.origin !== registered.origin || target.pathname !== registered.pathname) return null;
    return target.toString();
  } catch { return null; }
}
