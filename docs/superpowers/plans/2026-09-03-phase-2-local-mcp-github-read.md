# Phase 2 — Local MCP GitHub Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make ComplianceHub's local MCP server return and explain the approved GitHub compliance results from Phase 1 to an authenticated Codex, Claude, or MCP Inspector client without calling GitHub or sending Slack messages.

**Architecture:** GitHub collection remains a separate read-only producer. Phase 2 reads only immutable, approved github_official_compliance_results through a tenant-scoped PostgreSQL RPC, validates and sanitises every field in the application, and exposes the result through the existing OAuth-protected Streamable HTTP /mcp endpoint. Continuation cursors are snapshot-bound, short-lived, tamper-evident, and bound to the user, OAuth client, resource, workspace, and normalized filters.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Zod 4, Supabase Auth/PostgreSQL/RLS, Model Context Protocol TypeScript SDK, Vitest, pgTAP.

**Spec:** docs/superpowers/specs/2026-08-17-github-first-compliance-automation-design.md

## Global Constraints

- Phase 1 commit 35f05b7 is the immutable starting boundary and must remain green.
- Phase 2 is read-only: no GitHub write, GitHub API call, Slack delivery, Jira action, evidence mutation, finding mutation, readiness mutation, or mapping approval.
- MCP reads only approved official results. Raw shadow observations never become MCP facts.
- Every request is authenticated and resolved through the caller's Supabase session and organisation membership.
- Unknown, stale, unavailable, and historical results are never described as passing or compliant.
- GitHub technical checks do not prove ISO certification, overall security, or overall compliance.
- Never return access tokens, OAuth codes, GitHub response bodies, source code, private member details, webhook URLs, or database cursor secrets.
- Slack, hosted Azure deployment, organisation-wide GitHub rollout, Jira, mobile work, and production approval remain later phases.

## Current Evidence Before Execution

- The TypeScript MCP draft passes 64/64 focused tests across five files.
- The initial local pgTAP gate was RED because get_mcp_github_compliance_results_v2(...) was not applied. An over-broad draft later passed 71/71, but that result is superseded and is not completion evidence.
- The successor migration, pgTAP suite, encrypted public cursor module, MCP read changes, server schema changes, and private plugin instructions already exist as uncommitted Phase 2 work.

---

### Task 1: Apply and Prove the MCP v2 Database Boundary

**Files:**
- Create/finish: supabase/migrations/20260902151659_mcp_github_official_results_v2.sql
- Test: supabase/tests/database/079_mcp_github_official_results_v2.sql
- Test: src/features/mcp/application/github-results-v2-migration.test.ts

**Interfaces:**
- Produces: public.get_mcp_github_compliance_results_v2(uuid, uuid, github_observation_result, text, text, monitor_severity, integer, text) returns jsonb.
- Preserves: public.get_mcp_github_compliance_results_v1(...) for rolling compatibility.
- Consumes: authenticated JWT claims, configured MCP audience, organisation membership, active mapping approval, eligible official collection runs, and immutable official results.

- [ ] **Step 1: Record the current RED database result**

~~~bash
npx supabase test db --local supabase/tests/database/079_mcp_github_official_results_v2.sql
~~~

Expected before migration: failure because get_mcp_github_compliance_results_v2 does not exist.

- [ ] **Step 2: Run the migration contract test**

~~~bash
npx vitest run src/features/mcp/application/github-results-v2-migration.test.ts
~~~

Expected: one v2 successor, untouched v1/materialisation/digest surfaces, official terminal ancestry filtering inside v2, and a PostgreSQL-private cursor key.

- [ ] **Step 3: Apply only pending local migrations**

~~~bash
npx supabase migration up --local
~~~

Do not link, push, reset, or mutate a hosted Supabase project.

- [ ] **Step 4: Run v1, digest, and v2 database suites**

~~~bash
npx supabase test db --local \
  supabase/tests/database/072_github_official_results_mcp.sql \
  supabase/tests/database/073_mcp_github_digest_v2.sql \
  supabase/tests/database/079_mcp_github_official_results_v2.sql
~~~

Expected: all narrowed v2 assertions pass; the separate v1 and digest compatibility suites remain green; Owner/Admin/Member reads stay tenant-scoped; outsider, anonymous, cross-workspace, forged cursor, expired cursor, filter-swapped cursor, shadow-run, and nonterminal-run cases fail closed.

