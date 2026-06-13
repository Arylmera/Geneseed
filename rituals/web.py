#!/usr/bin/env python3
"""Geneseed web UI — local, dependency-free HTTP server over the deployed Harness.

Pure API functions (api_overview/api_catalog/api_item/api_diff) are unit-tested
without sockets; the HTTP handler is a thin JSON shell around them. Mutating
actions run as background subprocess jobs (fire-and-notify). Reuses harness.py
and build.py for every read so the web and TUI never disagree.
"""
from __future__ import annotations

import argparse
import contextlib
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
# The Docs menu is one rail entry on the web UI ("Learn → Docs") that surfaces
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
#   specs    — sorted index of every `docs/specs/*.md` file.
#   spec     — one spec rendered (used internally when the index links through).
#   glossary — theme-aware glossary; reads the deployed theme's JSON tokens.
#   about    — install snapshot (version, license, repo). Generated.
#
# The IA is organised around reader intent — Get started · Core concepts ·
# How-to · Reference · Deeper — not around source files. README.md and
# SETUP.md stay canonical for GitHub readers; the web panel slices them.
#
# The discovery of `docs/specs/*` happens in api_docs(), so dropping a new
# spec into the folder makes it appear without editing this list.
DOC_GROUPS = [
    # ── 1. Get started ────────────────────────────────────────────────────
    # Short, action-first, hand-written. A first-time reader should be able
    # to follow these top-to-bottom and have a working harness inside 5 min.
    {"id": "start", "label": "Get started", "pages": [
        {"id": "install-quick", "title": "Install in 5 minutes",
         "kind": "concept", "body": (
            "Three steps. The only prerequisites are **git** and "
            "**Python 3** — the harness is stdlib-only, nothing to "
            "`pip install`.\n\n"
            "### 1. Clone\n\n"
            "```\n"
            "git clone https://github.com/Arylmera/Geneseed.git\n"
            "cd Geneseed\n"
            "```\n\n"
            "### 2. Run the setup wizard\n\n"
            "The wizard previews each theme as you move through it, picks an "
            "install mode (OpenCode global is recommended — one install, "
            "every repo inherits it), then builds and offers a health check.\n\n"
            "**macOS / Linux**\n\n"
            "```\n"
            "./geneseed setup\n"
            "```\n\n"
            "**Windows** (cmd or PowerShell — no bash needed)\n\n"
            "```\n"
            ".\\geneseed.cmd setup\n"
            "```\n\n"
            "### 3. Open your agent\n\n"
            "Open OpenCode (or Claude Code, or any `AGENT.md`-aware tool) "
            "in any repo. The first reply opens with the readiness sigil "
            "(`✅` neutral / `🧬` imperial / your theme's equivalent) and "
            "your project's docs are already in context.\n\n"
            "---\n\n"
            "**Next:** [Verify it works](#/docs/verify) · "
            "[What you just installed](#/docs/model) · "
            "[Install by hand instead](#/docs/install-paths)")},
        {"id": "verify", "title": "Verify it works",
         "kind": "concept", "body": (
            "Three quick checks confirm everything wired up.\n\n"
            "### 1. The readiness sigil\n\n"
            "Open your agent in any repo. The first reply opens with the "
            "readiness line — `✅` for neutral, `🧬` for imperial, or your "
            "theme's equivalent. If it's missing, the agent isn't pointed "
            "at `AGENT.md` — re-check your tool's instructions setting.\n\n"
            "### 2. The harness itself\n\n"
            "```\n"
            "./geneseed doctor       # macOS / Linux\n"
            ".\\geneseed.cmd doctor   # Windows\n"
            "```\n\n"
            "Should print `ok`. Failures include unresolved theme tokens, "
            "dead links, missing files, or a drifted bundle — each comes "
            "with a fix hint. Press the **Run doctor** button above to run "
            "it from here.\n\n"
            "### 3. Context delivery (OpenCode only)\n\n"
            "Start a session with `GENESEED_DEBUG=1` set. The context "
            "plugin logs what it discovered and injected; you should see "
            "the repo's `README.md` and any docs listed.\n\n"
            "---\n\n"
            "Trouble? See [Troubleshooting](#/docs/trouble).")},
        {"id": "first-session", "title": "Your first session",
         "kind": "concept", "body": (
            "Once installed, the agent doesn't change *how* you talk to "
            "your tool — it changes what the tool already knows when you do.\n\n"
            "### What loaded automatically\n\n"
            "- **`AGENT.md`** — 20 universal Rules the agent obeys.\n"
            "- **Your repo's docs** — `README.md`, `CONTRIBUTING.md`, "
            "anything under `docs/`, project context plugins discover.\n"
            "- **Your machine's wiki** (if you set one up) — eager entries "
            "and a lazy listing of the rest.\n"
            "- **The skill and agent catalogue** — invokable by name.\n\n"
            "### Try these prompts\n\n"
            "- *\"Use the **clarify** skill on this feature request.\"*\n"
            "- *\"Delegate to the **reviewer** agent on the staged diff.\"*\n"
            "- *\"Use **brainstorm** then **plan** for how to add X.\"*\n"
            "- *\"Use **council** to debate whether we should ship Y now.\"*\n\n"
            "Skills are repeatable workflows; agents are capability "
            "specialists. You invoke them by name in plain English.\n\n"
            "---\n\n"
            "**Catalog:** [Skills](#/section/skills) · "
            "[Agents](#/section/agents) · [Rules](#/section/laws)")},
    ]},
    # ── 2. Core concepts ──────────────────────────────────────────────────
    # One-screen explainers. The mental model — voice vs structure, the
    # five pieces, plugins, wiki. Each links to the live Library catalog.
    {"id": "concepts", "label": "Core concepts", "pages": [
        {"id": "model", "title": "The harness model", "kind": "concept", "body":
         "Geneseed assembles five runtime pieces around a single `AGENT.md` "
         "entrypoint: **Rules** (the laws the agent obeys), **Agents** "
         "(capability specialists you delegate to), **Skills** (repeatable "
         "workflows the agent can invoke), **Memory** (one-fact-per-file "
         "durable knowledge), and a **Notebook** (the agent's own sovereign "
         "space). On OpenCode, four **Plugins** bind the pieces to the host: "
         "context injection, learn-at-session-end, the safety guard, and the "
         "saved workflow runner. The structure is theme-independent — a "
         "theme only changes the *voice* (banner, sigil, prose), never a "
         "folder or a link.\n\n"
         "### What this UI actually shows\n\n"
         "The **Library** and **Graph** render the Geneseed source live — "
         "they show the harness that *would* be deployed if you rebuilt "
         "right now. The **Settings** panes and the **Memory** drawer read "
         "from the deployed harness on disk (`~/.config/opencode/…` for an "
         "OpenCode global install).\n\n"
         "If you've built recently, the two match. If you edit a file under "
         "`src/` and reload this panel, the Library updates immediately — "
         "the deployed bundle does not, until the next `geneseed update` or "
         "`build`."},
        {"id": "rules", "title": "Rules (Laws)", "kind": "concept",
         "link": {"hash": "#/section/laws", "label": "Browse the catalog →"},
         "body": "20 universal laws the agent obeys — secrets handling, "
         "scope discipline, verify-before-assert, surface-failures, context "
         "economy, load-the-docs, tool-discovery, and more. Each law is a "
         "short markdown file under `src/laws/` and the rendered numbered "
         "list lives in `AGENT.md`. They bind regardless of theme: an "
         "imperial deploy reads them as *Dictates*, a neutral deploy as "
         "*Rules*, but the numbering and the rule itself never move."},
        {"id": "agents", "title": "Agents", "kind": "concept",
         "link": {"hash": "#/section/agents", "label": "Browse the catalog →"},
         "body": "16 capability specialists — `reviewer`, `tester`, "
         "`architect`, `docs`, `security`, `explorer`, plus a debate "
         "**council** the [[council]] skill convenes (`advocate`, `skeptic`, "
         "`pragmatist`, `steward`, `visionary`, `user-advocate`, `framer`, "
         "`empiricist`, `operator`, `historian`). You delegate by capability, "
         "not by folder: the harness picks the right specialist from the "
         "request."},
        {"id": "skills", "title": "Skills", "kind": "concept",
         "link": {"hash": "#/section/skills", "label": "Browse the catalog →"},
         "body": "25 repeatable workflows the agent can invoke by name — "
         "[[brainstorm]], [[clarify]], [[plan]], [[tdd]], [[debug]], "
         "[[refactor]], [[code-review]], [[fresh-eyes]], [[review-response]], "
         "[[commit]], [[ship]], [[release]], [[migrate]], [[git-archaeology]], "
         "[[git-rescue]], [[repo-map]], [[document-project]], [[ingest]], "
         "[[research]], [[handoff]], [[roast-me]], [[council]], "
         "[[parallel-agents]], [[workflow]], [[wiki]]. A skill is a markdown "
         "playbook under `src/skills/`; the agent reads it before acting."},
        {"id": "memory", "title": "Memory convention", "kind": "markdown",
         "source": "src/memory/README.md"},
        {"id": "notebook", "title": "Notebook (sovereign space)",
         "kind": "markdown", "source": "src/notebook/README.md"},
        {"id": "wiki", "title": "Wiki (machine knowledge base)",
         "kind": "markdown",
         "source": "docs/specs/2026-06-11-wiki-knowledge-base.md"},
        {"id": "themes", "title": "Voice vs structure (themes)",
         "kind": "markdown", "source": "DESIGN.md", "anchor": "decisions",
         "slice": True},
        {"id": "plugins", "title": "Plugins (OpenCode)", "kind": "concept",
         "link": {"hash": "#/docs/adapters-opencode",
                  "label": "Read the adapter spec →"},
         "body": "OpenCode loads four plugins from the deployed bundle:\n\n"
         "- **geneseed-context** — injects the project's docs *and* your "
         "machine wiki at every session start (and after compaction).\n"
         "- **geneseed-learn** — distils memory at session end (powers the "
         "`learn` skill).\n"
         "- **geneseed-guard** — enforces the safety Laws and protected wiki "
         "folders at the tool boundary.\n"
         "- **geneseed-workflow** — registers the `workflow` tool that runs "
         "saved orchestration scripts."},
    ]},
    # ── 3. How-to ─────────────────────────────────────────────────────────
    # One task per page — all sliced out of SETUP.md so prose isn't
    # duplicated. The reader picks the page that matches what they need
    # to do, not which source file it lives in.
    {"id": "howto", "label": "How-to", "pages": [
        {"id": "install-paths", "title": "Choose your install path",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "choose-your-path", "slice": True},
        {"id": "configure-wiki", "title": "Configure a wiki (knowledge base)",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "wiki-your-own-knowledge-base-optional", "slice": True},
        {"id": "project-context", "title": "Override project context",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "project-context-usually-nothing", "slice": True},
        {"id": "ingest-docs", "title": "Read PDFs / Office docs",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "reading-non-markdown-docs", "slice": True},
        {"id": "mcp-markitdown", "title": "MCP — MarkItDown (PDF/Office)",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "markitdown-via-mcp-opencode", "slice": True},
        {"id": "mcp-gitlab", "title": "MCP — GitLab",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "gitlab-one-entry-per-instance", "slice": True},
        {"id": "mcp-filesystem", "title": "MCP — Filesystem",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "filesystem", "slice": True},
        {"id": "run-anywhere", "title": "Run `geneseed` from anywhere",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "run-geneseed-from-anywhere", "slice": True},
        {"id": "headless", "title": "Run in CI / headless",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "headless-ci-opencode", "slice": True},
        {"id": "upgrade", "title": "Upgrade & local edits",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "upgrade", "slice": True},
        {"id": "self-improve", "title": "The self-improvement loop",
         "kind": "concept",
         "link": {"hash": "#/diff", "label": "Open the diff page →"},
         "body": "Local edits the agent makes to its own deployed agent/skill "
         "files survive the next rebuild. Before `setup`, re-theme, or "
         "`upgrade` overwrites them, any drift is auto-exported to a markdown "
         "**improvements file** under `improvements/` inside the deployed "
         "harness dir — untouched by rebuilds and uninstall. Hand it to an "
         "agent in *this* repo to back-port the changes into `src/`. On "
         "demand: `geneseed diff --out FILE`, or the **Changes** page in this "
         "UI."},
        {"id": "authoring", "title": "Edit the source", "kind": "concept",
         "body": "Everything theme-independent lives under `src/` — laws, "
         "agents, skills, memory and notebook conventions, and the "
         "`AGENT.md.tmpl` entrypoint. Voice tokens live under `themes/` as one "
         "JSON file per theme. After editing, `python build.py --emit "
         "opencode-global` (or `geneseed update`) re-renders the deployed "
         "bundle. The `doctor` action verifies the result: unresolved theme "
         "tokens, dead links, hermetic escapes, theme-key parity, and that "
         "the committed bundle matches a fresh render."},
        {"id": "themes-author", "title": "Write a new theme", "kind": "concept",
         "link": {"hash": "#/themes", "label": "Open the theme gallery →"},
         "body": "A theme is one JSON file under `themes/` declaring voice "
         "tokens only: `BANNER`, `TAGLINE`, `LOADED_SIGIL`, `VOICE`, the core "
         "nouns (`LAW(S)`/`AGENT(S)`/`SKILL(S)`/`MEMORY`/`NOTEBOOK`/`WIKI`), "
         "the law titles `LEX_*`, the section intros `INTRO_*`, the epigraphs "
         "`EPI_*`, the `BENEDICTION`, the `ROAST_PERSONA`, and `DESC_*` "
         "blurbs. Copy `themes/neutral.json` and edit. `python build.py "
         "--theme yours` renders it; `doctor` checks for missing tokens."},
    ]},
    # ── 4. Reference ──────────────────────────────────────────────────────
    # Pure lookups — CLI, env vars, glossary, troubleshooting matrix.
    {"id": "reference", "label": "Reference", "pages": [
        {"id": "cli", "title": "CLI — every subcommand", "kind": "cli"},
        {"id": "env-knobs", "title": "Environment variables",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "environment-knobs", "slice": True},
        {"id": "glossary", "title": "Glossary (in your deployed voice)",
         "kind": "glossary"},
        {"id": "trouble", "title": "Troubleshooting",
         "kind": "concept", "body": (
            "### `geneseed: command not found`\n"
            "Run `./geneseed link` (macOS/Linux) or `.\\geneseed.cmd link` "
            "(Windows) from the cloned repo. On Windows, open a new terminal "
            "after `link` — the PATH update only applies to fresh shells.\n\n"
            "### The agent doesn't load my project docs\n"
            "On OpenCode the `geneseed-context` plugin must be installed. "
            "Re-run `geneseed setup` or `python build.py --emit opencode-"
            "global`. Verify with `geneseed doctor`.\n\n"
            "### `doctor` reports unresolved theme tokens\n"
            "A theme JSON is missing a key the templates reference. Compare "
            "with `themes/neutral.json` — every key there must exist in your "
            "theme. Re-render: `python build.py --theme <yours>`.\n\n"
            "### `doctor` reports drift between bundle and src\n"
            "A committed `Harness/` snapshot fell behind. Re-render and "
            "commit: `python build.py && git add Harness`. If the drift is "
            "intentional local edits, use the **Changes** page to export "
            "them as an improvements file and back-port.\n\n"
            "### Web UI shows 'no deployed harness'\n"
            "Run `geneseed setup` to install. The UI works read-only without "
            "a deployment but most actions are disabled.\n\n"
            "### Windows PATH didn't update\n"
            "`geneseed.cmd link` writes to `%LOCALAPPDATA%\\Geneseed\\bin` "
            "and adds it to user PATH — but only new shells see it. Close "
            "and reopen your terminal.\n\n"
            "### Plugin not registering on OpenCode\n"
            "Plugins ship in `~/.config/opencode/plugin/` for the global "
            "emit. Confirm with `ls ~/.config/opencode/plugin/` — you should "
            "see `geneseed-*.js`. If empty, re-run the build with "
            "`--emit opencode-global`.\n\n"
            "### Full `PROJECT CONTEXT` block visible in the terminal\n"
            "Either `GENESEED_CONTEXT_VISIBLE=1` (or legacy "
            "`GENESEED_CONTEXT_TRANSFORM=0/off`) is set, or your OpenCode "
            "build lacks the experimental transform hook and the plugin "
            "fell back to visible delivery — run with `GENESEED_DEBUG=1` "
            "to see which.\n\n"
            "### `could not determine a model`\n"
            "Set `GENESEED_MODEL=provider/model` in your environment.\n")},
    ]},
    # ── 5. Deeper ─────────────────────────────────────────────────────────
    # Design rationale, adapter internals, the workflow primitive, the
    # install snapshot. Long-form by nature — readers come here on purpose.
    {"id": "deeper", "label": "Deeper", "pages": [
        {"id": "design", "title": "DESIGN.md — the spec",
         "kind": "markdown", "source": "DESIGN.md"},
        {"id": "adapters-opencode", "title": "OpenCode adapter",
         "kind": "markdown", "source": "adapters/opencode/README.md"},
        {"id": "adapters-opencode-spec", "title": "OpenCode — global harness spec",
         "kind": "markdown",
         "source": "adapters/opencode/GLOBAL-HARNESS-SPEC.md"},
        {"id": "adapters-opencode-loads", "title": "OpenCode — how it loads",
         "kind": "markdown",
         "source": "adapters/opencode/HOW-OPENCODE-LOADS.md"},
        {"id": "adapters-claude-code", "title": "Claude Code adapter",
         "kind": "markdown", "source": "adapters/claude-code/README.md"},
        {"id": "workflow", "title": "The workflow primitive",
         "kind": "markdown",
         "source": "docs/specs/2026-06-09-opencode-workflow-primitive.md"},
        {"id": "about", "title": "About — version, license, links",
         "kind": "about"},
    ]},
]


