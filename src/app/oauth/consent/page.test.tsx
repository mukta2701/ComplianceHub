import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ getAuthorizationDetails: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => Promise.resolve({ auth: {
  getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
  oauth: { getAuthorizationDetails: hoisted.getAuthorizationDetails },
} }) }));
vi.mock("./actions", () => ({ oauthConsentAction: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import OAuthConsentPage from "./page";

const id = "11111111-1111-4111-8111-111111111111";
const base = { authorization_id: id, redirect_uri: "https://client.example/callback", client: { id: "client", name: "Codex", uri: "https://client.example", logo_uri: "" }, user: { id: "user-1", email: "u@example.test" } };

describe("OAuthConsentPage scopes", () => {
  beforeEach(() => hoisted.getAuthorizationDetails.mockReset());
  it("shows approval controls when ChatGPT requests refresh-token continuity", async () => {
    hoisted.getAuthorizationDetails.mockResolvedValue({ data: { ...base, scope: "openid email offline_access profile" }, error: null });
    render(await OAuthConsentPage({ searchParams: Promise.resolve({ authorization_id: id }) }));
    expect(screen.getByText("Requested scopes")).toBeInTheDocument();
    expect(screen.getByText("openid, email, offline_access, profile")).toBeInTheDocument();
    expect(screen.getByText("Offline access")).toBeInTheDocument();
    expect(screen.getByText(/refresh its access when you are not actively using ComplianceHub/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve connection" })).toBeInTheDocument();
  });
  it("shows approval controls without an offline disclosure for the three identity scopes", async () => {
    hoisted.getAuthorizationDetails.mockResolvedValue({ data: { ...base, scope: "openid email profile" }, error: null });
    render(await OAuthConsentPage({ searchParams: Promise.resolve({ authorization_id: id }) }));
    expect(screen.getByText("openid, email, profile")).toBeInTheDocument();
    expect(screen.queryByText("Offline access")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve connection" })).toBeInTheDocument();
  });
  it.each([
    ["phone", "phone"],
    ["admin:write", "admin:write"],
    ["openid email profile offline_access phone", "phone"],
  ])("fails closed without approving or reflecting unsupported scope request %s", async (scope, unknownScope) => {
    hoisted.getAuthorizationDetails.mockResolvedValue({ data: { ...base, scope }, error: null });
    render(await OAuthConsentPage({ searchParams: Promise.resolve({ authorization_id: id }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("unsupported access");
    expect(screen.queryByRole("button", { name: "Approve connection" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(unknownScope);
  });
  it("renders an allowlisted terminal action error without requiring an authorization id", async () => {
    render(await OAuthConsentPage({ searchParams: Promise.resolve({ message: "Could not complete that authorization request." }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not complete that authorization request.");
    expect(hoisted.getAuthorizationDetails).not.toHaveBeenCalled();
  });
});
