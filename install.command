#!/usr/bin/env bash
# Geneseed — the macOS double-click front door. Finder opens a `.command` file in Terminal and
# opens an extensionless one in TextEdit, so `install` alone cannot be double-clicked. All the
# work is in ./install; this file only finds it.
exec "$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install" "$@"
