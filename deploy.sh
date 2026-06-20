#!/usr/bin/env bash
set -eu

# ─── galdr deploy script ───────────────────────────────────────────────
# Usage:  ./deploy.sh [new_version]
# Example: ./deploy.sh 0.2.0
#
# Works on: Windows (Git Bash/MSYS2), Linux, macOS
# Does:
#   1. Bumps version in package.json, tauri.conf.json, Cargo.toml
#   2. Downloads platform-appropriate FFmpeg/FFprobe static binaries
#   3. Builds the Tauri app
#   4. Creates the compressed archive needed for updater signing
#   5. Signs the archive and generates update.json
# ─────────────────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── Load .env for signing credentials ────────────────────────────────
if [ -f src-tauri/.env ]; then
  set +u
  export $(grep -v '^#' src-tauri/.env | xargs)
  set -u
  echo "✓ Loaded .env"
fi

KEY_PATH="${UPDATER_PRIVATE_KEY_PATH:-src-tauri/updater.key}"
if [ ! -f "$KEY_PATH" ]; then
  echo "! Private key not found at $KEY_PATH" >&2
  exit 1
fi

# ── Version ──────────────────────────────────────────────────────────
CURRENT_VERSION="$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')"
VERSION="${1:-$CURRENT_VERSION}"

if [ "$VERSION" != "$CURRENT_VERSION" ]; then
  echo "⟳ Bumping version $CURRENT_VERSION → $VERSION"
  sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$VERSION\"/" package.json
  sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
  sed -i.bak "s/^version = \"$CURRENT_VERSION\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
  rm -f package.json.bak src-tauri/tauri.conf.json.bak src-tauri/Cargo.toml.bak
else
  echo "✓ Version: $VERSION"
fi

# Confirm version actually changed in the files
CONFIRMED="$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')"
echo "  (tauri.conf.json version: $CONFIRMED)"

# Remove stale NSIS installers from prior runs so the new build can't be confused
rm -f src-tauri/target/release/bundle/nsis/*.exe
rm -f src-tauri/target/release/bundle/nsis/*.exe.zip

# ── Platform detection ──────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)
    PLATFORM="linux"
    BIN_EXT=""
    UPDATE_KEY="${ARCH}-linux"
    [ "$ARCH" = "x86_64" ] && UPDATE_KEY="linux-x86_64"
    [ "$ARCH" = "aarch64" ] && UPDATE_KEY="linux-aarch64"
    ;;
  Darwin)
    PLATFORM="macos"
    BIN_EXT=""
    [ "$ARCH" = "arm64" ] && UPDATE_KEY="darwin-aarch64" || UPDATE_KEY="darwin-x86_64"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    PLATFORM="windows"
    BIN_EXT=".exe"
    UPDATE_KEY="windows-x86_64"
    ;;
  *)
    echo "Unsupported OS: $OS"; exit 1 ;;
esac

echo "⟳ Platform: $PLATFORM ($ARCH)"

# ── FFmpeg binary URLs ──────────────────────────────────────────────
case "$PLATFORM" in
  windows)
    FFMPEG_URL="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    EXTRACT_WIN() { unzip -j "$1" "*/bin/ffmpeg.exe"   -d "$2"; unzip -j "$1" "*/bin/ffprobe.exe"  -d "$2"; }
    ;;
  linux)
    case "$ARCH" in
      x86_64)  FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz" ;;
      aarch64) FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz" ;;
    esac
    EXTRACT_LINUX() {
      tar xf "$1" -C "$2"
      find "$2" -name "ffmpeg"  -type f -exec cp {} "$3/ffmpeg"  \;
      find "$2" -name "ffprobe" -type f -exec cp {} "$3/ffprobe" \;
      chmod +x "$3/ffmpeg" "$3/ffprobe"
    }
    ;;
  macos)
    FFMPEG_URL="https://evermeet.cx/ffmpeg/ffmpeg-7.1.zip"
    FFPROBE_URL="https://evermeet.cx/ffprobe/ffprobe-7.1.zip"
    EXTRACT_MAC() {
      unzip -j "$1" -d "$3"
      unzip -j "$2" -d "$3"
      chmod +x "$3/ffmpeg" "$3/ffprobe"
    }
    ;;
esac

# ── Download FFmpeg binaries if missing ─────────────────────────────
BIN_DIR="src-tauri/binaries"
mkdir -p "$BIN_DIR"

