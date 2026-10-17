#!/usr/bin/env sh
# pegana-replay installer with Sigstore attestation verification (ADR-0008).
#
# Default install path. Verifies the GitHub-issued Sigstore attestation
# before placing the binary, so a swapped binary on github.com OR a
# hijacked releases.pegana.xyz CNAME both fail closed.
#
# Usage (the URL is the source of truth — bookmarked install command):
#   curl --proto '=https' --tlsv1.2 -LsSf https://releases.pegana.xyz/install.sh | sh

set -eu

REPO="PeganaHQ/ReplayCLI"
BINARY="pegana-replay"
INSTALL_DIR="${PEGANA_INSTALL_DIR:-$HOME/.pegana/bin}"
VERSION="${PEGANA_REPLAY_VERSION:-latest}"

PLATFORM=""
case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)   PLATFORM="x86_64-unknown-linux-gnu" ;;
    Darwin-x86_64)  PLATFORM="x86_64-apple-darwin" ;;
    Darwin-arm64)   PLATFORM="aarch64-apple-darwin" ;;
    *)
        echo "ERROR: unsupported platform '$(uname -s)-$(uname -m)'." >&2
        echo "Supported: Linux x86_64, macOS x86_64, macOS arm64." >&2
        echo "Windows users: download from https://github.com/$REPO/releases" >&2
        exit 2 ;;
esac

# Resolve version → release tag.
if [ "$VERSION" = "latest" ]; then
    TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | \
        sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
    if [ -z "$TAG" ]; then
        echo "ERROR: could not resolve latest release tag." >&2
        exit 2
    fi
else
    TAG="$VERSION"
fi

# Always pull binaries from github.com directly (NOT through the
# CNAME). The CNAME is only used for the install script itself, so a
# DNS hijack catches the script but the binary check still verifies
# against the canonical github.com URLs.
#
# Archive naming follows cargo-dist convention: package name (NOT
# binary name) prefixes the archive. For us, package = pegana-replay-cli,
# binary inside = pegana-replay.
ARCHIVE="pegana-replay-cli-${PLATFORM}.tar.xz"
BINARY_URL="https://github.com/$REPO/releases/download/$TAG/$ARCHIVE"

TMPDIR=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT INT TERM

cd "$TMPDIR"
echo "-> downloading $ARCHIVE @ $TAG"
curl -fsSL -o "$ARCHIVE" "$BINARY_URL"

# --- Sigstore attestation verification (ADR-0008) ---------------------
#
# Without this, a compromised github.com OR a hijacked releases.pegana.xyz
# CNAME could swap the binary and the trust pitch collapses on install.
# Two verification paths are tried in order — both check the same Sigstore
# certificate chain rooted at GitHub's OIDC identity:
#
#   1. `gh attestation verify` — cheapest if `gh` CLI is on PATH.
#   2. `cosign verify-blob` — downloaded as a standalone ~30MB binary into
#      $TMPDIR when `gh` is missing. We fetch the `.sigstore` bundle from
#      the GitHub release (produced by actions/attest-build-provenance
#      alongside the binary) and verify offline against the bundle.
#
# Install only proceeds if at least one of the two paths confirms the
# attestation. The audit-B-P1 fix removed the previous 5s-sleep + install-
# anyway fallback; a `gh`-less machine no longer collapses the trust pitch.

verify_with_gh() {
    command -v gh >/dev/null 2>&1 || return 1
    echo "-> verifying Sigstore attestation via gh CLI" >&2
    gh attestation verify "$ARCHIVE" --owner lrafasouza --repo pegana >/dev/null 2>&1
}

