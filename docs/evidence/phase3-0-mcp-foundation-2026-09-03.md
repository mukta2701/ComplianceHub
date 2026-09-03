# Phase 3.0 MCP foundation evidence — 2026-09-03

## Result

The real local application at `http://127.0.0.1:3100/mcp` passed the Phase 3.0
read-only proof with both official v2 client contracts while the dedicated
server process ran under the proof-only provider-network guard:

| Client | Negotiated protocol | MCP rows | DB rows | Reconciled | Protected DB | Client GitHub / Slack | Server GitHub / Slack |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| current | `2026-07-28` | 15 | 15 | yes | unchanged | 0 / 0 | 0 / 0 |
| legacy | `2025-11-25` | 15 | 15 | yes | unchanged | 0 / 0 | 0 / 0 |

Both runs discovered exactly seven tools: `list_workspaces`,
`get_compliance_overview`, `list_attention_items`, `list_monitoring_findings`,
`list_github_compliance_results`, `get_latest_leadership_report`, and
`prepare_daily_digest`. Every discovered tool was read-only, non-destructive,
closed-world, and idempotent. `post_daily_digest` was not advertised.

The independently computed protected-state digest was identical for the two
runs:

```
39e7255c23ad1db9874d47df2ad498b059817e94965fc7b20a35cbd779e8d626
```

The reconciled GitHub result-set hash was also identical:

```
9dfdfac98a8b549a6e44ee2f9760e6b73fe9a5870adbe1787037a0b39b2b4627
```

## Protected-state bracketing

Each proof first selected exactly one workspace through a direct, read-only
local PostgreSQL query. It persisted neither that selector response nor any
sensitive workspace data. It then captured the protected-state baseline before
starting protected-resource discovery, OAuth/DCR, the authenticated connection,
tool discovery, `list_workspaces`, or any GitHub page read. The authenticated
transport was closed and the final server-network ledger was checked before the
after snapshot.

The retained legacy proof records this monotonic sequence:

```
workspace selected  2026-09-03T23:29:28.352Z
baseline captured   2026-09-03T23:29:28.446Z
workflow started    2026-09-03T23:29:28.446Z
workflow completed  2026-09-03T23:29:51.696Z
after captured      2026-09-03T23:29:51.758Z
```

Its complete before and after protected-domain snapshots are byte-equivalent
under canonical JSON comparison.

## Provider-network observation

The dedicated port-3100 server was started with a proof-only Node preload that
wrapped the effective server-process `fetch`. It allowed the local application
and Supabase traffic, but would synchronously count, persist, block, and fail the
proof for any GitHub or Slack provider-host attempt—even if application code
swallowed the resulting exception. Its owner-only ledger remained:

```
{"guardActive":true,"githubAttempts":0,"slackAttempts":0}
```

A focused subprocess test separately proved that loopback fetch succeeds while
attempted GitHub and Slack fetches are each blocked and counted. The normal
unguarded local application server was restored after both live proofs.

## Persisted evidence and privacy

The retained machine-readable artifact is
`artifacts/phase3-0-mcp-foundation-proof.json`. It validates against the strict
Phase 3 proof schema, has mode `0600`, and has SHA-256:

```
d51418dedae995298fdb5e7f510dfa5628ff4c87ce1b210c170e76c1ed4b9ae4
```

The independently validated current-client artifact was temporary, also mode
`0600`, and had SHA-256:

```
7104ad47e8f64f4dd4d4dea8dbd9034e0d673236fcae1b89c3c59bdcdbf69b90
```

No authorization material, personal address, provider response body,
credential, destination, webhook, opaque pagination value, or value-derived
pagination hash is persisted. Per-page evidence contains only `hasNextPage`
booleans and terminates with `false`. The persistence validator recursively
rejects any cursor-named field before schema validation. The historical Phase 2
artifact was not edited; its preserved SHA-256 is
`79e66498f58fee76966e9119fbd138911dbc8b2c8f5ac1775e423ed8e9449a30`.

## Regression gate and Codex configuration

The focused proof and protected-resource tests passed: 2 files, 16 tests. The
fresh final gate passed lint, type checking, all 239 test files (2,033 passed,
3 skipped), and the production build with all 29 static pages generated.
Artifact schema validation, exact `0600` mode, the cursor-field privacy scan,
and `git diff --check` also passed.

Only the existing `compliancehub-local` Codex entry had previously been replaced
and authenticated. It remains targeted at `http://127.0.0.1:3100/mcp`, enables
only the seven read/preparation tools above, and keeps `post_daily_digest`
disabled. This strengthening did not alter any MCP entry.

## Limitations

This evidence proves the local application, local OAuth path, two protocol
eras, read-only catalogue, stored GitHub result reconciliation, unchanged
protected database state, and zero observed provider calls in both the proof
client and guarded server processes. It does not claim production deployment,
external ChatGPT compatibility, verified change history, overall compliance,
security, or ISO 27001 certification.
