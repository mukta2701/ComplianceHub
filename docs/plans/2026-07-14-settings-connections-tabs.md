# Settings Connections Tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Settings the only Owner/Admin sidebar destination for configuration and expose the existing Connections catalogue as its second route-backed tab.

**Architecture:** Preserve `/app/settings` and `/app/integrations`. Group both routes under the Settings sidebar active state, restore the existing `SubTabs` row on both pages, and pass that row into the catalogue through a navigation slot so it appears between the catalogue heading and toolbar. Do not change connection actions, provider state, access rules, or database queries.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest/Testing Library, Playwright, existing `SubTabs` and app-shell components.

---

### Task 1: Group Connections under the Settings sidebar destination

**Files:**
- Modify: `src/components/app-shell.test.tsx`
- Modify: `src/components/app-shell.tsx`

**Step 1: Write the failing navigation tests**

Change the Owner/Admin expectations so the sidebar contains Settings but no separate Connections link. Add a route-state test:

```tsx
hoisted.pathname = "/app/integrations";
renderShell("owner");

expect(screen.queryByRole("link", { name: "Connections" })).not.toBeInTheDocument();
expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
expect(screen.getByRole("heading", { name: "Connections", level: 1 })).toBeInTheDocument();
```

Keep the Member test asserting that Settings is absent.

**Step 2: Run the test to verify RED**

Run:

```bash
npx vitest run src/components/app-shell.test.tsx
```

Expected: FAIL because Connections is still a separate sidebar link and Settings is not active on `/app/integrations`.

**Step 3: Implement the minimal grouped active state**

Remove `/app/integrations` from `navGroups.Admin`. Add it back to `EXTRA_TITLES` so the header remains **Connections**. Extend `isActive` only for the Settings sidebar href:

```ts
function isActive(path: string, href: string) {
  if (href === "/app") return path === "/app";
  if (href === "/app/settings") {
    return ["/app/settings", "/app/integrations"].some(
      (route) => path === route || path.startsWith(`${route}/`),
    );
  }
  return path === href || path.startsWith(`${href}/`);
}
```

Because title routes are sorted by path length, `/app/integrations` resolves to its explicit Connections title before the grouped Settings route.

**Step 4: Verify GREEN**

Run the app-shell test again. Expected: all role/navigation tests PASS.

**Step 5: Commit**

```bash
git add src/components/app-shell.tsx src/components/app-shell.test.tsx
git commit -m "refactor(settings): group connections under settings"
```

### Task 2: Render Settings and Connections tabs on both pages

**Files:**
- Modify: `src/app/app/integrations/page.test.tsx`
- Modify: `src/app/app/integrations/page.tsx`
- Modify: `src/app/app/integrations/connections-catalog.test.tsx`
- Modify: `src/app/app/integrations/connections-catalog.tsx`
- Modify: `src/app/app/settings/page.tsx`

**Step 1: Write the failing Connections-page test**

Replace the current assertion that the Settings link is absent with:

```tsx
const tabs = screen.getByRole("navigation", { name: "Section" });
expect(within(tabs).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/app/settings");
expect(within(tabs).getByRole("link", { name: "Connections" })).toHaveAttribute("aria-current", "page");
```

In the catalogue component test, pass a small navigation element and assert it renders after the Connections heading and before the search toolbar using DOM order.

**Step 2: Run the tests to verify RED**

Run:

```bash
npx vitest run src/app/app/integrations/page.test.tsx src/app/app/integrations/connections-catalog.test.tsx
```

Expected: FAIL because the page has no Settings tab row and the catalogue has no navigation slot.

**Step 3: Add the catalogue navigation slot**

Extend the component props with an optional React node:

```tsx
export function ConnectionsCatalog({ connections, alertChannels, navigation }: {
  connections: ConnectionSummary[];
  alertChannels: AlertChannelSummary[];
  navigation?: React.ReactNode;
}) {
  // existing state and derivation
  return <div className="connections-catalog">
    <header className="connections-catalog-head">{/* existing heading */}</header>
    {navigation}
    <div className="connections-toolbar">{/* existing toolbar */}</div>
    {/* existing cards and management panel */}
  </div>;
}
```

Do not move provider state, actions, cards, or panels.

**Step 4: Add the route-backed tabs to Connections**

Import `SubTabs` in `page.tsx` and pass:

```tsx
<ConnectionsCatalog
  connections={connections}
  alertChannels={alertChannels}
  navigation={<SubTabs tabs={[
    { href: "/app/settings", label: "Settings" },
    { href: "/app/integrations", label: "Connections" },
  ]} />}
/>
```

Do not show these operator Settings tabs in the existing Member note branch.

**Step 5: Add the same tabs to Settings**

Import `SubTabs` in `src/app/app/settings/page.tsx` and render the identical two-tab row directly after `PageIntro`.

**Step 6: Verify GREEN**

Run:

```bash
npx vitest run src/app/app/integrations/page.test.tsx src/app/app/integrations/connections-catalog.test.tsx src/components/app-shell.test.tsx
npm run typecheck
```

Expected: all focused tests and typecheck PASS.

**Step 7: Commit**

```bash
git add src/app/app/integrations/page.tsx src/app/app/integrations/page.test.tsx src/app/app/integrations/connections-catalog.tsx src/app/app/integrations/connections-catalog.test.tsx src/app/app/settings/page.tsx
git commit -m "feat(settings): add route-backed connections tab"
```

### Task 3: Verify navigation on desktop, phone, and production preview

**Files:**
- Modify: `e2e/product.spec.ts`

**Step 1: Update the browser journey before running it**

At the start of the sandbox tracker journey:

1. Open `/app/settings`.
2. Assert the Section navigation contains Settings as current and Connections as a link.
3. Click Connections.
4. Assert the URL is `/app/integrations`, Connections is current, and the provider cards render.
5. On mobile, open the application navigation and assert there is no standalone Connections link while Settings is present.

Keep all existing catalogue, monitoring, focus, accessibility, horizontal-overflow, and secret-leak assertions.

**Step 2: Run the affected journey**

Using the healthy isolated local Supabase environment, run:

```bash
PLAYWRIGHT_PORT=3001 npx playwright test e2e/product.spec.ts --workers=1 --grep "a task is pushed"
```

Expected: both Chromium and mobile variants PASS.

**Step 3: Run full application verification**

Run:

```bash
npm run verify
git diff --check
git status --short
```

Expected: lint, typecheck, the full Vitest suite, and production build PASS; no whitespace errors or uncommitted changes remain after the final commit.

**Step 4: Commit the browser test**

```bash
git add e2e/product.spec.ts
git commit -m "test(settings): cover connections tab navigation"
```

**Step 5: Restart and health-check the live preview**

Restart the committed production build on `0.0.0.0:3000` using only the current Colima local Supabase environment. Verify loopback and LAN `/api/health` return 200. Do not push, deploy, call real providers, or source hosted environment files.
