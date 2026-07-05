# ComplianceHub Roadmap v3 — One-Stop ISMS for Small Companies

**Date:** 2026-07-05
**Status:** Approved by founder (phase ordering B → C → D)
**Supersedes:** the phase sequencing in `2026-07-02-compliancehub-v2-design.md` §5–§8. That document's architecture principles (§3, §3a, §10) remain binding. Its Phase 7 (AI assistance) is **struck entirely** — the founder explicitly does not want an "AI compliance officer".
**Research inputs:** `.superpowers/research/isms-reference-features.md` (CISO Assistant CE + Vanta feature analysis), `.superpowers/research/iso-toolkit-structures.md` (structural digest of the founder's ISO-27001-2022 toolkit workbooks — the ground-truth requirements for spreadsheet parity).

## Vision

A one-stop ISMS / ISO 27001 compliance system for companies of 10–20 people that leadership, security, and developers can all understand. Governance, risk, and compliance in one interactive product. Zero compliance work left in Excel: everything the founder's toolkit workbooks do moves into the app, importable and exportable. Audits are run in the product with centralised evidence and reporting. Remediation flows to where teams already work (Jira, GitHub Issues).

**Explicit non-goals** (anti-features validated by research): no AI compliance officer; no multi-org folder hierarchies; no SAML/SCIM (OAuth login suffices); no fine-grained RBAC beyond ~4 roles; no full auditor portal (a time-boxed read-only link suffices); no integration marketplace (3–5 deep integrations beat 300 shallow ones); no device-monitoring agent; no NDA-gated trust centre.

## Shipped foundation (v2 Phase 1, merged f6d24ab)

Framework-agnostic control library (ISO 27001:2022 populated); assessment; risk register (5×5, inherent + residual); SoA; tasks engine (gap→task, recurrence, starter calendar); evidence vault (freshness, supersede/withdraw); daily sweep automation; in-app notifications; demo mode; full test gate (unit, pgTAP RLS attack tests, e2e + axe).

## Phase A — UI uplift + go-live (in flight)

Spec: `2026-07-05-app-ui-uplift-design.md`. Promote the demo design language to the authenticated app; dashboard makes automation visible (needs-attention queue with source labels). Deploy: GitHub push, hosted Supabase, Vercel with `CRON_SECRET` cron. Presentation-only; no schema changes.

## Phase B — Kill the spreadsheets

Parity with (and improvement over) the toolkit workbooks, plus import/export. Guiding source structures are in the toolkit digest.

- **Risk management deepening:** risk treatment plans as linked entities (RTP ref → risk, target/actual completion) that spawn tasks; risk categories (dedupe the template's duplicate vendor-risk entry); risk matrix as configuration data (`risk_matrices` grid JSON — CISO Assistant pattern), not a hardcoded 5×5, with RAG banding derived from the matrix.
- **SoA upgrade:** applicability (yes/no + justification) and the 7-value implementation status (Pending/Absent/In Progress/Established/Operational/Advanced/Not Applicable, or a rationalised equivalent) per control; per-control **owner** — this is the "map controls into the company" requirement. Aligns with the applied-control model (decoupled from framework requirements, many-to-many).
- **Asset inventory (new module `src/features/assets`):** template's 8 columns; Classification (4 levels) and Value/Criticality (3 levels) enums; category taxonomy; assets linkable to risks.
- **Import/export (cross-cutting, designed once):** XLSX/CSV import mapped to the founder's actual toolkit templates (risk register, SoA, asset inventory) with a column-mapping step; export of every module to XLSX/CSV. Exit criterion: the founder's real workbooks import cleanly and the toolkit files can be archived.

## Phase C — Run the audit

- **Internal audit module (new `src/features/audits`; distinct from the existing sanitised activity log):** audit object with status + dates (simple model, no workflow engine); clause/control checklist (template's 9-column structure); findings/non-conformities with root cause + corrective action that become tasks; evidence referenced from the vault per checklist item.
- **Management review / KPI log (new, light):** indicator, measurement type (Automatic/Manual/External), threshold, observations, next steps → tasks.
- **Reporting:** leadership-readable readiness report (framework coverage, risk posture, task/evidence health) and an audit evidence pack export.
- **Auditor access:** one external-auditor role — time-boxed, framework-scoped, read-only.

## Phase D — Policies + integrations

- **Policy management (`src/features/policies`, per the v2 design §5)** with Vanta's live-signal pattern: each policy carries an approval state and per-employee acceptance tracking; a material edit resets acceptances and re-notifies. Policies attachable as evidence.
- **Ticketing sync (Jira + GitHub Issues):** one-click ticket creation from any task, pre-filled with remediation content; polling sync (~30–60 min) of status/assignee back; OAuth per integration. (Free-tier differentiator vs CISO Assistant.)
- Optional, if time allows: static public security-overview page (no gating workflows).

## Process

Each phase: brainstormed spec → implementation plan → subagent-driven build (heavy tasks on Opus, light on Sonnet) → per-task review → final whole-branch review → merge → deploy. Cross-cutting constraints from the v2 design §10 (RLS + attack tests on every tenant table, audit triggers, domain-first testing, e2e + axe, original content) bind every phase.
