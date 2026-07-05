import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function localEnvironment(name: string): string {
  if (process.env[name]) return process.env[name];
  const line = readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .find((candidate) => candidate.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is required for the Phase 1 end-to-end test`);
  return line.slice(name.length + 1);
}

async function createWorkspace(page: Page, suffix: string) {
  const email = `phase1-${suffix}@example.test`;
  const password = "Test-only-passphrase-2026";

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Phase One Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/sign-in/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Organisation name").fill(`Phase1 Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();
}

async function activate(button: Locator) {
  await button.focus();
  await button.press("Enter");
}

// The workspace nav is a horizontally scrollable strip on narrow viewports, so a
// link can be clipped out of the clickable area — scroll it in before clicking.
async function openSection(page: Page, name: string) {
  // On mobile the sidebar nav is off-canvas until the drawer is opened.
  const toggle = page.getByRole("button", { name: "Open navigation" });
  if (await toggle.isVisible()) await toggle.click();
  const link = page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name, exact: true });
  await link.scrollIntoViewIfNeeded();
  await link.click({ force: true });
  await page.waitForURL(new RegExp(`/app/${name.toLowerCase()}`));
}

test("demo exposes accessible workflow automation modules", async ({ page }) => {
  await page.goto("/demo/tasks");
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  await expect(page.getByText("Overdue").first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.goto("/demo/evidence");
  await expect(page.getByRole("heading", { name: "Evidence vault", level: 1 })).toBeVisible();
  await expect(page.getByText("Expired").first()).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a user runs the Phase 1 workflow loop", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const tomorrow = isoDate(1);
  const nextYear = isoDate(365);
  const yesterday = isoDate(-1);
  await createWorkspace(page, suffix);

  await openSection(page, "Tasks");
  await page.getByRole("button", { name: "Add starter calendar" }).click();
  await expect(page.getByText("Review user access rights")).toBeVisible();
  await expect(page.getByText("Test backup restoration")).toBeVisible();

  await page.getByRole("link", { name: "New task" }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(`Document incident reporting route ${suffix}`);
  await page.getByLabel("Due date").fill(tomorrow);
  await activate(page.getByRole("button", { name: "Create task" }));
  const manualTaskRow = page.getByRole("row", { name: new RegExp(`Document incident reporting route ${suffix}`) });
  await expect(manualTaskRow).toBeVisible();
  await manualTaskRow.getByRole("combobox").selectOption("done");
  await manualTaskRow.getByRole("button", { name: "Save" }).click();

  await openSection(page, "Evidence");
  await page.getByRole("link", { name: "Add evidence" }).click();
  const currentEvidenceTitle = `Access review minutes ${suffix}`;
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(currentEvidenceTitle);
  await page.getByLabel("Kind").selectOption("link");
  await page.getByLabel(/^URL/).fill("https://example.test/minutes");
  await page.getByLabel("Valid until").fill(nextYear);
  await activate(page.getByRole("button", { name: "Save evidence" }));
  const currentEvidence = page.getByRole("heading", { name: currentEvidenceTitle }).locator("xpath=ancestor::section");
  await expect(currentEvidence.getByText("current", { exact: true })).toBeVisible();
  await currentEvidence.getByLabel(`Link ${currentEvidenceTitle} to a control`).selectOption({ index: 1 });
  await activate(currentEvidence.getByRole("button", { name: "Link", exact: true }));
  await expect(currentEvidence.locator("span").filter({ hasText: /^CH-001:/ })).toBeVisible();

  await page.goto("/app/assessment");
  await page.getByRole("button", { name: "New assessment" }).click();
  const firstSave = page.waitForResponse((response) => response.url().includes("/api/app/assessment/response"));
  await page.getByRole("combobox").first().selectOption("no");
  expect((await firstSave).status()).toBe(200);
  await expect(page.getByText("saved", { exact: true }).first()).toBeVisible();

  await page.goto("/app/risks");
  const acceptAsTask = page.getByRole("link", { name: "Accept as task" }).first();
  await expect(acceptAsTask).toBeVisible();
  await acceptAsTask.click();
  const gapTitle = await page.getByRole("textbox", { name: "Title", exact: true }).inputValue();
  await expect(page.getByRole("textbox", { name: "Detail", exact: true })).not.toHaveValue("");
  await page.getByLabel("Owner").selectOption({ label: "Phase One Owner" });
  await page.getByLabel("Due date").fill(tomorrow);
  await activate(page.getByRole("button", { name: "Create task" }));
  await Promise.all([
    page.waitForURL(/\/app\/tasks\/[0-9a-f-]+$/),
    page.getByRole("link", { name: gapTitle }).click(),
  ]);
  const taskFact = (label: string) => page.locator("dt", { hasText: label }).locator("..").locator("dd");
  await expect(taskFact("Owner")).toHaveText("Phase One Owner");
  await expect(taskFact("Due date")).toContainText(tomorrow);
  await expect(taskFact("Source")).toHaveText("gap");
  const linkedControl = page.locator("dt", { hasText: "Linked control" }).locator("..").locator("dd");
  const linkedControlText = (await linkedControl.innerText()).trim();
  const controlCode = linkedControlText.split(":", 1)[0];
  expect(controlCode).toMatch(/^CH-\d{3}$/);

  await page.goto("/app/soa");
  await page.locator('select[name="assessmentId"]').selectOption({ index: 1 });
  await activate(page.getByRole("button", { name: "Generate draft" }));
  const soaTaskLink = page.getByRole("link", { name: /1 open task/ }).first();
  await expect(soaTaskLink).toBeVisible();
  await expect(soaTaskLink.locator("xpath=ancestor::form").getByRole("heading")).toBeVisible();

  await page.goto("/app/evidence/new");
  const staleEvidenceTitle = `Stale control evidence ${suffix}`;
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(staleEvidenceTitle);
  await page.getByLabel("Kind").selectOption("link");
  await page.getByLabel(/^URL/).fill("https://example.test/stale-evidence");
  await page.getByLabel("Owner").selectOption({ label: "Phase One Owner" });
  await page.getByLabel("Valid until").fill(yesterday);
  await activate(page.getByRole("button", { name: "Save evidence" }));
  const staleEvidence = page.getByRole("heading", { name: staleEvidenceTitle }).locator("xpath=ancestor::section");
  await expect(staleEvidence.getByText("expired", { exact: true })).toBeVisible();
  const controlOptions = await staleEvidence.getByLabel(`Link ${staleEvidenceTitle} to a control`).locator("option").allTextContents();
  const controlLabel = controlOptions.find((label) => label.startsWith(`${controlCode}:`));
  expect(controlLabel).toBeTruthy();
  await staleEvidence.getByLabel(`Link ${staleEvidenceTitle} to a control`).selectOption({ label: controlLabel! });
  await activate(staleEvidence.getByRole("button", { name: "Link", exact: true }));
  await expect(staleEvidence.locator("span").filter({ hasText: new RegExp(`^${controlCode}:`) })).toBeVisible();

  const headers = { authorization: `Bearer ${localEnvironment("CRON_SECRET")}` };
  const firstSweep = await request.post("/api/cron/daily", { headers });
  expect(firstSweep.ok()).toBe(true);
  const secondSweep = await request.post("/api/cron/daily", { headers });
  expect(secondSweep.ok()).toBe(true);

  await page.goto("/app/tasks");
  await expect(page.getByText(`Replace stale evidence: ${staleEvidenceTitle}`, { exact: true })).toHaveCount(1);
  await page.goto("/app/notifications");
  await expect(page.getByText(new RegExp(`Evidence "${staleEvidenceTitle}" is expired`))).toHaveCount(1);

  await page.goto("/app");
  await expect(page.getByText("Open tasks")).toBeVisible();
  await expect(page.getByText("Evidence items")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByText("Raised by daily sweep").first()).toBeVisible();
  await page.goto("/app/tasks");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto("/app/evidence");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
