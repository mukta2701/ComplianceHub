import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLauncherCanClaimPort,
  findProofPortListenerPids,
  verifyOwnedProofServer,
} from "./mcp-github-read-proof";

const ENDPOINT = "http://127.0.0.1:3100/mcp";
const CURRENT_OUTPUT_NAME = "current-proof.json";
const FINAL_OUTPUT = resolve("artifacts/phase3-0-mcp-foundation-proof.json");

function delay(milliseconds: number) {
  return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function createOwnerOnlyJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
}

async function replaceOwnerOnlyJson(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function requiredLocalEnvironment(environment: NodeJS.ProcessEnv) {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url !== "http://127.0.0.1:54321" || !anonKey || !serviceKey) {
    throw new Error("The owned MCP proof launcher requires the local Supabase environment.");
  }
  return { url, anonKey, serviceKey };
}

async function stopChild(child: ChildProcess) {
  if (!child.pid) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function waitForOwnedServer(input: {
  child: ChildProcess;
  controlPath: string;
  ledgerPath: string;
  runId: string;
}) {
  if (!input.child.pid) throw new Error("The guarded Next process did not start.");
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (input.child.exitCode !== null || input.child.signalCode !== null) {
      throw new Error("The guarded Next process exited before readiness.");
    }
    try {
      const response = await fetch(ENDPOINT, { method: "GET", redirect: "error" });
      const listeners = await findProofPortListenerPids();
      if (response.status === 405 && listeners.length === 1) {
        await replaceOwnerOnlyJson(input.controlPath, {
          schemaVersion: 1,
          runId: input.runId,
          status: "ready",
          port: 3100,
          launcherPid: process.pid,
          childPid: input.child.pid,
          listenerPid: listeners[0],
        });
        const observed = await verifyOwnedProofServer({
          ...process.env,
          MCP_PROOF_SERVER_RUN_ID: input.runId,
          MCP_PROOF_SERVER_CONTROL_FILE: input.controlPath,
          MCP_PROOF_SERVER_NETWORK_LEDGER: input.ledgerPath,
        });
        if (observed.githubAttempts !== 0 || observed.slackAttempts !== 0) {
          throw new Error("The guarded Next process attempted provider access during startup.");
        }
        return;
      }
    } catch {
      // Readiness is condition-based; retry until the bounded deadline or child exit.
    }
    await delay(100);
  }
  throw new Error("The guarded Next process did not become ready on the exact proof port.");
}

async function runProofClient(input: {
  protocol: "current" | "legacy";
  outputPath: string;
  runId: string;
  controlPath: string;
  ledgerPath: string;
}) {
  const command = resolve("node_modules/.bin/tsx");
  const proofScript = resolve("scripts/mcp-github-read-proof.ts");
  const child = spawn(command, [proofScript], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MCP_PROOF_PROTOCOL: input.protocol,
      MCP_PROOF_OUTPUT: input.outputPath,
      MCP_PROOF_SERVER_RUN_ID: input.runId,
      MCP_PROOF_SERVER_CONTROL_FILE: input.controlPath,
      MCP_PROOF_SERVER_NETWORK_LEDGER: input.ledgerPath,
    },
    stdio: "inherit",
  });
  const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  if (code !== 0 || signal !== null) throw new Error(`The ${input.protocol} proof client did not complete.`);
  const observed = await verifyOwnedProofServer({
    ...process.env,
    MCP_PROOF_SERVER_RUN_ID: input.runId,
    MCP_PROOF_SERVER_CONTROL_FILE: input.controlPath,
    MCP_PROOF_SERVER_NETWORK_LEDGER: input.ledgerPath,
  });
  if (observed.githubAttempts !== 0 || observed.slackAttempts !== 0) {
    throw new Error("The owned guarded server recorded a provider attempt.");
  }
}

