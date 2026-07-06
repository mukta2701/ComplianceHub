import { randomBytes, createHash } from "node:crypto";

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
