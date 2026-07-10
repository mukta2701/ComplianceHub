import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubTabs } from "./sub-tabs";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/assets" }));

describe("SubTabs", () => {
  it("marks the tab matching the current path as active", () => {
    render(<SubTabs tabs={[{ href: "/app/risks", label: "Risks" }, { href: "/app/assets", label: "Assets" }]} />);
    expect(screen.getByRole("link", { name: "Assets" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Risks" })).not.toHaveAttribute("aria-current");
  });
});
