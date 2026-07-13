import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_ID = "20000000-0000-4000-8000-000000000002";
const USER_ID = "30000000-0000-4000-8000-000000000003";

const hoisted = vi.hoisted(() => ({
  serverClient: null as unknown,
  setActiveOrganisationCookie: vi.fn(),
  clearActiveOrganisationCookie: vi.fn(),
  revalidatePath: vi.fn(),
  createOrganisation: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve(hoisted.serverClient),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: vi.fn(),
  setActiveOrganisationCookie: hoisted.setActiveOrganisationCookie,
  clearActiveOrganisationCookie: hoisted.clearActiveOrganisationCookie,
}));

vi.mock("@/features/organisations/application/organisation", () => ({
  createOrganisation: hoisted.createOrganisation,
  inviteMember: vi.fn(),
}));

vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT:${url}`), { digest: "NEXT_REDIRECT" });
  },
}));

import * as actions from "./actions";

type SwitchWorkspaceAction = (formData: FormData) => Promise<void>;

function invokeSwitch(formData: FormData): Promise<void> {
  const action = (actions as unknown as { switchWorkspaceAction: SwitchWorkspaceAction }).switchWorkspaceAction;
  return Promise.resolve().then(() => action(formData));
}

function formData(organisationId: string): FormData {
  const data = new FormData();
  data.set("organisationId", organisationId);
  return data;
}

function workspaceClient(options: { user?: { id: string } | null; membership?: { organisation_id: string } | null; error?: unknown } = {}) {
  const eqCalls: Array<[string, unknown]> = [];
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return chain;
    },
    maybeSingle: () => Promise.resolve({ data: options.membership ?? null, error: options.error ?? null }),
  };
  const from = vi.fn(() => chain);
  return {
    client: {
      auth: { getUser: () => Promise.resolve({ data: { user: options.user === undefined ? { id: USER_ID } : options.user } }) },
      from,
    },
    from,
    eqCalls,
  };
}

describe("active workspace actions", () => {
  beforeEach(() => {
    hoisted.setActiveOrganisationCookie.mockReset();
    hoisted.clearActiveOrganisationCookie.mockReset();
    hoisted.revalidatePath.mockReset();
    hoisted.createOrganisation.mockReset();
    hoisted.from.mockReset();
  });

  it("switches only after an RLS-scoped membership check and redirects to /app", async () => {
    const { client, from, eqCalls } = workspaceClient({ membership: { organisation_id: ORG_ID } });
    hoisted.serverClient = client;

    await expect(invokeSwitch(formData(ORG_ID))).rejects.toThrow("REDIRECT:/app");

    expect(from).toHaveBeenCalledWith("memberships");
    expect(eqCalls).toEqual([
      ["user_id", USER_ID],
      ["organisation_id", ORG_ID],
    ]);
    expect(hoisted.setActiveOrganisationCookie).toHaveBeenCalledWith(ORG_ID);
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app", "layout");
  });

  it("rejects invalid workspace ids before querying or mutating the cookie", async () => {
    const { client, from } = workspaceClient();
    hoisted.serverClient = client;

    await expect(invokeSwitch(formData("not-a-uuid"))).rejects.toThrow("Invalid workspace");

    expect(from).not.toHaveBeenCalled();
    expect(hoisted.setActiveOrganisationCookie).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not mutate the cookie when the user is not a member", async () => {
    const { client } = workspaceClient({ membership: null });
    hoisted.serverClient = client;

    await expect(invokeSwitch(formData(ORG_ID))).rejects.toThrow("not a member");

    expect(hoisted.setActiveOrganisationCookie).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not mutate the cookie when membership verification fails", async () => {
    const { client } = workspaceClient({ error: { message: "database unavailable" } });
    hoisted.serverClient = client;

    await expect(invokeSwitch(formData(ORG_ID))).rejects.toThrow("Could not verify workspace membership");

    expect(hoisted.setActiveOrganisationCookie).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires an authenticated user before switching", async () => {
    const { client, from } = workspaceClient({ user: null });
    hoisted.serverClient = client;

    await expect(invokeSwitch(formData(ORG_ID))).rejects.toThrow("REDIRECT:/sign-in");

    expect(from).not.toHaveBeenCalled();
    expect(hoisted.setActiveOrganisationCookie).not.toHaveBeenCalled();
  });

  it("makes a newly created organisation active without exposing its id in the redirect", async () => {
    hoisted.serverClient = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    };
    hoisted.createOrganisation.mockResolvedValue({ id: ORG_ID, name: "Acme", slug: "acme" });
    const data = new FormData();
    data.set("name", "Acme");

    await expect(actions.createOrganisationAction(data)).rejects.toThrow("REDIRECT:/app");

    expect(hoisted.setActiveOrganisationCookie).toHaveBeenCalledWith(ORG_ID);
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app", "layout");
  });

  it("does not relabel post-creation cookie failures as organisation creation failures", async () => {
    const cookieError = new Error("Could not persist active workspace");
    hoisted.serverClient = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: USER_ID } } }) },
    };
    hoisted.createOrganisation.mockResolvedValue({ id: ORG_ID, name: "Acme", slug: "acme" });
    hoisted.setActiveOrganisationCookie.mockRejectedValueOnce(cookieError);
    const data = new FormData();
    data.set("name", "Acme");

    await expect(actions.createOrganisationAction(data)).rejects.toBe(cookieError);

    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("clears the active workspace preference when signing out", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    hoisted.serverClient = { auth: { signOut } };

    await expect(actions.signOutAction()).rejects.toThrow("REDIRECT:/");

    expect(signOut).toHaveBeenCalledOnce();
    expect(hoisted.clearActiveOrganisationCookie).toHaveBeenCalledOnce();
  });

  it("retains the active workspace and does not redirect when sign-out fails", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: { message: "provider details must not escape" } });
    hoisted.serverClient = { auth: { signOut } };

    await expect(actions.signOutAction()).rejects.toThrow("Could not sign out");

    expect(signOut).toHaveBeenCalledOnce();
    expect(hoisted.clearActiveOrganisationCookie).not.toHaveBeenCalled();
  });
});
