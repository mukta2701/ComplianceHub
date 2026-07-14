# Owner Connections Catalogue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the crowded Owner/Admin connections page with the approved searchable GitHub, Jira, and Slack card catalogue and one focused management panel.

**Architecture:** Keep `/app/integrations` as an authenticated server page that loads only active-workspace connection and alert metadata. Pass the safe serializable rows into a new client catalogue component for search, filters, selected-provider state, and existing server-action forms. Preserve deterministic sandbox/evidence forms only in a development-only block so production and the live preview stay clean.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase, Vitest/Testing Library, Playwright, existing CSS design system.

---

### Task 1: Remove technical connection wording

**Files:**
- Modify: `src/app/app/integrations/oauth-connect-button.test.tsx`
- Modify: `src/app/app/integrations/oauth-connect-button.tsx`

**Step 1: Write the failing wording test**

Update the existing GitHub expectations so the visible action and status copy
use product language:

```tsx
expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeEnabled();
expect(screen.queryByText(/OAuth|authorization/i)).not.toBeInTheDocument();
```

Keep the existing configured, pending, provider-error, and confirmation paths,
but expect copy such as `GitHub connection is still pending`, `GitHub connected`,
and `Could not complete the GitHub connection`.

**Step 2: Run the test to verify RED**

Run:

```bash
npx vitest run src/app/app/integrations/oauth-connect-button.test.tsx
```

Expected: FAIL because the current button says `Connect GitHub with OAuth` and
status messages expose authorization terminology.

**Step 3: Implement the minimal wording change**

Keep the Nango/provider lifecycle unchanged. Change only browser-visible text:

```tsx
<button type="button" className="button primary" onClick={connect} disabled={busy}>
  {busy ? `Connecting ${label}…` : `Connect ${label}`}
</button>
```

Do not rename internal actions, provider modes, or database fields.

**Step 4: Verify GREEN**

Run the focused test again. Expected: all OAuth connect-button tests PASS with
no warnings.

**Step 5: Commit**

```bash
git add src/app/app/integrations/oauth-connect-button.tsx src/app/app/integrations/oauth-connect-button.test.tsx
git commit -m "fix(connections): use plain provider language"
```

### Task 2: Build the interactive provider catalogue

**Files:**
- Create: `src/app/app/integrations/connections-catalog.test.tsx`
- Create: `src/app/app/integrations/connections-catalog.tsx`

**Step 1: Write failing catalogue-state tests**

Create fixtures containing:

- one enabled GitHub connection;
- one Jira connection that still needs target setup;
- one enabled Slack channel.

Mock `OAuthConnectButton` as a labelled button and use the real rendered client
component. Cover these behaviours in separate tests:

```tsx
expect(screen.getByRole("heading", { name: "Connections" })).toBeVisible();
expect(screen.getByRole("article", { name: "GitHub connection" })).toHaveTextContent("Connected");
expect(screen.getByRole("article", { name: "Jira connection" })).toHaveTextContent("Setup required");
expect(screen.getByRole("article", { name: "Slack connection" })).toHaveTextContent("Connected");
```

```tsx
await userEvent.type(screen.getByRole("searchbox", { name: "Search connections" }), "jira");
expect(screen.getByRole("article", { name: "Jira connection" })).toBeVisible();
expect(screen.queryByRole("article", { name: "GitHub connection" })).not.toBeInTheDocument();
```

```tsx
await userEvent.click(screen.getByRole("button", { name: "Alerts" }));
expect(screen.getByRole("article", { name: "Slack connection" })).toBeVisible();
expect(screen.queryByRole("article", { name: "Jira connection" })).not.toBeInTheDocument();
```

```tsx
await userEvent.click(within(githubCard).getByRole("button", { name: "Manage" }));
expect(screen.getByRole("region", { name: "Manage GitHub" })).toBeVisible();
await userEvent.click(within(slackCard).getByRole("button", { name: "Manage" }));
expect(screen.queryByRole("region", { name: "Manage GitHub" })).not.toBeInTheDocument();
expect(screen.getByRole("region", { name: "Manage Slack" })).toBeVisible();
```

Also assert the catalogue does not render headings for Monitoring sources,
Evidence sources, Alert channels, or technical OAuth/SSO explanations.

**Step 2: Run the test to verify RED**

Run:

```bash
npx vitest run src/app/app/integrations/connections-catalog.test.tsx
```

