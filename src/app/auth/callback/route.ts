import { NextResponse } from "next/server";
import { safePostAuthPath } from "@/lib/auth-destination";
import { siteUrl } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const canonicalOrigin = siteUrl();
  const code = url.searchParams.get("code");
  const next = new URL(safePostAuthPath(url.searchParams.get("next"), { allowResetPassword: true }), canonicalOrigin);
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(next);
  }
  return NextResponse.redirect(new URL("/sign-in?message=The%20confirmation%20link%20is%20invalid%20or%20expired.", canonicalOrigin));
}
