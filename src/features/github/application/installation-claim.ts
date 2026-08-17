import "server-only";

import { z } from "zod";

import type { GitHubAccountType } from "./github-account-policy";
import { READ_PERMISSIONS } from "./github-app-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type VerifiedInstallationClaim = {
  organisationId: string;
  actorId: string;
  requestedInstallationId: number;
  userInstallationIds: number[];
  appInstallation: {
    id: number;
    account: { id: number; login: string; type: "Organization" | "User" };
    repositorySelection: "all" | "selected";
    permissions: Record<string, string>;
    suspendedAt: string | null;
  };
  repositories: Array<{
    id: number;
    owner: string;
    name: string;
    fullName: string;
    htmlUrl: string;
    visibility: "public" | "private" | "internal";
    archived: boolean;
    defaultBranch: string;
  }>;
};

export type CanonicalInstallationClaim = {
  organisationId: string;
  actorId: string;
  requestedInstallationId: number;
  accountId: number;
  accountLogin: string;
  accountType: GitHubAccountType;
  repositorySelection: "selected";
  permissions: typeof READ_PERMISSIONS;
  repositories: VerifiedInstallationClaim["repositories"];
};

const safeId = z.number().int().positive().safe();
const login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/);
const repoName = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/).refine((name) => name !== "." && name !== "..");
const branchName = z.string().min(1).max(255).refine((name) => !/[\u0000-\u001f\u007f]/.test(name));

function failure(): Error {
  return new Error("GitHub installation verification failed");
}

function requiredAllowedAccountId(value: number | undefined): number {
  const parsed = safeId.safeParse(value ?? Number(process.env.GITHUB_ALLOWED_ACCOUNT_ID));
  if (!parsed.success) throw new Error("GitHub installation verification is not configured");
  return parsed.data;
}

function exactPermissions(value: Record<string, string>): value is typeof READ_PERMISSIONS {
  const expectedEntries = Object.entries(READ_PERMISSIONS).sort(([a], [b]) => a.localeCompare(b));
  const actualEntries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

function canonicalizeRepositories(
  repositories: VerifiedInstallationClaim["repositories"],
  accountLogin: string,
): VerifiedInstallationClaim["repositories"] {
  if (repositories.length > 100) throw failure();
  const ids = new Set<number>();
  const names = new Set<string>();
  return repositories.map((repository) => {
    const id = safeId.safeParse(repository.id);
    const owner = login.safeParse(repository.owner);
    const name = repoName.safeParse(repository.name);
    const defaultBranch = branchName.safeParse(repository.defaultBranch);
    const archived = z.boolean().safeParse(repository.archived);
    if (!id.success || !owner.success || !name.success || !defaultBranch.success || !archived.success) throw failure();
    if (owner.data.toLowerCase() !== accountLogin.toLowerCase()) throw failure();
    if (repository.fullName !== `${repository.owner}/${repository.name}`) throw failure();
    if (!(["public", "private", "internal"] as const).includes(repository.visibility)) throw failure();
    const canonicalName = `${owner.data}/${name.data}`;
    if (ids.has(id.data) || names.has(canonicalName.toLowerCase())) throw failure();
    ids.add(id.data);
    names.add(canonicalName.toLowerCase());
    return {
      id: id.data,
      owner: owner.data,
      name: name.data,
      fullName: canonicalName,
      htmlUrl: `https://github.com/${canonicalName}`,
      visibility: repository.visibility,
      archived: archived.data,
      defaultBranch: defaultBranch.data,
    };
  });
}

async function persistWithServiceRole(input: CanonicalInstallationClaim): Promise<string> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("claim_github_installation_server", {
    target_organisation_id: input.organisationId,
    target_actor_id: input.actorId,
    target_provider_installation_id: input.requestedInstallationId,
    target_account_id: input.accountId,
    target_account_login: input.accountLogin,
    target_account_type: input.accountType,
    target_repository_selection: input.repositorySelection,
    target_permissions: input.permissions,
    target_permissions_ok: true,
    target_repositories: input.repositories,
  });
  if (error || typeof data !== "string") throw new Error("claim failed");
  return data;
}

export async function claimInstallation(
  claim: VerifiedInstallationClaim,
  dependencies: {
    allowedAccountId?: number;
    allowedAccountType?: GitHubAccountType;
    persist?: (input: CanonicalInstallationClaim) => Promise<string>;
  } = {},
): Promise<string> {
  const allowedAccountId = requiredAllowedAccountId(dependencies.allowedAccountId);
  const allowedAccountType = dependencies.allowedAccountType ?? "Organization";
  try {
    const app = claim.appInstallation;
    if (!z.uuid().safeParse(claim.organisationId).success || !z.uuid().safeParse(claim.actorId).success) throw failure();
    if (!safeId.safeParse(claim.requestedInstallationId).success) throw failure();
    if (!claim.userInstallationIds.includes(claim.requestedInstallationId)) throw failure();
    if (app.id !== claim.requestedInstallationId) throw failure();
    if (app.repositorySelection !== "selected") throw failure();
    if (app.account.type !== allowedAccountType || app.account.id !== allowedAccountId) throw failure();
    if (app.suspendedAt !== null || !exactPermissions(app.permissions)) throw failure();
    const accountLogin = login.parse(app.account.login);
    const repositories = canonicalizeRepositories(claim.repositories, accountLogin);
    const canonical: CanonicalInstallationClaim = {
      organisationId: claim.organisationId,
      actorId: claim.actorId,
      requestedInstallationId: claim.requestedInstallationId,
      accountId: app.account.id,
      accountLogin,
      accountType: allowedAccountType,
      repositorySelection: "selected",
      permissions: READ_PERMISSIONS,
      repositories,
    };
    try {
      return await (dependencies.persist ?? persistWithServiceRole)(canonical);
    } catch {
      throw new Error("GitHub installation claim failed");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "GitHub installation claim failed") throw error;
    throw failure();
  }
}
