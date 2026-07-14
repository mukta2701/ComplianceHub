# Owner Connections Catalogue Design

## Purpose

Replace the crowded Owner/Admin connections workspace with a simple provider
catalogue based on the approved prototype. The page should help an operator
answer three questions immediately:

1. Which tools can ComplianceHub connect to?
2. Which tools are connected now?
3. Where do I connect or manage one tool?

The interface must use product language such as **Connect**, **Connected**, and
**Manage**. It must not explain or foreground OAuth, brokers, tokens, Nango, or
SSO. Those remain implementation and deployment concerns.

## Page structure

The existing application sidebar remains the only page navigation. The current
Settings/Connections subtab row is removed so the page does not introduce a
second navigation system.

The main column contains:

- a plain `Connections` heading and one-sentence description;
- one search input;
- three compact filters: `All`, `Development`, and `Alerts`;
- a responsive connector-card grid;
- one focused management panel that appears only after an operator selects a
  provider.

The first catalogue contains exactly three providers:

- **GitHub** — repository monitoring and security findings;
- **Jira** — remediation ticket creation and status synchronisation;
- **Slack** — delivery of monitoring alerts.

Desktop uses a three-column grid, tablet uses two columns, and phone uses one
column without horizontal overflow.

## Card states and interaction

Each card shows only its icon, provider name, short outcome-based description,
category, status, and one action.

- A provider with no live configuration shows `Not connected` and `Connect`.
- A provider with a live configuration shows `Connected` and `Manage`.
- A provider that is authorised but still needs a repository/project shows
  `Setup required` and `Continue setup`.
- A disabled provider remains connected and shows its paused state inside the
  management panel rather than adding more card controls.

Search and category filtering are local presentation controls. They do not
change or query workspace data.

Selecting a card opens one management panel below the grid:

- GitHub and Jira use the existing provider connection action. Existing
  connections can be enabled, disabled, completed, or disconnected there.
- Slack lists existing channels and contains the existing add-channel form.
  Channel destinations remain encrypted and are never redisplayed.

Only one provider panel is open at a time. Closing it returns the page to the
clean catalogue view.

## Removed clutter

The production page no longer displays:

- technical OAuth/SSO explanations;
- Nango or provider-deployment notices;
- monitoring-source configuration and status lists;
- evidence-source forms and lists;
- the large local sandbox/developer setup block.

Monitoring remains visible on `/app/monitoring`. Existing monitoring and
evidence data/actions are not deleted. Evidence-source administration is left
for a later dedicated owner experience.

Deterministic sandbox controls may remain available only in development/test
builds so automated workflows keep working; they must be absent from the
production preview and deployed page.

## Authorization and data handling

The existing `manage_connections` capability remains unchanged. Only Owner and
Admin can load or operate the catalogue. Member behaviour is intentionally not
redesigned in this iteration.

Every connection and alert query remains explicitly filtered to the active
organisation. The page continues to fail closed when a required dataset cannot
load. Browser-visible projections exclude provider tokens, refresh tokens,
client secrets, and Slack destination values.

## Testing

- Page tests prove the simplified provider catalogue, the absence of technical
  and removed sections, active-organisation filters, safe projections, and
  fail-closed query handling.
- Component tests prove search, category filters, one-panel-at-a-time
  interaction, and Connect/Manage states.
- Existing action tests continue to cover Owner/Admin authorization, tenant
  isolation, provider lifecycle, Slack encryption, and secret handling.
- Browser tests cover GitHub/Jira/Slack cards, connection management,
  accessibility, console/network errors, and desktop/mobile width.
- Fresh lint, type-check, application tests, production build, and privacy scan
  run before completion.
