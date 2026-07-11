import { expect, test } from "@playwright/test";

const expectedTokens = {
  "--ch-ink": "#171c26",
  "--ch-text": "#4b5565",
  "--ch-muted": "#737d8e",
  "--ch-text-muted": "#596273",
  "--ch-border": "#e3e7ed",
  "--ch-canvas": "#f6f7f9",
  "--ch-surface": "#fff",
  "--ch-primary": "#2557d6",
  "--ch-primary-soft": "#e8f0ff",
  "--ch-confirmed": "#0f766e",
  "--ch-confirmed-soft": "#ddf6f1",
  "--ch-attention": "#a15c00",
  "--ch-attention-soft": "#fff2d6",
  "--ch-risk": "#b4233c",
  "--ch-risk-soft": "#fbe8ec",
  "--ch-ai": "#6d4aff",
  "--ch-ai-soft": "#eee9ff",
  "--ch-space-1": "4px",
  "--ch-space-2": "8px",
  "--ch-space-3": "12px",
  "--ch-space-4": "16px",
  "--ch-space-5": "20px",
  "--ch-space-6": "24px",
  "--ch-space-7": "28px",
  "--ch-space-8": "32px",
  "--ch-radius": "8px",
  "--ch-control-min-height": "44px",
  "--ch-focus-ring": "0 0 0 2px #fff, 0 0 0 4px #2557d6",
  "--ink": "#171c26",
  "--text": "#4b5565",
  "--muted": "#596273",
  "--line": "#e3e7ed",
  "--bg": "#f6f7f9",
  "--blue": "#2557d6",
  "--blue-pale": "#e8f0ff",
  "--green": "#0f766e",
  "--amber": "#a15c00",
  "--red": "#b4233c",
  "--violet": "#6d4aff",
};

test("exposes the complete ComplianceHub token contract in the app shell", async ({ page }) => {
  await page.goto("/demo/dashboard");

  const tokens = await page.evaluate((names) => {
    const rootStyles = getComputedStyle(document.documentElement);
    const shell = document.querySelector<HTMLElement>(".app-shell");
    if (!shell) throw new Error("Expected .app-shell on the demo dashboard");
    const shellStyles = getComputedStyle(shell);
    const readTokens = (styles: CSSStyleDeclaration) =>
      Object.fromEntries(names.map((name) => [name, styles.getPropertyValue(name).trim()]));

    return {
      root: readTokens(rootStyles),
      shell: readTokens(shellStyles),
    };
  }, Object.keys(expectedTokens));

  expect(tokens).toEqual({ root: expectedTokens, shell: expectedTokens });
});

test("protects shared status and page-heading CSS semantics", async ({ page }) => {
  await page.goto("/demo/dashboard");

  const contract = await page.evaluate(() => {
    const rules = Array.from(document.styleSheets).flatMap((sheet) =>
      Array.from(sheet.cssRules).filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule),
    );
    const aiRule = rules.find(
      (rule) => rule.selectorText === '.status-label[data-tone="ai"]',
    );
    const headingRule = rules.find((rule) => {
      const selectors = rule.selectorText.split(",").map((selector) => selector.trim());
      return selectors.includes(".page-heading h1") && selectors.includes(".page-heading h2");
    });

    return {
      aiBackground: aiRule?.style.background,
      headingWeight: headingRule?.style.fontWeight,
    };
  });

  expect(contract).toEqual({
    aiBackground: "var(--ch-ai-soft)",
    headingWeight: "500",
  });
});
