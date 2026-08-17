import { describe, expect, it } from "vitest";

import {
  GitHubWebhookInputError,
  parseGitHubWebhookPayload,
  readBoundedRequestBytes,
  sha256Hex,
  verifyGitHubWebhookSignature,
} from "./webhook";

const publishedSignature = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

describe("verifyGitHubWebhookSignature", () => {
  it("accepts GitHub's published HMAC vector over the exact bytes", () => {
    expect(verifyGitHubWebhookSignature(
      new TextEncoder().encode("Hello, World!"),
      publishedSignature,
      "It's a Secret to Everybody",
    )).toBe(true);
  });

  it.each([
    null,
    "SHA256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    "sha256=757107EA0EB2509FC211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e1",
    "sha256=not-hex",
  ])("rejects a non-canonical or invalid signature without throwing (%s)", (signature) => {
    expect(verifyGitHubWebhookSignature(
      new TextEncoder().encode("Hello, World!"),
      signature,
      "It's a Secret to Everybody",
    )).toBe(false);
  });
});

describe("bounded request byte reader", () => {
  it("rejects and cancels a streamed body as soon as it crosses one MiB", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() { cancelled = true; },
    });
    await expect(readBoundedRequestBytes(stream, null)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it("rejects an oversized declared length without reading the stream", async () => {
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>({ pull() { pulled = true; } });
    await expect(readBoundedRequestBytes(stream, "1048577")).rejects.toMatchObject({ status: 413 });
    expect(pulled).toBe(false);
  });
});

describe("parseGitHubWebhookPayload", () => {
  const installation = { id: 71 };
  const repository = { id: 91 };

  it.each([
    ["installation", { installation }, null],
    ["installation_repositories", { installation }, null],
    ["repository", { installation, repository }, 91],
    ["branch_protection_rule", { installation, repository }, 91],
    ["repository_ruleset", { installation, repository }, 91],
    ["workflow_run", { installation, repository }, 91],
    ["dependabot_alert", { installation, repository }, 91],
    ["code_scanning_alert", { installation, repository }, 91],
    ["secret_scanning_alert", { installation, repository }, 91],
  ] as const)("extracts only numeric routing IDs for %s", (eventName, payload, repositoryId) => {
    expect(parseGitHubWebhookPayload(eventName, new TextEncoder().encode(JSON.stringify({
      ...payload,
      sender: { login: "attacker\nAuthorization: secret" },
      repository: repositoryId === null ? undefined : { ...repository, full_name: "ignore/me" },
    })))).toEqual({ providerInstallationId: 71, providerRepositoryId: repositoryId });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "91", null])("rejects an unsafe repository routing ID (%s)", (id) => {
    expect(() => parseGitHubWebhookPayload("repository", new TextEncoder().encode(JSON.stringify({
      installation,
      repository: { id },
    })))).toThrow(GitHubWebhookInputError);
  });

  it("decodes UTF-8 fatally before parsing JSON", () => {
    expect(() => parseGitHubWebhookPayload("repository", new Uint8Array([0xc3, 0x28]))).toThrow(GitHubWebhookInputError);
  });

  it("hashes the retained bytes without exposing their contents", () => {
    expect(sha256Hex(new TextEncoder().encode("Hello, World!"))).toBe("dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f");
  });
});
