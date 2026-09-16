// esbuild's startup invariant is incompatible with jsdom; the bundle build and
// the runner it starts are pure Node work.
// @vitest-environment node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { buildRuntimeBundles } from "./build-runtime-bundles";

const execFileAsync = promisify(execFile);

// The built runner has no database in unit tests, so one cycle must end in the
// sanitised fail-closed message. Proving that line appears proves the bundle
// loaded in plain Node and ran the CLI, rather than crashing on a Next.js-only
// module such as `server-only`.
const FICTIONAL_RUNNER_ENVIRONMENT = {
  NEXT_PUBLIC_SUPABASE_URL: "https://bundle-test.supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: "bundle-test-fictional-service-key",
  GITHUB_CONNECTION_TIME_BUDGET_MS: "1000",
};

describe("production runtime bundles", () => {
  it("builds the finite GitHub reconciliation runner as a Node 22 ESM bundle", async () => {
    const result = await buildRuntimeBundles();
    const output = path.resolve(process.cwd(), "dist/github-connection-reconcile.mjs");

    expect(result.outfile).toBe(output);
    expect(existsSync(output)).toBe(true);
    expect(readFileSync(output, "utf8")).toMatch(/github connection reconciliation failed/i);
    expect(existsSync(`${output}.map`)).toBe(false);
    // Dependencies such as `jose` legitimately contain the PEM header as a
    // validation literal, so only match a header followed by key material.
    expect(readFileSync(output, "utf8")).not.toMatch(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=]{40,}/,
    );
  });

  it("starts the built runner in plain Node and exits fail-closed with the sanitised message", { timeout: 30_000 }, async () => {
    await buildRuntimeBundles();
    const output = path.resolve(process.cwd(), "dist/github-connection-reconcile.mjs");

    const outcome = await execFileAsync(process.execPath, [output], {
      env: { ...process.env, ...FICTIONAL_RUNNER_ENVIRONMENT },
      timeout: 20_000,
    }).then(
      (result) => ({ code: 0, stdout: result.stdout, stderr: result.stderr }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({
        code: error.code ?? -1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      }),
    );

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toMatch(/github connection reconciliation failed/i);
    expect(outcome.stdout).not.toContain(FICTIONAL_RUNNER_ENVIRONMENT.SUPABASE_SERVICE_ROLE_KEY);
  });
});
