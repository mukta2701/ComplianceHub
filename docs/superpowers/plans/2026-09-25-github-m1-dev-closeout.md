# GitHub M1 Dev Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close Milestone 1 on the existing AWS dev pilot by verifying the already-deployed GitHub connection, recording current live evidence, and obtaining Owner plus AWS/security admin acceptance — with no new features and no separate staging stack.

**Architecture:** Verify, don't rebuild. Confirm the exact code revision actually running on AWS dev and the exact scheduled-reconciliation revision, then re-prove roles, webhooks, scope removal/recovery, secrets, logs and failure visibility against that same revision before acceptance.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5, Node.js 22, Supabase/PostgreSQL, existing AWS dev web service on App Runner, existing unattended reconciliation runner path (currently GitHub Actions), GitHub App webhooks, Slack notices. No ECS/Fargate/EventBridge staging stack for M1.

**Spec:** `docs/superpowers/specs/2026-09-14-github-organisation-repository-integration-design.md` (sections 12–13 are authoritative for verification and definition of done; section 11 defines the AWS dev pilot runtime).

---

## Bounded outcome

At the end of this plan, either (a) M1 is accepted on AWS dev with current, separately labelled automated, local fictional-demo, AWS-dev, live-GitHub and human-acceptance evidence, or (b) M1 stays open with a named failed check and owner. No application behaviour changes in this plan. Task 1 live checks (Steps 1–3) are blocked until the Task 1 preconditions — read-only candidate-revision identification plus fresh automated M1 checks plus local production-mode fictional demo — are recorded.

## Global Constraints

- Closeout only. Do not reimplement, redesign, or change product code, tests, or migrations in this plan. This plan draft itself makes no release-status edit.
- Do not merge, deploy, change provider configuration, or reconfigure workflows. The sole permitted provider mutation in this plan is temporary removal/restoration of the single approved pilot repository in Task 4, only with fresh explicit Owner/Aman GO immediately before the step naming that repository and the agreed restore. No permission, suspension, installation, or other repository change is permitted in this plan; if any such change appears required, stop and ask — do not proceed on prior approval. If a branch/PR integration is required to proceed, stop and ask for explicit approval.
- Never change GitHub permissions, suspension state, installation settings, or scope beyond that single Task 4 pilot-repo remove/restore exception. Test only the one approved pilot repository; never test against other repos. If performing Owner connect/select would require changing installation/scope state beyond the single Task 4 repository remove/restore exception, do not do it; mark that live round-trip gate open and require a separately scoped decision/task before any such mutation. No approval in this plan can expand the exception.
- Never include passwords, private keys, client secrets, webhook secrets, tokens, or raw webhook bodies in the plan, evidence files, screenshots, logs, or chat. Sanitise everything.
- Never invent accounts, repository names, permission levels, run IDs, digests, or approval dates. Every identity, revision, and result in evidence must be observed and copyable from its source.
- Keep Supabase for auth/PostgreSQL/storage. No production GitHub App, no production credentials, no broader access, no organisation-wide rollout, no M2 compliance interpretation.
- Preserve prior evidence as historical. A past passing run proves only that run; it never proves the current revision, the scheduled default-branch revision, or current health.
- Fresh automated gate after candidate identification: re-run the M1 safety checks against the exact candidate revision from Step 0-Pre and record revision, check inventory, and outcome before any Task 1 live check. Historical runs never substitute.
- Local fictional-demo gate second: record a local production-mode demo with fictional data (desktop + mobile) before any Task 1 live check. Label it fictional/non-live; it never proves provider behaviour.
- Run heavy builds, tests, and browser suites sequentially via `node --import=tsx scripts/local-resource-guard.ts -- <command>` (see `docs/local-resource-guard.md`).
- After each task, update `docs/release-checklist.md` truthfully (fresh vs historical, environment, limits) without creating a competing status tracker.

## Historical evidence (do not treat as current)

Per `docs/release-checklist.md` (25 September 2026 entry), release `6fb26bafe88d7ebf1e7c7f1142e0ec7032bce653` has three recorded dev observations: one one-repository suspension incident, one recovery notice, and one unattended scheduled reconciliation run (linked Actions runs `36153122035`, `36154171163`, `36178719774`). These prove those specific runs only. They do **not** prove the currently deployed revision is healthy, the schedule runs on the accepted default-branch revision, failures/missed runs are operator-visible, permissions are currently exact, or roles/webhooks/scope-removal still behave. Every one of those must be re-verified below against the current revision.

## Review Focus and test mapping

