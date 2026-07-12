import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { logError } from "@/lib/observability/logger";

export interface RateLimitStore { increment(key: string, windowMs: number, now: number): Promise<number> }

// In-memory fallback. Correct within a single process, but resets per serverless
// isolate — used only when no durable store is configured, or as a degraded
// fallback if the durable store is briefly unavailable.
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; expires: number }>();
  async increment(key: string, windowMs: number, now: number) {
    const current = this.entries.get(key);
    if (!current || current.expires <= now) { this.entries.set(key, { count: 1, expires: now + windowMs }); return 1; }
    current.count += 1; return current.count;
  }
}

// Durable, cross-instance store backed by Postgres (shared by every serverless
// isolate). Atomic increment via the increment_rate_limit SECURITY DEFINER RPC.
export class PostgresRateLimitStore implements RateLimitStore {
  async increment(key: string, windowMs: number) {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.rpc("increment_rate_limit", { p_key: key, p_window_ms: windowMs });
    if (error) throw error;
    return Number(data);
  }
}

const memoryFallback = new MemoryRateLimitStore();
let durableStore: RateLimitStore | null = null;

// Prefer the durable store when the service role is configured (production);
// otherwise the in-memory store (local/tests without service creds).
function defaultStore(): RateLimitStore {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    durableStore ??= new PostgresRateLimitStore();
    return durableStore;
  }
  return memoryFallback;
}

export async function enforceRateLimit(key: string, options: { limit: number; windowMs: number; store?: RateLimitStore; now?: () => number }) {
  const store = options.store ?? defaultStore();
  const now = (options.now ?? Date.now)();
  let count: number;
  try {
    count = await store.increment(key, options.windowMs, now);
  } catch (error) {
    // The limiter must not take the app down: if the durable store blips, log it
    // and fall back to the in-memory counter rather than blocking the request.
    await logError("action", "rate-limit store unavailable, using in-memory fallback", error, { key });
    count = await memoryFallback.increment(key, options.windowMs, now);
  }
  if (count > options.limit) throw new Error("Too many requests. Please wait and try again.");
}
