import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "65000000-0000-4000-8000-000000000001";
const USER_ID = "65000000-0000-4000-8000-000000000002";
const COOKIE_TOKEN = "A".repeat(43);
const FORGED_FORM_VALUE = ["form", "field", "must", "be", "ignored"].join("-");

const hoisted = vi.hoisted(() => ({
  serverClient: null as unknown,
  readInvitationTokenCookie: vi.fn(),
  clearInvitationTokenCookie: vi.fn(),
  setActiveOrganisationCookie: vi.fn(),
  clearActiveOrganisationCookie: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve(hoisted.serverClient),
}));
vi.mock("@/lib/invitation-cookie", () => ({
  readInvitationTokenCookie: hoisted.readInvitationTokenCookie,
  clearInvitationTokenCookie: hoisted.clearInvitationTokenCookie,
}));
vi.mock("@/lib/app-context", () => ({
  setActiveOrganisationCookie: hoisted.setActiveOrganisationCookie,
  clearActiveOrganisationCookie: hoisted.clearActiveOrganisationCookie,
}));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT:${url}`), { digest: "NEXT_REDIRECT" });
  },
}));

import * as actions from "./actions";

function client(options: {
  user?: { id: string; email?: string; email_confirmed_at?: string | null } | null;
  rpcData?: unknown;
  rpcError?: unknown;
  signOutError?: unknown;
} = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: options.rpcData ?? ORG_ID, error: options.rpcError ?? null });
  const signOut = vi.fn().mockResolvedValue({ error: options.signOutError ?? null });
  const getUser = vi.fn().mockResolvedValue({
    data: {
      user: options.user === undefined
        ? { id: USER_ID, email: "member@example.test", email_confirmed_at: "2026-07-14T00:00:00Z" }
        : options.user,
    },
  });
  return { value: { auth: { getUser, signOut }, rpc }, rpc, signOut, getUser };
}

function formWithForgedToken(): FormData {
  const form = new FormData();
  form.set("token", FORGED_FORM_VALUE);
  return form;
}

describe("public invitation actions", () => {
  beforeEach(() => {
    hoisted.readInvitationTokenCookie.mockReset().mockResolvedValue(COOKIE_TOKEN);
    hoisted.clearInvitationTokenCookie.mockReset();
    hoisted.setActiveOrganisationCookie.mockReset();
    hoisted.clearActiveOrganisationCookie.mockReset();
    hoisted.revalidatePath.mockReset();
  });

  it("exports cookie-backed acceptance and safe account-switch actions", () => {
    expect((actions as { acceptInvitationAction?: unknown }).acceptInvitationAction).toBeTypeOf("function");
    expect((actions as { switchInvitationAccountAction?: unknown }).switchInvitationAccountAction).toBeTypeOf("function");
  });

  it("sends a signed-out visitor to sign in with only the safe token-free continuation", async () => {
    const db = client({ user: null });
    hoisted.serverClient = db.value;

    await expect(actions.acceptInvitationAction(formWithForgedToken())).rejects.toThrow("REDIRECT:/sign-in?next=%2Finvite");

    expect(db.rpc).not.toHaveBeenCalled();
    expect(hoisted.clearInvitationTokenCookie).not.toHaveBeenCalled();
  });

  it("rejects an unverified user without consuming or forwarding the bearer token", async () => {
    const db = client({ user: { id: USER_ID, email: "member@example.test", email_confirmed_at: null } });
    hoisted.serverClient = db.value;

    await expect(actions.acceptInvitationAction(formWithForgedToken())).rejects.toThrow("REDIRECT:/invite?status=unavailable");

    expect(db.rpc).not.toHaveBeenCalled();
    expect(hoisted.clearInvitationTokenCookie).not.toHaveBeenCalled();
  });

  it("accepts using only the HttpOnly cookie and makes the joined workspace active", async () => {
    const db = client();
    hoisted.serverClient = db.value;

    await expect(actions.acceptInvitationAction(formWithForgedToken())).rejects.toThrow("REDIRECT:/app");

    expect(db.rpc).toHaveBeenCalledWith("accept_invitation", { raw_token: COOKIE_TOKEN });
    expect(db.rpc).not.toHaveBeenCalledWith("accept_invitation", { raw_token: FORGED_FORM_VALUE });
    expect(hoisted.setActiveOrganisationCookie).toHaveBeenCalledWith(ORG_ID);
    expect(hoisted.clearInvitationTokenCookie).toHaveBeenCalledOnce();
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app", "layout");
  });

  it.each([
    ["missing cookie", null, null],
    ["invalid or mismatched invitation", COOKIE_TOKEN, { message: "sensitive database detail" }],
  ])("retains a generic token-free error for a %s", async (_label, cookie, rpcError) => {
    hoisted.readInvitationTokenCookie.mockResolvedValue(cookie);
    const db = client({ rpcError });
    hoisted.serverClient = db.value;

    await expect(actions.acceptInvitationAction(new FormData())).rejects.toThrow("REDIRECT:/invite?status=unavailable");

    expect(hoisted.clearInvitationTokenCookie).not.toHaveBeenCalled();
    expect(hoisted.setActiveOrganisationCookie).not.toHaveBeenCalled();
  });

  it("does not relabel a post-commit active-workspace cookie failure as an invalid invitation", async () => {
    const operationalError = new Error("Could not persist active workspace");
    const db = client();
    hoisted.serverClient = db.value;
    hoisted.setActiveOrganisationCookie.mockRejectedValueOnce(operationalError);

    await expect(actions.acceptInvitationAction(new FormData())).rejects.toBe(operationalError);

    expect(db.rpc).toHaveBeenCalledOnce();
    expect(hoisted.clearInvitationTokenCookie).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves both workspace and invitation cookies when account sign-out fails", async () => {
    const db = client({ signOutError: { message: "provider details" } });
    hoisted.serverClient = db.value;

    await expect(actions.switchInvitationAccountAction()).rejects.toThrow("Could not sign out");

    expect(hoisted.clearActiveOrganisationCookie).not.toHaveBeenCalled();
    expect(hoisted.clearInvitationTokenCookie).not.toHaveBeenCalled();
  });

  it("clears the active workspace only after confirmed sign-out and preserves the invite", async () => {
    const db = client();
    hoisted.serverClient = db.value;

    await expect(actions.switchInvitationAccountAction()).rejects.toThrow("REDIRECT:/sign-in?next=%2Finvite");

    expect(db.signOut).toHaveBeenCalledOnce();
    expect(hoisted.clearActiveOrganisationCookie).toHaveBeenCalledOnce();
    expect(hoisted.clearInvitationTokenCookie).not.toHaveBeenCalled();
  });
});
