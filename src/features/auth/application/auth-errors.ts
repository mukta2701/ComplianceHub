type AuthOperation = "sign-in" | "sign-up";

export function authFailureMessage(providerMessage: string, operation: AuthOperation) {
  const message = providerMessage.toLowerCase();

  if (operation === "sign-up" && message.includes("already registered")) {
    return {
      path: "/sign-in",
      message: "An account already exists for this email. Sign in instead.",
    };
  }

  if (message.includes("rate limit") || message.includes("too many")) {
    return {
      path: operation === "sign-up" ? "/sign-up" : "/sign-in",
      message: "Too many attempts. Wait a few minutes, then try again.",
    };
  }

  return {
    path: operation === "sign-up" ? "/sign-up" : "/sign-in",
    message: "We could not complete that request. Check your details and try again.",
  };
}
