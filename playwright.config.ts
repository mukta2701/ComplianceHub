import { defineConfig, devices } from "@playwright/test";
import {
  playwrightWebServerCommand,
  playwrightWorkerCount,
} from "./src/test/playwright-web-server";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://127.0.0.1:${port}`;
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: playwrightWorkerCount({ ci: isCi }),
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  reporter: isCi ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: playwrightWebServerCommand({ ci: isCi, port }),
    url: baseURL,
    reuseExistingServer: !isCi,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
