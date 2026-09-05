import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { enforceRateLimit, RateLimitUnavailableError } from "@/lib/security/rate-limit";
import { logError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
const MAX_OBSERVABILITY_BODY_BYTES = 8 * 1024;
const OPAQUE_DIGEST = /^[A-Za-z0-9._:-]{1,200}$/;
const OBSERVABILITY_GLOBAL_LIMIT = 300;
const OBSERVABILITY_WINDOW_MS = 60_000;

class ObservabilityRequestError extends Error {
  constructor(readonly status: number) { super("Invalid observability request"); }
}

async function readDigest(request: Request): Promise<string> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") throw new ObservabilityRequestError(415);

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new ObservabilityRequestError(400);
    if (bytes > MAX_OBSERVABILITY_BODY_BYTES) throw new ObservabilityRequestError(413);
  }
  if (!request.body) throw new ObservabilityRequestError(400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_OBSERVABILITY_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation is best-effort. A broken producer must not replace
          // the deterministic payload-too-large response with a parse error.
        }
        throw new ObservabilityRequestError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new ObservabilityRequestError(400);

  const encoded = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    encoded.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded));
  } catch {
    throw new ObservabilityRequestError(400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ObservabilityRequestError(400);
  const digest = (body as Record<string, unknown>).digest;
  if (typeof digest !== "string" || !OPAQUE_DIGEST.test(digest)) throw new ObservabilityRequestError(400);
  return digest;
}

// Client-side error sink: the error boundaries POST here so uncaught render/data
// errors reach the same self-hosted log as server failures. Unauthenticated (a
// boundary can fire before/around auth), so it is IP-rate-limited and size-capped
// to prevent it becoming an abuse vector into app_errors.
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    // The forwarded address can be rewritten by a trusted edge, but it is still
    // attacker-controlled on some deployments. Keep the per-address burst
    // guard for normal traffic and enforce a site-wide cap independently so
    // rotating that header cannot create unbounded durable writes.
    await enforceRateLimit("observability:global", { limit: OBSERVABILITY_GLOBAL_LIMIT, windowMs: OBSERVABILITY_WINDOW_MS, failureMode: "closed" });
    await enforceRateLimit(`observability:${ip}`, { limit: 30, windowMs: OBSERVABILITY_WINDOW_MS, failureMode: "closed" });
  } catch (error) {
    return NextResponse.json({ ok: false }, { status: error instanceof RateLimitUnavailableError ? 503 : 429, headers: { "cache-control": "no-store", "retry-after": "60" } });
  }
  let digest: string;
  try {
    digest = await readDigest(request);
  } catch (error) {
    const status = error instanceof ObservabilityRequestError ? error.status : 400;
    return NextResponse.json({ ok: false }, { status });
  }
  const digestHash = createHash("sha256").update(digest, "utf8").digest("hex");
  // Client-controlled messages and browser URLs can contain auditor bearer
  // tokens or personal data. Persist only a fixed category and one-way digest.
  await logError("client", "client error", undefined, { digestHash });
  return NextResponse.json({ ok: true });
}
