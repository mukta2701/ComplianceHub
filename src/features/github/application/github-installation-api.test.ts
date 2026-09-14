// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { READ_PERMISSIONS } from "./github-app-auth";
import {
  GitHubInstallationApiError,
  readInstallationMetadata,
  readInstallationRepositories,
  readInstallationSnapshot,
} from "./github-installation-api";

const APP_CREDENTIAL = ["fictional", "app", "credential"].join("-");
const INSTALLATION_CREDENTIAL = ["fictional", "installation", "credential"].join("-");

function installation(overrides: Record<string, unknown> = {}) {
  return {
    id: 77,
    account: { id: 99, login: "Adtecher", type: "Organization" },
    repository_selection: "selected",
    permissions: { ...READ_PERMISSIONS },
    suspended_at: null,
    ...overrides,
  };
}

function repository(id: number, name = `repo-${id}`) {
  return {
    id,
    owner: { login: "Adtecher" },
    name,
    full_name: `Adtecher/${name}`,
    html_url: `https://github.com/Adtecher/${name}`,
    visibility: "private",
    archived: false,
    default_branch: "main",
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("readInstallationSnapshot", () => {
  it("offers separate metadata and repository reads while the public snapshot API composes them", async () => {
    const metadataFetch = vi.fn().mockResolvedValue(jsonResponse(installation()));
    const metadata = await readInstallationMetadata({
      installationId: 77,
      appJwt: APP_CREDENTIAL,
      fetchImpl: metadataFetch,
    });
    expect(metadata).toEqual({
      installationId: 77,
      account: { id: 99, login: "Adtecher", type: "Organization" },
      repositorySelection: "selected",
      permissions: READ_PERMISSIONS,
      suspendedAt: null,
    });
    expect(metadataFetch).toHaveBeenCalledOnce();

    const repositoryFetch = vi.fn().mockResolvedValue(jsonResponse({
      total_count: 1,
      repositories: [repository(101)],
    }));
    await expect(readInstallationRepositories({
      installationToken: INSTALLATION_CREDENTIAL,
      accountLogin: "Adtecher",
      fetchImpl: repositoryFetch,
    })).resolves.toEqual([expect.objectContaining({ id: 101 })]);
    expect(repositoryFetch).toHaveBeenCalledOnce();
  });

  it("uses the fixed API origin and version while keeping each credential on its required endpoint", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(installation()))
      .mockResolvedValueOnce(jsonResponse({ total_count: 2, repositories: [repository(102), repository(101)] }));

    const snapshot = await readInstallationSnapshot({
      installationId: 77,
      appJwt: APP_CREDENTIAL,
      installationToken: INSTALLATION_CREDENTIAL,
      fetchImpl,
    });

    expect(snapshot).toEqual({
      installationId: 77,
      account: { id: 99, login: "Adtecher", type: "Organization" },
      repositorySelection: "selected",
      permissions: READ_PERMISSIONS,
      suspendedAt: null,
      repositories: [
        expect.objectContaining({ id: 101, fullName: "Adtecher/repo-101" }),
        expect.objectContaining({ id: 102, fullName: "Adtecher/repo-102" }),
      ],
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(1,
      "https://api.github.com/app/installations/77",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: `Bearer ${APP_CREDENTIAL}`,
          "X-GitHub-Api-Version": "2026-03-10",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(2,
      "https://api.github.com/installation/repositories?per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${INSTALLATION_CREDENTIAL}` }),
      }),
    );
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).join(" ")).not.toContain(APP_CREDENTIAL);
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).join(" ")).not.toContain(INSTALLATION_CREDENTIAL);
  });

  it("accepts exactly 100 complete pages and 10,000 unique repositories", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(installation()));
    for (let page = 1; page <= 100; page += 1) {
      const firstId = (page - 1) * 100 + 1;
      const headers = page < 100
        ? { Link: `<https://api.github.com/installation/repositories?page=${page + 1}&per_page=1>; rel="next"` }
        : undefined;
      fetchImpl.mockResolvedValueOnce(jsonResponse({
        total_count: 10_000,
        repositories: Array.from({ length: 100 }, (_, index) => repository(firstId + index)),
      }, { headers }));
    }

    const snapshot = await readInstallationSnapshot({
      installationId: 77,
      appJwt: APP_CREDENTIAL,
      installationToken: INSTALLATION_CREDENTIAL,
      fetchImpl,
    });

    expect(snapshot.repositories).toHaveLength(10_000);
    expect(snapshot.repositories[0]?.id).toBe(1);
    expect(snapshot.repositories[9_999]?.id).toBe(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(101);
    expect(fetchImpl.mock.calls.at(-1)?.[0]).toBe(
      "https://api.github.com/installation/repositories?page=100&per_page=100",
    );
  });

  it.each([
    {
      label: "a changing total",
      pages: [
        jsonResponse({ total_count: 101, repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)) }, { headers: { Link: '<https://api.github.com/installation/repositories?page=2>; rel="next"' } }),
        jsonResponse({ total_count: 102, repositories: [repository(101)] }),
      ],
    },
    {
      label: "a duplicate provider id",
      pages: [jsonResponse({ total_count: 2, repositories: [repository(101), repository(101, "renamed")] })],
    },
    {
      label: "a duplicate canonical name",
      pages: [jsonResponse({ total_count: 2, repositories: [repository(101), repository(102, "repo-101")] })],
    },
    {
      label: "a mismatched canonical identity",
      pages: [jsonResponse({ total_count: 1, repositories: [{ ...repository(101), full_name: "Other/repo-101" }] })],
    },
    {
      label: "an incomplete final page",
      pages: [jsonResponse({ total_count: 2, repositories: [repository(101)] })],
    },
  ])("rejects provider inventory containing $label", async ({ pages }) => {
    const providerDetail = crypto.randomUUID();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ...installation(), provider_detail: providerDetail }));
    pages.forEach((response) => fetchImpl.mockResolvedValueOnce(response));

    const error = await readInstallationSnapshot({
      installationId: 77,
      appJwt: APP_CREDENTIAL,
      installationToken: INSTALLATION_CREDENTIAL,
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ diagnosticCode: "invalid_response" });
    expect(String(error)).not.toContain(providerDetail);
  });

  it.each([
    "https://evil.example/installation/repositories?page=2",
    "https://api.github.com/user/installations/77/repositories?page=2",
    "https://api.github.com/installation/repositories?page=2&access_token=secret-value",
    "https://user:password@api.github.com/installation/repositories?page=2",
    "https://api.github.com/installation/repositories?page=1",
    "https://api.github.com/installation/repositories?page=2&page=3",
  ])("rejects an untrusted continuation without requesting it (%s)", async (continuation) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(installation()))
      .mockResolvedValueOnce(jsonResponse({
        total_count: 101,
        repositories: Array.from({ length: 100 }, (_, index) => repository(index + 1)),
      }, { headers: { Link: `<${continuation}>; rel="next"` } }));

    await expect(readInstallationSnapshot({
      installationId: 77,
      appJwt: APP_CREDENTIAL,
      installationToken: INSTALLATION_CREDENTIAL,
      fetchImpl,
    })).rejects.toMatchObject({ diagnosticCode: "invalid_response" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "authentication_failed"],
    [403, "authentication_failed"],
    [404, "not_found"],
    [500, "provider_failure"],
    [503, "provider_failure"],
  ] as const)("classifies HTTP %s without exposing provider content", async (status, diagnosticCode) => {
    const providerBody = crypto.randomUUID();
    const error = await readInstallationSnapshot({
      installationId: 77,
      appJwt: APP_CREDENTIAL,
      installationToken: INSTALLATION_CREDENTIAL,
      fetchImpl: vi.fn().mockResolvedValue(new Response(providerBody, { status })),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubInstallationApiError);
    expect(error).toMatchObject({ diagnosticCode });
    expect(String(error)).not.toContain(providerBody);
    expect(String(error)).not.toContain(APP_CREDENTIAL);
  });

  it("classifies request timeout separately from other temporary provider failures", async () => {
    const error = await readInstallationSnapshot({
      installationId: 77,
      appJwt: APP_CREDENTIAL,
      installationToken: INSTALLATION_CREDENTIAL,
      fetchImpl: vi.fn().mockRejectedValue(new DOMException("fictional detail", "TimeoutError")),
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ diagnosticCode: "timeout" });
    expect(String(error)).not.toContain("fictional detail");
  });

  it.each(["AbortError", "TimeoutError"])(
    "preserves %s when installation response body decoding is aborted",
    async (name) => {
      const providerDetail = crypto.randomUUID();
      const response = jsonResponse(installation());
      vi.spyOn(response, "json").mockRejectedValue(new DOMException(providerDetail, name));

      const error = await readInstallationMetadata({
        installationId: 77,
        appJwt: APP_CREDENTIAL,
        fetchImpl: vi.fn().mockResolvedValue(response),
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(GitHubInstallationApiError);
      expect(error).toMatchObject({ diagnosticCode: "timeout" });
      expect(String(error)).not.toContain(providerDetail);
    },
  );

  it("combines one reconciliation deadline with each metadata and repository request timeout", async () => {
    const deadline = new AbortController();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(installation()))
      .mockResolvedValueOnce(jsonResponse({ total_count: 1, repositories: [repository(101)] }));

    await readInstallationSnapshot({
      installationId: 77,
      appJwt: APP_CREDENTIAL,
      installationToken: INSTALLATION_CREDENTIAL,
      signal: deadline.signal,
      fetchImpl,
    });

    const requestSignals = fetchImpl.mock.calls.map((call) => (call[1] as RequestInit).signal);
    expect(requestSignals).toHaveLength(2);
    expect(requestSignals.every((signal) => signal !== deadline.signal)).toBe(true);
    deadline.abort(new DOMException("deadline", "TimeoutError"));
    expect(requestSignals.every((signal) => signal?.aborted)).toBe(true);
  });

  it("surfaces only a bounded canonical rate-limit reset time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"));
    try {
      const error = await readInstallationSnapshot({
        installationId: 77,
        appJwt: APP_CREDENTIAL,
        installationToken: INSTALLATION_CREDENTIAL,
        fetchImpl: vi.fn().mockResolvedValue(new Response(crypto.randomUUID(), {
          status: 429,
          headers: { "retry-after": "60", "x-ratelimit-reset": "1789388100" },
        })),
      }).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        diagnosticCode: "rate_limited",
        retryAt: "2026-09-14T12:15:00.000Z",
      });
      expect(JSON.stringify(error)).not.toContain(APP_CREDENTIAL);
      expect(JSON.stringify(error)).not.toContain(INSTALLATION_CREDENTIAL);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    installation({ permissions: { ...READ_PERMISSIONS, contents: "read" } }),
    installation({ permissions: { ...READ_PERMISSIONS, actions: "write" } }),
    installation({ repository_selection: "all" }),
  ])("rejects changed access before repository discovery", async (providerInstallation) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(providerInstallation));

    await expect(readInstallationSnapshot({
      installationId: 77,
      appJwt: APP_CREDENTIAL,
      installationToken: INSTALLATION_CREDENTIAL,
      fetchImpl,
    })).rejects.toMatchObject({ diagnosticCode: "permission_mismatch" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
