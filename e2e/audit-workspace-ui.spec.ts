import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createTeamFixture, signIn, teamTestEnabled } from "./helpers/team-workspace";

const enabled = teamTestEnabled && process.env.COMPLIANCEHUB_UI_DEMO === "1";
test.skip(!enabled, "Set COMPLIANCEHUB_UI_DEMO=1 against the isolated fictional local workspace.");

const viewports = [
  { name: "desktop", size: { width: 1440, height: 1000 } },
  { name: "tablet", size: { width: 883, height: 1000 } },
  { name: "mobile", size: { width: 390, height: 844 } },
] as const;

async function expectContained(page: Page, label: string) {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll, `${label} should fit the viewport`).toBeLessThanOrEqual(widths.client);
}

test("the audit workspace and external review stay clear across representative widths", async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const { actors, organisationId, coordinator } = await createTeamFixture();
  const suffix = organisationId.slice(0, 8);
  const { data: audit, error: auditError } = await coordinator.from("audits").insert({
    organisation_id: organisationId,
    reference: `UI-AUD-${suffix}`,
    title: "Access lifecycle internal audit",
    scope: "Joiners, movers and leavers across the fictional production workspace.",
    status: "in_progress",
    planned_start: "2026-09-08",
    planned_end: "2026-09-18",
    lead_auditor_id: actors[0].id,
    created_by: actors[0].id,
  }).select("id").single();
  if (auditError || !audit) throw auditError ?? new Error("Could not create fictional audit");

  const { data: items, error: itemError } = await coordinator.from("audit_checklist_items").insert([
    { organisation_id: organisationId, audit_id: audit.id, area: "Identity lifecycle", clause_reference: "A.5.18", checklist_item: "Are leaver accounts disabled within the approved service level?", compliant: "non_compliant", evidence_note: "Two delayed removals were found in the fictional sample.", position: 0 },
    { organisation_id: organisationId, audit_id: audit.id, area: "Privileged access", clause_reference: "A.8.2", checklist_item: "Are privileged access reviews completed quarterly?", compliant: "compliant", evidence_note: "The latest fictional review was signed off by the system owner.", position: 1 },
  ]).select("id,checklist_item");
  if (itemError || !items?.length) throw itemError ?? new Error("Could not create fictional checklist");
  const leaverItem = items.find((item) => item.checklist_item.startsWith("Are leaver accounts"));
  const privilegedItem = items.find((item) => item.checklist_item.startsWith("Are privileged access reviews"));
  if (!leaverItem || !privilegedItem) throw new Error("Could not identify fictional checklist items");

  const { data: evidence, error: evidenceError } = await coordinator.from("evidence").insert({
    organisation_id: organisationId,
    title: "Fictional quarterly access review",
    kind: "note",
    description: "Synthetic proof used only for local visual verification.",
    collected_on: "2026-09-06",
    valid_until: "2026-12-31",
    status: "current",
    created_by: actors[0].id,
  }).select("id").single();
  if (evidenceError || !evidence) throw evidenceError ?? new Error("Could not create fictional evidence");
  const { error: linkError } = await coordinator.from("evidence_links").insert({ organisation_id: organisationId, evidence_id: evidence.id, audit_checklist_item_id: privilegedItem.id, created_by: actors[0].id });
  if (linkError) throw linkError;
  const { error: findingError } = await coordinator.from("audit_findings").insert({ organisation_id: organisationId, audit_id: audit.id, checklist_item_id: leaverItem.id, summary: "Leaver access exceeded the approved removal window", severity: "minor_nc", corrective_action: "Connect HR termination events to identity de-provisioning.", status: "open", created_by: actors[0].id });
  if (findingError) throw findingError;

  const rawToken = `audit-ui-${suffix}-${Date.now()}`;
  const { error: tokenError } = await coordinator.from("auditor_access_tokens").insert({ organisation_id: organisationId, audit_id: audit.id, token_hash: createHash("sha256").update(rawToken).digest("hex"), label: "Fictional external reviewer", framework: "ISO 27001:2022", expires_at: "2027-01-31T00:00:00Z", created_by: actors[0].id });
  if (tokenError) throw tokenError;

  await signIn(page, actors[0]);
  const accessibilityFindings: unknown[] = [];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport.size);
    for (const route of [
      { path: "/app/audits", heading: "Internal audits", name: "register" },
      { path: `/app/audits/${audit.id}`, heading: "Access lifecycle internal audit", name: "workspace" },
      { path: "/app/audits/new", heading: "Plan an audit", name: "new" },
    ]) {
      await page.goto(route.path);
      await expect(page.locator("#main-content").getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
      await expectContained(page, `${viewport.name} ${route.name}`);
      const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      if (scan.violations.length) accessibilityFindings.push({ viewport: viewport.name, route: route.path, violations: scan.violations });
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`audit-${route.name}-${viewport.name}.png`), fullPage: true });
    }
  }

  await page.setViewportSize(viewports[2].size);
  await page.goto(`/app/audits/${audit.id}`);
  await page.getByText("Add or populate checklist items", { exact: true }).focus();
  await expect(page.getByText("Add or populate checklist items", { exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Checklist item", exact: true })).toBeVisible();
  await expectContained(page, "mobile expanded audit management");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const transitionSeconds = await page.locator("main a, main button").first().evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration) || 0);
  expect(transitionSeconds).toBeLessThanOrEqual(0.00001);

  const auditorContext = await browser.newContext({ baseURL, viewport: viewports[2].size });
  const auditorPage = await auditorContext.newPage();
  try {
    await auditorPage.goto(`/audit-view/${rawToken}`);
    await expect(auditorPage.getByRole("heading", { name: /— audit review$/, level: 1 })).toBeVisible();
    await expect(auditorPage.getByRole("heading", { name:"Readiness summary" })).toHaveCount(0);
    await expect(auditorPage.getByText("Fictional quarterly access review", { exact: true })).toBeVisible();
    await expect(auditorPage.getByText("Checklist: Are leaver accounts disabled within the approved service level?", { exact: true })).toBeVisible();
    for (const viewport of viewports) {
      await auditorPage.setViewportSize(viewport.size);
      await expectContained(auditorPage, `${viewport.name} external audit view`);
      const scan = await new AxeBuilder({ page: auditorPage }).withTags(["wcag2a", "wcag2aa"]).analyze();
      if (scan.violations.length) accessibilityFindings.push({ viewport: viewport.name, route: "external", violations: scan.violations });
      await auditorPage.screenshot({ animations: "disabled", path: testInfo.outputPath(`audit-external-${viewport.name}.png`), fullPage: true });
    }
  } finally {
    await auditorContext.close();
  }

  expect(accessibilityFindings).toEqual([]);
});