Expected: FAIL because the component does not exist.

**Step 3: Implement the minimal client component**

Create a `"use client"` component with serializable public types:

```ts
export type ConnectionSummary = {
  id: string;
  provider: "github" | "jira";
  label: string;
  config: { owner?: string; repo?: string; baseUrl?: string; projectKey?: string; cloudId?: string };
  connection_mode: "sandbox" | "oauth";
  enabled: boolean;
};

export type AlertChannelSummary = {
  id: string;
  type: string;
  label: string;
  min_severity: string;
  enabled: boolean;
};
```

Use local state only for `query`, `category`, and `selectedProvider`. Derive the
three card states from `connections` and `alertChannels`. Render one selected
management region below the grid.

The GitHub/Jira panel reuses:

- `OAuthConnectButton` when no live provider connection exists;
- `configureOAuthConnectionAction` for setup-required targets;
- `setIntegrationConnectionEnabledAction` and `revokeConnectionAction` for
  existing connections.

The Slack panel reuses:

- `addAlertChannelAction`;
- `setAlertChannelEnabledAction`;
- `revokeAlertChannelAction`.

Never select or render destination URLs or provider credentials.

**Step 4: Verify GREEN**

Run the component tests. Expected: all catalogue tests PASS.

**Step 5: Refactor without changing behaviour**

Extract small internal helpers for provider state and target labels only if this
removes duplication. Re-run the component test after refactoring.

**Step 6: Commit**

```bash
git add src/app/app/integrations/connections-catalog.tsx src/app/app/integrations/connections-catalog.test.tsx
git commit -m "feat(connections): add owner provider catalogue"
```

### Task 3: Simplify the server page and data loading

**Files:**
- Modify: `src/app/app/integrations/page.test.tsx`
- Modify: `src/app/app/integrations/page.tsx`

**Step 1: Replace the old page test with failing simplified-page assertions**

Expect only these safe projections:

```ts
{
  integration_connections: "id,provider,label,config,connection_mode,enabled,created_at,revoked_at",
  alert_channels: "id,type,label,min_severity,enabled,created_at,revoked_at",
}
```

Assert both queries include:

```ts
{ column: "organisation_id", value: "org-1" }
```

Assert either query error rejects with `Could not load connection settings`.
Assert the page renders the catalogue and does not render the Settings/
Connections subtab row or removed production sections.

**Step 2: Run the page test to verify RED**

Run:

```bash
npx vitest run src/app/app/integrations/page.test.tsx
```

Expected: FAIL because the page still reads four datasets and renders the
stacked operator workspace.

**Step 3: Implement the minimal server-page change**

Keep `requireAppContext()` and `manage_connections`. For Owner/Admin, query only
`integration_connections` and `alert_channels`, filter both by the active
organisation, fail closed on either error, remove revoked rows, and render:

```tsx
<ConnectionsCatalog connections={liveConnections} alertChannels={liveAlertChannels} />
```

Remove the top `SubTabs`, technical notices, monitoring-source list,
evidence-source list, and their database reads.

Keep Member's existing managed-by-operators note unchanged because Member
redesign is explicitly deferred.

**Step 4: Preserve development-only deterministic tools**

Move the existing sandbox tracker, sandbox monitor source, and evidence-source
forms into a small internal `DeveloperConnectionTools` block rendered only when:

```ts
process.env.NODE_ENV === "development"
```

Use the summary label `Local preview tools`. It must not appear in unit/test or
production builds and must not query or display saved secrets.

**Step 5: Verify GREEN**

Run:

```bash
npx vitest run src/app/app/integrations/page.test.tsx src/app/app/integrations/connections-catalog.test.tsx src/app/app/integrations/oauth-connect-button.test.tsx
```

Expected: all focused tests PASS.

**Step 6: Commit**

```bash
git add src/app/app/integrations/page.tsx src/app/app/integrations/page.test.tsx
git commit -m "refactor(connections): reduce owner page to provider data"
```

### Task 4: Match the approved responsive visual design

**Files:**
- Modify: `src/app/app/integrations/connections-catalog.test.tsx`
- Modify: `src/app/app/integrations/connections-catalog.tsx`
- Modify: `src/app/globals.css`

**Step 1: Write failing structural class assertions**

Assert the rendered catalogue exposes stable layout hooks:

