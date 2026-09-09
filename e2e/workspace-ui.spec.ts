import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createTeamFixture, signIn, teamTestEnabled } from "./helpers/team-workspace";

const enabled = teamTestEnabled && process.env.COMPLIANCEHUB_UI_DEMO === "1";
test.skip(!enabled, "Set COMPLIANCEHUB_UI_DEMO=1 against the isolated fictional local workspace.");

const viewports = [
  { name: "desktop", size: { width: 1440, height: 1000 } },
  { name: "tablet", size: { width: 883, height: 1000 } },
  { name: "mobile", size: { width: 393, height: 851 } },
] as const;

async function expectNoBodyOverflow(page: Page, label: string) {
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(width.scroll, `${label} should not make the document horizontally scroll`).toBeLessThanOrEqual(width.client);
}

async function createWorkspaceUiFixture() {
  const fixture = await createTeamFixture();
  const { coordinator, organisationId, actors } = fixture;
  const suffix = organisationId.slice(0, 8);
  const { data: category, error: categoryError } = await coordinator
    .from("risk_categories")
    .select("id")
    .eq("organisation_id", organisationId)
    .order("position")
    .limit(1)
    .single();
  if (categoryError || !category) throw new Error("Could not load the fictional risk category");

  const [risk, evidence, policy] = await Promise.all([
    coordinator.from("risks").insert({
      organisation_id: organisationId,
      reference: `UI-RISK-${suffix}`,
      category_id: category.id,
      title: `Fictional workspace access review ${suffix}`,
      description: "A fictional record for local interface review only.",
      likelihood: 3,
      impact: 4,
      residual_likelihood: 2,
      residual_impact: 3,
      treatment: "mitigate",
      created_by: actors[0].id,
    }),
    coordinator.from("evidence").insert({
      organisation_id: organisationId,
      title: `Fictional review evidence ${suffix}`,
      kind: "note",
      description: "A fictional record used only to render the Evidence page during local UI checks.",
      collected_on: "2026-09-09",
      valid_until: "2026-12-31",
      status: "current",
      created_by: actors[0].id,
    }),
    coordinator.from("policies").insert({
      organisation_id: organisationId,
      reference: `UI-POL-${suffix}`,
      title: `Fictional workspace policy ${suffix}`,
      body: "This fictional policy exists only for local UI review.",
      owner_id: actors[0].id,
      review_due: "2026-12-31",
      created_by: actors[0].id,
    }),
  ]);
  for (const result of [risk, evidence, policy]) if (result.error) throw result.error;

  return { ...fixture, suffix };
}

async function openDrawerWithKeyboard(page: Page, firstLinkName = "Dashboard") {
  const toggle = page.getByRole("button", { name: "Open navigation" });
  await toggle.focus();
  await toggle.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("navigation", { name: "Workspace" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: firstLinkName })).toBeFocused();
  const close = dialog.getByRole("button", { name: "Close navigation" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.filter((item) => item.impact === "serious" || item.impact === "critical")).toEqual([]);
}

