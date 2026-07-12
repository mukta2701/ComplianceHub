import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encryption at rest for third-party secrets (OAuth access/refresh tokens, Slack
// webhook URLs). AES-256-GCM (authenticated) with a 32-byte key supplied out-of-
// band via APP_ENCRYPTION_KEY (base64). Stored form is a self-describing string
// "v1:<iv>:<tag>:<ciphertext>", all base64. Replaces storing raw tokens in a
// plain column (the "Vault at go-live" TODO).

const PREFIX = "v1:";

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not configured — cannot handle a stored secret");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("APP_ENCRYPTION_KEY must decode to 32 bytes (base64 of a 256-bit key)");
  return buf;
}

// Encrypt a secret for storage. Null/empty in → null out (nothing to protect),
// so sandbox connections with no token never require the key.
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

// Decrypt a stored secret. Null/empty in → null out. A value without the "v1:"
// prefix is treated as legacy plaintext (pre-encryption rows) and returned as-is,
// so existing data keeps working after this ships.
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const [, ivB, tagB, dataB] = stored.split(":");
  if (!ivB || !tagB || !dataB) throw new Error("Malformed encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
}
