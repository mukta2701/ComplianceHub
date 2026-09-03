# Phase 3.0 MCP foundation evidence — 2026-09-03

## Result

The real local application at `http://127.0.0.1:3100/mcp` passed the Phase 3.0
read-only proof with both official v2 client contracts:

| Client | Negotiated protocol | GitHub MCP rows | Independent database rows | Reconciled | Protected database state | GitHub calls | Slack calls |
| --- | --- | ---: | ---: | --- | --- | ---: | ---: |
| current | `2026-07-28` | 15 | 15 | yes | unchanged | 0 | 0 |
| legacy | `2025-11-25` | 15 | 15 | yes | unchanged | 0 | 0 |

Both runs discovered exactly seven tools: `list_workspaces`,
`get_compliance_overview`, `list_attention_items`, `list_monitoring_findings`,
`list_github_compliance_results`, `get_latest_leadership_report`, and
`prepare_daily_digest`. Every discovered tool was read-only, non-destructive,
closed-world, and idempotent. `post_daily_digest` was not advertised.

The independently computed protected-state digest was identical for the two
runs:

```
855f648e97284cd958945bf2ef75346823863458983a186128f2ea1fb74c89ea
```

The reconciled GitHub result-set hash was also identical:

```
9dfdfac98a8b549a6e44ee2f9760e6b73fe9a5870adbe1787037a0b39b2b4627
```

## Commands and persisted evidence

The proof script was run twice with `MCP_PROOF_PROTOCOL=current` and
`MCP_PROOF_PROTOCOL=legacy`. Each run used local protected-resource discovery,
authorization-server discovery, S256 PKCE consent, exact MCP audience checking,
tool discovery, workspace selection, full cursor traversal to null, independent
read-only PostgreSQL reconciliation, and before/after protected-state digests.

The retained machine-readable artifact is
`artifacts/phase3-0-mcp-foundation-proof.json`. It validates against the strict
Phase 3 proof schema and has mode `0600`. Its SHA-256 is:

```
5d91bed5a559f2c39bb3f07475240ddee455e181e5fedb98c36b9419c3435642
```

The current-client run was validated independently before the legacy run; its
temporary safe artifact SHA-256 was:

```
a94f9d507ea0e258d485d7f71bc6bd4974971c05be434f9ac51208c447ca552b
```

No authorization material, personal address, provider response body,
credential, destination, webhook, or opaque cursor is persisted in either
proof. The historical Phase 2 artifact was not edited; its preserved SHA-256 is
`79e66498f58fee76966e9119fbd138911dbc8b2c8f5ac1775e423ed8e9449a30`.

The full regression gate initially exposed one stale metadata-test fixture that
still supplied `localhost:3000`. The production parser correctly rejected it.
The fixture alone was aligned with the already-approved canonical
`http://127.0.0.1:3100/mcp` resource; production route behavior was unchanged.
Its focused rerun passed together with the proof test (2 files, 14 tests).

The final gate completed successfully: lint and type checking exited zero, all
239 test files passed (2,031 tests passed and 3 were skipped), and the production
build completed successfully. `git diff --check` was also clean.

## Local Codex configuration

Only the existing `compliancehub-local` entry was replaced. It now targets
`http://127.0.0.1:3100/mcp`, completed ordinary local OAuth, enables only the
seven discovered read/preparation tools above, and keeps `post_daily_digest`
disabled. No other Codex MCP entry was changed.

## Limitations

This evidence proves the local application, local OAuth path, two protocol
eras, read-only catalogue, stored GitHub result reconciliation, and unchanged
protected database state. It does not claim production deployment, external
ChatGPT compatibility, verified change history, overall compliance, security,
or ISO 27001 certification. It made no Slack or GitHub provider call.