# Theme-aware glossary: each entry has the neutral term + the theme key whose
# value is the themed word. The build read the same keys from theme JSON, so
# this list matches whatever the templates actually substitute.
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
        self.theme = theme or harness._theme_of_dir(self.target) or "neutral"
        # Detect the install mode once, so the Build action rebuilds the deployed
        # harness in place (e.g. opencode-global) rather than a bare source render.
        self.emit = harness._installed_defaults().get("emit") or "opencode-global"
        self._inv = None
        self._doctor = None

    @property
    def inventory(self) -> dict:
        if self._inv is None:
            self._inv = harness._tui_inventory(self.theme)
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

    def refresh(self):
        """Drop caches and re-detect the deployed theme/emit — a finished Build may
        have re-themed the install, and the gallery's 'current' must follow it."""
        self._inv = None
        self._doctor = None
        self.theme = harness._theme_of_dir(self.target) or self.theme
        self.emit = harness._installed_defaults().get("emit") or self.emit


def _deployed(state: WebState) -> bool:
    return (state.target / build.GLOBAL_MANIFEST).exists()


def _memory_items(state: WebState) -> list[dict]:
    d = harness._resolve_memory_dir(None)
    if not d or not d.is_dir():
        return []
    out = []
    for p in sorted(d.glob("*.md")):
        fm, _body = harness._frontmatter(p.read_text(encoding="utf-8", errors="replace"))
        out.append({"name": p.stem,
                    "title": fm.get("name", p.stem),
                    "desc": fm.get("description", "")})
    return out


