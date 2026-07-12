import type { CheckSeverity } from "../domain/monitor-provider";

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

const SEVERITY_EMOJI: Record<CheckSeverity, string> = { low: "🔵", medium: "🟡", high: "🟠", critical: "🔴" };

// Slack Block Kit payload — a compact alert card. Kept pure so the exact blocks
// are asserted in tests without hitting the webhook.
export function buildSlackPayload(finding: AlertFinding): {
  text: string;
  blocks: unknown[];
} {
  const emoji = SEVERITY_EMOJI[finding.severity];
  const heading = `${emoji} ComplianceHub alert — ${finding.severity.toUpperCase()}`;
  const text = `${heading}: ${finding.title} (${finding.controlRef} · ${finding.subjectId})`;
  return {
    text, // notification fallback
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${heading}*\n${finding.title}` } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Control:*\n${finding.controlRef}` },
          { type: "mrkdwn", text: `*Subject:*\n${finding.subjectId}` },
        ],
      },
      { type: "section", text: { type: "mrkdwn", text: finding.detail } },
      { type: "context", elements: [{ type: "mrkdwn", text: "Detected by ComplianceHub continuous monitoring" }] },
    ],
  };
}

// Side-effecting adapters, injected by the cron so this stays unit-testable.
export type DeliverPorts = {
  // Fire the Slack incoming-webhook. Throws on a non-2xx response.
  postSlack: (webhookUrl: string, payload: unknown) => Promise<void>;
  // Write the in-app notification(s) for this finding (recipient resolution +
  // idempotent upsert live in the orchestrator, which owns the DB handle).
  notifyInApp: (finding: AlertFinding) => Promise<void>;
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
  try {
    switch (channel.type) {
      case "slack": {
        const webhookUrl = typeof channel.config.webhookUrl === "string" ? channel.config.webhookUrl : "";
        if (!webhookUrl) return { ...base, status: "skipped", reason: "no webhookUrl configured" };
        await ports.postSlack(webhookUrl, buildSlackPayload(finding));
        return { ...base, status: "delivered" };
      }
      case "in_app": {
        await ports.notifyInApp(finding);
        return { ...base, status: "delivered" };
      }
      case "whatsapp":
        // Phase 2 (Twilio). Stubbed so a WhatsApp channel is inert, not an error.
        return { ...base, status: "skipped", reason: "whatsapp delivery not implemented (Phase 2)" };
    }
  } catch (error) {
    return { ...base, status: "failed", reason: error instanceof Error ? error.message : "delivery error" };
  }
}
