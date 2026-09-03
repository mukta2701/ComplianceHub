---
name: daily-compliance-brief
description: Use when preparing, drafting, previewing, or reviewing a verified ComplianceHub daily brief in Phase 3.
---

# Daily Compliance Brief

Build a closed-world, Slack-ready brief from ComplianceHub facts. Never use outside facts.

Phase 3 is recommendation-only. It can prepare and preview a brief but cannot
send, post, deliver, retry delivery, or choose a destination. This holds even
under owner, full-access, urgency, trusted-schedule, or CEO-demo pressure.

`prepare_daily_digest` returns schema-v2 facts. Its GitHub facts come only from
official results, which are immutable, and their committed lifecycle lineage. Never
reconstruct facts from shadow observations.

`list_github_compliance_results` is a read-only tool for bounded official GitHub
compliance outcomes. Treat its returned outcome, freshness, and mapping status
as facts; do not reconstruct history from raw observations or use it to post.
Whenever `list_github_compliance_results` is used, a traversal is exhaustive
only when it starts without a cursor, keeps the same workspace and all
normalized filters including limit, and follows every exact `nextCursor` until
null. A `pageKind=continuation` response is never exhaustive by itself;
`truncated=true` or a non-null cursor means more rows follow the current page.

## Phase 3 PREPARE/PREVIEW sequence

Use this positive sequence and output contract:

- **PREPARE/PREVIEW** is the only Phase 3 mode, including requests that say
  send, post, deliver, scheduled, owner, full permission, urgent, or CEO demo.
- Determine the `Europe/London` calendar date, select one accessible workspace,
  call `prepare_daily_digest`, handle its returned status, and compose a
  fact-checked preview from the returned facts and fact hash.
- Return the candidate with its workspace, local date, fact hash, headline,
  priorities, actions, and the exact statement: **"Prepared for preview; not
  delivered by Phase 3."**
- Never request or supply a Slack destination, webhook, override, or delivery
  instruction. The scheduled application and later phases are outside this MCP
  capability.

## Run

1. Determine today's `Europe/London` date; never substitute UTC near midnight or daylight-saving transitions.
2. Auto-select one accessible workspace. On `WORKSPACE_REQUIRED`, show the safe choices and stop.
3. Call `prepare_daily_digest` with that workspace and date.
4. Handle the status before composing:
   - `already_delivered`: report the safe status and stop; do not claim a new delivery.
   - `delivery_reserved` or `delivery_unknown`: report the safe status and stop; require human review.
   - `ready`: continue composing.
   - `delivery_failed`: continue composing a PREPARE/PREVIEW candidate only.
5. Compose using the contract below.
6. Return the candidate and the required PREPARE/PREVIEW statement. Do not make an MCP delivery call.

## Exact composition contract

For GitHub content, copy only exact lines from `facts.github.lines`. They use
these server-owned qualifiers:

- `Verified GitHub technical fact:` for current verified pass/fail changes and exact counts;
- `Unknown GitHub information:` for current unknown results;
- `Stale GitHub result:` for expired freshness;
- `Recommended follow-up:` for bounded current verified failures.

Historical-mapping, stale, unknown, and not-applicable results are never
described as passing. Never say a GitHub result proves ISO certification,
readiness, security, or overall compliance. Do not decorate, join, recalculate,
or paraphrase a GitHub line. Treat every truncated GitHub section as incomplete.

Use one fact per line. An exact returned fact literal must be copied unchanged and is limited to `workspace.name`, `localDate`, `attentionItems[].id`, `attentionItems[].summary`, `attentionItems[].dueOn`, `attentionItems[].observedOn`, `monitoringFindings[].id`, `monitoringFindings[].title`, `monitoringFindings[].controlRef`, `monitoringFindings[].detectedAt`, `latestLeadershipReport.id`, or `latestLeadershipReport.publishedAt`. Status, severity, category, and source fields are not allowed as standalone literals.

Otherwise use one metric form below with the exact prepared `<N>`. Use the singular form before `/` only when `<N> = 1`; use the plural form after `/` for every other count:

- `<N>% readiness`
- `<N> SoA control` / `<N> SoA controls`; `<N> control` / `<N> controls`
- `<N> open task` / `<N> open tasks`; `<N> overdue task` / `<N> overdue tasks`
- `<N> evidence item` / `<N> evidence items`; `<N> total evidence`; `<N> expiring evidence`; `<N> expired evidence`
- `<N> very-high risk` / `<N> very-high risks`; repeat for `high`, `moderate`, and `low`
- `<N> open audit` / `<N> open audits`; `<N> open non-conformity` / `<N> open non-conformities`

An action may prefix one metric template only with `review|address|resolve|investigate|prioritize|prioritise`. Add no other words.

Provide one headline up to 120 characters, up to five priorities, and up to five actions of up to 240 characters each. Lists may be empty. Reject multiline text, URLs, email addresses, angle brackets, credentials, generic claims, changed numbers, and decorated literals.

Pass `factHash`, workspace, and date unchanged. Treat truncated arrays as incomplete. Exclude bodies, member details, credentials, webhook data, secrets, URLs, and unsupported personal data. Invent no causes, trends, assurances, ownership, deadlines, or progress.

All seven Phase 3 MCP tools are read-only. Do not create tasks, alter compliance
records, change Slack configuration, or perform other mutations.
