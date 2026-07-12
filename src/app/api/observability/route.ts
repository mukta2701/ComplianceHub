import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { logError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

// Client-side error sink: the error boundaries POST here so uncaught render/data
// errors reach the same self-hosted log as server failures. Unauthenticated (a
// boundary can fire before/around auth), so it is IP-rate-limited and size-capped
// to prevent it becoming an abuse vector into app_errors.
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await enforceRateLimit(`observability:${ip}`, { limit: 30, windowMs: 60_000 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;
  const message = typeof b.message === "string" && b.message ? b.message.slice(0, 2000) : "client error";
  const context: Record<string, unknown> = {};
  if (typeof b.digest === "string") context.digest = b.digest.slice(0, 200);
  if (typeof b.url === "string") context.url = b.url.slice(0, 500);
  await logError("client", message, undefined, context);
  return NextResponse.json({ ok: true });
}
