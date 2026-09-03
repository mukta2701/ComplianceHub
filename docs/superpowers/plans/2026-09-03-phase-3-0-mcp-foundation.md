# Phase 3.0 MCP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ComplianceHub MCP endpoint consistently reachable at port 3100, safe for recommendation-only Phase 3 use, and compatible with current and legacy MCP clients.

**Architecture:** Keep OAuth authentication, user-token Supabase access, RLS, bounded request handling, and application services. Replace the v1-only HTTP transport with the official v2 dual-era HTTP handler, reject hostile browser origins before authentication, and remove Slack delivery from the Phase 3 MCP tool catalogue while retaining the internal delivery service for Phase 4 and scheduled application code.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Zod 4, MCP TypeScript SDK 2.0.0, Supabase OAuth/Auth/RLS, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-phase-3-company-wide-mcp-assistant-design.md`

## Global Constraints

- The normal Phase 3 MCP resource is recommendation-only and advertises no Slack, GitHub, database, or other mutation tool.
- All reads continue to use the signed-in user token and database row-level security; no service-role client is introduced.
- Support MCP protocol `2026-07-28` and legacy protocol `2025-11-25` through official SDK entry points.
- The real local application and MCP resource use `http://127.0.0.1:3100` and `http://127.0.0.1:3100/mcp` exactly.
- Production MCP resources require HTTPS; loopback HTTP remains development-only.
- Requests without an `Origin` header remain valid for non-browser clients. Hostile, `null`, malformed, wildcard, and non-allowlisted browser origins fail before authentication or MCP dispatch.
- Existing Phase 2 OAuth, tenant isolation, GitHub pagination, provenance, freshness, hash, and protected-state guarantees remain intact.
- Do not change the historical Phase 2 proof artifact.
- Every production behavior change follows RED → GREEN TDD and produces pristine focused test output before commit.

---

### Task 1: Canonical local endpoint

**Files:**
- Modify: `src/features/mcp/auth/oauth-config.ts`
- Modify: `src/features/mcp/auth/oauth-config.test.ts`
- Modify: `src/test/local-supabase-oauth-config.test.ts`
- Modify: `docs/codex-overnight-notes.md`

**Interfaces:**
- Consumes: `parseMcpOAuthEnvironment(environment)` and the seeded `private.mcp_oauth_config` resource audience.
- Produces: a single canonical local default of `http://127.0.0.1:3100/mcp` shared by application configuration and local seed verification.

- [ ] **Step 1: Write the failing default-endpoint tests**

Change the two development-default expectations in `src/features/mcp/auth/oauth-config.test.ts` from port 3000 to this hand-derived literal:

```ts
expect(value.resource).toBe("http://127.0.0.1:3100/mcp");
```

In `src/test/local-supabase-oauth-config.test.ts`, retain the behavioral check that parses `supabase/seed.sql` and assert the same literal, so a future seed/config split fails.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- --run src/features/mcp/auth/oauth-config.test.ts src/test/local-supabase-oauth-config.test.ts
```

Expected: the OAuth configuration tests fail because the implementation still defaults to port 3000; the seed test remains green because the seed already uses port 3100.

- [ ] **Step 3: Implement the canonical default**

Change only the non-production fallback in `parseMcpOAuthEnvironment`:

```ts
const resource = canonicalUrl(
  configuredValue(environment, "MCP_RESOURCE_URL")
    ?? (production ? "" : "http://127.0.0.1:3100/mcp"),
  { production, path: "/mcp" },
);
```

Update the stale port statement in `docs/codex-overnight-notes.md` to record that 3100 is canonical. Do not place credentials or OAuth codes in the document.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass with zero failures.

- [ ] **Step 5: Run endpoint-adjacent regression tests**

Run:

```bash
npm test -- --run src/features/mcp/auth/request-auth.test.ts src/test/local-runtime-preflight.test.ts src/features/mcp/application/mcp-github-read-proof.test.ts
```

Expected: all selected tests pass; the explicit wrong-port case remains rejected and the live-proof contract still names port 3100.

- [ ] **Step 6: Commit**

```bash
git add src/features/mcp/auth/oauth-config.ts src/features/mcp/auth/oauth-config.test.ts src/test/local-supabase-oauth-config.test.ts docs/codex-overnight-notes.md
git commit -m "fix(mcp): align local resource with port 3100"
```

### Task 2: Official dual-era MCP transport

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/features/mcp/server/server.ts`
- Modify: `src/features/mcp/server/server.test.ts`
- Modify: `src/app/mcp/route.ts`
- Modify: `src/app/mcp/route.test.ts`
- Modify: MCP tests and proof-client imports under `src/features/mcp/**` and `scripts/mcp-github-read-proof.ts` only where the v2 package split requires it

