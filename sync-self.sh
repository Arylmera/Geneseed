#!/usr/bin/env bash
#
# Geneseed meta-updater — thin wrapper.
#
#     ./sync-self.sh            # track main
#     ./sync-self.sh v1.0.0     # pin to a tag
#
# `sync-self` is now an alias of `upgrade`: one `git pull --ff-only` refreshes the launchers
# AND the factory together. The logic lives in rituals/_update.py (git pull + rebuild — no
# downloads), so it runs identically on Windows, macOS, and Linux. On Windows, call it
# directly:  python rituals\harness.py sync-self  (or geneseed.cmd).
#
# `exec` replaces this bash process before _update.py overwrites this file, so the
# in-flight self-update is safe (Python reads the new scripts, not this running shell).

set -eo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Interpreter probe — kept inline (same probe as the launcher), not sourced from a
# shared file, so this self-update wrapper carries no sibling-file dependency
# mid-update. Intentional copy; see the launcher for the full rationale.
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3 python py; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'pass' >/dev/null 2>&1; then PY="$c"; break; fi
  done
  PY="${PY:-python3}"
fi
exec "$PY" "$HERE/rituals/harness.py" sync-self "$@"
