import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("./oauth-actions", () => ({ revokeOAuthGrantAction: vi.fn() }));
import { ConnectedApplications } from "./connected-applications";

describe("ConnectedApplications", () => {
  it("shows unavailable rather than falsely claiming there are no grants on API error", () => {
    render(<ConnectedApplications state={{ status: "error", grants: [] }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.queryByText("No connected assistants.")).not.toBeInTheDocument();
  });
  it("shows none only after an authoritative loaded empty result", () => {
    render(<ConnectedApplications state={{ status: "loaded", grants: [] }} />);
    expect(screen.getByRole("heading", { name: "MCP & connected assistants" })).toBeVisible();
    expect(screen.getByText("No connected assistants.")).toBeInTheDocument();
    expect(screen.getByText("Approved Codex or Claude MCP connections will appear here.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("summarises read-only MCP access while keeping exact OAuth scopes in a collapsed disclosure", () => {
    render(<ConnectedApplications state={{
      status: "loaded",
      grants: [{
        clientId: "codex-local",
        clientName: "Codex",
        scopes: ["openid", "email", "profile", "offline_access"],
        grantedAt: "2026-09-04T08:30:00.000Z",
      }],
    }} />);

    const section = screen.getByRole("heading", { name: "MCP & connected assistants" }).closest("section, article, div");
    expect(section).not.toBeNull();
    expect(section).toHaveTextContent("Codex and Claude can use ComplianceHub’s read-only MCP tools under your workspace permissions.");
    expect(section).toHaveTextContent("This access is separate from optional Explain & Act drafting.");
    expect(section).toHaveTextContent("Revoking access ends active sessions and refresh access.");
    expect(screen.getByText("Read-only MCP access · Connected 04/09/2026")).toBeVisible();

    const disclosure = screen.getByText("Technical permissions").closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure).toHaveTextContent("openid, email, profile, offline_access");
    expect(screen.getByRole("button", { name: "Revoke" })).toBeVisible();
  });
});
