#!/usr/bin/env bash
set -euo pipefail

local_site_port="${PLAYWRIGHT_PORT:-3000}"
if ! [[ "$local_site_port" =~ ^[1-9][0-9]{0,4}$ ]] || (( 10#$local_site_port > 65535 )); then
  printf '%s\n' "Local verification requires a valid numeric PLAYWRIGHT_PORT." >&2
  exit 1
fi

case "${NEXT_PUBLIC_SUPABASE_URL:-}" in
  "http://127.0.0.1:54321")
    expected_site_url="http://127.0.0.1:${local_site_port}"
    ;;
  "http://localhost:54321")
    expected_site_url="http://localhost:${local_site_port}"
    ;;
  "http://[::1]:54321")
    expected_site_url="http://[::1]:${local_site_port}"
    ;;
  *)
    printf '%s\n' "Refusing to start a local test against a non-loopback Supabase URL." >&2
    exit 1
    ;;
esac

if [[ "${NEXT_PUBLIC_SITE_URL:-}" != "$expected_site_url" ]]; then
  printf '%s\n' "Local verification requires a matching local site URL." >&2
  exit 1
fi

for local_key in NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  case "${!local_key:-}" in
    ""|missing|placeholder|changeme|example|test)
      printf '%s\n' "Local verification requires local Supabase keys." >&2
      exit 1
      ;;
  esac
done

jwt_identity() {
  local expected_role="$1"
  EXPECTED_JWT_ROLE="$expected_role" node -e '
    const value = require("node:fs").readFileSync(0, "utf8");
    const parts = value.split(".");
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) process.exit(1);
    try {
      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (header.alg !== "HS256" || header.typ !== "JWT" || payload.role !== process.env.EXPECTED_JWT_ROLE) process.exit(1);
      if (typeof payload.ref === "string" && /^[A-Za-z0-9_-]+$/.test(payload.ref)) {
        process.stdout.write(`ref:${payload.ref}`);
        process.exit(0);
      }
      const now = Math.floor(Date.now() / 1_000);
      if (payload.iss !== "supabase-demo" || !Number.isSafeInteger(payload.exp) || payload.exp <= now) process.exit(1);
      process.stdout.write("local:supabase-demo");
    } catch {
      process.exit(1);
    }
  '
}

if ! anon_identity="$(printf '%s' "$NEXT_PUBLIC_SUPABASE_ANON_KEY" | jwt_identity anon)"; then
  printf '%s\n' "Local verification requires valid local Supabase keys." >&2
  exit 1
fi
if ! service_identity="$(printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | jwt_identity service_role)"; then
  printf '%s\n' "Local verification requires valid local Supabase keys." >&2
  exit 1
fi
if [[ "$anon_identity" != "$service_identity" ]]; then
  printf '%s\n' "Local verification requires keys from the same local Supabase stack." >&2
  exit 1
fi

if ! printf '%s' "${APP_ENCRYPTION_KEY:-}" | node -e '
  const value = require("node:fs").readFileSync(0, "utf8");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) process.exit(1);
'; then
  printf '%s\n' "Local verification requires a base64-encoded 32-byte APP_ENCRYPTION_KEY." >&2
  exit 1
fi

checked_out_sha="$(git rev-parse HEAD)"
if [[ "${COMPLIANCEHUB_RELEASE_SHA:-}" != "$checked_out_sha" ]]; then
  printf '%s\n' "COMPLIANCEHUB_RELEASE_SHA must match the checked-out source before local verification." >&2
  exit 1
fi

printf '%s\n' "Local runtime preflight passed: loopback database target and current release source confirmed."