- Fresh automated safety gate (Owner-only connection and repository-scope mutations; Admin read-only access and Member exclusion; one-use callback state, actor/workspace binding and installation authority; exact six-permission enforcement; complete paginated repository discovery and configured bounds; cross-workspace and cross-installation isolation; webhook signature, size, replay and event validation; selection, removal and historical preservation; reconciliation, bounded retry, incident deduplication and recovery; log and Slack sanitisation; absence of GitHub write operations; absence of general repository source-code collection; explicitly verified no raw webhook-payload retention) on the exact candidate revision including read-only candidate-revision identification and live-vs-candidate identity comparison → design sections 12.1, 3–8; owning task: Task 1 preconditions.
- Local production-mode fictional demo (desktop + mobile, labelled fictional/non-live, never provider proof) → design section 12.2; owning task: Task 1 preconditions.
- Live roles and scope contract (Owner-only mutation, Admin read-only, Member exclusion; one pilot repo, exact six read permissions, no writes) → design sections 3–4, 4.1; owning tasks: Tasks 2, 3.
- Live webhook trust (live Owner connect/discover/select + genuine webhook + reconciliation round trip on the exact AWS-dev revision, signed, bounded, replay-safe, no raw-body retention), scope remove → fail-closed → recovery, scheduled reconciliation, health/retry/incidents, sanitised Slack, and AWS-dev safeguards → design sections 5.4, 6.3–6.4, 7, 8, 10, 11, 12.3–12.4; owning tasks: Tasks 1, 4, 5.
- Human acceptance by Owner + AWS/security admin and M1 close per section 13 → design sections 12.5, 13; owning task: Task 6.

---

### Task 1: Confirm current AWS-dev revision, health, and scheduled-reconciliation revision

**Files:**
- Read: `docs/release-checklist.md`
- Update: `docs/evidence/2026-09-25-github-m1-dev-closeout.md` (create if missing; sanitised only)

**Step 0: Required preconditions — identify the candidate revision first (read-only, no mutation), then complete and record both gates against that exact candidate before any live check in Steps 1–3**

- [ ] Step 0-Pre — read-only candidate-revision identification: define the candidate commit as the exact SHA reported by the current AWS-dev release (live health response); record the scheduled workflow's default-branch/run commit separately from read-only sources only (Actions workflow/run metadata, git metadata as available). Fresh automated/local checks run against the AWS-dev candidate; Task 1 then compares both the live deployment identity and unattended schedule identity against that candidate. If the scheduled revision differs, mark mismatch/open; no changes to align. No merge, deploy, workflow edit, or provider change. If either identity cannot be established, record "open verification" and stop — do not infer it from historical runs.
- [ ] Step 0A — fresh automated M1 checks against the exact candidate revision from Step 0-Pre: cover Owner-only connection and repository-scope mutations; Admin read-only access and Member exclusion; one-use callback state, actor/workspace binding and installation authority; exact six-permission enforcement; complete paginated repository discovery and configured bounds; cross-workspace and cross-installation isolation; webhook signature, size, replay and event validation; selection, removal and historical preservation; reconciliation, bounded retry, incident deduplication and recovery; log and Slack sanitisation; absence of GitHub write operations; absence of general repository source-code collection; explicitly verified no raw webhook-payload retention. Discover the exact check inventory in execution from repository evidence (test files, package/config scripts, CI workflow); record file paths, commands run sequentially via the local resource guard, revision, and outcome. Do not invent commands or claim existing coverage. STOP: without fresh recorded evidence, do not start Steps 1–3.
- [ ] Step 0B — local production-mode demo with fictional data against the exact candidate revision from Step 0-Pre: run the exact local production-mode build with fictional provider-shaped data, review desktop and mobile, and record sanitised evidence labelled fictional/non-live. Discover the exact build/demo command in execution; run heavy commands sequentially via the local resource guard. This demo proves application behaviour only and never proves provider behaviour. STOP: without recorded fictional-demo evidence, do not start Steps 1–3.

**Step 1: Record the currently deployed revision from the live host and compare it to the candidate (blocked until Step 0-Pre, 0A and 0B are recorded)**

- Open the live AWS dev health endpoint in a browser (or other approved read-only check) and copy the exact reported release/commit identifier and health fields.
- Record: date/time (UTC), health URL path used, reported release ID, app health, database health.
- Compare the live release ID against the Step 0-Pre candidate commit. If the identities differ or cannot be established, mark mismatch/open — do not merge, deploy, or reconfigure workflows to align them in this plan.
- Do not paste any secret, token, or internal hostname beyond what the approved health response already exposes.

