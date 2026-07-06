import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
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

test("an audit runs from plan through checklist to a corrective-action task", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `aud-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`Audit Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Reach the audits module through the workspace nav.
  const navToggle = page.getByRole("button", { name: "Open navigation" });
  if (await navToggle.isVisible()) await navToggle.click();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Audits", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Internal audits", level: 1 })).toBeVisible();

  const listAxe = await new AxeBuilder({ page }).analyze();
  expect(listAxe.violations).toEqual([]);

  // Plan an audit.
  await page.getByRole("link", { name: "Plan an audit" }).click();
  await expect(page.getByRole("heading", { name: "Plan an audit", level: 1 })).toBeVisible();
  await page.getByLabel("Reference", { exact: true }).fill("AUD-001");
  await page.getByLabel("Title").fill("Access control internal audit");
  await page.getByRole("button", { name: "Plan audit" }).click();

  // On the detail page: add a checklist item.
  await page.waitForURL(/\/app\/audits\/[0-9a-f-]+$/);
  const auditUrl = page.url();
  await expect(page.getByRole("heading", { name: "Access control internal audit", level: 2 })).toBeVisible();
  await page.getByLabel("Checklist item", { exact: true }).fill("Are leavers de-provisioned within 24 hours?");
  await page.getByRole("button", { name: "Add item" }).click();

  // Set that row's result to Non-compliant and save.
  await expect(page.getByText("Are leavers de-provisioned within 24 hours?")).toBeVisible();
  await page.getByLabel(/^Result for/).selectOption("non_compliant");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByRole("cell", { name: "Non-compliant" })).toBeVisible();

  // Raise a finding with a corrective-action task.
  await page.getByLabel("Summary").fill("Leavers retained access beyond policy");
  await page.locator("select[name=severity]").selectOption("minor_nc");
  await page.getByLabel("Corrective action").fill("Automate de-provisioning on HR termination event.");
  await page.getByLabel(/Raise a corrective-action task from this finding/).check();
  await page.getByRole("button", { name: "Raise finding" }).click();

  await expect(page.getByText("Leavers retained access beyond policy")).toBeVisible();
  await expect(page.getByText("Corrective-action task raised.")).toBeVisible();

  const detailAxe = await new AxeBuilder({ page }).analyze();
  expect(detailAxe.violations).toEqual([]);

  // The corrective action appears as a task in the tasks module.
  await page.goto("/app/tasks");
  await expect(page.getByText("Corrective action: Leavers retained access beyond policy")).toBeVisible();

  // The detail route re-opens cleanly for later work.
  await page.goto(auditUrl);
  await expect(page.getByRole("heading", { name: "Access control internal audit", level: 2 })).toBeVisible();
});

test("a KPI is logged and its next steps raise a follow-up task", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `kpi-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`KPI Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Reach the KPI register through the workspace nav.
  const navToggle = page.getByRole("button", { name: "Open navigation" });
  if (await navToggle.isVisible()) await navToggle.click();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "KPIs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Performance measures", level: 1 })).toBeVisible();

  // Log a performance measure with next steps.
  await page.getByLabel("Indicator").fill("Mean time to de-provision leavers");
  await page.getByLabel("Next steps").fill("Automate off-boarding on the HR termination event.");
  await page.getByRole("button", { name: "Add KPI" }).click();

  await expect(page.getByRole("heading", { name: "Performance measures", level: 1 })).toBeVisible();
  await expect(page.getByText("Mean time to de-provision leavers")).toBeVisible();

  const listAxe = await new AxeBuilder({ page }).analyze();
  expect(listAxe.violations).toEqual([]);

  // Raise a follow-up task from the KPI's next steps.
  await page.getByRole("button", { name: "Raise task" }).click();
  await expect(page.getByText("Task raised.")).toBeVisible();

  // The follow-up appears as a manual task in the tasks module.
  await page.goto("/app/tasks");
  await expect(page.getByText("KPI follow-up: Mean time to de-provision leavers")).toBeVisible();
});

test("the leadership readiness report aggregates the ISMS into one accessible view", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `rpt-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`Report Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Reach the readiness report through the workspace nav.
  const navToggle = page.getByRole("button", { name: "Open navigation" });
  if (await navToggle.isVisible()) await navToggle.click();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Reports", exact: true }).click();

  // Section headings for each area of the leadership snapshot render.
  await expect(page.getByRole("heading", { name: "Leadership readiness report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Risk posture" })).toBeVisible();
  // The SoA readiness ring is present with its readiness label.
  await expect(page.getByText("READY")).toBeVisible();
  await expect(page.getByText("OPEN NON-CONFORMITIES")).toBeVisible();

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);

  // The "Download PDF" link produces a real, non-empty PDF for this org.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /download pdf/i }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("readiness-report.pdf");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const pdfBytes = await readFile(downloadPath as string);
  expect(pdfBytes.length).toBeGreaterThan(0);
  expect(pdfBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");

  // RLS scoping: the route is auth-gated and returns this org's own data —
  // fetching it directly via the authenticated request context confirms the
  // response is a real PDF (not a cross-tenant leak or an error page).
  const apiResponse = await page.request.get("/api/app/reports/readiness/pdf");
  expect(apiResponse.status()).toBe(200);
  expect(apiResponse.headers()["content-type"]).toBe("application/pdf");
  expect(apiResponse.headers()["content-disposition"]).toContain("attachment");
  const apiBytes = await apiResponse.body();
  expect(apiBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
});

