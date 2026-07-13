import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UNSAFE_REDIRECT_CHARACTERS = /[\\\u0000-\u001f\u007f]/;

function safePostAuthDestination(candidate: string | null, origin: string): URL {
  const fallback = new URL("/app", origin);
  if (!candidate || UNSAFE_REDIRECT_CHARACTERS.test(candidate)) return fallback;

  try {
    // Reject encoded backslashes and control characters too. URL parsing can
    // otherwise normalise a backslash into an authority separator.
    const decoded = decodeURIComponent(candidate);
    if (UNSAFE_REDIRECT_CHARACTERS.test(decoded)) return fallback;

    const destination = new URL(candidate, origin);
    if (destination.origin !== origin) return fallback;

    const allowedPath =
      destination.pathname === "/app" ||
      destination.pathname.startsWith("/app/") ||
      destination.pathname.startsWith("/invite/") ||
      destination.pathname === "/reset-password";

    return allowedPath ? destination : fallback;
  } catch {
    return fallback;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safePostAuthDestination(url.searchParams.get("next"), url.origin);
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(next);
  }
  return NextResponse.redirect(new URL("/sign-in?message=The%20confirmation%20link%20is%20invalid%20or%20expired.", url.origin));
}
