import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: hoisted.get, set: hoisted.set }),
}));

import * as invitationCookie from "./invitation-cookie";

const VALID_TOKEN = "A".repeat(43);

describe("invitation token cookie", () => {
  beforeEach(() => {
    hoisted.get.mockReset();
    hoisted.set.mockReset();
  });

  it("exports a narrow, short-lived HttpOnly cookie contract", () => {
    const contract = invitationCookie as unknown as {
      INVITATION_TOKEN_COOKIE: string;
      INVITATION_TOKEN_COOKIE_MAX_AGE: number;
      invitationTokenCookieOptions: (nodeEnv: string) => Record<string, unknown>;
    };

    expect(contract.INVITATION_TOKEN_COOKIE).toBe("compliancehub_invitation_token");
    expect(contract.INVITATION_TOKEN_COOKIE_MAX_AGE).toBe(45 * 60);
    expect(contract.invitationTokenCookieOptions).toBeTypeOf("function");
    expect(contract.invitationTokenCookieOptions("development")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/invite",
      maxAge: 45 * 60,
    });
    expect(contract.invitationTokenCookieOptions("production")).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/invite",
      maxAge: 45 * 60,
    });
  });

  it("sets the raw token only in the response cookie with the exact production attributes", () => {
    const response = new NextResponse(null, { status: 303 });

    invitationCookie.setInvitationTokenCookie(response, VALID_TOKEN, "production");

    expect(response.headers.get("set-cookie")).toMatch(
      new RegExp(`^compliancehub_invitation_token=${VALID_TOKEN}; Path=/invite; Expires=[^;]+; Max-Age=2700; Secure; HttpOnly; SameSite=lax$`),
    );
  });

  it("reads only an exact 32-byte base64url token and ignores malformed cookie values", async () => {
    hoisted.get.mockReturnValueOnce({ value: VALID_TOKEN });
    await expect(invitationCookie.readInvitationTokenCookie()).resolves.toBe(VALID_TOKEN);

    hoisted.get.mockReturnValueOnce({ value: `${VALID_TOKEN}x` });
    await expect(invitationCookie.readInvitationTokenCookie()).resolves.toBeNull();
  });

  it("clears with the same narrow path and security attributes", async () => {
    await invitationCookie.clearInvitationTokenCookie("production");

    expect(hoisted.set).toHaveBeenCalledWith("compliancehub_invitation_token", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/invite",
      maxAge: 0,
    });
  });
});
