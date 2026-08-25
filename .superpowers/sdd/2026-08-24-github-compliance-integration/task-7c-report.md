# Task 7C report — exact Evidence and Monitoring provenance UI

## Outcome

Phase 5C completes the static application/UI slice that was intentionally left open by Phase 5B. Exact official-result links in the GitHub control room now open and focus the matching Evidence or Monitoring record. Official GitHub records render only bounded approved provenance, while legacy evidence and generic monitoring findings retain their existing behaviour.

This is not browser/runtime acceptance and does not complete the release. Desktop, Pixel-mobile, Axe, real materialiser/readiness equality, and database runtime evidence remain Phase 6 gates. No external service, Slack destination, hosted database, or provider was called or changed.

## Trusted read boundary

- The server-only provenance loader reads exact active-workspace rows from `github_evidence_provenance` or `github_finding_provenance`, then joins only the immutable official result ledger, tenant-filtered repository identity, and published mapping entries.
- It never reads `github_observations`, provider bodies, diagnostics, explanations, remediation text, tokens, credentials, installation/account identity, or actor identity.
- Evidence reads are limited to 200 exact IDs and findings to 100. Supporting reads are exact-ID and limited, with strict closed-world Zod parsers, duplicate/cardinality rejection, chronology and ancestry equality checks, safe summary validation, and the existing exact canonical GitHub repository URL validator.
- Freshness is `current` only while `fresh_until` is strictly later than the shared `asOf`; equality is truthfully stale.
- Malformed, duplicate, cross-tenant, unsafe-URL, mismatched repository, mapping, rule, result, or extra-field rows fail closed with one stable loader error.
- The Member monitoring boundary now strictly parses and caps connected-system and active-finding summaries before official provenance loading. Unexpected source configuration or provider-body fields are rejected rather than passed into UI state.

## Evidence and navigation

- Control-room links now carry the exact validated UUID in both query and fragment: `?evidence=<uuid>#evidence-<uuid>` and `?finding=<uuid>#finding-<uuid>`.
- Pages accept exactly one UUID query value. Arrays, malformed IDs, and valid IDs without a matching active-workspace official record behave as no selection.
- The selected exact article has a stable anchor, programmatic focus, visible focus/highlight, and `aria-current`; no sibling ID is echoed into an element or message.
- Official evidence shows the canonical repository link, check and ISO references, approved catalogue summary, observed/materialised/fresh-until times, truthful current/stale text, rule/mapping version, and checksum.
- Official evidence does not render generic link/unlink, supersede, withdraw, or edit controls. Its safe canonical repository link and page-level exports remain available. Legacy evidence still renders its existing safe open/download and mutation controls.

## Official finding lifecycle

- Official GitHub cards never render generic Resolve or Reopen. They explain that only a newer fresh passing check resolves the technical condition automatically.
- Owners may record one of the reviewed non-resolved states: open, acknowledged, in progress, exception requested, or risk accepted. The application sends only closed privacy-safe reason codes to the existing service-only `transition_github_finding_server` RPC; no arbitrary provider text or human free-text field crosses the boundary.
- The transition action checks active-workspace Owner context, strict UUID/state input, the exact tenant GitHub finding and provenance through the authenticated client, and the per-organisation/per-user rate limit before constructing the service client. Database errors map to stable safe messages and success revalidates Monitoring.
- Owners may raise a remediation task only through the existing atomic `raise_monitoring_finding_task` action when no task is linked. Admins and Members see official provenance and lifecycle state read-only. Generic non-GitHub finding actions are unchanged.

## Accessibility and responsive behaviour

- Official records are semantic focusable articles with headings, definition lists, `<time>` values, explicit link labels, text-plus-colour status, and one polite action live region.
- Long checks, versions, checksums, and repository names wrap without horizontal overflow. At the existing mobile breakpoint provenance grids collapse to one column and controls become full width.
- Every official card states that it is a technical signal for human review, not ISO/IEC 27001 certification and not a readiness change.

## TDD evidence

RED was recorded before each implementation seam:

- the official provenance application and component modules were absent;
- control-room tests expected exact query/fragment links but received list-only navigation;
- Evidence and Monitoring page tests could not identify, focus, or suppress generic controls for official records;
- the transition action tests had no Owner-only official lifecycle boundary;
- the Member monitoring loader accepted unexpected raw fields before provenance loading.

