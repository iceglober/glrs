#!/usr/bin/env bash
# scripts/verdaccio-smoke.sh
#
# End-to-end publish smoke test. Spins up a local verdaccio registry, publishes
# the TS packages to it EXACTLY as the release workflow does (workspace:* refs
# stripped via prepare-publish), then — in a clean sandbox with its own
# node_modules — installs the published packages and:
#
#   1. imports @glrs-dev/harness-plugin-opencode and asserts the plugin loads
#      (its default export is the plugin factory function). This reproduces how
#      opencode loads the plugin and would have caught the 3.3.0/3.3.1 regression
#      where dist/index.js runtime-imported uninstalled externals
#      (@opencode-ai/plugin, zod) and failed with "Cannot find module".
#   2. asserts the installed manifest carries no `workspace:` specifier (the
#      agent-core: workspace:* leak that broke opencode's plugin-cache install).
#   3. installs @glrs-dev/cli and runs `glrs --help` end-to-end.
#
# Self-contained: no real npm auth, only an npmjs uplink for third-party deps.
# Safe to run locally: `bash scripts/verdaccio-smoke.sh`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${VERDACCIO_PORT:-4873}"
REG="http://localhost:${PORT}/"
WORK="$(mktemp -d)"
CLI_SCRIPTS="$ROOT/packages/cli/scripts"
PKG_PATHS=("packages/cli" "packages/harness-opencode")

VERDACCIO_PID=""
log() { echo "[verdaccio-smoke] $*"; }

cleanup() {
  local code=$?
  for p in "${PKG_PATHS[@]}"; do
    if [[ -f "$ROOT/$p/package.json.publish-backup" ]]; then
      bun "$CLI_SCRIPTS/restore-publish.ts" --pkg-path "$ROOT/$p/package.json" >/dev/null 2>&1 || true
    fi
  done
  [[ -n "$VERDACCIO_PID" ]] && kill "$VERDACCIO_PID" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit $code
}
trap cleanup EXIT

# ---- 1. verdaccio config ----
cat > "$WORK/config.yaml" <<EOF
storage: $WORK/storage
auth:
  htpasswd:
    file: $WORK/htpasswd
    max_users: 1000
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    cache: false
packages:
  '@glrs-dev/*':
    access: \$all
    publish: \$authenticated
  '**':
    access: \$all
    publish: \$authenticated
    proxy: npmjs
log: { type: stdout, format: pretty, level: warn }
EOF

# ---- 2. start verdaccio ----
log "starting verdaccio on :$PORT"
npx --yes verdaccio@6 --config "$WORK/config.yaml" --listen "$PORT" >"$WORK/verdaccio.log" 2>&1 &
VERDACCIO_PID=$!
for i in $(seq 1 60); do
  curl -sf "$REG" >/dev/null 2>&1 && break
  [[ $i -eq 60 ]] && { log "verdaccio did not start; log:"; cat "$WORK/verdaccio.log"; exit 1; }
  sleep 0.5
done
log "verdaccio up"

# ---- 3. register a publish user, capture a token ----
TOKEN="$(curl -s -X PUT "${REG}-/user/org.couchdb.user:smoke" \
  -H 'Content-Type: application/json' \
  -d '{"name":"smoke","password":"smoke-pass"}' \
  | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
[[ -z "$TOKEN" ]] && { log "failed to obtain verdaccio token"; cat "$WORK/verdaccio.log"; exit 1; }

NPMRC="$WORK/.npmrc"
printf 'registry=%s\n//localhost:%s/:_authToken=%s\n' "$REG" "$PORT" "$TOKEN" > "$NPMRC"

# ---- 4. build, then publish each package as release does (strip workspace:*) ----
log "building packages"
bun run --cwd "$ROOT/packages/cli" build >"$WORK/build.log" 2>&1 \
  || { log "build failed"; tail -30 "$WORK/build.log"; exit 1; }

