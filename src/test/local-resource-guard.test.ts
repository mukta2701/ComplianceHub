// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const script = resolve("scripts/local-resource-guard.ts");

function runGuard(options: string[], code: string, environment: Partial<NodeJS.ProcessEnv> = {}) {
  const child = spawn(process.execPath, ["--import=tsx", script, ...options, "--", process.execPath, "-e", code], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...environment },
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  return new Promise<{ code: number | null; output: string }>((resolveResult, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ code, output }));
  });
}

test("refuses to launch work when available disk is below the starting reserve", async () => {
  const result = await runGuard(["--min-start-gib=1000000"], 'console.log("COMMAND_STARTED")');
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("Not started: available disk");
  expect(result.output).not.toContain("COMMAND_STARTED");
});

test("runs an ordinary command with a bounded inherited Node heap and preserves its exit code", async () => {
  const result = await runGuard(["--min-start-gib=0", "--min-free-gib=0"], 'console.log(require("node:v8").getHeapStatistics().heap_size_limit / 1024 ** 2); process.exitCode = 7;', { NODE_OPTIONS: "--max-old-space-size=8192" });
  expect(result.code).toBe(7);
  expect(Number(result.output.trim())).toBeGreaterThanOrEqual(2048);
  // V8 reports young-generation space as well as the 2 GiB old-space limit.
  expect(Number(result.output.trim())).toBeLessThan(2560);
});

test("stops only its own command group when the memory budget is exceeded", async () => {
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    const result = await runGuard([
      // Leave enough startup time for both signal handlers to be installed
      // before the deliberately tiny memory limit stops the process group.
      "--min-start-gib=0", "--min-free-gib=0", "--max-rss-mib=1", "--interval-ms=1000", "--grace-ms=500",
    ], `
      process.on("SIGTERM", () => console.log("GRACEFUL_STOP_RECEIVED"));
      require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify('process.on("SIGTERM", () => console.log("DESCENDANT_STOP_RECEIVED")); setTimeout(() => process.exit(0), 2000);')}], { stdio: "inherit" });
      setTimeout(() => process.exit(0), 2000);
    `);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("Stopped: command group memory");
    expect(result.output).toContain("GRACEFUL_STOP_RECEIVED");
    expect(result.output).toContain("DESCENDANT_STOP_RECEIVED");
    expect(result.output).toContain("forcing the command group to stop");
    expect(unrelated.exitCode).toBeNull();
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
  } finally {
    unrelated.kill("SIGKILL");
  }
});

test("stops running work when the disk reserve is crossed without exhausting the disk", async () => {
  const result = await runGuard([
    "--min-start-gib=0", "--min-free-gib=1000000", "--interval-ms=100", "--grace-ms=100",
  ], 'setTimeout(() => process.exit(0), 2000);');
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("Stopped: available disk");
});

test.skipIf(!process.allowedNodeEnvironmentFlags.has("--max-old-space-size-percentage"))("refuses an inherited percentage heap setting that would override the fixed heap limit", async () => {
  const result = await runGuard(["--min-start-gib=0", "--min-free-gib=0"], 'console.log("COMMAND_STARTED")', { NODE_OPTIONS: "--max-old-space-size-percentage=80" });
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("Remove the percentage heap setting from NODE_OPTIONS");
  expect(result.output).not.toContain("COMMAND_STARTED");
});

test("preserves the command exit when the OS reports EPERM for a disappeared process group", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "resource-guard-"));
  try {
    const preload = resolve(directory, "disappeared-group.mjs");
    // Reproduce the observed macOS syscall result at the OS boundary. The
    // spawned command and subsequent process-group inventory remain real.
    await writeFile(preload, `
      const original = process.kill.bind(process);
      process.kill = (pid, signal) => {
        try { return original(pid, signal); } catch (error) {
          if (pid < 0 && error.code === "ESRCH") {
            throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
          }
          throw error;
        }
      };
    `);
    const result = await runGuard(["--min-start-gib=0", "--min-free-gib=0"], 'process.exit(7);', { NODE_OPTIONS: `--import=${preload}` });
    expect(result.output).not.toContain("Local resource guard failed");
    expect(result.code).toBe(7);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports a genuine permission failure when a live group member still exists", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "resource-guard-"));
  try {
    const preload = resolve(directory, "permission-denied.mjs");
    await writeFile(preload, `
      const original = process.kill.bind(process);
      process.kill = (pid, signal) => {
        if (pid < 0) throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
        return original(pid, signal);
      };
    `);
    const result = await runGuard(["--min-start-gib=0", "--min-free-gib=0"],
      'require("node:child_process").spawn("/bin/sleep", ["1"], { stdio: "ignore" }); process.exit(7);',
      { NODE_OPTIONS: `--import=${preload}` });
    expect(result.code).toBe(1);
    expect(result.output).toContain("Local resource guard failed: kill EPERM");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("waits briefly for an exiting descendant to disappear after an OS permission race", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "resource-guard-"));
  try {
    const preload = resolve(directory, "exiting-group.mjs");
    await writeFile(preload, `
      const original = process.kill.bind(process);
      process.kill = (pid, signal) => {
        if (pid < 0) throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
        return original(pid, signal);
      };
    `);
    // Actual build trace: an orphaned worker was still visible as ?E when
    // kill returned EPERM, and disappeared by the next 50 ms snapshot.
    const result = await runGuard(["--min-start-gib=0", "--min-free-gib=0"],
      'require("node:child_process").spawn("/bin/sleep", ["0.08"], { stdio: "ignore" }); process.exit(7);',
      { NODE_OPTIONS: `--import=${preload}` });
    expect(result.output).not.toContain("Local resource guard failed");
    expect(result.code).toBe(7);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
