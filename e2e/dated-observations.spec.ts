import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn, teamTestEnabled } from "./helpers/team-workspace";

const fixturePath = "artifacts/dated-observations/demo.json";
const enabled = teamTestEnabled && process.env.COMPLIANCEHUB_OBSERVATION_DEMO === "1" && existsSync(fixturePath);
test.skip(!enabled, "Requires the explicitly prepared isolated dated-observation fixture.");

async function openEvidenceDetail(page: Page, evidenceId: string) {
  await page.goto(`/app/evidence?evidence=${evidenceId}#evidence-${evidenceId}`);
  const detail = page.locator(`#evidence-${evidenceId}`);
  await expect(detail).toBeVisible();
  return detail;
}

test("dated results remain distinguishable and earlier reviewed evidence stays linked", async ({ page }, testInfo) => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    email: string; password: string; firstEvidenceId: string; legacyEvidenceId: string; taskId: string;
    evidence: { id: string; collected_on: string; description: string }[];
  };
  await page.setViewportSize(testInfo.project.name === "mobile" ? { width: 393, height: 851 } : { width: 1440, height: 1000 });
  await signIn(page, { id: "fictional-owner", email: fixture.email, password: fixture.password });
  const earlier = await openEvidenceDetail(page, fixture.firstEvidenceId);
  await expect(earlier).toContainText("1 Aug 2026");
  await expect(earlier.getByText(/^1 protected/)).toBeVisible();
  await expect(earlier.getByRole("link", { name: "Task: Earlier observation review — fictional" })).toHaveAttribute("href", `/app/tasks/${fixture.taskId}`);
  await earlier.screenshot({ path: testInfo.outputPath("earlier-evidence.png") });
  for (const record of fixture.evidence.filter((item) => item.collected_on === "2026-09-01")) {
    const card = await openEvidenceDetail(page, record.id);
    await expect(card).toContainText("1 Sep 2026");
    await expect(card).toContainText("Resource:");
    await expect(card.getByText(record.description, { exact: true })).toBeVisible();
  }
  const legacy = await openEvidenceDetail(page, fixture.legacyEvidenceId);
  await expect(legacy).toContainText("Legacy observation identity unknown");
  await expect(legacy).toContainText("1 Jul 2026");
  await expect(legacy).toContainText("Resource: fictional-legacy-example");
  await legacy.screenshot({ path: testInfo.outputPath("legacy-evidence.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  let accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);

  await page.goto("/app/automation");
  const sameDay = page.getByRole("article").filter({ hasText: "Collected 01 Sep 2026" });
  await expect(sameDay).toHaveCount(2);
  for (const count of [1, 2]) {
    const result = fixture.evidence.find((item) => item.collected_on === "2026-09-01" && item.description.startsWith(`${count} protected`))!;
    const card = sameDay.filter({ hasText: result.description });
    await expect(card).toHaveCount(1);
    await expect(card.getByText("Recorded result", { exact: true })).toBeVisible();
    await expect(card.getByText(result.description, { exact: true })).toBeVisible();
    await expect(card.getByText("Draft only.", { exact: true })).toBeVisible();
    const limitations = card.getByText("What this does not prove", { exact: true });
    await limitations.focus();
    await limitations.press("Enter");
    if (testInfo.project.name === "mobile") {
      const dismissal = card.locator(".automation-dismiss-form");
      expect((await dismissal.boundingBox())!.height).toBeLessThan(130);
    }
    await card.screenshot({ path: testInfo.outputPath(`dated-result-${count}.png`) });
    await card.evaluate((element) => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - 80, behavior: "instant" }));
    await page.screenshot({ path: testInfo.outputPath(`dated-result-${count}-viewport.png`) });
  }
  await expect(page.getByRole("article").filter({ hasText: "Collected 01 Aug 2026" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
});
