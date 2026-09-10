# Expressive Dashboard and Shared Visual Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the operator dashboard closely follow the approved expressive mock-up and introduce a restrained shared colour and interaction foundation without inventing data or changing product behavior.

**Architecture:** Extend the existing `--ch-*` CSS contract and authenticated `AppShell` overrides, then keep the richer dashboard composition inside `overview.module.css`. Preserve the server-rendered dashboard's existing data loading and permission split; change only presentation markup needed for layout, interaction hooks and moving the saved-baseline route into a compact `Programme basis` context inside the maturity card.

**Tech Stack:** Next.js 16.3 App Router, React 19 server and client components, CSS custom properties and CSS Modules, Vitest/Testing Library, Playwright and axe-core.

**Spec:** `docs/superpowers/specs/2026-09-10-expressive-dashboard-visual-foundation.md`

## Global Constraints

- Start from commit `9219eff` and preserve unrelated working-tree changes.
- Use only existing dashboard queries, records, calculations, routes and permissions.
- Do not add global search, historical control trends, comparison deltas, a work-by-team chart, fictional dates or inert controls.
- Keep `DRAWER_QUERY` and the authenticated shell CSS breakpoint at exactly `max-width: 1024px`.
- Keep the shell drawer at 1024px. Use dashboard-local boundaries at 1100px for supporting charts, 960px for the hero, 920px for attention metrics, 760px for single-column content and 540px for compact phone treatment.
- Keep status meaning in visible text and icons as well as colour; retain WCAG AA contrast.
- Restrict interaction transitions to colour, background, border, box-shadow and transform. Entrance and data-reveal animations use transform only so content remains fully opaque. No looping animation; translate buttons at most 1px, linked cards at most 2px and entrance content at most 7px.
- `prefers-reduced-motion: reduce` removes entrance movement and makes transitions effectively immediate.
- `View report` is the only dashboard heading action. Saved-baseline access becomes `Review programme scope` inside the maturity card's `Programme basis` context.
- Do not change database schema, RLS, server actions, providers, routes or page-specific feature modules.
- Before editing Next.js or React files, read `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`, `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`, `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` and `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`.
- Run builds, browser suites and other heavy checks sequentially through `node --import=tsx scripts/local-resource-guard.ts -- <command>`.
- After each coherent implementation task passes its focused checks, commit it and push the active feature branch to the existing origin. Do not force-push, merge or deploy.

---

### Task 1: Extend the semantic visual and motion contract

**Files:**
- Modify: `src/app/globals.css:2-74`
- Modify: `src/app/globals.css:696`
- Test: `e2e/visual-system.spec.ts`

**Interfaces:**
- Consumes: existing root `--ch-*` variables and compatibility aliases in `src/app/globals.css`.
- Produces: root custom properties `--ch-surface-raised`, `--ch-surface-tint`, `--ch-border-strong`, `--ch-primary-hover`, `--ch-info`, `--ch-info-soft`, `--ch-review`, `--ch-review-soft`, `--ch-chart-blue`, `--ch-chart-teal`, `--ch-chart-amber`, `--ch-chart-coral`, `--ch-chart-violet`, `--ch-shadow-sm`, `--ch-shadow-hover`, `--ch-radius-card`, `--ch-motion-fast`, `--ch-motion-base` and `--ch-ease-out` for the shell and dashboard.

- [x] **Step 1: Read the framework and existing visual contracts**

Run:

```bash
sed -n '1,220p' node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
sed -n '1,130p' src/app/globals.css
sed -n '1,150p' e2e/visual-system.spec.ts
```

Expected: the Next.js CSS guide confirms global CSS ownership through the root layout, and the test shows the exact existing custom-property contract.

- [x] **Step 2: Write the failing token and reduced-motion checks**

Update changed existing entries, retain unchanged entries and extend `expectedTokens` in `e2e/visual-system.spec.ts` with the exact new values:

