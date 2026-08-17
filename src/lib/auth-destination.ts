import { isOAuthAuthorizationId } from "@/features/auth/application/oauth-redirect";

const UNSAFE_REDIRECT_CHARACTERS = /[\\\u0000-\u001f\u007f]/;
const VALIDATION_ORIGIN = "https://post-auth-destination.invalid";

export function safePostAuthPath(
  candidate: unknown,
  options: { fallback?: "/app" | "/invite"; allowResetPassword?: boolean; allowOAuthConsent?: boolean } = {},
): string {
  const fallback = options.fallback ?? "/app";
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  if (UNSAFE_REDIRECT_CHARACTERS.test(candidate)) return fallback;

  try {
    const decoded = decodeURIComponent(candidate);
    if (UNSAFE_REDIRECT_CHARACTERS.test(decoded)) return fallback;

    const destination = new URL(candidate, VALIDATION_ORIGIN);
    if (destination.origin !== VALIDATION_ORIGIN) return fallback;

    if (destination.pathname === "/invite") return "/invite";

    if (options.allowOAuthConsent === true && destination.pathname === "/oauth/consent") {
      if (destination.hash || [...destination.searchParams.keys()].length !== 1) return fallback;
      const authorizationId = destination.searchParams.get("authorization_id");
      if (isOAuthAuthorizationId(authorizationId)) {
        return `/oauth/consent?authorization_id=${authorizationId}`;
      }
      return fallback;
    }

    const allowed = destination.pathname === "/app"
      || destination.pathname.startsWith("/app/")
      || (options.allowResetPassword === true && destination.pathname === "/reset-password");
    return allowed ? `${destination.pathname}${destination.search}${destination.hash}` : fallback;
  } catch {
    return fallback;
  }
}
