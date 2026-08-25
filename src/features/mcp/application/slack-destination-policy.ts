import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { validateSlackIncomingWebhookUrl } from "@/lib/integrations/slack-incoming-webhook";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export type SlackDestinationDecision =
  | {
    readonly status: "approved";
    readonly canonicalUrl: string;
    readonly webhookSha256: string;
  }
  | { readonly status: "not_approved" };

export type StoredSlackDestinationDecision =
  | {
    readonly status: "approved";
    readonly encryptedWebhook: string;
  }
  | { readonly status: "not_approved" };

function configuredDigest(value = process.env.SLACK_ALLOWED_WEBHOOK_SHA256): Buffer | null {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) return null;
  const bytes = Buffer.from(value, "hex");
  return bytes.length === 32 ? bytes : null;
}

function exactDigestMatch(candidate: string, allowed = process.env.SLACK_ALLOWED_WEBHOOK_SHA256): boolean {
  if (!SHA256_HEX.test(candidate)) return false;
  const expected = configuredDigest(allowed);
  if (!expected) return false;
  const actual = Buffer.from(candidate, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function approveSlackDestination(
  webhookUrl: string,
  allowedDigest = process.env.SLACK_ALLOWED_WEBHOOK_SHA256,
): SlackDestinationDecision {
  const expected = configuredDigest(allowedDigest);
  if (!expected) return { status: "not_approved" };
  try {
    const canonicalUrl = validateSlackIncomingWebhookUrl(webhookUrl).toString();
    const actual = createHash("sha256").update(canonicalUrl, "utf8").digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return { status: "not_approved" };
    }
    return {
      status: "approved",
      canonicalUrl,
      webhookSha256: actual.toString("hex"),
    };
  } catch {
    return { status: "not_approved" };
  }
}

export function approveStoredSlackDestination(
  config: unknown,
  allowedDigest = process.env.SLACK_ALLOWED_WEBHOOK_SHA256,
): StoredSlackDestinationDecision {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { status: "not_approved" };
  }
  const record = config as Record<string, unknown>;
  const encryptedWebhook = record.webhookUrl;
  const webhookSha256 = record.webhookSha256;
  if (
    typeof encryptedWebhook !== "string"
    || !encryptedWebhook.startsWith("v1:")
    || typeof webhookSha256 !== "string"
    || !exactDigestMatch(webhookSha256, allowedDigest)
  ) {
    return { status: "not_approved" };
  }
  return { status: "approved", encryptedWebhook };
}