```ts
const expectedTokens = {
  // Changed existing semantic values.
  "--ch-ink": "#122344",
  "--ch-text": "#475977",
  "--ch-muted": "#6f7d93",
  "--ch-text-muted": "#596a82",
  "--ch-border": "#dfe6f0",
  "--ch-canvas": "#f3f6fb",
  "--ch-surface": "#fff",
  "--ch-primary": "#315efb",
  "--ch-primary-soft": "#e8efff",
  "--ch-confirmed": "#0f766e",
  "--ch-confirmed-soft": "#def7f1",
  "--ch-attention": "#9a5a00",
  "--ch-attention-soft": "#fff1d6",
  "--ch-ai": "#7557f3",
  "--ch-focus-ring": "0 0 0 2px #fff, 0 0 0 4px #315efb",
  // New shared foundation values.
  "--ch-surface-raised": "#fff",
  "--ch-surface-tint": "#f8faff",
  "--ch-border-strong": "#c9d5e6",
  "--ch-primary-hover": "#244bd8",
  "--ch-info": "#2f6fed",
  "--ch-info-soft": "#e8f1ff",
  "--ch-review": "#7052d5",
  "--ch-review-soft": "#f0ecff",
  "--ch-chart-blue": "#3b6ff5",
  "--ch-chart-teal": "#149b8e",
  "--ch-chart-amber": "#e7a02b",
  "--ch-chart-coral": "#df5968",
  "--ch-chart-violet": "#8065dd",
  "--ch-shadow-sm": "0 1px 2px #1223440a, 0 4px 16px #315efb08",
  "--ch-shadow-hover": "0 12px 28px -16px #233d7a52, 0 3px 10px #315efb12",
  "--ch-radius-card": "12px",
  "--ch-motion-fast": ".14s",
  "--ch-motion-base": ".22s",
  "--ch-ease-out": "cubic-bezier(.22, 1, .36, 1)",
  // Changed compatibility aliases.
  "--ink": "#122344",
  "--text": "#475977",
  "--muted": "#596a82",
  "--line": "#dfe6f0",
  "--bg": "#f3f6fb",
  "--blue": "#315efb",
  "--blue-pale": "#e8efff",
  "--green": "#0f766e",
  "--amber": "#9a5a00",
  "--violet": "#7557f3",
};
```

Add a browser check that verifies explicit transition properties and the reduced-motion override:

```ts
test("keeps shared interaction motion restrained and removable", async ({ browser }) => {
  const normal = await browser.newPage();
  await normal.goto("/demo/dashboard");
  const button = normal.getByRole("link", { name: /Continue assessment/ });
  const before = await button.evaluate((node) => getComputedStyle(node).transform);
  await button.hover();
  const hovered = await button.evaluate((node) => {
    const style = getComputedStyle(node);
    return { transform: style.transform, properties: style.transitionProperty };
  });
  expect(before).toBe("none");
  expect(hovered.transform).not.toBe("none");
  expect(hovered.properties).not.toContain("all");

  const reduced = await browser.newPage({ reducedMotion: "reduce" });
  await reduced.goto("/demo/dashboard");
  const duration = await reduced.getByRole("link", { name: /Continue assessment/ })
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration));
  expect(duration).toBeLessThanOrEqual(0.01);
  await normal.close();
  await reduced.close();
});
```

- [x] **Step 3: Run the visual-system spec and confirm the new contract fails**

Run:

```bash
node --import=tsx scripts/local-resource-guard.ts -- npx playwright test e2e/visual-system.spec.ts --project=chromium --workers=1
```

Expected: FAIL because the new custom properties and explicit interaction behavior do not exist yet.

- [x] **Step 4: Add the token values and replace the catch-all transition**

Update the existing `:root` block in `src/app/globals.css`; keep the existing aliases and define the new properties in the same block:

```css
:root {
  --ch-ink: #122344;
  --ch-text: #475977;
  --ch-muted: #6f7d93;
  --ch-text-muted: #596a82;
  --ch-border: #dfe6f0;
  --ch-border-strong: #c9d5e6;
  --ch-canvas: #f3f6fb;
  --ch-surface: #ffffff;
  --ch-surface-raised: #ffffff;
  --ch-surface-tint: #f8faff;
  --ch-primary: #315efb;
  --ch-primary-hover: #244bd8;
  --ch-primary-soft: #e8efff;
  --ch-confirmed: #0f766e;
  --ch-confirmed-soft: #def7f1;
  --ch-info: #2f6fed;
  --ch-info-soft: #e8f1ff;
  --ch-review: #7052d5;
  --ch-review-soft: #f0ecff;
  --ch-attention: #9a5a00;
  --ch-attention-soft: #fff1d6;
  --ch-risk: #b4233c;
  --ch-risk-soft: #fbe8ec;
  --ch-ai: #7557f3;
  --ch-chart-blue: #3b6ff5;
  --ch-chart-teal: #149b8e;
  --ch-chart-amber: #e7a02b;
  --ch-chart-coral: #df5968;
  --ch-chart-violet: #8065dd;
  --ch-shadow-sm: 0 1px 2px #1223440a, 0 4px 16px #315efb08;
  --ch-shadow-hover: 0 12px 28px -16px #233d7a52, 0 3px 10px #315efb12;
  --ch-radius-card: 12px;
  --ch-motion-fast: 140ms;
  --ch-motion-base: 220ms;
  --ch-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  /* Keep the existing provider, spacing, focus and compatibility properties. */
}
```

