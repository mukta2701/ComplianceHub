export interface RateLimitStore { increment(key: string, windowMs: number, now: number): Promise<number> }

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; expires: number }>();
  async increment(key: string, windowMs: number, now: number) {
    const current = this.entries.get(key);
    if (!current || current.expires <= now) { this.entries.set(key, { count: 1, expires: now + windowMs }); return 1; }
    current.count += 1; return current.count;
  }
}

const fallbackStore = new MemoryRateLimitStore();
export async function enforceRateLimit(key: string, options: { limit: number; windowMs: number; store?: RateLimitStore; now?: () => number }) {
  const count = await (options.store ?? fallbackStore).increment(key, options.windowMs, (options.now ?? Date.now)());
  if (count > options.limit) throw new Error("Too many requests. Please wait and try again.");
}
