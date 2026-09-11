# Proof-to-audit Audit workspace refinement

## What changed

Before this batch, the Audit register, checklist, findings and external sharing controls worked as separate panels with weak hierarchy. The detail page made the reviewer repeatedly scan dense forms, linking proof did not scale beyond a small Evidence vault, date-expired records could still look current in exports, and an audit-only external link included organisation-wide readiness totals.

After this batch:

- the register leads with the Evidence → Monitoring → Audits journey, audit-window preparation and truthful summary counts;
- an audit workspace keeps schedule, checklist completion, findings, linked proof and the next available action in one readable hierarchy;
- desktop, tablet and phone retain the same checklist content without clipped questions, notes or proof;
- checklist results remain explicit human decisions, separate from evidence freshness and formal finding status;
- a single searchable, 25-record Evidence picker links one record to one checklist item and safely falls back from an outdated page URL;
- linked proof shows its source, collection date, validity date and effective freshness inside the decision it supports;
- date-expired and 30-day expiring records are labelled consistently in the app, external view and evidence-pack exports;
- corrective-action tasks require a recorded corrective action, and audit dates reject an end date before the start date;
- Members retain read-only audit access while Owners and Admins manage audit state, proof, findings and auditor links;
- a new auditor link is delivered once through a protected, non-cacheable endpoint; delivery failure tells the operator to revoke and recreate the active credential;
- “This audit” links expose only the named audit, its checklist, linked proof and findings, and derive the audit's real framework;
- “Whole readiness view” links use a neutral workspace label instead of inheriting an unrelated audit framework;
- the external report is a polished read-only document with no internal application links.

No automated check or evidence record is presented as a human audit decision. Missing linked proof remains visible as missing.

## Visual evidence

The implemented local production screens use fictional data:

- Audit register: [1440px desktop](proof-to-audit-audits-2026-09-11/register-desktop.png), [883px tablet](proof-to-audit-audits-2026-09-11/register-tablet.png), [390px phone](proof-to-audit-audits-2026-09-11/register-mobile.png)
- Connected audit workspace: [1440px desktop](proof-to-audit-audits-2026-09-11/workspace-desktop.png), [883px tablet](proof-to-audit-audits-2026-09-11/workspace-tablet.png), [390px phone](proof-to-audit-audits-2026-09-11/workspace-mobile.png)
- New audit: [1440px desktop](proof-to-audit-audits-2026-09-11/new-desktop.png), [883px tablet](proof-to-audit-audits-2026-09-11/new-tablet.png), [390px phone](proof-to-audit-audits-2026-09-11/new-mobile.png)
- Audit-only external report: [1440px desktop](proof-to-audit-audits-2026-09-11/external-desktop.png), [883px tablet](proof-to-audit-audits-2026-09-11/external-tablet.png), [390px phone](proof-to-audit-audits-2026-09-11/external-mobile.png)

Independent visual review found no material layout or usability issue at the three exact widths. The operator review fields remain intentionally information-dense on desktop, but all content and actions are visible and legible.

## Fresh verification

Verified on 11 September 2026 in the isolated local ComplianceHub worktree against preserved fictional local Supabase data:

- the full unit suite passed: 336 files, 2,937 tests passed and 3 skipped;
- the audit token, tenant boundary, framework, linked-proof and date-freshness database test passed all 11 pgTAP assertions;
- the linked-proof lookup used `evidence_links_audit_item_org_created_idx` in the verified query plan;
- lint passed;
- TypeScript checking passed as part of the production build;
- the Next.js production build passed;
- the responsive Audit browser suite passed at 1440px, 883px and 390px, including page containment, keyboard reachability, reduced-motion behavior and no serious or critical automated accessibility findings;
- the connected production browser journey passed in 20.0 seconds: plan audit, populate and review checklist, link proof, raise a finding and corrective task, mint a one-time link, open the audit-only external view, reload it without re-exposing the credential, and revoke access;
- independent specification, standards and visual reviews found no remaining material issue after their findings were resolved;
- the repository privacy guard passed before commit and push.

These checks prove implemented code, automated checks, local production rendering and fictional local behavior. They do not prove a hosted release, live-provider collection, screen-reader acceptance, external auditor acceptance, leadership acceptance or certification readiness.

## Running preview and source identity

Application source `b82cfb3` is pushed to the existing `codex/team-baseline` branch. Its immutable production package is running in the background at http://127.0.0.1:3300/app/audits. Fresh health reports application and database `ok` with exact release identity `b82cfb3108d914989a9bd565a10da49161938e21`.

The persistent local app uses the preserved team-baseline database. The database function was reapplied without resetting or deleting saved records.

## Architecture boundary

Audit records own schedule and lifecycle status. Checklist items own human test results and review notes. Evidence remains an immutable record linked through the existing evidence-link relationship. Findings own severity and resolution state, and may reference a separate corrective task. Auditor tokens are stored only as hashes; a protected endpoint consumes the short-lived one-time delivery cookie.

The token-gated database function is the tenant-bounded external read boundary. It returns an explicit `audit` or `organisation` access scope. Audit scope suppresses organisation-wide aggregates and selects only the named audit's checklist, linked evidence and findings. Organisation scope retains the broader readiness summary. This keeps external disclosure aligned with the label the operator selected.
