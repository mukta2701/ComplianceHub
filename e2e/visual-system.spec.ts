import { expect, test } from "@playwright/test";

test("exposes the ComplianceHub semantic colour tokens", async ({ page }) => {
  await page.goto("/demo/dashboard");

  const tokens = await page.evaluate(() => {
    const rootStyles = getComputedStyle(document.documentElement);

    return {
      ink: rootStyles.getPropertyValue("--ch-ink").trim(),
      primary: rootStyles.getPropertyValue("--ch-primary").trim(),
      confirmed: rootStyles.getPropertyValue("--ch-confirmed").trim(),
      attention: rootStyles.getPropertyValue("--ch-attention").trim(),
      risk: rootStyles.getPropertyValue("--ch-risk").trim(),
      ai: rootStyles.getPropertyValue("--ch-ai").trim(),
    };
  });

  expect(tokens).toEqual({
    ink: "#171c26",
    primary: "#2557d6",
    confirmed: "#0f766e",
    attention: "#a15c00",
    risk: "#b4233c",
    ai: "#6d4aff",
  });
});
