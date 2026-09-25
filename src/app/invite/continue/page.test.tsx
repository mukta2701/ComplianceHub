import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InviteContinuePage from "./page";

const replaceMock = vi.fn();

describe("invite continuation bridge", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    Object.defineProperty(window, "location", {
      value: { replace: replaceMock },
      writable: true,
      configurable: true,
    });
  });

  it("forces a full-document request to the token-free invite page and offers a normal-link fallback", () => {
    render(<InviteContinuePage />);

    expect(screen.getByRole("heading", { name: "Continuing to your invitation" })).toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/invite");
    const fallback = screen.getByRole("link", { name: "Continue to invitation" });
    expect(fallback.tagName).toBe("A");
    expect(fallback).toHaveAttribute("href", "/invite");
  });
});
