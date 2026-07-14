import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({
  signInAction: vi.fn(),
  signUpAction: vi.fn(),
  signInWithOAuthAction: vi.fn(),
}));

import SignInPage from "./sign-in/page";
import SignUpPage from "./sign-up/page";

describe("auth continuation pages", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("preserves only token-free /invite in sign-in forms and account links", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ next: "/invite" }) }));

    expect(screen.getByText(/sign in to continue to your workspace invitation/i)).toBeInTheDocument();
    expect(document.querySelector('input[name="next"]')).toHaveValue("/invite");
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up?next=%2Finvite");
    expect(document.body.innerHTML).not.toContain("raw-token");
  });

  it("rejects a raw invitation path supplied to the sign-in page", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ next: "/invite/raw-token" }) }));

    expect(document.querySelector('input[name="next"]')).toHaveValue("/app");
    expect(document.body.innerHTML).not.toContain("raw-token");
  });

  it("hides unconfigured social providers", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ next: "/invite" }) }));

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Microsoft" })).not.toBeInTheDocument();
  });

  it("shows only explicitly enabled Google and Microsoft providers", async () => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "1");
    vi.stubEnv("MICROSOFT_AUTH_ENABLED", "1");

    render(await SignInPage({ searchParams: Promise.resolve({ next: "/invite" }) }));

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Microsoft" })).toBeInTheDocument();
    expect(document.querySelector('input[name="provider"][value="google"]')).toBeInTheDocument();
    expect(document.querySelector('input[name="provider"][value="azure"]')).toBeInTheDocument();
  });

  it("preserves safe invitation continuation through account creation", async () => {
    render(await SignUpPage({ searchParams: Promise.resolve({ next: "/invite" }) }));

    expect(screen.getByText(/create an account to continue to your workspace invitation/i)).toBeInTheDocument();
    expect(document.querySelector('input[name="next"]')).toHaveValue("/invite");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?next=%2Finvite");
  });
});
