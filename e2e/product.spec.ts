import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("landing page explains the product and opens the demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /security readiness/i })).toBeVisible();
  await expect(page.getByText(/does not provide certification/i)).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: /try the demo/i })).toHaveAttribute("href", /demo/);
});

test("demo exposes the complete compliance workflow", async ({ page }) => {
  await page.goto("/demo/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: /gap assessment/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /statement of applicability/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /risk register/i })).toBeVisible();
});

test("landing page has no automatically detectable accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("SoA exports produce real PDF and DOCX downloads", async ({ page }) => {
  await page.goto("/demo/soa");
  const pdf = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /export pdf/i }).click(),
  ]);
  expect(pdf[0].suggestedFilename()).toBe("compliancehub-statement-of-applicability.pdf");

  const docx = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /word/i }).click(),
  ]);
  expect(docx[0].suggestedFilename()).toBe("compliancehub-statement-of-applicability.docx");
});

test("a new user creates an isolated workspace and starts an assessment", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `beta-${suffix}@example.test`;
  const password = "Test-only-passphrase-2026";

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Beta Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL(/\/sign-in/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Create your organisation" })).toBeVisible();

  await page.getByLabel("Organisation name").fill(`Beta Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Assessment", exact: true }).click();
  await page.getByRole("button", { name: "New assessment" }).click();
  await expect(page.getByRole("heading", { name: /readiness assessment/i })).toBeVisible();
  const answers = page.getByRole("combobox");
  await expect(answers).toHaveCount(10);
  const firstSave = page.waitForResponse((response) => response.url().includes("/api/app/assessment/response"));
  await answers.nth(0).selectOption("partially");
  expect((await firstSave).status()).toBe(200);
  await expect(page.getByText("saved", { exact: true }).nth(0)).toBeVisible();
  await answers.nth(1).selectOption("yes");
  await expect(page.getByText("error", { exact: true })).toHaveCount(0);
});
