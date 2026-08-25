import { describe, expect, it } from "vitest";
import { MCP_ERROR_CODES, McpError, mcpErrorResult, oauthChallenge } from "./errors";

describe("MCP errors", () => {
  it("defines every stable public code with a safe recovery instruction", () => {
    expect(MCP_ERROR_CODES).toEqual([
      "AUTH_REQUIRED", "INVALID_TOKEN", "WORKSPACE_REQUIRED", "FORBIDDEN", "VALIDATION_ERROR",
      "NOT_FOUND", "STALE_DIGEST", "NO_DIGEST_CHANNEL", "ALREADY_POSTED", "SLACK_REJECTED",
      "DELIVERY_UNKNOWN", "RATE_LIMITED", "INTERNAL_ERROR",
    ]);
    for (const code of MCP_ERROR_CODES) {
      const error = new McpError(code);
      expect(error.toStructuredContent()).toEqual(expect.objectContaining({ ok: false, error: expect.objectContaining({ code, recovery: expect.any(String) }) }));
      expect(Object.keys(error.toStructuredContent().error)).toEqual(["code", "message", "recovery"]);
    }
  });

  it("adds the RFC 9728 challenge to HTTP and MCP errors", () => {
    const challenge = oauthChallenge("https://compliance.example/mcp", "invalid_token");
    expect(challenge).toBe('Bearer resource_metadata="https://compliance.example/.well-known/oauth-protected-resource", error="invalid_token"');
    expect(mcpErrorResult(new McpError("INVALID_TOKEN"), "https://compliance.example/mcp"))
      .toHaveProperty("_meta", { "mcp/www_authenticate": [challenge] });
  });

  it("describes a confirmed digest rejection without attributing it to Slack or exposing configuration detail", () => {
    const error = new McpError("SLACK_REJECTED");

    expect(error.toStructuredContent()).toEqual({
      ok: false,
      error: {
        code: "SLACK_REJECTED",
        message: "The Slack digest delivery was rejected.",
        recovery: "Check that the server-approved Slack destination is configured and active, then explicitly retry a confirmed failure.",
      },
    });
    const publicText = `${error.message} ${error.recovery}`;
    expect(publicText).not.toMatch(/Slack (?:said|returned|responded|refused)/i);
    expect(publicText).not.toMatch(/webhook|workspace|channel name|digest value|sha-?256|environment variable/i);
  });

  it.each(MCP_ERROR_CODES.filter((code) => code !== "AUTH_REQUIRED" && code !== "INVALID_TOKEN"))(
    "does not attach an authentication challenge to business error %s", (code) => {
      expect(mcpErrorResult(new McpError(code), "https://compliance.example/mcp")).not.toHaveProperty("_meta");
    },
  );
});
