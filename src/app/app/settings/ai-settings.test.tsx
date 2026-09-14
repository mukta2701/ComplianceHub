import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./ai-actions", () => ({ updateAiOptInAction: vi.fn() }));
import { AiWorkspaceSettings } from "./ai-settings";

describe("AiWorkspaceSettings", () => {
  it("gives an owner an explicit opt-in control", () => {
    render(<AiWorkspaceSettings enabled={false} isOwner />);

    expect(screen.getByRole("heading", { name: "Explain & Act assistance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable AI assistance" })).toBeInTheDocument();
    expect(screen.getByText(/draft only/i)).toBeInTheDocument();
  });

  it("shows the workspace state without an action for non-owners", () => {
    render(<AiWorkspaceSettings enabled={true} isOwner={false} />);

    expect(screen.getByText("Enabled by a workspace owner")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
