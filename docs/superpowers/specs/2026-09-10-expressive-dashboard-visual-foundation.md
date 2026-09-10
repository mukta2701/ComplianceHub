# Expressive dashboard and shared visual foundation

Starting commit: `9219eff`. The owner approved a more expressive visual treatment based on the existing [product-wide mock-up direction](../../design/2026-09-09-product-mockups/README.md) and its [feasible dashboard refinement](../../design/2026-09-09-product-mockups/06-dashboard-refinement-feasible.png), with the programme dashboard as the first complete screen and a small shared foundation for the rest of the authenticated product.

## Outcome

An operator opening `/app` sees a calm but visually distinctive programme dashboard that closely follows the approved mock-up's colour, hierarchy, density and interaction quality while reporting only facts the product already stores. Shared navigation, buttons, cards, fields, tables and status treatments gain a coherent semantic palette and restrained interaction feedback. The dashboard remains usable at 1440px, tablet widths and a 390px phone viewport, including when motion is reduced.

## Scope

This batch includes:

1. A dashboard-specific composition using the existing operator data and destinations.
2. A shared semantic colour, surface, shadow, radius and motion token foundation.
3. Refined authenticated shell navigation, header, cards, buttons, fields and tables through existing shared selectors.
4. Hover, keyboard-focus and one-time entrance motion that is restrained, fast and optional.
5. Responsive dashboard and shell behaviour at desktop, tablet and phone widths.
6. Moving the saved-baseline action out of the page header into a compact `Programme basis` context inside the control-maturity card.

This batch does not add or change database queries, schema, permissions, workflow rules, routes, providers or background jobs. It does not implement global search, historical control trends, month-over-month deltas or a work-by-team chart. It does not restyle every page-specific CSS module.

## Approved visual direction

The visual system uses the mock-up's quiet light workspace and stronger accents:

- canvas `#F3F6FB`;
- surface `#FFFFFF`;
- primary ink `#122344`;
- supporting text based on the existing accessible blue-gray values;
- cobalt primary `#315EFB` with a darker hover state;
- teal `#0F766E` for confirmed states and `#149B8E` for current-data charts;
- lavender for review state and secondary chart emphasis;
- amber for attention;
- red only for actual risk, expiry or destructive meaning;
- gray for neutral and unavailable information.

Colour always supports visible labels, counts or icons. It never carries status meaning by itself. Body text, controls, status labels and focus indicators must retain WCAG AA contrast against their backgrounds.

The implementation extends the existing `--ch-*` token contract in `src/app/globals.css`. It must not introduce a parallel visual system. The shared contract should cover:

- canvas, surface, raised surface and softly tinted surface;
- default and stronger borders;
- primary, confirmed, review, attention, risk and neutral colour pairs;
- small and hover shadows;
- the existing general radius plus a 12px card radius;
- fast and standard motion durations with one standard easing curve;

Existing aliases such as `--ink`, `--text`, `--line`, `--bg`, `--blue`, `--green`, `--amber`, `--red` and `--violet` remain available while older pages migrate incrementally.

## Shared interaction rules

Interactive controls and linked surfaces use explicit transitions for colour, background, border, box-shadow and transform. The global `button,a{transition:.16s ease}` rule must be replaced rather than expanded because it currently animates every property.

- Primary buttons may rise by at most 1px and gain a slightly stronger shadow on hover.
- Interactive dashboard cards may rise by at most 2px. Static `Card` sections do not move.
- Navigation and compact list rows use a soft tinted background and colour change without large movement.
- Direction arrows may move horizontally by at most 2px when their parent link is hovered.
- Keyboard focus always shows the existing high-contrast focus ring and must not depend on hover.
- Disabled controls do not translate or gain a hover shadow.
- Dashboard headings, metrics and panels may use one transform-only entrance lasting no more than 440ms, with a maximum initial offset of 7px. Maturity bars and chart graphics may reveal once with transform only over no more than 600ms. Animated opacity is excluded so readable content keeps its full contrast throughout the effect. There is no continuous, looping or decorative animation.

The existing `prefers-reduced-motion: reduce` behavior remains authoritative. It must remove entrance movement and make interaction transitions effectively immediate while retaining all visual states.

## Shared shell and primitives

The existing `AppShell` remains the single authenticated shell. Route-backed navigation, role filtering, workspace identity, breadcrumb, notifications, drawer dialog behavior, focus isolation, Escape handling and the skip link remain unchanged.

The fixed desktop sidebar remains visible above 1024px and becomes the existing drawer at 1024px and below. `DRAWER_QUERY` in `src/components/app-shell.tsx` and the CSS breakpoint in `src/components/app-shell.module.css` must remain identical.

The shell should become more faithful to the mock-up through spacing, active navigation colour, subtle surface separation, compact header controls and consistent focus/hover states. The header continues to show the real breadcrumb, access cue, notifications and user initials. No inert search field, fake account menu or fictional date is added.

Shared components remain:

- `Card`, `PageIntro`, `Stat`, `Progress`, `Pill` and `Ring` from `src/components/ui.tsx`;
- `PageHeading` from `src/components/page-heading.tsx`;
- `StatusLabel` from `src/components/status-label.tsx`;
- `Icon` from `src/components/icons.tsx`.

`Card` remains a semantic `<section>`. Interactive elevation is applied only to links or explicit interactive-surface classes so static cards do not falsely suggest clickability.

## Dashboard information architecture

The operator dashboard retains the following source-backed content:

