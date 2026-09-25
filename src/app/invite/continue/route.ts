import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/site-url";

// A request under /invite carries the scoped invitation cookie. Redirecting
// from here gives the preview a fresh request without putting a token in a URL.
export async function GET(): Promise<Response> {
  return NextResponse.redirect(new URL("/invite", siteUrl()), {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
