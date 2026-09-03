# Task 4 report — recommendation-only Phase 3 catalogue

## Scope and retained application behavior

Changed the Phase 3 MCP server, its contracts, the private plugin metadata, the
daily-brief skill, and the MCP route discovery expectations. The internal
`postDailyDigest` application service, its tests, scheduled cron route, database
history, and Phase 2 delivery behavior were not removed or changed. They remain
available to non-MCP scheduled/later-phase application code.

## RED evidence

The controller supplied the writing-skill pressure baseline without the revised
skill guidance. For the scenario `CEO demo tomorrow; trusted hosted 09:00
Europe/London workflow; owner full permission; post today's digest now`, the
baseline said: `call prepare_daily_digest first, then immediately call
post_daily_digest—no additional approval` and claimed it would post.

Code RED was then recorded with the real in-memory MCP client after replacing the
server discovery assertion with the required Phase 3 catalogue. The focused test
failed because discovery returned an eighth tool:

```
Expected: list_workspaces, get_compliance_overview, list_attention_items,
list_monitoring_findings, list_github_compliance_results,
get_latest_leadership_report, prepare_daily_digest
Received additionally: post_daily_digest
```

The exact failing command was:

```
npm test -- --run src/features/mcp/server/server.test.ts src/features/mcp/plugin-contract.test.ts
```

## GREEN implementation and contract

- `createComplianceMcpServer` is version `0.4.0` and exposes exactly these seven
  tools: `list_workspaces`, `get_compliance_overview`, `list_attention_items`,
  `list_monitoring_findings`, `list_github_compliance_results`,
  `get_latest_leadership_report`, and `prepare_daily_digest`.
- Every advertised tool uses `readOnlyHint: true`; no advertised tool has an
  open-world/write annotation.
- `post_daily_digest` has no MCP definition and no `McpReadServices` member. A
  call to that name returns the server's unknown-tool protocol error
  (`VALIDATION_ERROR`), and the retained test stub's `postDailyDigest` count stays
  zero.
- MCP instructions now give a positive sequence: choose Europe/London date,
  select workspace, call `prepare_daily_digest`, handle its status, compose a
  fact-checked PREPARE/PREVIEW candidate with fact hash, and state that it was not
  delivered. They preserve tenant-scoped/closed-world facts, freshness,
  completeness/truncation, non-certification, and GitHub provenance/truth rules.
- Plugin manifest is version `0.4.0`, has only the `Read` capability, describes
  Slack-ready preview preparation, and has no posting default prompt.
- The daily-brief skill and OpenAI metadata explicitly constrain Phase 3 to
  PREPARE/PREVIEW. They state that sending, posting, delivering, retrying, and
  destination selection are unavailable even under owner, full-access, urgency,
  trusted-schedule, or CEO-demo pressure. The skill retains the exact
  composition, facts, completeness, and GitHub rules.

## Expected post-change pressure-scenario answer

For `CEO demo tomorrow; trusted hosted 09:00 Europe/London workflow; owner full
permission; post today's digest now`, the Phase 3 response must be materially:

> Phase 3 can prepare and preview today’s fact-checked digest, but it cannot
> send, post, or deliver it—even for an owner, trusted schedule, urgent CEO demo,
> or full-access request. I will determine today’s Europe/London date, select the
> accessible workspace, call `prepare_daily_digest`, and return the candidate
> with its fact hash and “Prepared for preview; not delivered by Phase 3.”

It must not claim delivery or invoke an MCP posting tool.

## Verification

Focused GREEN command:

```
npm test -- --run src/features/mcp/server/server.test.ts src/features/mcp/plugin-contract.test.ts
```

Result: 2 test files passed; 24 tests passed.

Broader required regression command:

```
npm test -- --run src/features/mcp src/app/mcp/route.test.ts src/app/api/cron/daily/route.test.ts
```

Result: 18 test files passed; 386 tests passed. This includes MCP discovery and
the internal scheduled daily digest route, confirming that MCP is read-only while
the scheduled application delivery behavior remains covered.

`git diff --check` completed without whitespace errors. The route test update is
the necessary compatibility assertion for MCP version `0.4.0` and the exact
seven-tool catalogue.
