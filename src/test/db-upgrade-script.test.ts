import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const script = path.join(process.cwd(), "scripts/test-db-upgrade.sh");

function fakeSupabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "compliancehub-upgrade-guard-"));
  temporaryDirectories.push(directory);
  const command = path.join(directory, "supabase");
  const calls = path.join(directory, "calls.log");
  writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$DB_UPGRADE_CALL_LOG"\nexit 0\n`, "utf8");
  chmodSync(command, 0o755);
  return { directory, calls };
}

function invoke(fake: ReturnType<typeof fakeSupabase>, environment: Record<string, string> = {}) {
  return spawnSync("/bin/bash", [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fake.directory}:/usr/bin:/bin`,
      CI: "",
      COMPLIANCEHUB_ALLOW_LOCAL_DB_RESET: "",
      DB_UPGRADE_CALL_LOG: fake.calls,
      ...environment,
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database upgrade harness reset guard", () => {
  it("refuses before calling Supabase when destructive local reset was not acknowledged", () => {
    const fake = fakeSupabase();

    const result = invoke(fake);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("COMPLIANCEHUB_ALLOW_LOCAL_DB_RESET=1");
    expect(existsSync(fake.calls)).toBe(false);
  });

  it("allows an explicitly acknowledged invocation to reach the disposable Supabase workflow", () => {
    const fake = fakeSupabase();

    const result = invoke(fake, { COMPLIANCEHUB_ALLOW_LOCAL_DB_RESET: "1" });

    expect(result.status).toBe(0);
    expect(readFileSync(fake.calls, "utf8")).toContain("db reset --local --no-seed --version 20260807047000");
  });
});