if [ ! -f "$BIN_DIR/ffmpeg${BIN_EXT}" ]; then
  echo "⟳ Downloading FFmpeg for $PLATFORM ..."
  TMPDIR="$(mktemp -d)"
  case "$PLATFORM" in
    windows)
      curl -fsSL "$FFMPEG_URL" -o "$TMPDIR/ffmpeg.zip"
      EXTRACT_WIN "$TMPDIR/ffmpeg.zip" "$BIN_DIR"
      ;;
    linux)
      curl -fsSL "$FFMPEG_URL" -o "$TMPDIR/ffmpeg.tar.xz"
      EXTRACT_LINUX "$TMPDIR/ffmpeg.tar.xz" "$TMPDIR/extracted" "$BIN_DIR"
      ;;
    macos)
      curl -fsSL "$FFMPEG_URL"   -o "$TMPDIR/ffmpeg.zip"
      curl -fsSL "$FFPROBE_URL"  -o "$TMPDIR/ffprobe.zip"
      EXTRACT_MAC "$TMPDIR/ffmpeg.zip" "$TMPDIR/ffprobe.zip" "$BIN_DIR"
      ;;
  esac
  rm -rf "$TMPDIR"
  echo "   → $BIN_DIR/ffmpeg${BIN_EXT}"
else
  echo "✓ FFmpeg binaries present"
fi

# ── Generate installer skin assets ──────────────────────────
echo "⟳ Generating nsNiuniuSkin installer assets ..."
if command -v python3 &>/dev/null; then
  PY=python3
else
  PY=python
fi
(cd "$ROOT/src-tauri/windows/nsniuniuskin" && $PY generate-assets.py && $PY generate-skin-zip.py)

# ── Build ───────────────────────────────────────────────────────────
echo "⟳ Building galdr v$VERSION ..."
bun install
bun tauri build
echo "✓ Build complete."

