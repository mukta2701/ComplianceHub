# ComplianceHub: ongoing operating lifecycle assessment

Assessed 9 September 2026 from starting commit `4b413a0`, the existing fictional local showcase and the isolated team preview. This is a dated assessment; **[release checklist](../../release-checklist.md)** remains the project status source. Current implementation requirements are in the [programme specification](../../superpowers/specs/2026-09-09-operating-lifecycle-quality.md).

## Product direction and what exists

Approved visual follow-on: [ticket 13 — programme dashboard and shell](issues/13-programme-dashboard-design.md) applies the owner's chosen product-wide mockup direction to the dashboard and navigation first. Remaining module-specific redesigns remain subsequent increments. Refer to the release checklist for current verification and runtime status.

ComplianceHub coordinates a growing company's security and compliance work. Its useful unit is a connected obligation: why it matters, who owns it, the work and supporting records, the authorised review, and the next review date. Onboarding and saved baselines begin and periodically summarise that lifecycle. Mukta and Charlie illustrate coordinator and leadership responsibilities; they do not bound the product or define permissions.

The current modular monolith already connects scope, catalogue-versioned assessments, control decisions and immutable SoA versions; risk treatment and accountable tasks; evidence links and dated freshness; policy versions and employee acceptance; assets and risks; audits, findings and corrective tasks; recurring work; and leadership snapshots. Owner/Admin/Member permissions differ from responsibilities. Assigned Members contribute notes; operators manage the programme and independently review contributions; Members read published/saved summaries and accept approved policies. An employee's job title does not grant review authority.

Task completion, human review, evidence freshness, provider verification and audit finding closure are separate existing concepts and must stay separate. The saved baseline currently covers scope, a selected assessment, tasks/contributions, evidence metadata and risks. It is not a complete archived capture of assets, policies, employee acceptance, audits or provider checks. The leadership readiness snapshot is a different publication; saving a baseline is not leadership approval.

## Material findings and priorities

| Priority / affected user | Exact scenario and observed behaviour | Expected outcome / consequence | Evidence and selected response |
|---|---|---|---|
| P1 Coordinator | Edit title of a policy assigned to Alex. The title saves and owner becomes null. | Unchanged ownership must survive ordinary editing; silent loss breaks accountability. | Reproduced with actual policy form in isolated preview and authenticated before/after reads. Policy action regression also red. Ticket01 fixes omitted owner handling and visible owner selector. |
| P1 Coordinator / recurring owner | Complete monthly task, reopen for correction, complete again. Two future tasks appear. | One successor for one occurrence; duplicate work/reminders distort the programme. | Real authenticated local RPC/pgTAP reproduction:2 vs expected1. Ticket02 records generation atomically and protects it from ordinary edits. Legacy unknown lineage must not be invented. |
| P1 Policy owner | Finish first policy review; a later scheduled date arrives. Lifetime unique key rejects the next task. | One task for each later cycle, no duplicate for a retry. Otherwise ongoing annual work disappears. | Real local database constraint reproduction plus sweep tests. Ticket02 separates scheduled-cycle identity from editable deadline, retaining history. |
| P1 Operator / leadership | Generic collector receives a later date and changed count for the same resource. Old observation is retained and newer facts are lost; failure can leave connection healthy. | Preserve known source/date and report failures truthfully; successful attempt must not imply new trustworthy evidence. | Real collector/provider/persistence logic with fictional external/database boundaries: four failing assertions. Separate observation-model decision pending. Official GitHub pipeline is distinct and is not implicated by this evidence. |
| P2 Employee / coordinator | Open draft policy. It offers “I accept this policy” although acceptance RPC only accepts approved policies. | Clear unavailable-state explanation; no impossible action. | Actual draft screenshot plus page regression. Ticket01 keeps historical acceptance and approval distinct. |
| P2 Risk reviewer | Follow existing asset→risk link. Risk page does not show the affected asset or a way back to it. | Inspect context already recorded without hunting through the inventory. | Source and red page test; browser journey verifies reverse navigation in ticket03. New read uses existing tenant-scoped relationship; no permission expansion. |
| P2 Control reviewer | Empty SoA page says assessment answers decide applicability; draft generation actually seeds controls for human decisions. | Explain the human decision required rather than imply automated applicability. | Source trace and rendered page regression. Ticket03 corrects guidance without changing control semantics. |
| P3 Coordinator exporting assets | Export includes free-text owner/location but omits accountable in-app owner and risk links. | Explain extract limits; full import/export roundtrip is not established. | Source-confirmed export limitation. Additional export columns/import mapping deferred rather than silently broadening this batch. |

