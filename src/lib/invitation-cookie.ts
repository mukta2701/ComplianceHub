import "server-only";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const INVITATION_TOKEN_COOKIE = "compliancehub_invitation_token";
export const INVITATION_TOKEN_COOKIE_MAX_AGE = 45 * 60;
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isInvitationToken(value: unknown): value is string {
  return typeof value === "string" && INVITATION_TOKEN_PATTERN.test(value);
}

export function invitationTokenCookieOptions(nodeEnv = process.env.NODE_ENV) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: nodeEnv === "production",
    path: "/invite",
    maxAge: INVITATION_TOKEN_COOKIE_MAX_AGE,
  };
}

export function setInvitationTokenCookie(
  response: NextResponse,
  rawToken: string,
  nodeEnv = process.env.NODE_ENV,
): void {
  if (!isInvitationToken(rawToken)) throw new Error("Invalid invitation token");
  response.cookies.set(INVITATION_TOKEN_COOKIE, rawToken, invitationTokenCookieOptions(nodeEnv));
}

function invitationTokenClearOptions(nodeEnv = process.env.NODE_ENV) {
  return {
    ...invitationTokenCookieOptions(nodeEnv),
    maxAge: 0,
  };
}

export function clearInvitationTokenResponseCookie(
  response: NextResponse,
  nodeEnv = process.env.NODE_ENV,
): void {
  response.cookies.set(INVITATION_TOKEN_COOKIE, "", invitationTokenClearOptions(nodeEnv));
}

export async function readInvitationTokenCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(INVITATION_TOKEN_COOKIE)?.value;
  return isInvitationToken(value) ? value : null;
}

export async function clearInvitationTokenCookie(nodeEnv = process.env.NODE_ENV): Promise<void> {
  const store = await cookies();
  store.set(INVITATION_TOKEN_COOKIE, "", invitationTokenClearOptions(nodeEnv));
}
