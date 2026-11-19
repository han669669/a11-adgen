#!/usr/bin/env bash
# Web app rollback: put back the index.html that scripts/upload_app.sh saved before its upload.
# The old hashed files stay in R2 app/assets/, so the page is the only file to upload.
#
#   ROLLBACK           the folder upload_app.sh printed (it holds index.html). Required.
#   BASE               the target origin (default: the live Worker)
#   A11_ADMIN_TOKEN    the token, for a run with no terminal. Without it, the script asks and does not show it.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE:-https://a11adgen.gamingcomputing.workers.dev}"
PAGE="${ROLLBACK:?Set ROLLBACK to the folder that upload_app.sh printed}/index.html"
[ -s "$PAGE" ] || { echo "No $PAGE"; exit 1; }

if [ -z "${A11_ADMIN_TOKEN:-}" ]; then read -rsp "Admin token (not shown): " A11_ADMIN_TOKEN || true; echo; fi
[ -n "${A11_ADMIN_TOKEN:-}" ] || { echo "No admin token."; exit 1; }
sha() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi | cut -c1-64; }

for a in $(grep -oE '(src|href)="/assets/[A-Za-z0-9._-]+"' "$PAGE" | sed -E 's|.*"/(assets/[^"]+)"|\1|' | sort -u); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/$a")
  [ "$code" = 200 ] || { echo "The saved page names $a, which is not live ($code). Nothing was uploaded."; exit 1; }
done
printf 'Authorization: Bearer %s' "$A11_ADMIN_TOKEN" | curl -fsS -o /dev/null -X PUT -H @- -T "$PAGE" "$BASE/admin/app/index.html"
[ "$(curl -fsS "$BASE/" | sha)" = "$(sha <"$PAGE")" ] || { echo "Live / is not the saved page."; exit 1; }
echo "Rolled back: live / is $PAGE"