**Interfaces:**
- Consumes: `createComplianceMcpServer(context)`, `authenticateMcpRequest`, the 256 KiB request limit, rate limiter, and stateless per-request server factory.
- Produces: one `/mcp` route that serves MCP `2026-07-28` and legacy `2025-11-25`, preserving the same authenticated `McpRequestContext` and safe JSON-RPC errors.

- [ ] **Step 1: Add current-client tests before changing dependencies**

In `src/app/mcp/route.test.ts`, add a black-box request using the current protocol headers and envelope. The request must reach `tools/list` through `handleMcpPost`, and the response must include `list_workspaces`:

```ts
const response = await handleMcpPost(new Request("http://127.0.0.1:3100/mcp", {
  method: "POST",
  headers: {
    authorization: "Bearer a.b.c",
    "content-type": "application/json",
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": "tools/list",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "route-test", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  }),
}), authenticatedDependencies());

expect(response.status).toBe(200);
expect(await response.json()).toMatchObject({
  jsonrpc: "2.0",
  id: 1,
  result: { tools: expect.arrayContaining([expect.objectContaining({ name: "list_workspaces" })]) },
});
```

Keep the existing legacy initialize and tool-call cases. Add one malformed modern header/body mismatch case and assert HTTP 400 with a protocol error rather than application dispatch.

- [ ] **Step 2: Run the route test and verify RED**

Run:

```bash
npm test -- --run src/app/mcp/route.test.ts
```

Expected: the current-protocol case fails because SDK 1.30 and the v1 transport do not serve `2026-07-28`.

- [ ] **Step 3: Install the stable v2 packages**

Replace `@modelcontextprotocol/sdk` with exact version `2.0.0` of the supported split packages used by production and tests:

```bash
npm install --save-exact @modelcontextprotocol/server@2.0.0 @modelcontextprotocol/core@2.0.0 @modelcontextprotocol/node@2.0.0
npm install --save-dev --save-exact @modelcontextprotocol/client@2.0.0
```

Do not retain duplicate v1 and v2 production SDKs.

- [ ] **Step 4: Migrate imports and HTTP serving**

Use `McpServer`, protocol types, and `createMcpHandler` from the v2 packages. Build the handler after authentication so its server factory closes over this exact verified context:

```ts
const handler = createMcpHandler(
  () => dependencies.createServer({
    userId: authenticated.user.id,
    clientId: authenticated.claims.client_id,
    supabase: authenticated.supabase,
    resource: dependencies.resource,
  }),
  { legacy: "stateless" },
);
```

Preserve bounded-body validation and batch rejection by reconstructing a POST `Request` from the already validated bytes before calling `handler.fetch`. Forward the original safe headers, including authorization and protocol routing headers. Close the handler in `finally`. Do not reintroduce MCP sessions.

Migrate in-memory client tests and the proof script to the v2 client package. Configure current-client tests with automatic or pinned modern negotiation and keep an explicit legacy client case. Do not change tool semantics in this task.

- [ ] **Step 5: Run the focused route/server tests and verify GREEN**

Run:

```bash
npm test -- --run src/app/mcp/route.test.ts src/features/mcp/server/server.test.ts
```

Expected: modern and legacy cases pass, malformed current requests fail safely, and existing tool schemas remain discoverable.

- [ ] **Step 6: Run all MCP tests and type checking**

Run:

```bash
npm test -- --run src/features/mcp src/app/mcp/route.test.ts
npm run typecheck
```

Expected: zero test failures and zero TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/features/mcp src/app/mcp scripts/mcp-github-read-proof.ts
git commit -m "feat(mcp): support current and legacy protocol clients"
```

### Task 3: Exact browser-origin protection

**Files:**
- Modify: `src/features/mcp/auth/oauth-config.ts`
- Modify: `src/features/mcp/auth/oauth-config.test.ts`
- Modify: `src/app/mcp/route.ts`
- Modify: `src/app/mcp/route.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: canonical MCP resource URL and optional `MCP_ALLOWED_ORIGINS` comma-separated configuration.
- Produces: `allowedOrigins: readonly string[]` and an early request-origin decision used before authentication, rate limiting, body parsing, or MCP dispatch.

