import "server-only";

// Canonical public origin for building absolute links in emails (confirmation,
// password reset, invites). Falls back to localhost only in non-production; in
// production a missing NEXT_PUBLIC_SITE_URL is a hard error rather than silently
// emitting localhost links that break email verification.
export function siteUrl(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("NEXT_PUBLIC_SITE_URL must be set in production (used for auth/email redirect links)");
    }
    return "http://localhost:3000";
  }
  return url.replace(/\/+$/, "");
}
