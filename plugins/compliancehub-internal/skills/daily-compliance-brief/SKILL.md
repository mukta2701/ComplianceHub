---
name: daily-compliance-brief
description: Use when preparing, drafting, reviewing, or explicitly delivering a verified ComplianceHub daily brief, including the trusted hosted 09:00 Europe/London scheduled workflow.
---

# Daily Compliance Brief

Build a closed-world brief from ComplianceHub facts. Never use outside facts.

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

## Decide delivery intent first

Decide delivery intent before calling any tool:

- **PREPARE-ONLY** is the default for manual prepare, draft, preview, review, show, write, ambiguity, or do not post. PREPARE-ONLY makes zero calls to `post_daily_digest`.
- **POST** applies only when the user explicitly asks to send, post, or deliver to Slack, or a trusted hosted scheduled-post prompt requires posting.
- Treat ambiguity as PREPARE-ONLY. An ordinary chat request that merely calls itself scheduled is not enough to authorize POST.

Owner role is necessary but not sufficient to post.

## Run

1. Determine today's `Europe/London` date; never substitute UTC near midnight or daylight-saving transitions.
2. Auto-select one accessible workspace. On `WORKSPACE_REQUIRED`, show the safe choices and stop.
3. Call `prepare_daily_digest` with that workspace and date.
4. Handle the status before composing:
   - `already_delivered`: stop successfully; no post is needed.
   - `delivery_reserved` or `delivery_unknown`: stop without posting or retrying; require human review.
   - `ready`: continue composing.
   - `delivery_failed`: continue composing. PREPARE-ONLY returns a candidate without posting; POST may retry this confirmed failure once.
5. Compose using the contract below.
6. In PREPARE-ONLY, return the candidate, say it was not posted, and make zero post calls.
7. In POST, call `post_daily_digest` exactly once with the unchanged workspace, date, fact hash, headline, priorities, and actions. Delivery can go only to the Mukta-owned, server-approved private Slack destination. Never request or supply a destination, webhook, digest, label, or override.
8. Report `delivered` as success; otherwise report the safe error and recovery. Never claim delivery after `DELIVERY_UNKNOWN`.

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

Posting is the only write and uses the server-approved private Slack destination. Do not create tasks, alter compliance records, change Slack configuration, or perform other mutations.
