# Expressive dashboard and shared visual foundation

## What changed

The programme dashboard now follows the approved visual direction more closely while keeping every number tied to existing ComplianceHub data.

Before this batch, the dashboard was structurally useful but visually flat: large pale panels competed for attention, the summary cards had little semantic distinction, and the saved-baseline action appeared in the page header without explaining how it related to the programme position.

After this batch:

- four compact attention cards use labelled risk, due-work, review and evidence colours;
- control maturity and the decision queue form the main operating row;
- evidence freshness, risk posture and upcoming work use clearer chart colours and denser cards;
- `Review programme scope` sits inside a labelled `Programme basis` explanation beside the maturity score;
- shared navigation, buttons, cards, fields, tables, status labels and focus states use one stronger semantic palette;
- linked cards and buttons respond gently on hover, while reduced-motion users receive the final state without movement;
- tablet uses a two-by-two attention grid and the phone layout keeps two compact columns without horizontal scrolling.

The redesign does not add a historical trend, comparison percentages, team chart or global search because the current backend does not provide trustworthy data for them.

## Design evidence

- Approved first dashboard direction: [original mock-up](../design/2026-09-09-product-mockups/01-dashboard.png)
- Refined buildable direction: [feasible dashboard mock-up](../design/2026-09-09-product-mockups/06-dashboard-refinement-feasible.png)
- Before: [previous populated desktop dashboard](programme-dashboard-2026-09-09/populated-desktop.png)
- After, fictional local production data: [1440px desktop](expressive-dashboard-visual-foundation-2026-09-10/dashboard-desktop.png), [883px tablet](expressive-dashboard-visual-foundation-2026-09-10/dashboard-tablet.png), [390px phone](expressive-dashboard-visual-foundation-2026-09-10/dashboard-mobile.png)

## Product and design basis

The implementation was narrowed after comparing the mock-up, the existing source and public dashboard guidance. Linear's guidance supports purpose-specific dashboards with source records beneath their summary signals. Its design refresh also supports a quieter shell so the work area carries attention. Vercel's interface guidance informed focus, touch-target and reduced-motion behavior. Mobbin's Copilot Money dashboard was used for composition and graphical density rather than copied as a product model.

- [Linear dashboard guidance](https://linear.app/now/dashboards-best-practices)
- [Linear design refresh](https://linear.app/now/behind-the-latest-design-refresh)
- [Vercel interface guidelines](https://vercel.com/design/guidelines)
- [Mobbin Copilot Money dashboard](https://mobbin.com/screens/0abca29e-c16e-45bb-9134-21dbc0c20c37)

## Fresh verification

Verified on 10 September 2026 in the isolated local ComplianceHub worktree against fictional local Supabase data:

- full unit suite: 326 files passed; 2,902 tests passed and 3 skipped;
- lint passed;
- TypeScript checking passed;
- Next.js production build passed;
- shared visual-system browser checks: 4 of 4 passed;
- programme-dashboard development browser journeys: 2 of 2 passed;
- representative authenticated workspace browser journeys: 2 of 2 passed after updating an obsolete Tasks heading expectation to the current `Work queue` heading and correcting an existing low-contrast risk delete action;
- programme-dashboard production browser journeys on port 3300: 2 of 2 passed;
- dashboard checks covered 1440px, 883px and 393px layouts, exact source-backed counts, destinations, absence of horizontal overflow, serious/critical automated accessibility findings, the empty state and the existing Member experience;
- the browser regression also checks that a linked metric responds to hover and that reduced-motion preferences remove animation delays and movement.
- independent specification and visual/standards re-reviews found no remaining material issue after the touch-target, motion, production-evidence and representative-page fixes.

These checks prove the code, local build and fictional local workflows. They do not prove a hosted release, live-provider behavior, screen-reader acceptance, human stakeholder acceptance or certification readiness.

## Running preview and source identity

Application source `03bf777` is pushed to the existing `codex/team-baseline` branch. An immutable production package built from that source is running in the background at http://127.0.0.1:3300/app. Fresh health reported both application and database `ok` and the full release identity `03bf777d2264e5308832bf847b0eb34c1e7724fa`. The authenticated in-app browser was refreshed after startup and showed the new `Programme basis` context with the older header baseline action removed.

## Architecture boundary

This is a presentation-only batch. Dashboard queries, calculations, database schema, permissions, routes and background jobs remain unchanged. Shared tokens improve existing authenticated pages automatically, while page-specific layouts still need their own deliberate refinement.