def _notebook_items(state: WebState) -> list[dict]:
    d = state.target / "notebook"
    if not d.is_dir():
        return []
    return [{"name": p.stem, "title": p.stem, "desc": ""}
            for p in sorted(d.glob("*.md"))]


WIKI_FILE_CAP = 300  # per manifest entry — a vault folder can be huge


def _wiki_manifest(state: WebState) -> list:
    """The wiki manifest's `wikis` list, resolved like the context plugin does:
    $GENESEED_WIKI first, else wiki.jsonc beside the deployed bundle."""
    import os
    cand = os.environ.get("GENESEED_WIKI")
    p = Path(cand).expanduser() if cand else state.target / "wiki.jsonc"
    if not p.is_file():
        return []
    cfg = harness._mcp_load(p)   # the harness's generic JSONC dict loader
    wikis = cfg.get("wikis")
    return wikis if isinstance(wikis, list) else []


def _wiki_items(state: WebState) -> list[dict]:
    """Browsable wiki pages: every .md under each manifest entry (folders walked
    recursively, capped), minus the entries marked load=exclude. Item names are
    '<wiki>:<relpath>' so api_item can resolve them back to the right vault."""
    items, seen = [], set()
    for w in _wiki_manifest(state):
        if not isinstance(w, dict):
            continue
        wname = str(w.get("name") or "wiki")
        root = Path(str(w.get("path") or "")).expanduser()
        if not root.is_dir():
            continue
        entries = [e for e in (w.get("entries") or []) if isinstance(e, dict)]
        excludes = [str(e.get("path") or "").strip("/").replace("\\", "/")
                    for e in entries if e.get("load") == "exclude"]

        def excluded(rel: str) -> bool:
            return any(rel == x or rel.startswith(x + "/") for x in excludes if x)

        for e in entries:
            if e.get("load") == "exclude":
                continue
            rel = str(e.get("path") or "").strip("/").replace("\\", "/")
            desc = str(e.get("description") or "")
            fp = root / rel
            if fp.is_file() and fp.suffix == ".md":
                mds = [fp]
            elif fp.is_dir():
                mds = sorted(fp.rglob("*.md"))[:WIKI_FILE_CAP]
            else:
                continue
            for md in mds:
                r = md.relative_to(root).as_posix()
                key = f"{wname}:{r}"
                if key in seen or excluded(r):
                    continue
                seen.add(key)
                items.append({"name": key, "title": md.stem,
                              "desc": desc if len(mds) == 1 else r})
    return items


def api_wiki_item(state: WebState, name: str) -> dict:
    """One wiki page by '<wiki>:<relpath>' — read from the vault, never outside it."""
    wname, _, rel = name.partition(":")
    rel = rel.strip("/").replace("\\", "/")
    for w in _wiki_manifest(state):
        if isinstance(w, dict) and str(w.get("name") or "wiki") == wname:
            root = Path(str(w.get("path") or "")).expanduser().resolve()
            p = (root / rel).resolve()
            if rel and p.suffix == ".md" and harness._within(p, root) and p.is_file():
                body = p.read_text(encoding="utf-8", errors="replace")
                return {"type": "wiki", "name": name, "title": p.stem, "desc": "",
                        "body": body, "links": _resolve_links(state, body)}
    raise NotFound(name)


def _config_items(state: WebState) -> list[dict]:
    out = []
    for fname in ("context.json", "wiki.jsonc"):
        if (state.target / fname).is_file():
            out.append({"name": fname, "title": fname, "desc": ""})
    return out


def api_catalog(state: WebState, section: str) -> dict:
    if section not in SECTIONS:
        raise NotFound(section)
    inv = state.inventory
    if section in ("agents", "skills"):
        items = [{"name": e["name"], "title": e["name"], "desc": e["desc"]}
                 for e in inv[section]]
    elif section == "laws":
        items = [{"name": e["num"], "title": f"Rule {e['num']} — {e['title']}",
                  "desc": ""} for e in inv["laws"]]
    elif section == "memory":
        items = _memory_items(state)
    elif section == "notebook":
        items = _notebook_items(state)
    elif section == "wiki":
        items = _wiki_items(state)
    else:  # config
        items = _config_items(state)
    return {"section": section, "items": items}


def _resolve_links(state: WebState, body: str) -> list[dict]:
    """Cross-references found in body, resolved to nav targets. Matches [[name]]
    wikilinks against known agent/skill names."""
    inv = state.inventory
    known = {}  # name -> "agent" | "skill"
    for e in inv["agents"]:
        known[e["name"]] = "agent"
    for e in inv["skills"]:
        known[e["name"]] = "skill"
    links, seen = [], set()
    for m in WIKILINK_RE.finditer(body):
        label = m.group(1).strip()
        if label in known and label not in seen:
            seen.add(label)
            links.append({"label": label, "type": known[label], "name": label})
    return links


def api_item(state: WebState, type_: str, name: str) -> dict:
    inv = state.inventory
    if type_ == "agent":
        e = next((x for x in inv["agents"] if x["name"] == name), None)
        if not e:
            raise NotFound(name)
        return {"type": type_, "name": name, "title": name, "desc": e["desc"],
                "body": e["body"], "links": _resolve_links(state, e["body"])}
    if type_ == "skill":
        e = next((x for x in inv["skills"] if x["name"] == name), None)
        if not e:
            raise NotFound(name)
        return {"type": type_, "name": name, "title": name, "desc": e["desc"],
                "body": e["body"], "links": _resolve_links(state, e["body"])}
    if type_ == "law":
        e = next((x for x in inv["laws"] if x["num"] == name), None)
        if not e:
            raise NotFound(name)
        return {"type": type_, "name": name, "title": f"Rule {e['num']} — {e['title']}",
                "desc": "", "body": e["body"], "links": []}
    if type_ in ("memory", "notebook"):
        d = (state.target / "notebook") if type_ == "notebook" \
            else harness._resolve_memory_dir(None)
        p = (d / f"{name}.md") if d else None
        if not p or not p.is_file():
            raise NotFound(name)
        body = p.read_text(encoding="utf-8", errors="replace")
        return {"type": type_, "name": name, "title": name, "desc": "",
                "body": body, "links": _resolve_links(state, body)}
    if type_ == "wiki":
        return api_wiki_item(state, name)
    if type_ == "config":
        p = state.target / name
        if not p.is_file():
            raise NotFound(name)
        raw = p.read_text(encoding="utf-8", errors="replace")
        return {"type": type_, "name": name, "title": name, "desc": "",
                "body": f"```json\n{raw}\n```", "links": []}
    raise NotFound(type_)


