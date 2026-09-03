import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";
import { z } from "zod";

const CURSOR_VERSION = 4;
const CURSOR_TTL_MS = 15 * 60_000;
const FUTURE_SKEW_MS = 30_000;
const MAX_CURSOR_BYTES = 4_096;
const CURSOR_AAD = Buffer.from("compliancehub:mcp:github-results-cursor:ch4", "utf8");
const ENCRYPTION_KEY_PURPOSE = "compliancehub:mcp:github-results-cursor:v4:encryption-key";
const MAC_KEY_PURPOSE = "compliancehub:mcp:github-results-cursor:v4:mac-key";
const NONCE_KEY_PURPOSE = "compliancehub:mcp:github-results-cursor:v4:nonce-key";
const PAGE_HASH_PURPOSE = "compliancehub.github.public-page.v4:";
const CLIENT_ID_HASH_PURPOSE = "compliancehub:mcp:github-results-cursor:v4:client-id\0";
const RESOURCE_HASH_PURPOSE = "compliancehub:mcp:github-results-cursor:v4:resource\0";
const innerCursor = z.string().min(80).max(2_048).regex(/^ch3\.[A-Za-z0-9_-]{1,1900}\.[0-9a-f]{64}$/);

export const githubResultsCursor = z.string().min(200).max(MAX_CURSOR_BYTES)
  .regex(/^ch4\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{1,3800}\.[A-Za-z0-9_-]{22}\.[0-9a-f]{64}$/);

const filtersSchema = z.object({
  repositoryId: z.uuid().nullable(),
  result: z.enum(["pass", "fail", "unknown", "not_applicable"]).nullable(),
  freshness: z.enum(["current", "stale"]).nullable(),
  mappingStatus: z.enum(["active", "historical"]).nullable(),
  severity: z.enum(["low", "medium", "high", "critical"]).nullable(),
  limit: z.number().int().min(1).max(50),
}).strict();

