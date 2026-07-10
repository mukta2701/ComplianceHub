# ComplianceHub Visual Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ComplianceHub's card-heavy, form-heavy workflows with a consistent decision-first design system, focused SoA and assessment experiences, and an action-oriented dashboard.

**Architecture:** Keep server components responsible for tenant-scoped data loading and server actions responsible for persistence. Introduce small client components only where queues, filters, detail panels, autosave, or keyboard interaction require local state. Shared semantic tokens and components provide the visual system; domain functions derive review state and priority without embedding business logic in JSX.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase, Vitest, Testing Library, Playwright, Axe, existing Lucide-compatible `Icon` wrapper.

---

## Delivery Boundaries

- Preserve every current manual workflow and server-side approval path.
- Do not change SoA applicability, status, risk, evidence, or finalisation semantics as part of the visual refactor.
- Do not introduce a general-purpose component library.
- Do not add AI persistence or connector behaviour in the visual phase.
- Keep server-only tenant queries in server components or application services.
- Treat the Automation inbox screen as Phase 2, after the proposal data model exists on the target branch.

### Task 1: Add Semantic Design Tokens

**Files:**
- Modify: `src/app/globals.css:1-36`
- Create: `e2e/visual-system.spec.ts`

**Step 1: Write the failing token test**

Add a Playwright test that opens `/demo/dashboard` and checks the production token contract:

```ts
import { expect, test } from "@playwright/test";

test("the app exposes the semantic ComplianceHub palette", async ({ page }) => {
  await page.goto("/demo/dashboard");
  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      ink: styles.getPropertyValue("--ch-ink").trim(),
      primary: styles.getPropertyValue("--ch-primary").trim(),
      confirmed: styles.getPropertyValue("--ch-confirmed").trim(),
      attention: styles.getPropertyValue("--ch-attention").trim(),
      risk: styles.getPropertyValue("--ch-risk").trim(),
      ai: styles.getPropertyValue("--ch-ai").trim(),
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
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npx playwright test e2e/visual-system.spec.ts --project=chromium
```

Expected: FAIL because the `--ch-*` variables do not exist.

**Step 3: Add the token contract**

Replace the current raw root palette with semantic variables. Keep temporary aliases for old selectors so the migration can occur incrementally:

```css
:root {
  --ch-ink: #171c26;
  --ch-text: #4b5565;
  --ch-muted: #737d8e;
  --ch-border: #e3e7ed;
  --ch-canvas: #f6f7f9;
  --ch-surface: #ffffff;
  --ch-primary: #2557d6;
  --ch-primary-soft: #e8f0ff;
  --ch-confirmed: #0f766e;
  --ch-confirmed-soft: #ddf6f1;
  --ch-attention: #a15c00;
  --ch-attention-soft: #fff2d6;
  --ch-risk: #b4233c;
  --ch-risk-soft: #fbe8ec;
  --ch-ai: #6d4aff;
  --ch-ai-soft: #eee9ff;

  --ink: var(--ch-ink);
  --text: var(--ch-text);
  --muted: var(--ch-muted);
  --line: var(--ch-border);
  --bg: var(--ch-canvas);
  --blue: var(--ch-primary);
  --blue-pale: var(--ch-primary-soft);
  --green: var(--ch-confirmed);
  --amber: var(--ch-attention);
  --red: var(--ch-risk);
  --violet: var(--ch-ai);
}
```

Add documented spacing, radius, control-height, and focus-ring tokens. Do not mechanically rewrite unrelated selectors in this task.

**Step 4: Verify tokens and existing pages**

Run:

```bash
npx playwright test e2e/visual-system.spec.ts --project=chromium
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/app/globals.css e2e/visual-system.spec.ts
git commit -m "feat: add semantic ComplianceHub design tokens"
```

### Task 2: Create Shared Status and Page-Shell Components

**Files:**
- Create: `src/components/status-label.tsx`
- Create: `src/components/status-label.test.tsx`
- Create: `src/components/page-heading.tsx`
- Modify: `src/components/ui.tsx:1-24`
- Modify: `src/app/globals.css`

