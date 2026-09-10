# Proof-to-audit visual workspace implementation plan

## Batch 1 — Evidence vault and permission contract

Outcome: Members are explicitly read-only at the Server Action and database boundaries; operators see exact freshness totals, filterable paginated records and a focused evidence detail.

1. Add failing Server Action permission tests, then add the smallest role guard that makes them pass.
2. Add failing rendered-page tests for exact totals, filters, pagination and selected-record behavior.
3. Extract the proof-record presentation and implement the new Evidence list/detail layout in a route-scoped CSS module.
4. Refine the Add evidence form into grouped sections using the existing server contract.
5. Run focused tests, type checking and lint.

## Batch 2 — Audit register and workspace

Outcome: audit status, window, checklist progress, findings and linked evidence are scannable on desktop and phone.

1. Add truthful aggregate data already supported by audit/checklist/finding records.
2. Recompose the register so readiness guidance does not dominate active audits.
3. Recompose audit detail around progress, checklist work and findings; reuse proof-record presentation for linked evidence.
4. Replace wide phone tables with semantic audit and checklist cards while retaining desktop tables.
5. Refine the new-audit form with the same grouped form language.

## Batch 3 — Monitoring oversight

Outcome: active findings and system health appear before provider mechanics, and visible counts state their scope.

1. Put action-needed findings first and compact provider setup/recovery details.
2. Show source-backed health cards only; represent no connection as unknown or unconfirmed.
3. State the current result scope or add exact counts and pagination where the existing query supports it cleanly.
4. Validate owner/member capability differences and phone layouts.

## Batch completion gate

For each batch: focused tests, lint, type checking, production build where source identity changes, 1440/883/390 browser inspection, zero serious/critical accessibility findings, reduced-motion inspection, source identity record, release-checklist update, commit and push. Independent code review follows implementation and material findings are fixed before the batch closes.