class JobManager:
    """Runs one mutating action at a time in a background thread, capturing
    combined stdout/stderr. A second start() while busy returns None (the HTTP
    layer maps that to 409). Finished jobs persist to `history_path` (last
    HISTORY_MAX, output capped) so the console survives reload and restart."""

    HISTORY_MAX = 20
    OUTPUT_CAP = 20000  # chars of output kept per job in the history file

    def __init__(self, history_path: "Path | None" = None):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self._busy = False
        self._procs: dict[str, subprocess.Popen] = {}
        self._history_path = history_path
        self._load_history()

    def _load_history(self):
        if not self._history_path or not self._history_path.is_file():
            return
        try:
            jobs = json.loads(self._history_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        for j in jobs if isinstance(jobs, list) else []:
            # A 'running' job in the file means the server died mid-run.
            if isinstance(j, dict) and j.get("id") and j.get("status") != "running":
                self._jobs[j["id"]] = j

    def _save_history(self):
        if not self._history_path:
            return
        with self._lock:
            jobs = [dict(j) for j in self._jobs.values() if j["status"] != "running"]
        jobs.sort(key=lambda j: j.get("started") or 0)
        jobs = [{**j, "output": j["output"][-self.OUTPUT_CAP:]}
                for j in jobs[-self.HISTORY_MAX:]]
        try:
            self._history_path.write_text(json.dumps(jobs), encoding="utf-8")
        except OSError:
            pass

    def recent(self, n: int = HISTORY_MAX) -> list:
        """Last `n` jobs, oldest first — the order the console appends in."""
        with self._lock:
            jobs = sorted(self._jobs.values(), key=lambda j: j.get("started") or 0)
            return [dict(j) for j in jobs[-n:]]

    def start(self, action: str, *cmds: list, on_done=None) -> "str | None":
        with self._lock:
            if self._busy:
                return None
            self._busy = True
            jid = secrets.token_hex(8)
            self._jobs[jid] = {"id": jid, "action": action, "status": "running",
                               "output": "", "returncode": None,
                               "started": time.time(), "duration": None}
        t = threading.Thread(target=self._run, args=(jid, cmds, on_done), daemon=True)
        t.start()
        return jid

    def _append(self, jid: str, text: str):
        with self._lock:
            self._jobs[jid]["output"] += text

    def _run(self, jid: str, cmds, on_done=None):
        rc = 0
        try:
            for cmd in cmds:
                self._append(jid, f"$ {' '.join(str(c) for c in cmd)}\n")
                # Stream combined stdout/stderr line-by-line so the web console
                # fills live (terminal-style) instead of dumping at the end.
                p = subprocess.Popen(
                    cmd, cwd=str(ROOT), stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True,
                    encoding="utf-8", errors="replace", bufsize=1)
                with self._lock:
                    self._procs[jid] = p   # reachable for cancel()
                for line in p.stdout:
                    self._append(jid, line)
                p.wait()
                with self._lock:
                    self._procs.pop(jid, None)
                rc = p.returncode
                if rc != 0:
                    break
        except Exception as e:  # noqa: BLE001
            self._append(jid, f"\n[web] job crashed: {e}")
            rc = 1
        finally:
            with self._lock:
                j = self._jobs[jid]
                j.update(status="done" if rc == 0 else "failed", returncode=rc,
                         duration=round(time.time() - j["started"], 1))
                self._busy = False
            self._save_history()
            if on_done:
                try:
                    on_done()
                except Exception:  # noqa: BLE001 — refresh must never kill the job thread
                    pass

    def cancel(self, jid: str) -> bool:
        """Terminate the running job's subprocess; the run thread then winds down
        normally (stdout closes, wait() returns non-zero -> status 'failed')."""
        with self._lock:
            p = self._procs.get(jid)
            j = self._jobs.get(jid)
            if p is None or not j or j["status"] != "running":
                return False
        self._append(jid, "\n[web] cancelled by user.\n")
        try:
            p.terminate()
        except OSError:
            pass
        return True

    def get(self, jid: str) -> "dict | None":
        with self._lock:
            j = self._jobs.get(jid)
            return dict(j) if j else None

    def wait(self, jid: str, timeout: float = 30.0) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            j = self.get(jid)
            if j and j["status"] != "running":
                return j
            time.sleep(0.05)
        return self.get(jid)


def action_commands(action: str, theme: str = "neutral",
                    emit: str = "opencode-global") -> "list[list] | None":
    """Action name -> list of subprocess argv (each a separate step; stop on failure).

    `build` renders the DEPLOYED install in its detected theme + emit mode (so a
    rebuild from an imperial opencode-global install stays imperial and lands in
    the global config dir) — not a bare, neutral source render. `update` and
    `export` self-resolve the deployed theme downstream, so they take no args."""
    py = sys.executable
    h = str(ROOT / "rituals" / "harness.py")
    b = str(ROOT / "build.py")
    build_argv = harness._setup_build_args(theme, emit)
    return {
        "doctor": [[py, h, "doctor"]],
        "build": [[py, b, *build_argv]],
        "update": [[py, h, "sync-self"], [py, h, "upgrade"]],
        "export": [[py, h, "diff", "--out"]],
        # Local-machine maintenance, surfaced in the web Settings. uninstall keeps
        # memory (never deleted) and runs non-interactively with --yes.
        "link": [[py, h, "link"]],
        "unlink": [[py, h, "unlink"]],
        "uninstall": [[py, h, "uninstall", "--yes"]],
    }.get(action)


def _theme_choices() -> list[dict]:
    """Available themes — name + blurb from the option list, plus the accent,
    tagline and loaded-sigil each theme's JSON declares (for the web gallery)."""
    out = []
    for name, blurb in harness._theme_options():
        try:
            data = json.loads(
                (build.THEMES / f"{name}.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        out.append({"name": name, "blurb": blurb,
                    "accent": data.get("ACCENT", "cyan"),
                    "tagline": data.get("TAGLINE", ""),
                    "sigil": data.get("LOADED_SIGIL", "")})
    return out


def _emit_choices() -> list[dict]:
    """Available install modes (name + description) — the setup wizard's options."""
    return [{"name": name, "desc": desc} for name, desc in harness.EMIT_OPTIONS]


def api_themes(state: WebState) -> dict:
    """Theme + emit options for the web Build picker, plus the detected current pair."""
    return {"themes": _theme_choices(), "emits": _emit_choices(),
            "current": {"theme": state.theme, "emit": state.emit}}


def _build_override(state: WebState, body: dict) -> tuple:
    """Resolve (theme, emit) for a Build POST: a valid override in the request body
    wins; anything missing or unrecognised falls back to the detected install — so a
    bogus value can never reach the build argv."""
    themes = {c["name"] for c in _theme_choices()}
    emits = {c["name"] for c in _emit_choices()}
    t, e = body.get("theme"), body.get("emit")
    return (t if t in themes else state.theme,
            e if e in emits else state.emit)


def api_doctor(state: WebState) -> dict:
    """Doctor checks, grouped per check, for the web Doctor page — the same engine
    as the `doctor` command (_doctor_collect fills `groups` as it runs). A run
    here also refreshes the overview's cached verdict."""
    groups: list[dict] = []
    themes, problems = harness._doctor_collect(theme=state.theme, groups=groups)
    state.stamp_doctor(problems)
    return {"themes": themes, "ok": not problems,
            "problems": problems, "groups": groups,
            "checked_at": state.doctor["checked_at"]}


def api_memory_delete(state: WebState, name: str) -> dict:
    """Delete one memory fact and drop its line from MEMORY.md (the index the
    agent reads at session start). `name` is the bare slug; a path-separator or
    the reserved index/readme names are rejected, so this can only ever remove a
    fact file inside the resolved memory dir — never an arbitrary path."""
    d = harness._resolve_memory_dir(None)
    if not d or not d.is_dir():
        raise NotFound("memory store")
    if not name or "/" in name or "\\" in name or name in ("MEMORY", "README"):
        raise NotFound(name)
    p = d / f"{name}.md"
    if not p.is_file():
        raise NotFound(name)
    p.unlink()
    harness._memory_drop_index(d, name)
    state.refresh()
    return {"deleted": name}


def api_setup(state: WebState) -> dict:
    """Install snapshot for the Settings page — harness._status_data() (the same
    source the `status` command and the TUI panel read, so the three never drift)
    plus the web server's own facts."""
    d = harness._status_data()
    d.update({
        "root": str(ROOT),
        "target": str(state.target),
        "deployed": _deployed(state),
        "python": sys.version.split()[0],
    })
    return d


def api_diff(state: WebState) -> dict:
    target, theme, files = harness._diff_collect(target=state.target, theme=state.theme)
    return {
        "deployed": files is not None,
        "target": str(target),
        "theme": theme,
        "files": files or [],
    }


def api_restore(state: WebState, files: list) -> dict:
    """Restore selected drifted files from the source render — source wins, local
    edits are discarded (the inverse, keeping them, is Export improvements).
    Renders the expected copy exactly as _diff_collect does, then per rel:
    expected file present -> overwrite/create the deployed copy; expected absent
    but deployed present (an 'added' file) -> delete the deployed copy. Unknown
    or out-of-tree paths land in errors and touch nothing."""
    if not _deployed(state):
        return {"restored": [], "deleted": [], "errors": ["no deployed harness"]}
    restored, deleted, errors = [], [], []
    target = state.target.resolve()
    with tempfile.TemporaryDirectory() as tmp:
        expected = (Path(tmp) / "expected").resolve()
        with contextlib.redirect_stdout(io.StringIO()):   # swallow the emit's own log
            build.emit_opencode_global(state.theme, out=Path(tmp) / "bundle",
                                       cfg=expected)
        for rel in files or []:
            rel = str(rel).replace("\\", "/").strip().lstrip("/")
            dst = (target / rel).resolve()
            src = (expected / rel).resolve()
            if not rel or not harness._within(dst, target) \
                    or not harness._within(src, expected):
                errors.append(f"{rel}: outside the deployed tree")
                continue
            if src.is_file():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dst)
                restored.append(rel)
            elif dst.is_file():
                dst.unlink()
                deleted.append(rel)
            else:
                errors.append(f"{rel}: not in the source render nor deployed")
    state.refresh()
    return {"restored": restored, "deleted": deleted, "errors": errors}


