type AuthOperation = "sign-in" | "sign-up";
type AuthFailureClassification = "existing-account" | "throttled" | "unexpected";

function classifyAuthFailure(
  providerMessage: string,
  operation: AuthOperation,
): AuthFailureClassification {
  const message = providerMessage.toLowerCase();

  if (operation === "sign-up" && message.includes("already registered")) {
    return "existing-account";
  }

  if (message.includes("rate limit") || message.includes("too many")) {
    return "throttled";
  }

  return "unexpected";
}

export function authFailureDiagnostic(providerMessage: string, operation: AuthOperation) {
  return {
    operation,
    classification: classifyAuthFailure(providerMessage, operation),
  };
}

export function authFailureMessage(providerMessage: string, operation: AuthOperation) {
  const classification = classifyAuthFailure(providerMessage, operation);

  if (classification === "existing-account") {
    return {
      path: "/sign-in",
      message: "An account already exists for this email. Sign in instead.",
    };
  }

  if (classification === "throttled") {
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
