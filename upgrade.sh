#!/usr/bin/env bash
#
# Geneseed self-upgrade — thin wrapper.
#
#     ./upgrade.sh                                  # track main, keep last theme + emit mode
#     ./upgrade.sh v1.0.0                           # pin to a tag
#     ./upgrade.sh main imperial                    # track main and force a theme
#     GENESEED_EMIT=opencode ./upgrade.sh           # per-repo .opencode/ layer
#     GENESEED_EMIT=opencode-global ./upgrade.sh main imperial   # OpenCode global config dir
#
# The upgrade logic now lives in rituals/_update.py (stdlib only — urllib + zipfile, no
# curl/unzip), so the SAME flow runs on Windows, macOS, and Linux. On Windows, call it
# directly:  python rituals\harness.py upgrade [ref] [theme]  (or use geneseed.cmd).
# This shell wrapper simply delegates there, so Unix muscle memory still works.
#
# Honoured env vars (read by _update.py): GENESEED_OUT, GENESEED_ROOT, GENESEED_EMIT,
# OPENCODE_CONFIG_DIR, XDG_CONFIG_HOME, GENESEED_LOG.

set -eo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Probe for an interpreter that actually RUNS — on Windows Git Bash, `python3` can
# resolve to the Microsoft Store alias stub (exists, prints a hint, exits non-zero).
# Kept inline (same probe as the launcher), not sourced from a shared file, so this
# self-update wrapper carries no sibling-file dependency mid-update. Intentional copy.
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3 python py; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'pass' >/dev/null 2>&1; then PY="$c"; break; fi
  done
  PY="${PY:-python3}"
fi
exec "$PY" "$HERE/rituals/harness.py" upgrade "$@"
