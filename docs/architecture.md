# Architecture

ComplianceHub is a Next.js modular monolith backed by Supabase PostgreSQL and Auth. Browser code reads and mutates data only through row-level security or validated server operations. Core scoring, SoA, and risk logic is implemented in framework-independent TypeScript.

All tenant-owned rows carry an organisation identifier. Catalogue versions, finalised SoA snapshots, and audit events are immutable. Exports consume finalised snapshots so historical documents are reproducible.

The control catalogue is framework-agnostic. `frameworks` holds versioned, immutable catalogues (ISO/IEC 27001:2022 today); `requirements` are a framework's own clauses, and reuse the existing control-catalogue UUIDs so the ISO requirements attach without a data migration; `controls` is the shared, framework-neutral library of things an organisation actually does; `requirement_control_mappings` joins the two many-to-many, so a control satisfies requirements across several frameworks and evidence, tasks, and policies attach to controls rather than to any one framework.

Three further features build on this catalogue. `src/features/tasks` tracks remediation work — status, owner, due date, an optional recurrence, and a `source` recording why the task exists (manual, a gap, evidence expiry, and so on); completing a recurring task creates the next occurrence at completion time rather than on a schedule. `src/features/evidence` records supporting artefacts (files, links, or notes) against controls; uploaded files live in a private Supabase Storage bucket named `evidence`, addressed under an `<organisation_id>/<uuid>/<filename>` path so RLS on `storage.objects` can scope access by organisation, and are only ever served back through short-lived signed URLs. Evidence rows are never hard-deleted: superseding or withdrawing evidence writes a new status and an audit event rather than removing the record. `src/features/automation` runs the daily sweep: the planning logic (which evidence has gone stale, which tasks are overdue, what to notify) is pure, dependency-free TypeScript in `domain/sweep.ts`, and all Supabase reads/writes are injected as an object of async functions in `application/daily-sweep.ts` — the same domain logic runs unchanged in tests against fakes and in production against the live database. `notifications` is the in-app record the sweep writes to; each row belongs to one member and is readable only by that member.

The sweep is exposed at `GET /api/cron/daily` (also accepts `POST`), authenticated by comparing an `Authorization: Bearer <CRON_SECRET>` header against the `CRON_SECRET` environment variable using a constant-time comparison. Writes are deduplicated so re-running the sweep, or a scheduled-workflow retrying a slow invocation, is safe: notifications use a per-day uniqueness constraint, and an evidence-expiry task is only created while no such task is already open for that evidence item.

The internal MCP surface is a separate read boundary over the same tenant-scoped
facts. Protected-resource metadata advertises the canonical `/mcp` audience;
OAuth authorization-code and refresh grants are validated against Supabase Auth,
and every MCP read resolves the caller's accessible organisations through RLS.
Seven read/prepare tools expose overview, attention items, monitoring findings,
immutable official GitHub results, leadership reports, and digest preparation.
`prepare_daily_digest` is deliberately
side-effect free. The separate Owner-only `post_daily_digest` tool is an
external Slack write, not part of the read surface; it revalidates the fact hash, reserves one
delivery row, encrypts the configured Slack incoming-webhook URL at rest, and
finalises a terminal delivery state without automatic retries after an unknown
network outcome.

GitHub collection is another isolated provider boundary. A private
read-only GitHub App installation is claimed to one organisation, selected
repositories are collected through bounded allowlisted API calls, and only
sanitised shadow observations are stored. Shadow rows alone never alter
readiness, evidence, findings, MCP answers, or digest facts. An Owner-approved,
immutable mapping pack authorises a separate transactional materialiser, which
persists evidence/finding lineage and an immutable official-result row together.
The schema-v2 digest reads only the latest official result per stable repository
and check identity; it partitions active current, active stale, and historical
mapping results and derives bounded changes only from immutable lifecycle
lineage since the latest prior delivered digest. The exact partition, nullable
baseline, changes, and truncation state are included in the canonical fact hash.
Signed webhook intake is replay-safe and queues bounded rechecks; scheduled
reconciliation is the recovery path for terminal failures.
