"""Geneseed web — shared primitives for the web.* submodules.

Owns the dependency-free imports, ROOT, the build/harness handles, the
SECTIONS/DOC_GROUPS/GLOSSARY registries and the WebState/NotFound core.
Re-exported so each submodule can `from _web_core import *`; cross-submodule
names are linked at import time by web.py (the facade)."""
from __future__ import annotations

import argparse
import contextlib
import gzip
import io
import json
import os
import re
import zipfile
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build          # noqa: E402
import harness        # noqa: E402

SECTIONS = ("agents", "skills", "laws", "memory", "notebook", "wiki", "config")
WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")


# ---- Docs registry ---------------------------------------------------------
# The Docs menu is one rail entry on the web UI ("Harness → Docs") that surfaces
# the on-disk documentation through a left sub-nav. Each entry below becomes
# one page in that sub-nav. `kind` decides how the page is rendered:
#
#   markdown — read `source` (relative to ROOT) and render it. Optional keys:
#              `anchor` scrolls the rendered page to a heading; `slice: True`
#              trims the body to just that anchor's section (heading line
#              through the line before the next heading of equal-or-greater
#              depth, code fences respected) so one source file can power
#              many focused panel pages without duplicating prose.
#   concept  — inline curated blurb; `body` is the markdown. Usually ends with
#              a `link` into the existing Library route.
#   cli      — generated CLI reference (introspects harness.build_argparser()).
#   glossary — theme-aware glossary; reads the deployed theme's JSON tokens.
#   about    — install snapshot (version, license, repo). Generated.
#
# The IA is organised around reader intent — Get started · Core concepts ·
# How-to · Reference · Deeper — not around source files. README.md and
# SETUP.md stay canonical for GitHub readers; the web panel slices them.
#
# Docs pages render explanation files, never `docs/specs/*` — specs are design
# history, not user-facing docs, and get renamed or removed. A page that needs
# prose gets its own doc file (e.g. docs/wiki.md) or a slice of a canonical one.
DOC_DIR = ROOT / "docs" / "web"


def _doc_frontmatter(text: str) -> "tuple[dict, str]":
    """Split a docs page into its frontmatter mapping and its markdown body.

    Deliberately not YAML: values are JSON scalars (or a JSON object for `link`),
    which covers every key these pages use, parses with the stdlib, and keeps the
    harness dependency-free. A page with no frontmatter is a body-only page."""
    marker = "---\n"
    if not text.startswith(marker):
        return {}, text
    _, _, rest = text.partition(marker)
    head, sep, body = rest.partition(marker)
    if not sep:
        return {}, text
    meta: dict = {}
    for line in head.splitlines():
        key, _, raw = line.partition(":")
        raw = raw.strip()
        if not key.strip() or not raw:
            continue
        try:
            meta[key.strip()] = json.loads(raw)
        except json.JSONDecodeError:
            meta[key.strip()] = raw
    return meta, body