Replace the broad transition and align the shared primary button with the new contract:

```css
button,
a {
  transition-duration: var(--ch-motion-fast);
  transition-property: color, background-color, border-color, box-shadow, transform;
  transition-timing-function: var(--ch-ease-out);
}
.button.primary {
  background: linear-gradient(135deg, var(--ch-primary), #496ff4);
  box-shadow: 0 7px 18px -10px #315efbcc;
}
.button.primary:hover {
  background: linear-gradient(135deg, var(--ch-primary-hover), #3d5edb);
  box-shadow: 0 10px 24px -12px #315efbee;
  transform: translateY(-1px);
}
.button:disabled,
.button[aria-disabled="true"] {
  box-shadow: none;
  transform: none;
}
```

Retain the existing global reduced-motion block and make its final state explicit:

```css
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-delay: 0ms !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
```

- [x] **Step 5: Run the focused visual contract**

Run:

```bash
node --import=tsx scripts/local-resource-guard.ts -- npx playwright test e2e/visual-system.spec.ts --project=chromium --workers=1
```

Expected: PASS for exact root/shell token values, status semantics and reduced-motion behavior.

- [x] **Step 6: Commit and push the foundation**

```bash
git add src/app/globals.css e2e/visual-system.spec.ts
git commit -m "style: add expressive visual foundation"
git push origin HEAD
```

Expected: the commit and active feature branch are present on the existing origin.

---

### Task 2: Refine the authenticated shell without changing navigation behavior

**Files:**
- Modify: `src/components/app-shell.module.css:1-137`
- Test: `src/components/app-shell.test.tsx`
- Test: `e2e/programme-dashboard.spec.ts`

**Interfaces:**
- Consumes: Task 1's semantic surface, border, shadow, radius and motion tokens.
- Produces: the authenticated sidebar/header/content presentation and the `.shell` scoped hover/focus behavior used by all `/app` pages.

- [x] **Step 1: Protect the current shell semantics with focused tests**

Keep every current `app-shell.test.tsx` expectation and add this assertion to the operator navigation test:

```tsx
it("keeps the header limited to real workspace controls", () => {
  renderShell("owner");
  const header = screen.getByRole("banner");
  expect(within(header).getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  expect(within(header).getByRole("link", { name: /Notifications/ })).toBeVisible();
  expect(within(header).queryByRole("search")).not.toBeInTheDocument();
});
```

In `e2e/programme-dashboard.spec.ts`, add computed shell checks inside the existing populated dashboard test:

```ts
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto("/app");
const shellContract = await page.evaluate(() => {
  const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
  const active = sidebar.querySelector<HTMLElement>('a[aria-current="page"]')!;
  return {
    sidebarWidth: sidebar.getBoundingClientRect().width,
    sidebarHasGradient: getComputedStyle(sidebar).backgroundImage !== "none",
    activeHasGradient: getComputedStyle(active).backgroundImage !== "none",
    activeHasInsetMarker: getComputedStyle(active).boxShadow.includes("inset"),
  };
});
expect(shellContract).toEqual({
  sidebarWidth: 232,
  sidebarHasGradient: true,
  activeHasGradient: true,
  activeHasInsetMarker: true,
});
```

- [x] **Step 2: Run the focused tests and confirm the visual contract fails**

Run unit tests first:

```bash
node --import=tsx scripts/local-resource-guard.ts -- npm test -- src/components/app-shell.test.tsx --maxWorkers=1
```

Expected: unit behavior PASS.

Run the browser test:

```bash
COMPLIANCEHUB_UI_DEMO=1 node --import=tsx scripts/local-resource-guard.ts -- npx playwright test e2e/programme-dashboard.spec.ts --project=chromium --workers=1
```

Expected: FAIL on the new active/background visual contract before the shell CSS is aligned.

- [x] **Step 3: Rebase authenticated shell overrides on the shared tokens**

In `src/components/app-shell.module.css`, remove the local canvas/border/ink/text value fork and reference Task 1 tokens. Keep layout dimensions and update visual values through variables:

