import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/test-db-isolated.sh", "utf8");

describe("isolated database validation helper", () => {
  it("uses a unique local project and refuses remote Docker targets", () => {
    expect(source).toContain("compliancehub-isolated-");
    expect(source).toContain('DOCKER_HOST:-');
    expect(source).toContain('DOCKER_CONTEXT:-');
    expect(source).toContain('unix:///*');
    expect(source).toContain("--project-id \"$project_id\" --no-backup");
    expect(source).toContain("--exclude vector,mailpit");
    expect(source).not.toContain("supabase stop --all");
    expect(source).not.toContain("db reset --linked");
  });

  it("runs both fresh and upgrade migration paths in the isolated workdir", () => {
    expect(source).toContain('db reset --local --no-seed --workdir "$project_dir"');
    expect(source).toContain('db reset --local --no-seed --version 20260807047000 --workdir "$project_dir"');
    expect(source).toContain('migration up --local --workdir "$project_dir"');
    expect(source).toContain('test db --local --workdir "$project_dir"');
  });
});
