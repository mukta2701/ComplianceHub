import type { CheckSeverity } from "../domain/monitor-provider";
import type { AlertFinding } from "./deliver";
import { approveSlackDestination } from "@/features/mcp/application/slack-destination-policy";

export type SafeSlackDeliveryPayload = {
  type: "monitoring_finding" | "connection_health";
  severity: CheckSeverity;
  title: string;
  controlRef: string;
  subjectId: string;
  detail: string;
};

export type SlackDeliveryLeaseIdentity = {
  deliveryId: string;
  lockToken: string;
};

export type ClaimedSlackAlertDelivery = SlackDeliveryLeaseIdentity & {
  organisationId: string;
  channelId: string;
  attemptCount: number;
  payload: SafeSlackDeliveryPayload;
};

export type QueueSlackDeliveryInput = {
  organisationId: string;
  channelId: string;
  kind: "monitoring_finding";
  subjectType: "monitoring_finding";
  subjectId: string;
  payload: SafeSlackDeliveryPayload;
};

export type SlackAlertDeliveryStore = {
  enqueueAndClaim(input: QueueSlackDeliveryInput, workerId: string): Promise<SlackDeliveryLeaseIdentity | null>;
  claim(workerId: string): Promise<ClaimedSlackAlertDelivery | null>;
  complete(deliveryId: string, lockToken: string): Promise<boolean>;
  fail(deliveryId: string, lockToken: string): Promise<boolean>;
};

const SEVERITY_EMOJI: Record<CheckSeverity, string> = { low: "🔵", medium: "🟡", high: "🟠", critical: "🔴" };

function safeSlackText(value: string, maximum: number): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F\s]+/g, " ").trim();
  return (normalized || "Compliance monitoring update").slice(0, maximum);
}

export function toSafeSlackDeliveryPayload(finding: AlertFinding): SafeSlackDeliveryPayload {
  return {
    type: "monitoring_finding",
    severity: finding.severity,
    title: safeSlackText(finding.title, 240),
    controlRef: safeSlackText(finding.controlRef, 80),
    subjectId: safeSlackText(finding.subjectId, 255),
    detail: safeSlackText(finding.detail, 500),
  };
}

export function buildQueuedSlackPayload(payload: SafeSlackDeliveryPayload): {
  text: string;
  blocks: unknown[];
} {
  const heading = `${SEVERITY_EMOJI[payload.severity]} ComplianceHub alert — ${payload.severity.toUpperCase()}`;
  return {
    text: heading,
    blocks: [
      { type: "section", text: { type: "plain_text", text: `${heading}\n${payload.title}` } },
      {
        type: "section",
        fields: [
          { type: "plain_text", text: `Control: ${payload.controlRef}` },
          { type: "plain_text", text: `Subject: ${payload.subjectId}` },
        ],
      },
      { type: "section", text: { type: "plain_text", text: payload.detail } },
      { type: "context", elements: [{ type: "plain_text", text: "Detected by ComplianceHub continuous monitoring" }] },
    ],
  };
}

function requireActive(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Alert delivery deadline exceeded");
}

export async function drainSlackAlertDeliveries(input: {
  store: SlackAlertDeliveryStore;
  workerId: string;
  batchSize?: number;
  resolveWebhookUrl: (organisationId: string, channelId: string, signal?: AbortSignal) => Promise<string>;
  postSlack: (webhookUrl: string, payload: unknown, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}): Promise<{ claimed: number; delivered: number; failed: number }> {
  const batchSize = input.batchSize ?? 10;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(input.workerId)
    || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) {
    throw new Error("Alert delivery worker configuration is invalid");
  }
  const summary = { claimed: 0, delivered: 0, failed: 0 };
  const signal = input.signal ?? new AbortController().signal;
  for (let index = 0; index < batchSize; index += 1) {
    requireActive(signal);
    const delivery = await input.store.claim(input.workerId);
    requireActive(signal);
    if (!delivery) break;
    summary.claimed += 1;
    try {
      const webhookUrl = await input.resolveWebhookUrl(
        delivery.organisationId,
        delivery.channelId,
        signal,
      );
      requireActive(signal);
      const approved = approveSlackDestination(webhookUrl);
      if (approved.status !== "approved") throw new Error("Slack destination is not approved");
      await input.postSlack(approved.canonicalUrl, buildQueuedSlackPayload(delivery.payload), signal);
      requireActive(signal);
      if (await input.store.complete(delivery.deliveryId, delivery.lockToken)) {
        summary.delivered += 1;
      }
    } catch {
      requireActive(signal);
      if (await input.store.fail(delivery.deliveryId, delivery.lockToken)) {
        summary.failed += 1;
      }
    }
  }
  return summary;
}
