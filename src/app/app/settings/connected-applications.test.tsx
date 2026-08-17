import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("./oauth-actions", () => ({ revokeOAuthGrantAction: vi.fn() }));
import { ConnectedApplications } from "./connected-applications";

describe("ConnectedApplications", () => {
  it("shows unavailable rather than falsely claiming there are no grants on API error", () => {
    render(<ConnectedApplications state={{ status: "error", grants: [] }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");
    expect(screen.queryByText("No connected AI applications.")).not.toBeInTheDocument();
  });
  it("shows none only after an authoritative loaded empty result", () => {
    render(<ConnectedApplications state={{ status: "loaded", grants: [] }} />);
    expect(screen.getByText("No connected AI applications.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