# ── Locate artifacts & create archive ─────────────────────────────────
echo "  Checking for artifacts in src-tauri/target/release/bundle/nsis/ ..."
ls -la src-tauri/target/release/bundle/nsis/ 2>/dev/null || echo "  (no nsis dir yet)"
case "$PLATFORM" in
  windows)
    BUNDLE_DIR="src-tauri/target/release/bundle/nsis"
    INSTALLER=""
    for f in "$BUNDLE_DIR"/*.exe; do
      [ -f "$f" ] && INSTALLER="$f" && break
    done
    if [ -z "$INSTALLER" ]; then
      echo "! No .exe found in $BUNDLE_DIR/ — check build output."
      exit 1
    fi
    ARCHIVE="${INSTALLER}.zip"
    echo "⟳ Creating $ARCHIVE ..."
    rm -f "$ARCHIVE"
    $PY -c "
import zipfile, os, sys
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as zf:
    zf.write(sys.argv[2], os.path.basename(sys.argv[2]))
" "$ARCHIVE" "$INSTALLER"
    ;;
  linux)
    BUNDLE_DIR="src-tauri/target/release/bundle/appimage"
    INSTALLER=""
    for f in "$BUNDLE_DIR"/*.AppImage; do
      [ -f "$f" ] && INSTALLER="$f" && break
    done
    if [ -z "$INSTALLER" ]; then
      BUNDLE_DIR="src-tauri/target/release/bundle/deb"
      for f in "$BUNDLE_DIR"/*.deb; do
        [ -f "$f" ] && INSTALLER="$f" && break
      done
    fi
    if [ -z "$INSTALLER" ]; then
      echo "! No installer found in appimage/ or deb/ — check build output."
      exit 1
    fi
    ARCHIVE="${INSTALLER}.tar.gz"
    echo "⟳ Creating $ARCHIVE ..."
    rm -f "$ARCHIVE"
    tar czf "$ARCHIVE" -C "$(dirname "$INSTALLER")" "$(basename "$INSTALLER")"
    ;;
  macos)
    BUNDLE_DIR="src-tauri/target/release/bundle/dmg"
    INSTALLER=""
    for f in "$BUNDLE_DIR"/*.dmg; do
      [ -f "$f" ] && INSTALLER="$f" && break
    done
    if [ -z "$INSTALLER" ]; then
      BUNDLE_DIR="src-tauri/target/release/bundle/macos"
      for f in "$BUNDLE_DIR"/*.app.tar.gz; do
        [ -f "$f" ] && INSTALLER="$f" && break
      done
      if [ -n "$INSTALLER" ]; then
        ARCHIVE="$INSTALLER"
        echo "  (already compressed: $(basename "$ARCHIVE"))"
      fi
    else
      ARCHIVE="${INSTALLER}.gz"
      echo "⟳ Creating $ARCHIVE ..."
      rm -f "$ARCHIVE"
      gzip -c "$INSTALLER" > "$ARCHIVE"
    fi
    if [ -z "${INSTALLER:-}" ]; then
      echo "! No .dmg or .app.tar.gz found — check build output."
      exit 1
    fi
    ;;
esac

if [ -z "${INSTALLER:-}" ] || [ ! -f "$INSTALLER" ]; then
  echo "! No build artifact found in $BUNDLE_DIR"
  echo "  Check src-tauri/target/release/bundle/ manually."
  exit 1
fi

echo "  Installer: $INSTALLER"
echo "  Archive:   $ARCHIVE"

# Verify archive exists
if [ -f "$ARCHIVE" ]; then
  echo "✓ Archive created: $(du -h "$ARCHIVE" | cut -f1)"
else
  echo "! Archive NOT created at $ARCHIVE"
  echo "  Retrying with Python zipfile..."
  $PY -c "
import zipfile, os, sys
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as zf:
    zf.write(sys.argv[2], os.path.basename(sys.argv[2]))
" "$ARCHIVE" "$INSTALLER"
  if [ -f "$ARCHIVE" ]; then
    echo "✓ Created successfully."
  else
    echo "! Still failed. Run this manually after the script:"
    echo "  $PY -c \"import zipfile,os,sys; zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED).write(sys.argv[2],os.path.basename(sys.argv[2]))\" \"$ARCHIVE\" \"$INSTALLER\""
  fi
fi

# ── Sign ────────────────────────────────────────────────────────────
echo ""
echo "⟳ Signing archive..."
SIGNATURE=""
if command -v bun &>/dev/null; then
  SIGNATURE="$(bun x tauri signer sign --private-key-path "$KEY_PATH" "$ARCHIVE" 2>&1 || true)"
fi
if [ -z "$SIGNATURE" ] || ! echo "$SIGNATURE" | grep -qE '^(dW50cn|RW)'; then
  SIGNATURE="$(bun run tauri signer sign --private-key-path "$KEY_PATH" "$ARCHIVE" 2>&1 || true)"
fi

# Extract just the signature line (starts with dW50cn... or RW...)
SIGNATURE="$(echo "$SIGNATURE" | tr -d '\r' | grep -E '^(dW50cn|RW)' | head -1 | xargs)"

if [ -z "$SIGNATURE" ]; then
  echo "! Failed to extract signature from output:" >&2
  echo "$SIGNATURE" >&2
  exit 1
fi
echo "✓ Signature captured"

# Verify signature was for the correct file
ARCHIVE_NAME="$(basename "$ARCHIVE")"
SIG_DECODED="$(python3 -c "import base64,sys; print(base64.b64decode(sys.argv[1]).decode())" "$SIGNATURE" 2>/dev/null || \
               python -c "import base64,sys; print(base64.b64decode(sys.argv[1]).decode())" "$SIGNATURE" 2>/dev/null || true)"
SIGNED_FILE="$(echo "$SIG_DECODED" | sed -n 's/.*file:\(.*\)/\1/p')"
if [ -z "$SIGNED_FILE" ]; then
  echo "! Could not read filename from signature trusted comment" >&2
  exit 1
fi
if [ "$SIGNED_FILE" != "$ARCHIVE_NAME" ]; then
  echo "! Signature was for wrong file: '$SIGNED_FILE'" >&2
  echo "  Expected: '$ARCHIVE_NAME'" >&2
  echo "  The version in tauri.conf.json may have changed after signing." >&2
  exit 1
fi
echo "✓ Signature verified for: $SIGNED_FILE"

# ── Generate update.json ───────────────────────────────────────────
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > update.json <<JSON
{
  "version": "$VERSION",
  "notes": "See https://github.com/ellipog/galdr/releases/tag/v$VERSION",
  "pub_date": "$PUB_DATE",
  "platforms": {
    "$UPDATE_KEY": {
      "signature": "$SIGNATURE",
      "url": "https://github.com/ellipog/galdr/releases/download/v$VERSION/$ARCHIVE_NAME"
    }
  }
}
JSON

echo "✓ update.json generated"

# ── Multi-platform update.json merging ─────────────────────────────
if [ -f update.json.prev ]; then
  echo "⟳ Merging with previous update.json ..."
  python3 -c "
import json, sys
prev = json.load(open('update.json.prev'))
curr = json.load(open('update.json'))
merged = {
  'version': curr['version'],
  'notes': curr['notes'],
  'pub_date': curr['pub_date'],
  'platforms': {**prev.get('platforms', {}), **curr['platforms']}
}
json.dump(merged, open('update.json', 'w'), indent=2)
print('Merged platforms:', list(merged['platforms'].keys()))
"
fi

cp update.json update.json.prev

# ── Summary ─────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  galdr v$VERSION · $PLATFORM ($ARCH)"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Upload to GitHub release tag v$VERSION:"
echo "    • $INSTALLER"
echo "    • $ARCHIVE"
echo "    • update.json"
echo ""
echo "  To add another platform, run on that platform:"
echo "    ./deploy.sh $VERSION"
echo "  (it will merge into update.json automatically)"
echo ""