def api_mcp(state: WebState) -> dict:
    """MCP servers per config target — the web mirror of the TUI's MCP screen.
    Presets first, then user-defined servers present in each config."""
    targets = harness._mcp_targets()
    out = []
    for label, path in targets:
        cfg = harness._mcp_load(path)
        servers = []
        for name in harness._mcp_known_names(cfg):
            lbl, desc = harness._mcp_meta(name)
            servers.append({"name": name, "label": lbl, "desc": desc,
                            "preset": name in harness._MCP_PRESETS,
                            "state": harness._mcp_state(cfg, name)})
        out.append({"label": label, "path": str(path), "exists": path.is_file(),
                    "commented": harness._mcp_commented(path),
                    "servers": servers})
    return {"targets": out, "default": harness._mcp_default_target(targets)}


def api_mcp_toggle(state: WebState, body: dict) -> dict:
    """Enable/disable — or first-add a preset — MCP server `name` in the target
    config at `path`. Same non-destructive rewrite as the TUI (only the mcp
    block changes); a hand-commented .jsonc is refused, never rewritten."""
    name = str(body.get("name") or "")
    want = bool(body.get("enabled"))
    path_arg = str(body.get("path") or "")
    known = {str(p): p for _label, p in harness._mcp_targets()}
    path = known.get(path_arg)
    if path is None or not name:
        raise NotFound(f"mcp target {path_arg or '(none)'}")
    if harness._mcp_commented(path):
        return {"ok": False,
                "error": "config holds comments — edit it by hand to keep them"}
    cfg = harness._mcp_load(path)
    current = harness._mcp_state(cfg, name)
    if current == "absent":
        preset = harness._MCP_PRESETS.get(name)
        if preset is None:
            return {"ok": False, "error": f"unknown server '{name}'"}
        if not want:
            return {"ok": False, "error": f"'{name}' is not configured"}
        cfg = harness._mcp_apply(cfg, name, dict(preset["block"]))
        cfg = harness._mcp_set_enabled(cfg, name, True)
    else:
        cfg = harness._mcp_set_enabled(cfg, name, want)
    harness._mcp_save(path, cfg)
    return {"ok": True, "name": name, "state": harness._mcp_state(cfg, name)}


def api_graph(state: WebState) -> dict:
    """Cross-link graph over agents + skills: one node per item, one edge per
    resolved [[wikilink]] between two known items — hubs and orphans at a glance.
    Same resolver contract as _resolve_links (known agent/skill names only)."""
    inv = state.inventory
    known = {}
    for e in inv["agents"]:
        known[e["name"]] = "agent"
    for e in inv["skills"]:
        known[e["name"]] = "skill"
    nodes = [{"id": name, "type": type_} for name, type_ in sorted(known.items())]
    edges, seen = [], set()
    for kind in ("agents", "skills"):
        for e in inv[kind]:
            src = e["name"]
            for m in WIKILINK_RE.finditer(e["body"]):
                dst = m.group(1).strip()
                if dst in known and dst != src and (src, dst) not in seen:
                    seen.add((src, dst))
                    edges.append({"source": src, "target": dst})
    return {"nodes": nodes, "edges": edges}


OFFLINE_ZIP_SKIP = {".git", "node_modules", "__pycache__", ".superpowers"}


def offline_zip_bytes() -> "tuple[bytes, str]":
    """(zip bytes, download name) of the source tree — the sneakernet package a
    proxied/offline machine consumes with `geneseed upgrade --zip <file>`.
    `git archive` (tracked files only) when git is available; otherwise a
    zipfile walk skipping VCS/build litter. The geneseed-offline/ prefix matches
    what the consume side expects (a geneseed-* wrapper dir, like GitHub zips)."""
    name = f"geneseed-offline-{time.strftime('%Y%m%d')}.zip"
    try:
        p = subprocess.run(
            ["git", "archive", "--format=zip", "--prefix=geneseed-offline/", "HEAD"],
            cwd=str(ROOT), capture_output=True, timeout=60)
        if p.returncode == 0 and p.stdout:
            return p.stdout, name
    except (OSError, subprocess.TimeoutExpired):
        pass
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(ROOT.rglob("*")):
            rel = f.relative_to(ROOT)
            if f.is_file() and not (set(rel.parts) & OFFLINE_ZIP_SKIP):
                zf.write(f, f"geneseed-offline/{rel.as_posix()}")
    return buf.getvalue(), name


# ---- Docs API --------------------------------------------------------------

SPEC_DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)\.md$")


def _find_doc_page(page_id: str) -> "dict | None":
    """Look up a page by id across all groups. Used by /api/docs/page/<id>."""
    for g in DOC_GROUPS:
        for p in g["pages"]:
            if p["id"] == page_id:
                return p
    return None


def _read_doc_source(rel: str) -> str:
    """Read a markdown file relative to ROOT — guards against escapes the same
    way Library does, then returns the body unmodified (frontmatter and all)."""
    target = (ROOT / rel).resolve()
    if not harness._within(target, ROOT) or not target.is_file():
        raise NotFound(rel)
    return target.read_text(encoding="utf-8", errors="replace")


# Match the slug shape the frontend's `slug()` produces, so a DOC_GROUPS
# `anchor` written against a heading matches whatever the renderer assigns.
_SLUG_STRIP_RE = re.compile(r"[^a-z0-9\s-]")
_SLUG_WS_RE = re.compile(r"\s+")
_SLUG_DASH_RE = re.compile(r"-+")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def _slugify_heading(text: str) -> str:
    """Same slug rules as web/src/pages/Docs/MarkdownPage.jsx → slug().
    Keeps the server-side anchor match identical to client-side heading ids."""
    s = _SLUG_STRIP_RE.sub("", text.lower().strip())
    s = _SLUG_WS_RE.sub("-", s)
    s = _SLUG_DASH_RE.sub("-", s)
    return s.strip("-")


