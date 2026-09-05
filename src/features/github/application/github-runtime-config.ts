import "server-only";

type RuntimeEnvironment = Record<string, string | undefined>;

export class GitHubRuntimeConfigError extends Error {
  constructor() {
    super("GitHub collection is not configured");
    this.name = "GitHubRuntimeConfigError";
  }
}

export type GitHubRuntimeConfig = {
  appId: string;
  privateKey: string;
  approvedSecurityWorkflowIds: number[];
};

export type GitHubRuntimeReadiness = {
  available: boolean;
  status: "ready" | "unavailable";
};

function parseApprovedSecurityWorkflowIds(value: string | undefined): number[] {
  const values = (value ?? "").split(",").map((item) => item.trim());
  if (values.length < 1 || values.length > 20 || values.some((item) => !/^[1-9][0-9]*$/.test(item))) {
    throw new GitHubRuntimeConfigError();
  }
  const ids = values.map(Number);
  if (ids.some((item) => !Number.isSafeInteger(item)) || new Set(ids).size !== ids.length) {
    throw new GitHubRuntimeConfigError();
  }
  return ids;
}

export function readGitHubRuntimeConfig(env: RuntimeEnvironment = process.env): GitHubRuntimeConfig {
  const appId = env.GITHUB_APP_ID?.trim() ?? "";
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.trim() ?? "";
  if (!appId || !privateKey) throw new GitHubRuntimeConfigError();
  return { appId, privateKey, approvedSecurityWorkflowIds: parseApprovedSecurityWorkflowIds(env.GITHUB_APPROVED_SECURITY_WORKFLOW_IDS) };
}

export function getGitHubRuntimeReadiness(env: RuntimeEnvironment = process.env): GitHubRuntimeReadiness {
  try {
    readGitHubRuntimeConfig(env);
    return { available: true, status: "ready" };
  } catch {
    return { available: false, status: "unavailable" };
  }
}