async function sha256File(path: string) {
  const info = await stat(path);
  if ((info.mode & 0o777) !== 0o600) throw new Error("A proof artifact was not owner-only.");
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function runOwnedProofLifecycle<T>(input: {
  operation: () => Promise<T>;
  stopOwnedChild: () => Promise<void>;
  verifyPortReleased: () => Promise<void>;
  removePrivateState: () => Promise<void>;
}) {
  let result: T | undefined;
  let primaryFailure: unknown;
  let hasPrimaryFailure = false;
  try {
    result = await input.operation();
  } catch (error) {
    primaryFailure = error;
    hasPrimaryFailure = true;
  }

  const cleanupFailures: unknown[] = [];
  for (const cleanup of [input.stopOwnedChild, input.verifyPortReleased, input.removePrivateState]) {
    try { await cleanup(); } catch (error) { cleanupFailures.push(error); }
  }
  if (hasPrimaryFailure) throw primaryFailure;
  if (cleanupFailures.length > 0) throw new Error("The owned MCP proof cleanup did not complete safely.");
  return result as T;
}

export async function runOwnedServerProof(environment: NodeJS.ProcessEnv = process.env) {
  const local = requiredLocalEnvironment(environment);
  assertLauncherCanClaimPort(await findProofPortListenerPids());
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "compliancehub-mcp-owned-"));
  let nextChild: ChildProcess | undefined;
  return runOwnedProofLifecycle({
    operation: async () => {
      await chmod(temporaryDirectory, 0o700);
      const runId = randomBytes(32).toString("base64url");
      const ledgerPath = join(temporaryDirectory, "network-ledger.json");
      const controlPath = join(temporaryDirectory, "server-control.json");
      const eventDirectory = `${ledgerPath}.events`;
      const currentOutput = join(temporaryDirectory, CURRENT_OUTPUT_NAME);
      await createOwnerOnlyJson(ledgerPath, { schemaVersion: 1, runId, guardActive: true });
      await mkdir(eventDirectory, { mode: 0o700 });
      await chmod(eventDirectory, 0o700);
      await createOwnerOnlyJson(controlPath, {
        schemaVersion: 1, runId, status: "starting", port: 3100,
        launcherPid: process.pid, childPid: null, listenerPid: null,
      });

      const guardPath = resolve("scripts/mcp-proof-server-network-guard.cjs");
      const nextScript = resolve("node_modules/next/dist/bin/next");
      nextChild = spawn(process.execPath, [nextScript, "dev", "--hostname", "127.0.0.1", "--port", "3100"], {
        cwd: process.cwd(),
        env: {
          ...environment,
          NEXT_PUBLIC_SUPABASE_URL: local.url,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: local.anonKey,
          SUPABASE_SERVICE_ROLE_KEY: local.serviceKey,
          NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
          MCP_RESOURCE_URL: ENDPOINT,
          APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
          MCP_PROOF_SERVER_RUN_ID: runId,
          MCP_PROOF_SERVER_NETWORK_LEDGER: ledgerPath,
          NODE_OPTIONS: `--require=${JSON.stringify(guardPath)}`,
        },
        stdio: "inherit",
      });

      await waitForOwnedServer({ child: nextChild, controlPath, ledgerPath, runId });
      await runProofClient({ protocol: "current", outputPath: currentOutput, runId, controlPath, ledgerPath });
      await runProofClient({ protocol: "legacy", outputPath: FINAL_OUTPUT, runId, controlPath, ledgerPath });
      const finalObservation = await verifyOwnedProofServer({
        ...environment,
        MCP_PROOF_SERVER_RUN_ID: runId,
        MCP_PROOF_SERVER_CONTROL_FILE: controlPath,
        MCP_PROOF_SERVER_NETWORK_LEDGER: ledgerPath,
      });
      if (finalObservation.githubAttempts !== 0 || finalObservation.slackAttempts !== 0) {
        throw new Error("The owned guarded server recorded a provider attempt.");
      }
      return {
        currentArtifactSha256: await sha256File(currentOutput),
        retainedArtifactSha256: await sha256File(FINAL_OUTPUT),
        serverNetwork: finalObservation,
      };
    },
    stopOwnedChild: async () => { if (nextChild) await stopChild(nextChild); },
    verifyPortReleased: async () => {
      if ((await findProofPortListenerPids()).length !== 0) {
        throw new Error("The owned guarded server did not release the exact proof port.");
      }
    },
    removePrivateState: async () => rm(temporaryDirectory, { recursive: true, force: true }),
  });
}

async function main() {
  try {
    const result = await runOwnedServerProof();
    process.stdout.write(`${JSON.stringify({ status: "passed", ...result })}\n`);
  } catch {
    process.stderr.write("The owned guarded MCP proof did not complete. No success was accepted.\n");
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) void main();
