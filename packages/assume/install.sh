#!/usr/bin/env bash
# Install or update glorious-assume (gs-assume / gsa) — unified cloud credential manager.
#
# Usage (public repo):
#   curl -fsSL https://raw.githubusercontent.com/iceglober/glorious/main/packages/assume/install.sh | bash
#
# Usage (private repo, requires gh CLI):
#   bash <(gh api repos/iceglober/glorious/contents/packages/assume/install.sh --jq .content | base64 -d)
#
# Usage (from local clone):
#   bash install.sh
set -euo pipefail

REPO="iceglober/glorious"
TAG_PREFIX="assume-v"
BINARY_NAME="gs-assume"
ALIAS_NAME="gsa"
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
if ! command -v curl &>/dev/null; then
  err "curl is required but was not found on PATH"
  exit 1
fi

if ! command -v python3 &>/dev/null; then
  err "python3 is required but was not found on PATH"
  exit 1
fi

# ── Detect platform ──────────────────────────────────────────────────
detect_platform() {
  local os arch
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)

  case "$os" in
    darwin) os="darwin" ;;
    linux)  os="linux" ;;
    *)      err "unsupported OS: $os"; exit 1 ;;
  esac

  case "$arch" in
    x86_64|amd64)   arch="amd64" ;;
    aarch64|arm64)   arch="arm64" ;;
    *)               err "unsupported architecture: $arch"; exit 1 ;;
  esac

  echo "${os}-${arch}"
}

PLATFORM=$(detect_platform)
ASSET_NAME="${BINARY_NAME}-${PLATFORM}"
info "detected platform: ${PLATFORM}"

# ── Find latest release ──────────────────────────────────────────────
info "checking latest version..."

RELEASE_JSON=""

fetch_release_public() {
  # We need to find the latest release with our tag prefix, not just the latest overall
  local json
  json=$(curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${API_BASE}/releases" 2>/dev/null) || return 1

  # Find the first release whose tag starts with our prefix
  RELEASE_JSON=$(echo "$json" | python3 -c "
import sys, json
releases = json.load(sys.stdin)
for r in releases:
    if r.get('tag_name','').startswith('${TAG_PREFIX}'):
        json.dump(r, sys.stdout)
        sys.exit(0)
sys.exit(1)
" 2>/dev/null) || return 1

  return 0
}

fetch_release_gh() {
  command -v gh &>/dev/null || return 1
  gh auth status &>/dev/null 2>&1 || return 1
  local json
  json=$(gh api "repos/${REPO}/releases" 2>/dev/null) || return 1

  RELEASE_JSON=$(echo "$json" | python3 -c "
import sys, json
releases = json.load(sys.stdin)
for r in releases:
    if r.get('tag_name','').startswith('${TAG_PREFIX}'):
        json.dump(r, sys.stdout)
        sys.exit(0)
sys.exit(1)
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

LATEST_TAG=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print(r.get('tag_name', ''))
")

if [ -z "$LATEST_TAG" ]; then
  err "no glorious-assume releases found in $REPO"
  echo "  Create a release first or check that ${TAG_PREFIX}* tags exist"
  exit 1
fi

VERSION="${LATEST_TAG#$TAG_PREFIX}"
info "latest version: ${VERSION}"

# Extract download URL for the platform-specific binary
DOWNLOAD_URL=$(echo "$RELEASE_JSON" | python3 -c "
import sys, json
r = json.load(sys.stdin)
for a in r.get('assets', []):
    if a['name'] == '${ASSET_NAME}':
        print(a['browser_download_url'])
        sys.exit(0)
print('')
")

if [ -z "$DOWNLOAD_URL" ]; then
  err "no asset '${ASSET_NAME}' found in release ${LATEST_TAG}"
  echo "  Available platforms may differ — check the release page"
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
ALIAS_PATH="${INSTALL_DIR}/${ALIAS_NAME}"

# ── Download ──────────────────────────────────────────────────────────
info "downloading ${BINARY_NAME} v${VERSION} for ${PLATFORM}..."

TMP_PATH="${INSTALL_PATH}.tmp"

download_public() {
  curl -fsSL -o "$TMP_PATH" "$DOWNLOAD_URL" 2>/dev/null
}

download_gh() {
  command -v gh &>/dev/null || return 1
  gh auth status &>/dev/null 2>&1 || return 1
  gh release download "$LATEST_TAG" -R "$REPO" -p "$ASSET_NAME" -O "$TMP_PATH" --clobber
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
ln -sf "$INSTALL_PATH" "$ALIAS_PATH"

ok "${BINARY_NAME} ${VERSION} installed at ${INSTALL_PATH}"
ok "${ALIAS_NAME} → ${BINARY_NAME} (alias)"

# ── PATH check ────────────────────────────────────────────────────────
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  warn "$INSTALL_DIR is not on your PATH"
  echo "  Add this to your shell profile:"
  echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
  echo ""
fi

# ── Setup: shell integration + daemon ─────────────────────────────────
info "running setup (shell integration + daemon)..."
"${INSTALL_PATH}" serve --install

echo ""
ok "done! restart your shell or run: source ~/.zshrc"