for p in "${PKG_PATHS[@]}"; do
  log "prepare-publish + publish $p"
  bun "$CLI_SCRIPTS/prepare-publish.ts" --pkg-path "$ROOT/$p/package.json" >/dev/null
  # Drop publishConfig.provenance: packages enable it for the real release (GitHub
  # OIDC), but provenance can't be generated against verdaccio. prepare-publish's
  # backup restores the original manifest (provenance included) afterward.
  ( cd "$ROOT/$p" && npm pkg delete publishConfig.provenance >/dev/null 2>&1 || true )
  ( cd "$ROOT/$p" && npm publish --userconfig "$NPMRC" --registry "$REG" >>"$WORK/publish.log" 2>&1 ) \
    || { log "publish $p failed"; tail -40 "$WORK/publish.log"; exit 1; }
  bun "$CLI_SCRIPTS/restore-publish.ts" --pkg-path "$ROOT/$p/package.json" >/dev/null
done
log "published to verdaccio"

# ---- 5. clean sandbox: install + load the plugin the way opencode would ----
SBX="$WORK/sandbox"
mkdir -p "$SBX"
cp "$NPMRC" "$SBX/.npmrc"
echo '{"name":"smoke-sandbox","private":true,"type":"module"}' > "$SBX/package.json"

log "installing @glrs-dev/harness-plugin-opencode from verdaccio"
( cd "$SBX" && npm install @glrs-dev/harness-plugin-opencode --registry "$REG" >"$WORK/install-harness.log" 2>&1 ) \
  || { log "harness install failed"; tail -40 "$WORK/install-harness.log"; exit 1; }

INSTALLED="$SBX/node_modules/@glrs-dev/harness-plugin-opencode"

log "asserting installed manifest has no workspace: specifier"
if grep -q '"workspace:' "$INSTALLED/package.json" 2>/dev/null; then
  log "FAIL: published harness-opencode manifest still contains a workspace: dep"
  grep '"workspace:' "$INSTALLED/package.json"
  exit 1
fi

# Load the plugin in ISOLATION — no node_modules anywhere up the tree. This is
# the faithful reproduction of opencode's failure mode: it loads dist/index.js
# from a plugin-cache dir whose dep-install produced nothing, so any third-party
# runtime import (the @opencode-ai/plugin + zod regression) must resolve from the
# bundle alone. Loading from the sandbox would mask it — npm installs the prod
# dep (zod) and auto-installs the peer (@opencode-ai/plugin) there.
ISO="$WORK/isolated"
mkdir -p "$ISO"
( cd "$ISO" && npm pack @glrs-dev/harness-plugin-opencode --registry "$REG" --userconfig "$NPMRC" >/dev/null 2>&1 ) \
  || { log "npm pack failed"; exit 1; }
tar -xzf "$ISO"/*.tgz -C "$ISO"   # → $ISO/package/dist/index.js, no node_modules
log "loading the plugin entry in isolation (no node_modules — mimics opencode's empty plugin cache)"
node --input-type=module -e "
  import('file://$ISO/package/dist/index.js')
    .then((m) => {
      if (typeof m.default !== 'function') {
        console.error('FAIL: default export is ' + typeof m.default + ' (expected function)');
        process.exit(1);
      }
      console.log('[verdaccio-smoke] plugin loaded in isolation — default export is a function');
    })
    .catch((e) => { console.error('FAIL: plugin failed to load: ' + e.message); process.exit(1); });
"

log "installing @glrs-dev/cli and running glrs --help"
( cd "$SBX" && npm install @glrs-dev/cli --registry "$REG" >"$WORK/install-cli.log" 2>&1 ) \
  || { log "cli install failed"; tail -40 "$WORK/install-cli.log"; exit 1; }
( cd "$SBX" && GLRS_AUTO_UPDATE=0 ./node_modules/.bin/glrs --help >"$WORK/cli-help.log" 2>&1 ) \
  || { log "glrs --help failed"; tail -20 "$WORK/cli-help.log"; exit 1; }
grep -qi "harness" "$WORK/cli-help.log" || { log "FAIL: glrs --help output unexpected"; cat "$WORK/cli-help.log"; exit 1; }

log "PASS — published packages install and the harness plugin loads."
