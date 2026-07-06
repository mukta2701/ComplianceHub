import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintAuditorToken } from "./auditor-token";

describe("mintAuditorToken", () => {
  it("hashes the raw token with the same sha256-hex idiom the RPC uses", () => {
    // The Postgres RPC (public.audit_view_for_token / public.accept_invitation)
    // looks tokens up by encode(digest(convert_to(raw,'UTF8'),'sha256'),'hex').
    // This is the value that idiom produces for a known input (verified against
    // the local Postgres: it returns exactly this hex), so a Node hash that
    // matches it proves a minted link will resolve through the RPC.
    const known = "known-auditor-token";
    const postgresHex = "c3b612c5dd42dfc85ee6221a2b5eaadc8953b8f38270c90b903a93915a677925";
    expect(createHash("sha256").update(known, "utf8").digest("hex")).toBe(postgresHex);
  });

  it("returns a high-entropy raw token, its sha256-hex hash, and a future expiry", () => {
    const a = mintAuditorToken({ expiresInDays: 14 });
    const b = mintAuditorToken({ expiresInDays: 14 });
    // 32 CSPRNG bytes as base64url → 43 chars, and never repeats.
    expect(a.rawToken).toHaveLength(43);
    expect(a.rawToken).not.toBe(b.rawToken);
    // The stored hash is exactly the sha256 hex of the raw token — nothing else.
    expect(a.tokenHash).toBe(createHash("sha256").update(a.rawToken, "utf8").digest("hex"));
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.rawToken);
    expect(new Date(a.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
