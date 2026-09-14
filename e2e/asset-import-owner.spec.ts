import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { clientFor, createTeamFixture, signIn, teamTestEnabled } from "./helpers/team-workspace";

test.skip(!teamTestEnabled, "Requires the isolated fictional local database.");

test("asset imports distinguish location, explicit owner and invalid owner names", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const { actors } = await createTeamFixture();
  for (const [index, name] of [[1, "London"], [2, "Alex Example"], [3, "Alex Example"]] as const) {
    const member = await clientFor(actors[index]);
    const { error } = await member.from("profiles").update({ display_name: name }).eq("id", actors[index].id);
    expect(error).toBeNull();
    await member.auth.signOut();
  }
  await page.setViewportSize(testInfo.project.name === "mobile" ? { width: 393, height: 851 } : { width: 1440, height: 1000 });
  await signIn(page, actors[0]);
  await page.goto("/app/assets/import");
  const csv = [
    "Asset Reference,Asset Description,Owner & Location,In-app owner,Classification,Value (Criticality)",
    "OWN-01,Fictional location-only asset,London,,Confidential,High",
    "OWN-02,Fictional explicitly owned asset,London office, london ,Confidential,High",
    "OWN-03,Fictional ambiguous owner asset,Remote,Alex Example,Confidential,High",
    "OWN-04,Fictional unmatched owner asset,Remote,Missing Person,Confidential,High",
  ].join("\n");
  await page.getByLabel("Workbook file (XLSX or CSV)").setInputFiles({ name: "fictional-asset-owners.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Analyse file", exact: true }).click();
  await expect(page.getByLabel("Map column In-app owner", { exact: true })).toHaveValue("ownerName");
  await page.getByRole("button", { name: "Preview 4 rows", exact: true }).click();
  await expect(page.getByText("2 valid, 2 with errors. 2 rows will be added.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Row 3:/)).toBeVisible();
  await expect(page.getByText(/Row 4:/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose who is accountable" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((item) => item.impact === "critical" || item.impact === "serious")).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("owner-preview.png"), fullPage: true });
  const confirm = page.getByRole("button", { name: "4. Confirm import (2)", exact: true });
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await confirm.press("Enter");
  await expect(page.getByRole("heading", { name: "Import complete", exact: true })).toBeVisible();
  await expect(page.getByText(/^2 rows added/)).toBeVisible();
  await page.getByRole("link", { name: "View asset inventory", exact: true }).click();
  await expect(page.getByRole("link", { name: "Fictional ambiguous owner asset", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Fictional unmatched owner asset", exact: true })).toHaveCount(0);
  await Promise.all([
    page.waitForURL((url) => /^\/app\/assets\/[^/]+$/.test(url.pathname)),
    page.getByRole("link", { name: "Fictional location-only asset", exact: true }).click(),
  ]);
  await expect(page.locator("dl").getByText("Unassigned", { exact: true })).toBeVisible();
  await expect(page.locator("dl").getByText("London", { exact: true })).toBeVisible();
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/app/assets"),
    page.getByRole("link", { name: "Back to asset inventory", exact: true }).click(),
  ]);
  await Promise.all([
    page.waitForURL((url) => /^\/app\/assets\/[^/]+$/.test(url.pathname)),
    page.getByRole("link", { name: "Fictional explicitly owned asset", exact: true }).click(),
  ]);
  await expect(page.locator("dl").getByText("London", { exact: true })).toBeVisible();
  await expect(page.getByText("London office", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("saved-owner.png"), fullPage: true });
});
