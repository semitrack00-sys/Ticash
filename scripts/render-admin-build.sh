#!/usr/bin/env bash
# Render static-site build; run from any directory with Bash on Linux.
set -Eeuo pipefail
trap 'printf "TiCash admin build failed at line %s.\n" "$LINENO" >&2' ERR

readonly FLUTTER_VERSION='3.47.1'
readonly FLUTTER_REVISION='6655482ec06e547f90abf8ae7590466f4415978d'
readonly REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly APP_DIR="$REPO_ROOT/apps/mobile"

if [[ "$(uname -s)" != 'Linux' ]]; then
  printf 'This Render build script requires Linux. See apps/mobile/README.md for local builds.\n' >&2
  exit 1
fi

# CI can provide an existing SDK. Otherwise use a version-specific cache;
# never follow the moving stable branch or upgrade an existing SDK.
if [[ -z "${FLUTTER_ROOT:-}" ]]; then
  export FLUTTER_ROOT="${XDG_CACHE_HOME:-/tmp}/ticash-build/flutter-$FLUTTER_VERSION"
  if [[ ! -e "$FLUTTER_ROOT" ]]; then
    mkdir -p -- "$(dirname -- "$FLUTTER_ROOT")"
    printf 'Installing Flutter %s...\n' "$FLUTTER_VERSION"
    git clone --depth 1 --branch "$FLUTTER_VERSION" \
      https://github.com/flutter/flutter.git "$FLUTTER_ROOT"
  fi
fi

actual_revision="$(git -C "$FLUTTER_ROOT" rev-parse HEAD)"
if [[ "$actual_revision" != "$FLUTTER_REVISION" ]]; then
  printf 'Flutter SDK revision mismatch; expected %s. Refusing to build.\n' "$FLUTTER_REVISION" >&2
  exit 1
fi
readonly FLUTTER="$FLUTTER_ROOT/bin/flutter"
test -x "$FLUTTER"
test -f "$APP_DIR/pubspec.lock"
export CI=true
export FLUTTER_SUPPRESS_ANALYTICS=true

printf 'Using pinned Flutter SDK...\n'
"$FLUTTER" --version
cd -- "$APP_DIR"
printf 'Resolving locked TiCash dependencies...\n'
"$FLUTTER" pub get --enforce-lockfile

# Only these public values enter the web bundle. Never forward environment
# files, backend secrets, provider credentials, or admin credentials.
printf 'Building TiCash production web app...\n'
"$FLUTTER" build web --release --no-pub \
  --dart-define=API_BASE_URL=https://ticash-api.onrender.com/api \
  --dart-define=APP_ENV=production

if [[ ! -s "$APP_DIR/build/web/index.html" ]]; then
  printf 'Build did not produce apps/mobile/build/web/index.html.\n' >&2
  exit 1
fi
printf 'TiCash admin build ready: apps/mobile/build/web/index.html\n'
