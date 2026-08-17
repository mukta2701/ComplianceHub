import type { DiagnosticCode } from "../domain/observation";

export class GitHubCollectionError extends Error {
  constructor(public readonly diagnosticCode: DiagnosticCode) {
    super("GitHub collection failed");
    this.name = "GitHubCollectionError";
  }
}

export class GitHubRateLimitError extends GitHubCollectionError {
  readonly retryAfterSeconds?: number;
  readonly resetAtEpochSeconds?: number;

  constructor(metadata: { retryAfterSeconds?: number; resetAtEpochSeconds?: number }) {
    super("rate_limited");
    this.name = "GitHubRateLimitError";
    this.retryAfterSeconds = metadata.retryAfterSeconds;
    this.resetAtEpochSeconds = metadata.resetAtEpochSeconds;
  }
}

export function boundedRateLimitInteger(value: string | null, maximum: number): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : undefined;
}

export function throwIfGitHubRateLimited(response: Response): void {
  const retryAfterPresent = response.headers.has("retry-after");
  const exhausted = response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
  if (response.status !== 429 && !retryAfterPresent && !exhausted) return;
  throw new GitHubRateLimitError({
    retryAfterSeconds: boundedRateLimitInteger(response.headers.get("retry-after"), 86_400),
    resetAtEpochSeconds: boundedRateLimitInteger(response.headers.get("x-ratelimit-reset"), Number.MAX_SAFE_INTEGER),
  });
}
