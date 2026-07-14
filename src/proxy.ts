import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "./lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = {
  // Public, authentication, and demo routes must remain available before a
  // Supabase project is configured. Session refresh is required only for the
  // protected application tree and the invitation OAuth continuation.
  matcher: ["/app/:path*", "/invite"],
};
