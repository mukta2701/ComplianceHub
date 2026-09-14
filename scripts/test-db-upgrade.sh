#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI:-}" != "true" && "${COMPLIANCEHUB_ALLOW_LOCAL_DB_RESET:-}" != "1" ]]; then
  echo "Refusing destructive local database upgrade test." >&2
  echo "This resets the local Supabase database and permanently erases its data." >&2
  echo "Run only against disposable local data with COMPLIANCEHUB_ALLOW_LOCAL_DB_RESET=1." >&2
  exit 64
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

reset_local_schema() {
  local version="${1:-}"
  local attempt
  local args=(db reset --local --no-seed)
  if [[ -n "$version" ]]; then args+=(--version "$version"); fi

  # The local services reconnect while reset restarts Postgres. A concurrent
  # schema-cache reconnect can transiently deadlock one DDL statement, so give
  # the disposable reset a bounded retry rather than leaving the old fixture DB
  # behind or producing a flaky CI result.
  for attempt in 1 2 3; do
    if supabase "${args[@]}"; then return 0; fi
    if [[ "$attempt" -lt 3 ]]; then sleep 1; fi
  done
  echo "Unable to reset the disposable Supabase database after three attempts" >&2
  return 1
}

restore_current_schema() {
  reset_local_schema >/dev/null
}
trap restore_current_schema EXIT

reset_local_schema 20260807047000
supabase db query --local --file supabase/upgrade-tests/20260807105624_seed_legacy_deliveries.sql
supabase migration up --local
supabase test db --local supabase/upgrade-tests/20260807105624_verify_delivery_outcomes.sql
