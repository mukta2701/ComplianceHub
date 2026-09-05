import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const BASE_ORIGIN = "http://127.0.0.1:3100";
const showcaseEnabled = process.env.SHOWCASE_REHEARSAL === "1";
const manifest = showcaseEnabled
  ? JSON.parse(readFileSync("artifacts/showcase-v1/manifest.json", "utf8")) as { ids: Record<string, string> }
  : { ids: {} };
const snapshotId = manifest.ids.soa_snapshot;

test.skip(!showcaseEnabled, "Set SHOWCASE_REHEARSAL=1 to run against the saved showcase session");
test.use({ storageState: showcaseEnabled ? "artifacts/showcase-v1/browser-session.json" : { cookies: [], origins: [] } });

async function clickPath(page: Page, path: string) {
  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await Promise.all([
    page.waitForURL(new URL(path, BASE_ORIGIN).toString()),
    page.locator(`a[href="${path}"]`).first().click(),
  ]);
}

async function checkPage(page: Page, label: string, errors: string[]) {
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(width.scroll, `${label} horizontal overflow`).toBeLessThanOrEqual(width.client);
  expect(errors, `${label} browser errors`).toEqual([]);
}

test("rehearses the saved connected showcase journey without writes", async ({ page }) => {
  test.setTimeout(120_000);
  expect(new URL(test.info().project.use.baseURL ?? BASE_ORIGIN).origin).toBe(BASE_ORIGIN);
  expect(snapshotId, "run demo:setup to finish the immutable showcase snapshot").toBeTruthy();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "failed";
    // Next cancels speculative RSC fetches when navigation supersedes them.
    // Each real navigation is separately required to reach its URL and content.
    if (failure === "net::ERR_ABORTED") return; // Browser navigation/download cancellation; content and files are verified below.
    errors.push(`request: ${request.url()} ${failure}`);
  });

  await page.goto("/app");
  const anonymousContext = await page.context().browser()!.newContext({ baseURL: BASE_ORIGIN, storageState: { cookies: [], origins: [] } });
  const anonymousPage = await anonymousContext.newPage();
  await anonymousPage.goto("/app");
  await expect(anonymousPage).toHaveURL(/\/sign-in$/);
  const anonymousExport = await anonymousPage.request.get("/api/app/evidence/export?format=csv", { maxRedirects: 0 });
  expect([401, 403, 307, 308]).toContain(anonymousExport.status());
  await anonymousContext.close();
  await checkPage(page, "dashboard", errors);

  await clickPath(page, "/app/assessment");
  await page.locator(`a[href="/app/assessment/${manifest.ids.assessment}"]`).click();
  await page.waitForURL(new RegExp(`/app/assessment/${manifest.ids.assessment}$`));
  await expect(page.getByText("This assessment is complete.")).toBeVisible();
  await expect(page.getByText(/10 of 10 answered/)).toBeVisible();
  await checkPage(page, "assessment", errors);

  await clickPath(page, "/app/soa");
  await expect(page.getByText("Finalised snapshots")).toBeVisible();
  await page.locator(`a[href="/app/soa/${manifest.ids.soa}"]`).click();
  await page.waitForURL(new RegExp(`/app/soa/${manifest.ids.soa}$`));
  await expect(page.getByText(/Preflight complete|reviewed/)).toBeVisible();
  await checkPage(page, "SoA", errors);
  await clickPath(page, "/app/soa");
  await expect(page.locator(`a[href="/api/app/soa/${snapshotId}/pdf"]`)).toHaveCount(1);
  const [soaDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(`a[href="/api/app/soa/${snapshotId}/pdf"]`).click(),
  ]);
  expect(soaDownload.suggestedFilename()).toMatch(/^statement-of-applicability-v.+\.pdf$/);
  expect(readFileSync((await soaDownload.path())!).subarray(0, 4).toString()).toBe("%PDF");

  await clickPath(page, "/app/risks");
  await page.locator(`a[href="/app/risks/${manifest.ids.risk}"]`).click();
  await page.waitForURL(new RegExp(`/app/risks/${manifest.ids.risk}$`));
  await expect(page.getByText("Treatment plans")).toBeVisible();
  await expect(page.getByText("Lead: Northstar Showcase Owner · target 2026-12-31", { exact: true })).toBeVisible();
  await checkPage(page, "risk", errors);

  await clickPath(page, "/app/risks");
  await page.locator(`a[href="/app/tasks/${manifest.ids.task}"]`).click();
  await page.waitForURL(new RegExp(`/app/tasks/${manifest.ids.task}$`));
  await expect(page.locator("h2").first()).toBeVisible();
  await expect(page.getByText(/Linked risk/)).toBeVisible();
  await checkPage(page, "treatment task", errors);

  await clickPath(page, "/app/evidence");
  await expect(page.locator("span.pill").filter({ hasText: "Policy: NS-POL-001: Northstar access review policy" })).toBeVisible();
  await expect(page.locator("span.pill").filter({ hasText: /^Risk NS-R-001/ })).toBeVisible();
  await expect(page.locator("span.pill").filter({ hasText: /^Task: Treatment plan NS-RTP-001/ })).toBeVisible();
  await expect(page.getByText("Task: undefined")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("span.pill").filter({ hasText: "Policy: NS-POL-001: Northstar access review policy" })).toBeVisible();
  await checkPage(page, "evidence", errors);

  await clickPath(page, "/app/audits");
  await page.locator(`a[href="/app/audits/${manifest.ids.audit}"]`).click();
  await page.waitForURL(new RegExp(`/app/audits/${manifest.ids.audit}$`));
  await expect(page.getByRole("heading", { name: "Northstar access governance review", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Audit checklist" })).toBeVisible();
  const [auditDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Evidence pack (XLSX)" }).click(),
  ]);
  expect(auditDownload.suggestedFilename()).toMatch(/^audit-pack-.+\.xlsx$/);
  await checkPage(page, "audit", errors);

  await clickPath(page, "/app/reports/readiness");
  await expect(page.getByRole("heading", { name: "Leadership readiness report" })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /Download PDF/i }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("readiness-report.pdf");
  expect(readFileSync((await download.path())!).subarray(0, 4).toString()).toBe("%PDF");
  await checkPage(page, "leadership report", errors);
});

test.describe("showcase Member permissions", () => {
  test.use({ storageState: showcaseEnabled ? "artifacts/showcase-v1/member-session.json" : { cookies: [], origins: [] } });
  test("shows the published report and blocks operator routes and APIs", async ({ page }) => {
    for (const route of ["/app/assessment", "/app/soa", "/app/evidence", "/app/risks/new", "/app/audits"]) {
      await page.goto(route);
      await expect(page).toHaveURL(`${BASE_ORIGIN}/app`);
    }
    const denied = await page.request.get("/api/app/evidence/export?format=csv");
    expect(denied.status()).toBe(403);
    await page.goto(`/app/policies/${manifest.ids.policy}`);
    await expect(page.getByRole("button", { name: "Save policy", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Northstar access review policy", exact: true })).toBeVisible();
    await page.goto("/app/reports/readiness");
    await expect(page.getByText("PUBLISHED REPORT", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish to members", exact: true })).toHaveCount(0);
    const report = await page.request.get("/api/app/reports/readiness/pdf");
    expect(report.status()).toBe(200);
    expect((await report.body()).subarray(0, 4).toString()).toBe("%PDF");
    await checkPage(page, "Member report", []);
  });
});