## Architecture and quality direction

Keep the existing Next.js/Supabase stack. Put transactional task identity, permission checks and immutable history in the existing database commands; keep form parsing, presentation and domain calculations in their current modules. The demonstrated problems do not justify a framework rewrite or broad service extraction. Matt Pocock's codebase-design vocabulary guides testing at useful existing interfaces. A separate architecture-refactoring exercise would duplicate work without evidence of benefit here.

Build on the current restrained blue/neutral visual system: consistent headings, source context beside decisions, obvious owner fields, wrapping links, clear empty/error states, visible keyboard focus and mobile layouts. Do not turn a missing source into a zero or a failed query into “none”. Existing SoA token/focus test failure was caused by scanning unrelated later CSS sections; its scoped rules already comply, so the test boundary is corrected rather than altering unrelated colours.

## Programme and acceptance boundaries

1. [Policy accountability](issues/01-policy-accountability.md): complete edit→persist→reload→publish→employee acceptance.
2. [Repeat review cycles](issues/02-repeat-review-cycles.md): next cycle creation and correction/retry safety with real database constraints.
3. [Connected review context](issues/03-connected-review-polish.md): existing asset/risk navigation, truthful control guidance and scoped visual checks.
4. [Integrated acceptance](issues/04-integration-acceptance.md): independent standards/spec reviews, affected/full checks and actual desktop/mobile demonstration, then commit/push and updated preview.

These increments have independent implementation work; integration depends on all three. The collector requires an explicit choice about dated observation records versus one resource record, prepared as a concrete recommendation. No historical source rows will be overwritten to simulate fresh evidence.

Read-only source inspection covers the wider modules; it is not fresh end-to-end acceptance of every one. Existing fictional showcase evidence remains historical. The updated journeys will have fresh local proof. Live GitHub fix/recheck, hosted Azure acceptance, measured time savings and intended-user acceptance remain separate dependencies owned by the company/access owner and intended reviewers. Existing Azure access failure is unresolved; this programme does not deploy there or contact other people.

## Follow-on read-availability batch — 9 September 2026

At `63dd7ab`, independent source inspection found two P2 decision-quality gaps: dashboard query errors are discarded before calculating risk, evidence, work and setup summaries; audit findings errors become zero-valued findings metrics. The affected coordinator/reviewer can mistake unavailable information for absence of work. Tickets [06](issues/06-dashboard-availability.md) and [07](issues/07-audit-metric-availability.md), governed by the [read-availability specification](../../superpowers/specs/2026-09-09-unavailable-dashboard-data.md), address these together. Regression and browser evidence are required before closure.

Separate deferred asset finding: export omits actual in-app ownership and linked risks, and import derives owner identity from free-text owner/location. A location matching a member name can assign the wrong owner; ordinary location text can lose ownership on additive import. This is source-confirmed, not freshly reproduced in the browser. Resolve distinct owner fields and test real route/import persistence in a later bounded increment; relational roundtrip must not be claimed meanwhile.

## Import preview consistency and ownership decision

At `068384e`, a coordinator can preview an asset import, change a required column to Ignore, and still use the old Confirm import button. The eventual action receives current mappings rather than the displayed preview's mappings. A fresh production-browser check reproduced this exact mismatch; no import was confirmed during the before test. Ticket [08](issues/08-import-preview-consistency.md) requires another preview after mapping/register changes, stable pending inputs and consumed confirmation. This is a P2 correctness issue in a frequent data-entry workflow, independent of ownership semantics.

The ownership investigation also reproduced assigning a member named London when the only supplied Owner & Location text is London. However, the [original phase-B.5 draft](../../superpowers/specs/2026-07-05-phase-b5-import-wizard-design.md) explicitly permits matching an owner from that combined field. It conflicts with the current asset form's separate explicit-owner convention. The owner has been asked whether to supersede that rule with a separate In-app owner column and strict, unambiguous matching. That decision is pending; no ownership implementation is included in ticket08, and the red ownership regression is preserved privately.

## Explicit asset-owner decision — accepted

The owner approved a separate In-app owner column. Ticket[09](issues/09-explicit-asset-import-owner.md) supersedes the combined-field inference rule prospectively, preserving existing records and export format. Blank owners stay unassigned; ambiguous/unmatched names are excluded with guidance. This closes the product decision, not its implementation or acceptance.