**Step 1: Write the failing status-label tests**

```tsx
import { render, screen } from "@testing-library/react";
import { StatusLabel } from "./status-label";

test("renders state with text and an accessible icon-independent label", () => {
  render(<StatusLabel tone="attention">Needs review</StatusLabel>);
  expect(screen.getByText("Needs review")).toBeVisible();
});

test("uses the AI tone only for draft assistance", () => {
  render(<StatusLabel tone="ai">AI draft</StatusLabel>);
  expect(screen.getByText("AI draft")).toHaveAttribute("data-tone", "ai");
});
```

**Step 2: Verify the tests fail**

Run:

```bash
npm test -- src/components/status-label.test.tsx
```

Expected: FAIL because `StatusLabel` does not exist.

**Step 3: Implement the components**

Use a narrow, typed interface:

```tsx
type StatusTone = "neutral" | "confirmed" | "attention" | "risk" | "ai";

export function StatusLabel({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: StatusTone;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <span className="status-label" data-tone={tone}>
      {icon ? <Icon name={icon} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
```

`PageHeading` accepts eyebrow, title, body, metadata, and one action region. Keep `PageIntro` as a compatibility wrapper until all pages migrate.

Define status CSS using semantic variables. Pair every tone with text; never render a colour-only dot as the sole meaning.

**Step 4: Run component tests**

```bash
npm test -- src/components/status-label.test.tsx
npm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/status-label.tsx src/components/status-label.test.tsx src/components/page-heading.tsx src/components/ui.tsx src/app/globals.css
git commit -m "feat: add shared decision status components"
```

### Task 3: Derive SoA Review States in the Domain Layer

**Files:**
- Create: `src/features/soa/application/review-queue.ts`
- Create: `src/features/soa/application/review-queue.test.ts`

**Step 1: Write failing queue tests**

Cover these review states:

```ts
import { describe, expect, test } from "vitest";
import { deriveSoaReviewState, filterSoaQueue } from "./review-queue";

describe("deriveSoaReviewState", () => {
  test("flags a missing rationale before an evidence gap", () => {
    expect(deriveSoaReviewState({
      applicable: true,
      justification: "",
      ownerId: "member-1",
      evidenceTotal: 0,
      expiredEvidence: 0,
      status: "in_progress",
    })).toBe("missing_rationale");
  });

  test("flags missing ownership", () => {
    expect(deriveSoaReviewState({
      applicable: true,
      justification: "Documented business reason",
      ownerId: null,
      evidenceTotal: 1,
      expiredEvidence: 0,
      status: "operational",
    })).toBe("missing_owner");
  });
});

test("needs-attention excludes fully reviewed controls", () => {
  const result = filterSoaQueue(fixtures, { reviewState: "needs_attention" });
  expect(result.every((item) => item.reviewState !== "reviewed")).toBe(true);
});
```

**Step 2: Verify the tests fail**

```bash
npm test -- src/features/soa/application/review-queue.test.ts
```

Expected: FAIL because the queue functions do not exist.

**Step 3: Implement pure derivation and filtering**

Define explicit precedence:

1. Missing applicability decision
2. Missing rationale
3. Missing owner
4. No accepted evidence
5. Stale evidence
6. Reviewed

Return counts for each summary filter from a separate `summariseSoaQueue` function. Do not infer compliance or certification readiness.

**Step 4: Verify domain behaviour**

```bash
npm test -- src/features/soa/application/review-queue.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/soa/application/review-queue.ts src/features/soa/application/review-queue.test.ts
git commit -m "feat: derive SoA review queue states"
```

### Task 4: Replace the Expanded SoA Forms with a Review Workspace

**Files:**
- Create: `src/app/app/soa/[id]/soa-review-workspace.tsx`
- Create: `src/app/app/soa/[id]/soa-review-workspace.test.tsx`
- Modify: `src/app/app/soa/[id]/page.tsx:1-56`
- Modify: `src/app/globals.css`
- Modify: `e2e/product.spec.ts`

