#!/usr/bin/env bash
# Geneseed — the macOS double-click front door. Finder opens a `.command` file in Terminal and
# opens an extensionless one in TextEdit, so `install` alone cannot be double-clicked. All the
# work is in ./install; this file only finds it.
# GENESEED_PAUSE holds the window open at the end, like install.cmd's `pause`: a Terminal window
# opened by a double-click can close on exit, taking the last lines (and any error) with it.
GENESEED_PAUSE=1 exec "$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install" "$@"
