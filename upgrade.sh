#!/usr/bin/env bash
#
# Geneseed self-upgrade.
#
# Run it from inside the Geneseed folder you want to update:
#
#     ./upgrade.sh                                  # track main, keep last theme + emit mode
#     ./upgrade.sh v0.1.0                           # pin to a tag
#     ./upgrade.sh main imperial                    # track main and force a theme
#     GENESEED_EMIT=opencode ./upgrade.sh           # per-repo .opencode/ layer
#     GENESEED_EMIT=opencode-global ./upgrade.sh main imperial   # render into OpenCode's
#                                                   #   global config dir (~/.config/opencode)
#
# It downloads the latest published source from GitHub, refreshes the factory
# files in this folder, and re-renders the bundle BESIDE this folder (a sibling
# directory named Harness/ at the same level as Geneseed), overwriting the files
# already there. Override the target with GENESEED_OUT=/abs/path.
#
# Both the THEME and the EMIT MODE are remembered between runs, so you only pass
# them once — afterwards a bare `./upgrade.sh` keeps the same theme and keeps
# emitting to the same place (e.g. the global OpenCode config dir).
#   - Theme precedence: explicit arg > $OUT/.geneseed-theme marker > the local
#     harness.config.json (read before SYNC) > a loud warning + the upstream default.
#   - Emit precedence:  $GENESEED_EMIT env > $OUT/.geneseed-emit marker > files.
# Your host-specific files are left untouched: context.json, the bundle's memory/,
# and anything not in the SYNC list below.
#
# Collision-safe: GitHub serves the zip as Geneseed-<ref>.zip and unzips to a
# Geneseed-<ref>/ folder. Both could clash with files in this directory, so all
# downloading and extraction happens in a throwaway temp dir — nothing lands
# here until we deliberately copy it.
#
# This script refreshes the factory CONTENT but NOT itself or the launcher
# (rewriting a running script is unsafe). To update the orchestration layer itself
# — upgrade.sh, sync-self.sh, geneseed, bootstrap — run ./sync-self.sh first, or just
# `./geneseed update` (which chains sync-self + upgrade in one go).

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

# OpenCode's global config dir (mirrors build.py _opencode_config_dir()).
CFG="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"

# Emit mode — plain bundle by default (just the harness, referenced by its own
# AGENT.md, from anywhere on the machine). OPT-IN OpenCode layers:
#   GENESEED_EMIT=opencode         per-repo .opencode/ (subagents, native skills) + opencode.json
#   GENESEED_EMIT=opencode-global  straight into OpenCode's global config dir
#                                  ($OPENCODE_CONFIG_DIR / ~/.config/opencode) — everything
#                                  global, zero per-repo files (GLOBAL-HARNESS-SPEC.md)
# Neither is ever generated automatically. build.py REMEMBERS the chosen mode in a
# .geneseed-emit marker (global mode -> in $CFG; other modes -> in $OUT), so a later
# bare `./upgrade.sh` keeps deploying the same way. Precedence: explicit env >
# global-config marker > bundle marker > files.
EMIT="${GENESEED_EMIT:-$(cat "$CFG/.geneseed-emit" 2>/dev/null || cat "$OUT/.geneseed-emit" 2>/dev/null || echo files)}"

# Heads-up guard: if this run would emit the plain bundle only, but OpenCode's global
# config dir already carries a Geneseed install (.geneseed-manifest.json), the user
# very likely meant to refresh THAT — a bare ./upgrade.sh silently won't touch it.
# Warn, never block.
if [ "$EMIT" = "files" ]; then
  if [ -f "$CFG/.geneseed-manifest.json" ]; then
    echo "[geneseed] ⚠️  $CFG already holds a global Geneseed install (.geneseed-manifest.json)," >&2
    echo "[geneseed] ⚠️  but this run emits the plain bundle only — it will NOT refresh that global config." >&2
    echo "[geneseed] ⚠️  Did you mean:  GENESEED_EMIT=opencode-global $(basename "$0") ${*:-}" >&2
  fi
fi

# Factory files refreshed from upstream. Everything else in the folder is left
# alone — notably context.json and Harness/memory/ (your runtime state).
SYNC=(build.py rituals src themes adapters prompts \
      harness.config.json DESIGN.md README.md SETUP.md LICENSE .gitignore)

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

# Validate the DOWNLOADED source before touching anything in $HERE. The old order
# copied first and validated after, so a bad/stale upstream snapshot (e.g. AGENT.md
# referencing a skill whose file isn't present) would half-apply and leave the tree
# broken until a second run. Validate in the temp dir; on failure, nothing here is
# modified — just retry once upstream is consistent.
echo "[geneseed] validating downloaded source ..."
if ! python3 "$NEW/rituals/harness.py" doctor; then
  echo "[geneseed] ✗ downloaded source is inconsistent — NOT applying it." >&2
  echo "[geneseed] ✗ Upstream was likely mid-publish; re-run in a moment:" >&2
  echo "[geneseed] ✗     $(basename "$0") ${*:-}" >&2
  exit 1
fi

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
# opencode-global renders into OpenCode's global config dir ($OPENCODE_CONFIG_DIR /
# ~/.config/opencode) — no project root; the bundle still builds at $OUT for memory.
if [ "$EMIT" = "opencode-global" ]; then BUILD_ARGS+=(--emit opencode-global); fi

# Migrate host state from an OLD in-folder bundle ($HERE/Harness) to the canonical
# $OUT *before* rebuilding. The old default rendered the bundle inside the factory;
# the canonical location is now a sibling $OUT. That stray bundle holds host-specific
# state — context.json and memory/ — that a fresh $OUT lacks. It MUST move across
# while $OUT is still empty: build() always stamps an empty context.json stub, so a
# post-build rescue would find $OUT/context.json already present and never restore
# the real one. Copy first, then build preserves it; only fill what $OUT is missing
# so a real $OUT is never overwritten. Finally drop the stray.
STRAY="$HERE/Harness"
if [ "$OUT" != "$STRAY" ] && [ -d "$STRAY" ]; then
  mkdir -p "$OUT"
  if [ -f "$STRAY/context.json" ] && [ ! -f "$OUT/context.json" ]; then
    cp "$STRAY/context.json" "$OUT/context.json"
    echo "[geneseed] rescued context.json from $STRAY -> $OUT"
  fi
  # memory dir is themed: memory/ (neutral) or anamnesis/ (imperial).
  for mem in memory anamnesis; do
    if [ -d "$STRAY/$mem" ] && [ ! -d "$OUT/$mem" ]; then
      cp -R "$STRAY/$mem" "$OUT/$mem"
      echo "[geneseed] rescued $mem/ from $STRAY -> $OUT"
    fi
  done
  echo "[geneseed] removing stray in-folder bundle $STRAY (canonical: $OUT)"
  rm -rf "$STRAY"
fi

# (The downloaded source was already validated with doctor before it was applied —
# see "validating downloaded source" above — so no second gate is needed here.)

echo "[geneseed] rebuilding bundle -> $OUT (theme: ${THEME:-config default}, emit: $EMIT) ..."
python3 build.py "${BUILD_ARGS[@]}"
# (build.py persists the .geneseed-emit marker itself — global mode in $CFG, other
# modes in $OUT — so the mode is remembered no matter which entrypoint set it.)

echo "[geneseed] upgrade complete."
