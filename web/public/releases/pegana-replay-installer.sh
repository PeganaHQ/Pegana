#!/bin/sh
# pegana-replay installer · self-versioning
#
# Self-hosted at releases.pegana.xyz/pegana-replay-installer.sh as a thin
# convenience wrapper. The real archives live on GitHub Releases at
# github.com/PeganaHQ/ReplayCLI/releases/download/<TAG>/<asset>.tar.xz
# Anonymous downloads — pegana-replay is public; no token required.
#
# Each archive is cryptographically attested:
#   - SHA-256 verified locally against the archive's <archive>.sha256 file
#   - Sigstore attestation signed by github.com/PeganaHQ/ReplayCLI's
#     OIDC identity (verify post-install with `gh attestation verify`)
#
# The installer fetches the LATEST published pegana-replay release. The CLI's
# verify-identity is the methodology version it EMBEDS (not its release version);
# a receipt whose methodology_version differs from the binary's exits 3
# (VERSION_MISMATCH), so the latest CLI is kept methodology-compatible with the
# live engine. Since v0.4.1 the CLI release version is decoupled from the
# methodology version (the v0.4.1 binary embeds methodology 0.4.0 and adds
# schema-v2 re-derivation). Override with PEGANA_VERSION=<tag> to pin a specific
# release (useful when verifying a receipt from an earlier methodology epoch).

set -eu

REPO="PeganaHQ/ReplayCLI"
INSTALL_DIR="${PEGANA_INSTALL_DIR:-$HOME/.pegana/bin}"

# ── Resolve the CLI release to install (skipped when caller pins PEGANA_VERSION) ──
# Default: the LATEST published pegana-replay release. As of v0.4.1 the CLI
# release version is DECOUPLED from the methodology version (the latest CLI
# embeds a methodology version that verifies current receipts, incl. schema v2),
# so we track the latest release rather than methodology-version-pinning.
# Override with PEGANA_VERSION=<tag> to pin a specific release.
if [ -n "${PEGANA_VERSION:-}" ]; then
  VERSION="$PEGANA_VERSION"
  printf 'Pegana Replay CLI installer (pinned: %s)\n' "$VERSION"
else
  printf 'Pegana Replay CLI installer — resolving latest release...\n'
  _tag=$(curl --proto '=https' --tlsv1.2 -fLsS \
    "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | \
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  if [ -n "$_tag" ]; then
    VERSION="$_tag"
    printf 'Latest release: %s\n' "$VERSION"
  else
    VERSION="v0.4.1"
    printf 'WARNING: could not resolve the latest release (GitHub API unreachable?).\n'
    printf '         Falling back to %s. Set PEGANA_VERSION=<tag> to override.\n' "$VERSION"
  fi
fi

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
red()  { printf '\033[31m%s\033[0m\n' "$*"; }
green(){ printf '\033[32m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }

bold "Pegana Replay CLI installer — $VERSION"
dim  "Source: github.com/$REPO"
dim  "Mirror: releases.pegana.xyz"
echo

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

# Pre-built binaries are published for two targets:
#   - x86_64-unknown-linux-gnu (ubuntu-latest)
#   - aarch64-apple-darwin     (macos-14, Apple Silicon)
# Intel Mac (darwin-x86_64) and Windows are not in the cargo-dist matrix;
# they fall through to a build-from-source instruction.
case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64|aarch64) TARGET="aarch64-apple-darwin" ;;
      x86_64)
        red "Intel Macs aren't shipped as a pre-built binary for $VERSION."
        echo "  Build from source instead (Rust toolchain required):"
        echo "    cargo install --git https://github.com/${REPO} \\"
        echo "      --tag ${VERSION} pegana-replay"
        exit 1 ;;
      *) red "Unsupported macOS arch: $ARCH"; exit 1 ;;
    esac ;;
  Linux)
    case "$ARCH" in
      x86_64|amd64) TARGET="x86_64-unknown-linux-gnu" ;;
      *)
        red "Linux $ARCH isn't shipped as a pre-built binary for $VERSION."
        echo "  Build from source instead (Rust toolchain required):"
        echo "    cargo install --git https://github.com/${REPO} \\"
        echo "      --tag ${VERSION} pegana-replay"
        exit 1 ;;
    esac ;;
  MINGW*|CYGWIN*|MSYS*)
    red "Windows isn't shipped as a pre-built binary for $VERSION."
    echo "  Build from source instead (Rust toolchain required):"
    echo "    cargo install --git https://github.com/${REPO} \\"
    echo "      --tag ${VERSION} pegana-replay"
    exit 1 ;;
  *)
    red "Unsupported OS: $OS"
    exit 1 ;;
esac

