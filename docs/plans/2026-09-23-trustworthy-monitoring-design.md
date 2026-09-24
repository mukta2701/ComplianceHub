# Milestone 2 trustworthy Monitoring design

Date: 23 September 2026
Status: Product direction approved; implementation and live acceptance pending

## Outcome and boundary

ComplianceHub checks Owner-selected GitHub repositories, explains each technical result, and connects approved results to Evidence, Findings and permitted remediation Tasks. The first live pilot uses the one selected AdTecher repository. The same behavior must later handle every Owner-selected repository without silently expanding the GitHub App installation or ComplianceHub's selected scope.

Milestone 1 connection health remains a separate fact from Milestone 2 compliance results. A healthy connection is not a passing check. Milestone 3 will own the portable scheduler for all recurring company work; Milestone 2 owns only its narrow daily GitHub collection and on-demand recheck. No milestone changes GitHub settings automatically.

This design follows the [five-milestone roadmap](../superpowers/specs/2026-09-13-trusted-compliance-platform-roadmap.md) and the Owner's 23 September decisions. The [release checklist](../release-checklist.md) remains the sole project status source.

## Starting point

The repository already contains 15 deterministic checks in `src/features/github/domain/rules.ts`, four outcomes, 36-hour observation freshness, an immutable 15-entry mapping pack, whole-pack Owner approval, official result provenance, Evidence/Finding materialisation, conditional Task creation, a Monitoring control room, and an Owner-triggered recheck. These are implemented source and historical local tests, not current live Milestone 2 acceptance. The GitHub collection route exists, but the current default branch does not schedule it. Existing Slack proof concerns connection incidents, not compliance-result changes. Existing AI drafting does not propose GitHub check-to-control mappings.

The current pack-level approval is not the approved review experience. Preserve old approval receipts and official history when moving to individual mapping decisions. Do not edit applied migrations or reinterpret old results as though the new review already occurred.

## User journey

1. An Owner selects repositories under the Milestone 1 connection scope. Monitoring shows collection and result health separately.
2. ComplianceHub presents the versioned mapping set on one review screen. The Owner can approve or reject each check-to-control mapping. Only approved entries can affect official results. A material rule, framework, control or mapping change returns the affected entry for review; unrelated approvals remain valid.
3. A narrow daily run collects selected repositories. Owner and Admin may request a bounded recheck without changing connection scope or rules. A failed or missed run is visible as collection trouble, not a compliance Failure.
4. For each approved entry, the deterministic rule records Pass, Failure, Unknown or Not applicable with source, rule and mapping versions, collection time, freshness and explanation. A valid Pass can create or refresh official Evidence. A Failure creates or reopens one Finding. A Task is created or reused only when an approved owner exists. Unknown and Not applicable create no positive Evidence. Task completion cannot close a Finding; a newer verified Pass can.
5. The Owner can record a reasoned, time-limited exception for a Failure. It lasts at most 30 days; renewal needs a new Owner decision. The check stays visibly failing-with-exception, and expiry returns it to ordinary attention without altering the underlying observation.
6. Monitoring prioritises actionable changes. Members see approved plain-language results and their assigned work, but no raw provider diagnostics, mapping decisions or connection controls.

## Built-in AI mapping suggestions

ComplianceHub generates a saved proposal once for each changed check/control-catalogue version, rather than calling a model on every page load. The input contains only the check description and control text. It excludes repository observations, file content, credentials and private Evidence. The output names only known check and control identifiers, plus a bounded rationale and low/medium/high confidence. Treat model output as untrusted data and validate it before storage or display. Keep the input version or digest, proposal time and model identity for review without logging prompts or secrets.

The proposal appears in the mapping review, with no "Enable AI" control. It is never an approval, rule definition, compliance result or task instruction. If the Owner accepts it, ComplianceHub validates and publishes a new immutable mapping version and records the Owner's approval for the exact changed entry before any future official result uses it. Unchanged entries keep approval only when their entry digests match. The Owner may approve a mapping manually if the model is unavailable. Existing approved mappings and deterministic checks keep working during an AI outage; the screen states that new suggestions are unavailable.

Reuse the existing server-side OpenAI-compatible provider interface where suitable. Before enabling live calls, verify an eligible, approved provider, data terms and cost within the owner's current allowance. An installed adapter or key is not proof of included usage. Do not add a paid route or expose a provider key to the browser without a separate decision. Milestone 2 acceptance requires one real AWS dev suggestion, Owner review and proof that official state did not change before approval.

## Alerts and operational behavior

Send a short in-app and private team-channel alert for a new Failure, an actionable Unknown persisting 36 hours, a check stale beyond the existing 36-hour freshness boundary, and verified recovery. Evaluate Unknown duration and freshness daily even if no new collection succeeds; if both become actionable together, send one stale alert. Do not alert for every unchanged daily Pass. Each alert states what changed, which repository/check is affected, who should look, and links to the matching ComplianceHub record. Slack is a notification channel only: no employee direct messages, reply-based decisions or actions in Slack. Sanitize provider text and never include raw payloads, credentials or private Evidence. Queue, attempted delivery and confirmed delivery are separate states. Deduplicate within an incident lifecycle while allowing a new incident after verified recovery, including on the same UTC day.

Run only work due for selected repositories, with bounded batches, leases and retries. A suspended or revoked connection stops official collection until access is restored; it does not erase historical results. Removed repositories become out of scope while their dated results remain historical. One repository's failure must not prevent the next eligible repository from being considered.

## Trust and review rules

- The server and database enforce workspace scope and role checks. Hiding a button is not authorization.
- Owner approves mappings and exceptions; Owner and Admin may request a recheck; Member is read-only for permitted summaries and assigned work.
- Official records retain observation, repository, rule version, exact approved mapping entry, reviewer decision and collection provenance. The database write and read contracts must support these entry decisions while retaining old whole-pack approval ancestry. A later mapping version does not rewrite old Evidence or Findings.
- If a required permission, GitHub feature, or complete provider response is unavailable, the affected check is Unknown. An exception never becomes a Pass. A provider outage is collection trouble unless a rule explicitly supports a compliance Failure.
- Automatic writes are idempotent across repeated collection, webhook replay, retries and concurrent workers.

## Acceptance and limits

Local tests and a production-mode fictional journey must cover Pass, Failure, Unknown, Not applicable, stale, changed mapping, exception expiry, duplicate collection, recovery, roles and cross-workspace denial. Review the rendered desktop/mobile Monitoring journey before claiming product quality. Preserve an actual before/after interaction recording and screenshots if the implementation changes product UI.

The AWS dev pilot must show a current read-only observation from the one approved repository, approved mapping decisions, resulting official records, a real daily schedule event, the intended private-channel alert and a real AI proposal that cannot change official state without Owner approval. Verify the final repository scope and GitHub permissions remain unchanged. The Owner reviews the evidence and explicitly accepts the milestone. Do not weaken GitHub settings to manufacture a Failure; use fictional data for destructive or unavailable edge cases. Broader repository rollout, production, general Platform Automation and certification claims remain outside this acceptance.
