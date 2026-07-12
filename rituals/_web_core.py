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
            "**Next:** [Posture & footprint](#/docs/setup-choices) · "
            "[Verify it works](#/docs/verify) · "
            "[What you just installed](#/docs/model) · "
            "[Install by hand instead](#/docs/install-paths)")},
        {"id": "setup-choices", "title": "Posture & footprint",
         "kind": "concept", "body": (
            "Besides the theme (the *voice*), the setup wizard asks two "
            "starting parameters. Both have safe defaults — accept them and "
            "move on, or pick deliberately here. Both are set-and-forget: "
            "preserved across every rebuild and re-theme, changeable later "
            "from **Settings**, the **Harnesses** page, or the wizard.\n\n"
            "### Posture — the relationship register\n\n"
            "How the agent works *with you*, fixed at build time so it "
            "doesn't drift mid-session:\n\n"
            "- **peer** *(default)* — candid equal: dense, challenges, no "
            "flattery.\n"
            "- **mentor** — explains the why, checks understanding.\n"
            "- **expert** — maximum density, no basics.\n"
            "- **assistant** — precise execution, low initiative; you steer.\n"
            "- **artisan** — peer with toolsmith reflexes, terminal-first.\n\n"
            "Pick **peer** unless you know you want another register. "
            "Posture is orthogonal to theme: theme changes the prose, "
            "posture changes the relationship.\n\n"
            "### Footprint — full or lean Rules\n\n"
            "How much of the Rules `AGENT.md` carries inline every turn. "
            "A token-cost dial, not a rules cut — every Rule always applies:\n\n"
            "- **full** *(default)* — every Rule's text *and* rationale "
            "inline. Best when token cost is a non-issue or you run a "
            "smaller model.\n"
            "- **lean** — one line per Rule plus a pointer to the complete "
            "laws file, read on demand. Trims the Rules section by roughly "
            "40% for long sessions or cost-sensitive runs.\n\n"
            "---\n\n"
            "**Deeper:** [The collaboration layer](#/docs/collaboration) · "
            "[Footprint (lean vs full)](#/docs/footprint) · "
            "**Next:** [Verify it works](#/docs/verify)")},
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
            "<!--harness:opencode-->\n"
            "### 3. Context delivery\n\n"
            "Start a session with `GENESEED_DEBUG=1` set. The context "
            "plugin logs what it discovered and injected; you should see "
            "the repo's `README.md` and any docs listed.\n"
            "<!--/harness-->\n\n"
            "---\n\n"
            "Trouble? See [Troubleshooting](#/docs/trouble).")},
        {"id": "first-session", "title": "Your first session",
         "kind": "concept", "body": (
            "Once installed, the agent doesn't change *how* you talk to "
            "your tool — it changes what the tool already knows when you do.\n\n"
            "### What loaded automatically\n\n"
            "- **`AGENT.md`** — {N_LAWS} universal Rules the agent obeys.\n"
            "- **Your repo's docs** — `README.md`, `CONTRIBUTING.md`, "
            "anything under `docs/` the harness discovers.\n"
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
         "space).\n"
         "<!--harness:opencode-->\n"
         "On OpenCode, {N_PLUGINS} **Plugins** bind the pieces to the host: "
         "context injection, learn-at-session-end, the safety guard, the "
         "saved workflow runner, end-of-run notifications, a live-activity "
         "feed for this console, and an opt-in minimal-code mode.\n"
         "<!--/harness-->\n"
         "<!--harness:claude-->\n"
         "On Claude Code, three settings.json **hooks** bind the pieces to "
         "the host — context injection, the git safety gate, and "
         "learn-at-session-end. See [How Geneseed binds to Claude Code]"
         "(#/docs/claude-hooks).\n"
         "<!--/harness-->\n"
         "The structure "
         "is theme-independent — a "
         "theme only changes the *voice* (banner, sigil, prose), never a "
         "folder or a link. A separate dial, the **[footprint](#/docs/footprint)**, "
         "sets how much of the Rules load inline each turn (full vs lean), and "
         "the **[collaboration layer](#/docs/collaboration)** — posture, the "
         "Pact, typed memory, your profile — shapes how the agent works "
         "*with you*.\n\n"
         "### What this UI actually shows\n\n"
         "The **Library** and **Graph** render the Geneseed source live — "
         "they show the harness that *would* be deployed if you rebuilt "
         "right now. The **Settings** panes and the **Memory** drawer read "
         "from the deployed harness on disk (the harness install dir, e.g. "
         "`~/.config/opencode/…` for an OpenCode global install).\n\n"
         "If you've built recently, the two match. If you edit a file under "
         "`src/` and reload this panel, the Library updates immediately — "
         "the deployed bundle does not, until the next `geneseed update` or "
         "`build`."},
        {"id": "rules", "title": "Rules (Laws)", "kind": "concept",
         "link": {"hash": "#/laws", "label": "Browse the ledger →"},
         "body": "{N_LAWS} universal laws the agent obeys — secrets handling, "
         "scope discipline, verify-before-assert, surface-failures, context "
         "economy, load-the-docs, tool-discovery, non-interactive-shell, and "
         "more. Each law is a "
         "short markdown file under `src/laws/` and the rendered numbered "
         "list lives in `AGENT.md`. They bind regardless of theme: an "
         "imperial deploy reads them as *Dictates*, a neutral deploy as "
         "*Rules*, but the numbering and the rule itself never move."},
        {"id": "agents", "title": "Agents", "kind": "concept",
         "link": {"hash": "#/section/agents", "label": "Browse the catalog →"},
         "body": "{N_AGENTS} capability specialists — `reviewer`, `tester`, "
         "`architect`, `docs`, `security`, `explorer`, plus a debate "
         "**council** the [[council]] skill convenes (`advocate`, `skeptic`, "
         "`pragmatist`, `steward`, `visionary`, `user-advocate`, `framer`, "
         "`empiricist`, `operator`, `historian`). You delegate by capability, "
         "not by folder: the harness picks the right specialist from the "
         "request."},
        {"id": "skills", "title": "Skills", "kind": "concept",
         "link": {"hash": "#/section/skills", "label": "Browse the catalog →"},
         "body": "{N_SKILLS} repeatable workflows the agent can invoke by "
         "name — from [[brainstorm]], [[clarify]], [[plan]], [[tdd]] and "
         "[[debug]] through [[council]], [[research]] and [[ship]] to "
         "[[roast-me]]. A skill is a markdown playbook under `src/skills/`; "
         "the agent reads it before acting. The catalog link lists every one, "
         "live."},
        {"id": "memory", "title": "Memory convention", "kind": "markdown",
         "source": "src/memory/README.md"},
        {"id": "notebook", "title": "Notebook (sovereign space)",
         "kind": "markdown", "source": "src/notebook/README.md"},
        {"id": "wiki", "title": "Wiki (machine knowledge base)",
         "kind": "markdown", "source": "docs/wiki.md"},
        {"id": "themes", "title": "Voice vs structure (themes)",
         "kind": "markdown", "source": "DESIGN.md", "anchor": "decisions",
         "slice": True},
        {"id": "footprint", "title": "Footprint (lean vs full)", "kind": "concept",
         "link": {"hash": "#/settings", "label": "Toggle it in Settings →"},
         "body":
         "**Footprint** controls how much of the Rules your agent carries *inline* "
         "in `AGENT.md` every turn. Two states — **full** (the default) and "
         "**lean** — set per install. It's a token-cost dial, not a change to which "
         "Rules apply: every Rule is always in force, and across lean and full the "
         "emitted files are otherwise identical — same Agents, Skills, plugins, "
         "commands, Memory, and Notebook.\n\n"
         "### The difference\n\n"
         "- **Full** — Section 1 of `AGENT.md` inlines every Rule's complete text "
         "*and* its reasoning. The agent sees the full law set, rationale included, "
         "on every single turn.\n"
         "- **Lean** — Section 1 carries each Rule as its **heading + the rule "
         "itself** (one line), followed by a pointer to the complete law file "
         "(`laws/universal.md`, shipped beside `AGENT.md`) — the agent reads the "
         "rationale on demand when a rule's application is unclear. Lean trims "
         "Section 1 by roughly 40%.\n\n"
         "### Which to choose\n\n"
         "- Keep **full** if token cost is a non-issue, you want the rationale "
         "always present, or you run a smaller/cheaper model — with the *why* "
         "eagerly in context, a model applies a Rule's nuance more reliably. "
         "This is why full is the default.\n"
         "- Switch to **lean** to reclaim context and cost on long sessions, "
         "large repos, or cost-sensitive runs, trusting the agent to pull the "
         "full law when it needs the *why*. Lean is **safe**: the complete law "
         "text still ships, and the harness explicitly points the agent there "
         "before acting on secrets, deletion, git history, scope, or untrusted "
         "content. It's an optimization, not a rules cut.\n\n"
         "### How to set it\n\n"
         "It's set-and-forget — stored in the `.geneseed-footprint` marker, "
         "preserved across every rebuild, identical on every host (OpenCode, "
         "Claude Code, Bob, Copilot). Changing it re-emits the install.\n\n"
         "- **Settings** — the **Footprint** toggle flips the current install "
         "(full ⇄ lean) and rebuilds it in place.\n"
         "- **Harnesses tab** — a per-harness dropdown sets it for any one install "
         "independently, then **Apply**.\n"
         "- **Setup / re-theme wizard** (TUI) — asks for footprint alongside voice "
         "and mode.\n"
         "- **CLI** — `build.py --footprint lean` (with any `--emit`).\n\n"
         "---\n\n"
         "**Related:** [Rules (Laws)](#/laws) · [Voice vs structure](#/docs/themes) "
         "· [Token footprint — the numbers](#/docs/token-footprint)"},
        {"id": "plugins", "title": "Plugins (OpenCode)", "kind": "concept",
         "harness": "opencode",
         "link": {"hash": "#/docs/plugin-context",
                  "label": "One page per plugin →"},
         "body": "OpenCode loads {N_PLUGINS} plugins from the deployed bundle:\n\n"
         "- **geneseed-context** — injects the project's docs *and* your "
         "machine wiki at every session start (and after compaction).\n"
         "- **geneseed-learn** — distils memory at session end (powers the "
         "`learn` skill).\n"
         "- **geneseed-guard** — enforces the safety Laws and protected wiki "
         "folders at the tool boundary.\n"
         "- **geneseed-workflow** — registers the `workflow` tool that runs "
         "saved orchestration scripts.\n"
         "- **geneseed-notify** — sends a native OS notification when a long "
         "run finishes, so you can step away and be called back.\n"
         "- **geneseed-ponytail** — holds an opt-in minimal-code mode "
         "(`/ponytail lite|full|ultra|off`), injecting the laziest-that-works "
         "ruleset every turn so it doesn't drift.\n"
         "- **geneseed-activity** — streams what each live session is *doing* "
         "(phase, model, tokens, files touched) to this console's Activity "
         "view."},
        {"id": "collaboration", "title": "The collaboration layer",
         "kind": "concept", "body": (
            "Beyond the Laws, four mechanisms shape *how* the agent works "
            "with you — the register, the mutual contract, how memory binds, "
            "and who you are. All four are plain content in `AGENT.md` and "
            "its neighbours, so they ride to every host (OpenCode, Claude, "
            "Bob, Copilot) unchanged.\n\n"
            "### Postures — the register\n\n"
            "A **posture** is the relationship register the agent works in, "
            "chosen by *you* at setup and fixed at build time so it holds "
            "steady instead of drifting back toward plain execution "
            "mid-session. Five ship: **peer** (default — a candid equal), "
            "**mentor** (explains the why), **expert** (maximum density), "
            "**assistant** (precise, low-initiative), **artisan** (peer with "
            "toolsmith reflexes). Posture is orthogonal to theme: theme is "
            "the *voice*, posture is the *relationship*. Change it in the "
            "setup wizard, from the **Harnesses** page here (the per-install "
            "posture dropdown, next to voice and footprint), or with "
            "`build.py --posture <name>`. A rebuild or re-theme preserves it.\n\n"
            "### The Pact — a two-way contract\n\n"
            "Where the Laws bind the agent, the **Pact** binds the "
            "collaboration. It holds three co-equal protections (you, the "
            "truth, the agent) and — unusually — names what *you* owe back: "
            "don't punish candour that honours the pact, give context up "
            "front, decide when shown a fork. It is framing, not an enforced "
            "rule.\n\n"
            "### Typed memory — binding force\n\n"
            "A memory may carry an optional `force` — **constraint** "
            "(imposed, not the agent's to relax), **choice** (revisable with "
            "consent), **conviction** (revisable on evidence), or "
            "**tempered** (a relaxed constraint). When new evidence "
            "contradicts a forced memory, the Bridge rule requires revising "
            "it in the open rather than dropping it silently.\n\n"
            "### Your profile — identity\n\n"
            "`PROFILE.md`, seeded once beside `AGENT.md` and never "
            "overwritten, holds *who you are*: role, habits, register "
            "preferences. It is identity, not rules — it colours how the "
            "agent works but never binds (precedence is Laws, then "
            "`user-rules.md`, then the profile). Edit it here under the "
            "**Profile** tab, or in the file directly — or let the agent "
            "draft it: the [[profile]] skill interviews you (who you are, "
            "how you work, how you like answers pitched) and writes the "
            "file only with your consent, routing anything that is really "
            "a standing rule to `user-rules.md` instead.")},
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
         "kind": "markdown", "harness": "opencode",
         "source": "adapters/opencode/README.md",
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
    ]},
    # ── 4. MCP servers ────────────────────────────────────────────────────
    # Wiring the four MCP presets into OpenCode / Claude Code. The overview
    # is an inline concept; each preset and the verify step slice the
    # canonical prose out of SETUP.md so README readers and panel readers
    # stay single-sourced.
    {"id": "mcp", "label": "MCP servers", "pages": [
        {"id": "mcp-overview", "title": "MCP overview", "kind": "concept",
         "body":
         "The Harness ships **three** ready-to-wire MCP servers as presets — "
         "**MarkItDown** (PDF/Office → Markdown), **GitLab** (shipped as two "
         "entries, one per instance), and **Filesystem** (scoped file access) "
         "— four config entries in all. Each is a "
         "*local* server the agent launches on demand: registering one only "
         "points the agent at a command — *you* install the tool (or let "
         "`npx`/`pipx` fetch it) and supply any credentials.\n\n"
         "### Where they live\n\n"
         "<!--harness:opencode-->\n"
         "They sit under the `mcp` key of an `opencode.json` "
         "(global `~/.config/opencode/opencode.json` or per-repo), each "
         "entry shaped:\n\n"
         "```json\n"
         "\"<name>\": { \"type\": \"local\", \"command\": [\"…\"], "
         "\"environment\": {}, \"enabled\": true }\n"
         "```\n"
         "<!--/harness-->\n"
         "<!--harness:claude-->\n"
         "They live in `.mcp.json` under "
         "`mcpServers` — note the key is `env` (not `environment`) and the "
         "command and its args are split into `command` + `args`. See "
         "[Claude Code wiring](#/docs/mcp-claude-code).\n"
         "<!--/harness-->\n\n"
         "<!--harness:opencode-->\n"
         "### Toggle them without hand-editing JSON\n\n"
         "`./geneseed` → **Settings** → **MCP servers** toggles any of the "
         "presets into your project or global `opencode.json` — and "
         "enables, disables, or removes them — for you. The reference "
         "config ships MarkItDown enabled and the GitLab / Filesystem "
         "entries disabled, so a merge never activates a credential-less "
         "server: fill the blanks, then flip the one(s) you want on.\n"
         "<!--/harness-->\n\n"
         "> **Never commit a real token.** The presets ship with **empty** "
         "`GITLAB_PERSONAL_ACCESS_TOKEN` placeholders (and a sample "
         "filesystem path) — fill them in your own config, never in a "
         "tracked file (universal Law I — secrets).\n\n"
         "---\n\n"
         "**Wire one up:** [MarkItDown](#/docs/mcp-markitdown) · "
         "[GitLab](#/docs/mcp-gitlab) · "
         "[Filesystem](#/docs/mcp-filesystem) · "
         "[Verify](#/docs/mcp-verify) · "
         "[Won't connect?](#/docs/mcp-trouble)\n\n"
         "> **Listed ≠ working.** A `local` server is just a command the agent "
         "runs — it appears in the list whether or not that command actually "
         "launches. The usual cause of \"shown but not working\" is the command "
         "not being on PATH (e.g. `markitdown-mcp` with no `uvx`/pipx install) "
         "or a filesystem entry left on its placeholder path. "
         "[Walk the fixes →](#/docs/mcp-trouble)"},
        {"id": "mcp-markitdown", "title": "MarkItDown (PDF/Office)",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "markitdown-via-mcp", "slice": True},
        {"id": "mcp-gitlab", "title": "GitLab",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "gitlab-one-entry-per-instance", "slice": True},
        {"id": "mcp-filesystem", "title": "Filesystem",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "filesystem", "slice": True},
        {"id": "mcp-claude-code", "title": "Claude Code",
         "kind": "markdown", "harness": "claude", "source": "SETUP.md",
         "anchor": "claude-code", "slice": True},
        {"id": "mcp-verify", "title": "Verify",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "verify", "slice": True},
        {"id": "mcp-trouble", "title": "Won't connect?",
         "kind": "markdown", "source": "SETUP.md",
         "anchor": "mcp-server-wont-connect", "slice": True},
    ]},
    # ── Language servers (LSP) ────────────────────────────────────────────
    # Sits between MCP and Plugins so the nav reads as a capability cluster —
    # the three things OpenCode loads. OpenCode-only (Claude Code doesn't drive LSP).
    {"id": "lsp", "label": "Language servers", "harness": "opencode", "pages": [
        {"id": "lsp-overview", "title": "Code intelligence (LSP)", "kind": "concept",
         "body": (
            "OpenCode can drive Language Server Protocol servers so the agent sees "
            "real diagnostics, type errors, and go-to-definition — not just text. "
            "Geneseed turns this on for every language OpenCode ships a server for.\n\n"
            "### What's covered out of the box\n\n"
            "| Language | Server | You install? |\n"
            "|---|---|---|\n"
            "| JavaScript / TypeScript / React / React Native | typescript-language-server | No — OpenCode self-downloads |\n"
            "| Python | pyright | No — OpenCode self-downloads |\n"
            "| Java | jdtls | **JDK 21+** (OpenCode downloads jdtls itself) |\n"
            "| SQL / PostgreSQL / Oracle | *none — by design* | — |\n\n"
            "One server covers JavaScript, TypeScript, React, and React Native — "
            "they are all TS/JS, so no extra server is needed.\n\n"
            "### The one prerequisite the harness can't self-install\n\n"
            "OpenCode downloads the JS-runtime servers automatically on first use. "
            "It cannot install a JVM, and jdtls needs one — so the setup wizard "
            "checks for it and prints an install hint if missing:\n\n"
            "- **Java 21+** — `brew install openjdk@21`, SDKMAN "
            "`sdk install java 21-tem`, or your distro's JDK.\n\n"
            "### Why no SQL server\n\n"
            "A SQL language server is dialect-locked — a Postgres server flags "
            "Oracle SQL as errors and vice versa — and a `.sql` file can map to "
            "only one server, with no signal for which dialect a repo uses. Rather "
            "than guess wrong for half of all SQL codebases, we ship none. A "
            "project that knows its dialect can add the matching server in its own "
            "`opencode.json` under the `lsp` key.\n\n"
            "### How it's wired\n\n"
            "`\"lsp\": true` in your emitted `opencode.json` enables every built-in "
            "server (LSP is off by default). To turn auto-download off (air-gapped "
            "machines), set `OPENCODE_DISABLE_LSP_DOWNLOAD=true` and pre-install "
            "each server.\n\n"
            "---\n\n"
            "**Verify:** open a `.ts` and a `.py` file in a session and ask the "
            "agent for diagnostics — the first open triggers the download."),
         "link": {"hash": "#/docs/adapters-opencode", "label": "OpenCode adapter →"}},
    ]},
    # ── 5. Plugins ────────────────────────────────────────────────────────
    # The shared install lives once in "Plugin setup" (the first page, sliced
    # from docs/opencode-plugin-setup.md); each plugin page then covers only its
    # own configuration and verify steps and points back to that setup page.
    {"id": "plugins", "label": "Plugins", "harness": "opencode", "pages": [
        {"id": "plugin-setup", "title": "Plugin setup", "kind": "markdown",
         "source": "docs/opencode-plugin-setup.md"},
        {"id": "plugin-context", "title": "geneseed-context", "kind": "concept",
         "body":
         "Enforces **Law XVIII** (*Load the Project Context*) by injection, "
         "not instruction: on `session.created` it auto-discovers the repo's "
         "docs by convention and injects the `eager` ones before your first "
         "turn, so the harness needs **zero per-repo files**.\n\n"
         "- **Eager** (injected in full, budget-capped): root `AGENTS.md` / "
         "`AGENT.md` / `CLAUDE.md` / `.cursorrules`, `README.md`, "
         "`CONTRIBUTING.md`.\n"
         "- **Lazy** (path + first heading, read on demand): `docs/`, `doc/`, "
         "`architecture/`, `adr/`, monorepo `packages/*/README.md`, other root "
         "`*.md`. `node_modules`, `.git`, `dist`, `build` are never scanned.\n"
         "- It re-pushes eager docs on `session.compacting` so context "
         "survives a summarised long session, and carries your machine wiki "
         "(`wiki.jsonc`) on the same budgets.\n\n"
         "### Install\n\n"
         "Installs with the other plugins in one step — see "
         "[Plugin setup](#/docs/plugin-setup).\n\n"
         "### Configure\n\n"
         "- `GENESEED_CONTEXT` — path to an explicit `context.json` manifest "
         "(or drop `.harness/context.json` in the repo) to take control: same "
         "schema, plus glob `path`s, `load: exclude`, and `\"extend\": true` "
         "to layer on top of discovery.\n"
         "- `GENESEED_EAGER_FILE_KB` (default 16) / `GENESEED_EAGER_TOTAL_KB` "
         "(default 48) — budget caps; an oversized eager file is demoted to a "
         "lazy listing, never silently truncated.\n"
         "- `GENESEED_CONTEXT_VISIBLE=1` — force the visible `PROJECT CONTEXT` "
         "block instead of the invisible per-request transform.\n"
         "- `GENESEED_CONTEXT_INJECT=off` — disable injection entirely (falls "
         "back to the soft AGENT.md Law).\n\n"
         "### Verify\n\n"
         "Start a session with `GENESEED_DEBUG=1` set — the plugin logs what "
         "it discovered and injected to stderr. Silence means it didn't load: "
         "re-check the filename and that the path is exactly the plugins dir "
         "above."},
        {"id": "plugin-learn", "title": "geneseed-learn", "kind": "concept",
         "body":
         "The runtime-agnostic counterpart of the Claude Code `Stop` hook: on "
         "`session.idle` it distils durable memories from the conversation "
         "into the bundle's `memory/` dir and maintains `MEMORY.md`, deduping "
         "against what's already stored — exactly what `geneseed learn` does, "
         "but self-contained in JS, so no Python and no model CLI are "
         "required.\n\n"
         "It distils with the **same model the session already used** (read "
         "from the transcript), inheriting your OpenCode provider config — no "
         "API key, nothing to set. Trivial sessions are skipped and any error "
         "is swallowed, so it never blocks a session.\n\n"
         "### Install\n\n"
         "Installs with the other plugins in one step — see "
         "[Plugin setup](#/docs/plugin-setup).\n\n"
         "### Configure — where it writes\n\n"
         "Memories land in the first location that resolves:\n\n"
         "1. `GENESEED_MEMORY` — an explicit memory dir;\n"
         "2. `$GENESEED_HARNESS/memory` (or `/anamnesis` for the imperial "
         "theme);\n"
         "3. `./memory` or `./Harness/memory` when the bundle lives in the "
         "project.\n\n"
         "Because the bundle is global, set `GENESEED_HARNESS` once to its "
         "absolute path so the plugin always writes to the same store no "
         "matter where you launch OpenCode. If it can't read the session's "
         "model from the transcript, set a fallback `GENESEED_MODEL="
         "provider/model`.\n\n"
         "### Verify\n\n"
         "Start a session, do a little work, end it. On `session.idle` the "
         "plugin logs `[geneseed-learn] wrote N memory file(s): …` or a skip "
         "reason to stderr. Total silence means it didn't load."},
        {"id": "plugin-guard", "title": "geneseed-guard", "kind": "concept",
         "body":
         "Enforces the safety Laws at the tool boundary "
         "(`tool.execute.before`) — the same *enforce by injection, don't just "
         "instruct* stance as the context plugin. High-confidence patterns "
         "only, so legitimate work is never caught:\n\n"
         "- **Blocks** — writes to private-key / credential files (**Law I**), "
         "catastrophic shell like `rm -rf /` (**Law IV**), and any mutation "
         "under a declared wiki's `protected` folders (AGENT.md §7, from "
         "`wiki.jsonc`).\n"
         "- **Warns** (logged, allowed) — `.env` writes and force-push.\n\n"
         "### Install\n\n"
         "Installs with the other plugins in one step — see "
         "[Plugin setup](#/docs/plugin-setup). The `protected` wiki folders are "
         "read from `wiki.jsonc` (`GENESEED_WIKI` → `$GENESEED_HARNESS/"
         "wiki.jsonc` → beside the install).\n\n"
         "### Configure\n\n"
         "- `GENESEED_GUARD=off` — disable the guard entirely.\n"
         "- `GENESEED_GUARD=warn` — downgrade every block to a warning (log, "
         "but allow).\n\n"
         "### Verify\n\n"
         "Ask the agent to do something the guard blocks (e.g. write to a "
         "`.pem` file) — it should be refused with a "
         "`[geneseed-guard] blocked: …` message naming the Law."},
        {"id": "plugin-workflow", "title": "geneseed-workflow", "kind": "concept",
         "body":
         "Registers one custom tool, `workflow`, that runs saved, code-driven "
         "orchestration scripts — the deterministic counterpart to the "
         "model-driven [[council]] / [[parallel-agents]] skills: the script, "
         "not the model, drives the control flow.\n\n"
         "- **Saved scripts only (v1):** the tool loads `<name>.js` from the "
         "sibling `workflows/` dir. No model-authored scripts are eval'd.\n"
         "- **Call shape:** `workflow({ name, args })` — call with no name to "
         "list what's available. Shipped: `council`, `review`, "
         "`research-plan-implement`.\n"
         "- **Runtime API:** scripts get `agent()`, `parallel()`, "
         "`pipeline()`, `phase()`, `log()`, `budget`, `args`. Child work runs "
         "as real OpenCode sessions; concurrency is capped at "
         "`min(16, cores − 2)`.\n\n"
         "### Install\n\n"
         "Installs with the other plugins in one step — see "
         "[Plugin setup](#/docs/plugin-setup). The build copies the plugin "
         "**and** the sibling `workflows/` dir, so the saved scripts resolve "
         "out of the box; a manual `cp` only moves the `*.js`, so copy "
         "`adapters/opencode/workflows/` alongside it too.\n\n"
         "### Configure\n\n"
         "- `GENESEED_WORKFLOWS_DIR` — override the scripts dir (defaults to "
         "`.opencode/workflows/` per-repo, `<config>/workflows/` global).\n"
         "- A phase-by-phase trace plus the full result land in "
         "`.geneseed/workflow-runs/<runId>.log`; `GENESEED_DEBUG=1` adds "
         "stderr logging.\n\n"
         "### Verify\n\n"
         "Ask the agent to *\"list available workflows\"* — it should call "
         "`workflow` with no name and return `council`, `review`, "
         "`research-plan-implement`."},
        {"id": "plugin-notify", "title": "geneseed-notify", "kind": "concept",
         "body":
         "Pings the OS when the agent finishes a turn, so you can start a long "
         "run, walk away, and be called back when it's your move again. It "
         "hooks `session.idle` like the learn plugin.\n\n"
         "- **Anti-spam:** only fires when the turn actually took a while — the "
         "gap between the session's last user prompt and now must exceed "
         "`GENESEED_NOTIFY_MIN_SECONDS` (default 30). Native subagent child "
         "sessions and the learn plugin's throwaway distil sessions are "
         "skipped.\n"
         "- **Native, dependency-free:** macOS `osascript`, Linux "
         "`notify-send` (libnotify), Windows a PowerShell balloon. Spawned "
         "detached; any failure is swallowed, so it never blocks a session.\n\n"
         "### Install\n\n"
         "Installs with the other plugins in one step — see "
         "[Plugin setup](#/docs/plugin-setup). On Linux, install `libnotify` "
         "(for `notify-send`) if nothing appears.\n\n"
         "### Configure\n\n"
         "- `GENESEED_NOTIFY=off` — disable it.\n"
         "- `GENESEED_NOTIFY_MIN_SECONDS=N` — tune the threshold (`0` notifies "
         "on every turn).\n"
         "- `GENESEED_NOTIFY_TITLE=\"…\"` — override the title (default "
         "`Geneseed`).\n\n"
         "### Verify\n\n"
         "With `GENESEED_DEBUG=1`, end a session that ran longer than the "
         "threshold — you'll see `[geneseed-notify] notified for …` and a "
         "desktop notification."},
        {"id": "plugin-ponytail", "title": "geneseed-ponytail", "kind": "concept",
         "body":
         "The sustained counterpart to the `ponytail` skill: once you opt in, "
         "it appends the laziest-that-works ruleset to the system prompt **every "
         "turn**, so the agent doesn't drift back to over-building mid-session, "
         "and it persists the level across turns.\n\n"
         "- **Opt-in:** the mode starts at `off` and injects nothing until you "
         "switch it on. Geneseed treats ponytail as a skill, not an always-on "
         "Law.\n"
         "- **Toggle:** `/ponytail lite|full|ultra|off` (a bare `/ponytail` "
         "means `full`). The level is written to `.geneseed-ponytail` beside "
         "OpenCode's config and applies from the next turn.\n"
         "- **Hooks:** `experimental.chat.system.transform` appends the "
         "ruleset; `command.execute.before` records the switch. Every failure "
         "is swallowed; on a build without the system-transform hook it simply "
         "never injects (the skill still covers the invokable path).\n\n"
         "### Install\n\n"
         "Installs with the other plugins in one step — see "
         "[Plugin setup](#/docs/plugin-setup).\n\n"
         "### Configure\n\n"
         "- `GENESEED_PONYTAIL=lite|full|ultra` — make a level the default for "
         "new installs (default `off`, i.e. dormant until asked).\n\n"
         "### Verify\n\n"
         "With `GENESEED_DEBUG=1`, run `/ponytail full` — you'll see "
         "`[geneseed-ponytail] ponytail full`, and the next turn's replies "
         "favour the minimal solution."},
        {"id": "plugin-activity", "title": "geneseed-activity", "kind": "concept",
         "body":
         "Feeds this console's **Activity** view: writes one small JSON file "
         "per session (`activity/<session_id>.json` beside the OpenCode "
         "config) recording what the harness is *doing* — current phase, "
         "model, token and cost totals, turn-elapsed, files touched, the "
         "plan, and the last error. The web server reads and prunes those "
         "files; writer and reader only ever meet on the filesystem, so a "
         "crash on either side never blocks a session.\n\n"
         "- **One entry per top-level session** — sub-agent child sessions "
         "and the learn plugin's throwaway distil sessions are skipped.\n"
         "- **Self-cleaning** — the reader prunes entries whose process is "
         "dead or whose timestamp went stale, so a crashed writer's file "
         "disappears on its own.\n\n"
         "### Install\n\n"
         "Installs with the other plugins in one step — see "
         "[Plugin setup](#/docs/plugin-setup).\n\n"
         "### Configure\n\n"
         "- `GENESEED_ACTIVITY=off` — hard kill switch at startup.\n"
         "- The **Activity** page's toggle writes a `.geneseed-activity` flag "
         "file read per event — takes effect without restarting OpenCode.\n\n"
         "### Verify\n\n"
         "Start a session, then open **Activity** in this console — a card "
         "for the session appears. `GENESEED_DEBUG=1` logs each write as "
         "`[geneseed-activity] …` to stderr."},
    ]},
    # ── Hooks (Claude Code) ───────────────────────────────────────────────
    # The Claude counterpart of the Plugins group: how the harness binds to a
    # host with no plugin dir. One page — three hooks don't need seven.
    {"id": "hooks", "label": "Hooks", "harness": "claude", "pages": [
        {"id": "claude-hooks", "title": "How Geneseed binds to Claude Code",
         "kind": "concept", "body": (
            "Claude Code has no `instructions` array and no JS plugin dir — "
            "the harness reaches it through **`settings.json` hooks** "
            "instead: the same capabilities the OpenCode plugins provide, "
            "each driven by a `harness.py` subcommand. `CLAUDE.md` itself "
            "auto-loads by location, so it needs no hook at all.\n\n"
            "### The three hooks\n\n"
            "- **Context injection** — `SessionStart` (startup, clear, "
            "resume) runs `harness.py context`: auto-discovers the repo's "
            "docs by convention and injects them before your first turn, "
            "plus your machine wiki. It honours the same `GENESEED_CONTEXT` "
            "manifest as the OpenCode context plugin.\n"
            "- **Git gate** — `PreToolUse` on Bash runs `harness.py "
            "git-gate`: enforces the safety Laws at the tool boundary, "
            "before a shell command executes.\n"
            "- **Learn** — `Stop` and `SubagentStop` run `harness.py learn`: "
            "distils durable memories into the install's `memory/` store at "
            "session end; a subagent's stop routes to the per-agent lesson "
            "path (`memory/agents/<name>.md`).\n\n"
            "### Where they live\n\n"
            "The emit merges the hook groups surgically into your "
            "`settings.json` (global `~/.claude/settings.json`, or the "
            "project's), preserving every other key and any hooks of your "
            "own. The install manifest records exactly which groups Geneseed "
            "owns, so an upgrade replaces and an uninstall removes precisely "
            "those — never yours.\n\n"
            "### Verify\n\n"
            "Open Claude Code in any repo: the first reply opens with the "
            "readiness sigil and your project's docs are already in "
            "context. End a session and check the install's `memory/` dir "
            "for distilled files.\n\n"
            "---\n\n"
            "**Deeper:** [Claude Code adapter](#/docs/adapters-claude-code)")},
    ]},
    # ── 6. Reference ──────────────────────────────────────────────────────
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
            "MCP server issues have their own page: "
            "[MCP — won't connect?](#/docs/mcp-trouble).\n\n"
            "### `geneseed: command not found`\n"
            "Run `./geneseed link` (macOS/Linux) or `.\\geneseed.cmd link` "
            "(Windows) from the cloned repo. On Windows, open a new terminal "
            "after `link` — the PATH update only applies to fresh shells.\n\n"
            "<!--harness:opencode-->\n"
            "### The agent doesn't load my project docs\n"
            "On OpenCode the `geneseed-context` plugin must be installed. "
            "Re-run `geneseed setup` or `python build.py --emit opencode-"
            "global`. Verify with `geneseed doctor`.\n"
            "<!--/harness-->\n\n"
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
            "<!--harness:opencode-->\n"
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
            "to see which.\n"
            "<!--/harness-->\n\n"
            "### `could not determine a model`\n"
            "Set `GENESEED_MODEL=provider/model` in your environment.\n")},
    ]},
    # ── 7. Extend ─────────────────────────────────────────────────────────
    # Contributor tasks — editing Geneseed itself, not using it. Split out of
    # How-to so the task pages stay reader-intent pure (use vs extend).
    {"id": "extend", "label": "Extend", "pages": [
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
    # ── 8. Deeper ─────────────────────────────────────────────────────────
    # Design rationale, adapter internals, the install snapshot. Long-form by
    # nature — readers come here on purpose.
    {"id": "deeper", "label": "Deeper", "pages": [
        {"id": "design", "title": "DESIGN.md — the spec",
         "kind": "markdown", "source": "DESIGN.md"},
        {"id": "adapters-opencode", "title": "OpenCode adapter",
         "kind": "markdown", "harness": "opencode",
         "source": "adapters/opencode/README.md"},
        {"id": "adapters-opencode-spec", "title": "OpenCode — global harness spec",
         "kind": "markdown", "harness": "opencode",
         "source": "adapters/opencode/GLOBAL-HARNESS-SPEC.md"},
        {"id": "adapters-opencode-loads", "title": "OpenCode — how it loads",
         "kind": "markdown", "harness": "opencode",
         "source": "adapters/opencode/HOW-OPENCODE-LOADS.md"},
        {"id": "adapters-claude-code", "title": "Claude Code adapter",
         "kind": "markdown", "harness": "claude",
         "source": "adapters/claude-code/README.md"},
        {"id": "token-footprint", "title": "Token footprint",
         "kind": "markdown", "source": "docs/token-footprint.md"},
        {"id": "about", "title": "About — version, license, links",
         "kind": "about"},
    ]},
]


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
    # Deployed skill files carry no category, so tag each from SKILL_CLASS by name
    # (same source of truth the source render uses) — the web Skills ledger filters on it.
    from _harness_tui import SKILL_CLASS
    skills = _spec_entries(state.target / "skills", nested=True)
    for e in skills:
        e["klass"] = SKILL_CLASS.get(e["name"], "build")
    return {"agents": _spec_entries(state.target / "agents", nested=False),
            "skills": skills,
            "laws": render["laws"], "theme": state.theme}
