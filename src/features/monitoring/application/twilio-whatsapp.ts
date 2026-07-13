import { normalizeWhatsAppAddress, type WhatsAppPayload } from "./deliver";

type TwilioEnv = Readonly<Record<string, string | undefined>>;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createTwilioWhatsAppPort(
  env: TwilioEnv = process.env,
  fetchImpl: FetchLike = fetch,
): ((payload: WhatsAppPayload) => Promise<void>) | undefined {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_WHATSAPP_FROM?.trim();
  if (!accountSid || !authToken || !from) return undefined;

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`, "utf8").toString("base64")}`;

  return async (payload) => {
    const body = new URLSearchParams({
      From: normalizeWhatsAppAddress(from),
      To: normalizeWhatsAppAddress(payload.to),
      Body: payload.body,
    });
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      });
    } catch {
      // Fetch errors can echo the endpoint, headers or request body. Do not
      // retain the original error as a cause because delivery surfaces this
      // message to monitoring results.
      throw new Error("Twilio Messages API request failed");
    }
    if (!response.ok) throw new Error(`Twilio Messages API failed: ${response.status}`);
  };
}
