import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildRuntimeBundles } from "./build-runtime-bundles";

describe("production runtime bundles", () => {
  it("builds the finite GitHub reconciliation runner as a Node 22 ESM bundle", async () => {
    const result = await buildRuntimeBundles();
    const output = path.resolve(process.cwd(), "dist/github-connection-reconcile.mjs");

    expect(result.outfile).toBe(output);
    expect(existsSync(output)).toBe(true);
    expect(readFileSync(output, "utf8")).toMatch(/github connection reconciliation failed/i);
    expect(existsSync(`${output}.map`)).toBe(false);
    expect(readFileSync(output, "utf8")).not.toMatch(/BEGIN (?:RSA |EC )?PRIVATE KEY/);
  });
});
