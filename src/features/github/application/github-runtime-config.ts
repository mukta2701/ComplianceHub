import "server-only";

import { resolveGitHubAccountType, type GitHubAccountType } from "./github-account-policy";

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

export type GitHubConnectionConfig = {
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
  allowedAccountId: number;
  allowedAccountType: GitHubAccountType;
};

const APP_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

function requiredValue(env: RuntimeEnvironment, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (!value) throw new GitHubRuntimeConfigError();
  return value;
}

export function getGitHubConnectionConfig(env: RuntimeEnvironment = process.env): GitHubConnectionConfig {
  try {
    const appId = requiredValue(env, "GITHUB_APP_ID");
    const appSlug = requiredValue(env, "GITHUB_APP_SLUG");
    if (!APP_SLUG_PATTERN.test(appSlug)) throw new GitHubRuntimeConfigError();
    const clientId = requiredValue(env, "GITHUB_APP_CLIENT_ID");
    const clientSecret = requiredValue(env, "GITHUB_APP_CLIENT_SECRET");
    const privateKey = requiredValue(env, "GITHUB_APP_PRIVATE_KEY");
    const webhookSecret = requiredValue(env, "GITHUB_WEBHOOK_SECRET");
    const accountId = Number(requiredValue(env, "GITHUB_ALLOWED_ACCOUNT_ID"));
    if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new GitHubRuntimeConfigError();
    const allowedAccountType = resolveGitHubAccountType({
      configuredType: env.GITHUB_ALLOWED_ACCOUNT_TYPE,
      nodeEnv: env.NODE_ENV,
      siteUrl: env.NEXT_PUBLIC_SITE_URL,
    });
    return { appId, appSlug, clientId, clientSecret, privateKey, webhookSecret, allowedAccountId: accountId, allowedAccountType };
  } catch (error) {
    if (error instanceof GitHubRuntimeConfigError) throw error;
    throw new GitHubRuntimeConfigError();
  }
}