**Step 1: Write failing component tests**

Test the user-visible contract:

```tsx
test("shows only the selected control as an editable form", async () => {
  render(<SoaReviewWorkspace items={items} members={members} registerId="soa-1" />);
  expect(screen.getAllByRole("button", { name: /review/i })).toHaveLength(items.length);
  expect(screen.getAllByLabelText("Decision rationale")).toHaveLength(1);
});

test("defaults to controls needing attention", () => {
  render(<SoaReviewWorkspace items={items} members={members} registerId="soa-1" />);
  expect(screen.getByRole("button", { name: /needs attention/i })).toHaveAttribute("aria-pressed", "true");
});

test("opening a row preserves the queue and exposes its control purpose", async () => {
  const user = userEvent.setup();
  render(<SoaReviewWorkspace items={items} members={members} registerId="soa-1" />);
  await user.click(screen.getByRole("button", { name: /review a\.5\.23/i }));
  expect(screen.getByRole("heading", { name: /security for use of cloud services/i })).toBeVisible();
  expect(screen.getByText(/why this matters/i)).toBeVisible();
});
```

**Step 2: Run the tests to verify failure**

```bash
npm test -- 'src/app/app/soa/[id]/soa-review-workspace.test.tsx'
```

Expected: FAIL because the workspace component does not exist.

**Step 3: Extract server data projection**

Keep all Supabase queries in `page.tsx`. Convert each record to serialisable props containing:

- id, control code, title, domain
- applicable, status, owner, rationale
- evidence counts and freshness
- open task count
- derived review state

Do not pass a Supabase client or server action closure into the client component.

**Step 4: Implement the workspace**

The client component owns presentation-only state:

- search text
- summary filter
- domain, owner, status, and evidence filters
- selected item ID
- active detail tab

The selected control renders the existing server-action form once. Use `useActionState` or an action-enabled form without bypassing `reviewSoaItemAction`. After success, update the visible row and select the next unresolved item.

Desktop layout: queue plus right detail panel. Mobile layout: labelled rows and detail below the selected row or on a dedicated responsive region. Do not use an 800px minimum-width table.

**Step 5: Add finalisation preflight presentation**

Use `summariseSoaQueue` to show blockers before the existing finalisation action. The final server action remains authoritative and must still reject incomplete data.

**Step 6: Add browser coverage**

Extend `e2e/product.spec.ts` to assert:

- The SoA does not render one rationale text area per control.
- Summary filters change the queue.
- Selecting a row changes the detail heading.
- Save and next persists one record and advances.
- Finalisation preflight links to an unresolved control.
- Axe finds no violations.
- No horizontal overflow at Pixel 5 width.

**Step 7: Verify**

```bash
npm test -- src/features/soa/application/review-queue.test.ts 'src/app/app/soa/[id]/soa-review-workspace.test.tsx'
npx playwright test e2e/product.spec.ts --project=chromium --grep "SoA review workspace"
npx playwright test e2e/product.spec.ts --project=mobile --grep "SoA review workspace"
npm run typecheck
```

Expected: PASS.

**Step 8: Commit**

```bash
git add 'src/app/app/soa/[id]/page.tsx' 'src/app/app/soa/[id]/soa-review-workspace.tsx' 'src/app/app/soa/[id]/soa-review-workspace.test.tsx' src/app/globals.css e2e/product.spec.ts
git commit -m "feat: replace SoA form wall with review workspace"
```

### Task 5: Turn Assessment into a Focused Decision Flow

**Files:**
- Create: `src/features/assessment/domain/guidance.ts`
- Create: `src/features/assessment/domain/guidance.test.ts`
- Modify: `src/components/assessment-response-form.tsx:1-11`
- Modify: `src/components/assessment-response-form.test.tsx`
- Modify: `src/app/app/assessment/[id]/page.tsx`
- Modify: `src/app/globals.css`

**Step 1: Write the failing guidance tests**

Define a structured guidance contract:

