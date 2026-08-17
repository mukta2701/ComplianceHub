// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import completeFixture from "./fixtures/repository-complete.json";
import deniedFixture from "./fixtures/repository-denied.json";
import unlicensedFixture from "./fixtures/repository-unlicensed.json";
import {
  collectRepositoryFacts,
  GitHubCollectionError,
  GitHubRateLimitError,
} from "./collect-repository-facts";

type FixtureKey = Exclude<keyof typeof completeFixture, "metadata">;

const target = { repositoryId: 101, owner: "adtecher", name: "portal" };
const installationCredential = crypto.randomUUID();

const routeFor = (url: URL): FixtureKey | "metadata" => {
  if (url.pathname === "/repos/adtecher/portal") return "metadata";
  if (url.pathname.endsWith("/rules/branches/main")) return "rules";
  if (url.pathname.endsWith("/branches/main/protection")) return "protection";
  if (url.pathname.endsWith("/dependabot/alerts")) return "dependabot";
  if (url.pathname.endsWith("/code-scanning/alerts")) {
    return url.searchParams.get("severity") === "critical" ? "codeScanningCritical" : "codeScanningHigh";
  }
  if (url.pathname.endsWith("/secret-scanning/alerts")) return "secretAlerts";
  if (url.pathname.endsWith("/actions/workflows")) return "workflows";
  if (url.pathname.endsWith("/actions/workflows/31/runs")) return "workflowRuns";
  if (url.pathname.endsWith("/collaborators")) return "collaborators";
  throw new Error(`Unexpected test URL: ${url.pathname}`);
};

function fixtureFetch(overrides: Partial<Record<FixtureKey | "metadata", Response>> = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const key = routeFor(url);
    if (overrides[key]) return overrides[key].clone();
    return Response.json(completeFixture[key]);
  });
}

function collect(fetchImpl: typeof fetch, approvedSecurityWorkflowIds: readonly number[] = [31]) {
  return collectRepositoryFacts({
    installationToken: installationCredential,
    repository: target,
    approvedSecurityWorkflowIds,
    fetchImpl,
  });
}