Focused GREEN after the independent-review fix round is 10 files / 59 tests. The suite covers strict/privacy/cross-tenant/source validation, freshness equality, exact chunked mapping lookups, missing-provenance fail-closed behaviour, exact selection parsing, exact control-room links, official/legacy Evidence behaviour, Owner/Admin/Member finding controls, absence of Resolve/Reopen, active-workspace preflight, rate-limit/service ordering, stable errors, idempotent transition races, and Member read-only presentation.

## Verification

- Full Vitest: 223 files / 1,760 tests passed.
- Full ESLint: passed.
- TypeScript typecheck: passed.
- Actionlint and `git diff --check`: passed.
- Production build reached the unchanged `next/font/google` boundary and failed only because the network-restricted environment could not fetch Geist and Geist Mono from `fonts.googleapis.com`.
- The staged privacy hook reported zero findings for every staged code file.

## Scope and remaining gates

No migration was necessary: existing RLS/member-readable provenance, immutable official-result, tenant repository, published mapping, and service-only transition contracts provide the required safe seams. No Slack file, connector, delivery logic, destination, MCP/digest schema, materialiser, collection, evidence/finding transaction, SoA, assessment, risk, leadership, or readiness logic changed.

Phase 6 must still run the approved local-only browser proof on desktop and Pixel-mobile, Axe the relevant pages, seed official records through the real materialiser, prove exact counts/provenance and unchanged readiness, and close the existing database/production-build runtime gates. Until then, this report claims static UI/code completion only.

## Independent review fix round

The first read-only review found no Critical issue and three Important issues: a GitHub-origin finding with absent provenance could fall through to provider-derived legacy UI, the mapping lookup used an imprecise pack/check cross-product under a limit, and Monitoring omitted the explicit certification/readiness boundary. All were reproduced with failing tests and fixed. Finding loaders now select and strictly parse origin, load only exact GitHub targets, require one-to-one provenance, and render generic UI only for exact legacy origin. Mapping rows are fetched in deterministic bounded chunks of exact pack/check pairs with exact tuple cardinality. Every official finding carries the explicit technical-signal boundary.

The three Minor findings were also fixed: refreshed lifecycle props derive a valid current select value, an RPC `false` reports an idempotent already-applied state, and highlight CSS responds only to server-validated `data-selected` rather than an arbitrary URL fragment. Re-review then caught one masked Member PostgREST projection omission; its production select and strict test expectation now both include `finding_origin`. The final independent re-review found every prior finding closed, no new Critical or Important issue, and returned Ready to merge.

## Independent-review repair round 1

The follow-up reviewer blocked the pre-repair commit on two exactness defects. Mapping-request construction had incorrectly treated repeated normal result rows with the same mapping tuple as duplicates, while a short mapping query could hide another returned rule version. The loader now deduplicates only the requested `(mapping_pack_id, check_id, rule_version)` tuple, queries bounded pack/check candidates, and rejects any duplicate, missing, unexpected, or alternate-rule returned tuple. A regression proves that two separate repository evidence generations can safely share one exact mapping tuple; another proves that an alternate rule version cannot be silently accepted.

The same review found that an official evidence ledger row without matching provenance could appear as generic legacy evidence. The loader now makes a separate active-organisation, exact-visible-ID ledger query and requires its IDs to equal the provenance IDs before supporting rows or UI rendering. A missing-provenance ledger test and page rejection test prove that raw title/link data and mutation controls cannot become a fallback. Legacy evidence with neither official row remains unchanged.

TDD RED had exactly three intended failures before this repair (shared mapping tuple rejected, alternate rule hidden by the old query limit, and ledger evidence without provenance returned an empty official set). GREEN is 2 files / 19 tests. Final verification is 223 files / 1,760 Vitest tests, full ESLint, TypeScript typecheck, Actionlint, and `git diff --check`, all passing. The independent re-review found no Critical or Important issue and returned Ready to merge; it noted only that a reciprocal provenance-without-ledger regression would be useful extra coverage, while confirming the exact set comparison already rejects it. No migration, Slack, network/provider, hosted, or external-account activity occurred. Phase 6 browser, DB, real-materialiser/readiness, and production-build gates remain open.