```ts
export type AssessmentGuidance = {
  whyItMatters: string;
  startupBaseline: string;
  evidenceExamples: string[];
};

test("every production assessment question has complete guidance", () => {
  for (const question of assessmentQuestions) {
    const guidance = getAssessmentGuidance(question.code);
    expect(guidance.whyItMatters.length).toBeGreaterThan(20);
    expect(guidance.startupBaseline.length).toBeGreaterThan(20);
    expect(guidance.evidenceExamples.length).toBeGreaterThan(0);
  }
});
```

**Step 2: Run the test and confirm failure**

```bash
npm test -- src/features/assessment/domain/guidance.test.ts
```

Expected: FAIL because structured guidance is missing.

**Step 3: Add guidance content**

Write plain-English content for every current assessment question. Keep legal and certification claims out of guidance. Evidence examples are suggestions, not requirements.

**Step 4: Rewrite the response component**

Render one active question at a time with:

- section outline
- overall and section progress
- why-it-matters and startup-baseline blocks
- four explicit answer buttons
- selected-answer consequence
- evidence examples
- previous, save and finish later, and save and continue
- Saving, Saved, Conflict, and Failed live regions

Preserve the current optimistic concurrency revision and serial save queue. Do not remove conflict handling.

**Step 5: Expand component tests**

Test keyboard navigation, save ordering, conflict messages, answer consequences, and progression to the next question.

**Step 6: Verify**

```bash
npm test -- src/features/assessment/domain/guidance.test.ts src/components/assessment-response-form.test.tsx
npm run typecheck
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/features/assessment/domain/guidance.ts src/features/assessment/domain/guidance.test.ts src/components/assessment-response-form.tsx src/components/assessment-response-form.test.tsx 'src/app/app/assessment/[id]/page.tsx' src/app/globals.css
git commit -m "feat: make assessment a guided decision flow"
```

### Task 6: Rebuild the Dashboard Around Priority Actions

**Files:**
- Create: `src/features/dashboard/application/prioritise-actions.ts`
- Create: `src/features/dashboard/application/prioritise-actions.test.ts`
- Modify: `src/app/app/page.tsx:1-88`
- Modify: `src/app/globals.css`
- Modify: `e2e/product.spec.ts`

**Step 1: Write failing prioritisation tests**

```ts
test("orders blockers before reviews and ordinary due work", () => {
  const result = prioritiseDashboardActions([
    fixture({ kind: "approval", dueOn: "2026-07-10" }),
    fixture({ kind: "soa_decision", severity: "blocker", dueOn: "2026-07-11" }),
    fixture({ kind: "evidence_review", dueOn: "2026-07-10" }),
  ], "2026-07-10");

  expect(result.map((item) => item.kind)).toEqual([
    "soa_decision",
    "evidence_review",
    "approval",
  ]);
});
```

Include deterministic tie-breaking and maximum-list-length tests.

**Step 2: Verify failure**

```bash
npm test -- src/features/dashboard/application/prioritise-actions.test.ts
```

Expected: FAIL because the prioritiser does not exist.

**Step 3: Implement the prioritiser**

Inputs are existing tasks, evidence freshness, SoA review states, policy approvals, and automation proposals when available. Output a discriminated union with label, explanation, due context, owner, source, destination, and priority reason.

Do not create a proprietary compliance score. Keep the current SoA-derived readiness percentage and label it as readiness confidence, with the existing non-certification explanation.

**Step 4: Refactor the page**

First viewport:

- readiness lifecycle
- up to five prioritised actions
- one primary `Start next action` command

Second viewport:

- what changed
- readiness by outcome
- setup progress when incomplete

Remove the four equal-weight metric cards from the first viewport. Preserve links to full task, evidence, risk, and report views.

**Step 5: Add browser assertions**

Assert that the top action matches the prioritiser, the readiness disclaimer is visible, and mobile has no horizontal overflow.

**Step 6: Verify**

