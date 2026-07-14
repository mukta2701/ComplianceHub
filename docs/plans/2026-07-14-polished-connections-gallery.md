# Polished Connections Gallery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify and polish the approved GitHub, Jira, and Slack three-card Connections gallery by removing premature catalogue controls and showing useful target context on every provider card.

**Architecture:** Keep the existing `/app/integrations` server page, route-backed Settings tabs, provider data queries, actions, and focused management panel. Simplify the client catalogue to a fixed three-provider gallery, derive one display-only target summary from the already-loaded metadata, and refine only the existing card/footer styles. No schema, API, authentication, provider, or permission changes are required.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, existing ComplianceHub CSS tokens/components, Vitest with Testing Library, Playwright.

---

### Task 1: Replace catalogue controls with provider target summaries

**Files:**
- Modify: `src/app/app/integrations/connections-catalog.test.tsx`
- Modify: `src/app/app/integrations/connections-catalog.tsx`

**Step 1: Replace the filtering test with failing simplification assertions**

In the main catalogue presentation test, remove the expectation for the search box and add:

```tsx
expect(screen.queryByRole("searchbox", { name: "Search connections" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "Development" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "Alerts" })).not.toBeInTheDocument();
expect(screen.getByRole("article", { name: "GitHub connection" })).toHaveTextContent("acme/isms");
expect(screen.getByRole("article", { name: "Jira connection" })).toHaveTextContent("Project not selected");
expect(screen.getByRole("article", { name: "Slack connection" })).toHaveTextContent("#compliance-alerts");
```

Delete the existing `filters the catalogue by search text and category` test. Add one count/fallback test:

```tsx
it("summarizes multiple provider records without adding catalogue controls", () => {
  render(<ConnectionsCatalog
    connections={[
      ...connections,
      {
        id: "github-2",
        provider: "github",
        label: "Security GitHub",
        config: { owner: "acme", repo: "security" },
        connection_mode: "oauth",
        enabled: true,
      },
    ]}
    alertChannels={[
      ...alertChannels,
      { ...alertChannels[0], id: "slack-2", label: "#security-alerts" },
    ]}
  />);

  expect(screen.getByRole("article", { name: "GitHub connection" })).toHaveTextContent("2 connections");
  expect(screen.getByRole("article", { name: "Slack connection" })).toHaveTextContent("2 channels");
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});
```

Update the navigation-slot ordering test so it compares the supplied navigation with the provider grid instead of the removed search box:

```tsx
const grid = screen.getByTestId("connections-grid");
expect(navigation.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

**Step 2: Run the catalogue test to verify RED**

Run:

```bash
npx vitest run src/app/app/integrations/connections-catalog.test.tsx
```

Expected: FAIL because the search/category controls still render, target summaries do not exist, and the ordering test still depends on the toolbar.

**Step 3: Remove the unused filtering implementation**

In `connections-catalog.tsx`:

- remove `useMemo` from the React import;
- remove the `Category` type;
- remove `query` and `category` state;
- remove `filteredProviders`;
- remove the entire `connections-toolbar` block;
- remove the `connections-empty` branch;
- render `PROVIDERS.map(...)` directly.

Do not change selected-provider state, focus handling, trigger refs, actions, or management panels.

**Step 4: Add the minimal target-summary helper**

Add this pure helper near `connectionNeedsSetup`:

```tsx
function providerTargetSummary(
  provider: ProviderId,
  connections: ConnectionSummary[],
  alertChannels: AlertChannelSummary[],
) {
  if (provider === "slack") {
    if (alertChannels.length === 0) return "Not configured";
    if (alertChannels.length > 1) return `${alertChannels.length} channels`;
    return alertChannels[0].label || "Slack channel";
  }

  const providerConnections = connections.filter((connection) => connection.provider === provider);
  if (providerConnections.length === 0) return "Not configured";
  if (providerConnections.length > 1) return `${providerConnections.length} connections`;

  const connection = providerConnections[0];
  if (connectionNeedsSetup(connection)) {
    return provider === "github" ? "Repository not selected" : "Project not selected";
  }
  if (provider === "github") {
    return [connection.config.owner, connection.config.repo].filter(Boolean).join("/")
      || connection.label
      || "GitHub connection";
  }
  return connection.config.projectKey
    || connection.label
    || connection.config.baseUrl
    || "Jira connection";
}
```

Inside each provider card, derive `targetSummary` from the existing provider records and live Slack channels. Render it before the existing action button:

```tsx
const targetSummary = providerTargetSummary(provider.id, connections, liveSlackChannels);

<div className="connection-actions">
  <span>{targetSummary}</span>
  <button>{action}</button>
</div>
```

Keep the button's existing refs, accessibility attributes, and click handler.

**Step 5: Run the catalogue test to verify GREEN**

Run:

```bash
npx vitest run src/app/app/integrations/connections-catalog.test.tsx
```

Expected: all catalogue tests PASS, including management-panel focus behavior.

**Step 6: Commit the behavior change**

```bash
git add src/app/app/integrations/connections-catalog.tsx src/app/app/integrations/connections-catalog.test.tsx
git commit -m "refactor(connections): simplify provider gallery"
```

### Task 2: Polish the three-card gallery within the existing design system

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/app/integrations/connections-catalog.test.tsx`

**Step 1: Add a failing structural class assertion**

Extend the main catalogue test:

```tsx
const githubCard = screen.getByRole("article", { name: "GitHub connection" });
expect(within(githubCard).getByText("acme/isms")).toHaveClass("connection-card-target");
expect(within(githubCard).getByRole("button", { name: "Manage" }).parentElement)
  .toHaveClass("connection-card-footer");
```

**Step 2: Run the test to verify RED**

Run:

```bash
npx vitest run src/app/app/integrations/connections-catalog.test.tsx
```

Expected: FAIL until the card footer and target classes are present.

**Step 3: Apply the approved card-footer markup**

Add the exact `connection-card-footer` and `connection-card-target` classes from Task 1 without changing button behavior.

**Step 4: Refine only the existing Connections CSS**

In the Owner connection catalogue block of `src/app/globals.css`:

- remove `.connections-toolbar`, `.connections-search-wrap`, `.connections-search`, `.connections-categories`, and their focus/mobile rules;
- remove `.connections-empty`;
- keep the existing 3/2/1 responsive grid breakpoints;
- keep card, provider icon, status pill, and panel tokens;
- convert the action row into a quiet footer:

```css
.connection-card>p{min-height:42px;margin:var(--ch-space-4) 0;color:var(--ch-text-muted);font-size:12.5px;line-height:1.55}
.connection-actions{display:flex;align-items:center;justify-content:space-between;gap:var(--ch-space-3);margin-top:auto;padding-top:var(--ch-space-4);border-top:1px solid var(--ch-border)}
.connection-card-target{min-width:0;overflow:hidden;color:var(--ch-text-muted);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}
.connection-actions .button{min-width:104px;min-height:42px;flex:none;padding:9px 15px;box-shadow:none}
```

At the phone breakpoint, let the footer remain one row while allowing the target text to truncate. Do not make card buttons full width; the management-panel action rules remain unchanged.

Update the focus selector so it references card and management controls only.

**Step 5: Run focused tests and typecheck**

Run:

```bash
npx vitest run src/app/app/integrations/connections-catalog.test.tsx src/app/app/integrations/page.test.tsx src/components/app-shell.test.tsx
npm run typecheck
git diff --check
```

Expected: all focused tests and typecheck PASS; no whitespace errors.

**Step 6: Commit the visual refinement**

```bash
git add src/app/globals.css src/app/app/integrations/connections-catalog.test.tsx src/app/app/integrations/connections-catalog.tsx
git commit -m "style(connections): polish provider card footers"
```

### Task 3: Verify the simplified gallery on desktop and phone

**Files:**
- Modify: `e2e/product.spec.ts`

**Step 1: Add failing browser assertions for the approved layout**

In the existing sandbox-tracker Connections journey, after reaching `/app/integrations`, assert:

```ts
await expect(page.getByRole("searchbox", { name: "Search connections" })).toHaveCount(0);
await expect(page.getByRole("button", { name: "All" })).toHaveCount(0);
await expect(page.getByRole("button", { name: "Development" })).toHaveCount(0);
await expect(page.getByRole("button", { name: "Alerts" })).toHaveCount(0);
await expect(jiraCard).toContainText("Not configured");
```

After adding the sandbox Jira connection, assert:

```ts
await expect(jiraCard).toContainText("Sandbox Jira");
```

Keep the existing panel focus, monitoring, accessibility, overflow, request-error, and secret-leak checks.

**Step 2: Run the affected journey on both projects**

Run with the isolated local Supabase environment:

```bash
PLAYWRIGHT_PORT=3010 npx playwright test e2e/product.spec.ts \
  --grep "a task is pushed to a sandbox tracker" \
  --project=chromium --project=mobile
```

Expected: both tests PASS. The phone viewport has no horizontal overflow and cards remain a single readable column.

**Step 3: Commit the browser coverage**

```bash
git add e2e/product.spec.ts
git commit -m "test(connections): cover simplified gallery"
```

### Task 4: Run the completion and review loop

**Files:**
- Review: all commits after `8723d48`
- Modify: only files required by validated review findings

**Step 1: Run the full verification gate**

Run:

```bash
npm run verify
git diff --check
git status --short
```

Expected: lint, TypeScript, all Vitest tests, and the production build PASS; the worktree is clean.

**Step 2: Request independent review**

Use `superpowers:requesting-code-review` with:

- the approved design at `docs/plans/2026-07-14-polished-connections-gallery-design.md`;
- base commit `8723d48`;
- the final implementation HEAD;
- explicit checks for unnecessary UI, target-summary edge cases, responsive layout, accessibility, and regressions in provider management.

Expected: reviewer categorizes findings as Critical, Important, or Minor and gives a merge-readiness verdict.

**Step 3: Resolve validated findings test-first**

For every Critical or Important finding, and any small Minor issue that affects the requested design:

1. use `superpowers:receiving-code-review`;
2. reproduce or add the failing assertion;
3. implement the smallest fix;
4. rerun focused tests;
5. send the fix back for review.

Repeat until no Critical or Important findings remain.

**Step 4: Refresh the production live preview**

Rebuild and restart the committed application on `0.0.0.0:3000` with only the current local Supabase environment. Verify:

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health
curl -fsS -o /dev/null -w '%{http_code}\n' http://192.168.1.93:3000/api/health
```

Expected: both return `200`.

Do not push, deploy, connect real GitHub/Jira accounts, or request provider authorization during this task.