**Step 2: Determine whether the scheduled reconciliation workflow is on the accepted default-branch revision (compare against the Step 0-Pre candidate)**

- Open the scheduled reconciliation workflow's recent runs in GitHub Actions (read-only).
- Record for the most recent scheduled (unattended, not manually dispatched) run: run ID/URL, branch it ran on, commit/revision it ran, trigger type (`schedule`), conclusion, start/end time.
- Explicitly answer: does the schedule run on the Step 0-Pre candidate default-branch revision that matches the deployed release? If branch, commit, or trigger cannot be confirmed, or the identities differ, record "mismatch/open verification" — do not assume it, and do not merge, deploy, or reconfigure workflows to align them in this plan.
- Prior run `36178719774` is historical evidence of one unattended run only. It does not prove the current schedule configuration.

**Step 3: Check failure/missed-run visibility**

- Record the existing operator alert path for a failed or missed run (GitHub Actions notification or AWS-dev alerting). Logs alone are not an alert; do not require two separate alert systems.
- If no operator-visible failure path can be shown, record it as a failed/open gate — do not waive it.

**Step 4: Decide stop/continue**

- [ ] Step 0-Pre candidate-revision identification recorded (candidate commit + scheduled default-branch revision, read-only, no mutation), or marked open with owner.
- [ ] Step 0A fresh automated M1 safety checks recorded against the exact candidate revision (inventory + outcome), or marked failed/open with owner.
- [ ] Step 0B local production-mode fictional demo recorded against the exact candidate revision (desktop + mobile, labelled fictional/non-live), or marked failed/open with owner.
- [ ] Deployed revision + health recorded against today's date and compared to the candidate; match or mismatch/open stated plainly.
- [ ] Scheduled workflow branch/revision/trigger recorded and compared to the candidate; match or mismatch/open stated plainly.
- [ ] Failure/missed-run visibility recorded or marked missing.
- STOP: if the identities differ or cannot be established, mark mismatch/open; do not merge, deploy, or reconfigure workflows in this plan. If a merge, deploy, or workflow reconfiguration is needed to align revisions, stop here and ask for explicit approval. Do not merge or deploy in this plan.

---

### Task 2: Record pilot installation scope, exact permissions, and no-write evidence

**Files:**
- Read: `docs/superpowers/specs/2026-09-14-github-organisation-repository-integration-design.md` (sections 4.1–4.2)
- Update: `docs/evidence/2026-09-25-github-m1-dev-closeout.md`, `docs/release-checklist.md`

**Step 1: Record the selected pilot repository**

- With the Owner present (read-only inspection), open Settings → Connections on AWS dev and copy the connected organisation name, installation identity shown, available-repository count, and the single selected pilot repository identifier.
- Record date/time, observer, and AWS-dev release ID from Task 1 alongside it.

**Step 2: Record all six permission levels exactly as shown/granted in GitHub**

- Source is the GitHub App settings / installation settings (GitHub side), not the AWS console and not the ComplianceHub UI. Record each of `metadata`, `administration`, `actions`, `vulnerability_alerts`, `security_events`, `secret_scanning_alerts` with its exact granted level (must be read-only).
- If any permission is missing, broader, or an extra permission appears, record it as a failed gate. Do not proceed past this task until resolved by a separate approved change.

**Step 3: Verify no write requests with available sanitised audit evidence**

- Using only already-available provider audit information (GitHub App/installation audit or delivery logs the company already exposes), record the source checked, time window, and result supporting "no write operation by ComplianceHub" for the pilot.
- If the available audit view cannot support that claim, label it "open verification: no-write evidence unavailable" rather than inventing it.

**Checklist:**

- [ ] Pilot repo + organisation + installation identity recorded with date and release ID.
- [ ] All six permission levels recorded verbatim; exact-read-only pass/fail stated.
- [ ] No-write claim either evidenced (source + window cited) or marked open.

---

### Task 3: Live Owner/Admin/Member role checks on AWS dev

**Files:**
- Update: `docs/evidence/2026-09-25-github-m1-dev-closeout.md`, `docs/release-checklist.md`

**Prerequisite (must come first): Identify disposable test accounts; never invent them**

- [ ] Use the signed-in Owner account plus the two previously Owner-approved disposable Admin/Member accounts, provisioned via the hosted invite flow and removed immediately afterwards via the hosted flow.
- [ ] Plan records only account roles/labels, never passwords, secrets, or credentials.
- STOP: if the previously approved accounts are not available, stop. Do not reuse personal accounts or invent account names.

