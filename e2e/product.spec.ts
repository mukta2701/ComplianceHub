import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, request, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Reads a value from the process env, falling back to .env.local (Playwright's
// test process does not load Next's env file). Used only by test infrastructure.
function localEnvironment(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  const line = readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .find((candidate) => candidate.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is required for this end-to-end test`);
  return line.slice(name.length + 1);
}

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

  // A brand-new workspace sees the first-run onboarding checklist: "Create your
  // workspace" is already done, and at least one actionable step is offered.
  const checklist = page.locator(".onboarding-card");
  await expect(checklist.getByRole("heading", { name: "Get certification-ready" })).toBeVisible();
  const workspaceStep = checklist.locator("li", { hasText: "Create your workspace" });
  await expect(workspaceStep.getByText("Done")).toBeVisible();
  const assessmentStep = checklist.locator("li", { hasText: "Run your first readiness assessment" });
  await expect(assessmentStep.getByRole("link", { name: /Start assessment/ })).toBeVisible();

  // Accessibility on the dashboard with the checklist rendered.
  const dashAxe = await new AxeBuilder({ page }).analyze();
  expect(dashAxe.violations).toEqual([]);

  // On mobile the sidebar nav is off-canvas until the drawer is opened.
  const navToggle = page.getByRole("button", { name: "Open navigation" });
  if (await navToggle.isVisible()) await navToggle.click();
  await page.getByRole("link", { name: "Gap assessment", exact: true }).click();
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

test("an audit runs from plan through checklist to a corrective-action task", async ({ page, browser }, testInfo) => {
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

  // One-click populate the checklist from the Annex A control library (93
  // controls). It is idempotent: a second click adds no duplicates.
  const checklistRows = page.locator("table").first().locator("tbody tr");
  await page.getByRole("button", { name: "Populate from control library" }).click();
  await expect(page.getByText("Is the control 'Direction for security policy' implemented and operating effectively?")).toBeVisible();
  const populatedCount = await checklistRows.count();
  expect(populatedCount).toBeGreaterThan(90);
  await page.getByRole("button", { name: "Populate from control library" }).click();
  await expect(page.getByText("Is the control 'Direction for security policy' implemented and operating effectively?")).toBeVisible();
  expect(await checklistRows.count(), "re-running must not duplicate rows").toBe(populatedCount);

  // Set that row's result to Non-compliant and save.
  await expect(page.getByText("Are leavers de-provisioned within 24 hours?")).toBeVisible();
  const leaverRow = checklistRows.filter({ hasText: "Are leavers de-provisioned within 24 hours?" });
  await leaverRow.getByLabel("Result for Are leavers de-provisioned within 24 hours?").selectOption("non_compliant");
  await leaverRow.getByRole("button", { name: "Save", exact: true }).click();
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

  // The evidence pack can be downloaded as XLSX or CSV, bundling the checklist and findings.
  const auditId = new URL(auditUrl).pathname.split("/").pop();
  const xlsxRes = await page.request.get(`/api/app/audits/${auditId}/pack?format=xlsx`);
  expect(xlsxRes.ok(), "xlsx pack should return 200").toBeTruthy();
  expect(xlsxRes.headers()["content-type"]).toContain("spreadsheetml");
  expect(xlsxRes.headers()["content-disposition"]).toContain("attachment");
  const xlsxBody = await xlsxRes.body();
  expect(xlsxBody.length).toBeGreaterThan(0);
  expect(xlsxBody.subarray(0, 2).toString("latin1")).toBe("PK");

  const csvRes = await page.request.get(`/api/app/audits/${auditId}/pack?format=csv`);
  expect(csvRes.ok(), "csv pack should return 200").toBeTruthy();
  expect(csvRes.headers()["content-type"]).toContain("text/csv");
  expect(csvRes.headers()["content-disposition"]).toContain("attachment");
  const csvBody = await csvRes.text();
  expect(csvBody.length).toBeGreaterThan(0);
  expect(csvBody).toContain("Are leavers de-provisioned within 24 hours?");
  expect(csvBody).toContain("Leavers retained access beyond policy");

  // Unauthenticated requests to the pack route are rejected (tenant/RLS boundary check).
  const anonContext = await request.newContext();
  const anonRes = await anonContext.get(`${new URL(auditUrl).origin}/api/app/audits/${auditId}/pack?format=csv`);
  expect(anonRes.status()).toBe(401);
  await anonContext.dispose();

  // Share with an auditor: the owner mints an AUDIT-SCOPED, read-only link.
  await page.goto(auditUrl);
  await expect(page.getByRole("heading", { name: "Share with an auditor" })).toBeVisible();
  await page.getByLabel("Label", { exact: true }).fill("External ISO auditor");
  // Scope defaults to "This audit" and expiry to 14 days — leave them. Mint it.
  await page.getByRole("button", { name: "Create link" }).click();

  // The raw link is surfaced exactly ONCE in the status card; capture it.
  await expect(page.getByRole("status")).toBeVisible();
  const shownLink = await page.locator("code").filter({ hasText: "/audit-view/" }).first().textContent();
  expect(shownLink, "the one-time link should render").toMatch(/^\/audit-view\/.+/);
  const auditorToken = shownLink!.replace("/audit-view/", "");

  // Axe on the audit detail page WITH the share panel and the one-time link card.
  const shareAxe = await new AxeBuilder({ page }).analyze();
  expect(shareAxe.violations).toEqual([]);

  // A FRESH, genuinely logged-out context opens the minted link and sees the
  // AUDIT-SCOPED read-only report — closing Task 16's untested audit branch.
  const auditor = await browser.newContext();
  const auditorPage = await auditor.newPage();
  await auditorPage.goto(`/audit-view/${auditorToken}`);
  await expect(auditorPage.getByRole("heading", { level: 1, name: /— readiness$/ })).toBeVisible();
  await expect(auditorPage.getByText("OPEN NON-CONFORMITIES")).toBeVisible();
  // The audit section renders: reference/title heading, the checklist item, and the finding.
  await expect(auditorPage.getByRole("heading", { name: "AUD-001: Access control internal audit", level: 2 })).toBeVisible();
  await expect(auditorPage.getByText("Are leavers de-provisioned within 24 hours?")).toBeVisible();
  await expect(auditorPage.getByText("Leavers retained access beyond policy")).toBeVisible();
  expect((await new AxeBuilder({ page: auditorPage }).analyze()).violations).toEqual([]);
  await auditor.close();

  // Revoking the link from the owner UI invalidates it immediately.
  await page.goto(auditUrl);
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await expect(page.getByText("Revoked")).toBeVisible();

  const revoked = await browser.newContext();
  const revokedPage = await revoked.newPage();
  await revokedPage.goto(`/audit-view/${auditorToken}`);
  await expect(revokedPage.getByRole("heading", { name: "Link unavailable", level: 1 })).toBeVisible();
  await expect(revokedPage.getByText(/— readiness$/)).toHaveCount(0);
  await revoked.close();
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

  // Record two readings for the KPI and assert the trend reflects the latest
  // value and the delta/direction versus the previous reading.
  const kpiRow = page.getByRole("row", { name: /Mean time to de-provision leavers/ });
  await kpiRow.getByLabel(/^Measurement value/).fill("12");
  await kpiRow.getByLabel(/^Measurement date/).fill("2026-07-01");
  await kpiRow.getByRole("button", { name: "Record" }).click();
  await expect(page.getByText("12 (1 Jul)")).toBeVisible();

  await kpiRow.getByLabel(/^Measurement value/).fill("20");
  await kpiRow.getByLabel(/^Measurement date/).fill("2026-07-02");
  await kpiRow.getByRole("button", { name: "Record" }).click();
  // Latest reading is 20, up +8 on the previous reading of 12.
  await expect(kpiRow.getByText("20 (2 Jul)")).toBeVisible();
  await expect(kpiRow.getByText("+8")).toBeVisible();

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
    // The SoA page shows an empty state (no select) until the seeded assessment is
    // server-rendered — wait for the select itself, then for the seeded option, so
    // the retry doesn't pass vacuously while the empty state is still showing.
    await expect(assessmentSelect).toBeVisible();
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
    // The SoA page shows an empty state (no select) until the seeded assessment is
    // server-rendered — wait for the select itself, then for the seeded option, so
    // the retry doesn't pass vacuously while the empty state is still showing.
    await expect(assessmentSelect).toBeVisible();
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

test("a minted auditor link exposes a read-only view to an unauthenticated visitor", async ({ page, browser }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `avw-${suffix}@example.test`;
  const password = "Test-only-passphrase-2026";
  const orgName = `Audit View Workspace ${suffix}`;

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
  await page.getByLabel("Organisation name").fill(orgName);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Task 17 (the owner-only mint UI) is not built yet, so seed an auditor token
  // through the SAME owner-only, RLS-enforced path it will use: sign in as the
  // owner with the ANON key and insert their own token (the insert policy
  // requires is_organisation_owner + created_by = auth.uid()). No service-role
  // client is used anywhere in this test. The raw token is never stored — only
  // its sha256 hex hash, mirroring the RPC's lookup.
  const rawToken = `e2e-token-${suffix}`;
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  const owner = createClient(
    localEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    localEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: session, error: signInError } = await owner.auth.signInWithPassword({ email, password });
  expect(signInError, "the owner should sign in for token seeding").toBeNull();
  const { data: org } = await owner.from("organisations").select("id").eq("name", orgName).single();
  expect(org, "the owner should read their own workspace").not.toBeNull();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error: insertError } = await owner.from("auditor_access_tokens").insert({
    organisation_id: org!.id,
    token_hash: tokenHash,
    label: "e2e auditor",
    framework: "ISO 27001:2022",
    expires_at: expiresAt,
    created_by: session.user!.id,
  });
  expect(insertError, "seeding the auditor token should succeed").toBeNull();

  // A FRESH context with no storage state — a genuinely logged-out auditor.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`/audit-view/${rawToken}`);

  // The org's readiness payload renders (h1 + the SoA readiness ring + the
  // aggregate stat sections), exercising the full RPC payload end-to-end.
  await expect(anonPage.getByRole("heading", { name: `${orgName} — readiness`, level: 1 })).toBeVisible();
  await expect(anonPage.getByText("READY")).toBeVisible();
  await expect(anonPage.getByText("OPEN TASKS")).toBeVisible();
  await expect(anonPage.getByText("EVIDENCE HEALTH")).toBeVisible();
  await expect(anonPage.getByText("OPEN NON-CONFORMITIES")).toBeVisible();
  await expect(anonPage.getByRole("heading", { name: "Risk posture" })).toBeVisible();

  // No links into the authenticated app and no action controls leak onto the
  // page. Scope to the page's own <main> so Next.js's dev-only toolbar (injected
  // at the body level, absent in a production build) does not skew the count.
  const view = anonPage.locator("main");
  expect(await view.locator('a[href^="/app"]').count()).toBe(0);
  expect(await view.getByRole("button").count()).toBe(0);

  // Accessibility: zero automatically detectable violations on the public page.
  expect((await new AxeBuilder({ page: anonPage }).analyze()).violations).toEqual([]);

  // A bogus / expired / revoked token reveals nothing — just the invalid-link card.
  await anonPage.goto("/audit-view/expired-or-bogus-token");
  await expect(anonPage.getByRole("heading", { name: "Link unavailable", level: 1 })).toBeVisible();
  await expect(anonPage.getByText(`${orgName} — readiness`)).toHaveCount(0);

  await anon.close();
});

test("a policy is authored, approved, accepted, and re-accepted after a material edit", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `pol-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`Policy Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Reach the policy library through the workspace nav.
  const navToggle = page.getByRole("button", { name: "Open navigation" });
  if (await navToggle.isVisible()) await navToggle.click();
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Policies", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Policy library", level: 1 })).toBeVisible();

  const listAxe = await new AxeBuilder({ page }).analyze();
  expect(listAxe.violations).toEqual([]);

  // Author a policy — starting from a starter template.
  await page.getByRole("link", { name: "New policy" }).click();
  await expect(page.getByRole("heading", { name: "Author a policy", level: 2 })).toBeVisible();

  // The template picker renders with zero accessibility violations.
  await expect(page.getByRole("heading", { name: "Start from a template", level: 2 })).toBeVisible();
  const pickerAxe = await new AxeBuilder({ page }).analyze();
  expect(pickerAxe.violations).toEqual([]);

  // Picking a template pre-fills the reference, title and body from that template.
  await page.getByRole("link", { name: /Information Security Policy/ }).click();
  await page.waitForURL(/\/app\/policies\/new\?template=information-security$/);
  await expect(page.getByLabel("Reference", { exact: true })).toHaveValue("POL-001");
  await expect(page.getByLabel("Title")).toHaveValue("Information Security Policy");
  await expect(page.getByLabel("Policy content")).not.toHaveValue("");

  // The author edits the pre-filled fields and creates the policy as normal.
  await page.getByLabel("Reference", { exact: true }).fill("POL-001");
  await page.getByLabel("Title").fill("Access Control Policy");
  await page.getByLabel("Policy content").fill("Access to systems is granted on least privilege.");
  await page.getByRole("button", { name: "Create policy" }).click();

  // On the detail page (owner is the signed-in user): approve, then accept.
  await page.waitForURL(/\/app\/policies\/[0-9a-f-]+$/);
  const policyUrl = page.url();
  await expect(page.getByText("POLICY POL-001 · v1")).toBeVisible();
  await page.getByRole("button", { name: "Approve policy" }).click();

  await page.getByRole("button", { name: "I accept this policy" }).click();
  // Accepted state now reads as a clear "done" pill, not a pale disabled button.
  await expect(page.getByText("Accepted version 1")).toBeVisible();
  await expect(page.getByText("Accepted v1")).toBeVisible();

  const detailAxe = await new AxeBuilder({ page }).analyze();
  expect(detailAxe.violations).toEqual([]);

  // A material content edit bumps the version and invalidates the prior acceptance.
  // The edit form lives behind an "Edit policy" disclosure — open it first.
  await page.getByText("Edit policy", { exact: true }).click();
  await page.getByLabel("Policy content").fill("Access to systems is granted on least privilege and reviewed quarterly.");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("POLICY POL-001 · v2")).toBeVisible();
  await expect(page.getByText("Re-accept (accepted v1)")).toBeVisible();

  // The re-accept notification is posted to the member; Notifications is
  // reached via the header bell now that it has left the sidebar.
  await page.getByRole("link", { name: /Notifications/ }).click();
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
  await expect(page.getByText(/POL-001 changed — please review and re-accept/i)).toBeVisible();

  // The detail route re-opens cleanly at the new version.
  await page.goto(policyUrl);
  await expect(page.getByText("POLICY POL-001 · v2")).toBeVisible();

  // Author an evidence record so it can be attached to the policy.
  await page.goto("/app/evidence/new");
  await expect(page.getByRole("heading", { name: "Add evidence", level: 2 })).toBeVisible();
  await page.getByLabel("Title").fill("Access review log");
  await page.getByLabel("Kind").selectOption("note");
  await page.getByRole("button", { name: "Save evidence" }).click();
  await page.waitForURL(/\/app\/evidence$/);

  // Link the evidence to the policy from the policy detail Evidence panel.
  await page.goto(policyUrl);
  await expect(page.getByText("No evidence linked yet.")).toBeVisible();
  await page.getByLabel("Link evidence to this policy").selectOption({ label: "Access review log" });
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Access review log" })).toBeVisible();

  const evidenceAxe = await new AxeBuilder({ page }).analyze();
  expect(evidenceAxe.violations).toEqual([]);
});

test("a task is pushed to a sandbox tracker, polled to In Progress, then the connection is revoked", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `int-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`Integrations Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Create an owned task and capture its detail URL — this is the existing task
  // that gets pushed to the tracker further down.
  await page.goto("/app/tasks/new");
  await page.getByLabel("Title", { exact: true }).fill("Ship the tracker integration");
  await page.getByRole("button", { name: "Create task" }).click();
  await page.waitForURL(/\/app\/tasks$/);
  await page.getByRole("link", { name: "Ship the tracker integration" }).click();
  await page.waitForURL(/\/app\/tasks\/[0-9a-f-]+$/);
  const taskUrl = page.url();
  const taskId = new URL(taskUrl).pathname.split("/").pop() as string;

  // 1. Open Integrations (FAKE provider is the dev default; INTEGRATIONS_LIVE is
  //    not set). The nav link is the last of 15 items in a fixed 100vh sidebar
  //    with no scroll, so it clips below the viewport — reach the page directly.
  //    Provider defaults to Jira.
  await page.goto("/app/integrations");
  await expect(page.getByRole("heading", { name: "Ticketing integrations", level: 1 })).toBeVisible();
  // The page carries a second "Label" input (the evidence-sources section), so
  // scope this fill to the ticketing connection form.
  const connectionForm = page.locator("form", { has: page.getByRole("button", { name: "Add connection" }) });
  await connectionForm.getByLabel("Label", { exact: true }).fill("Sandbox Jira");
  await page.getByRole("button", { name: "Add connection" }).click();
  const connection = page.getByRole("listitem").filter({ hasText: "Sandbox Jira" });
  await expect(connection.getByText("Active")).toBeVisible();

  // 2. Axe on the integrations page.
  const integrationsAxe = await new AxeBuilder({ page }).analyze();
  expect(integrationsAxe.violations).toEqual([]);

  // 3. Push the existing task to the tracker; the FAKE provider mints a "To Do"
  //    ticket and the send-to-tracker form is replaced by the ticket chip.
  await page.goto(taskUrl);
  await page.getByRole("button", { name: "Send to tracker" }).click();
  await expect(page.getByText(/FAKE-.+: To Do/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send to tracker" })).toHaveCount(0);

  // 4. Simulate a poll. The push stamps last_synced_at = now, and the sweep only
  //    re-syncs tickets older than the 30-minute window, so first age this
  //    ticket through the owner's own RLS-scoped client (anon key, no service
  //    role — members may update task_tickets) to simulate the window elapsing,
  //    then run the CRON_SECRET-gated sweep. The secret is read from the env the
  //    same way the daily-sweep e2e does (localEnvironment falls back to
  //    .env.local, which the dev server also loads, so they match). If it is
  //    genuinely unavailable, skip the poll assertion rather than guess a secret.
  let cronSecret: string | null = null;
  try { cronSecret = localEnvironment("CRON_SECRET"); } catch { cronSecret = null; }
  if (cronSecret) {
    const owner = createClient(
      localEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
      localEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: signInError } = await owner.auth.signInWithPassword({ email, password });
    expect(signInError, "the owner should sign in to age the ticket").toBeNull();
    const aged = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { error: ageError } = await owner.from("task_tickets").update({ last_synced_at: aged }).eq("task_id", taskId);
    expect(ageError, "the owner should age their own ticket into the sync window").toBeNull();

    const res = await page.request.post("/api/cron/integrations-sync", { headers: { authorization: `Bearer ${cronSecret}` } });
    expect(res.ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByText(/FAKE-.+: In Progress/)).toBeVisible();
  } else {
    console.log("CRON_SECRET unavailable to the Playwright process — skipping step 4's poll-sync assertion.");
  }

  // 5. Axe on the task detail page with the tracker chip.
  const taskAxe = await new AxeBuilder({ page }).analyze();
  expect(taskAxe.violations).toEqual([]);

  // 6. Revoke the sandbox connection back on the integrations page.
  await page.goto("/app/integrations");
  await expect(page.getByRole("heading", { name: "Ticketing integrations", level: 1 })).toBeVisible();
  const toRevoke = page.getByRole("listitem").filter({ hasText: "Sandbox Jira" });
  await toRevoke.getByRole("button", { name: "Revoke" }).click();
  await expect(toRevoke.getByText("Revoked")).toBeVisible();
});

test("an owner adds an evidence source, the collector fills the vault, and re-collection does not duplicate", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `evs-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`Evidence Sources Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // 1. Open Integrations and add an evidence source. FAKE collector is the dev
  //    default (EVIDENCE_LIVE is not set); provider defaults to Google Workspace.
  //    Scope by the add-source form so the two "Label" inputs on the page (one per
  //    section) don't collide.
  await page.goto("/app/integrations");
  await expect(page.getByRole("heading", { name: "Ticketing integrations", level: 1 })).toBeVisible();
  const sourceForm = page.locator("form", { has: page.getByRole("button", { name: "Add evidence source" }) });
  await sourceForm.getByLabel("Label", { exact: true }).fill("Sandbox GWS");
  await sourceForm.getByRole("button", { name: "Add evidence source" }).click();
  const source = page.getByRole("listitem").filter({ hasText: "Sandbox GWS" });
  await expect(source.getByText("Active")).toBeVisible();

  // 2. Axe on the integrations page (now carrying both sections).
  const integrationsAxe = await new AxeBuilder({ page }).analyze();
  expect(integrationsAxe.violations).toEqual([]);

  // 3. Run the CRON_SECRET-gated collector. The secret is read the same way the
  //    other cron e2e tests read it; if it is genuinely unavailable, skip the
  //    collection assertions rather than guess a secret. EVIDENCE_LIVE is never
  //    set, so the FAKE collector's deterministic sample set is what lands.
  let cronSecret: string | null = null;
  try { cronSecret = localEnvironment("CRON_SECRET"); } catch { cronSecret = null; }
  if (cronSecret) {
    const first = await page.request.post("/api/cron/evidence-collect", { headers: { authorization: `Bearer ${cronSecret}` } });
    expect(first.ok()).toBeTruthy();

    // The fake Google Workspace source yields two items; both surface in the vault
    // with the neutral "Auto" badge naming the provider.
    await page.goto("/app/evidence");
    await expect(page.getByRole("heading", { name: "MFA enforcement report" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Access review export" })).toBeVisible();
    await expect(page.getByText("Auto · Google Workspace")).toHaveCount(2);

    // 4. Re-collect: the (source_id, external_ref) dedup means the count must NOT
    //    double — the same two items, still exactly one card each.
    const second = await page.request.post("/api/cron/evidence-collect", { headers: { authorization: `Bearer ${cronSecret}` } });
    expect(second.ok()).toBeTruthy();
    await page.goto("/app/evidence");
    await expect(page.getByRole("heading", { name: "MFA enforcement report" })).toHaveCount(1);
    await expect(page.getByText("Auto · Google Workspace")).toHaveCount(2);

    // 5. Axe on the evidence vault carrying auto-collected items.
    const evidenceAxe = await new AxeBuilder({ page }).analyze();
    expect(evidenceAxe.violations).toEqual([]);
  } else {
    console.log("CRON_SECRET unavailable to the Playwright process — skipping the evidence-collection assertions.");
  }
});

test("an owner enables a public Trust Center that leaks nothing sensitive", async ({ page, browser }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `trust-${suffix}@example.test`;
  const password = "Test-only-passphrase-2026";
  const orgName = `Trust Workspace ${suffix}`;
  const slug = `trust-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const headline = "We protect customer data with an audited ISMS.";

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
  await page.getByLabel("Organisation name").fill(orgName);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // The owner enables the Trust Center from the owner-only settings page: pick a
  // slug + headline, opt into policy titles, and switch it on.
  await page.goto("/app/trust");
  await expect(page.getByRole("heading", { name: "Trust Center", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Public Trust Center" })).toBeVisible();
  await page.getByLabel("Make the Trust Center publicly visible").check();
  await page.getByLabel("Public web address (slug)").fill(slug);
  await page.getByLabel("Headline (optional)").fill(headline);
  await page.getByRole("button", { name: "Save Trust Center" }).click();

  // The live public URL is surfaced once the Trust Center is on.
  await expect(page.getByRole("status")).toContainText(`/trust/${slug}`);

  // A FRESH context with no storage state — a genuinely logged-out prospect.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`/trust/${slug}`);

  // The safe, positive summary renders: org name h1, the ISMS statement, the
  // owner's headline, the readiness ring, and the summary stat tiles.
  await expect(anonPage.getByRole("heading", { name: `${orgName} — Trust Center`, level: 1 })).toBeVisible();
  await expect(anonPage.getByText(/ISO\/IEC 27001-aligned/)).toBeVisible();
  await expect(anonPage.getByText(headline)).toBeVisible();
  await expect(anonPage.getByText("READY")).toBeVisible();
  await expect(anonPage.getByText("CONTROLS IN SCOPE")).toBeVisible();
  await expect(anonPage.getByText("APPROVED POLICIES")).toBeVisible();

  // No links into the authenticated app, no action controls, and no sign-in
  // form leak onto the public page. Scope to the page's own <main> so Next's
  // dev-only toolbar (body-level, absent in a production build) does not skew it.
  const view = anonPage.locator("main");
  expect(await view.locator('a[href^="/app"]').count()).toBe(0);
  expect(await view.getByRole("button").count()).toBe(0);
  expect(await view.locator('input[type="password"]').count()).toBe(0);
  // No member identity (the owner's email) is ever exposed publicly.
  expect(await anonPage.getByText(email).count()).toBe(0);

  // Accessibility: zero automatically detectable violations on the public page.
  expect((await new AxeBuilder({ page: anonPage }).analyze()).violations).toEqual([]);

  // A bogus slug reveals nothing — just the neutral unavailable card (no oracle).
  await anonPage.goto(`/trust/${slug}-does-not-exist`);
  await expect(anonPage.getByRole("heading", { name: "This trust center is not available", level: 1 })).toBeVisible();
  await expect(anonPage.getByText(`${orgName} — Trust Center`)).toHaveCount(0);

  await anon.close();
});

test("an ISO control is crosswalked to a framework requirement and drives coverage", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `crosswalk-${suffix}@example.test`;
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
  await page.getByLabel("Organisation name").fill(`Crosswalk Workspace ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  // Framework coverage is no longer a sidebar door — it moves under SoA via
  // a tab strip in a later task — so reach it directly for now.
  await page.goto("/app/frameworks");
  await expect(page.getByRole("heading", { name: "Framework coverage", level: 1 })).toBeVisible();

  // A fresh workspace has no mappings yet.
  await expect(page.getByText("Record your first crosswalk mapping")).toBeVisible();

  // Record the organisation's own mapping: an ISO control -> SOC 2 CC6.1.
  await page.locator('select[name="controlId"]').selectOption({ index: 1 });
  await page.locator('select[name="framework"]').selectOption("soc_2");
  await page.getByLabel("Requirement reference").fill("CC6.1");
  await page.getByLabel("Note").fill("Our logical access control satisfies this criterion.");
  await page.getByRole("button", { name: "Add mapping" }).click();

  // The mapping appears in the list and the SOC 2 coverage summary updates to
  // reflect one mapped requirement.
  await expect(page.getByRole("cell", { name: "CC6.1", exact: true })).toBeVisible();
  await expect(page.getByText("Our logical access control satisfies this criterion.")).toBeVisible();
  const coverage = page.getByRole("region", { name: "Per-framework coverage" });
  await expect(coverage.getByText(/of 1 mapped requirement/)).toBeVisible();

  // Accessibility: zero automatically detectable violations on the page.
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Remove the mapping and confirm it is gone.
  await page.getByRole("button", { name: /Remove mapping of/ }).click();
  await expect(page.getByText("Record your first crosswalk mapping")).toBeVisible();
  await expect(page.getByRole("cell", { name: "CC6.1", exact: true })).toHaveCount(0);
});
