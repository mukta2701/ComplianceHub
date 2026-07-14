# Settings Connections Tabs Design

## Goal

Place the Owner/Admin Connections catalogue inside the Settings navigation hierarchy without changing its provider workflows, data loading, or existing URL.

## Approved navigation

- The main application sidebar shows one Admin destination: **Settings**.
- Settings contains two route-backed tabs: **Settings** and **Connections**.
- `/app/settings` remains the organisation, team, invitation, and security page.
- `/app/integrations` remains the GitHub, Jira, and Slack catalogue.
- The Settings sidebar item stays active on either route, while the application header continues to say **Connections** on `/app/integrations`.

## Options considered

1. **Route-backed tabs — selected.** Preserve both existing routes and present them as tabs. This is the smallest change and keeps links, server actions, and refresh behavior stable.
2. **Query-string tabs.** Move Connections to `/app/settings?tab=connections`. This would combine unrelated server data and increase client state without improving the experience.
3. **Nested route migration.** Move Connections to `/app/settings/connections`. This is structurally clean but requires redirects and broader route/action changes.

## Page structure

The Settings page keeps its current heading, then renders the two Settings tabs before its existing section navigation. The Connections catalogue keeps its own heading, then renders the same tab row before search, filters, and provider cards. The tab row is the only added UI; the catalogue layout and management panels remain unchanged.

The catalogue accepts an optional navigation slot so the server page can place the shared route-backed tabs between the catalogue heading and toolbar without duplicating the heading or moving interactive catalogue state to the server.

## Access and data behavior

Owner/Admin access rules remain unchanged. Connections continues to query only active-workspace connection and alert metadata. Provider credentials and Slack destinations remain excluded from browser data. Member navigation remains unchanged and does not gain a Settings destination.

## Accessibility and responsive behavior

The existing `SubTabs` navigation exposes `aria-current="page"` for the active route and wraps on narrow screens. The Settings sidebar link also exposes `aria-current="page"` on both Settings routes. Provider-panel focus and phone scrolling behavior remain unchanged.

## Verification

- Unit-test sidebar grouping and active state.
- Unit-test both Settings tabs on the Connections page.
- Run the existing catalogue, Settings shell, and connection page suites.
- Exercise navigation from Settings to Connections in Chromium and the phone viewport.
- Run lint, typecheck, unit tests, and production build before restarting the live preview.
