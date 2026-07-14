import { NextResponse } from "next/server";
import { isInvitationToken, setInvitationTokenCookie } from "@/lib/invitation-cookie";
import { siteUrl } from "@/lib/site-url";

const INVITATION_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  const destination = new URL(isInvitationToken(token) ? "/invite" : "/invite?status=unavailable", siteUrl());
  const response = NextResponse.redirect(destination, { status: 303, headers: INVITATION_RESPONSE_HEADERS });

  if (isInvitationToken(token)) setInvitationTokenCookie(response, token);
  return response;
}
