import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("landing page explains the product and opens the demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /security readiness/i })).toBeVisible();
  await expect(page.getByText(/does not provide certification/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /try the demo/i })).toHaveAttribute("href", /demo/);
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
