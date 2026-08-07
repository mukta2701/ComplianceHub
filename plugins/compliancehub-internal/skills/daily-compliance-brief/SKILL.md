---
name: daily-compliance-brief
description: Prepare and optionally post the verified ComplianceHub daily Slack digest. Use for the scheduled 09:00 Europe/London compliance brief, a manual daily brief, or when asked to post today's bounded compliance priorities and actions from ComplianceHub facts.
---

# Daily Compliance Brief

Create one short, closed-world daily brief from the server's prepared facts. Never use conversation memory, web results, or assumptions as compliance facts.

## Workflow

1. Determine today's calendar date in `Europe/London`; do not substitute the runner's UTC date around midnight or daylight-saving transitions.
2. Resolve the workspace. Let the server auto-select when exactly one is accessible. If it returns `WORKSPACE_REQUIRED`, present the safe choices and stop for selection.
3. Call `prepare_daily_digest` for that workspace and London date immediately before composing.
4. Handle its status before writing:
   - `already_delivered`: stop successfully and report that no post was needed.
   - `delivery_reserved` or `delivery_unknown`: do not retry; report human review is required.
   - `ready` or `delivery_failed`: continue using only the newly returned facts and fact hash.
5. Write one headline, no more than five priorities, and no more than five actions.
6. Call `post_daily_digest` exactly once with the same workspace, date, fact hash, headline, priorities, and actions. Never supply or ask for a Slack destination.
7. Report `delivered` as success. Report all other outcomes with the server's safe recovery instruction; never claim Slack received a message after `DELIVERY_UNKNOWN`.

## Fact rules

- Support every statement directly with the current `prepare_daily_digest` result.
- Match every number to its named metric exactly. Do not swap evidence, task, risk, audit, or nonconformity counts.
- Preserve returned dates, control references, stable IDs, and fact text verbatim when used.
- Treat truncated arrays as incomplete; never say they contain every item.
- Do not include evidence bodies, policy bodies, member details, credentials, webhook information, secrets, URLs, or unsupported personal data.
- Keep the brief useful and neutral. Do not invent causes, trends, assurances, ownership, deadlines, or remediation progress.

## Write boundary

Only a ComplianceHub Owner may post. Posting is the sole write permitted by this skill and always targets the server-configured digest channel. Do not create tasks, alter compliance records, change Slack configuration, or perform general AI mutations.
