#!/usr/bin/env bash
# Serve dist/ over HTTP.   ./serve.sh [port]   (default 8080)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
port="${1:-8080}"
[[ -f "$here/dist/abuse.wasm" ]] || { echo "serve.sh: run $here/build.sh path/to/abuse-0.8.tar.gz first" >&2; exit 1; }

echo "Serving $here/dist at http://localhost:$port/  (Ctrl+C to stop)"
exec python3 -m http.server "$port" --bind 127.0.0.1 --directory "$here/dist"
