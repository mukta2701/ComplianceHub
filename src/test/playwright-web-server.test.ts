import { describe, expect, it } from "vitest";
import {
  playwrightPort,
  playwrightWebServerCommand,
  playwrightWorkerCount,
} from "./playwright-web-server";

describe("Playwright port", () => {
  it("uses the canonical app port unless a caller isolates the run", () => {
    expect(playwrightPort({})).toBe(3100);
    expect(playwrightPort({ PLAYWRIGHT_PORT: "3210" })).toBe(3210);
  });
});

describe("Playwright web server mode", () => {
  it("runs the built production artifact in CI", () => {
    expect(playwrightWebServerCommand({ ci: true, port: 3210 }))
      .toBe("bash scripts/playwright-production-server.sh 3210");
  });

  it("keeps the fast development server for local iteration", () => {
    expect(playwrightWebServerCommand({ ci: false, port: 3210 }))
      .toBe("npm run dev -- --port 3210");
  });
});

describe("Playwright worker count", () => {
  it("serializes local development-server runs", () => {
    expect(playwrightWorkerCount({ ci: false })).toBe(1);
  });

  it("serializes CI runs against the single local Supabase instance", () => {
    expect(playwrightWorkerCount({ ci: true })).toBe(1);
  });
});
