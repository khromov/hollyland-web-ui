#!/usr/bin/env bash
# Builds the native side of the DSP parity harness into .dsp-native/ (gitignored):
#
#   .dsp-native/lib/libcmsis_macos.dylib   HollyAudio's iOS DSP library, copied from the
#                                         user's installed larkSound.app, retagged as a
#                                         macOS dylib and ad-hoc signed
#   .dsp-native/bin/cmsis-runner          CLI that dlopen()s it (tools/dsp-harness/native/runner.c)
#   .dsp-native/manifest.json             where everything came from
#
# Nothing produced here may be committed: the library and the app's speech samples are
# proprietary. Re-run this script to regenerate them from your own install.
#
# Env: LARKSOUND_APP  path to larkSound.app/Wrapper/larkSound.app (default: /Applications/...)
#      CMSIS_ALLOW_UNKNOWN_BUILD=1  continue when the library hash is not the one the
#                                   harness was written against (internals get disabled)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/tools/dsp-harness"
OUT="$ROOT/.dsp-native"
APP="${LARKSOUND_APP:-/Applications/larkSound.app/Wrapper/larkSound.app}"
SRC_LIB="$APP/Frameworks/cmsis_api_ios.framework/cmsis_api_ios"
EXPECTED_SHA="$(sed -n 's/^#define CMSIS_EXPECTED_SHA256 "\([0-9a-f]*\)".*/\1/p' "$HERE/native/cmsis_api.h")"

die() { echo "dsp:prepare: $*" >&2; exit 1; }

[[ "$(uname -s)" == Darwin ]] || die "needs macOS (the library is an Apple arm64 Mach-O)"
[[ "$(uname -m)" == arm64 ]] || die "needs an Apple Silicon Mac (arm64)"
for t in clang vtool codesign shasum; do command -v "$t" >/dev/null || die "missing tool: $t (install Xcode command line tools)"; done
[[ -f "$SRC_LIB" ]] || die "library not found at $SRC_LIB (install HollyAudio/larkSound from the App Store, or set LARKSOUND_APP)"

SHA="$(shasum -a 256 "$SRC_LIB" | cut -d' ' -f1)"
if [[ "$SHA" != "$EXPECTED_SHA" ]]; then
  echo "dsp:prepare: warning: $SRC_LIB has sha256 $SHA" >&2
  echo "             the harness was written against $EXPECTED_SHA (larkSound 3.1.0)." >&2
  [[ "${CMSIS_ALLOW_UNKNOWN_BUILD:-0}" == 1 ]] || die "set CMSIS_ALLOW_UNKNOWN_BUILD=1 to continue anyway"
fi

mkdir -p "$OUT/lib" "$OUT/bin" "$OUT/root" "$OUT/work" "$OUT/out"

# iOS -> macOS: same arm64 ABI and only libSystem imports, so retagging the
# LC_BUILD_VERSION platform and re-signing is enough for dlopen() to accept it.
rm -f "$OUT/lib/libcmsis_macos.dylib"
vtool -set-build-version macos 14.0 26.1 -replace -output "$OUT/lib/libcmsis_macos.dylib" "$SRC_LIB" 2>&1 | grep -v "code signature will be invalid" >&2 || true
[[ -f "$OUT/lib/libcmsis_macos.dylib" ]] || die "vtool failed"
codesign -f -s - "$OUT/lib/libcmsis_macos.dylib" 2>/dev/null

# -ffp-contract=off: the runner itself must not add any rounding of its own.
clang -std=c11 -O2 -Wall -Wextra -Wno-unused-parameter -ffp-contract=off -arch arm64 \
  -I "$HERE/native" -o "$OUT/bin/cmsis-runner" \
  "$HERE/native/runner.c" "$HERE/native/wavfile.c" "$HERE/native/minijson.c"
# Reads the float libm tables out of this Mac's libsystem_m (src/lib/dsp/applelibm-data.ts).
clang -std=c11 -O2 -Wall -Wextra -arch arm64 -o "$OUT/bin/libm-tables" "$HERE/native/libm_tables.c"

LLVM_PROFILE_FILE=/dev/null "$OUT/bin/cmsis-runner" info

cat > "$OUT/manifest.json" <<EOF
{
  "app": "$APP",
  "sourceLibrary": "$SRC_LIB",
  "sourceSha256": "$SHA",
  "expectedSha256": "$EXPECTED_SHA",
  "library": "$OUT/lib/libcmsis_macos.dylib",
  "runner": "$OUT/bin/cmsis-runner",
  "libmTables": "$OUT/bin/libm-tables",
  "preparedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
echo "dsp:prepare: ready in $OUT"
