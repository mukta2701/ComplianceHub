// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { READ_PERMISSIONS } from "./github-app-auth";
import { readInstallationSnapshot } from "./github-installation-api";

function repositoryRow(id: number, name = `repo-${id}`) {
  return {
    id, owner: { login: "Adtecher" }, name, full_name: `Adtecher/${name}`,
    html_url: `https://github.com/Adtecher/${name}`, visibility: "private",
    archived: false, default_branch: "main",
  };
}

function installationBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 77, account: { id: 99, login: "Adtecher", type: "Organization" },
    repository_selection: "selected",
    permissions: { ...READ_PERMISSIONS },
    suspended_at: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), init);
}

const SNAPSHOT_INPUT = { installationId: 77, appJwt: "test-app-jwt", installationToken: "test-installation-token" };

describe("readInstallationSnapshot", () => {
  it("reads installation identity with the App JWT and repositories with the installation token", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(installationBody()))
      .mockResolvedValueOnce(jsonResponse({ total_count: 2, repositories: [repositoryRow(101), repositoryRow(102)] }));
    const snapshot = await readInstallationSnapshot({ ...SNAPSHOT_INPUT, fetchImpl });
    expect(snapshot).toMatchObject({
      installationId: 77,
      account: { id: 99, login: "Adtecher", type: "Organization" },
      repositorySelection: "selected",
      permissions: READ_PERMISSIONS,
      suspendedAt: null,
    });
    expect(snapshot.repositories.map((repository) => repository.id)).toEqual([101, 102]);
    expect(JSON.stringify(snapshot)).not.toContain("test-installation-token");
    expect(JSON.stringify(snapshot)).not.toContain("test-app-jwt");
    const [identityUrl, identityInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [repositoriesUrl, repositoriesInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(identityUrl).toBe("https://api.github.com/app/installations/77");
    expect((identityInit.headers as Record<string, string>).Authorization).toBe("Bearer test-app-jwt");
    expect(new URL(repositoriesUrl).pathname).toBe("/installation/repositories");
    expect((repositoriesInit.headers as Record<string, string>).Authorization).toBe("Bearer test-installation-token");
    for (const call of fetchImpl.mock.calls) {
      const url = new URL(call[0] as string);
      expect(url.origin).toBe("https://api.github.com");
      expect((call[1] as RequestInit).redirect).toBe("error");
      expect((call[1] as RequestInit).cache).toBe("no-store");
    }
  });

  it("follows repository pages and forces per_page", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(installationBody()))
      .mockResolvedValueOnce(jsonResponse(
        { total_count: 150, repositories: Array.from({ length: 100 }, (_, index) => repositoryRow(index + 1)) },
        { headers: { Link: '<https://api.github.com/installation/repositories?page=2>; rel="next"' } },
      ))
      .mockResolvedValueOnce(jsonResponse(
        { total_count: 150, repositories: Array.from({ length: 50 }, (_, index) => repositoryRow(index + 101)) },
      ));
    const snapshot = await readInstallationSnapshot({ ...SNAPSHOT_INPUT, fetchImpl });
    expect(snapshot.repositories).toHaveLength(150);
    expect(new URL((fetchImpl.mock.calls[2] as [string])[0]).searchParams.get("per_page")).toBe("100");
  });

  it("reports a suspended installation instead of failing", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(installationBody({ suspended_at: "2026-09-01T00:00:00.000Z" })))
      .mockResolvedValueOnce(jsonResponse({ total_count: 0, repositories: [] }));
    const snapshot = await readInstallationSnapshot({ ...SNAPSHOT_INPUT, fetchImpl });
    expect(snapshot.suspendedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it.each([
    ["revoked installation", 404, {}, "not_found"],
    ["rate-limited provider", 429, { "retry-after": "120" }, "rate_limited"],
    ["exhausted rate budget", 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1789000000" }, "rate_limited"],
    ["provider outage", 503, {}, "server"],
  ])("classifies %s without provider content", async (_label, status, headers, kind) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("upstream-body", { status, headers }));
    const error = await readInstallationSnapshot({ ...SNAPSHOT_INPUT, fetchImpl }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as { kind?: string }).kind).toBe(kind);
    expect(String(error)).not.toContain("upstream-body");
  });

  it("rejects malformed installation data and hostile pagination without leaking the body", async () => {
    const malformed = vi.fn().mockResolvedValue(jsonResponse({ id: 77, account: null }));
    await expect(readInstallationSnapshot({ ...SNAPSHOT_INPUT, fetchImpl: malformed })).rejects.toMatchObject({ kind: "invalid" });
    const hostile = vi.fn()
      .mockResolvedValueOnce(jsonResponse(installationBody()))
      .mockResolvedValueOnce(jsonResponse(
        { total_count: 2, repositories: [repositoryRow(101)] },
        { headers: { Link: '<https://attacker.example/steal>; rel="next"' } },
      ));
    await expect(readInstallationSnapshot({ ...SNAPSHOT_INPUT, fetchImpl: hostile })).rejects.toMatchObject({ kind: "invalid" });
  });

  it("times out a hanging provider instead of waiting forever", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    await expect(readInstallationSnapshot({ ...SNAPSHOT_INPUT, timeoutMs: 50, fetchImpl })).rejects.toMatchObject({ kind: "network" });
  });

  it("rejects invalid input without calling the provider", async () => {
    const fetchImpl = vi.fn();
    await expect(readInstallationSnapshot({ installationId: 0, appJwt: "test-app-jwt", installationToken: "test-installation-token", fetchImpl })).rejects.toMatchObject({ kind: "invalid" });
    await expect(readInstallationSnapshot({ installationId: 77, appJwt: "", installationToken: "test-installation-token", fetchImpl })).rejects.toMatchObject({ kind: "invalid" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
