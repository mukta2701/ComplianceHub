import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const expectedTokens = {
  "--ch-ink": "#122344",
  "--ch-text": "#475977",
  "--ch-muted": "#6f7d93",
  "--ch-text-muted": "#596a82",
  "--ch-border": "#dfe6f0",
  "--ch-border-strong": "#c9d5e6",
  "--ch-canvas": "#f3f6fb",
  "--ch-surface": "#fff",
  "--ch-surface-raised": "#fff",
  "--ch-surface-tint": "#f8faff",
  "--ch-primary": "#315efb",
  "--ch-primary-hover": "#244bd8",
  "--ch-primary-soft": "#e8efff",
  "--ch-confirmed": "#0f766e",
  "--ch-confirmed-soft": "#def7f1",
  "--ch-attention": "#9a5a00",
  "--ch-attention-soft": "#fff1d6",
  "--ch-risk": "#b4233c",
  "--ch-risk-soft": "#fbe8ec",
  "--ch-ai": "#7557f3",
  "--ch-ai-soft": "#eee9ff",
  "--ch-ai-text": "#6542f3",
  "--ch-info": "#2f6fed",
  "--ch-info-soft": "#e8f1ff",
  "--ch-review": "#7052d5",
  "--ch-review-soft": "#f0ecff",
  "--ch-chart-blue": "#3b6ff5",
  "--ch-chart-teal": "#149b8e",
  "--ch-chart-amber": "#e7a02b",
  "--ch-chart-coral": "#df5968",
  "--ch-chart-violet": "#8065dd",
  "--ch-space-1": "4px",
  "--ch-space-2": "8px",
  "--ch-space-3": "12px",
  "--ch-space-4": "16px",
  "--ch-space-5": "20px",
  "--ch-space-6": "24px",
  "--ch-space-7": "28px",
  "--ch-space-8": "32px",
  "--ch-radius": "8px",
  "--ch-radius-card": "12px",
  "--ch-control-min-height": "44px",
  "--ch-focus-ring": "0 0 0 2px #fff, 0 0 0 4px #315efb",
  "--ch-shadow-sm": "0 1px 2px #1223440a, 0 4px 16px #315efb08",
  "--ch-shadow-hover": "0 12px 28px -16px #233d7a52, 0 3px 10px #315efb12",
  "--ch-motion-fast": ".14s",
  "--ch-motion-base": ".22s",
  "--ch-ease-out": "cubic-bezier(.22, 1, .36, 1)",
  "--ink": "#122344",
  "--text": "#475977",
  "--muted": "#596a82",
  "--line": "#dfe6f0",
  "--bg": "#f3f6fb",
  "--blue": "#315efb",
  "--blue-pale": "#e8efff",
  "--green": "#0f766e",
  "--amber": "#9a5a00",
  "--red": "#b4233c",
  "--violet": "#7557f3",
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
    const aiLabel = document.createElement("span");
    aiLabel.className = "status-label";
    aiLabel.dataset.tone = "ai";
    aiLabel.textContent = "AI draft";
    document.body.append(aiLabel);
    const aiColor = getComputedStyle(aiLabel).color;
    aiLabel.remove();

    return {
      aiBackground: aiRule?.style.background,
      aiColor,
      headingWeight: headingRule?.style.fontWeight,
    };
  });

  expect(contract).toEqual({
    aiBackground: "var(--ch-ai-soft)",
    aiColor: "rgb(101, 66, 243)",
    headingWeight: "500",
  });
});

test("removes shared motion when the user requests reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo/dashboard");
  const motion = await page.locator(".button.primary").first().evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      animationDelay: style.animationDelay,
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(motion.animationDelay).toBe("0s");
  expect(Number.parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.00001);
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.00001);
});

test("keeps dashboard entrance keyframes transform-only", () => {
  const css = readFileSync(join(process.cwd(), "src/app/app/overview.module.css"), "utf8");
  for (const name of ["panelEnter", "barReveal", "chartReveal"]) {
    const keyframes = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`, "m"));
    expect(keyframes?.[1], `${name} keyframes`).toBeTruthy();
    expect(keyframes?.[1]).toContain("transform:");
    expect(keyframes?.[1]).not.toContain("opacity:");
  }
});