def _load_doc_groups() -> list:
    """Build the Docs registry from docs/web/.

    This used to be a ~1000-line literal in this module: every page's prose written
    as concatenated Python string fragments with hand-placed newline escapes. Editing
    a sentence meant editing Python, and the diff of a wording change was unreadable.
    Now `docs/web/_groups.json` declares the groups and their order, and each page is
    a markdown file whose frontmatter carries its group, order and render kind — so
    the docs are diffable prose, and correcting a typo needs no code change.

    A page whose file is missing or malformed is skipped rather than crashing the
    server; an unreadable registry yields an empty Docs section, which the UI already
    renders as "no pages" rather than an error."""
    try:
        groups = json.loads((DOC_DIR / "_groups.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    by_id = {g["id"]: {**g, "pages": []} for g in groups}
    for path in sorted(DOC_DIR.glob("*.md")):
        try:
            meta, body = _doc_frontmatter(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        group = by_id.get(meta.pop("group", None))
        if group is None:
            continue
        order = meta.pop("order", 0)
        page = {"id": path.stem, **meta}
        if body.strip():
            page["body"] = body.rstrip("\n")
        group["pages"].append((order, page))
    out = []
    for g in groups:
        entry = by_id[g["id"]]
        entry["pages"] = [p for _o, p in sorted(entry["pages"], key=lambda t: t[0])]
        out.append(entry)
    return out


DOC_GROUPS = _load_doc_groups()


# Theme-aware glossary: each entry has the neutral term + the theme key whose
# value is the themed word. The build read the same keys from theme JSON, so
# this list matches whatever the templates actually substitute. A key of None
# marks a term that no theme renames — the same word in every voice.
GLOSSARY_KEYS = [
    ("Rule (Law)", "LAW", "the governance rules the agent obeys"),
    ("Rules (Laws)", "LAWS", "the body of governance rules"),
    ("Agent", "AGENT", "a capability specialist"),
    ("Agents", "AGENTS", "the roster of specialists"),
    ("Skill", "SKILL", "a repeatable workflow"),
    ("Skills", "SKILLS", "the catalogue of workflows"),
    ("Memory", "MEMORY", "durable, one-fact-per-file knowledge"),
    ("Notebook", "NOTEBOOK", "the agent's sovereign space"),
    ("Wiki", "WIKI", "the machine-wide knowledge base"),
    ("Pact", "PACT", "the two-way collaboration contract"),
    ("Posture", None, "the relationship register the agent works in "
     "(peer, mentor, expert, assistant, artisan)"),
    ("Mode", None, "how work gets executed — direct (the agent works every "
     "task itself) or foreman (substantial tasks spawn an isolated pipeline)"),
    ("Footprint", None, "how much of the Rules loads inline each turn "
     "(full vs lean)"),
    ("Profile", None, "who you are — seeded once, colours but never binds"),
    ("Memory force", None, "a memory's binding strength (constraint, "
     "choice, conviction, tempered)"),
    ("Tagline", "TAGLINE", "the one-line essence of the theme"),
    ("Loaded sigil", "LOADED_SIGIL", "what the agent emits when ready"),
    ("Benediction", "BENEDICTION", "the closing line of an install"),
]


class NotFound(Exception):
    """Requested catalog section or item does not exist."""


class WebState:
    """Resolved view of the deployed harness the server reads from. Inventory is
    rendered once per process (cheap, pure) and cached; actions that mutate the
    harness clear it via refresh()."""

    def __init__(self, theme: str | None = None, target: Path | None = None):
        self.target = Path(target) if target else build._opencode_config_dir()
        # The INSTALL ROOT (== build --out). For globals it IS the data dir, but a
        # claude/bob PROJECT install keeps its data under <repo>/.claude|.bob while
        # the .geneseed-emit/theme/footprint markers land at <repo>/ — reading them
        # from the data dir mis-detects the install as opencode/neutral, and a
        # Diff/Restore would then overwrite it with the wrong dialect.
        self.root = self.target
        self.theme = theme or harness._theme_of_dir(self.target) or "neutral"
        # Detect the install mode once, so the Build action rebuilds the deployed
        # harness in place (e.g. opencode-global) rather than a bare source render.
        self.emit = harness._installed_defaults().get("emit") or "opencode-global"
        self.footprint = harness._footprint_of_dir(self.target)   # 'full' when no marker
        self.posture = harness._posture_of_dir(self.target) or "peer"   # detected register
        self.mode = harness._mode_of_dir(self.target) or "direct"   # detected operating mode
        self._inv = None
        self._doctor = None

    @property
    def inventory(self) -> dict:
        if self._inv is None:
            self._inv = (_deployed_inventory(self) if _deployed(self)
                         else harness._tui_inventory(self.theme))
        return self._inv

    @property
    def doctor(self) -> dict:
        """Cached doctor verdict. _doctor_collect builds the theme in a sandbox
        (seconds) — far too slow to run on every overview GET, so it runs once,
        is stamped, and is invalidated by refresh() / repopulated by api_doctor."""
        if self._doctor is None:
            _themes, problems = harness._doctor_collect(theme=self.theme)
            self.stamp_doctor(problems)
        return self._doctor

    def stamp_doctor(self, problems: list):
        self._doctor = {"ok": not problems, "problems": problems,
                        "checked_at": time.strftime("%Y-%m-%d %H:%M")}

    def _detect_emit(self) -> str:
        """The emit mode of the CURRENT install, read from its `.geneseed-emit`
        marker — the ROOT first (where every emit writes it), then the data dir —
        so refresh() and a re-pointed view keep the right mode instead of
        always falling back to the OpenCode default."""
        for d in (self.root, self.target):
            try:
                em = d / ".geneseed-emit"
                if em.is_file():
                    v = em.read_text(encoding="utf-8").strip()
                    if v:
                        return v
            except OSError:
                pass
        return "claude-global" if (self.root / "CLAUDE.md").exists() else "opencode-global"

    def select_view(self, target: Path, root: "Path | None" = None):
        """Re-point the whole console at a different detected install's data dir — every
        card (inventory, memory, notebook, diff) then reads from `target`. `root` is the
        install root the markers/sigils live at (defaults to `target`; differs only for
        claude/bob/copilot PROJECT installs, where data sits under
        <repo>/.claude|.bob|.github)."""
        self.target = Path(target)
        self.root = Path(root) if root else self.target
        self.theme = (harness._theme_of_dir(self.root)
                      or harness._theme_of_dir(self.target) or "neutral")
        self.emit = self._detect_emit()
        self.footprint = harness._footprint_of_dir(self.root)
        self.posture = harness._posture_of_dir(self.root) or "peer"
        self.mode = harness._mode_of_dir(self.root) or "direct"
        self._inv = None
        self._doctor = None

    def refresh(self):
        """Drop caches and re-detect the deployed theme/emit — a finished Build may
        have re-themed the install, and the gallery's 'current' must follow it. Reads
        from the CURRENT install's markers, so a selected (non-default) view is kept."""
        self._inv = None
        self._doctor = None
        self.theme = (harness._theme_of_dir(self.root)
                      or harness._theme_of_dir(self.target) or self.theme)
        self.emit = self._detect_emit() or self.emit
        self.footprint = harness._footprint_of_dir(self.root)
        self.posture = harness._posture_of_dir(self.root) or "peer"
        self.mode = harness._mode_of_dir(self.root) or "direct"


def _deployed(state: WebState) -> bool:
    return (state.target / build.GLOBAL_MANIFEST).exists()


def _spec_desc(fm: dict, body: str) -> str:
    """One-line purpose for a deployed spec. Prefer the `> blockquote` line — the
    harness convention every rendered skill/agent carries — then fall back to the
    frontmatter `description`, then the first prose paragraph. The fallbacks exist
    for VENDORED_SKILL_DIRS (daydream, react-view-transitions), which ride in
    verbatim with no blockquote, so they'd otherwise show a blank Purpose cell."""
    bq = build._first_blockquote(body)
    if bq:
        return bq
    desc = str(fm.get("description") or "").strip()
    if desc:
        return " ".join(desc.split())
    for para in body.split("\n\n"):
        s = " ".join(para.split())
        if s and not s.startswith(("#", "---", "<!--")):
            return s
    return ""


def _spec_entries(root: Path, nested: bool) -> list[dict]:
    """Agent/skill specs read straight from a deployed harness dir. Agents are flat
    `<root>/<name>.md` (skipping `_*` templates); skills use OpenCode's folder layout
    `<root>/<name>/SKILL.md`. Each entry mirrors the source-render shape
    (name/desc/body/source) so every inventory consumer is indifferent to the origin."""
    out: list[dict] = []
    if not root.is_dir():
        return out
    if nested:
        files = [d / "SKILL.md" for d in sorted(root.iterdir()) if d.is_dir()]
    else:
        files = sorted(p for p in root.glob("*.md") if not p.name.startswith("_"))
    for p in files:
        if not p.is_file():
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        # Deployed agent/skill files carry OpenCode frontmatter (name, description,
        # mode, …). That's host plumbing, not prose — strip it so the web
        # detail pane shows just the spec, matching the frontmatter-free source render
        # path. The title/desc are surfaced separately from the catalog entry.
        _fm, body = harness._frontmatter(text)
        name = p.parent.name if nested else p.stem
        out.append({"name": name, "desc": _spec_desc(_fm, body),
                    "body": body, "source": str(p.resolve())})
    out.sort(key=lambda e: e["name"])
    return out


def _deployed_inventory(state: WebState) -> dict:
    """Inventory read from the DEPLOYED harness at state.target — the agents and
    skills actually installed there, not a fresh render of Geneseed's src/. Laws are
    still taken from the render: once deployed they live inside AGENT.md, not as
    separate files. Used whenever the target is a real install; the inventory
    property falls back to the source render otherwise, so a non-deployed dev host
    still shows a gallery."""
    render = harness._tui_inventory(state.theme)
    # Deployed spec files carry neither a category nor a lifecycle status, so tag each
    # by name from the same sources the source render uses — SKILL_CLASS for the web
    # Skills ledger's filter chips, registry.json for the status badges. An entity the
    # registry doesn't know (a user's own skill dropped into the install) reads
    # "unknown", which is the honest answer rather than a borrowed default.
    from _harness_tui import SKILL_CLASS, entity_status, load_registry
    registry = load_registry()
    skills = _spec_entries(state.target / "skills", nested=True)
    for e in skills:
        e["klass"] = SKILL_CLASS.get(e["name"], "build")
        e["status"] = entity_status(registry, f"skills/{e['name']}")
    agents = _spec_entries(state.target / "agents", nested=False)
    for e in agents:
        e["status"] = entity_status(registry, f"agents/{e['name']}")
    return {"agents": agents, "skills": skills,
            "laws": render["laws"], "theme": state.theme}
