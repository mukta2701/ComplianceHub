import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MAX_GITHUB_WEBHOOK_BYTES = 1024 * 1024;

const supportedEvents = new Set([
  "installation",
  "installation_repositories",
  "repository",
  "branch_protection_rule",
  "repository_ruleset",
  "workflow_run",
  "dependabot_alert",
  "code_scanning_alert",
  "secret_scanning_alert",
]);

const installationScopedEvents = new Set(["installation", "installation_repositories"]);
const signaturePattern = /^sha256=([0-9a-f]{64})$/;
const deliveryPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventPattern = /^[a-z][a-z0-9_]{0,99}$/;

export class GitHubWebhookInputError extends Error {
  readonly status: 400 | 413;

  constructor(status: 400 | 413) {
    super(status === 413 ? "GitHub webhook body is too large" : "GitHub webhook input is invalid");
    this.name = "GitHubWebhookInputError";
    this.status = status;
  }
}

export type GitHubWebhookRouting = {
  providerInstallationId: number;
  providerRepositoryId: number | null;
};

export function isSupportedGitHubWebhookEvent(eventName: string): boolean {
  return supportedEvents.has(eventName);
}

export function validateGitHubWebhookHeaders(deliveryId: string | null, eventName: string | null): { deliveryId: string; eventName: string } {
  if (!deliveryId || !deliveryPattern.test(deliveryId) || !eventName || !eventPattern.test(eventName)) {
    throw new GitHubWebhookInputError(400);
  }
  return { deliveryId, eventName };
}

export function verifyGitHubWebhookSignature(body: Uint8Array, signature: string | null, secret: string): boolean {
  if (secret.length < 1 || !signature) return false;
  const match = signaturePattern.exec(signature);
  if (!match) return false;
  const supplied = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function sha256Hex(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

export async function readBoundedRequestBytes(stream: ReadableStream<Uint8Array> | null, contentLength: string | null): Promise<Uint8Array> {
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) throw new GitHubWebhookInputError(400);
    if (Number(contentLength) > MAX_GITHUB_WEBHOOK_BYTES) {
      await stream?.cancel().catch(() => undefined);
      throw new GitHubWebhookInputError(413);
    }
  }
  if (!stream) return new Uint8Array();

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_GITHUB_WEBHOOK_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new GitHubWebhookInputError(413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const retained = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    retained.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return retained;
}

function positiveSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new GitHubWebhookInputError(400);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new GitHubWebhookInputError(400);
  return value as Record<string, unknown>;
}

export function parseGitHubWebhookPayload(eventName: string, body: Uint8Array): GitHubWebhookRouting {
  if (!supportedEvents.has(eventName)) throw new GitHubWebhookInputError(400);
  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    parsed = JSON.parse(text);
  } catch {
    throw new GitHubWebhookInputError(400);
  }
  const payload = record(parsed);
  const installation = record(payload.installation);
  const providerInstallationId = positiveSafeInteger(installation.id);
  if (installationScopedEvents.has(eventName)) return { providerInstallationId, providerRepositoryId: null };
  const repository = record(payload.repository);
  return { providerInstallationId, providerRepositoryId: positiveSafeInteger(repository.id) };
}
