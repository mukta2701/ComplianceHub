import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ role: "owner" as string }));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: async () => ({ membership: { role: fixture.role } }),
}));
vi.mock("../../actions", () => ({ createAdditionalOrganisationAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import NewOrganisationPage from "./page";

describe("new organisation page", () => {
  it("lets an Owner name and create a separate workspace with a way back", async () => {
    fixture.role = "owner";
    render(await NewOrganisationPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Create a new organisation" })).toBeInTheDocument();
    expect(screen.getByText(/separate workspace/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Organisation name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create organisation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to workspace" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/app");
  });

  it("shows a creation error without leaving the page", async () => {
    fixture.role = "owner";
    render(await NewOrganisationPage({ searchParams: Promise.resolve({ message: "Could not create the organisation." }) }));

    expect(screen.getByRole("alert")).toHaveTextContent("Could not create the organisation.");
  });

  it.each(["admin", "member"])("sends a signed-in %s back to the workspace", async (role) => {
    fixture.role = role;
    await expect(NewOrganisationPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/app");
  });
});
