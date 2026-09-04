import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type WebhookInputErrorCode = "body_too_large" | "body_unreadable";

export class WebhookInputError extends Error {
  override readonly name = "WebhookInputError";

  constructor(readonly code: WebhookInputErrorCode) {
    super(code === "body_too_large" ? "Webhook body is too large" : "Webhook body could not be read");
  }
}

const jiraTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const githubSignaturePattern = /^sha256=[0-9a-f]{64}$/;
const jwtPartPattern = /^[A-Za-z0-9_-]+$/;

export async function readBoundedWebhookBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) {
    throw new WebhookInputError("body_unreadable");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw new WebhookInputError("body_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new WebhookInputError("body_unreadable");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new WebhookInputError("body_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof WebhookInputError) throw error;
    throw new WebhookInputError("body_unreadable");
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function verifyGitHubWebhookSignature(
  body: Uint8Array,
  signature: string | null,
  secret: string,
): boolean {
  if (
    !signature
    || !githubSignaturePattern.test(signature)
    || secret.length < 1
    || secret.length > 4_096
    || /[\r\n]/.test(secret)
  ) return false;
  const supplied = Buffer.from(signature.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function decodeJwtPart(part: string, maxBytes: number): unknown {
  if (!jwtPartPattern.test(part) || part.length > Math.ceil(maxBytes * 4 / 3) + 4) throw new Error("invalid");
  const bytes = Buffer.from(part, "base64url");
  if (bytes.length < 1 || bytes.length > maxBytes || bytes.toString("base64url") !== part) throw new Error("invalid");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

export function verifyJiraWebhookJwt(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1_000)): boolean {
  if (
    typeof token !== "string"
    || token.length < 20
    || token.length > 8_192
    || typeof secret !== "string"
    || secret.length < 1
    || secret.length > 4_096
    || /[\r\n]/.test(secret)
    || !Number.isSafeInteger(nowSeconds)
    || nowSeconds < 1
  ) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || !jwtPartPattern.test(parts[2]) || parts[2].length !== 43) return false;
  try {
    const header = decodeJwtPart(parts[0], 512);
    const payload = decodeJwtPart(parts[1], 4_096);
    if (
      typeof header !== "object" || header === null || Array.isArray(header)
      || typeof payload !== "object" || payload === null || Array.isArray(payload)
    ) return false;
    const headerRecord = header as Record<string, unknown>;
    const payloadRecord = payload as Record<string, unknown>;
    if (
      headerRecord.alg !== "HS256"
      || (headerRecord.typ !== undefined && headerRecord.typ !== "JWT")
      || Object.keys(headerRecord).some((key) => key !== "alg" && key !== "typ")
    ) return false;
    const issuedAt = payloadRecord.iat;
    const expiresAt = payloadRecord.exp;
    if (
      typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt)
      || typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)
      || issuedAt < 1
      || expiresAt <= issuedAt
      || issuedAt > nowSeconds + 30
      || expiresAt < nowSeconds - 30
      || expiresAt - issuedAt > 600
    ) return false;
    const supplied = Buffer.from(parts[2], "base64url");
    const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`, "ascii").digest();
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}

export function sha256Hex(body: Uint8Array | string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function generateJiraWebhookToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashJiraWebhookToken(token: string): string {
  if (!jiraTokenPattern.test(token)) throw new Error("Jira webhook token is invalid");
  return sha256Hex(token);
}