```css
.shell {
  min-width: 0;
  color: var(--ch-ink);
  font-size: 14px;
}
.shell :global(.sidebar) {
  width: 232px;
  background: linear-gradient(180deg, #fbfdff 0%, #f7f9fe 72%, #f4f7fc 100%);
  border-right: 1px solid var(--ch-border);
}
.shell :global(.workspace) {
  border-color: #d8e2f1;
  background: linear-gradient(135deg, #fff 0%, #f6f9ff 100%);
  box-shadow: 0 8px 24px -22px #315efbaa;
}
.shell :global(.sidebar nav a:hover) {
  color: #2448a7;
  background: #edf3ff;
  transform: translateX(1px);
}
.shell :global(.sidebar nav a.active) {
  color: #214dce;
  background: linear-gradient(90deg, #dfe8ff, #edf2ff);
  box-shadow: inset 3px 0 0 var(--ch-primary);
}
.shell :global(.app-main) {
  background: radial-gradient(circle at 74% -10%, #e7efff 0, transparent 31rem), linear-gradient(180deg, #f8faff 0, var(--ch-canvas) 24rem);
}
.shell :global(.app-header) {
  background: #ffffffeb;
  backdrop-filter: blur(12px);
}
```

Keep card corners, buttons, fields and table rows understated but visibly responsive:

```css
.shell :global(.card) {
  border-color: var(--ch-border);
  border-radius: var(--ch-radius-card);
  box-shadow: var(--ch-shadow-sm);
}
.shell :global(.button) { border-radius: var(--ch-radius); }
.shell :global(.app-form input:hover),
.shell :global(.app-form select:hover),
.shell :global(.app-form textarea:hover),
.shell :global(.field:hover) { border-color: var(--ch-border-strong); }
.shell :global(.data-table-wrap tbody tr:hover) { background: var(--ch-surface-tint); }
```

Do not change `DRAWER_QUERY` or the 1024px media block. Keep the module's reduced-motion sidebar override.

- [x] **Step 4: Run shell unit and populated dashboard browser checks**

```bash
node --import=tsx scripts/local-resource-guard.ts -- npm test -- src/components/app-shell.test.tsx --maxWorkers=1
COMPLIANCEHUB_UI_DEMO=1 node --import=tsx scripts/local-resource-guard.ts -- npx playwright test e2e/programme-dashboard.spec.ts --project=chromium --workers=1
```

Expected: role navigation, drawer isolation and shell visual contract PASS. Browser execution remains sequential after the unit process exits.

- [x] **Step 5: Commit and push the shell refinement**

```bash
git add src/components/app-shell.module.css src/components/app-shell.test.tsx e2e/programme-dashboard.spec.ts
git commit -m "style: refine authenticated workspace shell"
git push origin HEAD
```

Expected: the shell refinement is committed and pushed without changes to routes or permissions.

---

### Task 3: Move baseline access into the control-maturity context

**Files:**
- Modify: `src/app/app/page.tsx:246-285`
- Test: `src/app/app/page.operator.test.tsx`

**Interfaces:**
- Consumes: existing control-maturity summary, dashboard destinations and `Card`, `PageIntro` and `Icon` components.
- Produces: one header action (`View report`) and an always-rendered `Programme basis` context that links `/app/baseline` as `Review programme scope`.

- [x] **Step 1: Write failing baseline-placement tests**

Add this test to `page.operator.test.tsx`:

```tsx
it("keeps programme setup contextual instead of presenting baseline jargon as a top-level action", async () => {
  render(await AppHome());
  expect(screen.queryByRole("link", { name: "Continue your baseline" })).not.toBeInTheDocument();
  expect(screen.getByText("Programme basis")).toBeVisible();
  expect(screen.getByRole("link", { name: "Review programme scope" })).toHaveAttribute("href", "/app/baseline");
  expect(screen.getByRole("link", { name: "View report" })).toHaveAttribute("href", "/app/reports/readiness");
});
```

Add a complete-programme assertion so saved-basis access cannot disappear with the conditional onboarding cards:

