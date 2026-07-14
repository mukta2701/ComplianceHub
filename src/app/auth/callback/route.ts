import { NextResponse } from "next/server";
import { safePostAuthPath } from "@/lib/auth-destination";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const canonicalOrigin = siteUrl();
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next");
  const next = new URL(safePostAuthPath(requestedNext, { allowResetPassword: true }), canonicalOrigin);
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(next);
  }
  const failure = new URL("/sign-in", canonicalOrigin);
  failure.searchParams.set("message", "The confirmation link is invalid or expired.");
  // A failed recovery has no recovery session, so /reset-password is not a
  // valid retry destination. The ordinary post-auth allowlist fails it to /app.
  failure.searchParams.set("next", safePostAuthPath(requestedNext));
  return NextResponse.redirect(failure);
}
