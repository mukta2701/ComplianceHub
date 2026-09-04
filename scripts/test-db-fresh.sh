#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
supabase_bin="${SUPABASE_BIN:-supabase}"
docker_bin="${DOCKER_BIN:-/opt/homebrew/bin/docker}"
tmp_root="${TMPDIR:-/tmp}"
suffix="$(date +%s)-$$"
project_id="compliancehub-release-${suffix}"
project_dir="$(mktemp -d "$tmp_root/compliancehub-release-${suffix}.XXXXXX")"
artifact_dir="${FRESH_ARTIFACT_DIR:-$repo_root/artifacts/release-2026-09-05}"
mkdir -p "$artifact_dir"

fail() { echo "fresh database validation failed: $*" >&2; exit 64; }
[[ -z "${DOCKER_HOST:-}" ]] || fail "DOCKER_HOST must be unset"
[[ -z "${DOCKER_CONTEXT:-}" || "${DOCKER_CONTEXT}" == "colima" ]] || fail "DOCKER_CONTEXT must be colima or unset"
[[ -x "$docker_bin" ]] || fail "approved local Docker executable is unavailable"
command -v "$supabase_bin" >/dev/null 2>&1 || fail "Supabase CLI is unavailable"
socket="$($docker_bin context inspect colima --format '{{(index .Endpoints "docker").Host}}')" || fail "cannot inspect Docker context"
[[ "$socket" =~ ^unix:///.*\.colima/default/docker\.sock$ ]] || fail "Docker context is not the approved local Unix socket"
[[ "$(git -C "$repo_root" rev-parse --show-toplevel)" == "$repo_root" ]] || fail "unexpected repository root"
[[ "$project_id" =~ ^compliancehub-release-[0-9]+-[0-9]+$ ]] || fail "unsafe disposable project id"

cat > "$artifact_dir/fresh-database.json" <<EOF
{"projectId":"$project_id","workdir":"$project_dir","status":"starting"}
EOF
printf '%s\n' "Fresh stack workdir: $project_dir"

mkdir "$project_dir/supabase"
cp "$repo_root/supabase/config.toml" "$project_dir/supabase/config.toml"
cp -R "$repo_root/supabase/migrations" "$project_dir/supabase/migrations"
cp -R "$repo_root/supabase/tests" "$project_dir/supabase/tests"
cp "$repo_root/supabase/seed.sql" "$project_dir/supabase/seed.sql"
base_port=$((40000 + ($$ % 1000) * 10))
for port in $base_port $((base_port + 1)) $((base_port + 2)); do
  ! (exec 9<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null || fail "port $port is already in use"
done
sed -i.bak \
  -e "s/^project_id = .*/project_id = \"$project_id\"/" \
  -e "s/^port = 54321$/port = $((base_port + 1))/" \
  -e "s/^port = 54322$/port = $((base_port + 2))/" \
  -e "s/^shadow_port = 54320$/shadow_port = $base_port/" \
  "$project_dir/supabase/config.toml"
rm -f "$project_dir/supabase/config.toml.bak"

log="$artifact_dir/fresh-database.log"
redact() { sed -E 's/eyJ[A-Za-z0-9._-]+/[REDACTED]/g; s/sb_(publishable|secret)_[A-Za-z0-9_-]+/[REDACTED]/g'; }
run_tests() {
  local capture="$project_dir/test-output"
  "$supabase_bin" test db --local --workdir "$project_dir" "$@" 2>&1 | redact | tee -a "$log" | tee "$capture"
  grep -Eq 'Files=[1-9][0-9]*, Tests=[1-9][0-9]*' "$capture" || fail "pgTAP produced no positive file/test counts"
  grep -Eq 'Result: PASS' "$capture" || fail "pgTAP did not report PASS"
  rm -f "$capture"
}
"$supabase_bin" start --workdir "$project_dir" --exclude logflare,vector,imgproxy,mailpit,studio,storage-api,realtime,edge-runtime,supavisor,postgres-meta,postgrest 2>&1 | redact | tee "$log"
run_tests "$repo_root/supabase/tests/database/071_github_materialisation_jobs.sql"
run_tests "$repo_root/supabase/tests/database"
api_url="http://127.0.0.1:$((base_port + 1))"
db_port="$((base_port + 2))"
cat > "$artifact_dir/fresh-database.json" <<EOF
{"projectId":"$project_id","workdir":"$project_dir","apiUrl":"$api_url","dbPort":$db_port,"status":"passed"}
EOF
printf '%s\n' "Fresh database validation passed; stack retained at $project_dir"
