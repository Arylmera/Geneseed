#!/usr/bin/env bash
#
# Geneseed self-upgrade.
#
# Run it from inside the Geneseed folder you want to update:
#
#     ./upgrade.sh                  # track main, keep the last-built theme
#     ./upgrade.sh v0.1.0           # pin to a tag
#     ./upgrade.sh main imperial    # track main and force a theme
#
# It downloads the latest published source from GitHub, refreshes the factory
# files in this folder, and re-renders the bundle BESIDE this folder (a sibling
# directory named Harness/ at the same level as Geneseed), overwriting the files
# already there. Override the target with GENESEED_OUT=/abs/path.
#
# The theme is resolved by precedence: explicit arg > the existing bundle's
# .geneseed-theme marker > the local harness.config.json (read before it is
# refreshed from upstream) > a loud warning + the upstream default. Your
# host-specific files are left untouched: context.json, the bundle's memory/,
# and anything not in the SYNC list below.
#
# Collision-safe: GitHub serves the zip as Geneseed-<ref>.zip and unzips to a
# Geneseed-<ref>/ folder. Both could clash with files in this directory, so all
# downloading and extraction happens in a throwaway temp dir — nothing lands
# here until we deliberately copy it.

set -eo pipefail

REPO="Arylmera/Geneseed"
REF="${1:-main}"                                   # branch or tag (default: main)
THEME_ARG="${2:-}"                                 # optional: force a theme (neutral|imperial|…)
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Render the bundle BESIDE the Geneseed folder by default (a sibling dir named
# Harness/), so AGENT.md sits at the project level. Override with GENESEED_OUT.
OUT="${GENESEED_OUT:-$(dirname "$HERE")/Harness}"

# Factory files refreshed from upstream. Everything else in the folder is left
# alone — notably context.json and Harness/memory/ (your runtime state).
SYNC=(build.py rituals src themes adapters prompts \
      harness.config.json DESIGN.md README.md LICENSE .gitignore)

# --- work in a temp dir so the zip and its Geneseed-<ref>/ folder can never
#     collide with the folder we are standing in ---------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[geneseed] downloading $REPO@$REF ..."
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$REF.zip" -o "$TMP/src.zip" \
  || curl -fsSL "https://github.com/$REPO/archive/refs/tags/$REF.zip" -o "$TMP/src.zip" \
  || { echo "[geneseed] download failed for ref '$REF'" >&2; exit 1; }

echo "[geneseed] extracting ..."
unzip -q "$TMP/src.zip" -d "$TMP"
NEW="$(find "$TMP" -maxdepth 1 -type d -iname 'geneseed-*' | head -n1)"
[ -n "$NEW" ] || { echo "[geneseed] no Geneseed-* folder in the archive" >&2; exit 1; }

echo "[geneseed] refreshing factory files in $HERE ..."
for item in "${SYNC[@]}"; do
  if [ -e "$NEW/$item" ]; then
    rm -rf "$HERE/$item"
    cp -R "$NEW/$item" "$HERE/$item"
  fi
done

# Re-render with the theme the local bundle was last built with (build.py and
# doctor fall back to harness.config.json's default theme when none is given).
THEME="$(cat "$HERE/Harness/.geneseed-theme" 2>/dev/null || true)"
cd "$HERE"
echo "[geneseed] rebuilding bundle (theme: ${THEME:-config default}) ..."
if [ -n "$THEME" ]; then
  python3 build.py --theme "$THEME"
  python3 rituals/harness.py doctor --theme "$THEME" || true
else
  python3 build.py
  python3 rituals/harness.py doctor || true
fi

echo "[geneseed] upgrade complete."
