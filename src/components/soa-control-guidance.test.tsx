import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SoaControlGuidance } from "./soa-control-guidance";

describe("SoaControlGuidance", () => {
  it("shows purpose, evidence ideas, and an explicitly review-only rationale draft", () => {
    render(<SoaControlGuidance control={{ id: "item-1", code: "8.5", title: "Strong authentication methods", applicable: true }} />);

    expect(screen.getByText("Why this control matters")).toBeInTheDocument();
    expect(screen.getByText(/Identity-provider configuration export/i)).toBeInTheDocument();
    expect(screen.getByText(/draft only/i)).toBeInTheDocument();
  });
});