The Phase 2 migration must not replace or grant the materialiser, lifecycle triggers, v1 GitHub read, or digest bundle. Those surfaces are outside this phase.

- [ ] **Step 5: Commit the database boundary**

~~~bash
git add supabase/migrations/20260902151659_mcp_github_official_results_v2.sql \
  supabase/tests/database/079_mcp_github_official_results_v2.sql \
  src/features/mcp/application/github-results-v2-migration.test.ts
git commit -m "feat(db): add secure MCP GitHub result pages"
~~~

### Task 2: Complete the Safe Application Read Contract

**Files:**
- Create/finish: src/features/mcp/application/github-results-cursor.ts
- Modify: src/features/mcp/application/mcp-reads.ts
- Test: src/features/mcp/application/mcp-reads.test.ts

**Interfaces:**
- Produces: listGitHubComplianceResults(supabase, verifiedUserId, input, cursorContext).
- Inputs: workspaceId, repositoryId, result, freshness, mappingStatus, severity, limit, and optional opaque cursor.
- Output: schema version 2, workspace, frozen snapshotAt, validated official results, nextCursor, truncated, truthful pageKind, and public pageHash.

- [ ] **Step 1: Run the focused read tests**

~~~bash
npx vitest run src/features/mcp/application/mcp-reads.test.ts
~~~

Required coverage: 1–50 row bounds; deterministic ordering; active/historical mappings; current/stale truth; pass/fail/unknown/not-applicable truth; complete provenance; safe summaries; safe repository labels; duplicate rejection; impossible evidence/finding references; cursor expiry; key rotation; user/client/resource/workspace/filter binding; and exact continuation traversal.

- [ ] **Step 2: Keep the public cursor contract exact**

~~~ts
type GitHubResultsCursorScope = {
  userId: string;
  clientId: string;
  organisationId: string;
  resource: string;
  filters: {
    repositoryId: string | null;
    result: "pass" | "fail" | "unknown" | "not_applicable" | null;
    freshness: "current" | "stale" | null;
    mappingStatus: "active" | "historical" | null;
    severity: "low" | "medium" | "high" | "critical" | null;
    limit: number;
  };
};
~~~

The public cursor stays AES-256-GCM encrypted, HMAC authenticated, fifteen-minute limited, canonical, and bounded to 4,096 bytes.

- [ ] **Step 3: Run type, lint, and privacy checks**

~~~bash
npm run typecheck
npx eslint src/features/mcp/application/github-results-cursor.ts \
  src/features/mcp/application/mcp-reads.ts \
  src/features/mcp/application/mcp-reads.test.ts
privacy-review-agent scan --path src/features/mcp/application --format md
~~~

Expected: all pass with zero critical/high privacy findings.

- [ ] **Step 4: Commit the read boundary**

~~~bash
git add src/features/mcp/application/github-results-cursor.ts \
  src/features/mcp/application/mcp-reads.ts \
  src/features/mcp/application/mcp-reads.test.ts
git commit -m "feat(mcp): read approved GitHub results safely"
~~~

### Task 3: Expose the Read Through the MCP Server and Private Plugin

**Files:**
- Modify: src/features/mcp/server/server.ts
- Test: src/features/mcp/server/server.test.ts
- Test: src/app/mcp/route.test.ts
- Modify: plugins/compliancehub-internal/.codex-plugin/plugin.json
- Modify: plugins/compliancehub-internal/skills/daily-compliance-brief/SKILL.md
- Test: src/features/mcp/plugin-contract.test.ts

**Interfaces:**
- Produces MCP server version 0.3.0.
- Preserves tool name list_github_compliance_results.
- Marks the GitHub tool readOnlyHint=true, destructiveHint=false, openWorldHint=false, and idempotentHint=true.

- [ ] **Step 1: Verify tool discovery, schemas, and HTTP safety**

~~~bash
npx vitest run src/features/mcp/server/server.test.ts \
  src/app/mcp/route.test.ts \
  src/features/mcp/plugin-contract.test.ts
~~~

Expected: exactly eight existing tools; GitHub read schema v2; invalid JSON-RPC, batch requests, bad scopes, oversized bodies, malformed output, and unsafe model instructions fail closed.

- [ ] **Step 2: Prove this phase performs no external write**

~~~ts
expect(githubTool.annotations).toMatchObject({
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
});
expect(postDailyDigest).not.toHaveBeenCalled();
~~~

The proof must also show no request to api.github.com or hooks.slack.com originates from MCP.

