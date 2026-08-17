// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  collectInstallationRepositories,
  diagnosticForStatus,
  GitHubApiError,
  githubRequest,
} from "./github-api";

const repository = {
  id: 101,
  owner: { login: "adtecher", id: 9001 },
  name: "portal",
  full_name: "adtecher/portal",
  html_url: "https://github.com/adtecher/portal",
  visibility: "private",
  archived: false,
  default_branch: "main",
  private: true,
};

function repositoryResponse(
  repositories: unknown[],
  options: { link?: string; status?: number } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.link) headers.set("Link", options.link);
  return new Response(JSON.stringify({ total_count: repositories.length, repositories }), {
    status: options.status ?? 200,
    headers,
  });
}

describe("bounded GitHub REST client", () => {
  it("encodes every path segment and uses only the installation token with fixed GitHub headers", async () => {
    const installationCredential = crypto.randomUUID();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await githubRequest({
      installationToken: installationCredential,
      pathSegments: ["repos", "owner name", "repo/name"],
      query: { state: "open alerts" },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner%20name/repo%2Fname?state=open+alerts",
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${installationCredential}`,
          "User-Agent": "ComplianceHub-GitHub-App",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("uses a 15-second timeout", async () => {
    const installationCredential = crypto.randomUUID();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await githubRequest({
      installationToken: installationCredential,
      pathSegments: ["installation", "repositories"],
      fetchImpl,
    });

    expect(timeout).toHaveBeenCalledWith(15_000);
    timeout.mockRestore();
  });

  it.each(["", ".", ".."])("rejects unsafe path segment %j before fetch", async (segment) => {
    const installationCredential = crypto.randomUUID();
    const fetchImpl = vi.fn();

    await expect(githubRequest({
      installationToken: installationCredential,
      pathSegments: ["repos", segment],
      fetchImpl,
    })).rejects.toThrow("Invalid GitHub request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps only recognised provider statuses to safe diagnostics", () => {
    expect([
      200, 400, 401, 403, 404, 409, 429, 500, 503,
    ].map((status) => [status, diagnosticForStatus(status)])).toEqual([
      [200, null],
      [400, null],
      [401, "permission_denied"],
      [403, "permission_denied"],
      [404, "not_found"],
      [409, null],
      [429, "rate_limited"],
      [500, "provider_unavailable"],
      [503, "provider_unavailable"],
    ]);
  });

  it("collects and sanitises installation repositories with per_page=100", async () => {
    const installationCredential = crypto.randomUUID();
    const fetchImpl = vi.fn().mockResolvedValue(repositoryResponse([repository]));

    const result = await collectInstallationRepositories({
      installationToken: installationCredential,
      fetchImpl,
    });

    expect(result).toEqual([{
      id: 101,
      owner: "adtecher",
      name: "portal",
      fullName: "adtecher/portal",
      htmlUrl: "https://github.com/adtecher/portal",
      visibility: "private",
      archived: false,
      defaultBranch: "main",
    }]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/installation/repositories?per_page=100",
    );
    expect(JSON.stringify(result)).not.toContain("9001");
  });

  it("follows an RFC 8288 next link only on the fixed GitHub API origin", async () => {
    const installationCredential = crypto.randomUUID();
    const secondRepository = {
      ...repository,
      id: 102,
      name: "api",
      full_name: "adtecher/api",
      html_url: "https://github.com/adtecher/api",
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(repositoryResponse([repository], {
        link: '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next", <https://api.github.com/installation/repositories?per_page=100&page=2>; rel="last"',
      }))
      .mockResolvedValueOnce(repositoryResponse([secondRepository]));

    const result = await collectInstallationRepositories({
      installationToken: installationCredential,
      fetchImpl,
    });

    expect(result.map((item) => item.id)).toEqual([101, 102]);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://api.github.com/installation/repositories?per_page=100&page=2",
    );
  });

  it("rejects a hostile next link", async () => {
    const installationCredential = crypto.randomUUID();
    const fetchImpl = vi.fn().mockResolvedValue(repositoryResponse([repository], {
      link: '<http://169.254.169.254/latest/meta-data>; rel="next"',
    }));

    await expect(collectInstallationRepositories({
      installationToken: installationCredential,
      fetchImpl,
    })).rejects.toThrow("GitHub returned an invalid repository response");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("caps pagination at 100 pages", async () => {
    const installationCredential = crypto.randomUUID();
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(repositoryResponse([], {
      link: '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"',
    })));

    await expect(collectInstallationRepositories({ installationToken: installationCredential, fetchImpl }))
      .rejects.toThrow("GitHub returned an invalid repository response");

    expect(fetchImpl).toHaveBeenCalledTimes(100);
  });

  it("rejects duplicate or non-canonical repository inventory", async () => {
    const installationCredential = crypto.randomUUID();
    for (const repositories of [
      [repository, repository],
      [{ ...repository, full_name: "adtecher/other" }],
      [{ ...repository, html_url: "https://example.test/adtecher/portal" }],
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(repositoryResponse(repositories));
      await expect(collectInstallationRepositories({ installationToken: installationCredential, fetchImpl }))
        .rejects.toThrow("GitHub returned an invalid repository response");
    }
  });

  it("surfaces a rate limit only as a safe diagnostic", async () => {
    const installationCredential = crypto.randomUUID();
    const responseDetail = "rate-limit-token-and-header-detail";
    const fetchImpl = vi.fn().mockResolvedValue(new Response(responseDetail, { status: 429 }));

    const error = await collectInstallationRepositories({
      installationToken: installationCredential,
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).toMatchObject({ diagnosticCode: "rate_limited" });
    expect(String(error)).not.toContain(responseDetail);
  });

  it("redacts installation tokens and malformed response bodies", async () => {
    const installationCredential = crypto.randomUUID();
    const responseDetail = "malformed-private-provider-body";
    const fetchImpl = vi.fn().mockResolvedValue(new Response(responseDetail, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const error = await collectInstallationRepositories({
      installationToken: installationCredential,
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(String(error)).toContain("GitHub returned an invalid repository response");
    expect(String(error)).not.toContain(installationCredential);
    expect(String(error)).not.toContain(responseDetail);
  });
});
