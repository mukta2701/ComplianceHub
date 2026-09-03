# Phase 3 — Reusable Full MCP Demo Design

Date: 2026-09-03
Status: Reviewer APPROVED; supervisor GO; awaiting user approval to implement
Owner: ComplianceHub

## Objective

Provide one reliable local demo command that starts a disposable, fully populated, proof-ready ComplianceHub environment against representative test data. A separate explicit command proves the complete MCP surface. The existing real GitHub pilot, its installation, its OAuth state, and its 15 official results must remain untouched.

## User outcome

Running `npm run demo:start` will open a separate ComplianceHub Demo Lab with:

- a stable local test account and one clearly synthetic organisation;
- representative assessment, SoA, risk, policy, evidence, task, audit, KPI, notification, leadership-report, and monitoring records;
- two synthetic GitHub repositories with useful pass, fail, unknown, not-applicable, current, stale, active-mapping, and historical-mapping cases;
- an unavoidable warning that the data was not collected from GitHub and is not evidence of compliance or certification;
- a working OAuth-protected MCP endpoint that can be tested from top to bottom.

The real application remains available through its existing local environment. Ordinary `npm run dev`, production startup, builds, health checks, and normal Supabase startup must never load or reset demo data.

## Chosen architecture

### Separate disposable environment

The Demo Lab uses a distinct local Supabase project and Docker volume. Its default addresses are:

- application: `http://127.0.0.1:3200`;
- MCP resource: `http://127.0.0.1:3200/mcp`;
- Supabase API: `http://127.0.0.1:55321`;
- PostgreSQL: `127.0.0.1:55322`;
- Studio and supporting services: dedicated non-production ports that do not overlap with the real pilot.

The demo Supabase project replays the canonical migrations from the repository into its own database. It has its own local Auth configuration and an MCP audience of `http://127.0.0.1:3200/mcp`.

The exact externally bound Demo Lab ports are fixed in a checked-in demo configuration:

| Service | Port |
| --- | ---: |
| PostgreSQL shadow database | 55320 |
| Supabase API gateway | 55321 |
| PostgreSQL | 55322 |
| Supabase Studio | 55323 |
| Mailpit web UI | 55324 |
| Mailpit SMTP | 55325 |
| Mailpit POP3 | 55326 |
| Analytics | 55327 |
| Database pooler | 55329 |

The Docker identity is also fixed: Compose project and Supabase project `compliancehub-demo`; containers `supabase_{studio,pg_meta,edge_runtime,storage,rest,realtime,inbucket,auth,kong,vector,analytics,db}_compliancehub-demo`; network `supabase_network_compliancehub-demo`; and volumes `supabase_db_compliancehub-demo`, `supabase_edge_runtime_compliancehub-demo`, and `supabase_storage_compliancehub-demo`. The accepted database image is the exact image pinned by the repository's current Supabase CLI configuration, recorded in the demo manifest rather than accepted by a loose prefix.

There is only one migration byte set. The demo workspace uses a read-only link to `supabase/migrations`; it never copies or forks migration files. Before reset, the launcher resolves the link inside the repository, rejects any other target, computes a content SHA-256 for every file, then compares one aggregate SHA-256 over each ordered relative path, byte length, and content digest with the canonical directory. `demo:verify` repeats that byte-equality gate.

This design deliberately rejects loading synthetic official results into the real pilot database. The official GitHub result ledger is immutable, and mixing synthetic and provider-collected records would create an unacceptable evidence-provenance ambiguity.

### Explicit commands

- `npm run demo:start`: validate the target, recreate only the disposable Demo Lab, load and verify fixtures, then start the app on port 3200. It does not run a browser or MCP proof.
- `npm run demo:reset`: recreate and verify only the Demo Lab database, without starting the web app.
- `npm run demo:verify`: verify fixture version, counts, hashes, isolation, and expected MCP-readable state without changing data.
- `npm run demo:mcp-proof`: run the real OAuth/MCP acceptance conversation against the Demo Lab.

No demo loader is imported from Next.js application code or invoked by package lifecycle hooks, cron routes, migrations, builds, health checks, `npm run dev`, or `npm start`.

## Fixture data

### Source and privacy rules

Fixture scenarios are authored as static, versioned data based on public GitHub documentation for branch protection, required reviews, status checks, Dependabot, code scanning, secret scanning, push protection, and workflow permissions. The Demo Lab never downloads live internet data during startup.