- [ ] **Step 1: Write failing configuration and route tests**

Add literal configuration cases proving:

```ts
expect(local.allowedOrigins).toEqual(["http://127.0.0.1:3100"]);
expect(hosted.allowedOrigins).toEqual(["https://compliance.example"]);
```

Add route cases where `Origin` is omitted or exactly allowlisted and cases where it is `null`, malformed, `*`, `http://127.0.0.1:3100.attacker.example`, or `https://attacker.example`. For every rejected case assert status 403 and that the authentication mock has zero calls.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- --run src/features/mcp/auth/oauth-config.test.ts src/app/mcp/route.test.ts
```

Expected: allowed-origin parsing and early 403 assertions fail because the behavior does not exist.

- [ ] **Step 3: Parse an exact allowlist**

Derive the default allowed origin from `new URL(resource).origin`. When `MCP_ALLOWED_ORIGINS` is set, split on commas, trim, require an exact `http://` loopback origin in development or `https://` origin in production, reject credentials, paths other than `/`, queries, fragments, `null`, and wildcards, normalize with `new URL(value).origin`, and reject an empty or duplicate list.

Add this documented empty default to `.env.example`:

```dotenv
# Optional exact browser origins for MCP requests. Non-browser clients may omit Origin.
MCP_ALLOWED_ORIGINS=
```

- [ ] **Step 4: Reject hostile origins before authentication**

In `handleMcpPost`, inspect `request.headers.get("origin")`. Continue when it is absent. When present, require exact string membership in `allowedOrigins`; otherwise return a no-store JSON-RPC 403 response and do not call any dependency.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 6: Run security-adjacent tests**

Run:

```bash
npm test -- --run src/features/mcp/auth src/app/mcp/route.test.ts src/test/local-runtime-preflight.test.ts
```

Expected: all selected tests pass; OAuth issuer/audience/session validation and endpoint preflight remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/features/mcp/auth/oauth-config.ts src/features/mcp/auth/oauth-config.test.ts src/app/mcp/route.ts src/app/mcp/route.test.ts .env.example
git commit -m "fix(mcp): reject untrusted browser origins"
```

### Task 4: Recommendation-only Phase 3 tool catalogue

**Files:**
- Modify: `src/features/mcp/server/server.ts`
- Modify: `src/features/mcp/server/server.test.ts`
- Modify: `src/features/mcp/plugin-contract.test.ts`
- Modify: `plugins/compliancehub-internal/.codex-plugin/plugin.json`
- Modify: `plugins/compliancehub-internal/skills/daily-compliance-brief/SKILL.md`
- Modify: `plugins/compliancehub-internal/skills/daily-compliance-brief/agents/openai.yaml`

**Interfaces:**
- Consumes: the seven existing read/preparation services and internal `postDailyDigest` application service.
- Produces: a Phase 3 MCP catalogue that advertises only seven read/preparation tools; the internal posting service remains importable by non-MCP Phase 4/scheduled code.

- [ ] **Step 1: Write the failing exact-catalogue test**

In `src/features/mcp/server/server.test.ts`, list tools through a real in-memory client and assert this exact Phase 3 set:

```ts
expect(tools.map(({ name }) => name)).toEqual([
  "list_workspaces",
  "get_compliance_overview",
  "list_attention_items",
  "list_monitoring_findings",
  "list_github_compliance_results",
  "get_latest_leadership_report",
  "prepare_daily_digest",
]);
expect(tools.every(({ annotations }) => annotations?.readOnlyHint === true)).toBe(true);
```

Also call `post_daily_digest` and assert an unknown-tool protocol error. Assert that `services.postDailyDigest` has zero calls.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- --run src/features/mcp/server/server.test.ts src/features/mcp/plugin-contract.test.ts
```

Expected: the exact catalogue fails because `post_daily_digest` is still advertised and the plugin still promises posting.

- [ ] **Step 3: Remove only MCP delivery exposure**

Remove `post_daily_digest` from the server definitions and `McpReadServices`, but do not delete `post-daily-digest.ts`, its application tests, scheduled delivery code, database tables, or Phase 2 history. Rewrite the opening server instructions around tenant-scoped facts, freshness, completeness, recommendations, and non-certification. Retain the read-only `prepare_daily_digest` sequencing and GitHub truth rules.