```tsx
it("keeps programme-scope access visible after the onboarding checklist is complete", async () => {
  hoisted.responses.assessment_sessions[0] = { data: null, count: 1 };
  hoisted.responses.soa_snapshots[0] = { data: null, count: 1 };
  hoisted.responses.risks[1] = { data: null, count: 1 };
  hoisted.responses.evidence[2] = { data: null, count: 1 };
  hoisted.responses.policies[1] = { data: null, count: 1 };
  hoisted.responses.soa_registers[1] = { data: null, count: 1 };
  hoisted.responses.memberships[0] = { data: null, count: 2 };

  render(await AppHome());
  expect(screen.getByRole("link", { name: "Review programme scope" })).toHaveAttribute("href", "/app/baseline");
  expect(screen.queryByText("Build your programme")).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run the focused dashboard render test and confirm failure**

```bash
node --import=tsx scripts/local-resource-guard.ts -- npm test -- src/app/app/page.operator.test.tsx --maxWorkers=1
```

Expected: FAIL because the baseline link is still in the heading and there is no `Programme basis` context.

- [x] **Step 3: Make the minimal server-rendered markup change**

Change the heading action in `src/app/app/page.tsx`:

```tsx
action={<Link className="button primary" href="/app/reports/readiness"><Icon name="file" />View report</Link>}
```

Add this context between the current maturity summary and maturity-distribution bars:

```tsx
<div className={styles.positionContext}>
  <span>
    <Icon name="shield" />
    <span>
      <b>Programme basis</b>
      <small>Your scope and objective define what this position covers.</small>
    </span>
  </span>
  <Link href="/app/baseline">Review programme scope <Icon name="arrow" /></Link>
