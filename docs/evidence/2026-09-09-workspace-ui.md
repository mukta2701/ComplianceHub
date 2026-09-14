# Workspace UI improvement — 9 September 2026

## Before and after

The owner requested an organised, consistent ComplianceHub interface using Mobbin references. This batch improves the shared workspace shell and gives Settings a deeper reorganisation. It does not claim every individual workflow has been redesigned.

| Before | Now | Benefit |
|---|---|---|
| Global and Settings sidebars consumed most of an 883px window; member names and controls were squeezed or off-screen. | Global navigation becomes a drawer at narrower widths; Settings uses one horizontal section selector and one content area. | More usable working space without losing navigation. |
| Workspace routes formed a long mixed list; Asset inventory was absent. | Routes are grouped into Work, Programme, Oversight, Share and Admin; Asset inventory is included. | Easier to find existing work and supporting records. |
| Different heading, control and table sizes weakened hierarchy. | Shared headings, 14px interactive controls/work text, 12px metadata, neutral surfaces and consistent spacing. | Easier scanning across dashboard, tasks, risk, evidence and policy pages. |
| Member role/title/remove controls competed with identity information. | Names and roles appear in clear rows; authorised controls expand through Edit details. | Common reading is simpler, while management actions remain available. |
| A hidden mobile drawer remained keyboard-reachable; its open state did not fully contain focus. | Closed navigation is inert; open navigation isolates the background and notifications, contains focus, supports Escape/overlay close and resets on desktop resize. | Keyboard users can navigate without falling into hidden or blocked content. |
| Settings sections were a long combined page with tiny secondary text in AI/connected-assistant rows. | Five focused sections, shareable hashes, retained section after saving and refreshing, and readable secondary text. | People keep context and can read the explanation of an action. |

### Visual evidence

All screenshots contain fictional local data. Before screenshots use the retained Team Baseline Lab; browser acceptance screenshots use newly created fictional workspaces. Reference artwork is not included in the application or redistributed.

[Before Settings at 883px](workspace-ui-2026-09-09/before-settings-883.png) · [After Settings at 883px](workspace-ui-2026-09-09/settings-team-tablet.png) · [Mobile team](workspace-ui-2026-09-09/settings-team-mobile.png) · [Mobile editor](workspace-ui-2026-09-09/settings-editor-mobile.png)

[Before Tasks](workspace-ui-2026-09-09/before-tasks-1440.png) · [After Tasks](workspace-ui-2026-09-09/tasks-desktop.png) · [Dashboard](workspace-ui-2026-09-09/dashboard-desktop.png) · [Mobile evidence](workspace-ui-2026-09-09/evidence-mobile.png) · [Mobile policies](workspace-ui-2026-09-09/policies-mobile.png) · [Mobile risks](workspace-ui-2026-09-09/risk-register-mobile.png)

## Fresh local verification

Starting commit: `c4b2d2434593189ff68b46bd7f7e34784f00efdf`. [Specification](../superpowers/specs/2026-09-09-workspace-ui.md), [ticket12](../plans/operating-lifecycle-quality/issues/12-workspace-ui.md), [independent review](2026-09-09-workspace-ui-review.md).

- Production browser acceptance: **4/4 pass**, zero retries, 34.1 seconds. Desktop Chromium and mobile browser contexts cover 1440px, 883px and 393px layouts, actual owner job-title save/reload, hash/back/forward/legacy invitation navigation, Settings sections, Member navigation, drawer focus containment, Escape/overlay close and desktop resize. Dashboard, Tasks, Risks, Evidence and Policies contain fictional saved records and have no horizontal document overflow. Wide tables retain internal scrolling.
- Axe WCAG 2 A/AA scans report zero violations in the demonstrated Settings sections, and no serious/critical violations in the open drawer or five representative desktop/mobile routes. These scans supplement actual keyboard/visual checks and do not establish complete accessibility certification.
- Actual background preview: **2/2 browser journeys pass** with the same functional and accessibility checks. Final affected component/Settings/Risks check: **5 files / 38 tests pass**.
- Full unit suite: **308 files pass, 2,655 tests pass and 3 explicitly skipped**. Typecheck and full lint pass. Production build passes. Final affected component/Settings/Risks tests, typecheck and lint pass after the last accessibility corrections.
- Existing server actions, database policies and provider behavior were not changed. Fictional UI fixtures and a new fictional member title were saved locally; existing records were preserved. No invitation was sent, AI enabled or external assistant connected during this demonstration.

## Failures resolved during verification

The tests caught missing drawer isolation for monitoring notifications and initial focus before membership exists; focused regressions failed before the fixes. Actual production testing then revealed a inherited visibility animation on links that prevented focus even after the drawer appeared. Sidebar interactive elements now animate only visual colours, not visibility.

Saving a title succeeded but an ordinary hash link left the framework's location out of sync, hiding the Team section after refresh. The attempted framework Link also duplicated hashes in this installed version. The final implementation uses the installed framework's documented native history support, preserving query parameters and browser history. Save/reload and back/forward now pass. A premature test reload and ambiguous heading selector were corrected as test issues, not presented as application defects.

Wider scans also caught faint dashboard metadata and an unlabeled Risk status selector; both are corrected without changing risk transitions. The overlay test now clicks its exposed edge rather than a point covered by the open drawer.

AI and connected-assistant empty-state text failed contrast scans at 9.5px/3.3:1; scoped styles now use readable 12px text and darker colour. The original failures remain in private local logs; final passing results supersede them.

## Limits and remaining work

This is a local production demonstration with fictional records. It does not establish live-provider operation, hosted acceptance or stakeholder approval. No permissions or review/evidence meanings were redesigned. Mobile registers retain keyboard-accessible horizontal tables; separate detail-page simplification is a further visual increment.

Private local logs, fixture credentials and runtime packages remain under ignored `artifacts/ui-overhaul/`; only sanitised descriptions and fictional screenshots are committed. Application source `d5cd2f1079e1b062c7fafc8728259ef3143dbfc9` is pushed to `origin/codex/team-baseline` and running independently at http://127.0.0.1:3300/app. The packaged source fingerprints match all six changed production files. Fresh health reports app/database OK and that exact source. Both browser journeys pass against the actual background process (2/2, 16.5 seconds); the in-app browser also shows the new Settings/Team screen with retained demo records. This final follow-up changes documentation/screenshots only.

### Actual background screenshots, matching the original fictional workspace

[Running Settings at 883px](workspace-ui-2026-09-09/running-settings-883.png) · [Running Tasks](workspace-ui-2026-09-09/running-tasks-1440.png) · [Running Dashboard](workspace-ui-2026-09-09/running-dashboard-1440.png). These use the same retained workspace as the before screenshots.
