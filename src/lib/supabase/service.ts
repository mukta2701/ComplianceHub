import "server-only";
import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS. Only ever import from server-side
// automation/delivery code (cron routes and the validated MCP digest write);
// never from anything reachable by the browser.
function deadlineFetch(signal: AbortSignal): typeof fetch {
  return (input, init) => {
    if (signal.aborted) return Promise.reject(new DOMException("Request aborted", "AbortError"));
    const requestSignal = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
    return fetch(input, { ...init, signal: requestSignal }).catch((error: unknown) => {
      if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
      throw error;
    });
  };
}

export function createSupabaseServiceClient(options: { signal?: AbortSignal } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service environment variables are not configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(options.signal ? { global: { fetch: deadlineFetch(options.signal) } } : {}),
  });
}
