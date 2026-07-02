# ComplianceHub

ComplianceHub is an open-source, UK-first information security readiness tool. It turns a plain-English ISO/IEC 27001:2022 readiness assessment into a dashboard, a reviewable Statement of Applicability, and an auditable risk register.

ComplianceHub supports readiness work. It does **not** provide certification, legal advice, or a substitute for an accredited auditor. The included questions are independently written and do not reproduce ISO standards text.

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