def _slice_section(body: str, anchor: str) -> "tuple[str, bool]":
    """Trim `body` to just the section whose heading slug matches `anchor` —
    the heading line through the line before the next heading of equal or
    lesser depth. Code fences are tracked so `#` inside ``` blocks is never
    misread as a heading. H1 slices stop at the first H2 so they capture an
    intro paragraph instead of the whole file.

    Returns (body, ok). ok=False (and the original body) when the anchor is
    missing, so the caller falls back to the full document."""
    lines = body.splitlines()
    start = -1
    start_level = 0
    in_fence = False
    for i, ln in enumerate(lines):
        if ln.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = _HEADING_RE.match(ln)
        if not m:
            continue
        if _slugify_heading(m.group(2)) == anchor:
            start = i
            start_level = max(len(m.group(1)), 2)
            break
    if start < 0:
        return body, False
    out = [lines[start]]
    in_fence = False
    for j in range(start + 1, len(lines)):
        ln = lines[j]
        if ln.startswith("```"):
            in_fence = not in_fence
            out.append(ln)
            continue
        if in_fence:
            out.append(ln)
            continue
        m = _HEADING_RE.match(ln)
        if m and len(m.group(1)) <= start_level:
            break
        out.append(ln)
    while out and out[-1].strip() == "":
        out.pop()
    return "\n".join(out) + "\n", True


def _spec_purpose(text: str) -> str:
    """First non-heading paragraph of a spec, used as its index blurb. We skip
    the title, the metadata block (Date/Status lines), and any leading blank
    lines, then return the first paragraph trimmed to one line."""
    lines = text.splitlines()
    paras: list[list[str]] = []
    buf: list[str] = []
    for ln in lines:
        s = ln.strip()
        if not s:
            if buf:
                paras.append(buf)
                buf = []
            continue
        if s.startswith("#"):
            if buf:
                paras.append(buf)
                buf = []
            continue
        if s.startswith("**Date:") or s.startswith("**Status:"):
            continue
        buf.append(s)
    if buf:
        paras.append(buf)
    if not paras:
        return ""
    flat = " ".join(paras[0]).strip()
    return (flat[:240] + "…") if len(flat) > 240 else flat


def _specs_index() -> list[dict]:
    """All `docs/specs/*.md`, sorted newest first, with a date and a one-line
    purpose pulled from the body. The id is `spec:<filename>`."""
    out = []
    specs_dir = ROOT / "docs" / "specs"
    if not specs_dir.is_dir():
        return out
    for p in sorted(specs_dir.glob("*.md")):
        m = SPEC_DATE_RE.match(p.name)
        date = m.group(1) if m else ""
        try:
            body = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        title = ""
        for ln in body.splitlines():
            if ln.startswith("# "):
                title = ln[2:].strip()
                break
        out.append({
            "id": f"spec:{p.name}",
            "title": title or p.stem,
            "date": date,
            "filename": p.name,
            "purpose": _spec_purpose(body),
        })
    out.sort(key=lambda s: s["date"], reverse=True)
    return out


def _cli_reference() -> dict:
    """Walk the harness argparser into a JSON-able shape: one entry per
    subcommand, each carrying its help text, positional args, and options.
    The frontend renders each as a card."""
    parser = harness.build_argparser()
    sub_action = next((a for a in parser._actions
                       if isinstance(a, argparse._SubParsersAction)), None)
    if sub_action is None:
        return {"prog": parser.prog, "commands": []}

    def _arg(a) -> dict:
        return {
            "names": list(a.option_strings),
            "dest": a.dest,
            "metavar": a.metavar,
            "help": (a.help or "") if a.help is not argparse.SUPPRESS else "",
            "choices": list(a.choices) if a.choices else None,
            "default": None if a.default is None else
                       (a.default if isinstance(a.default, (str, int, float, bool)) else str(a.default)),
            "required": bool(getattr(a, "required", False)),
            "nargs": str(a.nargs) if a.nargs is not None else None,
            "is_flag": not a.option_strings is None and len(a.option_strings) > 0 and a.nargs == 0,
        }

    commands = []
    for name, sp in sub_action.choices.items():
        positionals, options = [], []
        for a in sp._actions:
            if isinstance(a, argparse._HelpAction):
                continue
            if a.help is argparse.SUPPRESS:
                continue
            (positionals if not a.option_strings else options).append(_arg(a))
        # The help text we attached via sub.add_parser(..., help=...) lives on
        # the subparser action, not on sp itself — read it back from the parent.
        help_text = ""
        for action in sub_action._choices_actions:
            if action.dest == name:
                help_text = action.help or ""
                break
        commands.append({
            "name": name,
            "help": help_text,
            "description": sp.description or "",
            "positionals": positionals,
            "options": options,
        })
    commands.sort(key=lambda c: c["name"])
    return {"prog": parser.prog, "commands": commands}