**Step 1: Owner check (live AWS dev, same release as Task 1)**

- Sign in as the Owner, open Settings → Connections, and confirm: organisation shown, connection health text, last successful reconciliation time, available vs selected repositories, and that install/reconnect/scope controls behave as Owner-only. Authoritative permission levels remain the Task 2 GitHub-side record; do not treat the ComplianceHub or AWS views as the permission source.
- Capture sanitised screenshots (no secrets, tokens, or personal data beyond the disposable label).

**Step 2: Admin check**

- Sign in as the disposable Admin and confirm: organisation, scope, freshness, and safe incidents are visible; no install/reconnect/scope-change control is shown or usable.
- Record any control that implies Admin can manage GitHub as a defect, not as acceptance.

**Step 3: Member check**

- Sign in as the disposable Member and confirm: GitHub connection configuration and diagnostics are unreachable (redirect or denial as designed).
- Record the exact behaviour observed.

**Checklist:**

- [ ] Owner session and the two approved disposable Admin/Member accounts identified; no passwords recorded.
- [ ] Owner, Admin, and Member behaviours each recorded with date, release ID, and screenshots or marked as failed/open.

---

### Task 4: Webhook signature/replay and live repo-scope remove/fail-closed/recovery

**Files:**
- Update: `docs/evidence/2026-09-25-github-m1-dev-closeout.md`, `docs/release-checklist.md`

**Hard gate (read twice before touching anything — sole provider-mutation exception):**

- [ ] The only permitted provider mutation in this plan is temporary removal/restoration of the single approved pilot repository in Step 3 below, only with fresh explicit Owner/Aman GO obtained immediately before, naming that repository and the agreed restore. No permission, suspension, installation, or other repository change is permitted.
- [ ] No test against any other repository.
- STOP without that GO: complete only Steps 1–2 below, and mark Step 3 "awaiting GO".

**Step 1: Live connect/discover/select + genuine webhook + reconciliation round trip (fresh, on the exact Task 1 candidate/AWS-dev revision; before any replay or scope-removal work)**

- With fresh evidence on the exact AWS-dev revision from Task 1, an Owner connects the pilot App, discovers/selects the one approved repository, a genuine GitHub webhook is received, and reconciliation succeeds. Record date/time (UTC), observer, release ID, installation identity, selected pilot repo, webhook delivery metadata (delivery ID, event name, fingerprint reference — never raw body), and reconciliation outcome.
- If performing Owner connect/select would require changing installation/scope state beyond the single Task 4 repository remove/restore exception, do not do it; mark that live round-trip gate open and require a separately scoped decision/task before any such mutation. If the round trip cannot safely be exercised, mark the gate open — do not infer pass from historical records.

**Step 2: Signature and replay behaviour (alters no GitHub config in this step)**

- Confirm a valid webhook delivery is accepted and its processing metadata recorded (delivery ID, event name, fingerprint reference — never the raw body).
- Replay the same captured delivery ID through the approved test mechanism and prove no duplicate processing occurs.
- Confirm a forged/unsigned delivery fails safely.
- Record delivery IDs/times and outcomes; never store raw payloads in evidence.

**Step 3: Scope removal → fail-closed → recovery (only with the Step 3 GO above; sole exception)**

- Remove only the single approved pilot repository from the GitHub App scope (GitHub side, per agreed step). Confirm ComplianceHub marks it fail-closed (`partially_unavailable` or Owner-action-required guidance as designed) and emits exactly one sanitised in-app incident plus one Slack incident — not repeated noise.
- Restore the approved repository scope. Wait for a genuine provider reconciliation and confirm exactly one recovery notice and incident closure, with no duplicated incident.
- Also confirm a missed webhook is repaired by scheduled reconciliation (or mark "open" if it cannot be shown).

**Checklist:**

- [ ] Live round trip (Owner connect, discover/select, genuine webhook, reconciliation) recorded on the exact AWS-dev revision, or marked open — never inferred from history.
- [ ] GO recorded (who, when, which pilot repo) before any scope change, or removal/recovery marked awaiting GO.
- [ ] Replay-safe, forged-delivery-safe, removal fail-closed, recovery notice, and missed-webhook repair each recorded as pass or open — never assumed.

---

### Task 5: AWS-dev release identity, secrets, access, logs/alerts, schedule, failure path

**Files:**
- Update: `docs/evidence/2026-09-25-github-m1-dev-closeout.md`, `docs/release-checklist.md`

Verify each item against the **current** AWS dev deployment (same release ID as Task 1). No separate AWS staging infrastructure is required or to be created; no EventBridge or CloudWatch-specific resources are mandatory. Verify the equivalent operator-visible failure in AWS dev and make no production changes.

