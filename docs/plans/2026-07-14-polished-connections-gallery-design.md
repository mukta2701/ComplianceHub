# Polished Connections Gallery Design

## Goal

Refine the approved Owner/Admin Connections page without changing ComplianceHub's overall visual language, route hierarchy, permissions, or provider workflows.

The page should feel calm and complete with the three providers currently supported. Catalogue controls intended for a larger future provider library should not appear yet.

## Approved direction

Use the existing responsive three-card gallery for GitHub, Jira, and Slack.

Remove:

- the Search connections field;
- the All, Development, and Alerts category controls;
- the client-side search and category state that only supports those controls.

Keep:

- Settings and Connections route-backed tabs;
- GitHub, Jira, and Slack provider cards;
- connected, setup-required, paused, and not-connected states;
- the focused provider management panel below the cards;
- Owner/Admin permissions and current data queries;
- development-only local preview tools.

## Page structure

The page keeps the existing Connections heading and short introduction, followed by the Settings and Connections tabs. The provider gallery begins immediately after the tabs.

Each card contains four clear layers:

1. Provider icon and name.
2. Current status.
3. One concise description of what the connection does.
4. A footer with the selected target or account and one Connect, Continue setup, or Manage action.

The footer gives an operator useful context without opening the management panel:

- GitHub shows the selected `owner/repository` when one connection exists.
- Jira shows the configured project key, connection label, or site when one connection exists.
- Slack shows the configured channel label when one channel exists.
- Multiple records show a concise count such as `2 connections` or `2 channels`.
- Missing target configuration shows a short setup cue instead of an empty value.
- A provider with no record shows `Not configured`.

The management panel remains the only place for configuration, pausing, enabling, disconnecting, and adding Slack destinations. It opens below the full gallery, receives focus, scrolls into view, and returns focus to its card action when closed.

## Visual behavior

The refinement uses the established ComplianceHub tokens, spacing, border treatment, pills, buttons, and responsive breakpoints. It does not introduce a new design system or decorative dashboard elements.

Cards remain three columns on wide screens, two columns at the existing tablet breakpoint, and one column on phones. Card footers align the target summary and action consistently. Long repository, project, or channel labels truncate visually while retaining their full accessible value.

Connected providers use the existing status treatment. The primary visual emphasis remains on a provider that needs connection; management actions for connected providers stay secondary.

## Data and access behavior

No database, server-action, provider, or authentication changes are required.

The page continues to load only active-workspace connection and alert metadata. Provider secrets and Slack destinations remain excluded from browser data. Existing capability checks continue to restrict management to Owners and Admins. Member navigation and the Settings page remain unchanged.

## Empty and error behavior

Because the three supported providers are always displayed, removing search also removes the no-search-results state. Individual cards communicate their own not-connected or setup-required state.

Existing server load failures continue to fail closed with the current connection-settings error. Provider action errors and redirects keep their current behavior.

## Verification

- Update catalogue tests to prove search and category controls are absent.
- Test target summaries for zero, one, multiple, and setup-required records.
- Preserve provider-panel focus, close, enable, disconnect, and Slack-channel assertions.
- Verify the Connections page still exposes the Settings tabs and omits technical OAuth/SSO terminology.
- Exercise the Owner journey in Chromium and the phone viewport.
- Check accessibility and horizontal overflow.
- Run lint, typecheck, unit tests, production build, and an independent code review before refreshing the live preview.
