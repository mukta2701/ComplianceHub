import { randomBytes, createHash } from "node:crypto";

// Name of the short-lived, httpOnly cookie used to hand the freshly-minted
// raw auditor token to the very next render of the audit detail page. Never
// put in the URL (query params land in server access logs, browser history,
// and Referer headers) — the cookie is httpOnly (no client-JS access) and
// self-expires after 60s, which is enough time for the post-mint redirect's
// render to pick it up and show the one-time "copy this link" card.
export const AUDITOR_LINK_FLASH_COOKIE = "auditor_link_flash";

// Read-only, login-free auditor token. Mirrors inviteMember's hashing/expiry:
// the raw token is returned to the caller ONCE and never stored; only its
// sha256 hex hash is persisted. The hash idiom is byte-for-byte identical to
// public.audit_view_for_token / public.accept_invitation
// (encode(digest(convert_to(raw,'UTF8'),'sha256'),'hex')) so the minted link
// resolves through the RPC. The raw token is 32 CSPRNG bytes (256 bits of
// entropy) rendered as URL-safe base64.
export function mintAuditorToken(input: { expiresInDays: number }): { rawToken: string; tokenHash: string; expiresAt: string } {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  return { rawToken, tokenHash, expiresAt };
}
