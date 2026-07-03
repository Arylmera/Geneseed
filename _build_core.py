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
# A per-row agent/skill table link, e.g. `[reviewer](agents/reviewer.md)` — including the
# claude/bob project-scope form re-rendered with a prefixed DIR_AGENTS/DIR_SKILLS token,
# e.g. `[reviewer](.claude/agents/reviewer.md)` or `[clarify](.bob/skills/clarify.md)`, and
# Bob global's `../` prefix. The optional prefix is any run of relative path segments (never
# `http(s)://` or a leading `/`, so external and absolute links are never touched). The folder
# pointers `](agents/)` / `](skills/)` (no `.md`) and `](memory/…)` never match.
CAPABILITY_LINK_RE = re.compile(
    r"\[([^\]]+)\]\((?:(?!https?://|/)[A-Za-z0-9_.-]+/)*(?:agents|skills)/[A-Za-z0-9_-]+\.md\)")

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


def source_release_version() -> str:
    """The human-readable release label from harness.config.json's `version` key
    (see CHANGELOG.md) — NOT the source fingerprint (that's `source_fingerprint()`/
    `.geneseed-version`; see that docstring for the identity split). Falls back to
    "0.0.0" when the config is missing/corrupt/lacks the key, so a comparison
    against it degrades to "not newer" rather than raising."""
    if CONFIG.exists():
        try:
            data = json.loads(CONFIG.read_text(encoding="utf-8"))
            v = data.get("version") if isinstance(data, dict) else None
            if isinstance(v, str) and v:
                return v
        except (OSError, json.JSONDecodeError):
            pass
    return "0.0.0"


def _parse_version_tuple(v: str) -> "tuple[int, ...] | None":
    """Split a dotted release label into an all-numeric tuple for ordering, e.g.
    "1.10.2" -> (1, 10, 2). Returns None when any dot-segment isn't a plain integer
    (a non-numeric suffix like "1.2.0-rc1" or a garbled string) — callers must skip
    the comparison silently rather than guess at ordering."""
    parts = v.strip().split(".")
    if not parts:
        return None
    out = []
    for p in parts:
        if not p.isdigit():
            return None
        out.append(int(p))
    return tuple(out)


def version_is_newer(a: str, b: str) -> "bool | None":
    """Is release label `a` strictly newer than `b`? Tuple-compares the numeric
    dotted parts (shorter tuple is padded with zeros, so "1.2" == "1.2.0"). Returns
    None — not True/False — when either side fails to parse, so a caller can skip
    the warning silently instead of guessing."""
    ta, tb = _parse_version_tuple(a), _parse_version_tuple(b)
    if ta is None or tb is None:
        return None
    width = max(len(ta), len(tb))
    ta = ta + (0,) * (width - len(ta))
    tb = tb + (0,) * (width - len(tb))
    return ta > tb

