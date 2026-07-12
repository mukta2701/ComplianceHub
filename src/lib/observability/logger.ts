import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Self-hosted observability (no third-party tracker). Every failure is written to
// stdout as structured JSON — captured by Vercel's runtime logs — AND best-effort
// persisted to the app_errors table so an operator can query incidents. The
// persistence is fire-and-forget and never throws: logging must not become a
// second failure on top of the one it is reporting.

export type ErrorSource = "cron" | "route" | "action" | "client";

function serialiseError(error: unknown): { message: string; detail: string | null } {
  if (error instanceof Error) return { message: error.message, detail: error.stack ?? null };
  if (typeof error === "string") return { message: error, detail: null };
  try { return { message: "Non-error thrown", detail: JSON.stringify(error) }; }
  catch { return { message: "Non-error thrown", detail: String(error) }; }
}

export async function logError(source: ErrorSource, message: string, error?: unknown, context: Record<string, unknown> = {}): Promise<void> {
  const { message: errMessage, detail } = error === undefined ? { message: "", detail: null } : serialiseError(error);
  const fullMessage = errMessage ? `${message}: ${errMessage}` : message;
  // Structured stdout line — always emitted, cheap, captured by the platform.
  console.error(JSON.stringify({ level: "error", source, message: fullMessage, context, at: new Date().toISOString() }));
  // Best-effort durable record. Swallow everything — never rethrow.
  try {
    const supabase = createSupabaseServiceClient();
    await supabase.from("app_errors").insert({
      source, message: fullMessage.slice(0, 2000), detail: detail?.slice(0, 20000) ?? null, context,
    });
  } catch { /* logging must never throw */ }
}
