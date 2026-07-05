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

  // On mobile the sidebar nav is off-canvas until the drawer is opened.
  const navToggle = page.getByRole("button", { name: "Open navigation" });
  if (await navToggle.isVisible()) await navToggle.click();
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

test("an asset is added to the inventory and the list is accessible", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `ast-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`AST Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Reach the asset inventory through the workspace nav.
  const navToggle = page.getByRole("button", { name: "Open navigation" });
  if (await navToggle.isVisible()) await navToggle.click();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Asset inventory", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "Add asset" }).click();
  await expect(page.getByRole("heading", { name: "Add asset" })).toBeVisible();
  await page.getByLabel("Reference", { exact: true }).fill("AST-001");
  await page.getByLabel("Description").fill("Customer database");
  await page.locator("select[name=classification]").selectOption("highly_confidential");
  await page.locator("select[name=valueCriticality]").selectOption("high");
  await page.getByRole("button", { name: "Save asset" }).click();

  await expect(page.getByRole("heading", { name: "Asset inventory", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Customer database" })).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  // Create a risk to link to the asset.
  await page.goto("/app/risks/new");
  await page.getByLabel("Reference", { exact: true }).fill("R-001");
  await page.getByLabel("Title").fill("Unencrypted laptops");
  await page.getByLabel("Description").fill("Endpoints hold data at rest without disk encryption.");
  await page.locator("select[name=categoryId]").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save risk" }).click();
  await expect(page.getByRole("heading", { name: "Risk register" })).toBeVisible();

  // Open the asset detail page and link the risk.
  await page.goto("/app/assets");
  await page.getByRole("link", { name: "Customer database" }).click();
  await expect(page.getByRole("heading", { name: "Customer database" })).toBeVisible();
  await page.getByLabel(/Link a risk to/).selectOption({ label: "R-001: Unencrypted laptops" });
  await page.getByRole("button", { name: "Link risk" }).click();
  await expect(page.getByRole("link", { name: "R-001: Unencrypted laptops" })).toBeVisible();

  const detailAxe = await new AxeBuilder({ page }).analyze();
  expect(detailAxe.violations).toEqual([]);
});

test("a treatment plan spawns an owned, dated task", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `rtp-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`RTP Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Create a risk to attach a treatment plan to.
  await page.goto("/app/risks/new");
  await page.getByLabel("Reference", { exact: true }).fill("R-001");
  await page.getByLabel("Title").fill("Unencrypted laptops");
  await page.getByLabel("Description").fill("Endpoints hold data at rest without disk encryption.");
  await page.locator("select[name=categoryId]").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save risk" }).click();
  await expect(page.getByRole("heading", { name: "Risk register" })).toBeVisible();

  // Open its detail page and add a treatment plan that spawns a task.
  await page.getByRole("link", { name: "Unencrypted laptops" }).click();
  await expect(page.getByRole("heading", { name: "Treatment plans" })).toBeVisible();
  await page.getByLabel("Reference", { exact: true }).fill("RTP-001");
  await page.locator("select[name=assignedLeadId]").selectOption({ index: 1 });
  await page.getByLabel("Target completion").fill("2026-12-31");
  await page.getByLabel(/create an owned, dated task/).check();
  await page.getByRole("button", { name: "Add treatment plan" }).click();

  await expect(page.getByText("RTP-001")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  await page.goto("/app/tasks");
  await expect(page.getByText("Treatment plan RTP-001")).toBeVisible();
});

test("every register can be downloaded as an XLSX export", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `exp-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`Export Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Seed an assessment session so the assessment export has a session to default to.
  await page.goto("/app/assessment");
  await page.getByRole("button", { name: "New assessment" }).click();
  await expect(page.getByRole("heading", { name: /readiness assessment/i })).toBeVisible();

  // Generate an SoA draft from that assessment so the SoA export finds a register.
  // The dropdown is server-rendered, so re-navigate until the seeded assessment appears.
  const assessmentSelect = page.locator("select[name=assessmentId]");
  await expect(async () => {
    await page.goto("/app/soa");
    await expect(assessmentSelect.locator("option")).not.toHaveCount(1);
  }).toPass({ timeout: 15000 });
  await assessmentSelect.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Generate draft" }).click();
  await page.waitForURL(/\/app\/soa\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Statement of Applicability", level: 1 })).toBeVisible();

  for (const path of ["/api/app/risks/export?format=xlsx", "/api/app/soa/export?format=xlsx", "/api/app/assets/export?format=xlsx", "/api/app/tasks/export?format=xlsx", "/api/app/evidence/export?format=xlsx", "/api/app/assessment/export?format=xlsx"]) {
    const res = await page.request.get(path);
    expect(res.ok(), `${path} should return 200`).toBeTruthy();
    const body = await res.body();
    expect(body.length).toBeGreaterThan(0);
    expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
  }
});