describe("collectRepositoryFacts", () => {
  it("collects exact allowlisted endpoints and returns only sanitised facts", async () => {
    const fetchImpl = fixtureFetch();

    const facts = await collect(fetchImpl);

    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.github.com/repos/adtecher/portal",
      "https://api.github.com/repos/AdTecher/Portal/rules/branches/main?per_page=100",
      "https://api.github.com/repos/AdTecher/Portal/branches/main/protection",
      "https://api.github.com/repos/AdTecher/Portal/dependabot/alerts?state=open&severity=high%2Ccritical&per_page=100",
      "https://api.github.com/repos/AdTecher/Portal/code-scanning/alerts?state=open&severity=high&per_page=100",
      "https://api.github.com/repos/AdTecher/Portal/code-scanning/alerts?state=open&severity=critical&per_page=100",
      "https://api.github.com/repos/AdTecher/Portal/secret-scanning/alerts?state=open&per_page=100",
      "https://api.github.com/repos/AdTecher/Portal/actions/workflows?per_page=100",
      "https://api.github.com/repos/AdTecher/Portal/actions/workflows/31/runs?branch=main&status=completed&per_page=1",
      "https://api.github.com/repos/AdTecher/Portal/collaborators?affiliation=outside&permission=admin&per_page=100",
    ]);
    expect(facts).toEqual({
      repository: {
        id: 101,
        owner: "AdTecher",
        name: "Portal",
        visibility: "private",
        archived: false,
        defaultBranch: "main",
        url: "https://github.com/AdTecher/Portal",
      },
      branchProtection: {
        state: "available",
        value: {
          forcePushesBlocked: true,
          deletionsBlocked: true,
          approvingReviews: 2,
          dismissesStaleReviews: true,
          codeOwnerReviews: true,
          requiredStatusChecks: ["build", "lint", "test"],
        },
      },
      dependabot: { state: "available", value: { openHigh: 1, openCritical: 1 } },
      codeScanning: { state: "available", value: { openHigh: 1, openCritical: 1 } },
      secretScanningConfiguration: { state: "available", value: { enabled: true } },
      secretScanningPushProtection: { state: "available", value: { enabled: true } },
      secretScanningAlerts: { state: "available", value: { openAlerts: 1 } },
      securityWorkflows: {
        state: "available",
        value: [{ name: "CodeQL", approved: true, active: true, latestConclusion: "success" }],
      },
      administration: { state: "available", value: { outsideCollaboratorAdmins: 1 } },
    });
    expect(JSON.stringify(facts)).not.toContain(installationCredential);
    expect(JSON.stringify(facts)).not.toMatch(/private-user|provider\.example|private\.key/i);
    expect(fetchImpl.mock.calls.every(([input]) => !String(input).includes("/contents"))).toBe(true);
  });

  it("accepts canonical rename and case refresh only when the numeric repository ID matches", async () => {
    const fetchImpl = fixtureFetch();
    await expect(collect(fetchImpl)).resolves.toMatchObject({
      repository: { id: 101, owner: "AdTecher", name: "Portal" },
    });

    const mismatched = fixtureFetch({
      metadata: Response.json({ ...completeFixture.metadata, id: 102 }),
    });
    await expect(collect(mismatched)).rejects.toMatchObject({ diagnosticCode: "invalid_response" });
    expect(mismatched).toHaveBeenCalledOnce();
  });

  it("keeps secret configuration, push protection, and alert availability independent", async () => {
    const fetchImpl = fixtureFetch({
      metadata: Response.json({
        ...completeFixture.metadata,
        security_and_analysis: {
          secret_scanning: { status: "disabled" },
          secret_scanning_push_protection: null,
        },
      }),
      secretAlerts: new Response(JSON.stringify(unlicensedFixture.body), { status: unlicensedFixture.status }),
    });

    const facts = await collect(fetchImpl);

    expect(facts.secretScanningConfiguration).toEqual({ state: "available", value: { enabled: false } });
    expect(facts.secretScanningPushProtection).toEqual({ state: "unavailable", diagnosticCode: "feature_unavailable" });
    expect(facts.secretScanningAlerts).toEqual({ state: "unavailable", diagnosticCode: "feature_unavailable" });
  });

  it.each([
    { name: "missing security metadata", securityAndAnalysis: undefined },
    { name: "null security metadata", securityAndAnalysis: null },
    { name: "missing recognised fields", securityAndAnalysis: {} },
    {
      name: "null recognised fields",
      securityAndAnalysis: { secret_scanning: null, secret_scanning_push_protection: null },
    },
  ])("maps $name to feature-unavailable secret facts", async ({ securityAndAnalysis }) => {
    const metadata = { ...completeFixture.metadata } as Record<string, unknown>;
    if (securityAndAnalysis === undefined) delete metadata.security_and_analysis;
    else metadata.security_and_analysis = securityAndAnalysis;

    const facts = await collect(fixtureFetch({ metadata: Response.json(metadata) }));

    expect(facts.secretScanningConfiguration).toEqual({
      state: "unavailable",
      diagnosticCode: "feature_unavailable",
    });
    expect(facts.secretScanningPushProtection).toEqual({
      state: "unavailable",
      diagnosticCode: "feature_unavailable",
    });
  });

  it("maps malformed recognised secret status values to invalid_response without aborting metadata", async () => {
    const facts = await collect(fixtureFetch({
      metadata: Response.json({
        ...completeFixture.metadata,
        security_and_analysis: {
          secret_scanning: { status: "provider-added-state" },
          secret_scanning_push_protection: { enabled: true },
        },
      }),
    }));

    expect(facts.secretScanningConfiguration).toEqual({
      state: "unavailable",
      diagnosticCode: "invalid_response",
    });
    expect(facts.secretScanningPushProtection).toEqual({
      state: "unavailable",
      diagnosticCode: "invalid_response",
    });
  });

  it.each([
    {
      name: "429",
      response: new Response("private-body", { status: 429, headers: { "retry-after": "12" } }),
      expected: { retryAfterSeconds: 12 },
    },
    {
      name: "Retry-After",
      response: new Response("private-body", { status: 503, headers: { "retry-after": "7" } }),
      expected: { retryAfterSeconds: 7 },
    },
    {
      name: "exhausted primary limit",
      response: new Response("private-body", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1786971600" },
      }),
      expected: { resetAtEpochSeconds: 1786971600 },
    },
  ])("stops immediately on $name rate-limit evidence before endpoint semantics", async ({ response, expected }) => {
    const fetchImpl = fixtureFetch({ dependabot: response });

    const error = await collect(fetchImpl).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect(error).toMatchObject({ diagnosticCode: "rate_limited", ...expected });
    expect(String(error)).not.toContain("private-body");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("maps endpoint failures without exposing response bodies", async () => {
    const denied = new Response(JSON.stringify(deniedFixture.body), { status: deniedFixture.status });
    const facts = await collect(fixtureFetch({
      rules: denied,
      protection: new Response("not protected", { status: 404 }),
      codeScanningHigh: denied,
      secretAlerts: new Response(JSON.stringify(unlicensedFixture.body), { status: 404 }),
      collaborators: new Response("provider down private body", { status: 503 }),
    }));

    expect(facts.branchProtection).toEqual({ state: "unavailable", diagnosticCode: "permission_denied" });
    expect(facts.codeScanning).toEqual({ state: "unavailable", diagnosticCode: "feature_unavailable" });
    expect(facts.secretScanningAlerts).toEqual({ state: "unavailable", diagnosticCode: "feature_unavailable" });
    expect(facts.administration).toEqual({ state: "unavailable", diagnosticCode: "provider_unavailable" });
    expect(JSON.stringify(facts)).not.toMatch(/credential|private-location|private body|private\.key/i);
  });

  it("treats classic branch-protection 404 as empty protection after identity verification", async () => {
    const facts = await collect(fixtureFetch({
      rules: Response.json([]),
      protection: new Response("not protected", { status: 404 }),
    }));

    expect(facts.branchProtection).toEqual({
      state: "available",
      value: {
        forcePushesBlocked: false,
        deletionsBlocked: false,
        approvingReviews: 0,
        dismissesStaleReviews: false,
        codeOwnerReviews: false,
        requiredStatusChecks: [],
      },
    });
  });

  it.each([
    { missing: "allow_force_pushes", protection: { allow_deletions: { enabled: false } } },
    { missing: "allow_deletions", protection: { allow_force_pushes: { enabled: false } } },
    {
      missing: "non-null force-push control",
      protection: { allow_force_pushes: null, allow_deletions: { enabled: false } },
    },
    {
      missing: "non-null deletion control",
      protection: { allow_force_pushes: { enabled: false }, allow_deletions: null },
    },
  ])("rejects classic 200 protection missing $missing", async ({ protection }) => {
    const facts = await collect(fixtureFetch({ protection: Response.json(protection) }));

    expect(facts.branchProtection).toEqual({
      state: "unavailable",
      diagnosticCode: "invalid_response",
    });
  });

  it("rejects malformed recognised rules while ignoring unknown future rule types", async () => {
    const malformed = await collect(fixtureFetch({
      rules: Response.json([{ type: "pull_request", parameters: { provider_added_field: true } }]),
    }));
    expect(malformed.branchProtection).toEqual({ state: "unavailable", diagnosticCode: "invalid_response" });

    const future = await collect(fixtureFetch({
      rules: Response.json([{ type: "future_rule", parameters: { anything: true } }]),
      protection: new Response("none", { status: 404 }),
    }));
    expect(future.branchProtection).toMatchObject({ state: "available" });
  });

  it("discards atomic code-scanning counts and truncated list counts", async () => {
    const truncatedHeaders = {
      Link: '<https://api.github.com/repos/adtecher/portal/dependabot/alerts?page=101>; rel="next"',
    };
    const fetchImpl = fixtureFetch({
      dependabot: new Response(JSON.stringify(completeFixture.dependabot), { status: 200, headers: truncatedHeaders }),
      codeScanningCritical: new Response("bad", { status: 503 }),
    });

    const facts = await collectRepositoryFacts({
      installationToken: installationCredential,
      repository: target,
      approvedSecurityWorkflowIds: [31],
      fetchImpl,
      maxPagesPerEndpoint: 1,
    });

    expect(facts.dependabot).toEqual({ state: "unavailable", diagnosticCode: "invalid_response" });
    expect(facts.codeScanning).toEqual({ state: "unavailable", diagnosticCode: "provider_unavailable" });
  });

  it("follows only a bounded RFC 8288 next page on the same endpoint", async () => {
    const baseFetch = fixtureFetch();
    let dependabotPages = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.pathname.endsWith("/dependabot/alerts")) {
        dependabotPages += 1;
        if (dependabotPages === 1) {
          return new Response(JSON.stringify([completeFixture.dependabot[0]]), {
            status: 200,
            headers: {
              Link: '<https://api.github.com/repos/AdTecher/Portal/dependabot/alerts?state=open&severity=high%2Ccritical&per_page=100&page=2>; type="application/json"; rel="next last"',
            },
          });
        }
        return Response.json([completeFixture.dependabot[2]]);
      }
      return baseFetch(input);
    }) as typeof fetch;

    const facts = await collect(fetchImpl);

    expect(facts.dependabot).toEqual({ state: "available", value: { openHigh: 1, openCritical: 1 } });
    expect(dependabotPages).toBe(2);
  });

  it.each([
    {
      name: "malformed",
      link: "not-a-link-header",
    },
    {
      name: "hostile-origin",
      link: '<https://example.test/repos/AdTecher/Portal/dependabot/alerts?page=2>; rel="next"',
    },
    {
      name: "page-jump",
      link: '<https://api.github.com/repos/AdTecher/Portal/dependabot/alerts?page=3>; rel="next"',
    },
  ])("rejects a $name pagination link without following it", async ({ link }) => {
    const facts = await collect(fixtureFetch({
      dependabot: new Response(JSON.stringify(completeFixture.dependabot), {
        status: 200,
        headers: { Link: link },
      }),
    }));

    expect(facts.dependabot).toEqual({ state: "unavailable", diagnosticCode: "invalid_response" });
  });

  it.each([1, 2])("rejects a backward or repeated page %s after page 2", async (badNextPage) => {
    const baseFetch = fixtureFetch();
    let dependabotPages = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.pathname.endsWith("/dependabot/alerts")) {
        dependabotPages += 1;
        const nextPage = dependabotPages === 1 ? 2 : badNextPage;
        return new Response(JSON.stringify([completeFixture.dependabot[dependabotPages - 1]]), {
          status: 200,
          headers: {
            Link: `<https://api.github.com/repos/AdTecher/Portal/dependabot/alerts?page=${nextPage}>; rel="next"`,
          },
        });
      }
      return baseFetch(input);
    }) as typeof fetch;

    const facts = await collect(fetchImpl);

    expect(facts.dependabot).toEqual({ state: "unavailable", diagnosticCode: "invalid_response" });
    expect(dependabotPages).toBe(2);
  });

  it("stops at the deterministic request budget and marks unfinished facts unavailable", async () => {
    const fetchImpl = fixtureFetch();

    const facts = await collectRepositoryFacts({
      installationToken: installationCredential,
      repository: target,
      approvedSecurityWorkflowIds: [31],
      fetchImpl,
      requestBudget: 1,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    for (const fact of [
      facts.branchProtection,
      facts.dependabot,
      facts.codeScanning,
      facts.secretScanningAlerts,
      facts.securityWorkflows,
      facts.administration,
    ]) {
      expect(fact).toEqual({ state: "unavailable", diagnosticCode: "provider_unavailable" });
    }
  });

  it("stops at the deterministic collector deadline and makes no further fetch", async () => {
    let currentTime = 0;
    const baseFetch = fixtureFetch();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const response = await baseFetch(input);
      currentTime = 90_001;
      return response;
    }) as typeof fetch;

    const facts = await collectRepositoryFacts({
      installationToken: installationCredential,
      repository: target,
      approvedSecurityWorkflowIds: [31],
      fetchImpl,
      clock: () => currentTime,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(facts.branchProtection).toEqual({
      state: "unavailable",
      diagnosticCode: "provider_unavailable",
    });
    expect(facts.administration).toEqual({
      state: "unavailable",
      diagnosticCode: "provider_unavailable",
    });
  });

  it("recursively serialises neither credentials, raw headers/bodies, nor collaborator identity", async () => {
    const bodyDetail = crypto.randomUUID();
    const headerDetail = crypto.randomUUID();
    const identityDetail = crypto.randomUUID();
    const authorization = `Bearer ${installationCredential}`;
    const facts = await collect(fixtureFetch({
      metadata: Response.json({ ...completeFixture.metadata, authorization }),
      dependabot: new Response(bodyDetail, {
        status: 403,
        headers: { Authorization: authorization, "X-Private-Detail": headerDetail },
      }),
      collaborators: Response.json([{
        id: 41,
        login: identityDetail,
        permissions: { admin: true },
      }]),
    }));
    const serialisedFacts = JSON.stringify(facts);

    for (const privateValue of [
      installationCredential,
      authorization,
      bodyDetail,
      headerDetail,
      identityDetail,
    ]) {
      expect(serialisedFacts).not.toContain(privateValue);
    }

    const rateError = await collect(fixtureFetch({
      rules: new Response(bodyDetail, {
        status: 429,
        headers: {
          Authorization: authorization,
          "X-Private-Detail": headerDetail,
          "Retry-After": "5",
        },
      }),
    })).catch((caught: unknown) => caught);
    const serialisedError = `${String(rateError)}${JSON.stringify(rateError)}`;
    for (const privateValue of [installationCredential, authorization, bodyDetail, headerDetail]) {
      expect(serialisedError).not.toContain(privateValue);
    }
  });

  it("validates the immutable workflow allowlist before making a request", async () => {
    for (const ids of [[31, 31], [0], [Number.MAX_SAFE_INTEGER + 1], Array.from({ length: 21 }, (_, index) => index + 1)]) {
      const fetchImpl = fixtureFetch();
      await expect(collect(fetchImpl, ids)).rejects.toThrow("Invalid approved security workflow IDs");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("makes approved workflow lookup atomic and uses only numeric IDs", async () => {
    const fetchImpl = fixtureFetch({ workflowRuns: new Response("denied", { status: 403 }) });
    const facts = await collect(fetchImpl, [31]);
    expect(facts.securityWorkflows).toEqual({ state: "unavailable", diagnosticCode: "permission_denied" });
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes("CodeQL"))).toBe(false);
  });

  it("short-circuits archived repositories after verified metadata", async () => {
    const fetchImpl = fixtureFetch({
      metadata: Response.json({ ...completeFixture.metadata, archived: true }),
    });
    const facts = await collect(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(facts.repository.archived).toBe(true);
    expect(facts.branchProtection).toEqual({ state: "unavailable", diagnosticCode: "feature_unavailable" });
  });

  it("aborts safely when repository metadata is unavailable or malformed", async () => {
    for (const response of [
      new Response("private missing detail", { status: 404 }),
      new Response("not-json private detail", { status: 200 }),
    ]) {
      const error = await collect(fixtureFetch({ metadata: response })).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GitHubCollectionError);
      expect(error).toMatchObject({
        diagnosticCode: response.status === 404 ? "not_found" : "invalid_response",
      });
      expect(String(error)).not.toMatch(/private missing|not-json/i);
    }
  });
});
