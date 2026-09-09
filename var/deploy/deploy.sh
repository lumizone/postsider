#!/usr/bin/env bash
# Compatibility entrypoint. Use the hardened root deploy script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "$SCRIPT_DIR/deploy.sh" "$@"