- [ ] Release identity: deployed image/digest or release ID matches the approved source revision; callback and webhook HTTPS routes reachable; app + database health `ok`.
- [ ] Secret isolation: GitHub App private key, client secret, webhook secret live in AWS Secrets Manager with KMS, injected only into the runtime that needs them, never built into the image, never in logs/health/alerts. Record mechanism + reviewer, never values.
- [ ] Least privilege: deployment and runtime roles are least-privilege for dev; record role names/owners and the AWS/security admin who confirms them.
- [ ] Sanitised logs/alerts: app logs, reconciliation logs, in-app incidents, and Slack messages contain no tokens, keys, secrets, raw bodies, source code, or stack-trace internals. Quote only safe field names.
- [ ] Schedule + failure path: reconciliation schedule identity/cadence recorded; a failed or missed run triggers an operator-visible notification in the existing Actions or AWS-dev alert path (not logs alone). If it cannot be shown, mark it failed/open.
- STOP: if any check fails, M1 remains open. Do not silently waive it and do not create new infrastructure without a separate decision (per design section 11).

---

### Task 6: Evidence pack, acceptance signatures, M1 close and M2 boundary

**Files:**
- Finalise: `docs/evidence/2026-09-25-github-m1-dev-closeout.md`
- Update: `docs/release-checklist.md` (plain-language status at top stays current; history preserved)

**Step 1: Assemble the evidence pack**

- One sanitised evidence file covering Tasks 1–5, each result labelled with date (UTC), environment (`AWS dev`), exact release ID, observer, source, and limit. Separate fresh evidence from historical (Tasks 1–5 re-verified vs the three historical runs named above).
- Validate: Markdown links resolve, `git diff --check` passes, claims match the revised design (no staging-stack claims, no production claims).

**Step 2: Obtain two human acceptances (both required)**

- [ ] ComplianceHub Owner accepts the live pilot on AWS dev (name + date recorded).
- [ ] Company AWS/security administrator accepts dev safeguards, access, secrets, logging, and runtime (name + date recorded).
- STOP: without both sign-offs, M1 is not closed. Do not begin M2 acceptance work on the basis of one signature or AI recommendation.

**Step 3: Close M1 / open M2**

- Only when every design section 13 bullet holds on current evidence plus both sign-offs: record "M1 accepted on AWS dev" with release ID and dates in the release checklist.
- M2 handoff boundary: M2 planning may proceed in parallel; M2 implementation/acceptance waits for M1 completion and may begin only after that M1 acceptance line is recorded. M2 must not assume production readiness, wider rollout, new permissions, or production credentials — each needs its own decision.

---

## Decision and stop conditions (whole plan)

1. Any required merge, deploy, workflow edit, or provider change beyond the single Task 4 pilot-repo remove/restore exception → stop, ask for explicit approval. No permission, suspension, installation, or other repository change has an in-plan GO path.
2. Any missing fresh Owner/Aman GO for the Task 4 pilot-repo remove/restore, or any revision-identity mismatch/unverifiable identity in Task 1, or any need to change installation/scope state to exercise the Task 4 live round trip → skip the mutation/exercise, mark awaiting GO or mismatch/open.
3. Any failed verification in Tasks 1–5 → M1 stays open; record owner and next step.
4. Any claim that cannot be confirmed from observed docs/context → label "open verification", never invent. Historical runs never substitute for the current candidate revision.

## Final verification (closeout execution; no behaviour changes)

- [ ] Fresh candidate-revision identification (Task 1 Step 0-Pre, read-only), fresh automated gate (Task 1 Step 0A) and local fictional-demo gate (Task 1 Step 0B) each recorded against that exact candidate with revision, inventory/evidence, and outcome before live acceptance.
- [ ] Evidence pack at `docs/evidence/2026-09-25-github-m1-dev-closeout.md` is sanitised, labels fresh vs historical per task, and Markdown links resolve.
- [ ] `docs/release-checklist.md` truthfully records fresh vs historical, environment, and limits with history preserved and no competing tracker.
- [ ] `git diff --check` passes.
- [ ] No product code, migration, provider permission/suspension/installation/other-scope, secret, credential, workflow reconfiguration, merge, deploy, or production change was made to close the milestone; sole exception is Task 4 single pilot-repo remove/restore only with fresh explicit Owner/Aman GO.
- [ ] Plan remains consistent with the design (AWS dev is the acceptance environment, no separate staging stack, no production claims).
