import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type RuntimeBundleBuildResult = {
  outfile: string;
  bytes: number;
};

export async function buildRuntimeBundles(
  root = projectRoot,
): Promise<RuntimeBundleBuildResult> {
  const outfile = path.resolve(root, "dist/github-connection-reconcile.mjs");
  await mkdir(path.dirname(outfile), { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["scripts/github-connection-reconcile.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "info",
    metafile: false,
    sourcemap: false,
    alias: {
      "server-only": path.resolve(root, "scripts/bundle-shims/server-only.ts"),
    },
    legalComments: "none",
    banner: { js: "/* eslint-disable */" },
  });
  if (result.errors.length > 0) throw new Error("runtime bundle failed");
  return { outfile, bytes: (await stat(outfile)).size };
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  void buildRuntimeBundles().then(({ outfile, bytes }) => {
    process.stdout.write(`Built ${outfile} (${bytes} bytes)\n`);
  });
}
