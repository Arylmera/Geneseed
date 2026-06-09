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
PY="${PYTHON:-python3}"

# --- install diagnostics ---------------------------------------------------------
# Every failure prints a TAGGED code ([geneseed][E-*]) and is appended to a persistent
# log, so a screenshot of the terminal (or the log file) is enough to diagnose + fix.
# Override the log path with GENESEED_LOG.
LOG="${GENESEED_LOG:-$HOME/.geneseed-install.log}"
: > "$LOG" 2>/dev/null || { LOG="${TMPDIR:-/tmp}/geneseed-install.log"; : > "$LOG" 2>/dev/null || LOG="/dev/null"; }
log() { printf '%s\n' "$*"; printf '%s\n' "$*" >> "$LOG" 2>/dev/null || true; }
die() { local code="$1"; shift; log "[geneseed][$code] ✗ $*"; log "[geneseed] ── full install log: $LOG"; exit 1; }
doctor_legend() {
  log "[geneseed] doctor problem legend — what the lines above mean / how to fix:"
  log "  • 'dead link'          → a skill/agent body links a sibling as <dir>/<name>.md; use the BARE <name>.md (source bug)"
  log "  • 'unresolved token'   → a {{TOKEN}} is missing from a theme; add it to ALL 8 theme JSONs"
  log "  • 'incomplete source'  → AGENT.md lists a skill whose file isn't in this snapshot (usually a mid-publish cache — retry)"
  log "  • 'stale' / 'missing'  → the rendered Harness/ is out of sync (rebuild locally; harmless on a fresh download)"
  log "  • 'parity'             → the themes disagree on which tokens exist"
  log "  • 'escapes the bundle' → an absolute or ../ path leaked into a rendered file"
}
# Catch-all: an unguarded failure still names itself instead of dying silently.
trap 'rc=$?; if [ "$rc" -ne 0 ]; then printf "[geneseed][E-UNEXPECTED] ✗ install aborted (exit %s). Full log: %s\n" "$rc" "$LOG" >&2; fi' ERR

# Preconditions — fail early and BY NAME, not with a cryptic mid-run error.
_missing=""
for _t in "$PY" curl unzip; do command -v "$_t" >/dev/null 2>&1 || _missing="$_missing $_t"; done
[ -n "$_missing" ] && die E-DEPS "missing required tool(s):$_missing — install python3, curl, and unzip, then re-run."

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

# --- fetch the source: SHA-pinned and retried -----------------------------------
# `main` is a moving target served through GitHub's archive CDN, which can lag HEAD by
# minutes after a push — even handing out a mid-publish snapshot where AGENT.md already
# lists a skill whose file is not yet in the zip. That snapshot fails the doctor gate
# below, which (correctly) refuses it — but a bare abort made the USER re-run by hand
# (the "had to run it 3 times" symptom). Two defences close that:
#   1. SHA-pin: resolve REF -> commit SHA via the API and pull the content-addressed
#      archive/<sha>.zip, which only exists once the commit is fully published — never
#      half-baked. Falls back to the ref archive if the API is unreachable/rate-limited.
#   2. Retry: download + validate up to ATTEMPTS times with backoff, so a snapshot still
#      catching up self-heals instead of stopping the run.
resolve_sha() {                          # echo the 40-hex commit SHA for ref $1, or nothing
  local s
  s="$(curl -fsSL -H 'Accept: application/vnd.github.sha' \
        "https://api.github.com/repos/$REPO/commits/$1" 2>/dev/null | tr -d '[:space:]' || true)"
  case "$s" in *[!0-9a-f]* | "") return 1 ;; esac
  [ "${#s}" -eq 40 ] || return 1
  printf '%s' "$s"
}

fetch_source() {                         # download+extract REF into dir $1; echo the Geneseed-* path
  local dest="$1" sha url dir
  sha="$(resolve_sha "$REF" || true)"
  if [ -n "$sha" ]; then url="https://github.com/$REPO/archive/$sha.zip"
  else url="https://github.com/$REPO/archive/refs/heads/$REF.zip"; fi
  curl -fsSL "$url" -o "$dest/src.zip" 2>/dev/null \
    || curl -fsSL "https://github.com/$REPO/archive/refs/tags/$REF.zip" -o "$dest/src.zip" 2>/dev/null \
    || return 1
  unzip -q "$dest/src.zip" -d "$dest" >/dev/null 2>&1 || return 1
  dir="$(find "$dest" -maxdepth 1 -type d -iname 'geneseed-*' | head -n1)"
  [ -n "$dir" ] && printf '%s' "$dir"
}

