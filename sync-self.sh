#!/usr/bin/env bash
#
# Geneseed meta-updater — refresh the ORCHESTRATION scripts that `upgrade.sh` does
# not (and cannot safely) refresh itself: `upgrade.sh`, the `geneseed` launcher, and
# this script.
#
#     ./sync-self.sh            # track main
#     ./sync-self.sh v0.1.0     # pin to a tag
#
# Why a separate script: `upgrade.sh` refreshes the factory CONTENT (build.py, src/,
# themes/, adapters/, prompts/, …) from upstream, but deliberately NOT itself — a
# script that rewrites the file it is currently executing is unsafe (bash reads the
# file by byte offset as it runs). This standalone updater fetches a fresh copy of
# the orchestration layer and swaps it in. The whole body lives in a function called
# on the final line as `main "$@"; exit $?`, so bash has already read every byte it
# will execute before the overwrite happens — making a self-update safe.
#
# After it runs, use `./upgrade.sh` (now current) to rebuild the bundle.

set -eo pipefail

main() {
  local REPO="Arylmera/Geneseed"
  local REF="${1:-main}"
  local HERE; HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  # The orchestration layer this updater owns (everything upgrade.sh's SYNC skips).
  local SCRIPTS=(upgrade.sh sync-self.sh geneseed bootstrap)

  local TMP; TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' RETURN

  # SHA-pin the archive (content-addressed, never a mid-publish partial) with a ref
  # fallback, and retry the download so a transient CDN hiccup self-heals instead of
  # forcing a re-run. sync-self only swaps the small orchestration scripts, so it runs
  # no doctor gate — but the same moving-target caveats apply to the fetch itself.
  echo "[geneseed] fetching orchestration scripts from $REPO@$REF ..."
  local sha url NEW="" i delay=2
  for ((i = 1; i <= 4; i++)); do
    sha="$(curl -fsSL -H 'Accept: application/vnd.github.sha' \
            "https://api.github.com/repos/$REPO/commits/$REF" 2>/dev/null | tr -d '[:space:]' || true)"
    case "$sha" in *[!0-9a-f]* | "") sha="" ;; esac
    [ "${#sha}" -eq 40 ] || sha=""
    if [ -n "$sha" ]; then url="https://github.com/$REPO/archive/$sha.zip"
    else url="https://github.com/$REPO/archive/refs/heads/$REF.zip"; fi
    rm -rf "$TMP"/src.zip "$TMP"/geneseed-* 2>/dev/null || true
    if { curl -fsSL "$url" -o "$TMP/src.zip" 2>/dev/null \
          || curl -fsSL "https://github.com/$REPO/archive/refs/tags/$REF.zip" -o "$TMP/src.zip" 2>/dev/null; } \
       && unzip -q "$TMP/src.zip" -d "$TMP" >/dev/null 2>&1; then
      NEW="$(find "$TMP" -maxdepth 1 -type d -iname 'geneseed-*' | head -n1)"
      if [ -n "$NEW" ]; then break; fi
    fi
    echo "[geneseed]   download attempt $i failed — retrying ..." >&2
    if [ "$i" -lt 4 ]; then sleep "$delay"; delay=$((delay * 2)); fi
  done
  [ -n "$NEW" ] || { echo "[geneseed] download failed for ref '$REF' after retries" >&2; return 1; }

  local changed=0
  for s in "${SCRIPTS[@]}"; do
    [ -f "$NEW/$s" ] || continue
    if ! cmp -s "$NEW/$s" "$HERE/$s" 2>/dev/null; then
      cp "$NEW/$s" "$HERE/$s"
      chmod +x "$HERE/$s"
      echo "[geneseed]   updated $s"
      changed=$((changed + 1))
    fi
  done

  if [ "$changed" -eq 0 ]; then
    echo "[geneseed] orchestration scripts already up to date ($REF)."
  else
    echo "[geneseed] refreshed $changed script(s). Now run: ./upgrade.sh"
  fi
}

# Single final line: bash reads `main "$@"; exit $?` in full before running main,
# so the in-flight overwrite of this file can never be re-read. DO NOT add lines below.
main "$@"; exit $?
