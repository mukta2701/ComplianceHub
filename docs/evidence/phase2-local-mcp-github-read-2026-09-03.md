# Phase 2 evidence — local MCP GitHub compliance read

Date: 2026-09-03
Phase: 2 only
Status: `PASS — AWAITING FINAL FULL-SUITE GATE` — the real local OAuth/MCP conversation, exhaustive GitHub-result traversal, independent database reconciliation, protected-state comparison, and evidence-redaction checks passed. This is Phase 2 read-path evidence, not an ISO 27001 certification or a production-deployment claim.

## What the proof harness verifies

- OAuth protected-resource and authorization-server discovery.
- Dynamic client registration.
- Authorization-code flow with S256 PKCE, callback-state validation, explicit signed-in consent, token exchange, and exact MCP audience matching.
- Authenticated MCP initialization and `tools/list`.
- `list_workspaces` followed by the read-only `list_github_compliance_results` tool.
- Pagination starts without a cursor, holds the normalized filters and `limit=1` constant, and follows every continuation to a final `null` cursor.
- Every returned safe result and provenance fact except the database-computed `recordHash` (including result ID, repository/run references, check ID, outcome, severity, timestamps, freshness, mapping facts, rule version, source fingerprint, summary, evidence ID, and finding ID) reconciles with an independent read of the local PostgreSQL container’s stored official-result, observation, terminal official-run, approval, and mapping-pack tables. One fixed SQL statement uses one explicit `READ ONLY` transaction, verifies `transaction_read_only=on` in that transaction, and returns only exact, hard-coded safe projections. The reader uses fixed `docker exec`/`psql` arguments, validated workspace UUIDs, and no shell or caller-selected table/column identifiers. It deliberately does not call REST or the MCP v2 database function and does not weaken table grants.
- Each before/after capture is one PostgreSQL session and one explicit `READ ONLY` transaction. PostgreSQL computes canonical full-row counts and SHA-256 hashes internally and returns only strict `{rowCount, sha256}` digests; no full protected row crosses into Node or the evidence artifact. The exact mutation claim covers tenant GitHub, evidence, monitoring, integration, notification, and digest state plus the required global GitHub mapping packs and entries. Identical before/after digests detect updated rows even when counts stay constant.
- Before PostgreSQL access, the harness rejects remote `DOCKER_HOST`/`DOCKER_CONTEXT` values and verifies a local default/Colima Unix socket, exact container name, running Supabase PostgreSQL image, matching Supabase CLI and Compose project labels, exact project network, and expected database aliases.
- Network observations are explicitly scoped to the proof client process: it blocks non-loopback traffic and must observe zero client-side GitHub and Slack calls. The invoked-tool ledger separately allows only `list_workspaces` and the paginated GitHub read tool. Static source inspection separately establishes that the server route calls the database read path and contains no reachable GitHub-provider or Slack-write call.
- Five acceptance answers come only from returned MCP facts. Change history is marked unsupported when it is absent, and ISO 27001 certification is explicitly not claimed.

## Redaction boundary

The accepted JSON evidence is written with filesystem mode `0600`. It contains no bearer/access/refresh/ID tokens, authorization codes, service-role key, client secrets, PKCE verifier, private keys, Slack webhooks, GitHub credentials, full continuation cursors, or raw provider payloads. Continuation cursors are represented only by a presence flag and a short SHA-256 prefix. The full authorization URL is not printed; browser automation receives a one-time loopback handoff URL whose local listener redirects in process.

## Current evidence

- Proof contract test: `12/12 PASS` (`npx vitest run src/features/mcp/application/mcp-github-read-proof.test.ts`). The tests include tampered-outcome rejection, same-count row-update detection, contradictory pagination/count/version/answer rejection, exact loopback authorization-URL enforcement, static server call-path inspection, read-only SQL enforcement, digest-only snapshot parsing, remote Docker rejection, and container label/network mismatch rejection.
- Local OAuth configuration contract: `3/3 PASS` (`npx vitest run src/test/local-supabase-oauth-config.test.ts`). The running Auth service uses Site URL `http://127.0.0.1:3100`, globally permits only the exact app callback, exposes `/oauth/consent`, and enables dynamic client registration. The proof receiver remains registered per-client rather than globally allowlisted.
- Focused lint: `PASS`.
- Repository type-check: `PASS`.
- Phase 1 prerequisite: the GitHub App is active for exactly one selected repository, with one terminal official run, `15` stored official results (`8` pass, `5` fail, `2` unknown), and `5` open findings.
- Live OAuth/MCP conversation: `PASS`. Protected-resource and authorization-server discovery, dynamic client registration, authorization code plus S256 PKCE, signed-in consent, state validation, token exchange, exact `http://127.0.0.1:3100/mcp` audience, MCP initialization, and tool discovery all passed against server version `0.3.0`.
- Exhaustive MCP read: `PASS`. The client called `list_workspaces` once and followed `15` pages at `limit=1` from an initial request with no cursor to one final `null` cursor, returning all `15` results.
- Independent reconciliation: `PASS`. The MCP result count and safe fact set exactly matched one independent PostgreSQL read performed in an explicit read-only transaction.
- No-mutation evidence: `PASS`. Database-side before/after digests for all `21` protected domains were identical. The proof invoked no write tools, and its loopback-only client observed `0` GitHub calls and `0` Slack calls. Static source inspection also confirmed that the MCP GitHub-result path reaches the database read only, not GitHub or Slack.
- Redacted JSON proof: `PASS`, written to `artifacts/phase2-local-mcp-github-read-proof.json` with filesystem mode `0600`. A separate secret scan found no token, authorization-code, client-secret, private-key, service-role, GitHub-credential, or Slack-webhook pattern.
- Visual evidence: `docs/evidence/phase2-mcp-consent-2026-09-03.jpg` and `docs/evidence/phase2-monitoring-official-results-2026-09-03.jpg`.
- Phase 2 verdict: live Task 4 proof passed; final full-suite Task 5 and the independent supervisor close-out remain before the phase can be marked complete.

The harness also fails closed when Supabase is non-local, the Docker host/context is remote, the configured container name is unsafe, container identity or networking does not match the local Supabase project, a database transaction is not read-only, a digest/projection envelope is malformed, any PostgreSQL query fails, or no official Phase 1 result exists. The local OAuth audience is `http://127.0.0.1:3100/mcp`, and the GitHub App homepage, callback, and setup URLs use port `3100`. GitHub installation `154509880` remains restricted to the personal pilot account and exactly one selected repository with read-only permissions.

This status remains fail-closed: Task 4 is proven, while the broader Task 5 regression suite and final independent GO verdict are still required before declaring Phase 2 complete.
