import "server-only";

import { resolveGitHubAccountType } from "./github-account-policy";

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

export type GitHubConnectionConfig = {
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
  allowedAccountId: number;
  allowedAccountType: "Organization" | "User";
};

const APP_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

function connectionConfigError(): Error {
  return new Error("GitHub connection is not configured");
}

function requiredConnectionValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw connectionConfigError();
  return value;
}

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

export function getGitHubConnectionConfig(): GitHubConnectionConfig {
  try {
    const appId = requiredConnectionValue("GITHUB_APP_ID");
    const appSlug = requiredConnectionValue("GITHUB_APP_SLUG");
    const clientId = requiredConnectionValue("GITHUB_APP_CLIENT_ID");
    const clientSecret = requiredConnectionValue("GITHUB_APP_CLIENT_SECRET");
    const privateKey = requiredConnectionValue("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
    const webhookSecret = requiredConnectionValue("GITHUB_WEBHOOK_SECRET");
    const allowedAccountIdValue = requiredConnectionValue("GITHUB_ALLOWED_ACCOUNT_ID");
    const configuredAccountType = requiredConnectionValue("GITHUB_ALLOWED_ACCOUNT_TYPE");
    const allowedAccountId = Number(allowedAccountIdValue);

    if (
      !APP_SLUG.test(appSlug)
      || !/^[1-9][0-9]*$/.test(allowedAccountIdValue)
      || !Number.isSafeInteger(allowedAccountId)
    ) {
      throw connectionConfigError();
    }

    const allowedAccountType = resolveGitHubAccountType({
      configuredType: configuredAccountType,
      nodeEnv: process.env.NODE_ENV,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    });

    return {
      appId,
      appSlug,
      clientId,
      clientSecret,
      privateKey,
      webhookSecret,
      allowedAccountId,
      allowedAccountType,
    };
  } catch {
    throw connectionConfigError();
  }
}