verify_with_cosign() {
    # Resolve the cosign binary URL for the running platform. Mirrors the
    # platform table at the top of this script.
    COSIGN_PLATFORM=""
    case "$(uname -s)-$(uname -m)" in
        Linux-x86_64)   COSIGN_PLATFORM="linux-amd64" ;;
        Darwin-x86_64)  COSIGN_PLATFORM="darwin-amd64" ;;
        Darwin-arm64)   COSIGN_PLATFORM="darwin-arm64" ;;
        *)              return 1 ;;
    esac
    COSIGN_URL="https://github.com/sigstore/cosign/releases/latest/download/cosign-${COSIGN_PLATFORM}"
    BUNDLE="${ARCHIVE}.sigstore"
    BUNDLE_URL="https://github.com/$REPO/releases/download/$TAG/$BUNDLE"

    echo "-> 'gh' CLI not found; falling back to standalone cosign verify" >&2
    echo "   (this downloads ~30MB of cosign + the .sigstore bundle into a tmpdir)" >&2

    # Download the .sigstore bundle alongside the binary. If the release
    # didn't publish one (older builds, or a workflow misconfig), there's
    # nothing we can verify offline — bail. Operators should re-run on a
    # machine with `gh` or install `gh` first.
    if ! curl -fsSL -o "$BUNDLE" "$BUNDLE_URL"; then
        echo "ERROR: could not fetch Sigstore bundle $BUNDLE from $BUNDLE_URL" >&2
        echo "       The release may pre-date attestation publishing. Install" >&2
        echo "       gh CLI (https://cli.github.com) and re-run for primary-path" >&2
        echo "       verification." >&2
        return 1
    fi

    # Download cosign into the same tmpdir (auto-cleaned by `trap cleanup`).
    if ! curl -fsSL -o cosign "$COSIGN_URL"; then
        echo "ERROR: could not download cosign from $COSIGN_URL" >&2
        return 1
    fi
    chmod +x cosign

    echo "-> verifying Sigstore bundle via cosign" >&2
    # `cosign verify-blob` with `--certificate-identity-regexp` pinned to the
    # canonical GitHub-issued workflow identity (the same OIDC identity the
    # release workflow runs under). `--certificate-oidc-issuer` pins the
    # Sigstore Fulcio CA's expected token issuer to GitHub Actions.
    ./cosign verify-blob \
        --bundle "$BUNDLE" \
        --certificate-identity-regexp "^https://github.com/$REPO/\\.github/workflows/.+@refs/tags/" \
        --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
        "$ARCHIVE" >/dev/null 2>&1
}

if verify_with_gh; then
    echo "-> Sigstore attestation OK (gh CLI)"
elif verify_with_cosign; then
    echo "-> Sigstore attestation OK (cosign fallback)"
else
    echo "ERROR: Sigstore attestation verification FAILED on both paths." >&2
    echo "       Neither 'gh attestation verify' nor 'cosign verify-blob'" >&2
    echo "       could confirm the binary was produced by the official" >&2
    echo "       github.com/$REPO release workflow. Refusing to install." >&2
    echo "" >&2
    echo "Hint: this might be a transient github outage, an attestation" >&2
    echo "      mismatch (rare), or a real attack. Investigate before retrying." >&2
    echo "      Operator-side workarounds:" >&2
    echo "        - install gh CLI (https://cli.github.com) and re-run" >&2
    echo "        - install via Homebrew (signed upstream):" >&2
    echo "            brew install $REPO/$BINARY" >&2
    echo "        - install via cargo (crates.io-signed):" >&2
    echo "            cargo install $BINARY-cli" >&2
    exit 6
fi

# Extract + install.
echo "-> extracting"
tar -xf "$ARCHIVE"

# cargo-dist archives nest the binary inside {package-name}-{target}/
# (e.g. pegana-replay-cli-x86_64-apple-darwin/pegana-replay). Use find
# so we don't have to assume a specific subdirectory layout across
# cargo-dist versions — locate the executable binary by name anywhere
# under the extracted tree, take the first match.
BINARY_PATH=$(find . -name "$BINARY" -type f 2>/dev/null | head -1)
if [ -z "$BINARY_PATH" ] || [ ! -f "$BINARY_PATH" ]; then
    echo "ERROR: binary '$BINARY' not found inside archive '$ARCHIVE'." >&2
    echo "       Archive contents:" >&2
    find . -type f 2>/dev/null | sed 's/^/         /' >&2
    exit 5
fi

mkdir -p "$INSTALL_DIR"
mv "$BINARY_PATH" "$INSTALL_DIR/$BINARY"
chmod +x "$INSTALL_DIR/$BINARY"

echo ""
echo "OK Installed $BINARY @ $TAG -> $INSTALL_DIR/$BINARY"
echo ""
echo "Add to PATH if not already:"
echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
echo ""
echo "Verify: $BINARY --version"
echo "Docs:   https://pegana.xyz/methodology#verify"
