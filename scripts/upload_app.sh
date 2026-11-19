#!/usr/bin/env bash
# Web app upload (docs/deploy.md, step 5): each file of dist/app to PUT /admin/app/<path>, index.html last.
# Run it after `npm run build:app` on a clean checkout of main. It needs bash, git and curl 7.55 or later.
#
# The admin token: the script asks for it and does not show it. It is not printed, not saved and not put on a
# command line (curl reads the header from a pipe). Do not run this script with `bash -x`.
#
#   DRY_RUN=1          all checks, the rollback copy and the token check, but no upload
#   BASE               the target origin (default: the live Worker)
#   DIST               the built app (default: dist/app)
#   ROLLBACK           where the copy of the live index.html goes (default: rollback-app/<UTC time>)
#   A11_ADMIN_TOKEN    the token, for a run with no terminal
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE:-https://a11adgen.gamingcomputing.workers.dev}"
DIST="${DIST:-dist/app}"
ROLLBACK="${ROLLBACK:-rollback-app/$(date -u +%Y%m%dT%H%M%SZ)}"
MAX_BYTES=3000000 # STAGE_MAX_BYTES in worker/index.ts

if [ -z "${A11_ADMIN_TOKEN:-}" ]; then read -rsp "Admin token (not shown): " A11_ADMIN_TOKEN || true; echo; fi
[ -n "${A11_ADMIN_TOKEN:-}" ] || { echo "No admin token."; exit 1; }
auth() { printf 'Authorization: Bearer %s' "$A11_ADMIN_TOKEN"; }
sha() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi | cut -c1-64; }
size() { echo $(($(wc -c <"$1"))); }
# The files a page loads from assets/.
assets() { grep -oE '(src|href)="/assets/[A-Za-z0-9._-]+"' | sed -E 's|.*"/(assets/[^"]+)"|\1|' | sort -u; }

# 1. Local checks. Nothing is sent before each file passes the rules of the route.
[ -f "$DIST/index.html" ] || { echo "No $DIST/index.html. Run: npm run build:app"; exit 1; }
FILES=()
while IFS= read -r f; do FILES+=("$f"); done < <(cd "$DIST" && find . -type f ! -path ./index.html | sed 's|^\./||' | sort)
FILES+=(index.html)
for f in "${FILES[@]}"; do
  [[ "$f" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$ && "$f" != *..* ]] || { echo "The route refuses this name: $f"; exit 1; }
  [[ "$f" =~ \.(html|js|css|svg|png|jpg|ico|woff2|json)$ ]] || { echo "The Worker has no content type for: $f"; exit 1; }
  [ "$(size "$DIST/$f")" -le "$MAX_BYTES" ] || { echo "Over the $MAX_BYTES byte limit: $f"; exit 1; }
done
for a in $(assets <"$DIST/index.html"); do
  [ -f "$DIST/$a" ] || { echo "index.html names a file that is not in the build: $a"; exit 1; }
done
echo "Target: $BASE"
echo "Commit: $(git rev-parse HEAD 2>/dev/null || echo "not a git checkout") ($(git status --porcelain 2>/dev/null | grep -q . && echo "with local changes" || echo "clean"))"
echo "Build:"
for f in "${FILES[@]}"; do echo "  $(sha <"$DIST/$f")  $f"; done

# 2. Rollback copy. R2 keeps no old versions, so this is the only copy of the page that is live now.
mkdir -p "$ROLLBACK"
curl -fsS "$BASE/" -o "$ROLLBACK/index.html"
echo "Rollback copy: $ROLLBACK/index.html"
for a in $(assets <"$ROLLBACK/index.html"); do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/$a")
  echo "  live now: $a ($code)"
  [ "$code" = 200 ] || { echo "The live page names a file that is not live. Stop."; exit 1; }
done

# 3. Token check that writes nothing (AGENTS.md, section 7): a bad name gives 400 with a valid token, 401 without.
code=$(auth | curl -sS -o /dev/null -w '%{http_code}' -X PUT -H @- -H 'Content-Length: 0' "$BASE/admin/stage/BAD%20NAME")
[ "$code" = 400 ] || { echo "Token check: HTTP $code (400 = valid token, 401 = wrong token). Nothing was uploaded."; exit 1; }
echo "Token check: 400 (valid token, nothing written)"

if [ "${DRY_RUN:-0}" = 1 ]; then echo "DRY_RUN=1: stop before the upload."; exit 0; fi

# 4. Upload, index.html last. Each file is read back from the site and compared before the next one goes.
for f in "${FILES[@]}"; do
  answer=$(auth | curl -fsS -X PUT -H @- -T "$DIST/$f" "$BASE/admin/app/$f")
  [ "$answer" = "{\"key\":\"app/$f\",\"bytes\":$(size "$DIST/$f")}" ] || { echo "Unexpected answer for $f: $answer"; exit 1; }
  [ "$(curl -fsS "$BASE/$f" | sha)" = "$(sha <"$DIST/$f")" ] || { echo "The site does not give back the same $f. Stop."; exit 1; }
  echo "  uploaded and read back: $f"
done

# 5. Proof: the live page is the page of this build, byte for byte.
[ "$(curl -fsS "$BASE/" | sha)" = "$(sha <"$DIST/index.html")" ] || { echo "Live / is not the index.html of this build."; exit 1; }
echo "Live page now names: $(curl -fsS "$BASE/" | assets | tr '\n' ' ')"
echo "Done. To roll back: ROLLBACK=$ROLLBACK scripts/rollback_app.sh"