const cursorPayloadSchema = z.object({
  version: z.literal(CURSOR_VERSION),
  userId: z.uuid(),
  clientIdHash: z.string().regex(/^[0-9a-f]{64}$/),
  organisationId: z.uuid(),
  resourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  filters: filtersSchema,
  innerCursor,
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export type GitHubResultsCursorFilters = z.infer<typeof filtersSchema>;
export type GitHubResultsCursorScope = {
  userId: string;
  clientId: string;
  organisationId: string;
  resource: string;
  filters: GitHubResultsCursorFilters;
};
export type GitHubResultsCursorTiming = { issuedAt: string; expiresAt: string };

function cursorError(): Error {
  return new Error("Invalid GitHub compliance continuation cursor");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw cursorError();
}

function encryptionKey(): Buffer {
  const configured = process.env.APP_ENCRYPTION_KEY;
  if (!configured) throw new Error("APP_ENCRYPTION_KEY is not configured");
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length !== 32) throw new Error("APP_ENCRYPTION_KEY must decode to 32 bytes");
  return decoded;
}

function derivedKey(purpose: string): Buffer {
  return createHmac("sha256", encryptionKey()).update(purpose, "utf8").digest();
}

function signature(signedBody: string): Buffer {
  return createHmac("sha256", derivedKey(MAC_KEY_PURPOSE)).update(signedBody, "ascii").digest();
}

function deterministicIv(plaintext: Buffer): Buffer {
  return createHmac("sha256", derivedKey(NONCE_KEY_PURPOSE))
    .update(CURSOR_AAD)
    .update(Buffer.from([0]))
    .update(plaintext)
    .digest()
    .subarray(0, 12);
}

function bindingHash(purpose: string, value: string): string {
  return createHash("sha256").update(purpose + value, "utf8").digest("hex");
}

function normalizedScope(scope: GitHubResultsCursorScope): GitHubResultsCursorScope {
  return {
    userId: scope.userId,
    clientId: scope.clientId,
    organisationId: scope.organisationId,
    resource: scope.resource,
    filters: filtersSchema.parse(scope.filters),
  };
}

export function issueGitHubResultsCursor(input: {
  scope: GitHubResultsCursorScope;
  innerCursor: string;
  timing?: GitHubResultsCursorTiming;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw cursorError();
  const scope = normalizedScope(input.scope);
  const timing = input.timing ?? {
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CURSOR_TTL_MS).toISOString(),
  };
  const payload = cursorPayloadSchema.parse({
    version: CURSOR_VERSION,
    userId: scope.userId,
    clientIdHash: bindingHash(CLIENT_ID_HASH_PURPOSE, scope.clientId),
    organisationId: scope.organisationId,
    resourceHash: bindingHash(RESOURCE_HASH_PURPOSE, scope.resource),
    filters: scope.filters,
    innerCursor: input.innerCursor,
    issuedAt: timing.issuedAt,
    expiresAt: timing.expiresAt,
  });
  const plaintext = Buffer.from(canonicalJson(payload), "utf8");
  const iv = deterministicIv(plaintext);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(ENCRYPTION_KEY_PURPOSE), iv, { authTagLength: 16 });
  cipher.setAAD(CURSOR_AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const signedBody = `ch4.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
  const cursor = `${signedBody}.${signature(signedBody).toString("hex")}`;
  if (!githubResultsCursor.safeParse(cursor).success || Buffer.byteLength(cursor, "utf8") > MAX_CURSOR_BYTES) throw cursorError();
  return cursor;
}

export function verifyGitHubResultsCursor(input: {
  cursor: string;
  scope: GitHubResultsCursorScope;
  now?: Date;
}): { innerCursor: string; timing: GitHubResultsCursorTiming } {
  try {
    const cursor = githubResultsCursor.parse(input.cursor);
    const [prefix = "", encodedIv = "", encodedCiphertext = "", encodedTag = "", suppliedSignature = ""] = cursor.split(".");
    const signedBody = `${prefix}.${encodedIv}.${encodedCiphertext}.${encodedTag}`;
    const expected = signature(signedBody);
    const supplied = Buffer.from(suppliedSignature, "hex");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw cursorError();
    const iv = Buffer.from(encodedIv, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    const tag = Buffer.from(encodedTag, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0
      || iv.toString("base64url") !== encodedIv
      || ciphertext.toString("base64url") !== encodedCiphertext
      || tag.toString("base64url") !== encodedTag) throw cursorError();
    const decipher = createDecipheriv("aes-256-gcm", derivedKey(ENCRYPTION_KEY_PURPOSE), iv, { authTagLength: 16 });
    decipher.setAAD(CURSOR_AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (!timingSafeEqual(iv, deterministicIv(plaintext))) throw cursorError();
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    const payload = cursorPayloadSchema.parse(JSON.parse(decoded));
    if (canonicalJson(payload) !== decoded) throw cursorError();
    const scope = normalizedScope(input.scope);
    if (payload.userId !== scope.userId
      || payload.clientIdHash !== bindingHash(CLIENT_ID_HASH_PURPOSE, scope.clientId)
      || payload.organisationId !== scope.organisationId
      || payload.resourceHash !== bindingHash(RESOURCE_HASH_PURPOSE, scope.resource)
      || canonicalJson(payload.filters) !== canonicalJson(scope.filters)) throw cursorError();
    const now = input.now ?? new Date();
    const nowMs = now.getTime();
    const issuedAtMs = Date.parse(payload.issuedAt);
    const expiresAtMs = Date.parse(payload.expiresAt);
    if (!Number.isFinite(nowMs)
      || expiresAtMs - issuedAtMs !== CURSOR_TTL_MS
      || issuedAtMs > nowMs + FUTURE_SKEW_MS
      || nowMs - issuedAtMs > CURSOR_TTL_MS
      || expiresAtMs <= nowMs) throw cursorError();
    return { innerCursor: payload.innerCursor, timing: { issuedAt: payload.issuedAt, expiresAt: payload.expiresAt } };
  } catch {
    throw cursorError();
  }
}

export function githubPublicPageHash(value: unknown): string {
  return createHash("sha256").update(PAGE_HASH_PURPOSE + canonicalJson(value), "utf8").digest("hex");
}
