import { describe, expect, it } from "vitest";

import {
  buildLocalEnvironment,
  parseLauncherArgs,
  validateLocalStatus,
  validateBuildRecord,
  hashSourceFiles,
  parseMigrationVersion,
  type LocalStatus,
} from "../../scripts/demo-local";

const status: LocalStatus = {
  API_URL: "http://127.0.0.1:54321",
  ANON_KEY: "anon-local-key",
  SERVICE_ROLE_KEY: "service-local-key",
};

describe("demo-local launcher", () => {
  it("accepts only the supported lifecycle commands", () => {
    expect(parseLauncherArgs(["build"])).toEqual({ command: "build", args: [] });
    expect(parseLauncherArgs(["start", "--", "--hostname", "127.0.0.1"])).toEqual({
      command: "start",
      args: ["--hostname", "127.0.0.1"],
    });
    expect(() => parseLauncherArgs(["shell"])).toThrow(/Unsupported command/);
    expect(() => parseLauncherArgs(["build", "--bad"])).toThrow(/Arguments must follow/);
  });

  it("rejects a hosted or mismatched Supabase target without exposing it", () => {
    expect(() => validateLocalStatus({ ...status, API_URL: "https://hosted-project.supabase.co" })).toThrow(
      /exact local Supabase API URL/,
    );
    expect(() => validateLocalStatus({ ...status, PROJECT_ID: "other-project" })).toThrow(/compliancehub/);
    expect(() => validateLocalStatus({ ...status, API_URL: "https://hosted-project.supabase.co" })).not.toThrow(
      "hosted-project.supabase.co",
    );
  });

  it("blanks inherited external provider secrets and sets deterministic local guards", () => {
    const environment = buildLocalEnvironment({
      HOSTED_SECRET: "ignored",
      JIRA_CLIENT_SECRET: "hosted-jira",
      GITHUB_APP_PRIVATE_KEY: "hosted-github",
      NANGO_SECRET_KEY: "hosted-nango",
      SLACK_ALLOWED_WEBHOOK_SHA256: "hosted-slack",
      RESEND_API_KEY: "hosted-resend",
      AI_API_KEY: "hosted-ai",
      NEXT_PUBLIC_SITE_URL: "https://hosted.example",
    } as unknown as NodeJS.ProcessEnv, status, "abc123");

    expect(environment.NEXT_PUBLIC_SUPABASE_URL).toBe(status.API_URL);
    expect(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(status.ANON_KEY);
    expect(environment.SUPABASE_SERVICE_ROLE_KEY).toBe(status.SERVICE_ROLE_KEY);
    expect(environment.NEXT_PUBLIC_SITE_URL).toBe("http://127.0.0.1:3100");
    expect(environment.COMPLIANCEHUB_RELEASE_SHA).toBe("abc123");
    expect(environment.JIRA_CLIENT_SECRET).toBe("");
    expect(environment.GITHUB_APP_PRIVATE_KEY).toBe("");
    expect(environment.NANGO_SECRET_KEY).toBe("");
    expect(environment.SLACK_ALLOWED_WEBHOOK_SHA256).toBe("");
    expect(environment.RESEND_API_KEY).toBe("");
    expect(environment.AI_API_KEY).toBe("");
    expect(environment.INTEGRATIONS_LIVE).toBe("");
    expect(environment.EVIDENCE_LIVE).toBe("");
    expect(environment.APP_ENCRYPTION_KEY).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(environment.CRON_SECRET).toMatch(/^compliancehub-local-demo-/);
    expect(environment.HOSTED_SECRET).toBe("ignored");
  });

  it("rejects a build record from another HEAD, API, or migration", () => {
    const record = { sha: "abc", sourceState: "clean", apiUrl: status.API_URL!, migration: "20260101", projectId: "compliancehub" as const };
    expect(() => validateBuildRecord(record, record)).not.toThrow();
    expect(() => validateBuildRecord(record, { ...record, sha: "def" })).toThrow(/source/);
    expect(() => validateBuildRecord(record, { ...record, apiUrl: "http://127.0.0.1:54322" })).toThrow(/database/);
    expect(() => validateBuildRecord(record, { ...record, migration: "20260102" })).toThrow(/migration/);
  });

  it("hashes file contents so edits in an already-dirty file are detected", () => {
    expect(hashSourceFiles([["src/app.ts", "one"]])).not.toBe(hashSourceFiles([["src/app.ts", "two"]]));
  });

  it("accepts only a concrete applied migration version", () => {
    expect(parseMigrationVersion("20260904210742\n")).toBe("20260904210742");
    expect(() => parseMigrationVersion("Local | Remote")).toThrow(/latest local migration/);
  });
});
