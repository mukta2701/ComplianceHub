import "server-only";

const MAX_SLACK_PAYLOAD_BYTES = 32 * 1024;

export type SlackIncomingWebhookResult =
  | { readonly kind: "response"; readonly status: number }
  | { readonly kind: "transport_error" };

export function validateSlackIncomingWebhookUrl(value: string): URL {
  const url = new URL(value);
  const allowedHost = url.hostname === "hooks.slack.com" || url.hostname === "hooks.slack-gov.com";
  if (url.protocol !== "https:"
    || !allowedHost
    || url.username
    || url.password
    || url.port
    || url.search
    || url.hash
    || !/^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
    throw new Error("Invalid Slack incoming-webhook URL");
  }
  return url;
}

export async function postSlackIncomingWebhook(
  webhookUrl: string,
  payload: unknown,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<SlackIncomingWebhookResult> {
  const url = validateSlackIncomingWebhookUrl(webhookUrl);
  const body = JSON.stringify(payload);
  if (!body || Buffer.byteLength(body, "utf8") > MAX_SLACK_PAYLOAD_BYTES) {
    throw new Error("Invalid Slack incoming-webhook payload");
  }
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
    return { kind: "response", status: response.status };
  } catch {
    return { kind: "transport_error" };
  }
}
