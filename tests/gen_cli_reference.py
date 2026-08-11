"""Regenerate `cli.json` — the harness parser's metadata, as a file both implementations read.

WHY THIS FILE EXISTS AT ALL. `rituals/harness.py`'s `build_argparser()` is the only
description of the CLI either implementation has, and Node cannot introspect argparse. P10c
made the metadata DATA instead: this script walks the parser and writes `cli.json`, which
`rituals/_web_docs._cli_reference` serves to the console's `cli` docs page and
`bin/geneseed-cli.mjs` parses its own arguments from. Hand-writing that file is the failure
mode the whole arrangement exists to prevent, so it is generated and never edited.

WHY IT IS HERE AND NOT `build.py --sync-cli`, which is the repo's other maintainer tool that
rewrites tracked source. `build.py`'s own header states the constraint: nothing in the build
facade may import `harness` — `harness` imports `build`, and a back-import is a cycle. This
script needs the parser, so it belongs on the side that is allowed to have it. `tests/` is
withheld from the npm package, which is correct: an npm install can never see drift here
(`cli.json` and `rituals/harness.py` come out of the same tarball), so regeneration is a
contributor action and this is where contributors already run `golden.py`, `harness_golden.py`
and `web_golden.py` from.

Exit code mirrors `build.py --sync-themes`: NON-ZERO when it changed the file, so it doubles
as a drift check. `python rituals/harness.py doctor`, `node bin/geneseed-cli.mjs doctor` and
`tests/test_cli_reference.py` all fail on a stale file, so forgetting to run this is caught by
three of the eleven acceptance commands rather than by a habit.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))

import harness  # noqa: E402  (path adjusted above)


def main() -> int:
    changed = harness.write_cli_reference(harness.build_argparser())
    print(f"[sync-cli] {harness.CLI_JSON.name} "
          f"{'rewritten — commit it' if changed else 'already in sync'}")
    return 1 if changed else 0


if __name__ == "__main__":
    raise SystemExit(main())
