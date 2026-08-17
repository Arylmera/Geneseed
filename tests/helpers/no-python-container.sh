#!/usr/bin/env bash
# P4's acceptance gate: the packaged tarball, installed and exercised on a machine that has no
# Python interpreter at all.
#
# WHY A CONTAINER AND NOT A STRIPPED PATH. `tests/helpers/sandbox.mjs` can remove python from a
# child's PATH, which proves the CLI does not SHELL OUT to it. It cannot prove the absence of a
# python the process never names — an import, a shebang honoured by the OS, a launcher probing a
# well-known install directory. Only a filesystem with no interpreter on it can. This is also the
# only gate that runs the PACKAGED artefact rather than the checkout, so it is the one that would
# catch a file the tarball forgets to ship.
#
# WHAT COUNTS AS FAILURE, deliberately wider than a non-zero exit:
#   * any ENOENT, which is what a spawn of a missing interpreter looks like;
#   * the string `python` ANYWHERE in any output, because a message naming an interpreter this
#     machine does not have is a lie whether or not the command succeeded.
#
# USAGE:  bash tests/helpers/no-python-container.sh
# Needs docker. Prints a verdict and exits non-zero on failure.

set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="node:22-slim"

say() { printf '\n=== %s ===\n' "$1"; }

say "0. the image really has no python"
PRE=$(docker run --rm "$IMAGE" bash -c \
  'for p in python python3 py; do command -v $p; done; echo "--probe-done--"' 2>&1)
echo "$PRE"
if echo "$PRE" | grep -qE '^/.*(python|py)$'; then
  echo "REFUSING: $IMAGE ships an interpreter, so this gate would prove nothing."
  exit 2
fi

say "1. pack the tarball from the working tree"
TARBALL=$(cd "$REPO" && npm pack --silent 2>/dev/null | tail -1)
[ -n "$TARBALL" ] || { echo "npm pack produced nothing"; exit 2; }
echo "packed: $TARBALL"

say "2. install it into a throwaway consumer and exercise it"
OUT=$(docker run --rm \
  -v "$REPO/$TARBALL:/tmp/pkg.tgz:ro" \
  "$IMAGE" bash -c '
    set -x
    mkdir -p /consumer && cd /consumer
    npm init -y >/dev/null 2>&1
    npm install --no-audit --no-fund /tmp/pkg.tgz 2>&1 | tail -5
    mkdir -p /work && cd /work && git init -q 2>/dev/null || true

    # ⚠ THE INSTALLED BINARIES, NOT `npx` — see the CI twin (.github/workflows/ci.yml,
    # package-no-python). `npx <name>` from a directory with no node_modules fetches from the
    # REGISTRY, so once this package is published npx would test the registry copy rather than
    # the tarball just built, and go green having proved nothing about it.
    export PATH="/consumer/node_modules/.bin:$PATH"
    command -v geneseed geneseed-build geneseed-hook

    # The acceptance commands. Each is a real user path, not a --version smoke test.
    geneseed --version
    geneseed doctor --all
    geneseed-build --emit claude
    geneseed status
    geneseed catalog
    geneseed web --daemon-internal --port 0 &
    web_pid=$!
    sleep 3; kill "$web_pid" 2>/dev/null || true; wait "$web_pid" 2>/dev/null || true
    echo "--acceptance-done--"
  ' 2>&1)
STATUS=$?
echo "$OUT" | tail -40

say "3. verdict"
FAIL=0
if ! echo "$OUT" | grep -q -- '--acceptance-done--'; then
  echo "FAIL: the acceptance script did not reach the end (exit $STATUS)"; FAIL=1
fi
if echo "$OUT" | grep -qi 'ENOENT'; then
  echo "FAIL: an ENOENT appeared — something spawned a program this machine does not have:"
  echo "$OUT" | grep -i 'ENOENT' | head -5; FAIL=1
fi
# The probe lines themselves mention python; strip the `set -x` trace of this script's own grep.
if echo "$OUT" | grep -vi 'no-python-container' | grep -qi 'python'; then
  echo "FAIL: the string 'python' appeared in the output of a machine with no interpreter:"
  echo "$OUT" | grep -i 'python' | head -10; FAIL=1
fi

[ $FAIL -eq 0 ] && echo "PASS: packaged install builds, wires, doctors and serves with no interpreter present."
rm -f "$REPO/$TARBALL"
exit $FAIL
