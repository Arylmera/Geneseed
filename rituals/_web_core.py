"""Geneseed web — shared primitives for the web.* submodules.

Owns the dependency-free imports, ROOT, the build/harness handles, the
SECTIONS/DOC_GROUPS/GLOSSARY registries and the WebState/NotFound core.
Re-exported so each submodule can `from _web_core import *`; cross-submodule
names are linked at import time by web.py (the facade)."""
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
            "- **`AGENT.md`** — 21 universal Rules the agent obeys.\n"
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
            "[Agents](#/section/agents) · [Rules](#/laws)")},
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
         "space). On OpenCode, five **Plugins** bind the pieces to the host: "
         "context injection, learn-at-session-end, the safety guard, the "
         "saved workflow runner, and end-of-run notifications. The structure "
         "is theme-independent — a "
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
         "link": {"hash": "#/laws", "label": "Browse the ledger →"},
         "body": "21 universal laws the agent obeys — secrets handling, "
         "scope discipline, verify-before-assert, surface-failures, context "
         "economy, load-the-docs, tool-discovery, non-interactive-shell, and "
         "more. Each law is a "
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
         "body": "OpenCode loads five plugins from the deployed bundle:\n\n"
         "- **geneseed-context** — injects the project's docs *and* your "
         "machine wiki at every session start (and after compaction).\n"
         "- **geneseed-learn** — distils memory at session end (powers the "
         "`learn` skill).\n"
         "- **geneseed-guard** — enforces the safety Laws and protected wiki "
         "folders at the tool boundary.\n"
         "- **geneseed-workflow** — registers the `workflow` tool that runs "
         "saved orchestration scripts.\n"
         "- **geneseed-notify** — sends a native OS notification when a long "
         "run finishes, so you can step away and be called back."},
    ]},
    # ── 3. How-to ─────────────────────────────────────────────────────────
    # One task per page — most sliced out of SETUP.md (the git-worktree
    # add-on slices the OpenCode adapter README) so prose isn't duplicated.
    # The reader picks the page that matches what they need to do, not
    # which source file it lives in.
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
        {"id": "worktree", "title": "Add git-worktree isolation (OpenCode)",
         "kind": "markdown", "source": "adapters/opencode/README.md",
         "anchor": "optional-add-on-git-worktree-isolation-third-party-not-vendored",
         "slice": True},
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
    # ── 4. MCP servers ────────────────────────────────────────────────────
    # Wiring the four MCP presets into OpenCode / Claude Code. The overview
    # is an inline concept; each preset and the verify step slice the
    # canonical prose out of SETUP.md so README readers and panel readers
    # stay single-sourced.
    {"id": "mcp", "label": "MCP servers", "pages": [
        {"id": "mcp-overview", "title": "MCP overview", "kind": "concept",
         "body":
         "The Harness ships **four** ready-to-wire MCP servers as presets — "
         "**MarkItDown** (PDF/Office → Markdown), **GitLab** (two entries, "
         "one per instance), and **Filesystem** (scoped file access). Each is a "
         "*local* server the agent launches on demand: registering one only "
         "points the agent at a command — *you* install the tool (or let "
         "`npx`/`pipx` fetch it) and supply any credentials.\n\n"
         "### Where they live\n\n"
         "On OpenCode they sit under the `mcp` key of an `opencode.json` "
         "(global `~/.config/opencode/opencode.json` or per-repo), each "
         "entry shaped:\n\n"
         "```json\n"
         "\"<name>\": { \"type\": \"local\", \"command\": [\"…\"], "
         "\"environment\": {}, \"enabled\": true }\n"
         "```\n\n"
         "On Claude Code the same servers live in `.mcp.json` under "
         "`mcpServers` — note the key is `env` (not `environment`) and the "
         "command and its args are split into `command` + `args`. See "
         "[Claude Code wiring](#/docs/mcp-claude-code).\n\n"
         "### Toggle them without hand-editing JSON\n\n"
         "`./geneseed` → **Settings** → **MCP servers** toggles any of the "
         "four presets into your project or global `opencode.json` — and "
         "enables, disables, or removes them — for you. The reference "
         "config ships MarkItDown enabled and the GitLab / Filesystem "
         "entries disabled, so a merge never activates a credential-less "
         "server: fill the blanks, then flip the one(s) you want on.\n\n"
         "> **Never commit a real token.** The presets and the reference "
         "[`adapters/opencode/opencode.json`](#/docs/adapters-opencode) "
         "carry **empty** `GITLAB_PERSONAL_ACCESS_TOKEN` placeholders (and "
         "a sample filesystem path) — fill them in your own config, never "
         "in a tracked file (universal Law I — secrets).\n\n"
         "---\n\n"
         "**Wire one up:** [MarkItDown](#/docs/mcp-markitdown) · "
         "[GitLab](#/docs/mcp-gitlab) · "
         "[Filesystem](#/docs/mcp-filesystem) · "
         "[Claude Code](#/docs/mcp-claude-code) · "
         "[Verify](#/docs/mcp-verify)"},
        {"id": "mcp-markitdown", "title": "MarkItDown (PDF/Office)",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "markitdown-via-mcp-opencode", "slice": True},
        {"id": "mcp-gitlab", "title": "GitLab",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "gitlab-one-entry-per-instance", "slice": True},
        {"id": "mcp-filesystem", "title": "Filesystem",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "filesystem", "slice": True},
        {"id": "mcp-claude-code", "title": "Claude Code",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "claude-code", "slice": True},
        {"id": "mcp-verify", "title": "Verify",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "verify", "slice": True},
    ]},
    # ── 5. Reference ──────────────────────────────────────────────────────
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
    # ── 6. Deeper ─────────────────────────────────────────────────────────
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

    def refresh(self):
        """Drop caches and re-detect the deployed theme/emit — a finished Build may
        have re-themed the install, and the gallery's 'current' must follow it."""
        self._inv = None
        self._doctor = None
        self.theme = harness._theme_of_dir(self.target) or self.theme
        self.emit = harness._installed_defaults().get("emit") or self.emit


def _deployed(state: WebState) -> bool:
    return (state.target / build.GLOBAL_MANIFEST).exists()


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
        out.append({"name": name, "desc": build._first_blockquote(body),
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
    return {"agents": _spec_entries(state.target / "agents", nested=False),
            "skills": _spec_entries(state.target / "skills", nested=True),
            "laws": render["laws"], "theme": state.theme}
