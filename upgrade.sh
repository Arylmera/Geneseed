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

# Project root the agent / OpenCode run from — where opencode.json and .opencode/
# live. Defaults to the bundle's parent; override with GENESEED_ROOT.
ROOT_DIR="${GENESEED_ROOT:-$(dirname "$OUT")}"

# Emit mode — plain bundle by default (just the harness, referenced by its own
# AGENT.md, from anywhere on the machine). The OpenCode native layer (subagents,
# commands, and an opencode.json at the project root) is OPT-IN ONLY: set
# GENESEED_EMIT=opencode. It is never generated automatically.
EMIT="${GENESEED_EMIT:-files}"

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

# Capture the theme the LOCAL config asks for *before* SYNC overwrites
# harness.config.json with upstream's (which ships neutral). Fallback only —
# the bundle's own .geneseed-theme marker still wins over this.
CONFIG_THEME="$(python3 -c 'import json,sys
d=json.load(open(sys.argv[1]));print(d.get("theme",""))' "$HERE/harness.config.json" 2>/dev/null || true)"

echo "[geneseed] refreshing factory files in $HERE ..."
for item in "${SYNC[@]}"; do
  if [ -e "$NEW/$item" ]; then
    rm -rf "$HERE/$item"
    cp -R "$NEW/$item" "$HERE/$item"
  fi
done

# Theme to rebuild with. Precedence:
#   1. explicit arg:          ./upgrade.sh <ref> <theme>
#   2. existing bundle marker .geneseed-theme (written by the last build)
#   3. the local harness.config.json captured before SYNC
#   4. else: warn loudly, let build.py use the (now upstream) config default
MARKER_THEME="$(cat "$OUT/.geneseed-theme" 2>/dev/null || true)"
THEME="${THEME_ARG:-${MARKER_THEME:-$CONFIG_THEME}}"

cd "$HERE"
if [ -z "$THEME" ]; then
  echo "[geneseed] ⚠️  no theme found — no marker at $OUT/.geneseed-theme, no local config theme." >&2
  echo "[geneseed] ⚠️  falling back to the upstream default. Pin it explicitly to avoid a silent downgrade:" >&2
  echo "[geneseed] ⚠️      ./upgrade.sh $REF imperial" >&2
fi

BUILD_ARGS=(--out "$OUT")
if [ -n "$THEME" ]; then BUILD_ARGS+=(--theme "$THEME"); fi
if [ "$EMIT" = "opencode" ]; then BUILD_ARGS+=(--emit opencode --root "$ROOT_DIR"); fi

echo "[geneseed] rebuilding bundle -> $OUT (theme: ${THEME:-config default}, emit: $EMIT) ..."
python3 build.py "${BUILD_ARGS[@]}"
if [ -n "$THEME" ]; then
  python3 rituals/harness.py doctor --theme "$THEME" || true
else
  python3 rituals/harness.py doctor || true
fi

# A previous run may have rendered the bundle INSIDE this factory folder
# ($HERE/Harness). The canonical location is now $OUT; drop the stray copy so
# there are never two bundles. Never touched when it IS the target.
if [ "$OUT" != "$HERE/Harness" ] && [ -d "$HERE/Harness" ]; then
  echo "[geneseed] removing stray in-folder bundle $HERE/Harness (canonical: $OUT)"
  rm -rf "$HERE/Harness"
fi

echo "[geneseed] upgrade complete."