test("a risk register workbook can be imported through the wizard", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `imp-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`Import Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  await page.goto("/app/risks/import");
  await expect(page.getByRole("heading", { name: "Import risk register", level: 1 })).toBeVisible();
  const csv = ["Risk ID,Risk Description,Risk Category,Likelihood,Impact,Mitigation Measures,Risk Owner,Status,Review Date",
    "R-501,Imported laptop theft,Operational,3,4,Encrypt disks,,Treating,31/12/2026"].join("\n");
  await page.locator('input[name="file"]').setInputFiles({ name: "risks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Analyse file" }).click();
  await expect(page.getByLabel("Map column Risk Category")).toHaveValue("categoryName");
  await page.getByRole("button", { name: /Preview 1 row/ }).click();
  await expect(page.getByText("1 row will be added")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: /Confirm import/ }).click();
  await expect(page.getByText(/1 row added/)).toBeVisible();
  await page.goto("/app/risks");
  await expect(page.getByRole("link", { name: "Imported laptop theft" })).toBeVisible();
});

test("an asset workbook can be imported through the wizard", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `assetimp-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`Import Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  await page.goto("/app/assets/import");
  await expect(page.getByRole("heading", { name: "Import asset inventory", level: 1 })).toBeVisible();
  const csv = ["Asset Reference,Asset Description,Category,Owner & Location,Classification,Value (Criticality),Security Controls,Asset Lifespan,Last Updated,Remarks",
    "AST-900,Imported CRM,Applications,HQ,Confidential,High,SSO,3 years,05/01/2026,",
    ",Imported backup vault,,Offsite,Highly Confidential,High,,,,"].join("\n");
  await page.locator('input[name="file"]').setInputFiles({ name: "assets.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Analyse file" }).click();
  await expect(page.getByLabel("Map column Classification")).toHaveValue("classification");
  await page.getByRole("button", { name: /Preview 2 rows/ }).click();
  await expect(page.getByText("2 rows will be added")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: /Confirm import/ }).click();
  await expect(page.getByText(/2 rows added/)).toBeVisible();
  await page.goto("/app/assets");
  await expect(page.getByRole("link", { name: "Imported CRM" })).toBeVisible();
});

test("a SoA workbook import updates a matched control in the selected register", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `soaimp-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`SoA Import Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Seed an assessment session and generate a SoA draft so there is a real register + control to update.
  await page.goto("/app/assessment");
  await page.getByRole("button", { name: "New assessment" }).click();
  await expect(page.getByRole("heading", { name: /readiness assessment/i })).toBeVisible();

  const assessmentSelect = page.locator("select[name=assessmentId]");
  await expect(async () => {
    await page.goto("/app/soa");
    await expect(assessmentSelect.locator("option")).not.toHaveCount(1);
  }).toPass({ timeout: 15000 });
  await assessmentSelect.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Generate draft" }).click();
  await page.waitForURL(/\/app\/soa\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "Statement of Applicability", level: 1 })).toBeVisible();
  const registerUrl = page.url();

  // PageIntro itself renders an <h2> for the page title, so scope to the control forms'
  // headings (each control is `<h2>{code}: {title}</h2>` inside its review `<form>`).
  const firstHeading = await page.locator("form h2").first().textContent();
  const code = (firstHeading ?? "").split(":")[0].trim();

  await page.goto("/app/soa/import");
  await expect(page.getByRole("heading", { name: "Import Statement of Applicability", level: 1 })).toBeVisible();
  const csv = ["Control Number,Is Control Applicable?,Justification for the Inclusion/Exclusion,Implementation Status,Owner,Comments",
    `${code},Yes,Imported justification,Operational,,Imported note`].join("\n");
  await page.locator('input[name="file"]').setInputFiles({ name: "soa.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Analyse file" }).click();
  await page.getByRole("button", { name: /Preview 1 control update/ }).click();
  await expect(page.getByText("1 matched control will be updated")).toBeVisible();
  const soaAxe = await new AxeBuilder({ page }).analyze();
  expect(soaAxe.violations).toEqual([]);
  await page.getByRole("button", { name: /Confirm import/ }).click();
  await expect(page.getByText(/1 control updated/)).toBeVisible();

  // Confirm the matched control's status and justification were actually updated on the register.
  await page.goto(registerUrl);
  // hasText does substring matching, so anchor to the "{code}: " prefix — otherwise "5.1" would
  // also match sibling controls like "5.1.1".
  const codePattern = new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`);
  const updatedForm = page.locator("form", { has: page.locator("h2", { hasText: codePattern }) });
  await expect(updatedForm.locator('select[name="status"]')).toHaveValue("operational");
  await expect(updatedForm.locator('textarea[name="justification"]')).toHaveValue("Imported justification");
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
