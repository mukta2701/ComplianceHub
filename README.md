# ComplianceHub

ComplianceHub is an open-source, UK-first information security management tool for small companies working toward ISO/IEC 27001:2022. It turns a plain-English readiness assessment into a live ISMS: a dashboard with a first-run onboarding checklist, a reviewable Statement of Applicability, an auditable risk register, and the surrounding workflow needed to actually run and evidence a management system.

ComplianceHub supports readiness work. It does **not** provide certification, legal advice, or a substitute for an accredited auditor. The included questions and starter policy content are original to ComplianceHub and do not reproduce ISO standards text.

## Features

- **Assess & scope** — plain-English gap assessment → a Statement of Applicability with per-control implementation status and readiness scoring.
- **Risk & assets** — a documented 5×5 risk register with configurable RAG bands, treatment plans that spawn owned tasks, and an asset inventory. XLSX/CSV import + export for every register.
- **Evidence vault** — immutable proof attached to controls/risks/tasks, with a daily sweep that re-checks freshness and raises replacement tasks when evidence goes stale. **Continuous evidence automation** collects evidence from external sources (sandbox provider by default).
- **Internal audit** — plan audits, populate the checklist from the Annex A control library in one click, raise findings that become owned corrective-action tasks, and produce a leadership readiness report + an evidence pack. Time-boxed read-only auditor links.
- **Policies** — a policy library with an approval lifecycle, per-employee version-stamped acceptance, material-edit re-accept, scheduled review reminders, and 10 original, editable starter policies for ISO 27001 readiness.
- **KPIs & management review** — a KPI register with measurement trends for management review.
- **Integrations** — Owner/Admin-managed GitHub and Jira OAuth authorization through a server-only Nango boundary, with mode-bound ticket push/status sync, linked GitHub compliance monitoring, enable/disable controls, and a network-free local sandbox path.
- **Internal MCP + daily digest** — OAuth-protected, read-only MCP tools for workspace compliance facts plus an Owner-only, fact-hashed Slack digest flow with encrypted webhook delivery and replay-safe delivery records.
- **GitHub shadow collection** — a private, read-only GitHub App flow can scope one repository, collect sanitised security observations, and show collection health without changing readiness, evidence, findings, MCP answers, or Slack output.
- **Multi-framework** — record how your ISO 27001 controls map to SOC 2 / GDPR / HIPAA / NIST CSF / ISO 27017, with per-framework coverage.
- **Public Trust Center** — an owner-opt-in public page that shares only a safe security-posture summary with prospects.
- **Multi-tenant & audited** — every table is org-isolated via Postgres Row-Level Security with cross-tenant attack tests, and every change is captured to an audit trail.

## Local development

Requirements: Node.js 22+, npm, Docker Desktop, and the Supabase CLI.

```bash
cp .env.example .env.local
npm install
npx supabase start
npm run dev
```

Use the local Supabase values printed by `supabase start` in `.env.local`. Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
Leave `MCP_RESOURCE_URL`, `SUPABASE_OAUTH_ISSUER`, and `SUPABASE_OAUTH_JWKS_URL` blank for local development; they use fixed loopback defaults. Set them to the exact hosted origin and Supabase issuer/JWKS values only for staging or production.

## Verification

```bash
npm run verify
npm run test:db
npm run test:e2e
```

The browser suite runs both desktop and mobile projects. It uses the local
Supabase environment from `.env.local` (or the CI-provisioned environment) and
serializes local runs to one worker because the local stack is shared. Set
`E2E_TEST_TOOLS_ENABLED=1` only for local test runs so the sandbox integration
fixtures are visible; never enable that flag on a hosted origin. CI runs the
suite against the production build; local runs use the development server for
faster iteration.

`npm run test:db` runs ordinary pgTAP against the current local schema and does
not reset the database. The historical migration-upgrade harness is deliberately
separate because it destroys all data in the local Supabase instance: it resets
to migration `20260807047000`, loads legacy fixtures, applies the remaining
migration, verifies the result, and finally resets to a fresh current schema
without seed data. It always uses `--local` and never a linked or hosted project.
Run it only when losing every local record is acceptable:

```bash
COMPLIANCEHUB_ALLOW_LOCAL_DB_RESET=1 npm run test:db:upgrade
```

Without that exact acknowledgement (or `CI=true` in an isolated CI job), the
upgrade harness exits before invoking Supabase.

## Deployment

The active staging target is Azure Container Apps with managed Supabase; Vercel
is not used by the current rollout. See `docs/deployment.md` and the checked-in
release checklist. Hosted migrations, Azure credentials, GitHub App approval,
and real Slack delivery remain explicit owner-controlled gates. The application
remains portable because schema changes are SQL migrations and core domain logic
is framework-independent TypeScript.

## Security and privacy

Do not report vulnerabilities through public issues. Use the repository security-advisory channel or contact the project owner privately. See `SECURITY.md` and `docs/privacy.md`.

## Licence

MIT. See `LICENSE`.
