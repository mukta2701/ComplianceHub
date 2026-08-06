const authorizationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  if (typeof authorizationId !== "string" || !authorizationIdPattern.test(authorizationId)) return null;
  if (message !== undefined && (typeof message !== "string" || message.length > 200 || !consentMessages.has(message))) return null;
  return message === undefined ? { authorizationId } : { authorizationId, message };
}

export function safeClientRedirect(value: unknown, registeredRedirect: string): string | null {
  try {
    if (typeof value !== "string" || value.length > 4096) return null;
    const target = new URL(value);
    const registered = new URL(registeredRedirect);
    if (target.username || target.password || registered.username || registered.password) return null;
    const localhost = target.hostname === "localhost" || target.hostname === "127.0.0.1";
    if (target.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && localhost && target.protocol === "http:")) return null;
    if (target.origin !== registered.origin || target.pathname !== registered.pathname) return null;
    return target.toString();
  } catch { return null; }
}