```bash
npm test -- src/features/dashboard/application/prioritise-actions.test.ts
npx playwright test e2e/product.spec.ts --grep "dashboard priority"
npm run typecheck
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/features/dashboard/application/prioritise-actions.ts src/features/dashboard/application/prioritise-actions.test.ts src/app/app/page.tsx src/app/globals.css e2e/product.spec.ts
git commit -m "feat: make dashboard decision-first"
```

### Task 7: Add the Automation Inbox Presentation After the Data Foundation Lands

**Prerequisite:** `automation_proposals`, source provenance, tenant RLS, proposal lifecycle actions, and owner assignment must exist on the target branch.

**Files:**
- Create: `src/app/app/automation/page.tsx`
- Create: `src/app/app/automation/automation-inbox.tsx`
- Create: `src/app/app/automation/automation-inbox.test.tsx`
- Modify: `src/components/app-shell.tsx:9-29`
- Modify: `src/app/globals.css`
- Modify: `e2e/product.spec.ts`

**Step 1: Write failing lifecycle tests**

Test that a proposal exposes source, observation time, collector version, confidence, suggested mappings, and limitations. Assert that acceptance requires an explicit action and that opening or selecting a proposal does not persist anything.

**Step 2: Verify failure**

```bash
npm test -- src/app/app/automation/automation-inbox.test.tsx
```

Expected: FAIL because the inbox does not exist.

**Step 3: Implement server loading and client selection**

Server component loads RLS-scoped proposals. Client state controls filters and selected proposal only. Server actions perform Accept, Use as draft, Create task draft, Dismiss, and Recollect through the established proposal service.

Every proposal shows `What this does not prove`. AI-assisted content uses the AI tone and `Draft only` label; deterministic findings use their source confidence.

**Step 4: Add E2E no-autonomy coverage**

Assert that:

- Selecting a proposal creates no record.
- Accepting displays a confirmation and creates a normal evidence draft.
- Dismissal requires a reason.
- No action marks a control compliant or finalises an SoA.

**Step 5: Verify and commit**

```bash
npm test -- src/app/app/automation/automation-inbox.test.tsx
npx playwright test e2e/product.spec.ts --grep "automation inbox"
npm run typecheck
git add src/app/app/automation src/components/app-shell.tsx src/app/globals.css e2e/product.spec.ts
git commit -m "feat: add review-first automation inbox"
```

### Task 8: Complete Responsive and Accessibility Verification

**Files:**
- Modify: `e2e/visual-system.spec.ts`
- Modify: `e2e/product.spec.ts`
- Modify: `src/app/globals.css`

**Step 1: Add failing viewport checks**

For Dashboard, SoA, Assessment, and Automation, assert:

```ts
const overflow = await page.evaluate(() => ({
  client: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
}));
expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
```

Run at 1440x900, 768x1024, and Pixel 5. Add Axe analysis after opening drawers, changing tabs, and selecting an assessment answer.

**Step 2: Verify the checks fail where layout remains incomplete**

```bash
npx playwright test e2e/visual-system.spec.ts
```

Expected: at least one responsive or accessibility failure before final CSS adjustments.

**Step 3: Fix only demonstrated layout and accessibility failures**

Required outcomes:

- No 800px minimum-width operational table on mobile.
- No clipped control names or action buttons.
- Drawers have labelled regions and correct focus return.
- Save states use `aria-live` without stealing focus.
- All controls have visible labels or accessible names.
- Colour is not the sole state indicator.

**Step 4: Run the complete verification suite**

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test e2e/visual-system.spec.ts e2e/product.spec.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add e2e/visual-system.spec.ts e2e/product.spec.ts src/app/globals.css
git commit -m "test: verify redesigned workflows across viewports"
```

## Release Sequence

1. Semantic tokens and shared status components
2. SoA review-state domain model
3. SoA review workspace
4. Guided assessment
5. Decision-first dashboard
6. Automation inbox after its backend prerequisite
7. Responsive and accessibility gate

Ship SoA behind a workspace feature flag for the first five design-partner organisations. Compare completion time, errors, confidence, and unjustified exclusions against the current form wall before enabling it by default.
