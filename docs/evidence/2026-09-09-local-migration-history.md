# Local migration history repair — 9 September 2026

Starting commit `1978c25`. [Ticket11](../plans/operating-lifecycle-quality/issues/11-local-migration-history.md). No application code, product behaviour, schema, permissions or user records changed in this maintenance batch.

## Before and after

Before: the standard local migration command failed with `LegacyMigrationMissingRemoteError` for `20260909152313_task_contributions`. Its schema was already installed; replaying it would attempt to create existing objects.

After: the installed Supabase CLI records that exact historical migration as applied. The normal local upgrade command succeeds with `applied: []` — no migration or schema change was needed. This restores the supported upgrade path for subsequent local work.

## Verification before repair

Independent catalogue inspection matched all effects of the source migration against the retained isolated database:

- Four function bodies exactly match after trimming outer whitespace, including signatures, return types, security settings, fixed search paths and execution grants.
- The task assignment-revision column has the expected type, default, nullability and validated check.
- All 14 contribution columns, 13 validated constraints, 5 valid indexes, 4 enabled triggers, row-level security, authenticated read policy and effective permissions match.
- Of 133 local migration versions, only this version was missing from the 132 ledger entries. There were no extra ledger versions or name mismatches.

This establishes schema equivalence. It does not identify when or why the ledger entry was omitted.

## Exact local operation

From the active `codex-team-baseline` checkout, using its existing isolated runtime configuration (API 55321 / database 55322):

```sh
node --import=tsx scripts/local-resource-guard.ts -- node_modules/.bin/supabase migration repair 20260909152313 --status applied --local --workdir artifacts/team-baseline/runtime
node --import=tsx scripts/local-resource-guard.ts -- node_modules/.bin/supabase migration up --local --workdir artifacts/team-baseline/runtime
```

Do not treat this as a general instruction to mark missing migrations applied. A fresh mismatch needs its own schema comparison. The default repository configuration targets a different retained local database; no command here operated that database or a hosted environment. No `--include-all`, reset, historical replay or schema rewrite was used.

## Fresh evidence after repair

- Repair reports exactly `20260909152313` applied, `repairAll: false`.
- Normal migration-up succeeds and applies zero migrations.
- Public schema dump fingerprint, including grants, is unchanged. All 95 public-table counts and content fingerprints match exactly before/after; raw rows and dumps were not published.
- Affected contribution and dated-observation database suites: 2 files / 105 assertions pass.
- Existing background application and database health remain OK at 3300, identifying unchanged application source `9b831c53ef18e5c15383e88de3060a5065b3fbde`.

Private diagnostic outputs and fingerprints remain in ignored `artifacts/migration-history/`. This is local maintenance proof, not hosted deployment or live-provider acceptance. The dated-observation application release and its desktop/mobile demonstration remain documented separately.

## Independent review

Standards review (Sol) and specification review (Astra) independently checked the maintenance documentation and private command/fingerprint evidence against ticket11. Both report no material findings. The unexplained origin of the missing history entry remains a limitation; the repair is not described as a root-cause explanation.
