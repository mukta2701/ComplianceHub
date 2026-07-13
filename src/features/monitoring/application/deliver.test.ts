import { describe, expect, it, vi } from "vitest";
import {
  buildSlackPayload, buildWhatsAppPayload, deliverAlert, meetsSeverity,
  type AlertChannel, type AlertFinding,
} from "./deliver";

const finding: AlertFinding = {
  organisationId: "org1", sourceId: "src1", checkId: "github.branch_protection",
  controlRef: "A.8.32", subjectType: "github_repo", subjectId: "acme/isms",
  severity: "critical", title: "Production branch is unprotected", detail: "No protection rule on main.",
};

function channel(over: Partial<AlertChannel> & { type: AlertChannel["type"] }): AlertChannel {
  return { id: "ch1", config: {}, minSeverity: "high", ...over };
}

describe("meetsSeverity", () => {
  it("passes when the finding is at or above the floor, fails below", () => {
    expect(meetsSeverity("critical", "high")).toBe(true);
    expect(meetsSeverity("high", "high")).toBe(true);
    expect(meetsSeverity("medium", "high")).toBe(false);
  });
});

describe("buildSlackPayload", () => {
  it("puts the control, subject and detail into the blocks and a text fallback", () => {
    const payload = buildSlackPayload(finding);
    expect(payload.text).toContain("A.8.32");
    expect(payload.text).toContain("acme/isms");
    expect(JSON.stringify(payload.blocks)).toContain("Production branch is unprotected");
    expect(JSON.stringify(payload.blocks)).toContain("No protection rule on main.");
  });
});

describe("buildWhatsAppPayload", () => {
  it("builds a deterministic body and normalizes the recipient prefix", () => {
    expect(buildWhatsAppPayload("+447700900123", finding)).toEqual({
      to: "whatsapp:+447700900123",
      body: [
        "ComplianceHub alert — CRITICAL",
        "Production branch is unprotected",
        "Control: A.8.32",
        "Subject: acme/isms",
        "No protection rule on main.",
      ].join("\n"),
    });
    expect(buildWhatsAppPayload("whatsapp:+447700900123", finding).to).toBe("whatsapp:+447700900123");
  });
});

describe("deliverAlert", () => {
  const ports = () => ({
    postSlack: vi.fn().mockResolvedValue(undefined),
    postWhatsApp: vi.fn().mockResolvedValue(undefined),
    notifyInApp: vi.fn().mockResolvedValue(undefined),
  });

  it("skips a channel whose min_severity outranks the finding", async () => {
    const p = ports();
    const result = await deliverAlert(channel({ type: "slack", minSeverity: "critical", config: { webhookUrl: "https://hooks/x" } }), { ...finding, severity: "medium" }, p);
    expect(result.status).toBe("skipped");
    expect(p.postSlack).not.toHaveBeenCalled();
  });

  it("posts to the Slack webhook when severity is met", async () => {
    const p = ports();
    const result = await deliverAlert(channel({ type: "slack", config: { webhookUrl: "https://hooks/x" } }), finding, p);
    expect(result.status).toBe("delivered");
    expect(p.postSlack).toHaveBeenCalledWith("https://hooks/x", expect.objectContaining({ text: expect.any(String) }));
  });

  it("skips a Slack channel with no webhook configured", async () => {
    const p = ports();
    const result = await deliverAlert(channel({ type: "slack", config: {} }), finding, p);
    expect(result.status).toBe("skipped");
    expect(p.postSlack).not.toHaveBeenCalled();
  });

  it("writes an in-app notification for an in_app channel", async () => {
    const p = ports();
    const result = await deliverAlert(channel({ type: "in_app" }), finding, p);
    expect(result.status).toBe("delivered");
    expect(p.notifyInApp).toHaveBeenCalledWith(finding);
  });

  it("applies min_severity before calling the WhatsApp adapter", async () => {
    const p = ports();
    const result = await deliverAlert(
      channel({ type: "whatsapp", minSeverity: "critical", config: { to: "+447700900123" } }),
      { ...finding, severity: "medium" },
      p,
    );
    expect(result.status).toBe("skipped");
    expect(p.postWhatsApp).not.toHaveBeenCalled();
  });

  it("skips WhatsApp deterministically when no recipient is configured", async () => {
    const p = ports();
    const result = await deliverAlert(channel({ type: "whatsapp" }), finding, p);
    expect(result).toMatchObject({ status: "skipped", reason: "no WhatsApp recipient configured" });
    expect(p.postWhatsApp).not.toHaveBeenCalled();
  });

  it("skips WhatsApp deterministically when Twilio env did not construct a port", async () => {
    const p = ports();
    const result = await deliverAlert(
      channel({ type: "whatsapp", config: { to: "+447700900123" } }),
      finding,
      { postSlack: p.postSlack, notifyInApp: p.notifyInApp },
    );
    expect(result).toMatchObject({ status: "skipped", reason: "Twilio WhatsApp is not configured" });
    expect(p.postWhatsApp).not.toHaveBeenCalled();
  });

  it("delivers the deterministic WhatsApp payload through the injected adapter", async () => {
    const p = ports();
    const result = await deliverAlert(
      channel({ type: "whatsapp", config: { to: "+447700900123" } }),
      finding,
      p,
    );
    expect(result.status).toBe("delivered");
    expect(p.postWhatsApp).toHaveBeenCalledWith({
      to: "whatsapp:+447700900123",
      body: expect.stringContaining("Production branch is unprotected"),
    });
  });

  it("isolates a throwing WhatsApp adapter as a failed result", async () => {
    const p = ports();
    p.postWhatsApp.mockRejectedValue(new Error("Twilio Messages API failed: 503"));
    const result = await deliverAlert(
      channel({ type: "whatsapp", config: { to: "+447700900123" } }),
      finding,
      p,
    );
    expect(result).toMatchObject({ status: "failed", reason: "Twilio Messages API failed: 503" });
  });

  it("isolates a throwing adapter as a failed result rather than propagating", async () => {
    const p = { postSlack: vi.fn().mockRejectedValue(new Error("503 from Slack")), notifyInApp: vi.fn() };
    const result = await deliverAlert(channel({ type: "slack", config: { webhookUrl: "https://hooks/x" } }), finding, p);
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("503");
  });
});