Fixtures must use:

- reserved `.test` or `.invalid` identities;
- fictional organisation and repository names;
- deterministic UUIDs and high reserved provider IDs;
- no copied user, repository, database, proof-artifact, webhook, or provider payload;
- no secret, access token, private key, real email address, or real person.

The fixture manifest records its version, SHA-256 hash, and the public documentation URLs used to design the scenarios. Documentation URLs are provenance for the test design, not claims that GitHub produced the fixture records.

### Representative states

The fixture pack contains meaningful linked data rather than filling every table:

- one Owner and one synthetic workspace;
- one negative-control user in a separate negative-control workspace, with no membership in the primary workspace and no shared records;
- completed and unanswered assessment items producing a non-perfect readiness score;
- applicable, excluded, and review-needed SoA controls;
- open, overdue, due-soon, and completed tasks;
- current, expiring, expired, superseded, and missing evidence states;
- very-high, high, moderate, and low risks;
- draft and approved policies with acknowledgement examples;
- open and completed audit/non-conformity examples;
- KPI, activity, notification, and leadership-report examples;
- two inert synthetic GitHub repositories;
- all four official GitHub outcomes plus current/stale and active/historical mapping states;
- monitoring findings across high, medium, and low severities.

All fixture time derives from one validated snapshot instant interpreted in `Europe/London`. The one-click default is the current London date at 09:00; tests and repeatability checks may supply a strict RFC 3339 `--as-of` value through the fixed launcher interface. The validated value is recorded in the private demo manifest before data creation. Every fixture-owned timestamp, date, request key, natural key, and deterministic UUID is an explicit function of that instant and the fixture version. Scenario changes require a fixture-version change; two resets are byte-semantically comparable only when given the same fixture version and snapshot instant.

The canonical schema supplies a private `compliance_clock()` dependency used by collection completion, repository last-seen updates, official materialisation, monitoring freshness, and digest/MCP reads. With a verified synthetic sentinel it returns the manifest-controlled phase clock; with a provider manifest it returns the real database clock. During bootstrap the guarded loader advances the synthetic clock through deterministic T0–T5 offsets for the v1 approval, v1 materialisation, v1 revocation, v2 approval, v2 materialisation, and final proof snapshot, then seals it before the app starts. No app, public role, ordinary service-role code path, or MCP caller can change it. Provider regression tests prove the same dependency remains within a tight tolerance of real database time.

## Synthetic GitHub lane

The fixture loader uses a reviewed, dependency-injected, network-free GitHub fact provider and the existing collection, evaluation, approval, and materialisation boundaries. It must not insert naked official result rows that bypass normal ancestry. The production provider rejects the reserved fixture organisation, installation, repository, and provider-ID namespaces before credential lookup or any network-capable path.

Every synthetic official result must have:

- a dedicated synthetic organisation, inert installation, and repository;
- one matching observation;
- a terminal succeeded or partial collection run;
- a mapping approval that was active at that result's `materialised_at`, with exact version and checksum;
- evidence or finding lineage appropriate to the outcome;
- no reachable GitHub provider or Slack path.

The installation is unavailable for real collection, and its repository cannot be selected by a production collector.

Historical mapping state is created in this exact order: publish and approve mapping v1 at T0; collect and materialise the v1 observations at T1; revoke v1 at T2; approve v2 at T3; collect and materialise the v2 observations at T4. At proof time the immutable v1 results are historical and v2 is active, while every result still points through installation → repository → run → observation → approval → mapping pack and then to its evidence or finding provenance.

The current materialiser's single hard-coded v1 pack is refactored to a closed, code-reviewed mapping registry containing exactly the existing provider v1 pack and one versioned synthetic-demo v2 pack with fixed entries and checksum. Provider collection remains pinned to v1. Selection of v2 requires the verified synthetic sentinel and reserved demo tenant; unknown versions, checksum drift, provider use of v2, or demo use outside the reserved tenant fail before materialisation. The refactor retains the current approval, ancestry, and immutable-ledger checks.

## Provenance and presentation

The Demo Lab runtime has a machine-readable origin of `synthetic_demo`. Real provider-backed environments use `provider`. Origin is never accepted from a launch environment variable.