def _glossary(state: WebState) -> dict:
    """Side-by-side neutral term vs deployed-theme term for the invented
    vocabulary. Reads the neutral + deployed theme JSON to pull the strings the
    build actually substitutes — so a glossary entry can never disagree with
    what the agent prints."""
    def _load(theme: str) -> dict:
        try:
            return json.loads(
                (build.THEMES / f"{theme}.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
    neutral = _load("neutral")
    themed = _load(state.theme) if state.theme != "neutral" else neutral
    rows = []
    for label, key, desc in GLOSSARY_KEYS:
        rows.append({
            "label": label,
            "neutral": str(neutral.get(key, "")).strip(),
            "themed": str(themed.get(key, "")).strip(),
            "desc": desc,
        })
    return {"theme": state.theme, "rows": rows}


def _about(state: WebState) -> dict:
    """About-page payload: version line, deployed install summary, links."""
    sd = harness._status_data()
    return {
        "version": sd.get("version") or {},
        "theme": state.theme,
        "emit": state.emit,
        "deployed": _deployed(state),
        "target": str(state.target),
        "root": str(ROOT),
        "python": sys.version.split()[0],
        "repo": "https://github.com/Arylmera/Geneseed",
        "license": "MIT",
    }


def api_docs(state: WebState) -> dict:
    """Top-level menu the Docs page renders in its left sub-nav. Dated specs
    live behind their own rail entry now (api_specs) — Docs only carries the
    concepts, references, and the curated DESIGN.md."""
    groups = [{"id": g["id"], "label": g["label"],
               "pages": [{"id": p["id"], "title": p["title"], "kind": p["kind"]}
                         for p in g["pages"]]}
              for g in DOC_GROUPS]
    return {"groups": groups}


def api_specs(state: WebState) -> dict:
    """The dated implementation specs under docs/specs/, newest first. The
    detail view is served by api_docs_page('spec:<filename>') so the rendering
    pipeline (wikilink resolution, markdown body) stays single-sourced."""
    return {"specs": _specs_index()}


def api_docs_page(state: WebState, page_id: str) -> dict:
    """One docs page. Looks up DOC_GROUPS first; falls back to `spec:<file>`
    for the discovered specs index entries. Every shape carries a `kind` the
    frontend dispatches on."""
    if page_id.startswith("spec:"):
        fname = page_id.split(":", 1)[1]
        if "/" in fname or "\\" in fname or not fname.endswith(".md"):
            raise NotFound(page_id)
        body = _read_doc_source(f"docs/specs/{fname}")
        title = fname
        for ln in body.splitlines():
            if ln.startswith("# "):
                title = ln[2:].strip()
                break
        return {"id": page_id, "title": title, "kind": "markdown",
                "body": body, "source": f"docs/specs/{fname}",
                "links": _resolve_links(state, body)}
    page = _find_doc_page(page_id)
    if not page:
        raise NotFound(page_id)
    kind = page["kind"]
    if kind == "markdown":
        body = _read_doc_source(page["source"])
        anchor = page.get("anchor")
        # `slice: True` trims the body to just that section — the renderer
        # then shows one focused page instead of dumping the whole source
        # file. When a slice succeeds we drop the anchor so the client doesn't
        # try to scroll to it (the heading is already at the top).
        if anchor and page.get("slice"):
            body, sliced = _slice_section(body, anchor)
            if sliced:
                anchor = None
        return {"id": page_id, "title": page["title"], "kind": "markdown",
                "body": body, "source": page["source"],
                "anchor": anchor,
                "links": _resolve_links(state, body)}
    if kind == "concept":
        body = page.get("body", "")
        return {"id": page_id, "title": page["title"], "kind": "concept",
                "body": body, "link": page.get("link"),
                "links": _resolve_links(state, body)}
    if kind == "cli":
        return {"id": page_id, "title": page["title"], "kind": "cli",
                **_cli_reference()}
    if kind == "specs":
        return {"id": page_id, "title": page["title"], "kind": "specs",
                "specs": _specs_index()}
    if kind == "glossary":
        return {"id": page_id, "title": page["title"], "kind": "glossary",
                **_glossary(state)}
    if kind == "about":
        return {"id": page_id, "title": page["title"], "kind": "about",
                **_about(state)}
    raise NotFound(page_id)


def api_overview(state: WebState) -> dict:
    inv = state.inventory
    diff = None
    if _deployed(state):
        _t, _th, files = harness._diff_collect(target=state.target, theme=state.theme)
        if files is not None:
            diff = {
                "edited": sum(1 for f in files if f["status"] == "edited"),
                "added": sum(1 for f in files if f["status"] == "added"),
                "missing": sum(1 for f in files if f["status"] == "missing"),
            }
    build_time = None
    agent_md = state.target / "AGENT.md"
    if agent_md.is_file():
        import datetime
        build_time = datetime.datetime.fromtimestamp(
            agent_md.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
    return {
        "theme": state.theme,
        "accent": harness._accent_for(state.theme),
        "emit": state.emit,
        "target": str(state.target),
        "deployed": _deployed(state),
        "counts": {
            "agents": len(inv["agents"]),
            "skills": len(inv["skills"]),
            "laws": len(inv["laws"]),
            "memory": len(_memory_items(state)),
            "notebook": len(_notebook_items(state)),
            "wiki": len(_wiki_items(state)),
            "config": len(_config_items(state)),
        },
        "doctor": state.doctor,
        "diff": diff,
        "build_time": build_time,
    }


def make_handler(state: WebState, jm: JobManager, token: str, dist: Path, holder: "dict | None" = None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):  # silence default stderr logging
            pass

        def _send_json(self, obj, code=200):
            body = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_bytes(self, body: bytes, ctype: str, code=200, extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        # ---- GET ---------------------------------------------------------
        def do_GET(self):
            path = self.path.split("?", 1)[0]
            try:
                if path == "/api/ping":
                    # Cheap liveness probe for `web status` / the daemon launcher.
                    return self._send_json({"ok": True, "theme": state.theme})
                if path == "/api/overview":
                    return self._send_json(api_overview(state))
                if path.startswith("/api/catalog/"):
                    return self._send_json(api_catalog(state, path.rsplit("/", 1)[1]))
                if path.startswith("/api/item/"):
                    _, _, _, type_, name = path.split("/", 4)
                    return self._send_json(api_item(state, type_, name))
                if path == "/api/themes":
                    return self._send_json(api_themes(state))
                if path == "/api/setup":
                    return self._send_json(api_setup(state))
                if path == "/api/doctor":
                    return self._send_json(api_doctor(state))
                if path == "/api/graph":
                    return self._send_json(api_graph(state))
                if path == "/api/mcp":
                    return self._send_json(api_mcp(state))
                if path == "/api/offline-zip":
                    data, name = offline_zip_bytes()
                    return self._send_bytes(
                        data, "application/zip",
                        extra={"Content-Disposition": f'attachment; filename="{name}"'})
                if path == "/api/diff":
                    return self._send_json(api_diff(state))
                if path == "/api/docs":
                    return self._send_json(api_docs(state))
                if path.startswith("/api/docs/page/"):
                    pid = path[len("/api/docs/page/"):]
                    return self._send_json(
                        api_docs_page(state, urllib.parse.unquote(pid)))
                if path == "/api/specs":
                    return self._send_json(api_specs(state))
                if path == "/api/jobs":
                    return self._send_json({"jobs": jm.recent()})
                if path.startswith("/api/jobs/"):
                    j = jm.get(path.rsplit("/", 1)[1])
                    return self._send_json(j) if j \
                        else self._send_json({"error": "no such job"}, 404)
                return self._serve_static(path)
            except NotFound as e:
                return self._send_json({"error": f"not found: {e}"}, 404)
            except Exception as e:  # noqa: BLE001
                return self._send_json({"error": str(e)}, 500)

        def _read_json_body(self) -> dict:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = 0
            if not length:
                return {}
            try:
                obj = json.loads(self.rfile.read(length) or b"{}")
                return obj if isinstance(obj, dict) else {}
            except Exception:  # noqa: BLE001
                return {}

        # ---- POST --------------------------------------------------------
        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if self.headers.get("X-Geneseed-Token") != token:
                return self._send_json({"error": "forbidden"}, 403)
            if path == "/api/shutdown":
                # Graceful self-stop, used by the in-page Stop control and
                # `geneseed web stop`. shutdown() must run off the request thread
                # or it deadlocks against serve_forever().
                srv = holder.get("srv") if holder else None
                if srv is not None:
                    threading.Thread(target=srv.shutdown, daemon=True).start()
                return self._send_json({"stopping": True})
            if path == "/api/mcp":
                try:
                    res = api_mcp_toggle(state, self._read_json_body())
                except NotFound as e:
                    return self._send_json({"error": f"not found: {e}"}, 404)
                return self._send_json(res, 200 if res.get("ok") else 409)
            if path == "/api/memory/delete":
                try:
                    return self._send_json(
                        api_memory_delete(state, (self._read_json_body().get("name") or "")))
                except NotFound as e:
                    return self._send_json({"error": f"not found: {e}"}, 404)
            if path.startswith("/api/jobs/") and path.endswith("/cancel"):
                jid = path.split("/")[3]
                if jm.cancel(jid):
                    return self._send_json({"cancelled": jid})
                return self._send_json({"error": "no running job by that id"}, 404)
            if path.startswith("/api/actions/"):
                action = path.rsplit("/", 1)[1]
                body = self._read_json_body()
                # Restore is synchronous (one render, same cost as a diff GET)
                # and returns a structured result instead of a job id.
                if action == "restore":
                    return self._send_json(
                        api_restore(state, body.get("files") or []))
                # Build can be re-themed/re-targeted from the UI picker; the other
                # actions self-resolve the deployed theme downstream.
                if action == "build":
                    theme, emit = _build_override(state, body)
                else:
                    theme, emit = state.theme, state.emit
                cmds = action_commands(action, theme=theme, emit=emit)
                if not cmds:
                    return self._send_json({"error": f"unknown action {action}"}, 404)
                # Refresh when the job FINISHES — a Build may re-theme the
                # install, and the re-detect must read the new marker.
                jid = jm.start(action, *cmds, on_done=state.refresh)
                if jid is None:
                    return self._send_json({"error": "busy"}, 409)
                return self._send_json({"job_id": jid}, 202)
            return self._send_json({"error": "not found"}, 404)

        # ---- static (committed React build) ------------------------------
        def _serve_static(self, path):
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            fp = (dist / rel).resolve()
            if dist not in fp.parents and fp != (dist / "index.html").resolve():
                # SPA fallback: unknown / out-of-tree path -> index.html
                fp = dist / "index.html"
            if not fp.is_file():
                fp = dist / "index.html"
            if not fp.is_file():
                return self._send_json(
                    {"error": "web/dist missing — run the UI build"}, 500)
            data = fp.read_bytes()
            if fp.name == "index.html":
                inject = f'<script>window.__GENESEED_TOKEN__="{token}";</script>'
                data = data.replace(b"</head>", inject.encode() + b"</head>", 1)
            ctype = {
                ".html": "text/html", ".js": "text/javascript",
                ".css": "text/css", ".json": "application/json",
                ".svg": "image/svg+xml", ".ico": "image/x-icon",
                ".woff2": "font/woff2",
                ".webmanifest": "application/manifest+json",
                ".png": "image/png",
            }.get(fp.suffix, "application/octet-stream")
            return self._send_bytes(data, ctype)

    return Handler


# ---- daemon mode -----------------------------------------------------------
# `geneseed web start|stop|status` runs the server detached so it never blocks
# the terminal. State (pid/port/token/url) is written by the running server to a
# small JSON file beside the deployed host state; control is over HTTP — `stop`
# and the in-page Stop button both POST /api/shutdown — so we never need
# OS-specific process-kill semantics, only a localhost request with the token.

def _state_path(target: Path) -> Path:
    return target / ".geneseed-web.json"


def read_daemon(target: Path) -> "dict | None":
    try:
        return json.loads(_state_path(target).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_daemon(target: Path, data: dict) -> None:
    try:
        target.mkdir(parents=True, exist_ok=True)
        _state_path(target).write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass


def clear_daemon(target: Path) -> None:
    try:
        _state_path(target).unlink()
    except OSError:
        pass


def _probe(url: str, timeout: float = 1.5) -> bool:
    """True if a Geneseed server is answering at url (GET /api/ping)."""
    try:
        with urllib.request.urlopen(f"{url}/api/ping", timeout=timeout) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def _post_shutdown(url: str, token: str, timeout: float = 3.0) -> bool:
    req = urllib.request.Request(
        f"{url}/api/shutdown", data=b"{}", method="POST",
        headers={"X-Geneseed-Token": token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def _live_daemon(target: Path) -> "dict | None":
    """Return the daemon state only if a server is actually answering; otherwise
    clear a stale state file and return None."""
    st = read_daemon(target)
    if st and st.get("url") and _probe(st["url"]):
        return st
    if st:
        clear_daemon(target)
    return None


def start_daemon(theme: "str | None", port: int, open_browser: bool = True) -> int:
    """Start the server detached (singleton). If one is already running, just
    reopen the browser. Returns 0 on success."""
    target = WebState(theme=theme).target
    st = _live_daemon(target)
    if st:
        print(f"[web] already running on {st['url']}  (pid {st.get('pid')})")
        if open_browser:
            with contextlib.suppress(Exception):
                webbrowser.open(st["url"])
        return 0
    clear_daemon(target)
    log = target / ".geneseed-web.log"
    cmd = [sys.executable, str(Path(__file__).resolve().parent.parent / "rituals" / "harness.py"),
           "web", "--daemon-internal", "--port", str(port), "--no-browser"]
    if theme:
        cmd += ["--theme", theme]
    kwargs: dict = {"stdin": subprocess.DEVNULL}
    try:
        logf = open(log, "ab")
        kwargs["stdout"] = logf
        kwargs["stderr"] = subprocess.STDOUT
    except OSError:
        kwargs["stdout"] = subprocess.DEVNULL
        kwargs["stderr"] = subprocess.DEVNULL
    if os.name == "nt":
        kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen(cmd, **kwargs)
    # Wait for the child to bind and write its state (pid/port/url).
    for _ in range(60):
        st = read_daemon(target)
        if st and st.get("url") and _probe(st["url"], timeout=0.5):
            print(f"[web] Geneseed UI on {st['url']}  (theme: {st.get('theme')}, pid {st.get('pid')})")
            print("[web] running in the background — `geneseed web stop` to stop it.")
            if open_browser:
                with contextlib.suppress(Exception):
                    webbrowser.open(st["url"])
            return 0
        time.sleep(0.2)
    print("[web] daemon did not come up in time — check the log:")
    print(f"      {log}")
    return 1


def stop_daemon(theme: "str | None" = None) -> int:
    target = WebState(theme=theme).target
    st = read_daemon(target)
    if not st or not st.get("url"):
        print("[web] no running server recorded.")
        return 0
    if _post_shutdown(st["url"], st.get("token", "")):
        clear_daemon(target)
        print(f"[web] stopped (pid {st.get('pid')}).")
        return 0
    # Server unreachable — the state was stale.
    clear_daemon(target)
    print("[web] no live server (cleared a stale record).")
    return 0


def status_daemon(theme: "str | None" = None) -> int:
    target = WebState(theme=theme).target
    st = _live_daemon(target)
    if st:
        print(f"[web] running on {st['url']}  (theme: {st.get('theme')}, pid {st.get('pid')})")
        return 0
    print("[web] not running.")
    return 1


def restart_daemon(theme: "str | None" = None, port: int = 4747,
                   open_browser: bool = True, only_if_running: bool = False) -> int:
    """Stop and start the daemon so it picks up new source / static bundle.
    Preserves the port the running daemon was bound to; with no daemon running,
    falls back to `port`. With `only_if_running=True` returns 0 silently when
    nothing was running — used by `geneseed upgrade` to refresh a live daemon
    without spawning one the user didn't ask for."""
    target = WebState(theme=theme).target
    st = read_daemon(target)
    live = _live_daemon(target) is not None
    if only_if_running and not live:
        return 0
    use_port = (st.get("port") if st and st.get("port") else None) or port
    if live:
        stop_daemon(theme)
        # Wait briefly for the OS to release the port before re-binding;
        # otherwise start_daemon falls back to a random free port and any
        # client (the PWA) cached on the old URL would miss the new server.
        for _ in range(50):
            if not _probe(f"http://127.0.0.1:{use_port}", timeout=0.2):
                break
            time.sleep(0.1)
    return start_daemon(theme, use_port, open_browser=open_browser)


def _build_plan(dist: Path, web_dir: Path, npm: str | None, interactive: bool) -> str:
    """Pure: what serve() should do about the UI bundle. 'serve' when dist is
    built; otherwise 'no-source' (web/ never arrived), 'no-npm', 'no-tty'
    (cannot prompt — scripts/CI), or 'ask' (buildable and interactive)."""
    if (dist / "index.html").is_file():
        return "serve"
    if not (web_dir / "package.json").is_file():
        return "no-source"
    if not npm:
        return "no-npm"
    if not interactive:
        return "no-tty"
    return "ask"


def _npm_build(npm: str, web_dir: Path) -> int:
    """Run npm install then npm run build in web/, output inherited so a slow
    or proxied install stays visible. Returns the first non-zero exit code."""
    for step in (("install",), ("run", "build")):
        print(f"[web] npm {' '.join(step)} ...")
        code = subprocess.run([npm, *step], cwd=web_dir).returncode
        if code:
            print(f"[web] npm {' '.join(step)} failed (exit {code}).")
            return code
    return 0


def serve(theme: str | None = None, port: int = 4747, open_browser: bool = True,
          daemon: bool = False) -> int:
    dist = ROOT / "web" / "dist"
    web_dir = ROOT / "web"
    manual = "        cd web && npm install && npm run build"
    plan = _build_plan(dist, web_dir, shutil.which("npm"), sys.stdin.isatty())
    if plan == "no-source":
        print(f"[web] web/ sources are missing from {ROOT}.")
        print("      Run `geneseed upgrade` to fetch them (twice on installs whose")
        print("      updater predates web/ in the sync list).")
        return 1
    if plan == "no-npm":
        print("[web] web/dist is missing and npm was not found. Install Node.js,")
        print("      then build the UI:")
        print(manual)
        return 1
    if plan == "no-tty":
        print("[web] web/dist is missing. Build the UI first:")
        print(manual)
        return 1
    if plan == "ask":
        try:
            answer = input("[web] UI not built — run npm install && npm run build now? [Y/n] ")
        except (EOFError, KeyboardInterrupt):
            answer = "n"
        if answer.strip().lower() in ("", "y", "yes"):
            code = _npm_build(shutil.which("npm"), web_dir)
            if code:
                return code
        else:
            print("[web] skipped. Build the UI manually:")
            print(manual)
            return 0
    state = WebState(theme=theme)
    if not (state.target / build.GLOBAL_MANIFEST).exists():
        print(f"[web] no deployed harness at {state.target}.")
        print("      Run `geneseed setup` first — serving anyway (read-only UI).")
    # Console history lives beside the deployed host state (context.json & co);
    # writes fail silently when nothing is deployed there yet.
    jm = JobManager(history_path=state.target / ".geneseed-web-runs.json")
    token = secrets.token_urlsafe(24)
    holder: dict = {}
    Handler = make_handler(state, jm, token, dist, holder)
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)  # fallback free port
    holder["srv"] = srv
    host_port = srv.server_address[1]
    url = f"http://127.0.0.1:{host_port}"
    # In daemon mode the running server records its own pid/port/token/url so the
    # launcher can reopen the browser and `web stop` can reach /api/shutdown.
    if daemon:
        write_daemon(state.target, {
            "pid": os.getpid(), "port": host_port, "url": url,
            "token": token, "theme": state.theme, "started": int(time.time()),
        })
    print(f"[web] Geneseed UI on {url}  (theme: {state.theme})")
    print("[web] Ctrl-C to stop." if not daemon else "[web] daemon ready.")
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[web] stopped.")
    finally:
        if daemon:
            clear_daemon(state.target)
    return 0
