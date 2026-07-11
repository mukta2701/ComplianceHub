import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusLabel } from "./status-label";

describe("StatusLabel", () => {
  it("renders visible status text with the selected tone", () => {
    render(<StatusLabel tone="attention">Needs review</StatusLabel>);

    expect(screen.getByText("Needs review")).toBeVisible();
    expect(screen.getByText("Needs review")).toHaveClass("status-label");
    expect(screen.getByText("Needs review")).toHaveAttribute("data-tone", "attention");
  });

  it("keeps an optional icon decorative", () => {
    render(
      <button>
        <StatusLabel tone="confirmed" icon="check">
          Confirmed
        </StatusLabel>
      </button>,
    );

    expect(screen.getByRole("button")).toHaveAccessibleName("Confirmed");
    expect(screen.getByText("Confirmed").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes the AI tone without relying on colour-only content", () => {
    render(<StatusLabel tone="ai">AI draft</StatusLabel>);

    expect(screen.getByText("AI draft")).toHaveAttribute("data-tone", "ai");
  });
});