A new private, RLS-enabled, unexposed environment manifest is part of the canonical schema. It is readable only by the narrowly scoped server verifier and contains the origin kind, exact Supabase/Compose project identity, expected database container identity, fixture version, canonical fixture hash, snapshot/phase clock, sealed state, primary and negative-control tenant namespaces, and creation instant. After independently validating Docker identity, the guarded bootstrap creates an unsealed `loading` synthetic sentinel before fixture data. Only the loader's narrowly granted database bootstrap capability can read or advance that loading clock through T0–T5. Every app, MCP, browser, and ordinary service-role verifier rejects it while unsealed. After the pipeline verifies all contents and the canonical hash, the loader seals the manifest exactly once; sealing cannot be reversed or repeated. Application and MCP responses then derive origin from that sealed row and fail closed if its selected tenant namespace, runtime host, clock mode, or fixture hash disagrees. No public role, ordinary service-role path, browser client, or MCP caller can write or read the raw sentinel.

The real pilot manifest has `provider`, no fixture version/hash, no reserved demo namespace, and the exact `compliancehub` local project identity. The provider proof independently validates the real Docker labels and database identity, rejects the demo sentinel and all reserved fixture identifiers, then cross-checks the private manifest before accepting `provider`.

The real pilot manifest is created once by `npm run provider:origin:provision`, a separate guarded maintenance command run after the origin-schema migration and before the v3 provider proof. It accepts no target arguments and validates the literal `compliancehub` Docker/container/network/volume identities. The accepted host bindings are exactly application 3100, API gateway 54321, PostgreSQL 54322, Studio 54323, Mailpit web 54324, and Analytics 54327; shadow port 54320 is reserved but not bound in the running stack, while SMTP, POP3, and pooler have no host binding. Exact set equality is required and any additional host-bound port aborts before the write executor. The command proves the absence of demo sentinels and reserved fixture identifiers, then inserts only a missing provider row. It is idempotent for an exact match and refuses to update, replace, or infer identity from environment variables. The ordinary app, demo commands, migrations, seeds, and production startup never provision it.

Phase 3 introduces tool-output contract `v3` and ComplianceHub MCP server/plugin version `0.4.0`. It does not introduce a new MCP protocol-version negotiation mechanism. It preserves every Phase 2 v2 filter, cursor, ordering, 15/15 reconciliation, and read-only guarantee. The seven successful Phase 3 read/preparation tool results have this exact additive root envelope:

```json
{
  "ok": true,
  "contractVersion": "3",
  "dataOrigin": "provider | synthetic_demo",
  "originManifestSha256": "64 lowercase hex characters",
  "data": "existing tool-specific payload"
}
```

`originManifestSha256` hashes the safe canonical manifest projection and never exposes container paths, credentials, user identifiers, or raw private sentinel contents. Cursor payloads remain opaque and their v2 security binding is unchanged; the new envelope fields are included in response schema snapshots and proof reconciliation hashes, not in cursor MAC input. The origin also appears in:

The intentionally refused `post_daily_digest` call returns the ordinary MCP tool error shape with sanitized versioned data:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "No daily digest channel is configured." }],
  "structuredContent": {
    "ok": false,
    "error": {
      "code": "NO_DIGEST_CHANNEL",
      "message": "No daily digest channel is configured.",
      "recovery": "Ask a workspace Owner to configure one Slack digest channel.",
      "data": {
        "contractVersion": "3",
        "dataOrigin": "synthetic_demo",
        "originManifestSha256": "64 lowercase hex characters",
        "retryable": false
      }
    }
  }
}
```

- the authenticated application shell;
- Monitoring and Connections;
- evidence and report exports produced from the demo;
- every MCP workspace, compliance, findings, GitHub-results, leadership-report, digest-preparation, and digest-delivery response;
- saved Demo Lab proof artifacts.

Required human wording:

> Synthetic local demo — not collected from GitHub and not evidence of compliance or certification.

The Demo Lab must never use labels such as live, verified provider evidence, certified, compliant, production-ready, or real GitHub scan.

The existing Phase 2 proof artifact is immutable and is never edited, replaced, or reclassified. Phase 3 adds a new provider-origin regression artifact that proves the unchanged 15/15 Phase 2 semantics inside the v3 envelope and refuses to write PASS unless the real-project identity and `provider` attestation both pass. The separate synthetic proof produces its own artifact.

## Local security boundary

Before any fixture write, the launcher and loader must verify:

- explicit `--local-demo` opt-in;
- non-production runtime with no Vercel/hosted marker;
- exact loopback URLs and expected demo ports;
- local default or Colima Unix Docker socket;
- exact demo container name, project labels, network, aliases, and Supabase PostgreSQL image;
- absence of a linked hosted project target;
- that the target is the disposable `compliancehub-demo` project, never the real `compliancehub` project.

`demo:reset` first resolves the literal demo database container and all three literal demo volumes, inspects their Compose/Supabase labels, workdir, attached network, aliases, running state, and exact image, and compares them with the manifest. Missing, extra, unresolved, symlinked-outside-repository, ambiguous, or mismatched identities abort before a reset/delete command is constructed. Destructive arguments are fixed constants and never come from the shell or user input.

There is one explicit clean-machine exception: when every expected demo container, network, and volume is absent, the launcher validates the checked-in demo configuration, canonical migration manifest, Docker context, loopback bindings, and absence of name/port collisions, then creates and starts the stack without constructing a delete target. Partial presence, an unexpected resource with a reserved demo name, or any identity mismatch remains fail-closed. This is the only first-run creation path used by `demo:start` and `demo:reset`.

The loader uses fixed process arguments and fixed SQL. Callers cannot supply SQL, table names, column names, database URLs, container names, or arbitrary identifiers.

Base fixture creation is atomic: one transaction, a transaction-scoped advisory lock, fixed lock/statement timeouts, fixed search path, collision checks, and all-or-nothing rollback. A collision with a non-fixture record aborts without overwriting it. The existing GitHub collector/materialiser then runs through its real multi-transaction calls while the private manifest remains `loading`. Any base or pipeline failure leaves the manifest unsealed, prevents the application from starting, and triggers destruction/recreation of only the disposable demo database on the next command; the design does not claim rollback across separate Supabase calls.

The launcher starts the loader and application with a minimal allowlist of environment names. It never inherits `.env.local`, hosted Supabase credentials, GitHub App credentials, Slack credentials, webhook secrets, or arbitrary proxy/Node preload variables. Because Next.js automatically loads local environment files from its application root, Demo Lab runs from a disposable, git-ignored runtime checkout of the exact current commit whose root is proven to contain no `.env`, `.env.local`, `.env.development`, or `.env.development.local`; its source-tree manifest must match the launching commit, and only the dependency directory is linked read-only. No undocumented Next.js environment bypass is used. A process-local network guard is installed before imports in the launcher, loader, proof client, and Next.js server; each independently rejects DNS and every non-loopback socket/HTTP destination and writes a redacted audit count. Static dependency and call-path tests prove that the synthetic collector can reach only the injected inert provider and that Slack/provider adapters cannot be selected in Demo Lab mode.

No service-role, database, long-lived OAuth, GitHub, or Slack secret may appear in browser code, command arguments, console output, logs, source fixtures, screenshots, or proof artifacts. The protocol-required short-lived authorization code may exist only transiently in the loopback callback URL and browser/client memory; incoming-request logging is disabled, and the code is never printed, screenshotted, written to a handoff file, persisted, or included in an artifact. Canary values are injected during tests and the complete stdout, stderr, application logs, browser bundle, screenshots, and artifacts must contain none of them. After setup, all application and MCP reads run through the real signed-in user, OAuth token, membership checks, and RLS policies.

## Startup flow

`demo:start` performs these steps in order:

1. Validate that only the disposable local demo project can be targeted.
2. Recreate the demo database without touching the real project or its volume.
3. Apply canonical migrations and the demo-only local OAuth audience.
4. Create or confirm the two synthetic Auth users without printing either password.
5. Load base fixtures in one atomic transaction, then run the normal multi-transaction synthetic collector/materialiser while the manifest remains unsealed.
6. Verify exact IDs, relationships, counts, data origin, and fixture hash.
7. Start the application on port 3200 with Demo Lab mode enabled.
8. Expose a local-only “Enter Demo Lab” sign-in action so the user does not repeatedly enter credentials.

Any failure before step 7 leaves the web application stopped and reports a safe, actionable error without secrets.

The sign-in action is a server-only POST using an ordinary Supabase password sign-in, never admin/service-role session minting. The generated demo password exists only in a mode-0600 runtime file opened by the server; it is absent from source, browser JavaScript, HTML, URLs, command arguments, browser storage, logs, screenshots, and artifacts. The action is registered only when all of these independently pass: `NODE_ENV=development`, explicit Demo Lab mode, exact `127.0.0.1:3200` Host and Origin, exact demo Supabase URL/ports, and a matching verified private demo sentinel. It uses a single-use, expiring, HttpOnly, SameSite=Strict CSRF nonce bound to the browser session and redirects only to a fixed local path. It returns 404 before any Auth/admin call in production, real-pilot, missing-sentinel, wrong-Host, wrong-Origin, replayed-nonce, or expired-nonce cases. The resulting session is the ordinary primary fixture Owner and must pass normal RLS; it carries no privileged key.

## Full MCP proof

The Demo Lab proof performs a real client conversation:

1. Discover protected-resource and authorization-server metadata.
2. Register the MCP client dynamically.
3. Complete authorization code with S256 PKCE, state validation, signed-in consent, token exchange, and exact audience matching.
4. Initialize the MCP connection using the existing supported protocol version, verify server/plugin 0.4.0, and list the exact eight tools whose success/error output contract is v3. Later tool-contract versions may deliberately change this list only with their own migration and proof.
5. Exercise all seven non-delivery tools:
   - `list_workspaces`;
   - `get_compliance_overview`;
   - `list_attention_items`;
   - `list_monitoring_findings`;
   - `list_github_compliance_results`;
   - `get_latest_leadership_report`;
   - `prepare_daily_digest`.
6. Traverse every paginated collection from an initial cursorless request to a final null cursor.
7. Before invoking `post_daily_digest`, independently query safe database projections and the sanitized process environment to prove there is zero active channel, zero destination, and zero Slack credential/configuration. If any exists, abort the proof without calling the tool. Otherwise call it and require a safe refusal before reservation, attempt creation, database write, adapter selection, or network operation.
8. Reconcile every returned safe fact with independent read-only database projections.
9. Prove protected-state hashes are unchanged by all reads and the refused delivery.
10. Record a mode-0600, redaction-safe artifact carrying `dataOrigin=synthetic_demo` and an explicit non-certification warning.

The proof client, launcher, loader, and application server independently block and observe non-loopback traffic. All four must report zero GitHub, Slack, DNS, proxy, or other external requests.

## Deterministic proof hashes

Hashes are captured after fixture load and verification but before automatic sign-in, dynamic client registration, OAuth consent, or any MCP call. The same projections are captured after proof. Rows are ordered by stable natural keys and canonical JSON uses sorted keys, UTC timestamps, and no whitespace.

The fixture semantic hash covers all columns in these fixture-owned tables except the exclusions below: `organisations`, `profiles`, `memberships`, `assessment_sessions`, `assessment_responses`, `soa_registers`, `soa_items`, `tasks`, `evidence`, `evidence_links`, `risks`, `policies`, `policy_acceptances`, `audits`, `audit_findings`, `audit_events`, `kpis`, `kpi_measurements`, `notifications`, `leadership_report_snapshots`, `github_installations`, `github_repositories`, `github_collection_runs`, `github_observations`, `github_mapping_packs`, `github_mapping_entries`, `github_mapping_approvals`, `github_official_compliance_results`, `github_evidence_provenance`, `github_finding_provenance`, `github_finding_transitions`, `monitoring_findings`, `alert_channels`, `daily_digest_deliveries`, and `daily_digest_delivery_attempts`.

The exact exclusions are generated primary keys and their corresponding generated foreign keys for materialiser-created evidence/findings/provenance/official-result/transition/delivery/audit-event rows; every listed table's `created_at` and `updated_at`; `audit_events.id`, `actor_id`, `entity_id`, and `occurred_at`; `github_collection_runs.started_at`, `completed_at`, `lease_token`, and `lease_expires_at`; `github_repositories.last_seen_at`; `github_official_compliance_results.materialised_at`; `daily_digest_deliveries.reserved_at`, `last_attempted_at`, `delivered_at`, and `attempted_by`; `daily_digest_delivery_attempts.started_at`, `finished_at`, and `attempted_by`; and Auth/OAuth operational state. Excluded generated relationships are replaced in the canonical projection by these natural ancestry columns: organisation slug; audit action, entity type, sanitized metadata, and deterministic sequence; repository `provider_repository_id`; run `request_key`; observation `observation_key`; mapping `version` plus `checksum`; `check_id`; `rule_version`; evidence `external_ref`; finding `stable_subject_identity`; digest `digest_on` plus channel label; and transition `occurred_at` plus from/to state. Excluded time fields are replaced by boolean/order invariants: run completion follows start; last-seen is no earlier than collection start; result materialisation occurs while its approval is active and no earlier than its observation; transition and audit-event order are monotonic; and an undelivered/refused digest has no reservation or attempt. All other columns are hashed. The checked-in projection manifest enumerates every included column per table; schema drift or an unclassified new column fails verification rather than silently changing scope.

Protected before/after hashes separately include every column of `github_installations`, `github_repositories`, `github_collection_runs`, `github_observations`, `github_mapping_packs`, `github_mapping_entries`, `github_mapping_approvals`, `github_official_compliance_results`, `github_evidence_provenance`, `github_finding_provenance`, `github_finding_transitions`, `monitoring_findings`, `alert_channels`, `daily_digest_deliveries`, and `daily_digest_delivery_attempts`. Only OAuth operational tables (`auth.sessions`, dynamic clients/authorizations/codes/tokens), `github_oauth_states`, audit/access logs, and other explicitly enumerated session telemetry are outside before/after equality because the proof intentionally creates them. Immutable-ledger triggers remain enabled and unchanged.

## Verification and acceptance criteria

Phase 3 is complete only when all of the following pass:

1. Two consecutive cold starts supplied the same fixture version and snapshot instant produce identical semantic projections, counts, and hashes with no duplicates; generated materialiser UUIDs may differ but normalized ancestry must not. Separate past, current, and future snapshot tests—run under deliberately different wall clocks—retain the intended current/stale partition because synthetic freshness uses the sealed manifest clock, while provider mode continues to use real time.
2. The real pilot’s protected-state database hashes are identical before and after both demo starts.
3. A deliberate fixture mutation disappears after the next disposable demo recreation.
4. Remote, hosted, production, linked, lookalike-loopback, wrong-port, wrong-project, wrong-container, and wrong-Docker-context targets abort before a write executor is called.
5. An injected base-load failure and identifier collision roll back the base transaction. An injected later collector/materialiser failure leaves the demo manifest unsealed, starts no app, writes no proof, and is eliminated by automatic destruction/recreation of the exact disposable database before retry.
6. Anonymous access fails. Primary and negative-control users are tested in both directions through ordinary application APIs and separate OAuth/MCP clients: neither can name, list, cursor into, or infer the other's workspace or rows, while each sees only its own allowed fixture state.
7. Every major authenticated page is populated and displays the synthetic warning.
8. MCP server/plugin 0.4.0 exercises its eight tools with v3 output/error envelopes as specified, reaches final null cursors, reconciles exact facts, refuses delivery without a reservation or attempt row, and performs zero external calls in every relevant process.
9. The original real GitHub scan remains one installation, one selected repository, and 15 official results.
10. The historical Phase 2 artifact remains byte-for-byte unchanged. A new v3 provider-origin regression passes the same 15/15 reconciliation with `dataOrigin=provider`, rejects the demo sentinel/reserved namespace, and preserves protected-state hashes.
11. Full unit, database, type, lint, production-build, desktop/mobile browser, privacy, secret, and commit-isolation gates pass.
12. Implementer reports DONE, independent reviewer reports APPROVED, and supervisor reports GO.

## Required preliminary correction

The existing `supabase/seed.sql` still writes the local MCP audience as `http://127.0.0.1:3000/mcp`, while the real Phase 2 runtime uses port 3100. Before any Phase 3 migration, fixture, or contract work, an isolated maintenance commit corrects this to 3100 and adds a regression test. The complete current Phase 2 OAuth/live proof is then rerun and stored as a new maintenance proof without editing the historical PASS artifact. No fixture records are added to the real seed file.

## Non-goals

- No production or hosted demo deployment.
- No Jira integration.
- No mobile application work.
- No real Slack delivery.
- No write to GitHub.
- No import of real customer, repository, or employee data.
- No claim of ISO 27001 certification, readiness, security, or overall compliance.

## Reference basis

- Supabase: Seeding your database — configured seeds are for reproducible development/test state and run on initial local start and database reset.
- Supabase: Local development workflow — production data and secrets must be removed from committed seeds.
- Supabase: Row Level Security — authenticated role access requires tenant authorization, not merely authentication.
- GitHub: Protected branches and branch protection rules.
- GitHub: Repository security and analysis settings.
- Model Context Protocol: OAuth authorization and protected-resource discovery.
