import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const RAW_TOKEN = "A".repeat(43);
const PREVIEW = {
  organisationName: "Acme Security",
  role: "member",
  jobTitle: "Developer",
  expiresAt: "2026-07-15T12:00:00Z",
  emailHint: "m***@example.test",
  emailMatches: false,
};

const hoisted = vi.hoisted(() => ({
  readInvitationTokenCookie: vi.fn(),
  serverClient: null as unknown,
  acceptInvitationAction: vi.fn(),
  switchInvitationAccountAction: vi.fn(),
}));

vi.mock("@/lib/invitation-cookie", () => ({
  readInvitationTokenCookie: hoisted.readInvitationTokenCookie,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve(hoisted.serverClient),
}));
vi.mock("./actions", () => ({
  acceptInvitationAction: hoisted.acceptInvitationAction,
  switchInvitationAccountAction: hoisted.switchInvitationAccountAction,
}));

import InvitationPage from "./page";

function client(options: { user?: unknown; preview?: unknown; error?: unknown } = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: options.preview === undefined ? PREVIEW : options.preview, error: options.error ?? null });
  const getUser = vi.fn().mockResolvedValue({ data: { user: options.user ?? null } });
  return { value: { rpc, auth: { getUser } }, rpc, getUser };
}

async function renderPage(status?: string) {
  render(await InvitationPage({ searchParams: Promise.resolve({ status }) }));
}

describe("token-free invitation page", () => {
  beforeEach(() => {
    hoisted.readInvitationTokenCookie.mockReset().mockResolvedValue(RAW_TOKEN);
  });

  it("shows a clear unavailable state without querying when no bearer cookie exists", async () => {
    hoisted.readInvitationTokenCookie.mockResolvedValue(null);
    const db = client();
    hoisted.serverClient = db.value;

    await renderPage();

    expect(screen.getByRole("heading", { name: "Invitation unavailable" })).toBeInTheDocument();
    expect(screen.getByText(/request a new invitation/i)).toBeInTheDocument();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("shows only safe preview fields and token-free sign-in/sign-up links when signed out", async () => {
    const db = client();
    hoisted.serverClient = db.value;

    await renderPage();

    expect(db.rpc).toHaveBeenCalledWith("invitation_preview", { raw_token: RAW_TOKEN });
    expect(screen.getByRole("heading", { name: "Join Acme Security" })).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
    expect(screen.getByText("Developer")).toBeInTheDocument();
    expect(screen.getByText("m***@example.test")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?next=%2Finvite");
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/sign-up?next=%2Finvite");
    expect(document.body.textContent).not.toContain(RAW_TOKEN);
  });

  it("offers Join workspace only to a verified matching signed-in account", async () => {
    const db = client({
      user: { id: "user-1", email: "member@example.test", email_confirmed_at: "2026-07-14T00:00:00Z" },
      preview: { ...PREVIEW, emailMatches: true },
    });
    hoisted.serverClient = db.value;

    await renderPage();

    expect(screen.getByRole("button", { name: "Join workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch account" })).not.toBeInTheDocument();
  });

  it("warns a signed-in wrong account and offers a safe account switch", async () => {
    const db = client({ user: { id: "user-2", email: "wrong@example.test", email_confirmed_at: "2026-07-14T00:00:00Z" } });
    hoisted.serverClient = db.value;

    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(/signed in as wrong@example.test/i);
    expect(screen.getByRole("button", { name: "Switch account" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join workspace" })).not.toBeInTheDocument();
  });

  it.each([
    ["RPC error", { error: { message: "sensitive provider detail" } }],
    ["inactive preview", { preview: null }],
  ])("shows one generic unavailable state for %s", async (_label, options) => {
    const db = client(options);
    hoisted.serverClient = db.value;

    await renderPage();

    expect(screen.getByRole("heading", { name: "Invitation unavailable" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sensitive provider detail");
  });

  it("honours the token-free unavailable result without consulting a stale cookie", async () => {
    const db = client();
    hoisted.serverClient = db.value;

    await renderPage("unavailable");

    expect(screen.getByRole("heading", { name: "Invitation unavailable" })).toBeInTheDocument();
    expect(hoisted.readInvitationTokenCookie).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
