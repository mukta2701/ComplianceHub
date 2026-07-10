import "server-only";
import type { EvidenceSourceConnection } from "@/features/integrations/domain/evidence-provider";

function today(config: Record<string, unknown>) {
  const asOf = config.asOf;
  return typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}

function collectionWindow(config: Record<string, unknown>) {
  const asOf = config.asOf;
  const end = typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? new Date(`${asOf}T23:59:59Z`) : new Date();
  const collectedOn = end.toISOString().slice(0, 10);
  return { collectedOn, start: addDays(collectedOn, -30), end: end.toISOString() };
}

export const googleWorkspaceEvidenceProvider = {
  async collect(connection: EvidenceSourceConnection, fetcher: typeof fetch = fetch) {
    const domain = connection.config.domain;
    if (typeof domain !== "string" || !domain.trim()) throw new Error("Google Workspace evidence source requires a domain");
    if (!connection.accessToken) throw new Error("Google Workspace evidence source requires an access token");
    const { collectedOn, start, end } = collectionWindow(connection.config);
    let count = 0;
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const params = new URLSearchParams({ startTime: `${start}T00:00:00Z`, endTime: end, maxResults: "100", fields: "items(id/time),nextPageToken" });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await fetcher(`https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/login?${params.toString()}`, { headers: { Authorization: `Bearer ${connection.accessToken}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Google Workspace evidence collection failed: ${response.status}`);
      const body = await response.json() as { items?: unknown[]; nextPageToken?: string };
      count += body.items?.length ?? 0;
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return [{
      externalRef: `google_workspace:${domain.trim()}:login-activity`, title: `Google Workspace login activity summary: ${domain.trim()}`, kind: "note" as const,
      note: `${count} login activity records were observed. User identities and event details were not retained.`, collectedOn, validUntil: addDays(collectedOn, 30),
    }];
  },
};
