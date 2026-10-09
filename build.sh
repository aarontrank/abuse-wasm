#!/usr/bin/env bash
# Build Abuse 0.8 for the browser from the original source tarball.
#
#   ./build.sh path/to/abuse-0.8.tar.gz
#
# Output lands in dist/ (index.html, abuse.js, abuse.wasm, abuse.data); serve it
# with ./serve.sh. Needs Emscripten: emcc on PATH, or an emsdk checkout at
# $EMSDK (default ~/emsdk).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARBALL="${1:-${ABUSE_TARBALL:-}}"
BUILD="$HERE/build"
DIST="$HERE/dist"

if [[ -z "$TARBALL" || ! -f "$TARBALL" ]]; then
    echo "usage: $0 path/to/abuse-0.8.tar.gz" >&2
    exit 2
fi
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

if ! command -v emcc >/dev/null 2>&1; then
    EMSDK_ENV="${EMSDK:-$HOME/emsdk}/emsdk_env.sh"
    if [[ -f "$EMSDK_ENV" ]]; then
        # shellcheck disable=SC1090
        # emsdk_env.sh is not written for -eu; the emcc check below decides.
        set +eu
        source "$EMSDK_ENV" >/dev/null 2>&1
        set -eu
    fi
fi
if ! command -v emcc >/dev/null 2>&1; then
    echo "emcc not found. Install emsdk (see README.md) or set EMSDK." >&2
    exit 1
fi

echo "== extracting $(basename "$TARBALL")"
rm -rf "$BUILD"
mkdir -p "$BUILD/obj"
tar xzf "$TARBALL" -C "$BUILD"
SRC="$BUILD/abuse-0.8"
[[ -d "$SRC/src" ]] || { echo "unexpected tarball layout: no abuse-0.8/src" >&2; exit 1; }

echo "== patching"
for p in "$HERE"/patches/*.patch; do
    patch -s -p1 -d "$SRC" < "$p"
done
cp "$HERE/config.h" "$SRC/config.h"

# The source list is whatever the original automake files build, minus the
# standalone abuse-tool.
cd "$SRC/src"
SOURCES=$(for d in . lisp net imlib sdlport; do
    sed -n '/_SOURCES/,/^$/p' "$d/Makefile.am" | grep -o '[A-Za-z0-9_/]*\.cpp' | sed "s|^|$d/|"
done | sed 's|^\./||' | grep -v '^tool\.cpp$' | sort -u)

CFLAGS=(
    -O2 -sUSE_SDL=1
    -DHAVE_CONFIG_H -DNO_CHECK '-DASSETDIR="/data"'
    -I.. -I. -Ilisp -Iimlib -Inet
    -include stdint.h -Dushort=uint16_t
    # The Lisp engine guards NULL receivers with `if (this)`.
    -fno-delete-null-pointer-checks
    -fno-strict-aliasing
    -Wno-everything
)

echo "== compiling $(echo "$SOURCES" | wc -l | tr -d ' ') files"
export BUILD
printf '%s\n' $SOURCES | xargs -P "$(nproc 2>/dev/null || echo 4)" -I{} sh -c '
    o="$BUILD/obj/$(echo "{}" | tr / _).o"
    emcc -c "$@" "{}" -o "$o" || { echo "FAILED: {}" >&2; exit 255; }
' _ "${CFLAGS[@]}"

echo "== linking"
rm -rf "$DIST"
mkdir -p "$DIST"
# Asyncify lets the game's own blocking loops yield to the browser. It must be
# an optimised build: unoptimised Asyncify frames overflow the browser stack in
# the recursive Lisp evaluator.
em++ -O3 "$BUILD"/obj/*.o \
    -sUSE_SDL=1 \
    -sASYNCIFY -sASYNCIFY_STACK_SIZE=1048576 \
    -sSTACK_SIZE=8MB \
    -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=64MB -sMAXIMUM_MEMORY=512MB \
    -sFORCE_FILESYSTEM -lidbfs.js \
    -sEXIT_RUNTIME \
    -sEXPORTED_RUNTIME_METHODS=FS \
    --pre-js "$HERE/web/pre.js" \
    --pre-js "$HERE/web/persist.js" \
    --pre-js "$HERE/web/audio.js" \
    --preload-file "$SRC/data@/data" \
    --exclude-file '*Makefile*' \
    -o "$DIST/abuse.js"
cp "$HERE"/web/index.html "$HERE"/web/style.css "$DIST/"

echo "== done: $DIST"
ls -la "$DIST"