# cargo-dist names archives <package>-<target>.tar.xz (package = pegana-replay).
ARCHIVE="pegana-replay-${TARGET}.tar.xz"
BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"

bold "Detected target: $TARGET"

# ── Pre-flight: confirm this release is actually published ────────────────────
if ! curl --proto '=https' --tlsv1.2 -fsI "$BASE_URL/$ARCHIVE" >/dev/null 2>&1; then
  echo
  red "No pre-built release found for CLI ${VERSION} (target: ${TARGET})."
  echo
  echo "  This is expected when the methodology just advanced — the release"
  echo "  binary may not be published yet."
  echo
  bold "  Verify in your browser right now (no install needed):"
  echo "    https://www.pegana.xyz/audit/<ALERT_ID>"
  echo "    → click \"Verify in browser\""
  echo "    (pure-JS, byte-exact reproduction of the same receipt hash)"
  echo
  bold "  Build from source (Rust toolchain required):"
  echo "    cargo install --git https://github.com/${REPO} \\"
  echo "      --tag ${VERSION} pegana-replay"
  echo "    (note: the public mirror must carry tag ${VERSION}; it may lag briefly)"
  echo
  # Best-effort: surface the latest published release so the user can pin it.
  _latest_json=$(curl -fsS \
    'https://api.github.com/repos/'"${REPO}"'/releases/latest' 2>/dev/null || true)
  _latest_tag=$(printf '%s' "$_latest_json" | \
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  if [ -n "$_latest_tag" ]; then
    dim "  Latest published CLI: ${_latest_tag}"
    dim "  To verify a receipt from that methodology epoch, pin it:"
    dim "    PEGANA_VERSION=${_latest_tag} curl -fsSL https://releases.pegana.xyz/pegana-replay-installer.sh | sh"
  fi
  exit 0
fi

# ── Tooling checks ────────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { red "missing required tool: $1"; exit 1; }; }
need curl
need tar
if command -v shasum >/dev/null 2>&1; then HASH_CMD="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then HASH_CMD="sha256sum"
else
  red "no sha256 tool found (need shasum or sha256sum)"; exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

bold "Downloading $ARCHIVE"
curl --proto '=https' --tlsv1.2 -fLsS \
  "$BASE_URL/$ARCHIVE" -o "$ARCHIVE"

bold "Verifying SHA256"
# cargo-dist publishes a per-archive <archive>.sha256 next to each archive.
curl --proto '=https' --tlsv1.2 -fLsS "$BASE_URL/${ARCHIVE}.sha256" -o "${ARCHIVE}.sha256"
EXPECTED=$(awk '{print $1}' "${ARCHIVE}.sha256")
ACTUAL=$($HASH_CMD "$ARCHIVE" | awk '{print $1}')
if [ -z "$EXPECTED" ]; then
  red "could not find expected SHA-256 for $ARCHIVE"
  exit 1
fi
if [ "$EXPECTED" != "$ACTUAL" ]; then
  red "SHA256 mismatch"
  red "  expected: $EXPECTED"
  red "  got:      $ACTUAL"
  exit 1
fi
green "checksum ok ($EXPECTED)"

bold "Extracting"
# tar xf auto-detects xz (both GNU tar and macOS bsdtar).
tar xf "$ARCHIVE"

BIN_NAME="pegana-replay"
BIN_PATH=""
if [ -f "$BIN_NAME" ]; then
  BIN_PATH="$BIN_NAME"
else
  BIN_PATH=$(find . -name "$BIN_NAME" -type f | head -n 1)
fi
if [ -z "$BIN_PATH" ] || [ ! -f "$BIN_PATH" ]; then
  red "could not locate $BIN_NAME inside the archive"
  exit 1
fi

bold "Installing → $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
mv "$BIN_PATH" "$INSTALL_DIR/$BIN_NAME"
chmod +x "$INSTALL_DIR/$BIN_NAME"

green "Installed $BIN_NAME ($VERSION)."
echo
bold "Next steps:"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) echo "  pegana-replay --help" ;;
  *)
    echo "  Add $INSTALL_DIR to PATH (e.g. in ~/.zshrc or ~/.bashrc):"
    echo "    export PATH=\"\$HOME/.pegana/bin:\$PATH\""
    echo
    echo "  Then:"
    echo "    pegana-replay --help"
    ;;
esac
echo
dim "Verify a specific alert (hash + on-chain anchor, both by default):"
dim "  pegana-replay --alert-id <UUID>"
dim "Hash-only, no RPC call (CI / air-gapped):"
dim "  pegana-replay --alert-id <UUID> --offline"
echo
dim "This binary is Sigstore-attested by the repo's CI (GitHub OIDC). Verify:"
dim "  gh attestation verify $INSTALL_DIR/$BIN_NAME --repo PeganaHQ/ReplayCLI"
