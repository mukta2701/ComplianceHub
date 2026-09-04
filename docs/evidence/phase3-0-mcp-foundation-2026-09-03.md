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
workspace selected  2026-09-03T23:52:32.765Z
baseline captured   2026-09-03T23:52:32.822Z
workflow started    2026-09-03T23:52:32.822Z
workflow completed  2026-09-03T23:53:21.151Z
after captured      2026-09-03T23:53:21.203Z
```

Its complete before and after protected-domain snapshots are byte-equivalent
under canonical JSON comparison.

## Provider-network observation

The committed launcher exclusively claimed port 3100, generated an unpredictable
per-run ID plus owner-only ledger and control files, installed the proof-only
Node preload before application code, and launched Next as its own child. Before
and after each client, it verified the live launcher → Next child → listener
ancestry, exact listener PID, matching run ID, and preload activation records.
A stale or arbitrary ledger, wrong run ID, dead or unrelated process, missing
activation, or competing listener fails closed.

The preload wrapped the effective server-process `fetch`. It allowed the local
application and Supabase traffic, but synchronously wrote one exclusive
append-only event file, blocked, and failed the proof for any GitHub or Slack
provider-host attempt—even if application code swallowed the exception. This
avoids shared read-modify-write counter races. Only the safe final summary was
persisted in the proof artifact:

```
{"guardActive":true,"githubAttempts":0,"slackAttempts":0}
```

A focused subprocess test separately proved that loopback fetch succeeds while
two GitHub and two Slack attempts spanning string, `URL`, and `Request` inputs
are blocked and atomically recorded. After both live proofs, the launcher
terminated its child, verified port 3100 was released, and removed its private
temporary ledger, control, event, and current-artifact files. Cleanup is always
attempted after temporary-directory creation, including setup, shutdown, and
port-release failures; a workflow failure remains the reported primary error.
The launcher never signals an unrelated port listener. The normal unguarded
local application server was then restored.

## Redaction-safe reproduction commands

The normal local listener must first be stopped through its owning terminal or
process supervisor. Confirm that the exact proof port is free:

```bash
test -z "$(lsof -nP -t -iTCP@127.0.0.1:3100 -sTCP:LISTEN)"
```

Map the local Supabase values without printing them, then run the committed
owner. It starts the guarded Next child, runs both pinned clients, verifies
ownership before and after each, and performs its own guarded-child cleanup:

```bash
eval "$(supabase status -o env 2>/dev/null)"
NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
npx tsx scripts/mcp-proof-owned-server.ts
```

The launcher invocation above is the single supported reproduction command. It
internally pins the current `2026-07-28` client and legacy `2025-11-25` client.
Its private run ID, control file, ledger, and current-client output are
intentionally generated inside its mode-0700 temporary directory and are not a
supported standalone client interface.

After the launcher exits and confirms cleanup, restore the normal server without
the proof preload:

```bash
eval "$(supabase status -o env 2>/dev/null)"
NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100 \
MCP_RESOURCE_URL=http://127.0.0.1:3100/mcp \
APP_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
npm run dev -- --hostname 127.0.0.1 --port 3100
```

None of these commands prints a token, key, authorization code, personal
address, provider payload, or destination.

## Persisted evidence and privacy

The retained machine-readable artifact is
`artifacts/phase3-0-mcp-foundation-proof.json`. It validates against the strict
Phase 3 proof schema, has mode `0600`, and has SHA-256:

```
812394e7c2fb5785233589c18141b626f46113609c96d839226962ed0b83ed03
```

The independently validated current-client artifact was temporary, also mode
`0600`, and had SHA-256:

```
499a448ea4c036b57c21854e015702355418d4d6498cae2758a8c62579dc64cd
```

No authorization material, personal address, provider response body,
credential, destination, webhook, opaque pagination value, or value-derived
pagination hash is persisted. Per-page evidence contains only `hasNextPage`
booleans and terminates with `false`. The persistence validator recursively
rejects any cursor-named field before schema validation. The historical Phase 2
artifact was not edited; its preserved SHA-256 is
`79e66498f58fee76966e9119fbd138911dbc8b2c8f5ac1775e423ed8e9449a30`.

## Regression gate and Codex configuration

The focused proof and protected-resource tests passed: 2 files, 20 tests. The
fresh final gate passed lint, type checking, all 239 test files (2,037 passed,
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
