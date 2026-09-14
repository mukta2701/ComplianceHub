import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { siteUrl } from "@/lib/site-url";
import { playwrightPort } from "./playwright-web-server";
import playwrightConfig from "../../playwright.config";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

afterEach(() => vi.unstubAllEnvs());

describe("canonical application port", () => {
  it("uses 3100 for ordinary development, production start, and URL fallback", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");

    expect(packageJson.scripts.dev).toBe("PORT=3100 next dev");
    expect(packageJson.scripts.start).toBe("PORT=3100 next start");
    expect(siteUrl()).toBe("http://127.0.0.1:3100");
  });

  it("defaults browser verification to 3100 while preserving explicit overrides", () => {
    expect(playwrightPort({})).toBe(3100);
    expect(playwrightPort({ PLAYWRIGHT_PORT: "3210" })).toBe(3210);
    expect((playwrightConfig.use as { baseURL?: string }).baseURL).toBe("http://127.0.0.1:3100");
  });

  it("publishes 3100 in the active local and CI configuration", () => {
    expect(read(".env.example")).toContain("MCP_RESOURCE_URL=http://127.0.0.1:3100/mcp");
    expect(read(".env.example")).toContain("NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100");
    expect(read("README.md")).toContain('MCP_RESOURCE_URL="http://127.0.0.1:3100/mcp"');
    expect(read(".github/workflows/ci.yml")).toContain("NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100");
    expect(read("e2e/github-shadow-collection.spec.ts")).toContain('process.env.PLAYWRIGHT_PORT ?? "3100"');
  });

  it("routes the container and every Azure probe through 3100", () => {
    const dockerfile = read("Dockerfile");
    const bicep = read("infra/azure/application.bicep");

    expect(dockerfile).toMatch(/PORT=3100/);
    expect(dockerfile).toMatch(/EXPOSE 3100/);
    expect(bicep).toContain("targetPort: 3100");
    expect(bicep.match(/port: 3100/g)).toHaveLength(3);
  });

  it("documents current local cron checks on 3100", () => {
    const deployment = read("docs/deployment.md");

    expect(deployment.match(/http:\/\/localhost:3100\/api\/cron\//g)).toHaveLength(4);
  });
});
