import "server-only";

import { z } from "zod";

import type { DiagnosticCode } from "@/features/github/domain/observation";

type FetchLike = typeof fetch;

const API_ORIGIN = "https://api.github.com";
const API_ROOT = `${API_ORIGIN}/`;
const MAX_PAGES = 100;

const requestSchema = z.object({
  installationToken: z.string().min(1),
  pathSegments: z.array(z.string().min(1).max(500)).min(1).max(20)
    .refine((segments) => segments.every((segment) => segment !== "." && segment !== "..")),
  query: z.record(z.string().min(1).max(100), z.string().max(2_000)).optional(),
}).strict();

const repositorySchema = z.object({
  id: z.number().int().positive().safe(),
  owner: z.object({ login: z.string().min(1).max(255) }).passthrough(),
  name: z.string().min(1).max(255),
  full_name: z.string().min(3).max(511),
  html_url: z.string().url().max(2_000),
  visibility: z.enum(["public", "private", "internal"]),
  archived: z.boolean(),
  default_branch: z.string().min(1).max(255),
}).passthrough();

const repositoriesResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(repositorySchema).max(100),
}).strict();

export type GitHubRepository = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  visibility: "public" | "private" | "internal";
  archived: boolean;
  defaultBranch: string;
};

export class GitHubApiError extends Error {
  constructor(public readonly diagnosticCode: DiagnosticCode) {
    super("GitHub request failed");
    this.name = "GitHubApiError";
  }
}

export function diagnosticForStatus(status: number): DiagnosticCode | null {
  if (status === 401 || status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return null;
}

function requestInit(installationToken: string): RequestInit {
  return {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${installationToken}`,
      "User-Agent": "ComplianceHub-GitHub-App",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  };
}

async function fetchGitHubUrl(input: {
  url: URL;
  installationToken: string;
  fetchImpl: FetchLike;
}): Promise<Response> {
  if (
    input.url.origin !== API_ORIGIN
    || input.url.username
    || input.url.password
    || input.url.hash
  ) {
    throw new Error("Invalid GitHub request");
  }

  try {
    return await input.fetchImpl(input.url.toString(), requestInit(input.installationToken));
  } catch (error) {
    if (error instanceof GitHubApiError) throw error;
    throw new GitHubApiError("provider_unavailable");
  }
}

export async function githubRequest(input: {
  installationToken: string;
  pathSegments: readonly string[];
  query?: Record<string, string>;
  fetchImpl?: FetchLike;
}): Promise<Response> {
  const parsed = requestSchema.safeParse({
    installationToken: input.installationToken,
    pathSegments: input.pathSegments,
    query: input.query,
  });
  if (!parsed.success) throw new Error("Invalid GitHub request");

  const encodedPath = parsed.data.pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
  const url = new URL(encodedPath, API_ROOT);
  for (const [key, value] of Object.entries(parsed.data.query ?? {})) {
    url.searchParams.append(key, value);
  }

  return fetchGitHubUrl({
    url,
    installationToken: parsed.data.installationToken,
    fetchImpl: input.fetchImpl ?? fetch,
  });
}

function nextLink(linkHeader: string | null): URL | null {
  if (!linkHeader) return null;

  const entries = linkHeader.matchAll(/<([^>]*)>((?:\s*;\s*[^,]*)?)(?:,|$)/g);
  for (const entry of entries) {
    const parameters = entry[2] ?? "";
    const relation = /(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;\s,]+))/i.exec(parameters);
    const relations = (relation?.[1] ?? relation?.[2] ?? "").split(/\s+/);
    if (!relations.includes("next")) continue;

    try {
      const url = new URL(entry[1] ?? "");
      if (url.origin !== API_ORIGIN || url.username || url.password || url.hash) {
        throw new Error("GitHub returned an invalid repository response");
      }
      url.searchParams.set("per_page", "100");
      return url;
    } catch {
      throw new Error("GitHub returned an invalid repository response");
    }
  }

  return null;
}

export async function collectInstallationRepositories(input: {
  installationToken: string;
  fetchImpl?: FetchLike;
}): Promise<GitHubRepository[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response = await githubRequest({
    installationToken: input.installationToken,
    pathSegments: ["installation", "repositories"],
    query: { per_page: "100" },
    fetchImpl,
  });
  const repositories: GitHubRepository[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (!response.ok) {
      throw new GitHubApiError(diagnosticForStatus(response.status) ?? "invalid_response");
    }

    let parsed: z.infer<typeof repositoriesResponseSchema>;
    try {
      parsed = repositoriesResponseSchema.parse(await response.json());
    } catch {
      throw new Error("GitHub returned an invalid repository response");
    }

    for (const item of parsed.repositories) {
      const fullName = `${item.owner.login}/${item.name}`;
      if (item.full_name !== fullName || item.html_url !== `https://github.com/${fullName}`) {
        throw new Error("GitHub returned an invalid repository response");
      }
      if (
        repositories.some((repository) => repository.id === item.id)
        || repositories.some((repository) => repository.fullName.toLowerCase() === fullName.toLowerCase())
        || repositories.length >= 100
      ) {
        throw new Error("GitHub returned an invalid repository response");
      }
      repositories.push({
        id: item.id,
        owner: item.owner.login,
        name: item.name,
        fullName,
        htmlUrl: `https://github.com/${fullName}`,
        visibility: item.visibility,
        archived: item.archived,
        defaultBranch: item.default_branch,
      });
    }

    const next = nextLink(response.headers.get("Link"));
    if (!next) break;
    if (page === MAX_PAGES - 1) {
      throw new Error("GitHub returned an invalid repository response");
    }
    response = await fetchGitHubUrl({
      url: next,
      installationToken: input.installationToken,
      fetchImpl,
    });
  }

  return repositories;
}
