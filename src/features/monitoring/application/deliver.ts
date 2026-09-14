import { buildQueuedSlackPayload, toSafeSlackDeliveryPayload, type SlackAlertDeliveryStore, type SlackDeliveryLeaseIdentity } from "./slack-alert-queue";
import type { CheckSeverity } from "../domain/monitor-provider";
import { approveSlackDestination } from "@/features/mcp/application/slack-destination-policy";

// Outbound alert delivery. A finding is delivered to every configured channel
// whose min_severity it meets. The pure helpers (severity gate, Slack payload)
// are unit-tested; the side-effecting adapters are injected as ports so this
// module never imports fetch or Supabase directly (matches the daily-sweep DI
// style and keeps deliverAlert testable without a network or a database).

export type AlertChannelType = "slack" | "whatsapp" | "in_app";

export type AlertChannel = {
  id: string;
  type: AlertChannelType;
  config: Record<string, unknown>;
  minSeverity: CheckSeverity;
};

export type AlertFinding = {
  organisationId: string;
  sourceId: string | null;
  checkId: string;
  controlRef: string;
  subjectType: string;
  subjectId: string;
  severity: CheckSeverity;
  title: string;
  detail: string;
};

export type DeliveryResult = {
  channelId: string;
  type: AlertChannelType;
  status: "delivered" | "skipped" | "failed";
  reason?: string;
};

const SEVERITY_RANK: Record<CheckSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

// A finding reaches a channel only if it's at least as severe as the channel's
// floor — so a "high" channel stays quiet for a "medium" finding.
export function meetsSeverity(finding: CheckSeverity, floor: CheckSeverity): boolean {
  return SEVERITY_RANK[finding] >= SEVERITY_RANK[floor];
}

// Shared bounded payload: all provider-controlled content is literal Slack text.
export function buildSlackPayload(finding: AlertFinding): { text: string; blocks: unknown[] } {
  return buildQueuedSlackPayload(toSafeSlackDeliveryPayload(finding));
}

export type WhatsAppPayload = {
  to: string;
  body: string;
};

export function normalizeWhatsAppAddress(address: string): string {
  return `whatsapp:${address.trim().replace(/^whatsapp:/i, "")}`;
}

// Twilio's transport details stay in the injected adapter. This pure payload is
// deterministic and contains no credentials or sender configuration.
export function buildWhatsAppPayload(recipient: string, finding: AlertFinding): WhatsAppPayload {
  return {
    to: normalizeWhatsAppAddress(recipient),
    body: [
      `ComplianceHub alert — ${finding.severity.toUpperCase()}`,
      finding.title,
      `Control: ${finding.controlRef}`,
      `Subject: ${finding.subjectId}`,
      finding.detail,
    ].join("\n"),
  };
}

// Side-effecting adapters, injected by the cron so this stays unit-testable.
export type DeliverPorts = {
  // Fire the Slack incoming-webhook. Throws on a non-2xx response.
  postSlack: (webhookUrl: string, payload: unknown) => Promise<void>;
  // Post a Twilio WhatsApp message. Undefined when the complete server-side
  // Twilio environment gate is not configured.
  postWhatsApp?: (payload: WhatsAppPayload) => Promise<void>;
  // Write the in-app notification(s) for this finding (recipient resolution +
  // idempotent upsert live in the orchestrator, which owns the DB handle).
  notifyInApp: (finding: AlertFinding) => Promise<void>;
  slackDelivery?: { store: SlackAlertDeliveryStore; workerId: string };
};

// Deliver one finding to one channel. Never throws: a channel that errors or
// isn't configured is isolated so it can't starve the other channels.
export async function deliverAlert(
  channel: AlertChannel,
  finding: AlertFinding,
  ports: DeliverPorts,
): Promise<DeliveryResult> {
  const base = { channelId: channel.id, type: channel.type } as const;
  if (!meetsSeverity(finding.severity, channel.minSeverity)) {
    return { ...base, status: "skipped", reason: "below channel min_severity" };
  }
  let slackLease: SlackDeliveryLeaseIdentity | null = null;
  try {
    switch (channel.type) {
      case "slack": {
        if (channel.config.slackDestinationStatus === "not_approved") {
          return { ...base, status: "failed", reason: "Slack destination is not approved" };
        }
        const webhookUrl = typeof channel.config.webhookUrl === "string" ? channel.config.webhookUrl : "";
        if (!webhookUrl) return { ...base, status: "skipped", reason: "no webhookUrl configured" };
        const approved = approveSlackDestination(webhookUrl);
        if (approved.status !== "approved") {
          return { ...base, status: "failed", reason: "Slack destination is not approved" };
        }
        const safePayload = toSafeSlackDeliveryPayload(finding);
        if (ports.slackDelivery) {
          slackLease = await ports.slackDelivery.store.enqueueAndClaim({
            organisationId: finding.organisationId,
            channelId: channel.id,
            kind: "monitoring_finding", subjectType: "monitoring_finding",
            subjectId: `${finding.checkId}::${finding.subjectId}`.slice(0, 512),
            payload: safePayload,
          }, ports.slackDelivery.workerId);
          if (!slackLease) return { ...base, status: "skipped", reason: "alert already queued or delivered" };
        }
        // Enqueueing can await I/O: recheck the destination immediately before transport.
        const finalApproval = approveSlackDestination(approved.canonicalUrl);
        if (finalApproval.status !== "approved") throw new Error("Slack destination is not approved");
        await ports.postSlack(finalApproval.canonicalUrl, buildQueuedSlackPayload(safePayload));
        if (slackLease && ports.slackDelivery
          && !await ports.slackDelivery.store.complete(slackLease.deliveryId, slackLease.lockToken)) {
          return { ...base, status: "failed", reason: "Alert delivery outcome could not be recorded." };
        }
        return { ...base, status: "delivered" };
      }
      case "in_app": {
        await ports.notifyInApp(finding);
        return { ...base, status: "delivered" };
      }
      case "whatsapp": {
        const recipient = typeof channel.config.to === "string" ? channel.config.to.trim() : "";
        if (!recipient) return { ...base, status: "skipped", reason: "no WhatsApp recipient configured" };
        if (!ports.postWhatsApp) {
          return { ...base, status: "skipped", reason: "Twilio WhatsApp is not configured" };
        }
        await ports.postWhatsApp(buildWhatsAppPayload(recipient, finding));
        return { ...base, status: "delivered" };
      }
    }
  } catch (error) {
    if (channel.type === "slack") {
      if (slackLease && ports.slackDelivery) {
        try { await ports.slackDelivery.store.fail(slackLease.deliveryId, slackLease.lockToken); }
        catch { /* The expired lease remains recoverable by the queue worker. */ }
      }
      return { ...base, status: "failed", reason: slackLease
        ? "Alert delivery failed. Retry scheduled." : "Slack alert delivery failed." };
    }
    return { ...base, status: "failed", reason: error instanceof Error ? error.message : "delivery error" };
  }
}
