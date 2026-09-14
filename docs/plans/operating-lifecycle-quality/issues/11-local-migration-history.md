# 11: Restore the normal local database upgrade path

**Outcome:** The retained isolated local database accepts the normal migration command without trying to recreate existing contribution tables. Application data and schema stay unchanged.

**Starting commit:** `1978c25`. **Status:** repaired, independently reviewed and verified locally; documentation synchronised with this commit. **Blocked by:** none.

Observed during ticket10: `supabase migration up --local --workdir artifacts/team-baseline/runtime` fails because migration `20260909152313_task_contributions` is absent from the migration ledger, although its schema already exists. Reproduced again after ticket10. Do not use `--include-all`, reset the database or replay the historical migration.

- [x] Compare the existing contribution functions, table constraints, triggers, permissions and policies with the historical migration; repair history only if its effects are present.
- [x] Use the installed CLI's supported local migration repair command for this exact version only.
- [x] Normal migration-up then reports up to date; public schema and every public-table count/content fingerprint remain unchanged.
- [x] Affected local permission/workflow checks and current app/database health pass.
- [x] Record independent review, evidence and the limits of this local maintenance action; update the release checklist and push documentation.

This is local upgrade bookkeeping, with no product/permission redesign, application source change, hosted operation or data deletion. An actual schema mismatch requires a separate diagnosis and correction, not a false applied marker.

[Local operation and evidence](../../../evidence/2026-09-09-local-migration-history.md).
