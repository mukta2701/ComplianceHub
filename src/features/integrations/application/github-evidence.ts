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
    let protectedCount = 0;
    for (let page = 1; page <= 5; page += 1) {
      const response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?protected=true&per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" }, signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`GitHub evidence collection failed: ${response.status}`);
      const branches = await response.json() as { protected?: boolean }[];
      protectedCount += branches.filter((branch) => branch.protected).length;
      if (branches.length < 100) break;
    }
    const collectedOn = today(connection.config);
    return [{
      externalRef: `github:${owner}/${repo}:protected-branches`, title: `GitHub protected branches: ${owner}/${repo}`, kind: "note" as const,
      note: `${protectedCount} protected branches reported. Repository contents and branch names were not collected.`,
      collectedOn, validUntil: addDays(collectedOn, 30),
    }];
  },
};
