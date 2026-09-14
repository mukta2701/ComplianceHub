import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/test-db-fresh.sh", "utf8");

describe("fresh database validation helper", () => {
  it("creates a uniquely named disposable stack and forbids remote or canonical targets", () => {
    expect(source).toContain("compliancehub-release-");
    expect(source).toContain('DOCKER_HOST:-');
    expect(source).toContain('DOCKER_CONTEXT:-');
    expect(source).toContain(".colima/default/docker\\.sock");
    expect(source).toContain("project_id");
    expect(source).not.toContain("compliancehub\"\n");
    expect(source).not.toMatch(/db reset|dropdb|supabase stop --all/);
  });

  it("fails closed when pgTAP reports NOTESTS", () => {
    const fixture = mkdtempSync(`${tmpdir()}/fresh-helper-test-`);
    const fakeDocker = `${fixture}/docker`;
    const fakeSupabase = `${fixture}/supabase`;
    writeFileSync(fakeDocker, '#!/bin/sh\nif [ "$2" = show ]; then printf "colima\\n"; else printf "unix:///Users/test/.colima/default/docker.sock\\n"; fi\n');
    writeFileSync(fakeSupabase, '#!/bin/sh\ncase "$1" in start) exit 0;; test) printf "Files=0, Tests=0\\nResult: NOTESTS\\n";; esac\n');
    chmodSync(fakeDocker, 0o700);
    chmodSync(fakeSupabase, 0o700);
    const artifactDir = `${fixture}/artifacts`;
    const result = spawnSync("bash", ["scripts/test-db-fresh.sh"], {
      cwd: process.cwd(), encoding: "utf8",
      env: { ...process.env, DOCKER_BIN: fakeDocker, SUPABASE_BIN: fakeSupabase, FRESH_ARTIFACT_DIR: artifactDir, TMPDIR: fixture },
    });
    expect(result.status).not.toBe(0);
    expect(readFileSync(`${artifactDir}/fresh-database.json`, "utf8")).not.toContain('"status":"passed"');
    expect(result.stdout + result.stderr).toContain("no positive file/test counts");
  });

  it("rejects a wrong active Docker context before starting Supabase", () => {
    const fixture = mkdtempSync(`${tmpdir()}/fresh-context-test-`);
    const fakeDocker = `${fixture}/docker`;
    const fakeSupabase = `${fixture}/supabase`;
    writeFileSync(fakeDocker, '#!/bin/sh\nif [ "$2" = show ]; then printf "default\\n"; else printf "unix:///Users/test/.colima/default/docker.sock\\n"; fi\n');
    writeFileSync(fakeSupabase, '#!/bin/sh\nprintf "started\\n" > "$FRESH_STARTED"\n');
    chmodSync(fakeDocker, 0o700); chmodSync(fakeSupabase, 0o700);
    const result = spawnSync("bash", ["scripts/test-db-fresh.sh"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DOCKER_BIN: fakeDocker, SUPABASE_BIN: fakeSupabase, FRESH_ARTIFACT_DIR: `${fixture}/artifacts`, TMPDIR: fixture, FRESH_STARTED: `${fixture}/started` } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("active Docker context");
  });

  it("copies only the disposable config, migrations, seed, and database tests", () => {
    expect(source).toContain('cp "$repo_root/supabase/config.toml"');
    expect(source).toContain('cp -R "$repo_root/supabase/migrations"');
    expect(source).toContain('cp -R "$repo_root/supabase/tests"');
    expect(source).toContain('cp "$repo_root/supabase/seed.sql"');
    expect(source).toContain('"$supabase_bin" start --workdir');
    expect(source).toContain('"$supabase_bin" test db --local');
    expect(source).toContain("storage-api");
    expect(source).toContain("supabase/tests/database");
    expect(source).toContain("REDACTED");
    expect(source).toContain("Files=[1-9]");
    expect(source).toContain("Result: PASS");
  });
});
