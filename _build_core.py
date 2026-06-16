"""Geneseed build — shared primitives for the build.* submodules.

Owns the stdlib imports, ROOT/SRC/CONFIG/THEMES paths, the token/include/
capability regexes and the text-suffix set. Re-exported so each submodule
can `from _build_core import *`; cross-submodule names are linked at import
time by build.py (the facade), mirroring harness.py's layout."""
from __future__ import annotations


import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
CONFIG = ROOT / "harness.config.json"
THEMES = ROOT / "themes"
VERSION_MARKER = ".geneseed-version"

TOKEN_RE = re.compile(r"\{\{([A-Z_]+)\}\}")
INCLUDE_RE = re.compile(r"^[ \t]*<!--[ \t]*INCLUDE:[ \t]*(?P<path>[^ \t]+)[ \t]*-->[ \t]*$", re.M)
# A per-row agent/skill table link, e.g. `[reviewer](agents/reviewer.md)`. The folder
# pointers `](agents/)` / `](skills/)` (no `.md`) and `](memory/…)` never match.
CAPABILITY_LINK_RE = re.compile(r"\[([^\]]+)\]\((?:agents|skills)/[A-Za-z0-9_-]+\.md\)")

TEXT_SUFFIXES = {".md", ".tmpl", ".json", ".txt", ".yml", ".yaml"}

# Third-party skills vendored VERBATIM as multi-file folders under src/skills/<name>/
# (not Geneseed-authored flat skills) carry their own license and internal cross-links to
# the upstream project's own files — some intentionally NOT vendored — so they are exempt
# from the hermeticity / dead-link and authoring gates that govern Geneseed's own specs.
# Being nested, they ride along verbatim in every emit — the `files` build (rglob copies
# the folder through) and the OpenCode native/global skills dir (copied whole, not wrapped
# as a flat SKILL.md) — so AGENT.md's vendored-skill pointer resolves everywhere, yet they
# stay out of the skill COUNTS and tables. List a skill folder's name here to bring one in;
# each carries a VENDOR.md recording its upstream source, commit, and license.
VENDORED_SKILL_DIRS = ("react-view-transitions", "daydream")

