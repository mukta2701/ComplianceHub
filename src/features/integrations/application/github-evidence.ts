import "server-only";
import type { EvidenceSourceConnection } from "@/features/integrations/domain/evidence-provider";

function configValue(config: Record<string, unknown>, key: string) {
  const value = config[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`GitHub evidence source requires ${key}`);
  return value.trim();
}

function today(config: Record<string, unknown>) {
  const asOf = config.asOf;
  return typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}

export const githubEvidenceProvider = {
  async collect(connection: EvidenceSourceConnection, fetcher: typeof fetch = fetch) {
    const owner = configValue(connection.config, "owner");
    const repo = configValue(connection.config, "repo");
    if (!connection.accessToken) throw new Error("GitHub evidence source requires an access token");
    const response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?protected=true&per_page=100`, {
      headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
    });
    if (!response.ok) throw new Error(`GitHub evidence collection failed: ${response.status}`);
    const branches = await response.json() as { protected?: boolean }[];
    const collectedOn = today(connection.config);
    return [{
      externalRef: `github:${owner}/${repo}:protected-branches`, title: `GitHub protected branches: ${owner}/${repo}`, kind: "note" as const,
      note: `${branches.filter((branch) => branch.protected).length} protected branches reported. Repository contents and branch names were not collected.`,
      collectedOn, validUntil: addDays(collectedOn, 30),
    }];
  },
};
