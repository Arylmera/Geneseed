"""Geneseed build — shared primitives for the build.* submodules.

Owns the stdlib imports, ROOT/SRC/CONFIG/THEMES paths, the token/include/
capability regexes and the text-suffix set. Re-exported so each submodule
can `from _build_core import *`; cross-submodule names are linked at import
time by build.py (the facade), mirroring harness.py's layout.

**This module is the SOLE owner of the generator's mutable configuration** — the
source/theme roots, the host config-dir resolvers, and the build-wide posture/mode
selection (the `_OWNED` tuple below). Those names are deliberately excluded from
both `__all__` and build.py's namespace splice, so no submodule ever holds a copy:
every reader spells them `_build_core.SRC`, and redirecting one — `_build_core.SRC
= tmp`, or `mock.patch.object(_build_core, "SRC", tmp)`, the way tests point the
generator at a fixture tree — is a single write seen everywhere. Write them HERE,
never through the facade: `build.SRC` reads (that is the runtime's surface) but
refuses writes, because a write there cannot be restored reliably.

A bare `SRC` left behind in a submodule raises NameError instead of silently
reading a stale copy — that is the property this arrangement buys, and the reason
build.py no longer mirrors attribute writes across four modules."""
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

# Derived once at import, exactly as when they lived in _build_emit: redirecting
# ROOT/THEMES does NOT move them (nothing has ever relied on that — the tests that
# repoint the source tree set each of these explicitly).
COLOR_THEMES = THEMES / "opencode"
PLUGIN_SRC = ROOT / "adapters" / "opencode" / "plugins"
WORKFLOW_SRC = ROOT / "adapters" / "opencode" / "workflows"

# Build-wide selections read by _build_render.effective_theme, set once by build.py's
# main() from --posture/--mode rather than threaded through every emit signature.
POSTURE = "peer"
MODE = "direct"

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

# Skills shipped VERBATIM as multi-file folders under src/skills/<name>/ (not flat
# Geneseed-rendered .md skills). Most are third-party vendors carrying their own license
# and internal cross-links to the upstream project's own files — some intentionally NOT
# vendored — so the whole set is exempt from the hermeticity / dead-link and authoring
# gates that govern Geneseed's own flat specs. Being nested, they ride along verbatim in
# every emit — the `files` build (rglob copies the folder through) and the OpenCode
# native/global skills dir (copied whole, not wrapped as a flat SKILL.md) — so AGENT.md's
# folder-skill pointer resolves everywhere, yet they stay out of the skill COUNTS and
# tables. List a skill folder's name here to bring one in; each carries a VENDOR.md
# recording its provenance (upstream source, commit, license — or first-party status:
# `token-report` is Geneseed-authored and rides this mechanism because it bundles an
# executable script, which the flat pipeline cannot carry).
VENDORED_SKILL_DIRS = ("react-view-transitions", "daydream", "token-report")


def _opencode_config_dir() -> Path:
    """OpenCode's global config dir. Precedence: $OPENCODE_CONFIG_DIR (relocates the
    whole dir — use it to keep the harness in a git-tracked folder) > $XDG_CONFIG_HOME
    /opencode > ~/.config/opencode."""
    env = os.environ.get("OPENCODE_CONFIG_DIR")
    if env:
        return Path(env).expanduser().resolve()
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg).expanduser() if xdg else Path.home() / ".config"
    return (base / "opencode").resolve()


def _claude_config_dir() -> Path:
    """Claude Code's global/user config dir: ~/.claude (Windows: %USERPROFILE%\\.claude,
    which Path.home() resolves). Unlike OpenCode there is no documented env var that
    relocates it, so — by design — this resolver is simpler than its sibling: no env
    branch. (configuration: https://code.claude.com/docs/en/configuration)"""
    return (Path.home() / ".claude").resolve()


def _bob_config_dir() -> Path:
    """IBM Bob's global config dir: ~/.bob (its global skills live at ~/.bob/skills per
    bob.ibm.com/docs/ide). $BOB_CONFIG_DIR relocates it (mirrors the OpenCode env knob),
    so a CI/locked-down setup can point it at a git-tracked folder."""
    env = os.environ.get("BOB_CONFIG_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return (Path.home() / ".bob").resolve()


def _copilot_config_dir() -> Path:
    """GitHub Copilot's personal config dir: ~/.copilot — the CLI auto-loads
    copilot-instructions.md there and discovers skills/ and agents/ natively
    (docs.github.com/copilot/how-tos/copilot-cli). $COPILOT_CONFIG_DIR relocates it
    (Geneseed's knob, mirroring $BOB_CONFIG_DIR — Copilot documents no such env var,
    but tests/doctor and locked-down setups still need to re-point the target)."""
    env = os.environ.get("COPILOT_CONFIG_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return (Path.home() / ".copilot").resolve()


# The single-owner set. Excluded from `__all__` (so `from _build_core import *`
# cannot copy them) and from build.py's splice (so `vars(submodule).update(...)`
# cannot push them back), which together guarantee exactly one binding per name.
#
# Membership test: does anything ever REDIRECT this name — a test pointing the
# generator at a fixture tree, `--posture` selecting a register, a suite pointing a
# host's config dir at a sandbox? If yes it must be owned, because a redirect that
# reaches only some of five copies is worse than one that reaches none: it half-works,
# silently. The four `_*_config_dir` resolvers are here for exactly that reason — a
# global emit falls back to `cfg or _<host>_config_dir()`, so a resolver a test failed
# to redirect writes into the developer's REAL install.
_OWNED = ("ROOT", "SRC", "CONFIG", "THEMES", "CAPABILITY_LINK_RE",
          "COLOR_THEMES", "PLUGIN_SRC", "WORKFLOW_SRC", "POSTURE", "MODE",
          "VENDORED_SKILL_DIRS", "_opencode_config_dir", "_claude_config_dir",
          "_bob_config_dir", "_copilot_config_dir")

__all__ = ["argparse", "datetime", "hashlib", "json", "os", "re", "shutil", "sys",
           "Path", "VERSION_MARKER", "TOKEN_RE", "INCLUDE_RE", "TEXT_SUFFIXES",
           "source_release_version", "version_is_newer"]


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

