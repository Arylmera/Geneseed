"""Geneseed harness core — shared primitives for the harness.* submodules.

Owns the dependency-free imports, ROOT/BUILD paths, the curses shim install,
the validation regexes and the small helpers (run, strip_code, _within,
LEARN_PROMPT_HEAD). Everything here is re-exported so each submodule can do
`from _harness_core import *` for the shared toolset; cross-submodule names are
linked at import time by harness.py."""
from __future__ import annotations


import argparse
import contextlib
import datetime
import difflib
import fnmatch
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build.py"
sys.path.insert(0, str(ROOT))
import build  # noqa: E402  (path adjusted above)

# curses ships in the Unix stdlib but not on Windows. When it is absent, install the
# pure-stdlib VT shim (rituals/_winterm.py) under the `curses` name so the full-screen
# TUI runs natively on a VT-capable Windows console; every later `import curses`
# resolves to the shim, and its wrapper() raises Unsupported (caught by each caller)
# when no VT console is available, so we degrade to the line wizard.
try:
    import curses  # noqa: F401
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import _winterm  # noqa: E402
    sys.modules["curses"] = _winterm


_T0 = datetime.datetime.now().timestamp()    # process start — _flush_export_notes scans from here

TOKEN_RE = re.compile(r"\{\{[A-Z_]+\}\}")
LINK_RE = re.compile(r"\]\((?!https?://|#)([^)]+)\)")
# A link target that leaves the bundle: POSIX-absolute, home (~), or Windows drive.
ABS_LINK_RE = re.compile(r"^([A-Za-z]:[\\/]|/|~)")
FENCE_RE = re.compile(r"```.*?```", re.S)
INLINE_CODE_RE = re.compile(r"`[^`]*`")
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


def strip_code(text: str) -> str:
    """Remove fenced blocks, inline code, and HTML comments so link-syntax shown
    as documentation is not mistaken for a real link."""
    text = FENCE_RE.sub("", text)
    text = COMMENT_RE.sub("", text)
    return INLINE_CODE_RE.sub("", text)

# Cap the notes fed to the model so a long transcript can't blow up the prompt.
# The tail is kept — the most recent exchanges carry the durable decisions.
MAX_NOTES_CHARS = 16000

def _load_learn_prompt_head() -> str:
    """Single source of truth for the distil instructions is the OpenCode plugin
    (adapters/opencode/plugins/geneseed-learn.js) — the artifact that ships to the
    primary runtime. Extract its LEARN_PROMPT_HEAD template literal at load time so
    this CLI and the plugin can never drift (the old copy-pasted constant was a
    standing hazard, flagged "edit both together"). Falls back to a one-line
    instruction if the plugin is unreadable, so a Stop hook never crashes over it."""
    js = build.PLUGIN_SRC / "geneseed-learn.js"
    try:
        m = re.search(r"const LEARN_PROMPT_HEAD = `([\s\S]*?)`",
                      js.read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    except OSError:
        pass
    return ("Distil at most one durable, reusable memory from the notes below. "
            "When in doubt, output exactly: NOTHING.")


LEARN_PROMPT_HEAD = _load_learn_prompt_head()


# Windows spawns a visible console window for every child console process started
# from a console-less parent (the detached web server). CREATE_NO_WINDOW suppresses
# that window while still allowing piped stdout/stderr; on POSIX it is an empty dict.
# Fold it into every short-lived spawn so the web UI does not flash a burst of
# consoles — the Doctor page is the worst case, building every theme in its own
# process. NOT for the detached daemon launch, which already uses DETACHED_PROCESS.
NO_WINDOW: dict = (
    {"creationflags": subprocess.CREATE_NO_WINDOW}
    if sys.platform == "win32" else {}
)


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    if NO_WINDOW and "creationflags" not in kw:
        kw.update(NO_WINDOW)
    return subprocess.run(cmd, **kw)


def _within(child: Path, parent: Path) -> bool:
    """True if `child` is `parent` or sits under it — the hermeticity test."""
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


# Re-exported toolset for `from _harness_core import *` in the submodules.
__all__ = [
    'argparse', 'contextlib', 'datetime', 'difflib', 'fnmatch', 'io',
    'json', 'os', 're', 'shutil', 'subprocess', 'sys',
    'tempfile', 'Path', 'build', 'ROOT', 'BUILD', 'TOKEN_RE',
    'LINK_RE', 'ABS_LINK_RE', 'FENCE_RE', 'INLINE_CODE_RE', 'COMMENT_RE', 'MAX_NOTES_CHARS',
    'LEARN_PROMPT_HEAD', 'strip_code', '_load_learn_prompt_head', 'run', '_within',
]
