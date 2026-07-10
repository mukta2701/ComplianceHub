import { describe, expect, it } from "vitest";
import { authFailureDiagnostic, authFailureMessage } from "./auth-errors";

describe("authFailureDiagnostic", () => {
  it.each([
    ["sign-up", "existing-account", "User already registered"],
    ["sign-up", "throttled", "Email rate limit exceeded"],
    ["sign-in", "throttled", "Too many requests"],
    ["sign-in", "unexpected", "Provider detail that must stay private"],
  ] as const)(
    "reduces a %s failure to the %s classification",
    (operation, classification, providerMessage) => {
      expect(authFailureDiagnostic(providerMessage, operation)).toEqual({
        operation,
        classification,
      });
    },
  );
});

describe("authFailureMessage", () => {
  it("guides an existing account to sign in", () => {
    expect(authFailureMessage("User already registered", "sign-up")).toEqual({
      path: "/sign-in",
      message: "An account already exists for this email. Sign in instead.",
    });
  });

  it.each([
    ["sign-up", "/sign-up", "Email rate limit exceeded"],
    ["sign-in", "/sign-in", "Too many requests"],
  ] as const)(
    "keeps a throttled %s request recoverable without exposing provider text",
    (operation, path, providerMessage) => {
      expect(authFailureMessage(providerMessage, operation)).toEqual({
        path,
        message: "Too many attempts. Wait a few minutes, then try again.",
      });
    },
  );

  it.each([
    ["sign-up", "/sign-up"],
    ["sign-in", "/sign-in"],
  ] as const)("keeps an unexpected %s failure generic", (operation, path) => {
    expect(authFailureMessage("Provider detail that must stay private", operation)).toEqual({
      path,
      message: "We could not complete that request. Check your details and try again.",
    });
  });
});