# --- work in a temp dir so the zip and its Geneseed-<ref>/ folder can never
#     collide with the folder we are standing in ---------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Validate the DOWNLOADED source (across every theme — `--all` — so the gate checks the
# source we are about to apply, not the user's installed one; _installed_defaults probes
# the real global config dir, so a bare `doctor` could wrongly scope to an existing
# install) BEFORE touching $HERE. On failure nothing here is modified; we re-download a
# fresh snapshot (the CDN usually catches up within seconds) and only give up after
# ATTEMPTS — so a mid-publish window no longer forces a manual re-run.
NEW=""; ATTEMPTS=4; delay=2; prev_sig=""
for ((i = 1; i <= ATTEMPTS; i++)); do
  work="$TMP/try$i"; mkdir -p "$work"
  log "[geneseed] downloading $REPO@$REF (attempt $i/$ATTEMPTS) ..."
  cand="$(fetch_source "$work" || true)"
  if [ -z "$cand" ] || [ ! -d "$cand" ]; then
    log "[geneseed][E-DOWNLOAD] ⚠️  download or extract failed (attempt $i/$ATTEMPTS) — check network / curl / unzip."
    if [ "$i" -lt "$ATTEMPTS" ]; then sleep "$delay"; delay=$((delay * 2)); fi
    continue
  fi
  log "[geneseed] validating downloaded source (doctor --all) ..."
  if doctor_out="$("$PY" "$cand/rituals/harness.py" doctor --all 2>&1)"; then
    printf '%s\n' "$doctor_out" | tee -a "$LOG"
    NEW="$cand"; break
  fi
  printf '%s\n' "$doctor_out" | tee -a "$LOG"
  # A real source defect fails IDENTICALLY on every retry; a mid-publish cache lag
  # changes (missing files appear) between attempts. If the SAME problems repeat, stop
  # early and name it — don't burn all attempts and then wrongly blame "publishing".
  sig="$(printf '%s\n' "$doctor_out" | grep -E '^[[:space:]]*-[[:space:]]' | sort -u || true)"
  if [ -n "$sig" ] && [ "$sig" = "$prev_sig" ]; then
    doctor_legend
    die E-DOCTOR "the downloaded source FAILS validation with the SAME problems twice — this is a SOURCE DEFECT, not a publish-cache lag. Fix the problems listed above (also in $LOG); retrying will not help."
  fi
  prev_sig="$sig"
  log "[geneseed] ⚠️  validation failed (attempt $i/$ATTEMPTS) — may be a mid-publish cache; retrying ..."
  if [ "$i" -lt "$ATTEMPTS" ]; then sleep "$delay"; delay=$((delay * 2)); fi
done

if [ -z "$NEW" ]; then
  doctor_legend
  die E-NOSRC "could not obtain a source that passes validation after $ATTEMPTS attempts. If the problems above repeat, it is a SOURCE bug (report them). If they differ or mention 'incomplete', upstream may still be publishing — retry shortly, or pin a tag:  $(basename "$0") v<x.y.z>"
fi

# Capture the theme the LOCAL config asks for *before* SYNC overwrites
# harness.config.json with upstream's (which ships neutral). Fallback only —
# the bundle's own .geneseed-theme marker still wins over this.
CONFIG_THEME="$("$PY" -c 'import json,sys
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

log "[geneseed] rebuilding bundle -> $OUT (theme: ${THEME:-config default}, emit: $EMIT) ..."
if ! "$PY" build.py "${BUILD_ARGS[@]}" 2>&1 | tee -a "$LOG"; then
  die E-BUILD "the bundle build FAILED (theme: ${THEME:-default}, emit: $EMIT). The build output is above and in $LOG."
fi
# (build.py persists the .geneseed-emit marker itself — global mode in $CFG, other
# modes in $OUT — so the mode is remembered no matter which entrypoint set it.)

log "[geneseed] ✓ upgrade complete. (full log: $LOG)"
