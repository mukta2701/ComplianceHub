#!/usr/bin/env bash
set -euo pipefail

port="${1:?Usage: $0 <port>}"
standalone_dir=".next/standalone"

test -f "$standalone_dir/server.js"
test -d ".next/static"

# Next's standalone server intentionally excludes static assets and public files.
# Copy them into the traced runtime so production E2E exercises the same browser
# bundle and asset paths that the deployed container serves.
mkdir -p "$standalone_dir/.next"
rm -rf "$standalone_dir/.next/static"
cp -R ".next/static" "$standalone_dir/.next/static"
if [[ -d public ]]; then
  rm -rf "$standalone_dir/public"
  cp -R public "$standalone_dir/public"
fi

exec env PORT="$port" HOSTNAME=127.0.0.1 node "$standalone_dir/server.js"
