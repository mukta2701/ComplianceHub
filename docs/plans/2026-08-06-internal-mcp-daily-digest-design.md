# ComplianceHub Internal MCP and Daily Slack Digest Design

## Goal

Expose the existing ComplianceHub service as a private, hosted MCP server so
Codex and Claude can read trusted compliance state. A scheduled Codex task uses
that state to produce one verified Slack digest each working day without adding
an AI dependency to the ComplianceHub runtime.

## Architecture

The existing Next.js deployment hosts a Streamable HTTP MCP endpoint. Supabase
remains the canonical store and OAuth 2.1 authorization server; every MCP
request uses the caller's access token and therefore remains subject to the
existing organisation membership and RLS rules. The service-role client remains
limited to existing hosted automation.

V1 exposes focused read tools for workspaces, readiness, attention items,
monitoring findings, and leadership reporting. A read-only digest preparation
tool returns bounded facts plus a deterministic hash. The only V1 write tool is
Owner-only and posts a validated summary to the organisation's preconfigured
Slack digest channel after confirming the facts have not changed.

Codex receives the MCP connection through a private internal plugin containing
a daily-brief skill. Claude uses the same MCP server and its server instructions.
The current web interface remains the administration and fallback surface.

## Security boundaries

- Verify OAuth signature, issuer, audience, expiry, client identity, and user on
  every request; use asymmetric signing keys and PKCE.
- Resolve organisation access server-side. Never trust an actor or organisation
  identifier merely because it appears in model input.
- Return no access tokens, webhook URLs, evidence bodies, policy content,
  secrets, or unnecessary member data.
- Mark all read tools read-only and the Slack tool as an external write.
- Keep Slack channel management and digest publishing Owner-only.
- Reserve one digest per organisation and local date before delivery. Recompute
  the fact hash immediately before posting and reject stale summaries.
- Record the exact outgoing message and delivery outcome. Never automatically
  retry an ambiguous delivery.

## Rollout

Prove Supabase OAuth interoperability with Codex and Claude in staging before
production. Run the digest in shadow mode, then send three test-channel posts,
then dogfood the team-channel schedule for ten business days. Task mutations,
news aggregation, public plugin distribution, custom PR automation, and a new
master dashboard are explicitly outside V1.
