import "server-only";
import type { EvidenceSourceConnection } from "@/features/integrations/domain/evidence-provider";

function today(config: Record<string, unknown>) {
  const asOf = config.asOf;
  return typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}

export const googleWorkspaceEvidenceProvider = {
  async collect(connection: EvidenceSourceConnection, fetcher: typeof fetch = fetch) {
    const domain = connection.config.domain;
    if (typeof domain !== "string" || !domain.trim()) throw new Error("Google Workspace evidence source requires a domain");
    if (!connection.accessToken) throw new Error("Google Workspace evidence source requires an access token");
    const collectedOn = today(connection.config);
    const start = addDays(collectedOn, -30);
    const response = await fetcher(`https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/login?startTime=${start}T00%3A00%3A00Z&endTime=${collectedOn}T23%3A59%3A59Z&maxResults=100`, { headers: { Authorization: `Bearer ${connection.accessToken}` } });
    if (!response.ok) throw new Error(`Google Workspace evidence collection failed: ${response.status}`);
    const body = await response.json() as { items?: unknown[] };
    const count = body.items?.length ?? 0;
    return [{
      externalRef: `google_workspace:${domain.trim()}:login-activity`, title: `Google Workspace login activity summary: ${domain.trim()}`, kind: "note" as const,
      note: `${count} login activity records were observed. User identities and event details were not retained.`, collectedOn, validUntil: addDays(collectedOn, 30),
    }];
  },
};
