#!/usr/bin/env bash
#
# Geneseed meta-updater — thin wrapper.
#
#     ./sync-self.sh            # track main
#     ./sync-self.sh v1.0.0     # pin to a tag
#
# Refreshes the ORCHESTRATION layer that `upgrade` does not (the launchers + the update
# scripts themselves). The logic now lives in rituals/_update.py (stdlib only — urllib +
# zipfile, no curl/unzip), so it runs identically on Windows, macOS, and Linux. On
# Windows, call it directly:  python rituals\harness.py sync-self [ref]  (or geneseed.cmd).
#
# `exec` replaces this bash process before _update.py overwrites this file, so the
# in-flight self-update is safe (Python reads the new scripts, not this running shell).

set -eo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3 python py; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'pass' >/dev/null 2>&1; then PY="$c"; break; fi
  done
  PY="${PY:-python3}"
fi
exec "$PY" "$HERE/rituals/harness.py" sync-self "$@"
