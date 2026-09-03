// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

import { runGitHubShadowProofCli } from "./github-shadow-proof-cli";
import type { runGitHubShadowProof } from "./github-shadow-proof";

describe("runGitHubShadowProofCli", () => {
  it("does not auto-load repository environment files", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8"));
    expect(packageJson.scripts["github:shadow-proof"]).not.toContain("--env-file");
  });
  it("prints only the proof path and bounded outcome on success", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const runs = [{
      runMode: "shadow" as const,
      status: "succeeded" as const,
      observationCount: 15 as const,
      unknownCount: 0,
      materialisationJobCount: 0 as const,
      observationsSha256: "0".repeat(64),
    }, {
      runMode: "shadow" as const,
      status: "succeeded" as const,
      observationCount: 15 as const,
      unknownCount: 0,
      materialisationJobCount: 0 as const,
      observationsSha256: "1".repeat(64),
    }] satisfies Awaited<ReturnType<typeof runGitHubShadowProof>>["summary"]["runs"];
    const exitCode = await runGitHubShadowProofCli({
      environment: {},
      buildInput: vi.fn(() => ({}) as never),
      runProof: vi.fn(async () => ({
        proofPath: "/tmp/compliancehub-github-shadow-proof-abc/proof.json",
        summary: {
          runMode: "shadow" as const,
          runs,
          repeatabilityMatched: true as const,
          stableSemanticsSha256: "2".repeat(64),
        },
      })),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stderr).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.mock.calls[0]?.[0] as string)).toEqual({
      proofPath: "/tmp/compliancehub-github-shadow-proof-abc/proof.json",
      summary: {
        runMode: "shadow",
        runs: [{
          runMode: "shadow",
          status: "succeeded",
          observationCount: 15,
          unknownCount: 0,
          materialisationJobCount: 0,
          observationsSha256: "0".repeat(64),
        }, {
          runMode: "shadow",
          status: "succeeded",
          observationCount: 15,
          unknownCount: 0,
          materialisationJobCount: 0,
          observationsSha256: "1".repeat(64),
        }],
        repeatabilityMatched: true,
        stableSemanticsSha256: "2".repeat(64),
      },
    });
  });

  it("never prints provider or configuration errors", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const exitCode = await runGitHubShadowProofCli({
      environment: {},
      buildInput: vi.fn(() => { throw new Error("ghs_private_value provider body"); }),
      runProof: vi.fn(),
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith("GitHub shadow proof failed\n");
    expect(JSON.stringify(stderr.mock.calls)).not.toContain("ghs_private_value");
  });
});
