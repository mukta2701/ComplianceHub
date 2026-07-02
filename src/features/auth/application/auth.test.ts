import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema } from "./auth";

describe("authentication input", () => {
  it("accepts a strong signup with matching passwords", () => {
    expect(signUpSchema.safeParse({ displayName: "Alex", email: "alex@example.com", password: "correct horse battery", confirmPassword: "correct horse battery" }).success).toBe(true);
  });

  it("rejects mismatched signup passwords", () => {
    expect(signUpSchema.safeParse({ displayName: "Alex", email: "alex@example.com", password: "correct horse battery", confirmPassword: "different password" }).success).toBe(false);
  });

  it("normalises sign-in email addresses", () => {
    expect(signInSchema.parse({ email: " ALEX@EXAMPLE.COM ", password: "password123" }).email).toBe("alex@example.com");
  });
});