Update the plugin manifest to version `0.4.0`, remove the `Write` capability, remove the posting default prompt, and describe Slack-ready preparation without delivery. Update the daily-brief skill and OpenAI metadata to prepare/preview only and explicitly state that Phase 3 cannot deliver.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass and no plugin instruction can select an MCP write.

- [ ] **Step 5: Run all MCP and digest regressions**

Run:

```bash
npm test -- --run src/features/mcp src/app/mcp/route.test.ts src/app/api/cron/daily/route.test.ts
```

Expected: MCP tool discovery is read-only while internal scheduled digest application behavior remains covered and green.

- [ ] **Step 6: Commit**

```bash
git add src/features/mcp/server src/features/mcp/plugin-contract.test.ts plugins/compliancehub-internal
git commit -m "refactor(mcp): make phase 3 recommendation only"
```

### Task 5: Local Codex and regression proof

**Files:**
- Modify: `scripts/mcp-github-read-proof.ts` only if current/legacy client selection needs an explicit flag after Task 2
- Create: `docs/evidence/phase3-0-mcp-foundation-2026-09-03.md`
- Create: `artifacts/phase3-0-mcp-foundation-proof.json`

**Interfaces:**
- Consumes: live application on port 3100, local Supabase OAuth, current Phase 3 MCP tool catalogue, existing Phase 2 database state and proof harness.
- Produces: an unchanged-state machine-readable proof, a human evidence summary, and a local Codex configuration targeting `http://127.0.0.1:3100/mcp` with only discovered read tools enabled.

- [ ] **Step 1: Add failing proof expectations where required**

Extend the proof test so it requires:

```ts
expect(proof.endpoint).toBe("http://127.0.0.1:3100/mcp");
expect(proof.protocols).toEqual({ current: "2026-07-28", legacy: "2025-11-25" });
expect(proof.tools.every((tool) => tool.readOnly)).toBe(true);
expect(proof.tools.some((tool) => tool.name === "post_daily_digest")).toBe(false);
expect(proof.databaseUnchanged).toBe(true);
```

The proof artifact must contain no bearer token, authorization code, email address, provider payload, credential, destination, or webhook URL.

- [ ] **Step 2: Run the proof test and verify RED**

Run:

```bash
npm test -- --run src/features/mcp/application/mcp-github-read-proof.test.ts
```

Expected: the new protocol/catalogue assertions fail until the proof implementation records both client eras and the read-only catalogue.

- [ ] **Step 3: Implement the minimal proof extension**

Run both official v2 current and legacy clients through protected-resource discovery, authorization-server discovery, PKCE OAuth, exact audience validation, tool discovery, workspace read, complete GitHub cursor traversal, and protected-state before/after hashes. Serialize only the safe contract fields required by the test.

- [ ] **Step 4: Run the focused proof test and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 5: Point local Codex at the canonical endpoint**

First inspect the existing entry:

```bash
codex mcp get compliancehub-local
```

Then replace only that named local entry with the canonical URL using the supported `codex mcp remove` and `codex mcp add --url` commands. Do not alter other MCP servers. Authenticate `compliancehub-local` through the ordinary OAuth flow and enable only discovered read tools.

- [ ] **Step 6: Run the live proof and capture redaction-safe evidence**

With the real local application running on port 3100, run the proof script twice: once pinned current and once pinned legacy. Require 15/15 GitHub reconciliation, zero database changes, zero Slack calls, and zero GitHub calls. Write `artifacts/phase3-0-mcp-foundation-proof.json` with mode 0600 and document the command, counts, safe hash, and limitations in the evidence file. Never edit the historical Phase 2 artifact.

- [ ] **Step 7: Run the Phase 3.0 gate**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all commands exit zero. Confirm `git diff --check` exits zero and review `git status --short` so unrelated user-owned files are excluded.

- [ ] **Step 8: Commit tracked proof changes**

```bash
git add scripts/mcp-github-read-proof.ts src/features/mcp/application/mcp-github-read-proof.test.ts docs/evidence/phase3-0-mcp-foundation-2026-09-03.md artifacts/phase3-0-mcp-foundation-proof.json
git commit -m "test(mcp): prove phase 3 foundation end to end"
```

