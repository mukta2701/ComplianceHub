import { execFile, spawn } from "node:child_process";
import { statfs } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaults = {
  "min-start-gib": 8,
  "min-free-gib": 6,
  "max-rss-mib": 4096,
  "interval-ms": 1000,
  "grace-ms": 3000,
};

async function freeDiskGiB() {
  const disk = await statfs(process.cwd());
  return disk.bavail * disk.bsize / 1024 ** 3;
}

async function groupRssMiB(groupId: number) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pgid=,rss="], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim().split("\n").reduce((total, row) => {
    const [group, rss] = row.trim().split(/\s+/).map(Number);
    return total + (group === groupId ? rss / 1024 : 0);
  }, 0);
}

async function hasLiveGroupMembers(groupId: number) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pgid=,stat="], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim().split("\n").some((row) => {
    const [group, state] = row.trim().split(/\s+/);
    return Number(group) === groupId && !state.startsWith("Z");
  });
}

async function groupDisappearedAfterPermissionRace(groupId: number) {
  // The actual macOS build left a worker in ps state ?E (trying to exit)
  // during EPERM, then no members 50 ms later. Wait briefly for disappearance;
  // never reinterpret permission denial as success while live members remain.
  const deadline = Date.now() + 200;
  while (await hasLiveGroupMembers(groupId)) {
    if (Date.now() >= deadline) return false;
    await delay(50);
  }
  return true;
}

async function groupExists(groupId: number) {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    // macOS can report EPERM as the final group member disappears. Do not
    // treat permission denial as absence unless a fresh inventory confirms it.
    if ((error as NodeJS.ErrnoException).code === "EPERM" && await groupDisappearedAfterPermissionRace(groupId)) return false;
    throw error;
  }
}

async function signalGroup(groupId: number, signal: NodeJS.Signals) {
  try { process.kill(-groupId, signal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    if ((error as NodeJS.ErrnoException).code === "EPERM" && await groupDisappearedAfterPermissionRace(groupId)) return;
    throw error;
  }
}

async function stopGroup(groupId: number, graceMs: number) {
  if (!(await groupExists(groupId))) return;
  await signalGroup(groupId, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (await groupExists(groupId) && Date.now() < deadline) await delay(50);
  if (await groupExists(groupId)) {
    console.error("Grace period elapsed; forcing the command group to stop.");
    await signalGroup(groupId, "SIGKILL");
  }
}

async function main() {
  if (process.platform === "win32") throw new Error("POSIX process groups are required");
  const args = process.argv.slice(2);
  if (/max[-_]old[-_]space[-_]size[-_]percentage/.test(process.env.NODE_OPTIONS ?? "")) {
    throw new Error("Remove the percentage heap setting from NODE_OPTIONS; it overrides the fixed heap limit.");
  }
  const separator = args.indexOf("--");
  if (separator < 0 || !args[separator + 1]) throw new Error("Use: node --import=tsx scripts/local-resource-guard.ts [options] -- command [args]");
  const limits = { ...defaults };
  for (const argument of args.slice(0, separator)) {
    const match = /^--([a-z-]+)=(\d+(?:\.\d+)?)$/.exec(argument);
    if (!match || !Object.hasOwn(defaults, match[1])) throw new Error("Unknown or invalid guard option");
    const key = match[1] as keyof typeof defaults;
    const value = Number(match[2]);
    if (!Number.isFinite(value) || ((key === "interval-ms" || key === "max-rss-mib") && value <= 0)) throw new Error("Invalid guard limit");
    limits[key] = value;
  }
  const freeGiB = await freeDiskGiB();
  if (freeGiB < limits["min-start-gib"]) {
    console.error(`Not started: available disk ${freeGiB.toFixed(1)} GiB is below ${limits["min-start-gib"]} GiB. Free regenerable build caches before retrying.`);
    process.exitCode = 1;
    return;
  }
  const command = args.slice(separator + 1);
  const child = spawn(command[0], command.slice(1), {
    detached: true,
    stdio: "inherit",
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=2048`.trim() },
  });
  const exited = new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  // detached:true gives this command its own POSIX process group. Never target
  // the caller's group or search/kill processes by name.
  const groupId = child.pid;
  if (!groupId) { await exited; return; }
  let forcedExit: number | undefined;
  let stopping: Promise<void> | undefined;
  const stop = (message: string, code = 1) => {
    if (stopping) return;
    forcedExit = code;
    console.error(message);
    stopping = stopGroup(groupId, limits["grace-ms"]);
  };
  const onInterrupt = () => stop("Stopped: command interrupted.", 130);
  const onTerminate = () => stop("Stopped: command terminated.", 143);
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  let checking = false;
  let finished = false;
  const timer = setInterval(async () => {
    if (checking || stopping) return;
    checking = true;
    try {
      const freeGiB = await freeDiskGiB();
      if (finished) return;
      if (freeGiB < limits["min-free-gib"]) {
        stop(`Stopped: available disk ${freeGiB.toFixed(1)} GiB fell below ${limits["min-free-gib"]} GiB.`);
        return;
      }
      const rss = await groupRssMiB(groupId);
      if (finished) return;
      if (rss > limits["max-rss-mib"]) stop(`Stopped: command group memory ${rss.toFixed(0)} MiB exceeded ${limits["max-rss-mib"]} MiB.`);
    } catch {
      if (!finished) stop("Stopped: resource monitoring failed; retry after checking the local environment.");
    } finally { checking = false; }
  }, limits["interval-ms"]);
  try {
    const exitCode = await exited;
    finished = true;
    clearInterval(timer);
    // Also clean up ordinary commands that leave background descendants behind.
    await (stopping ?? stopGroup(groupId, limits["grace-ms"]));
    process.exitCode = forcedExit ?? exitCode;
  } finally {
    clearInterval(timer);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
}

void main().catch((error: unknown) => {
  console.error(`Local resource guard failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