1. Page heading and context, with `View report` as the only header action.
2. Four linked attention summaries: non-closed risks, overdue open work, policies in review and expiring evidence.
3. A wide control-maturity card and a compact top-three priority queue.
4. Evidence freshness, risk posture and upcoming dated work.
5. Recent workspace activity.
6. Recent activity followed by the existing conditional onboarding and optional integration setup.

The saved-baseline link remains available whether or not the onboarding checklist is complete. It appears as `Review programme scope` within a labelled `Programme basis` context in the control-maturity card. The accompanying copy explains that scope and objective define what the displayed position covers. This places the route beside the programme position it qualifies while removing the visually competing header button and avoiding baseline jargon in the primary action area.

The current control-maturity calculation remains a present-state view. It must not be drawn as a historical line. The interface can use strong chart styling, labelled bars and explanatory text to achieve the mock-up's visual balance. The existing evidence donut and risk heatmap remain truthful, source-linked and labelled. Upcoming work remains based on the existing earliest-25 open dated task shortlist. Recent activity remains an append-only event summary.

Unknown counts display `—` and `Count unavailable`. Empty collections display measured zero or the current explanatory empty copy. Query failures continue to fail closed through the existing dashboard error boundary.

Member sign-in continues to render `MemberOverview`; operator-only attention counts and setup controls do not appear for Members.

## Responsive layout

The responsive contract is:

- **1440px desktop:** fixed 232px sidebar; four attention cards in one row; two-column maturity/decision hero; three supporting cards; a compact lower activity/setup row. The first viewport should expose the heading, attention row and main decision context without oversized cards.
- **Tablet, including 883px:** drawer navigation; four compact attention columns above 920px and a two-by-two attention grid at 920px or below; one-column hero; two supporting-card columns above 760px; no document-level horizontal overflow.
- **390px phone:** drawer navigation; two compact attention columns; all content panels in one column; header actions use full available width; controls retain at least 44px touch targets; long titles, organisation names and counts wrap without clipping.

The shell continues using 1024px for its CSS and JavaScript drawer contract. Dashboard-local layout uses 1100px for supporting charts, 960px for the hero, 920px for attention metrics, 760px for single-column content and 540px for compact phone treatment. These dashboard breakpoints do not alter drawer semantics.

## Accessibility and behavior

- One visible page heading and the existing breadcrumb hierarchy remain intact.
- Every metric and chart link retains a meaningful accessible name and destination.
- Heatmap cells retain likelihood, impact and count in their accessible names.
- Evidence freshness remains distinct from human approval.
- Control maturity remains distinct from evidence quality, audit readiness and certification.
- Priority reasons remain readable text and available through the existing disclosure.
- Focus is never obscured by transforms, overflow or sticky regions.
- Serious and critical automated accessibility findings must be zero on the demonstrated pages.
- Reduced-motion users receive the final visual state without entrance movement.

## File boundaries

- `src/app/globals.css`: semantic tokens, shared primitive interaction rules and reduced-motion behavior.
- `src/components/app-shell.module.css`: authenticated shell presentation and shared authenticated-page overrides.
- `src/app/app/page.tsx`: operator dashboard structure and baseline-action placement; existing data loading and calculations stay unchanged.
- `src/app/app/overview.module.css`: dashboard-only layout, colour, hover and entrance motion.
- `src/app/app/page.operator.test.tsx`: operator semantics, truthful states and baseline placement.
- `src/components/app-shell.test.tsx`: navigation and drawer behavior if shell markup changes.
- `e2e/visual-system.spec.ts`: token and shared interaction contract.
- `e2e/programme-dashboard.spec.ts`: responsive, accessibility, navigation and visual evidence.

Page-specific modules for risks, assets, policies, tasks, controls and settings remain out of scope except where they inherit shared tokens and primitives automatically.

## Acceptance criteria

1. The 1440px operator dashboard visibly follows the approved mock-up's palette, card hierarchy, compact attention row and graphical balance while using current product data only.
2. `View report` is the only dashboard heading action. The saved-baseline route appears as `Review programme scope` within the labelled `Programme basis` context regardless of checklist completion.
3. Exact attention counts, maturity denominator, action priority, evidence status, risk scoring, upcoming shortlist and activity meanings remain unchanged.
4. The authenticated sidebar, buttons, cards, fields, tables, pills and status labels use the extended semantic token contract without breaking role navigation or page-specific layouts.
5. Interactive linked surfaces provide a restrained hover response and an equivalent visible keyboard-focus state. Static cards do not move.
6. Panel entrance effects run once in at most 440ms; bar and chart reveals run once in at most 600ms. They use transform only, keep content fully opaque throughout, and are removed under `prefers-reduced-motion: reduce`.
7. The operator dashboard has no document overflow at 1440, 883 and 390px. The phone layout keeps two compact attention columns and stacks content panels.
8. Drawer semantics, `inert` isolation, Escape close, focus return, skip link, breadcrumbs, `aria-current` and Member navigation remain intact.
9. The implementation adds no fake search, date, user menu, historical line, comparison delta or team chart.
10. Focused unit and browser checks, type checking, lint and production build pass sequentially under the local resource guard. Desktop, tablet and phone screenshots are visually compared with the approved mock-up and clearly labelled as fictional local evidence.

## Demonstration and limits

The finished batch will be demonstrated in the local production preview with preserved or newly isolated fictional data. This proves local rendering and behavior only. It does not prove live-provider behavior, hosted release, human stakeholder acceptance or certification readiness.

The shared foundation intentionally reaches only selectors already common across the authenticated product. Full mock-up fidelity for each register and detail view remains separate page-by-page work because those pages contain their own layout rules and hard-coded presentation values.
