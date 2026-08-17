import { describe, expect, it } from "vitest";
import {
  playwrightWebServerCommand,
  playwrightWorkerCount,
} from "./playwright-web-server";

describe("Playwright web server mode", () => {
  it("runs the built production artifact in CI", () => {
    expect(playwrightWebServerCommand({ ci: true, port: 3210 }))
      .toBe("npm run start -- --port 3210");
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

  it("preserves Playwright's default worker count in CI", () => {
    expect(playwrightWorkerCount({ ci: true })).toBeUndefined();
  });
});
