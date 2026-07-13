import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendInvitationEmail } from "./invitation-mail";

const input = {
  invitationId: "10000000-0000-4000-8000-000000000001",
  tokenHash: "a".repeat(64),
  recipientEmail: "member@example.com",
  organisationName: "Acme & Partners",
  invitationUrl: "https://app.example.com/invite/safe-token",
};

describe("Resend invitation mail adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.RESEND_API_KEY;
    delete process.env.INVITATION_FROM_EMAIL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns not_configured without making a network request", async () => {
    await expect(sendInvitationEmail(input)).resolves.toEqual({ status: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends one plain transactional email with safe Resend headers", async () => {
    vi.stubEnv("RESEND_API_KEY", "secret-api-key");
    vi.stubEnv("INVITATION_FROM_EMAIL", "ComplianceHub <invites@example.com>");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ id: "email_123" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await expect(sendInvitationEmail(input)).resolves.toEqual({ status: "sent", providerMessageId: "email_123" });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-api-key");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(new Headers(init?.headers).get("user-agent")).toMatch(/^ComplianceHub\//);
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      `invitation-${input.invitationId}-${input.tokenHash.slice(0, 16)}`,
    );
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      from: "ComplianceHub <invites@example.com>",
      to: ["member@example.com"],
      subject: "You have been invited to Acme & Partners on ComplianceHub",
      text: expect.stringContaining("https://app.example.com/invite/safe-token"),
    });
    expect(body.text.match(/https:\/\//g)).toHaveLength(1);
  });

  it("returns a generic failed result for non-2xx responses without exposing response content", async () => {
    vi.stubEnv("RESEND_API_KEY", "secret-api-key");
    vi.stubEnv("INVITATION_FROM_EMAIL", "invites@example.com");
    vi.mocked(fetch).mockResolvedValue(new Response("upstream secret diagnostics", { status: 422 }));

    await expect(sendInvitationEmail(input)).resolves.toEqual({
      status: "failed",
      error: "Invitation email provider rejected the request (HTTP 422).",
    });
  });

  it("handles network failures and invalid success payloads without leaking exception details", async () => {
    vi.stubEnv("RESEND_API_KEY", "secret-api-key");
    vi.stubEnv("INVITATION_FROM_EMAIL", "invites@example.com");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("secret socket details"));
    await expect(sendInvitationEmail(input)).resolves.toEqual({
      status: "failed",
      error: "Invitation email provider could not be reached.",
    });

    vi.mocked(fetch).mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(sendInvitationEmail(input)).resolves.toEqual({
      status: "failed",
      error: "Invitation email provider returned an invalid response.",
    });
  });
});