```tsx
expect(screen.getByRole("searchbox", { name: "Search connections" })).toHaveClass("connections-search");
expect(screen.getByTestId("connections-grid")).toHaveClass("connections-grid");
expect(screen.getByRole("article", { name: "GitHub connection" })).toHaveClass("connection-card");
```

**Step 2: Run the test to verify RED**

Expected: FAIL until the component applies the approved structure.

**Step 3: Add scoped CSS**

Add `.connections-catalog`, `.connections-toolbar`, `.connections-filters`,
`.connections-grid`, `.connection-card`, `.connection-card-head`,
`.connection-icon`, `.connection-status`, `.connection-actions`, and
`.connection-management` styles.

Requirements:

- three equal cards at desktop, two at tablet, one at `640px` and below;
- no fixed widths that cause horizontal scrolling;
- minimum 42px interactive targets;
- visible native focus state;
- existing blue/neutral/green palette with WCAG AA contrast;
- card status paired with text, never colour alone;
- management forms stack to one column on phone.

Do not add another sidebar or tab bar; the existing app shell is the sole
navigation.

**Step 4: Verify component tests and CSS integrity**

Run:

```bash
npx vitest run src/app/app/integrations/connections-catalog.test.tsx
git diff --check
```

Expected: PASS and no whitespace errors.

**Step 5: Commit**

```bash
git add src/app/app/integrations/connections-catalog.tsx src/app/app/integrations/connections-catalog.test.tsx src/app/globals.css
git commit -m "style(connections): match provider catalogue prototype"
```

### Task 5: Update browser journeys for the new Owner experience

**Files:**
- Modify: `e2e/product.spec.ts`

**Step 1: Update the relevant test expectations before implementation changes**

In `a task is pushed to a sandbox tracker...`:

- open `/app/integrations` directly;
- open `Local preview tools` only in the development E2E server;
- create sandbox Jira and expect the Jira card to show `Connected` and
  `Manage`;
- create the sandbox GitHub monitoring source, then verify it only on
  `/app/monitoring`;
- assert the production catalogue has GitHub, Jira, and Slack cards;
- assert no visible technical OAuth/SSO copy or Monitoring sources/Evidence
  sources/Alert channels headings;
- revoke Jira through its management panel and expect the card to return to
  `Not connected` and `Connect`.

Update the evidence-source journey so successful action response and collected
evidence prove durability; do not expect a saved source list on the catalogue.

**Step 2: Run the affected E2E tests to verify RED**

Using the healthy local Supabase environment, run both Chromium and mobile for:

```bash
npx playwright test e2e/product.spec.ts --workers=1 --grep "a task is pushed|an owner adds an evidence source"
```

Expected: FAIL on old layout assertions before all catalogue changes are in
place.

**Step 3: Finish only the synchronization changes required by the new UI**

Use visible card state or direct durable database checks after server actions.
Do not add arbitrary sleeps or ignore console, request, response, or Axe errors.

**Step 4: Verify desktop and phone flows**

Run the same Playwright grep. Expected: four tests PASS (two journeys across
Chromium and mobile), zero Axe violations, no horizontal overflow, no console
errors, and no secret values in request URLs.

**Step 5: Commit**

```bash
git add e2e/product.spec.ts
git commit -m "test(connections): cover simplified owner catalogue"
```

### Task 6: Full verification and live-preview handoff

**Files:**
- No expected source changes

**Step 1: Run application verification**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: warning-free lint, type-check PASS, all Vitest files PASS, production
build PASS.

**Step 2: Run database regression checks**

```bash
npm run test:db
supabase db lint --local
```

Expected: all database assertions PASS and no schema errors. No new migration
is expected.

**Step 3: Verify the final diff and privacy hook**

```bash
git diff --check
git status --short
```

Commit any final test-only correction normally. Never bypass hooks.

**Step 4: Restart the production preview**

Build and start the committed branch at `0.0.0.0:3000` using only the current
Colima local Supabase environment. Preserve the existing Owner/Member preview
accounts and seeded rows. Do not use the hosted `.env.local`, push, deploy, or
call real providers.

**Step 5: Verify the live preview**

Check:

- loopback and LAN `/api/health` return 200;
- Owner sees only GitHub, Jira, and Slack catalogue cards;
- the production page omits Local preview tools and technical OAuth copy;
- search, category filters, Connect/Manage, and Slack management work;
- phone layout has no horizontal overflow;
- Member behaviour is unchanged.

Report the LAN URL and any external authorization checkpoint separately.
