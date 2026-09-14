#!/usr/bin/env bash
set -euo pipefail

# Run migration and pgTAP checks in a disposable Supabase project. This helper
# deliberately never invokes a command against the canonical compliancehub
# project and never uses a linked or hosted database.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
supabase_bin="${SUPABASE_BIN:-supabase}"
docker_bin="${DOCKER_BIN:-/opt/homebrew/bin/docker}"
project_dir=""
project_id=""
started=0
tmp_root="${TMPDIR:-/tmp}"

fail() { echo "isolated database validation failed: $*" >&2; exit 64; }
[[ -z "${DOCKER_HOST:-}" ]] || fail "DOCKER_HOST must be unset for local-only validation"
[[ -z "${DOCKER_CONTEXT:-}" || "${DOCKER_CONTEXT}" == "colima" ]] || fail "DOCKER_CONTEXT must be colima or unset"
[[ -x "$docker_bin" ]] || fail "approved local Docker executable is unavailable"
command -v "$supabase_bin" >/dev/null 2>&1 || fail "Supabase CLI is unavailable"

docker_socket="$($docker_bin context inspect colima --format '{{(index .Endpoints "docker").Host}}')"
[[ "$docker_socket" == unix:///* ]] || fail "Docker context is not a local Unix socket"

identity="$($docker_bin info --format '{{.Name}}|{{.ServerVersion}}' 2>/dev/null)" || fail "cannot inspect local Docker"
[[ -n "$identity" ]] || fail "local Docker is unavailable"

mode="both"
if [[ $# -gt 1 ]]; then fail "usage: $0 [fresh|upgrade|both]"; fi
[[ $# -eq 0 || "$1" == "fresh" || "$1" == "upgrade" || "$1" == "both" ]] || fail "usage: $0 [fresh|upgrade|both]"
[[ $# -eq 0 ]] || mode="$1"

suffix="$(mktemp -u XXXXXX)"
[[ "$suffix" =~ ^[A-Za-z0-9]+$ ]] || fail "could not generate a safe isolated suffix"
project_id="compliancehub-isolated-$(printf '%s' "$suffix" | tr '[:upper:]' '[:lower:]')"
[[ "$project_id" != "compliancehub" && "$project_id" =~ ^compliancehub-isolated-[a-z0-9]+$ ]] || fail "unsafe isolated project id"
project_dir="$(mktemp -d "$tmp_root/compliancehub-isolated-${suffix}.XXXXXX")"

cleanup() {
  if [[ "$started" == 1 && "$project_id" =~ ^compliancehub-isolated-[a-z0-9]+$ ]]; then
    "$supabase_bin" stop --project-id "$project_id" --no-backup >/dev/null 2>&1 || true
  fi
  if [[ -n "$project_dir" && "$project_dir" == "$tmp_root"/compliancehub-isolated-* ]]; then
    rm -rf -- "$project_dir"
  fi
}
trap cleanup EXIT

cp -R "$repo_root/supabase" "$project_dir/supabase"
project_config="$project_dir/supabase/config.toml"
base_port=$((40000 + ($$ % 1000) * 10))
python3 - "$base_port" <<'PY'
import socket, sys
base = int(sys.argv[1])
for port in range(base, base + 8):
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            raise SystemExit(f"port {port} is already in use")
PY
sed -i.bak \
  -e "s/^project_id = .*/project_id = \"$project_id\"/" \
  -e "s/^port = 54321$/port = $((base_port + 1))/" \
  -e "s/^port = 54322$/port = $((base_port + 2))/" \
  -e "s/^shadow_port = 54320$/shadow_port = $((base_port + 0))/" \
  -e "s/^port = 54323$/port = $((base_port + 3))/" \
  "$project_config"
rm -f -- "$project_config.bak"

"$supabase_bin" start --workdir "$project_dir" --exclude vector,mailpit --ignore-health-check >/dev/null
started=1

if [[ "$mode" == "fresh" || "$mode" == "both" ]]; then
  "$supabase_bin" db reset --local --no-seed --workdir "$project_dir"
fi
if [[ "$mode" == "upgrade" || "$mode" == "both" ]]; then
  "$supabase_bin" db reset --local --no-seed --version 20260807047000 --workdir "$project_dir"
  "$supabase_bin" migration up --local --workdir "$project_dir"
fi
"$supabase_bin" test db --local --workdir "$project_dir"
echo "isolated database validation passed (${mode})"