- [ ] **Step 3: Commit server and plugin changes**

~~~bash
git add src/features/mcp/server/server.ts src/features/mcp/server/server.test.ts \
  src/app/mcp/route.test.ts src/features/mcp/plugin-contract.test.ts \
  plugins/compliancehub-internal/.codex-plugin/plugin.json \
  plugins/compliancehub-internal/skills/daily-compliance-brief/SKILL.md
git commit -m "feat(mcp): expose GitHub compliance result v2"
~~~

### Task 4: Prove a Real Local MCP Conversation

**Files:**
- Create: scripts/mcp-github-read-proof.ts
- Create: src/features/mcp/application/mcp-github-read-proof.test.ts
- Create: docs/evidence/phase2-local-mcp-github-read-2026-09-03.md

**Interfaces:**
- Consumes: live local /mcp, local OAuth 2.1, an approved local Owner, and stored Phase 1 official results.
- Produces: a mode-0600 redacted JSON proof and a human-readable evidence report.

- [ ] **Step 1: Write the proof contract test**

~~~ts
expect(proof.endpoint).toBe("http://127.0.0.1:3100/mcp");
expect(proof.oauth.pkce).toBe("S256");
expect(proof.oauth.audienceMatched).toBe(true);
expect(proof.tools.githubRead.readOnly).toBe(true);
expect(proof.tools.githubRead.pages.at(-1)?.nextCursor).toBeNull();
expect(proof.writes.github).toBe(0);
expect(proof.writes.slack).toBe(0);
~~~

The serialised proof must reject bearer tokens, access/refresh tokens, authorization codes, private keys, webhooks, and full opaque cursors.

- [ ] **Step 2: Execute the actual local flow**

Complete discovery, dynamic client registration, authorization-code plus S256 PKCE, explicit consent, token exchange, authenticated initialize, tools/list, list_workspaces, and list_github_compliance_results. Start without a cursor, preserve all normalized filters, follow every nextCursor to null, and reconcile safe MCP IDs/counts with stored official results.

- [ ] **Step 3: Ask the five acceptance questions**

1. Which GitHub checks currently fail?
2. Which information is unknown or unavailable?
3. Which results are stale or need rechecking?
4. What changed and what should we prioritise?
5. Does this prove ISO 27001 certification?

Expected: answers cite only MCP facts; the fifth answer is explicitly “no”; no answer exposes raw provider data or turns unknown/stale into a pass.

- [ ] **Step 4: Save redacted terminal/client evidence and commit**

~~~bash
git add scripts/mcp-github-read-proof.ts \
  src/features/mcp/application/mcp-github-read-proof.test.ts \
  docs/evidence/phase2-local-mcp-github-read-2026-09-03.md
git commit -m "test(mcp): prove the local GitHub read flow"
~~~

### Task 5: Final Phase 2 Verification and Three-Agent Gate

**Files:**
- Modify only files required by a concrete failed test or review finding.

- [ ] **Step 1: Run the complete local gate**

~~~bash
npm test
npm run typecheck
npm run lint
npm run build
npx supabase test db --local
npx playwright test e2e/github-shadow-collection.spec.ts --project=chromium --workers=1
git diff --check
~~~

- [ ] **Step 2: Recheck live runtime and OAuth metadata**

~~~bash
curl --fail http://127.0.0.1:3100/api/health
curl --fail http://127.0.0.1:3100/.well-known/oauth-protected-resource/mcp
~~~

Expected: application/database OK; resource exactly http://127.0.0.1:3100/mcp; unauthenticated /mcp receives the OAuth challenge; authenticated GitHub reads succeed.

- [ ] **Step 3: Obtain independent role verdicts**

The implementer reports exact files and evidence. The reviewer reruns focused unit, database, and MCP-client checks and returns APPROVED only if the read is correct and safe. The supervisor checks scope, zero GitHub/Slack writes, Phase 1 regressions, proof redaction, and commit isolation before returning GO.

- [ ] **Step 4: Close Phase 2 only when every gate is green**

Completion requires: the narrowed migration applied to a fresh local database; all v2 and regression database assertions green; real authenticated local MCP round trip; exhaustive GitHub result traversal; accurate official-result reconciliation; zero GitHub/Slack writes; full tests/typecheck/lint/build; implementer DONE; reviewer APPROVED; supervisor GO; and Phase-2-only commits.

Do not start Slack delivery, hosted deployment, or organisation rollout from this plan.
