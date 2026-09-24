import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

const repositoryRoot = resolve(import.meta.dirname, "..");
export const githubComplianceCollectBundle = resolve(
  repositoryRoot,
  "dist/github-compliance-collect.mjs",
);

export async function buildRuntimeBundles(): Promise<void> {
  await mkdir(resolve(repositoryRoot, "dist"), { recursive: true });
  await build({
    absWorkingDir: repositoryRoot,
    entryPoints: ["scripts/github-compliance-collect.ts"],
    outfile: githubComplianceCollectBundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    conditions: ["react-server", "node"],
    tsconfig: "tsconfig.json",
    sourcemap: false,
    sourcesContent: false,
    legalComments: "none",
    logLevel: "error",
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildRuntimeBundles().catch(() => {
    process.stderr.write("Runtime bundle build failed\n");
    process.exitCode = 1;
  });
}