</div>
```

Leave the existing conditional onboarding and integration cards in place. Do not change the query block, count meanings, maturity calculation, action prioritisation, risk matrix or Member branch.

- [x] **Step 4: Run dashboard and heading component tests**

```bash
node --import=tsx scripts/local-resource-guard.ts -- npm test -- src/app/app/page.operator.test.tsx src/components/page-heading.test.tsx src/features/onboarding/domain/checklist.test.ts --maxWorkers=1
```

Expected: PASS, including existing fail-closed and truthful empty-state checks.

- [x] **Step 5: Commit and push the dashboard structure**

```bash
git add src/app/app/page.tsx src/app/app/page.operator.test.tsx
git commit -m "refactor: focus dashboard programme actions"
git push origin HEAD
```

Expected: the structural change is committed and pushed with no data or permission changes.

---

### Task 4: Apply dashboard-specific colour, hierarchy, hover and reveal motion

**Files:**
- Modify: `src/app/app/page.tsx:246-413`
- Modify: `src/app/app/overview.module.css:1-108`
- Test: `e2e/programme-dashboard.spec.ts`

**Interfaces:**
- Consumes: Task 1 tokens and Task 3's `Programme basis` context.
- Produces: dashboard CSS Module classes for tone-aware metrics, graphical panels, interactive links, responsive grids and the one-time `panelEnter`, `barReveal` and `chartReveal` effects.

- [x] **Step 1: Add failing responsive and interaction assertions**

Expand the existing viewport loop in `e2e/programme-dashboard.spec.ts` to use 1440, 883 and 390px and assert layout contracts:

```ts
for (const width of [1440, 883, 390]) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await page.goto("/app");

  const layout = await page.evaluate(() => {
    const attention = document.querySelector<HTMLElement>('[aria-label="Programme attention"]')!;
    const metric = attention.querySelector<HTMLElement>("a")!;
    const hero = document.querySelector<HTMLElement>(".dash-hero")!;
    return {
      attentionColumns: getComputedStyle(attention).gridTemplateColumns.split(" ").length,
      heroColumns: getComputedStyle(hero).gridTemplateColumns.split(" ").length,
      metricRadius: getComputedStyle(metric).borderRadius,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  expect(layout.overflow).toBe(false);
  expect(layout.metricRadius).toBe("12px");
  expect(layout.attentionColumns).toBe(width > 920 ? 4 : 2);
  expect(layout.heroColumns).toBe(width === 1440 ? 2 : 1);
}
```

Add hover, focus, fully opaque animation and reduced-motion checks:

```ts
const openRisks = page.getByRole("navigation", { name: "Programme attention" })
  .getByRole("link", { name: /Open risks/ });
const initialTransform = await openRisks.evaluate((node) => getComputedStyle(node).transform);
await openRisks.hover();
const hoverTransform = await openRisks.evaluate((node) => getComputedStyle(node).transform);
expect(initialTransform).toBe("none");
expect(hoverTransform).not.toBe("none");
await openRisks.focus();
await expect(openRisks).toBeFocused();
expect(await openRisks.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");

const entranceKeyframes = await openRisks.evaluate((node) => node.getAnimations().flatMap((animation) => {
  const effect = animation.effect;
  return effect instanceof KeyframeEffect ? effect.getKeyframes() : [];
}));
expect(entranceKeyframes.every((frame) => frame.opacity == null || Number(frame.opacity) === 1)).toBe(true);

await page.emulateMedia({ reducedMotion: "reduce" });
await page.reload();
const entranceDuration = await page.getByRole("navigation", { name: "Programme attention" }).getByRole("link").first()
  .evaluate((node) => Number.parseFloat(getComputedStyle(node).animationDuration));
expect(entranceDuration).toBeLessThanOrEqual(0.01);
```

- [x] **Step 2: Run the programme dashboard spec and confirm the new layout contract fails**

```bash
COMPLIANCEHUB_UI_DEMO=1 node --import=tsx scripts/local-resource-guard.ts -- npx playwright test e2e/programme-dashboard.spec.ts --project=chromium --workers=1
```

Expected: FAIL because the exact responsive layout contract, tone-aware linked surfaces, fully opaque transform animation and interactive lift are not implemented.

- [x] **Step 3: Add the metric tone hook without changing data**

In `src/app/app/page.tsx`, keep the existing dashboard structures and add the metric's tone to the linked surface as well as its icon:

```tsx
<nav aria-label="Programme attention" className={styles.attention}>
  {attention.map((item) => <Link
    key={item.label}
    href={item.href}
    className={styles.metric}
    data-tone={item.value === 0 ? "neutral" : item.tone}
  >
    <span className={styles.metricIcon} data-tone={item.value === 0 ? "neutral" : item.tone}><Icon name={item.icon} /></span>
    <span className={styles.metricBody}>
      <span>{item.label}</span>
      <strong>{item.value == null ? "—" : item.value.toLocaleString("en-GB")}</strong>
      <small>{item.value == null ? "Count unavailable" : item.detail}</small>
    </span>
    <Icon name="arrow" className={styles.metricArrow} />
  </Link>)}
</nav>
```

Keep all user-visible copy and destinations from Task 3. Do not add mock-up figures, deltas or chart series.

- [x] **Step 4: Rebuild `overview.module.css` around scoped tokens and established breakpoints**

Replace dashboard colour literals with semantic tokens and add restrained interaction states. The critical rules are:

```css
.overview {
  min-width: 0;
  --overview-teal: var(--ch-chart-teal);
  --overview-lavender: var(--ch-review);
}
.attention {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.metric {
  --metric-accent: var(--ch-info);
  --metric-soft: var(--ch-info-soft);
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-height: 118px;
  padding: 18px;
  overflow: hidden;
  border: 1px solid var(--ch-border);
  border-radius: var(--ch-radius-card);
  background: linear-gradient(135deg, var(--ch-surface) 52%, color-mix(in srgb, var(--metric-soft) 66%, var(--ch-surface)));
  box-shadow: var(--ch-shadow-sm);
  color: var(--ch-ink);
  transition: border-color var(--ch-motion-fast) var(--ch-ease-out), box-shadow var(--ch-motion-fast) var(--ch-ease-out), transform var(--ch-motion-fast) var(--ch-ease-out);
}
.metric::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: linear-gradient(90deg, var(--metric-accent), transparent 78%);
}
.metric[data-tone="risk"] { --metric-accent: var(--ch-chart-coral); --metric-soft: var(--ch-risk-soft); }
.metric[data-tone="attention"] { --metric-accent: var(--ch-chart-amber); --metric-soft: var(--ch-attention-soft); }
.metric[data-tone="review"] { --metric-accent: var(--ch-chart-violet); --metric-soft: var(--ch-review-soft); }
.metric[data-tone="info"] { --metric-accent: var(--ch-chart-blue); --metric-soft: var(--ch-info-soft); }
.metric[data-tone="neutral"] { --metric-accent: var(--ch-muted); --metric-soft: var(--ch-surface-tint); }
.metric:hover {
  border-color: var(--ch-border-strong);
  box-shadow: var(--ch-shadow-hover);
  transform: translateY(-2px);
}
.metric:focus-visible {
  outline: 2px solid var(--ch-primary);
  outline-offset: 3px;
}
.metric:hover .metricArrow { transform: translateX(2px); }
```

Use the mock-up's compact proportions for the hero, charts, setup and activity while preserving current content:

```css
.overview :global(.dash-hero) {
  grid-template-columns: minmax(0, 1.55fr) minmax(340px, .95fr);
  gap: 16px;
  margin: 0 0 16px;
}
.overview :global(.dash-charts) {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.positionContext {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 24px 18px;
  padding: 12px 14px;
  border: 1px solid var(--ch-border);
  border-radius: var(--ch-radius);
  background: linear-gradient(135deg, var(--ch-info-soft), var(--ch-review-soft));
}
```

Add scoped one-time transform reveals. Do not animate opacity: transient opacity makes readable content fail contrast checks during the effect.

```css
@keyframes panelEnter {
  from { transform: translateY(7px); }
  to { transform: translateY(0); }
}
@keyframes barReveal {
  from { transform: scaleX(.16); }
  to { transform: scaleX(1); }
}
@keyframes chartReveal {
  from { transform: scale(.94); }
  to { transform: scale(1); }
}
.overview :global(.page-heading) {
  animation: panelEnter 360ms var(--ch-ease-out) both;
}
.metric {
  animation: panelEnter 420ms var(--ch-ease-out) both;
}
.overview :global(.card) {
  animation: panelEnter 440ms var(--ch-ease-out) both;
}
.barTrack > span {
  transform-origin: left;
  animation: barReveal 580ms var(--ch-ease-out) both;
}
.overview :global(.donut-ring) {
  animation: chartReveal 560ms var(--ch-ease-out) both;
}
```

Use the approved dashboard-local 1100, 960, 920, 760 and 540 rules, with these outcomes:

```css
@media (max-width: 1100px) {
  .overview :global(.dash-charts) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .upcomingCard { grid-column: 1 / -1; }
}
@media (max-width: 960px) {
  .overview :global(.dash-hero) { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 920px) {
  .attention { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .overview :global(.dash-charts) { grid-template-columns: minmax(0, 1fr); }
  .upcomingCard { grid-column: auto; }
}
@media (max-width: 540px) {
  .attention { gap: 10px; }
  .metric { padding: 13px; }
  .metricArrow { display: none; }
  .metricBody small { font-size: 11px; line-height: 1.35; }
}
@media (prefers-reduced-motion: reduce) {
  .overview :global(.page-heading),
  .metric,
  .overview :global(.card),
  .barTrack > span,
  .overview :global(.donut-ring) { animation: none; }
  .metric:hover { transform: none; }
  .metric:hover .metricArrow { transform: none; }
}
```

Retain all chart labels, chart-foot explanations and current empty-state copy. Use `font-variant-numeric: tabular-nums` for counts and dates.

- [x] **Step 5: Run the focused render and browser checks**

```bash
node --import=tsx scripts/local-resource-guard.ts -- npm test -- src/app/app/page.operator.test.tsx src/components/app-shell.test.tsx --maxWorkers=1
COMPLIANCEHUB_UI_DEMO=1 node --import=tsx scripts/local-resource-guard.ts -- npx playwright test e2e/programme-dashboard.spec.ts e2e/visual-system.spec.ts --project=chromium --workers=1
```

Expected: unit tests PASS; desktop/tablet/phone layout, hover/focus, reduced motion, routes, no overflow and axe checks PASS.

- [x] **Step 6: Visually inspect deterministic screenshots**

Open the existing Playwright output images beside:

```text
docs/design/2026-09-09-product-mockups/06-dashboard-refinement-feasible.png
```

Confirm at 1440, 883 and 390px:

- cobalt, teal, lavender, amber and red are visible but restrained;
- the heading and attention row do not dominate the first viewport;
- the maturity and decision cards form the primary visual row;
- supporting charts remain readable and source-linked;
- the `Programme basis` context contains the always-available `Review programme scope` link;
- no fake search, history, delta or team chart appears;
- no text, focus ring or card is clipped.

If a visual defect is found, adjust only `overview.module.css` or `app-shell.module.css`, rerun the two focused browser specs and capture the three screenshots again.

- [x] **Step 7: Commit and push the dashboard presentation**

```bash
git add src/app/app/page.tsx src/app/app/overview.module.css e2e/programme-dashboard.spec.ts
git commit -m "style: make programme dashboard expressive"
git push origin HEAD
```

Expected: the dashboard presentation is committed and pushed with all original data semantics intact.

---

### Task 5: Run the final gate and publish local evidence

**Files:**
- Create: `docs/evidence/2026-09-10-expressive-dashboard-visual-foundation.md`
- Create: `docs/evidence/expressive-dashboard-visual-foundation-2026-09-10/dashboard-desktop.png`
- Create: `docs/evidence/expressive-dashboard-visual-foundation-2026-09-10/dashboard-tablet.png`
- Create: `docs/evidence/expressive-dashboard-visual-foundation-2026-09-10/dashboard-mobile.png`
- Modify: `docs/release-checklist.md`

**Interfaces:**
- Consumes: the source commits from Tasks 1-4 and the existing production-preview launcher/health workflow.
- Produces: a pushed evidence record distinguishing automated checks, local fictional browser proof, running-preview identity and remaining hosted/provider/human gates.

- [x] **Step 1: Run focused unit coverage once more**

```bash
node --import=tsx scripts/local-resource-guard.ts -- npm test -- src/app/app/page.operator.test.tsx src/components/app-shell.test.tsx src/components/page-heading.test.tsx src/components/status-label.test.tsx src/features/onboarding/domain/checklist.test.ts --maxWorkers=1
```

Expected: all focused tests PASS.

- [x] **Step 2: Run lint and type checking sequentially**

```bash
node --import=tsx scripts/local-resource-guard.ts -- npm run lint
node --import=tsx scripts/local-resource-guard.ts -- npm run typecheck
```

Expected: both commands exit 0 with no errors.

- [x] **Step 3: Run the full unit suite**

```bash
node --import=tsx scripts/local-resource-guard.ts -- npm run test -- --maxWorkers=1
```

Expected: the full Vitest suite exits 0. Record the exact passed and skipped counts in the evidence document.

- [x] **Step 4: Build the production application**

```bash
node --import=tsx scripts/local-resource-guard.ts -- npm run build
```

Expected: the Next.js production build exits 0. Record that this proves compilation, not browser or hosted behavior.

- [x] **Step 5: Run final browser checks sequentially**

```bash
COMPLIANCEHUB_UI_DEMO=1 node --import=tsx scripts/local-resource-guard.ts -- npx playwright test e2e/programme-dashboard.spec.ts --project=chromium --workers=1
node --import=tsx scripts/local-resource-guard.ts -- npx playwright test e2e/visual-system.spec.ts e2e/workspace-ui.spec.ts --project=chromium --workers=1
```

Expected: populated/empty/member dashboard, token/motion contract and representative shared-shell regressions PASS. Record exact project and test counts.

- [x] **Step 6: Capture and inspect the local production preview**

Use the repository's existing immutable production-preview workflow to run the verified commit on port 3300. Verify `/api/health` reports application and database OK with the expected source identity, then capture authenticated fictional dashboard screenshots at:

```text
1440 × 1000 -> docs/evidence/expressive-dashboard-visual-foundation-2026-09-10/dashboard-desktop.png
883 × 1000  -> docs/evidence/expressive-dashboard-visual-foundation-2026-09-10/dashboard-tablet.png
390 × 844   -> docs/evidence/expressive-dashboard-visual-foundation-2026-09-10/dashboard-mobile.png
```

Expected: the running preview matches the verified source, database health is OK, screenshots contain only fictional local records and the browser shows no horizontal overflow or serious/critical axe findings.

- [x] **Step 7: Write the evidence and update the single project status source**

Create `docs/evidence/2026-09-10-expressive-dashboard-visual-foundation.md` with these sections and fill them only from outputs captured in Steps 1-6:

```markdown
# Expressive dashboard and shared visual foundation

## What changed
## Truthful data and permission boundaries
## Fresh automated verification
## Desktop, tablet and mobile demonstration
## Running preview and source identity
## Limits and next increment
```

At the top of `docs/release-checklist.md`, add one plain-language status entry that links to the evidence file. State separately:

- source implemented and pushed;
- automated checks passed;
- local production behavior demonstrated with fictional data;
- no live-provider, hosted or stakeholder acceptance was established.

Do not duplicate the release checklist in another tracker.

- [x] **Step 8: Review the final diff for scope and placeholders**

```bash
git diff --check
git diff --stat 9219eff...HEAD
git status --short
rg -n "TBD|TODO|placeholder|fake search|work by team|month from last" docs/evidence/2026-09-10-expressive-dashboard-visual-foundation.md src/app/app/page.tsx src/app/app/overview.module.css src/app/globals.css src/components/app-shell.module.css
```

Expected: no whitespace errors, no unrelated files, and no invented dashboard capability or unfinished evidence marker. References explaining excluded fake features are acceptable only in the evidence limits section.

- [x] **Step 9: Commit and push final evidence**

```bash
git add docs/evidence/2026-09-10-expressive-dashboard-visual-foundation.md docs/evidence/expressive-dashboard-visual-foundation-2026-09-10 docs/release-checklist.md
git commit -m "docs: record expressive dashboard evidence"
git push origin HEAD
```

Expected: source, evidence and the updated release status are on the active feature branch. The app remains running locally for owner review; no merge or deployment is performed.
