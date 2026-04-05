#!/usr/bin/env bash
# Install or update glorious — AI-native development workflow CLI.
#
# Usage (public repo, no auth needed):
#   curl -fsSL https://raw.githubusercontent.com/iceglober/glorious/main/packages/agentic/install.sh | bash
#
# Usage (private repo, requires gh CLI authenticated):
#   bash <(gh api repos/iceglober/glorious/contents/packages/agentic/install.sh --jq .content | base64 -d)
#
# Usage (from local repo clone):
#   bash install.sh
set -euo pipefail

REPO="iceglober/glorious"
TAG_PREFIX="agentic-v"
BINARY_NAME="gs-agentic"
ALIAS_NAME="gsag"
API_BASE="https://api.github.com/repos/${REPO}"

# ── Colors ────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[32m' CYAN='\033[36m' YELLOW='\033[33m' RED='\033[31m' RESET='\033[0m'
else
  GREEN='' CYAN='' YELLOW='' RED='' RESET=''
fi

info()  { echo -e "${CYAN}▸${RESET} $1"; }
ok()    { echo -e "${GREEN}✓${RESET} $1"; }
err()   { echo -e "${RED}error:${RESET} $1" >&2; }
warn()  { echo -e "${YELLOW}warning:${RESET} $1"; }

# ── Prerequisites ─────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  err "Node.js is required but was not found on PATH"
  echo "  Install Node.js 20+ from https://nodejs.org"
  echo "  Or install Bun: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.version.slice(1).split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js 20+ required, found $(node --version)"
  exit 1
fi

if ! command -v curl &>/dev/null; then
  err "curl is required but was not found on PATH"
  exit 1
fi

# ── Find latest release ──────────────────────────────────────────────
info "checking latest version..."

# Try the public GitHub API first (no auth required for public repos)
RELEASE_JSON=""
DOWNLOAD_URL=""

fetch_release_public() {
  local json
  json=$(curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${API_BASE}/releases" 2>/dev/null) || return 1

  RELEASE_JSON=$(echo "$json" | node -e "
    const releases = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
    const r = releases.find(r => r.tag_name && r.tag_name.startsWith('${TAG_PREFIX}'));
    if (!r) process.exit(1);
    console.log(JSON.stringify(r));
  " 2>/dev/null) || return 1

  return 0
}

fetch_release_gh() {
  command -v gh &>/dev/null || return 1
  gh auth status &>/dev/null 2>&1 || return 1
  local json
  json=$(gh api "repos/${REPO}/releases" 2>/dev/null) || return 1

  RELEASE_JSON=$(echo "$json" | node -e "
    const releases = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
    const r = releases.find(r => r.tag_name && r.tag_name.startsWith('${TAG_PREFIX}'));
    if (!r) process.exit(1);
    console.log(JSON.stringify(r));
  " 2>/dev/null) || return 1

  return 0
}

if ! fetch_release_public; then
  info "public API unavailable, trying gh CLI..."
  if ! fetch_release_gh; then
    err "could not fetch release info for ${REPO}"
    echo "  For private repos, authenticate with: gh auth login"
    exit 1
  fi
fi

LATEST_TAG=$(echo "$RELEASE_JSON" | node -e "
  const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
  console.log(r.tag_name || '');
")

if [ -z "$LATEST_TAG" ]; then
  err "no glorious releases found in $REPO"
  echo "  Create a release first: git tag ${TAG_PREFIX}0.3.0 && git push origin --tags"
  exit 1
fi

VERSION="${LATEST_TAG#$TAG_PREFIX}"
info "latest version: ${VERSION}"

# Extract download URL for the binary asset
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | node -e "
  const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
  const asset = (r.assets || []).find(a => a.name === '${BINARY_NAME}');
  console.log(asset ? asset.browser_download_url : '');
")

if [ -z "$DOWNLOAD_URL" ]; then
  err "no asset named '${BINARY_NAME}' found in release ${LATEST_TAG}"
  exit 1
fi

# ── Find install directory ────────────────────────────────────────────
find_install_dir() {
  local existing
  existing=$(command -v "$BINARY_NAME" 2>/dev/null || true)
  if [ -n "$existing" ]; then
    local resolved
    resolved=$(readlink -f "$existing" 2>/dev/null \
      || python3 -c "import os; print(os.path.realpath('$existing'))" 2>/dev/null \
      || echo "$existing")
    echo "$(dirname "$resolved")"
    return
  fi

  for dir in "$HOME/.local/bin" "$HOME/bin"; do
    if [ -d "$dir" ] && echo "$PATH" | tr ':' '\n' | grep -qx "$dir"; then
      echo "$dir"
      return
    fi
  done

  mkdir -p "$HOME/.local/bin"
  echo "$HOME/.local/bin"
}

INSTALL_DIR=$(find_install_dir)
INSTALL_PATH="${INSTALL_DIR}/${BINARY_NAME}"

# ── Download ──────────────────────────────────────────────────────────
info "downloading gs-agentic v${VERSION}..."

TMP_PATH="${INSTALL_PATH}.tmp"

download_public() {
  curl -fsSL -o "$TMP_PATH" "$DOWNLOAD_URL" 2>/dev/null
}

download_gh() {
  command -v gh &>/dev/null || return 1
  gh auth status &>/dev/null 2>&1 || return 1
  gh release download "$LATEST_TAG" -R "$REPO" -p "$BINARY_NAME" -O "$TMP_PATH" --clobber
}

if ! download_public; then
  info "direct download failed, trying gh CLI..."
  if ! download_gh; then
    err "download failed — for private repos, authenticate with: gh auth login"
    exit 1
  fi
fi

chmod +x "$TMP_PATH"
mv "$TMP_PATH" "$INSTALL_PATH"

# Create alias symlink
ALIAS_PATH="${INSTALL_DIR}/${ALIAS_NAME}"
ln -sf "$INSTALL_PATH" "$ALIAS_PATH"
ok "${ALIAS_NAME} → ${BINARY_NAME} (alias)"

ok "gs-agentic ${VERSION} installed at ${INSTALL_PATH}"

# ── PATH check ────────────────────────────────────────────────────────
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  warn "$INSTALL_DIR is not on your PATH"
  echo "  Add this to your shell profile:"
  echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
  echo ""
fi

# ── Verify ────────────────────────────────────────────────────────────
"${INSTALL_PATH}" --version
