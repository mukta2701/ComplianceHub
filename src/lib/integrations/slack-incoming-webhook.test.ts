import { describe, expect, it, vi } from "vitest";
import { postSlackIncomingWebhook, validateSlackIncomingWebhookUrl } from "./slack-incoming-webhook";

describe("shared Slack incoming-webhook transport", () => {
  it.each([
    "https://hooks.slack.com/services/T/B/secret",
    "https://hooks.slack-gov.com/services/T/B/secret",
  ])("accepts only an official incoming-webhook URL: %s", (value) => {
    expect(validateSlackIncomingWebhookUrl(value).toString()).toBe(value);
  });

  it.each([
    "http://hooks.slack.com/services/T/B/secret",
    "https://hooks.slack.com.evil.test/services/T/B/secret",
    "https://user:pass@hooks.slack.com/services/T/B/secret",
    "https://hooks.slack.com:444/services/T/B/secret",
    "https://hooks.slack.com/services/T/B/secret?redirect=evil",
    "https://hooks.slack.com/services/T/B/secret#fragment",
    "https://hooks.slack.com/not-services/T/B/secret",
  ])("rejects an unsafe incoming-webhook URL: %s", (value) => {
    expect(() => validateSlackIncomingWebhookUrl(value)).toThrow();
  });

  it("posts bounded JSON with redirects disabled and returns the raw status", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(postSlackIncomingWebhook(
      "https://hooks.slack.com/services/T/B/secret",
      { text: "safe" },
      { fetcher, timeoutMs: 50 },
    )).resolves.toEqual({ kind: "response", status: 204 });
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "safe" }),
    }));
  });

  it("returns an ambiguous transport result without exposing exception details", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("DNS secret"); });
    await expect(postSlackIncomingWebhook(
      "https://hooks.slack.com/services/T/B/secret",
      { text: "safe" },
      { fetcher, timeoutMs: 50 },
    )).resolves.toEqual({ kind: "transport_error" });
  });
});
