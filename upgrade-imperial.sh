#!/usr/bin/env bash
#
# Geneseed convenience wrapper — upgrade pinned to the IMPERIAL theme.
#
#     ./upgrade-imperial.sh            # track main, imperial theme
#     ./upgrade-imperial.sh v0.1.0     # pin to a tag, imperial theme
#
# It just forwards to ./upgrade.sh with the theme fixed. The emit mode is NOT set
# here — it still comes from $GENESEED_EMIT or the remembered .geneseed-emit marker,
# so this composes with a global install:
#
#     GENESEED_EMIT=opencode-global ./upgrade-imperial.sh
#
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/upgrade.sh" "${1:-main}" imperial
