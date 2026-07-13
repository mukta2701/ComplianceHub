import { afterEach, describe, expect, it, vi } from "vitest";
import { createTwilioWhatsAppPort } from "./twilio-whatsapp";

const completeEnv = {
  TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
  TWILIO_AUTH_TOKEN: "test-auth-token",
  TWILIO_WHATSAPP_FROM: "+14155238886",
};

describe("createTwilioWhatsAppPort", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns no network port unless the complete Twilio env gate is set", () => {
    const fetchImpl = vi.fn();
    expect(createTwilioWhatsAppPort({}, fetchImpl)).toBeUndefined();
    expect(createTwilioWhatsAppPort({ ...completeEnv, TWILIO_AUTH_TOKEN: "" }, fetchImpl)).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the Messages API form with normalized addresses and Basic Auth", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const postWhatsApp = createTwilioWhatsAppPort(completeEnv, fetchImpl);
    expect(postWhatsApp).toBeTypeOf("function");

    await postWhatsApp?.({ to: "whatsapp:+447700900123", body: "Compliance alert" });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages.json",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: `Basic ${btoa("AC00000000000000000000000000000000:test-auth-token")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect((init.body as URLSearchParams).toString()).toBe(
      "From=whatsapp%3A%2B14155238886&To=whatsapp%3A%2B447700900123&Body=Compliance+alert",
    );
  });

  it("throws a credential-free error for a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("provider detail", { status: 503 }));
    const postWhatsApp = createTwilioWhatsAppPort(completeEnv, fetchImpl);

    await expect(postWhatsApp?.({ to: "whatsapp:+447700900123", body: "Compliance alert" }))
      .rejects.toThrow("Twilio Messages API failed: 503");
  });

  it("replaces transport errors that may contain credentials or message data", async () => {
    const endpoint =
      "https://api.twilio.com/2010-04-01/Accounts/AC00000000000000000000000000000000/Messages.json";
    const messageBody = "Confidential compliance finding";
    const fetchImpl = vi.fn().mockRejectedValue(
      new Error(`request to ${endpoint} failed with test-auth-token while sending ${messageBody}`),
    );
    const postWhatsApp = createTwilioWhatsAppPort(completeEnv, fetchImpl);

    const exposed = await postWhatsApp?.({ to: "whatsapp:+447700900123", body: messageBody })
      .then(() => "no error", (error: unknown) => error instanceof Error ? error.message : String(error));

    expect(exposed).toBe("Twilio Messages API request failed");
    expect(exposed).not.toContain("test-auth-token");
    expect(exposed).not.toContain(endpoint);
    expect(exposed).not.toContain(messageBody);
  });
});
