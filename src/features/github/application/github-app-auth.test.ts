// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";

import { importSPKI, jwtVerify } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createAppJwt,
  createInstallationToken,
  READ_PERMISSIONS,
} from "./github-app-auth";
import { GitHubRateLimitError } from "./github-collection-error";

let privateKeyPem: string;
let publicKeyPem: string;

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
});

describe("GitHub App authentication", () => {
  it("uses GitHub's exact read-only installation permission payload", () => {
    expect(READ_PERMISSIONS).toEqual({
      actions: "read",
      administration: "read",
      metadata: "read",
      secret_scanning_alerts: "read",
      security_events: "read",
      vulnerability_alerts: "read",
    });
    expect(READ_PERMISSIONS).not.toHaveProperty("dependabot_alerts");
  });

  it("signs an RS256 app JWT with GitHub's bounded claims and normalises escaped PEM newlines", async () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const token = await createAppJwt({
      appId: "123456",
      privateKey: privateKeyPem.replace(/\n/g, "\\n"),
    }, now);
    const publicKey = await importSPKI(publicKeyPem, "RS256");

    const verified = await jwtVerify(token, publicKey, { algorithms: ["RS256"], currentDate: now });

    expect(verified.protectedHeader.alg).toBe("RS256");
    expect(verified.payload).toMatchObject({
      iat: 1_786_967_940,
      exp: 1_786_968_540,
      iss: "123456",
    });
  });

  it.each([
    { appId: "", privateKey: "private-key" },
    { appId: "   ", privateKey: "private-key" },
    { appId: "123456", privateKey: "" },
    { appId: "123456", privateKey: "   " },
  ])("rejects missing GitHub App configuration", async (config) => {
    await expect(createAppJwt(config, new Date("2026-08-17T12:00:00.000Z")))
      .rejects.toThrow("GitHub App configuration is required");
  });

  it("requests an installation token restricted to selected repositories and read permissions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: "x",
      expires_at: "2026-08-17T13:00:00Z",
    }), { status: 201, headers: { "content-type": "application/json" } }));

    const result = await createInstallationToken({
      installationId: 77,
      repositoryIds: [101, 102],
      fetchImpl,
      appJwt: "signed-app-jwt",
    });

    expect(result).toEqual({ token: "x", expiresAt: "2026-08-17T13:00:00Z" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/77/access_tokens",
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer signed-app-jwt",
          "Content-Type": "application/json",
          "User-Agent": "ComplianceHub-GitHub-App",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({
          repository_ids: [101, 102],
          permissions: {
            actions: "read",
            administration: "read",
            metadata: "read",
            secret_scanning_alerts: "read",
            security_events: "read",
            vulnerability_alerts: "read",
          },
        }),
        cache: "no-store",
        redirect: "error",
      }),
    );
  });

  it.each([
    { repositoryIds: [], label: "empty" },
    { repositoryIds: [101, 101], label: "duplicate" },
    { repositoryIds: [0], label: "zero" },
    { repositoryIds: [-1], label: "negative" },
    { repositoryIds: [1.5], label: "fractional" },
    { repositoryIds: Array.from({ length: 101 }, (_, index) => index + 1), label: "over-limit" },
  ])("rejects $label repository selection before requesting a token", async ({ repositoryIds }) => {
    const fetchImpl = vi.fn();

    await expect(createInstallationToken({
      installationId: 77,
      repositoryIds,
      fetchImpl,
      appJwt: "signed-app-jwt",
    })).rejects.toThrow("Invalid GitHub installation token request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an invalid installation ID before building the fixed endpoint", async () => {
    const fetchImpl = vi.fn();

    await expect(createInstallationToken({
      installationId: -1,
      repositoryIds: [101],
      fetchImpl,
      appJwt: "signed-app-jwt",
    })).rejects.toThrow("Invalid GitHub installation token request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("redacts provider bodies and the app JWT when token creation fails", async () => {
    const responseDetail = crypto.randomUUID();
    const appJwt = crypto.randomUUID();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(responseDetail, { status: 403 }));

    const error = await createInstallationToken({
      installationId: 77,
      repositoryIds: [101],
      fetchImpl,
      appJwt,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("Could not create GitHub installation token");
    expect(String(error)).not.toContain(responseDetail);
    expect(String(error)).not.toContain(appJwt);
  });

  it.each([
    { status: 429, headers: { "retry-after": "60" } },
    { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1786969000" } },
    { status: 403, headers: { "retry-after": "30" } },
  ])("surfaces token-exchange rate limiting as a safe typed signal", async ({ status, headers }) => {
    const providerBody = crypto.randomUUID();
    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) responseHeaders.set(name, value);
    }
    const error = await createInstallationToken({
      installationId: 77,
      repositoryIds: [101],
      fetchImpl: vi.fn().mockResolvedValue(new Response(providerBody, { status, headers: responseHeaders })),
      appJwt: "signed-app-jwt",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect((error as GitHubRateLimitError).diagnosticCode).toBe("rate_limited");
    expect(String(error)).not.toContain(providerBody);
  });

  it("redacts malformed token response values", async () => {
    const providerCredential = crypto.randomUUID();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      token: providerCredential,
      expires_at: "not-a-date",
    }), { status: 201, headers: { "content-type": "application/json" } }));

    const error = await createInstallationToken({
      installationId: 77,
      repositoryIds: [101],
      fetchImpl,
      appJwt: "signed-app-jwt",
    }).catch((caught: unknown) => caught);

    expect(String(error)).toContain("GitHub returned an invalid installation token response");
    expect(String(error)).not.toContain(providerCredential);
  });
});
