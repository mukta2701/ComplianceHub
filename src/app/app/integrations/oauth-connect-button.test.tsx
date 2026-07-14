import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  start: vi.fn(),
  confirm: vi.fn(),
  constructorConfig: null as unknown,
  openConnectUI: vi.fn(),
  refresh: vi.fn(),
  event: null as unknown,
}));

vi.mock("./actions", () => ({
  startProviderAuthorizationAction: hoisted.start,
  confirmProviderAuthorizationAction: hoisted.confirm,
}));
vi.mock("@nangohq/frontend", () => ({
  default: class FakeNango {
    constructor(config: unknown) { hoisted.constructorConfig = config; }
    openConnectUI(options: { onEvent: (event: unknown) => void }) {
      hoisted.openConnectUI(options);
      void options.onEvent(hoisted.event ?? {
        type: "connect",
        payload: { connectionId: "connection-1", providerConfigKey: "github-prod" },
      });
    }
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hoisted.refresh }) }));

import { OAuthConnectButton } from "./oauth-connect-button";

describe("OAuthConnectButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.event = null;
    hoisted.confirm.mockResolvedValue(undefined);
  });

  it("opens Nango with only a short-lived session token and confirms the broker reference", async () => {
    const connectSessionToken = crypto.randomUUID();
    hoisted.start.mockResolvedValue({
      configured: true, token: connectSessionToken, expiresAt: "2026-07-14T12:00:00Z", apiBaseUrl: "https://api.nango.dev",
    });
    render(<OAuthConnectButton provider="github" />);

    await userEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));

    expect(hoisted.start).toHaveBeenCalledWith("github");
    expect(hoisted.constructorConfig).toEqual({ connectSessionToken });
    expect(hoisted.openConnectUI).toHaveBeenCalledWith(expect.objectContaining({ apiURL: "https://api.nango.dev" }));
    expect(hoisted.confirm).toHaveBeenCalledWith({
      provider: "github", connectionId: "connection-1", providerConfigKey: "github-prod",
    });
    expect(hoisted.refresh).toHaveBeenCalledOnce();
    expect(await screen.findByText("GitHub connected. Choose what ComplianceHub may use below.")).toBeInTheDocument();
    expect(screen.queryByText(/OAuth|authorization/i)).not.toBeInTheDocument();
  });

  it("explains the deployment checkpoint instead of pretending to connect", async () => {
    hoisted.start.mockResolvedValue({ configured: false });
    render(<OAuthConnectButton provider="jira" />);

    await userEvent.click(screen.getByRole("button", { name: "Connect Jira" }));

    expect(hoisted.openConnectUI).not.toHaveBeenCalled();
    expect(await screen.findByText("Provider setup is required before Jira can be connected.")).toBeInTheDocument();
  });

  it("fails closed when server-side connection verification rejects the event", async () => {
    hoisted.start.mockResolvedValue({
      configured: true, token: crypto.randomUUID(), expiresAt: "2026-07-14T12:00:00Z", apiBaseUrl: "https://api.nango.dev",
    });
    hoisted.confirm.mockRejectedValue(new Error("connection belongs elsewhere"));
    render(<OAuthConnectButton provider="github" />);

    await userEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));

    expect(await screen.findByText("Could not complete the GitHub connection. Nothing was saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeEnabled();
  });

  it("does not persist a provider authorization that Nango still marks pending", async () => {
    hoisted.start.mockResolvedValue({
      configured: true, token: crypto.randomUUID(), expiresAt: "2026-07-14T12:00:00Z", apiBaseUrl: "https://api.nango.dev",
    });
    hoisted.event = {
      type: "connect",
      payload: { connectionId: "connection-1", providerConfigKey: "github-prod", isPending: true },
    };
    render(<OAuthConnectButton provider="github" />);

    await userEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));

    expect(hoisted.confirm).not.toHaveBeenCalled();
    expect(await screen.findByText("GitHub connection is still pending. Nothing was saved yet.")).toBeInTheDocument();
  });
});