test("fictional workspace settings keep hash navigation and a saved job title across reload", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { actors } = await createWorkspaceUiFixture();
  await page.setViewportSize(viewports[0].size);
  await signIn(page, actors[0]);

  await page.goto("/app/settings#workspace");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  await expect(sections.getByRole("link", { name: "Workspace" })).toHaveAttribute("aria-current", "location");
  await expect(page.getByRole("heading", { name: "Workspace details" })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("settings-workspace.png"), fullPage: true });

  await sections.getByRole("link", { name: "Team members" }).click();
  await expect(page).toHaveURL(/\/app\/settings#team$/);
  await expect(sections.getByRole("link", { name: "Team members" })).toHaveAttribute("aria-current", "location");
  await expect(page.getByRole("heading", { name: "Team members" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pending invitations" })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("settings-team.png"), fullPage: true });

  const firstOwner = page.getByText("Demo first-owner", { exact: true });
  const memberRow = firstOwner.locator("xpath=ancestor::div[.//summary[normalize-space()='Edit details']][1]");
  await memberRow.getByText("Edit details", { exact: true }).click();
  const savedTitle = "Fictional security coordinator";
  await memberRow.getByLabel("Job title", { exact: true }).fill(savedTitle);
  await memberRow.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(page.getByText(savedTitle, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(savedTitle, { exact: true })).toBeVisible();

  await sections.getByRole("link", { name: "Security" }).click();
  await expect(page).toHaveURL(/\/app\/settings#security$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/settings#team$/);
  await expect(sections.getByRole("link", { name: "Team members" })).toHaveAttribute("aria-current", "location");
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/settings#security$/);
  await page.goto("/app/settings#invites");
  await expect(sections.getByRole("link", { name: "Team members" })).toHaveAttribute("aria-current", "location");
  await expect(page.getByRole("heading", { name: "Team members" })).toBeVisible();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport.size);
    await expectNoBodyOverflow(page, `${viewport.name} Settings`);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`settings-team-${viewport.name}.png`) });
    await memberRow.getByText("Edit details", { exact: true }).click();
    await expect(memberRow.getByRole("button", { name: "Save title", exact: true })).toBeVisible();
    await expectNoBodyOverflow(page, `${viewport.name} member editor`);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`settings-editor-${viewport.name}.png`) });
    await memberRow.getByText("Edit details", { exact: true }).click();
  }
  for (const name of ["AI assistance", "Connected assistants", "Security"]) {
    await sections.getByRole("link", { name, exact: true }).click();
    await expect(sections.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "location");
    await expectNoBodyOverflow(page, `mobile ${name}`);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`settings-${name.replaceAll(" ", "-")}-mobile.png`) });
  }
});

test("fictional workspace remains keyboard-operable and contained at desktop, tablet and mobile widths", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const { actors, suffix } = await createWorkspaceUiFixture();
  await page.setViewportSize(viewports[2].size);
  await signIn(page, actors[0]);

  await page.goto("/app");
  await openDrawerWithKeyboard(page);
  await page.keyboard.press("Escape");
  const toggle = page.getByRole("button", { name: "Open navigation" });
  await expect(toggle).toBeFocused();
  const sidebar = page.locator("#app-navigation");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toHaveCount(0);
  await openDrawerWithKeyboard(page);
  await page.locator("button.nav-overlay").click({ position: { x: page.viewportSize()!.width - 12, y: 80 } });
  await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toHaveCount(0);
  await expect(toggle).toBeFocused();

  const memberContext = await browser.newContext({ baseURL, viewport: viewports[2].size });
  const memberPage = await memberContext.newPage();
  try {
    await signIn(memberPage, actors[1]);
    await memberPage.goto("/app");
    await openDrawerWithKeyboard(memberPage, "Overview");
    const memberDialog = memberPage.getByRole("dialog", { name: "Workspace navigation" });
    await expect(memberDialog.getByRole("link", { name: "Assigned tasks" })).toBeVisible();
    await expect(memberDialog.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await memberPage.keyboard.press("Escape");
    await expect(memberPage.getByRole("dialog", { name: "Workspace navigation" })).toHaveCount(0);
  } finally {
    await memberContext.close();
  }

  await openDrawerWithKeyboard(page);
  await page.setViewportSize(viewports[0].size);
  await expect(page.getByRole("dialog", { name: "Workspace navigation" })).toHaveCount(0);
  await expect(sidebar).not.toHaveAttribute("aria-hidden");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

  const accessibilityFindings: unknown[] = [];
  const routes = [
    { path: "/app", heading: "Programme overview", screenshot: "dashboard" },
    { path: "/app/tasks", heading: "Tasks", screenshot: "tasks" },
    { path: "/app/risks", heading: "Risk register", screenshot: "risk-register" },
    { path: "/app/evidence", heading: "Evidence vault", screenshot: "evidence" },
    { path: "/app/policies", heading: "Policy library", screenshot: "policies" },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport.size);
    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole("main").getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
      await expectNoBodyOverflow(page, `${viewport.name} ${route.heading}`);
      if (viewport.name !== "tablet") {
        const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        const violations = scan.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
        if (violations.length) accessibilityFindings.push({ page: `${viewport.name} ${route.path}`, violations });
      }
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`${route.screenshot}-${viewport.name}-${suffix}.png`), fullPage: true });
    }
  }
  expect(accessibilityFindings).toEqual([]);
});
