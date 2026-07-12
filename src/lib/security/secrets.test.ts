import { describe, expect, it, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "./secrets";

beforeAll(() => { process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64"); });

describe("secret encryption", () => {
  it("round-trips a secret through encrypt/decrypt", () => {
    const token = "ghp_live_token_ABC123";
    const stored = encryptSecret(token);
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain(token); // not plaintext at rest
    expect(decryptSecret(stored)).toBe(token);
  });

  it("produces a different ciphertext each time (random IV) but decrypts equally", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("treats null/empty as nothing to encrypt", () => {
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret("")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });

  it("passes through legacy (unprefixed) plaintext on decrypt for backward compatibility", () => {
    expect(decryptSecret("legacy-plain-token")).toBe("legacy-plain-token");
  });

  it("fails authentication if the ciphertext is tampered with", () => {
    const stored = encryptSecret("secret")!;
    const parts = stored.split(":");
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from("evil").toString("base64")}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
