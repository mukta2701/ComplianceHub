# ComplianceHub

ComplianceHub is an open-source, UK-first information security management tool for small companies working toward ISO/IEC 27001:2022. It turns a plain-English readiness assessment into a live ISMS: a dashboard with a first-run onboarding checklist, a reviewable Statement of Applicability, an auditable risk register, and the surrounding workflow needed to actually run and evidence a management system.

ComplianceHub supports readiness work. It does **not** provide certification, legal advice, or a substitute for an accredited auditor. The included questions and policy templates are independently written and do not reproduce ISO standards text.

## Features

- **Assess & scope** — plain-English gap assessment → a Statement of Applicability with per-control implementation status and readiness scoring.
- **Risk & assets** — a documented 5×5 risk register with configurable RAG bands, treatment plans that spawn owned tasks, and an asset inventory. XLSX/CSV import + export for every register.
- **Evidence vault** — immutable proof attached to controls/risks/tasks, with a daily sweep that re-checks freshness and raises replacement tasks when evidence goes stale. **Continuous evidence automation** collects evidence from external sources (sandbox provider by default).
- **Internal audit** — plan audits, populate the checklist from the Annex A control library in one click, raise findings that become owned corrective-action tasks, and produce a leadership readiness report + an evidence pack. Time-boxed read-only auditor links.
- **Policies** — a policy library with an approval lifecycle, per-employee version-stamped acceptance, material-edit re-accept, 10 starter ISO 27001 templates, and scheduled review reminders.
- **KPIs & management review** — a KPI register with measurement trends for management review.
- **Integrations** — push remediation tasks to Jira / GitHub Issues and sync status back (terminal status auto-closes the task); a built-in sandbox tracker for trialling the flow.
- **Multi-framework** — record how your ISO 27001 controls map to SOC 2 / GDPR / HIPAA / NIST CSF / ISO 27017, with per-framework coverage.
- **Public Trust Center** — an owner-opt-in public page that shares only a safe security-posture summary with prospects.
- **Multi-tenant & audited** — every table is org-isolated via Postgres Row-Level Security with cross-tenant attack tests, and every change is captured to an audit trail.

## Local development

Requirements: Node.js 22+, pnpm 11+, Docker Desktop, and the Supabase CLI.

```bash
cp .env.example .env.local
pnpm install
pnpm exec supabase start
pnpm dev
```

Use the local Supabase values printed by `supabase start` in `.env.local`. Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.

## Verification

```bash
pnpm verify
pnpm test:db
pnpm test:e2e
```

## Deployment

The reference beta deployment uses Vercel and managed Supabase. See `docs/deployment.md`. The application remains portable because schema changes are SQL migrations and core domain logic is framework-independent TypeScript.

## Security and privacy

Do not report vulnerabilities through public issues. Use the repository security-advisory channel or contact the project owner privately. See `SECURITY.md` and `docs/privacy.md`.

## Licence

MIT. See `LICENSE`.
