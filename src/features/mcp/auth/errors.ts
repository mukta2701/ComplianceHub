export const MCP_ERROR_CODES = [
  "AUTH_REQUIRED", "INVALID_TOKEN", "WORKSPACE_REQUIRED", "FORBIDDEN", "VALIDATION_ERROR", "NOT_FOUND",
  "STALE_DIGEST", "NO_DIGEST_CHANNEL", "ALREADY_POSTED", "SLACK_REJECTED", "DELIVERY_UNKNOWN",
  "RATE_LIMITED", "INTERNAL_ERROR",
] as const;
export type McpErrorCode = typeof MCP_ERROR_CODES[number];

const safeErrors: Record<McpErrorCode, { message: string; recovery: string; status: number }> = {
  AUTH_REQUIRED: { message: "Authentication is required.", recovery: "Connect ComplianceHub and sign in, then try again.", status: 401 },
  INVALID_TOKEN: { message: "The authentication token is invalid or no longer active.", recovery: "Reconnect ComplianceHub and sign in again.", status: 401 },
  WORKSPACE_REQUIRED: { message: "Choose a workspace for this request.", recovery: "Retry with one of the accessible workspace IDs.", status: 400 },
  FORBIDDEN: { message: "You do not have permission to perform this action.", recovery: "Ask a workspace Owner if this access is required.", status: 403 },
  VALIDATION_ERROR: { message: "The request is not valid.", recovery: "Correct the highlighted input and try again.", status: 400 },
  NOT_FOUND: { message: "The requested item was not found.", recovery: "Check the identifier and your workspace access.", status: 404 },
  STALE_DIGEST: { message: "Compliance facts changed after this digest was prepared.", recovery: "Prepare a new digest before posting.", status: 409 },
  NO_DIGEST_CHANNEL: { message: "No daily digest channel is configured.", recovery: "Ask a workspace Owner to configure one Slack digest channel.", status: 409 },
  ALREADY_POSTED: { message: "Today’s digest has already been posted.", recovery: "No action is needed for this date.", status: 409 },
  SLACK_REJECTED: { message: "Slack rejected the digest delivery.", recovery: "Check the configured Slack channel, then explicitly retry a confirmed failure.", status: 502 },
  DELIVERY_UNKNOWN: { message: "Slack delivery could not be confirmed.", recovery: "Review Slack and the audit trail before taking further action.", status: 502 },
  RATE_LIMITED: { message: "Too many requests were made.", recovery: "Wait briefly, then try again.", status: 429 },
  INTERNAL_ERROR: { message: "ComplianceHub could not complete the request.", recovery: "Try again later or contact the internal support team.", status: 500 },
};

export class McpError extends Error {
  readonly code: McpErrorCode;
  readonly status: number;
  readonly recovery: string;
  constructor(code: McpErrorCode) {
    super(safeErrors[code].message);
    this.name = "McpError";
    this.code = code;
    this.status = safeErrors[code].status;
    this.recovery = safeErrors[code].recovery;
  }
  toStructuredContent() { return { ok: false as const, error: { code: this.code, message: this.message, recovery: this.recovery } }; }
}

export function protectedResourceMetadataUrl(resource: string) {
  const url = new URL(resource);
  return `${url.origin}/.well-known/oauth-protected-resource`;
}

export function oauthChallenge(resource: string, error?: "invalid_token") {
  const suffix = error ? `, error="${error}"` : "";
  return `Bearer resource_metadata="${protectedResourceMetadataUrl(resource)}"${suffix}`;
}

export function mcpErrorResult(error: McpError, resource: string) {
  const result = {
    isError: true,
    content: [{ type: "text" as const, text: `${error.message} ${error.recovery}` }],
    structuredContent: error.toStructuredContent(),
  };
  if (error.code !== "AUTH_REQUIRED" && error.code !== "INVALID_TOKEN") return result;
  const challenge = oauthChallenge(resource, error.code === "INVALID_TOKEN" ? "invalid_token" : undefined);
  return { ...result, _meta: { "mcp/www_authenticate": [challenge] } };
}

export function oauthErrorResponse(error: McpError, resource: string) {
  const headers: Record<string, string> = { "cache-control": "no-store", "content-type": "application/json" };
  if (error.status === 401) headers["www-authenticate"] = oauthChallenge(resource, error.code === "INVALID_TOKEN" ? "invalid_token" : undefined);
  return new Response(JSON.stringify(error.toStructuredContent()), { status: error.status, headers });
}
