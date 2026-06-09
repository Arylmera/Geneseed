#!/usr/bin/env python3
"""Geneseed harness generator.

Renders the canonical neutral source in `src/` into a themed, ready-to-port
bundle in `Harness/`. The only thing a theme changes is *terminology* (the labels
in the prose); folder and file names in `Harness/` stay neutral so any
AGENT.md-aware tool can consume them unchanged.

Stdlib only. No dependencies.

Usage:
    python build.py                      # use default theme from harness.config.json
    python build.py --theme imperial     # render the Warhammer-flavoured bundle
    python build.py --theme neutral --out Harness
"""
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


def load_theme(name: str) -> dict:
    path = THEMES / f"{name}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in THEMES.glob("*.json")))
        sys.exit(f"[geneseed] unknown theme '{name}'. available: {available}")
    return json.loads(path.read_text(encoding="utf-8"))


def substitute(text: str, theme: dict) -> str:
    def repl(m: re.Match) -> str:
        key = m.group(1)
        if key not in theme:
            return m.group(0)  # leave unknown tokens untouched, visible for debugging
        return str(theme[key])

    return TOKEN_RE.sub(repl, text)


def render_file(path: Path, theme: dict, _visiting: "frozenset[Path]" = frozenset()) -> str:
    """Render one source file: inline INCLUDE directives, then substitute tokens.

    `_visiting` carries the chain of files currently being inlined, so a circular
    INCLUDE (a -> b -> a, or a file including itself) is caught and reported as a
    visible marker instead of recursing until Python raises RecursionError."""
    here = path.resolve()
    text = path.read_text(encoding="utf-8")

    def inline(m: re.Match) -> str:
        target = (SRC / m.group("path")).resolve()
        if not target.exists():
            return f"<!-- MISSING INCLUDE: {m.group('path')} -->"
        if target == here or target in _visiting:
            return f"<!-- CIRCULAR INCLUDE: {m.group('path')} -->"
        return render_file(target, theme, _visiting | {here}).rstrip("\n")

    text = INCLUDE_RE.sub(inline, text)
    return substitute(text, theme)


# Source top-level dirs whose OUTPUT name is themed (the source tree stays neutral).
SRC_DIR_TOKENS = {
    "laws": "DIR_LAWS",
    "agents": "DIR_AGENTS",
    "skills": "DIR_SKILLS",
    "memory": "DIR_MEMORY",
}

# Document STRUCTURE is theme-INDEPENDENT — the section *layout*, the harness name, the
# law *numbers*, the folder names (DIR_*), and a few rare technical nouns are always
# plain English, in every theme and every emit, so paths, links, and headings never
# move and tooling stays stable. A theme governs VOICE *and* the prose VOCABULARY: how
# the AI responds (VOICE) and the words the docs use for the core nouns — LAW(S),
# AGENT(S), SKILL(S), MEMORY, VAULT — which each theme defines for itself (neutral keeps
# the plain words, so neutral output is unchanged). Folder names stay neutral via DIR_*,
# so e.g. imperial calls them "Rites" in prose while the directory is still `skills/`.
STRUCTURE = {
    "HARNESS": "Geneseed", "CHARTER": "Charter", "CONTEXT": "Context",
    "SCRIPT": "Script", "SCRIPTS": "Scripts",
    "DIR_LAWS": "laws", "DIR_AGENTS": "agents", "DIR_SKILLS": "skills", "DIR_MEMORY": "memory",
}


def effective_theme(theme_name: str) -> dict:
    """The token map used to render: the chosen theme's VOICE + VOCABULARY with the fixed
    neutral STRUCTURE laid on top (structure wins, so a theme can never change a section
    layout, the harness name, a folder name, or a law number — only the prose words and
    the agent's tone)."""
    return {**load_theme(theme_name), **STRUCTURE}

# Dirs the build fully owns: wiped and regenerated each run so a renamed/removed
# source file never leaves a stale copy behind. `memory` is intentionally NOT here —
# it holds the agent's runtime MEMORY.md + fact files and is refreshed in place.
OWNED_SRC_DIRS = ("laws", "agents", "skills")

# Written once into the bundle root and never overwritten — the user's per-repo
# pointer to its own documentation (host-specific; git-ignore it).
CONTEXT_STUB = {
    "_comment": (
        "Point the agent at this project's own documentation. Each entry: 'path' "
        "(absolute, or relative to the repo root), 'load' ('eager' = read every "
        "session for small always-relevant rules; 'lazy' = read only when the task "
        "needs it), and 'description'. This file is host-specific — git-ignore it. "
        "The build creates it once, empty, and never overwrites it."
    ),
    "context": [],
}


def ensure_context_stub(out: Path) -> None:
    """Drop an empty `context.json` at the bundle root the first time only. If the
    user already has one, leave it completely untouched — their pointers are theirs."""
    dest = out / "context.json"
    if not dest.exists():
        dest.write_text(json.dumps(CONTEXT_STUB, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")


# Bundle-level ignore so a host repo can COMMIT the rendered harness — AGENT.md, the
# laws, agents, and skills are content worth versioning — while keeping only the
# host-specific / personal files out. (Note: inline `#` comments are not valid in
# .gitignore, so every comment is on its own line.) memory/ self-ignores its facts.
BUNDLE_GITIGNORE = """\
# Generated by Geneseed. The rendered harness — AGENT.md, the laws, agents, and
# skills — is safe to commit; track it if you want it versioned with your project.
# Only the host-specific / personal files below are kept out of git.

# Project-context manifest — may hold private paths; never commit.
context.json

# Per-agent model/temperature overrides — host-specific; never commit.
agent-overrides.json

# Which theme + emit mode this host last built (local build state, must not travel).
.geneseed-theme
.geneseed-emit

# memory/ keeps its own .gitignore so learned facts stay on this machine.
"""


def ensure_memory_index(mem_dir: Path) -> None:
    """Create an empty `MEMORY.md` index in the memory store if absent — and NEVER
    overwrite one (it accumulates). The store's README is the static convention;
    MEMORY.md is the live index the agent reads (AGENT.md §4) and the learn plugin
    appends to. A freshly-seeded or hand-emptied store would otherwise lack it, so
    the agent is told to read a file that does not exist."""
    if mem_dir.is_dir():
        idx = mem_dir / "MEMORY.md"
        if not idx.exists():
            idx.write_text("# Memory Index\n", encoding="utf-8")


def ensure_bundle_gitignore(out: Path) -> None:
    """Drop a bundle-root `.gitignore` once so the rendered harness (skills, laws,
    agents, AGENT.md) is committable in a host repo while context.json, the theme
    marker, and personal memory stay out. Written once; never overwritten, so a host
    may customise it. NB: this only helps if the host repo does NOT blanket-ignore
    the whole bundle dir — a parent ignoring `Harness/` stops git descending into it,
    and no nested rule can re-include the skills."""
    dest = out / ".gitignore"
    if not dest.exists():
        dest.write_text(BUNDLE_GITIGNORE, encoding="utf-8")


def themed_rel(rel: Path, theme: dict) -> Path:
    """Rename the top-level folder of an output path per theme (laws -> leges …).
    The source tree keeps neutral names; only the rendered bundle is themed."""
    parts = list(rel.parts)
    if parts and parts[0] in SRC_DIR_TOKENS:
        parts[0] = theme.get(SRC_DIR_TOKENS[parts[0]], parts[0])
    return Path(*parts)


def dest_rel(rel: Path) -> Path:
    # AGENT.md.tmpl -> AGENT.md ; everything else keeps its name.
    if rel.name == "AGENT.md.tmpl":
        return rel.with_name("AGENT.md")
    return rel


def render_all(theme_name: str) -> tuple[dict, list[tuple[str, str | None, Path]]]:
    """Render every source file once. Returns (theme, items) where each item is
    (output_relpath, rendered_text_or_None, source_path). Text files carry their
    rendered text; binary files carry None text and are copied from source_path.

    Renders with `effective_theme` — the chosen theme's voice over the fixed neutral
    STRUCTURE — so section names and folder names are theme-independent everywhere.

    Shared by `build()` (writes to a directory) and the prompt emitter (embeds
    the text in a single self-contained prompt) so the two never drift."""
    theme = effective_theme(theme_name)
    items: list[tuple[str, str | None, Path]] = []
    for path in sorted(SRC.rglob("*")):
        if path.is_dir() or "__pycache__" in path.parts:
            continue
        rel = path.relative_to(SRC)
        out_rel = dest_rel(themed_rel(rel, theme)).as_posix()
        if path.suffix in TEXT_SUFFIXES:
            items.append((out_rel, render_file(path, theme), path))
        else:
            items.append((out_rel, None, path))
    return theme, items


def source_fingerprint() -> str:
    """A short, deterministic content hash of the harness SOURCE — every file under
    src/, themes/, the OpenCode plugins, and the saved workflows. Theme- and emit-independent: it
    identifies *which Geneseed* you have, so a stamped install can be compared against
    the source it was built from (see `harness version`). Stdlib only."""
    h = hashlib.sha256()
    files: list[Path] = []
    for r in (SRC, THEMES, PLUGIN_SRC, WORKFLOW_SRC):
        if r.is_dir():
            files += [p for p in r.rglob("*")
                      if p.is_file() and "__pycache__" not in p.parts]
    for p in sorted(files, key=lambda x: x.relative_to(ROOT).as_posix()):
        h.update(p.relative_to(ROOT).as_posix().encode("utf-8") + b"\0")
        h.update(p.read_bytes() + b"\0")
    return h.hexdigest()[:12]


def write_version(out: Path) -> str:
    """Stamp <out>/.geneseed-version with the source fingerprint + build date, so a
    deployed harness records which source produced it. Returns the fingerprint."""
    fp = source_fingerprint()
    (out / VERSION_MARKER).write_text(
        f"{fp} (built {datetime.date.today().isoformat()})\n", encoding="utf-8")
    return fp


def read_version(path: Path) -> "str | None":
    """The fingerprint token recorded in a deployed harness's .geneseed-version (the
    first whitespace-delimited token), or None if absent/empty/unreadable."""
    try:
        txt = (path / VERSION_MARKER).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return txt.split()[0] if txt else None


def build(theme_name: str, out: Path) -> None:
    """Render the bundle into `out`.

    Before rendering, the dirs the build fully owns (`OWNED_SRC_DIRS` — laws,
    agents, skills, in their themed form) are wiped, so a renamed or removed source
    file never leaves a stale copy behind. Everything else in `out` is preserved:
    the surrounding application code, the agent's runtime `memory/` (MEMORY.md +
    fact files, refreshed in place), and `context.json` — written once, beside
    AGENT.md, and never touched again. The build therefore cleans its own footprint
    without ever destroying the user's repository or data."""
    theme, items = render_all(theme_name)
    assert_source_complete(items, context=f"theme '{theme_name}'")
    out.mkdir(parents=True, exist_ok=True)

    for src_dir in OWNED_SRC_DIRS:
        managed = out / theme.get(SRC_DIR_TOKENS[src_dir], src_dir)
        if managed.is_dir():
            shutil.rmtree(managed)

    for out_rel, text, src in items:
        dest = out / out_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if text is not None:
            dest.write_text(text, encoding="utf-8")
        else:
            shutil.copy2(src, dest)

    (out / ".geneseed-theme").write_text(theme_name + "\n", encoding="utf-8")
    write_version(out)
    ensure_context_stub(out)
    ensure_bundle_gitignore(out)
    ensure_memory_index(out / theme.get(SRC_DIR_TOKENS["memory"], "memory"))
    print(f"[geneseed] built theme '{theme_name}' -> {out} ({len(items)} files)")


def resolve_out(raw: str) -> Path:
    """A target may be absolute or relative to the current working directory,
    so the harness can be rendered straight into any repository."""
    p = Path(raw)
    if not p.is_absolute():
        p = Path.cwd() / p
    return p.resolve()


def _rel_under(out: Path, root: Path) -> str:
    """Posix path of `out` relative to `root`, or '' when they are the same dir
    (or `out` is not under `root`). Used to prefix instruction paths for a bundle
    that lives in a subfolder of the project root."""
    try:
        rel = out.relative_to(root).as_posix()
    except ValueError:
        return ""
    return "" if rel == "." else rel


def _first_blockquote(text: str) -> str:
    """The one-line purpose: the first `>` line in a spec."""
    for line in text.splitlines():
        s = line.strip()
        if s.startswith(">"):
            return s.lstrip(">").strip()
    return ""


def _is_readonly(text: str) -> bool:
    return "Read-only" in text


def _missing_referenced_specs(items) -> list[str]:
    """Specs that AGENT.md links to but src/ does not provide.

    AGENT.md's agent/skill tables are hand-authored, while the spec files are globbed
    from src/ — so the two can fall out of sync: a row added without its file, or, far
    more often, a partial or interrupted source sync (an aborted `cp -R`, a truncated
    download). Emitting in that state writes an AGENT.md that points at files that were
    never generated — dead links — and the global emit's cleanup would delete the
    previously-good copies too. Detect it from the rendered items, before any write."""
    agent = next((t for r, t, _s in items if r == "AGENT.md" and t is not None), None)
    if agent is None:
        return []
    missing: list[str] = []
    for m in CAPABILITY_LINK_RE.finditer(agent):
        target = m.group(0).rsplit("](", 1)[1].rstrip(")")   # e.g. 'agents/advocate.md'
        folder, _slash, fname = target.partition("/")
        if folder in ("agents", "skills") and not (SRC / folder / fname).is_file():
            missing.append(target)
    return sorted(set(missing))


def assert_source_complete(items, *, context: str = "") -> None:
    """Refuse to emit when AGENT.md references specs that src/ doesn't provide — BEFORE
    any destructive write. A clear failure that leaves the existing install intact beats
    a half-generated bundle full of dead links (and a global re-emit that deletes the
    good copies). This is the gate `upgrade.sh` runs on the download, brought into the
    build itself so direct `build.py`, `harness build`, and the `setup` wizard are
    guarded too — not just the upgrade path."""
    missing = _missing_referenced_specs(items)
    if not missing:
        return
    where = f" ({context})" if context else ""
    sys.stderr.write(
        f"[geneseed][E-INCOMPLETE] ✗ source is incomplete{where}: AGENT.md references "
        f"{len(missing)} spec(s) with no file under src/:\n"
        + "".join(f"    - {m}\n" for m in missing)
        + "[geneseed] ✗ Refusing to emit — a partial source would write dead links "
        "and a global re-emit would delete the good copies in an existing install.\n"
        "[geneseed] ✗ Re-sync the source (./geneseed update, or re-run the upgrade) "
        "and try again.\n")
    raise SystemExit(1)


PLUGIN_SRC = ROOT / "adapters" / "opencode" / "plugins"
WORKFLOW_SRC = ROOT / "adapters" / "opencode" / "workflows"


def _strip_capability_links(text: str) -> str:
    """Reduce AGENT.md's per-row agent/skill table links to plain names — for the
    OpenCode emits only. OpenCode loads agents and skills by native discovery
    (HOW-OPENCODE-LOADS §4), so these hrefs are navigation-only, never followed, and
    were the recurring dead-link source. The table keeps its names + trigger text and
    the section intros keep their `agents/` / `skills/` folder pointer; only the
    per-row spec links are removed. The portable `files` emit keeps the links (its
    specs are flat siblings that resolve)."""
    return CAPABILITY_LINK_RE.sub(r"\1", text)


def _strip_skill_body_links(body: str) -> str:
    """Reduce a native skill body's capability cross-links to plain text — same
    rationale as AGENT.md's tables: OpenCode invokes skills via the `skill` tool and
    never follows these hrefs. Removes every RELATIVE markdown link to a `.md` spec
    (sibling skills like `tdd.md`, `../agents/x.md`, the `_template.md` scaffold),
    keeping the link TEXT; external URLs are untouched. This makes the native emits
    link-clean by construction — no fragile path-nesting rewrite to maintain."""
    return re.sub(r"\[([^\]]+)\]\((?!https?://|/|#)[^)\s]*\.md(?:#[^)\s]*)?\)", r"\1", body)


# Per-capability-agent display colour. Values are OpenCode's NAMED theme slots
# (primary/secondary/accent/success/warning/error/info) — NOT raw colour names — so the
# colour tracks whatever theme the host has active and stays portable. Council seats and
# any unlisted agent fall to 'secondary'. Cosmetic only (the agent switcher / subagent UI).
AGENT_COLORS = {
    "architect": "primary", "reviewer": "warning", "tester": "success",
    "docs": "info", "security": "error", "explorer": "accent",
}

# ANSI colour-name -> integer (0-7), the universally-rendered terminal colours. Used to
# tint an emitted OpenCode theme from a Geneseed theme's single ACCENT token.
_ANSI = {"black": 0, "red": 1, "green": 2, "yellow": 3,
         "blue": 4, "magenta": 5, "cyan": 6, "white": 7}


def _theme_json(theme: dict) -> dict:
    """A COMPLETE, terminal-native OpenCode theme tinted by the harness theme's ACCENT.

    Geneseed themes carry only an accent colour, not a full palette, so this fills every
    OpenCode theme slot with ANSI colour integers (0-7, rendered by every terminal) and
    'none' backgrounds (the terminal's own) — always valid, no host palette, hermetic.
    The accent-family slots take the theme's accent; semantics (ok/warn/err) use the
    conventional ANSI green/yellow/red. Values are bare ANSI ints / 'none' (both
    documented-valid), so no `defs` block or dark/light variants are needed."""
    acc = _ANSI.get(str(theme.get("ACCENT", "cyan")).lower(), 6)
    GRAY, GREEN, RED, YEL, MAG, NONE = 8, 2, 1, 3, 5, "none"
    t = {
        "primary": acc, "secondary": MAG, "accent": acc,
        "error": RED, "warning": YEL, "success": GREEN, "info": acc,
        "text": NONE, "textMuted": GRAY,
        "background": NONE, "backgroundPanel": NONE, "backgroundElement": NONE,
        "border": GRAY, "borderActive": acc, "borderSubtle": GRAY,
        "diffAdded": GREEN, "diffRemoved": RED, "diffContext": GRAY,
        "diffHunkHeader": acc, "diffHighlightAdded": GREEN, "diffHighlightRemoved": RED,
        "diffAddedBg": NONE, "diffRemovedBg": NONE, "diffContextBg": NONE,
        "diffLineNumber": GRAY, "diffAddedLineNumberBg": NONE, "diffRemovedLineNumberBg": NONE,
        "markdownText": NONE, "markdownHeading": acc, "markdownLink": MAG,
        "markdownLinkText": acc, "markdownCode": GREEN, "markdownBlockQuote": GRAY,
        "markdownEmph": YEL, "markdownStrong": YEL, "markdownHorizontalRule": GRAY,
        "markdownListItem": acc, "markdownListEnumeration": acc, "markdownImage": MAG,
        "markdownImageText": acc, "markdownCodeBlock": NONE,
        "syntaxComment": GRAY, "syntaxKeyword": MAG, "syntaxFunction": acc,
        "syntaxVariable": NONE, "syntaxString": GREEN, "syntaxNumber": MAG,
        "syntaxType": acc, "syntaxOperator": MAG, "syntaxPunctuation": NONE,
    }
    return {"$schema": "https://opencode.ai/theme.json", "theme": t}


def _write_theme(themes_dir: Path, theme_name: str, theme: dict) -> Path:
    """Emit the branded OpenCode theme as <themes_dir>/geneseed-<theme>.json (selectable
    with `/theme geneseed-<theme>`). The geneseed- prefix avoids clashing with a built-in
    theme name. Returns the written path."""
    themes_dir.mkdir(parents=True, exist_ok=True)
    dest = themes_dir / f"geneseed-{theme_name}.json"
    dest.write_text(json.dumps(_theme_json(theme), indent=2) + "\n", encoding="utf-8")
    return dest


def _write_native_layer(items, agents_dir: Path, skills_dir: Path, overrides=None) -> tuple[int, int, list[Path]]:
    """Render capability agents and skills into OpenCode-native files.

    - Agents -> `<agents_dir>/<name>.md`  (frontmatter: description, mode: subagent,
      and read-only tool gating).
    - Skills -> `<skills_dir>/<name>/SKILL.md`  (native skills: model-invoked via the
      `skill` tool with progressive disclosure — NOT slash commands. Frontmatter is
      the skill schema: name + description + compatibility. The command-only
      `agent:` / `model:` keys are intentionally dropped; a skill runs in the current
      agent context. See adapters/opencode/GLOBAL-HARNESS-SPEC.md §9.1.)

    Keys off the SOURCE folder name (always neutral) so a theme can rename the
    rendered bundle dirs without moving OpenCode's fixed `agents/` and `skills/`.
    Returns (n_agents, n_skills, written_paths)."""
    overrides = overrides or {}
    n_agents = n_skills = 0
    written: list[Path] = []
    for _out_rel, text, src in items:
        if text is None:
            continue
        sparts = src.relative_to(SRC).as_posix().split("/")
        if len(sparts) != 2 or not sparts[1].endswith(".md"):
            continue
        folder, fname = sparts[0], sparts[1]
        target_dir = {"agents": agents_dir, "skills": skills_dir}.get(folder)
        if target_dir is None:
            continue
        if fname.startswith("_"):
            # Authoring templates (e.g. skills/_template.md) are shipped verbatim and
            # FLAT — not wrapped as a native skill — so an author following the
            # _template.md authoring note ("Copy this file") has the scaffold on disk.
            # Not counted as an
            # agent/skill, and not discovered by OpenCode (it scans <name>/SKILL.md).
            dest = target_dir / fname
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text.lstrip("\n"), encoding="utf-8")
            written.append(dest)
            continue
        stem = fname[:-3]
        desc = _first_blockquote(text)
        body = text.lstrip("\n")
        if folder == "agents":
            fm = [f"description: {json.dumps(desc)}", "mode: subagent"]
            # Per-agent display colour — one of OpenCode's NAMED theme slots (never a raw
            # hex/ANSI name), so it follows whatever theme the host has active and stays
            # portable. Capability roles get distinct semantic slots; everything else (the
            # council seats) shares 'secondary'. Cosmetic only.
            fm.append(f"color: {AGENT_COLORS.get(stem, 'secondary')}")
            # Per-agent overrides (O2): emit model/temperature/variant/steps ONLY when
            # configured; with no override the line is omitted so the agent inherits the
            # host's current model as-is. Empty agent-overrides.json => zero change.
            ov = overrides.get(stem) or {}
            if ov.get("model"):
                fm.append(f"model: {ov['model']}")
            if ov.get("temperature") is not None:
                fm.append(f"temperature: {ov['temperature']}")
            if ov.get("variant"):
                fm.append(f"variant: {ov['variant']}")
            if ov.get("steps") is not None:
                fm.append(f"steps: {ov['steps']}")
            if _is_readonly(text):
                # A "Read-only" agent must not be able to mutate the repo — and that
                # includes the shell: `tools: {write,edit: false}` alone still leaves
                # `bash` open, through which a read-only agent could write or fetch.
                # Use OpenCode's permission model. bash is denied by default; a spec
                # that genuinely runs read-only commands (tests, linters, scanners)
                # opts in with the `<!-- bash: allow -->` marker (then gated to ask).
                fm += ["permission:", "  edit: deny", "  webfetch: deny"]
                if "<!-- bash: allow -->" in text:
                    fm += ["  bash:", '    "*": ask']
                else:
                    fm += ["  bash: deny"]
            dest = agents_dir / f"{stem}.md"
            n_agents += 1
        elif folder == "skills":
            fm = [f"name: {stem}", f"description: {json.dumps(desc)}", "compatibility: opencode"]
            body = _strip_skill_body_links(body)   # OpenCode never follows these — plain text
            dest = skills_dir / stem / "SKILL.md"
            n_skills += 1
        else:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("---\n" + "\n".join(fm) + "\n---\n\n" + body, encoding="utf-8")
        written.append(dest)
    return n_agents, n_skills, written


def _merge_opencode_json(path: Path, agent_path: str) -> None:
    """Ensure `path`'s `instructions` array contains `agent_path`, preserving every
    other key the user may have set. Never clobbers a hand-edited config — it merges
    the one entry. A malformed existing file is replaced with a clean default."""
    config: dict = {"$schema": "https://opencode.ai/config.json", "instructions": []}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                config = loaded
        except (json.JSONDecodeError, OSError):
            pass
    config.setdefault("$schema", "https://opencode.ai/config.json")
    instr = config.get("instructions")
    if not isinstance(instr, list):
        instr = []
    if agent_path not in instr:
        instr.append(agent_path)
    config["instructions"] = instr
    # O5: a minimal, non-destructive default permission policy — ASK before the few
    # genuinely irreversible or outward-facing bash patterns (Laws I/IV/XX). `git push*`
    # gates EVERY push so the agent never shares code unprompted (Law XX's host-level
    # backstop); the `--force`/`-f` entries are kept as explicit, more-specific markers.
    # Added ONLY when the user has no `permission` key at all; never overwrites an
    # existing policy. Unmatched commands keep OpenCode's default (allow), so normal
    # local work (edits, builds, tests, commits on a feature branch) is unaffected.
    if "permission" not in config:
        config["permission"] = {
            "bash": {
                "rm -rf *": "ask",
                "git push*": "ask",
                "git push --force*": "ask",
                "git push -f*": "ask",
            }
        }
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def _copy_plugins(dst: Path) -> int:
    """Copy the static OpenCode plugins (context, learn, guard, workflow) into `dst`.
    They are maintained files, not rendered from src, so copy them verbatim."""
    n = 0
    if PLUGIN_SRC.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for js in sorted(PLUGIN_SRC.glob("*.js")):
            shutil.copy2(js, dst / js.name)
            n += 1
    return n


def _copy_workflows(dst: Path) -> int:
    """Copy the saved, code-driven workflow scripts (incl. the `_runtime.js` core) into
    `dst`. They sit beside the plugins dir so `geneseed-workflow.js` resolves them via a
    relative `../workflows/` path. Maintained files, copied verbatim like the plugins."""
    n = 0
    if WORKFLOW_SRC.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for js in sorted(WORKFLOW_SRC.glob("*.js")):
            shutil.copy2(js, dst / js.name)
            n += 1
    return n


# ---- O2/O4/O7: opt-in, non-destructive OpenCode-native extras ------------------

AGENT_OVERRIDES_STUB = {
    "_comment": (
        "Per-agent OpenCode overrides. EMPTY = every agent inherits OpenCode's current "
        "model as-is (the default — nothing changes). Add entries keyed by agent name; "
        "supported keys: model, temperature, variant (reasoning effort, e.g. \"high\"), "
        "steps (max tool-iterations — a runaway-loop cap). e.g. "
        "\"reviewer\": {\"model\": \"anthropic/claude-haiku-4-5\", \"temperature\": 0.1, "
        "\"variant\": \"high\", \"steps\": 20}. "
        "Host-specific; git-ignored. A future TUI screen edits this — rebuild to apply."
    ),
    "agents": {},
}

PRIMARY_AGENT_SRC = ROOT / "adapters" / "opencode" / "agents" / "orchestrator.md"

# O7: skills also exposed as /slash commands when GENESEED_COMMANDS is set. The hot set
# — the workflows worth a one-keystroke trigger. Any name absent from src/ is skipped.
COMMAND_SET = ["commit", "plan", "code-review", "review-response",
               "ship", "debug", "research"]


def _truthy_env(name: str) -> bool:
    return (os.environ.get(name) or "").lower() in ("1", "on", "true", "yes")


def _load_agent_overrides(base: Path) -> dict:
    """Per-agent overrides from <base>/agent-overrides.json: {name: {model?, temperature?}}.
    Returns {} when the file is absent or malformed, so agents inherit the host model."""
    try:
        data = json.loads((base / "agent-overrides.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    agents = data.get("agents") if isinstance(data, dict) else None
    return agents if isinstance(agents, dict) else {}


def ensure_agent_overrides_stub(base: Path) -> None:
    """Drop an empty agent-overrides.json once (never overwrite) — the host's editable,
    git-ignored model-routing map. Empty by default => no behaviour change."""
    dest = base / "agent-overrides.json"
    if not dest.exists():
        dest.write_text(json.dumps(AGENT_OVERRIDES_STUB, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")


def _write_primary_agent(agents_dir: Path, overrides: dict) -> "Path | None":
    """Emit the opt-in `mode: primary` orchestrator (GENESEED_PRIMARY). Off by default so
    the host's current default agent is untouched. Returns the written path or None."""
    if not _truthy_env("GENESEED_PRIMARY") or not PRIMARY_AGENT_SRC.is_file():
        return None
    body = PRIMARY_AGENT_SRC.read_text(encoding="utf-8").lstrip("\n")
    desc = "Primary orchestrator — works by the harness Rules and delegates to the capability subagents."
    fm = [f"description: {json.dumps(desc)}", "mode: primary", "color: primary"]
    ov = overrides.get("orchestrator") or {}
    if ov.get("model"):
        fm.append(f"model: {ov['model']}")
    if ov.get("temperature") is not None:
        fm.append(f"temperature: {ov['temperature']}")
    if ov.get("variant"):
        fm.append(f"variant: {ov['variant']}")
    if ov.get("steps") is not None:
        fm.append(f"steps: {ov['steps']}")
    dest = agents_dir / "orchestrator.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("---\n" + "\n".join(fm) + "\n---\n\n" + body, encoding="utf-8")
    return dest


def _write_command_layer(items, command_dir: Path) -> list[Path]:
    """Emit the opt-in /slash commands (GENESEED_COMMANDS) for the hot skill set. Each
    wraps the rendered skill body (de-linked, like the native skills). Off by default."""
    if not _truthy_env("GENESEED_COMMANDS"):
        return []
    by_name = {}
    for _out_rel, text, src in items:
        if text is None:
            continue
        sp = src.relative_to(SRC).as_posix().split("/")
        if len(sp) == 2 and sp[0] == "skills" and sp[1].endswith(".md") and not sp[1].startswith("_"):
            by_name[sp[1][:-3]] = text
    written: list[Path] = []
    for name in COMMAND_SET:
        text = by_name.get(name)
        if text is None:
            continue
        desc = _first_blockquote(text)
        body = _strip_skill_body_links(text.lstrip("\n"))
        dest = command_dir / f"{name}.md"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("---\n" + f"description: {json.dumps(desc)}\n" + "---\n\n" + body,
                        encoding="utf-8")
        written.append(dest)
    return written


def emit_opencode(theme_name: str, out: Path, root: Path | None = None) -> None:
    """Render the standard bundle, then add an OpenCode-native layer derived from
    the same source: capability agents become subagents, skills become native
    skills, and an opencode.json wires AGENT.md as a rule file.

    OpenCode discovers `opencode.json` and `.opencode/` from the project root, so
    those are written to `root` (default: `out`). The portable bundle — including
    `AGENT.md` and `context.json` — always stays together in `out`. When the bundle
    lives in a subfolder, pass `root` = the repo root; the instruction path to
    `AGENT.md` is prefixed with the bundle's location so it resolves from the project
    root. The project manifest `context.json` is loaded by the context plugin, never
    listed in `instructions`."""
    root = root or out
    build(theme_name, out)
    # OpenCode loads agents/skills natively, so strip AGENT.md's per-row spec links to
    # plain names (the portable build keeps them). The bundle's flat specs still exist
    # beside it — this is a deliberate de-link, not a fix for a broken target.
    agent_md = out / "AGENT.md"
    if agent_md.is_file():
        agent_md.write_text(_strip_capability_links(agent_md.read_text(encoding="utf-8")),
                            encoding="utf-8")
    # `.opencode/` is fully owned by this layer — wipe so a removed agent/skill
    # leaves no stale file behind. (Plural dir names are canonical in OpenCode;
    # singular is back-compat only.)
    if (root / ".opencode").is_dir():
        shutil.rmtree(root / ".opencode")
    theme, items = render_all(theme_name)

    ensure_agent_overrides_stub(out)
    overrides = _load_agent_overrides(out)

    oc = root / ".opencode"
    n_agents, n_skills, _ = _write_native_layer(items, oc / "agents", oc / "skills", overrides)
    primary = _write_primary_agent(oc / "agents", overrides)
    commands = _write_command_layer(items, oc / "command")
    _write_theme(oc / "themes", theme_name, theme)   # branded `/theme geneseed-<theme>`

    rel = _rel_under(out, root)
    agent_path = f"{rel}/AGENT.md" if rel else "AGENT.md"
    _merge_opencode_json(root / "opencode.json", agent_path)

    n_plugins = _copy_plugins(oc / "plugins")
    n_workflows = _copy_workflows(oc / "workflows")

    extras = ([f"primary agent"] if primary else []) + ([f"{len(commands)} command(s)"] if commands else [])
    extra = (" + " + ", ".join(extras)) if extras else ""
    print(f"[geneseed] opencode layer: {n_agents} subagents, {n_skills} skills, "
          f"{n_plugins} plugin(s), {n_workflows} workflow file(s), "
          f"opencode.json (instructions: {agent_path}){extra}")


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


GLOBAL_MANIFEST = ".geneseed-manifest.json"


def _global_memory(cfg: Path, theme: dict, items, legacy: Path | None) -> str:
    """Ensure the global memory store exists at <cfg>/memory. If it already holds
    files it is left alone — it carries learned facts. Otherwise migrate an existing
    legacy bundle's memory into it (one-time, so a host switching from a sibling
    Harness — even a themed `anamnesis/` — loses nothing), else seed from the src
    template. The store is host state, never tracked in the owned-manifest.

    The dir name is ALWAYS the classic English `memory/`, never themed: like
    `agents/` and `skills/`, the OpenCode config dir uses fixed names — the theme
    only flavors prose, not directory names. (The learn plugin resolves
    $GENESEED_HARNESS/memory, so this is exactly where it reads/writes.)"""
    mem_name = "memory"
    mem_dir = cfg / mem_name
    if mem_dir.is_dir() and any(mem_dir.iterdir()):
        return f"kept {mem_name}/"
    mem_dir.mkdir(parents=True, exist_ok=True)
    if legacy:
        for nm in dict.fromkeys([mem_name, "memory", "anamnesis"]):
            src = legacy / nm
            if src.is_dir() and any(src.iterdir()):
                for f in src.rglob("*"):
                    if f.is_file():
                        dest = mem_dir / f.relative_to(src)
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(f, dest)
                return f"migrated {nm}/ -> {mem_name}/"
    for _out_rel, text, src in items:
        sp = src.relative_to(SRC).as_posix().split("/")
        if sp[0] == "memory" and len(sp) > 1:
            dest = mem_dir / Path(*sp[1:])
            dest.parent.mkdir(parents=True, exist_ok=True)
            if text is not None:
                dest.write_text(text, encoding="utf-8")
            else:
                shutil.copy2(src, dest)
    return f"seeded {mem_name}/"


def emit_opencode_global(theme_name: str, out: Path | None = None, cfg: Path | None = None) -> None:
    """Render the harness straight into OpenCode's GLOBAL config dir — the
    "everything global, zero per-repo" deployment (GLOBAL-HARNESS-SPEC.md).

    Self-contained: it writes ONLY into <cfg> and builds NO sibling Harness bundle.
    AGENT.md is rendered straight to <cfg>/AGENT.md, and the memory store lives at
    <cfg>/<memory|anamnesis> (migrated once from a legacy Harness if present, else
    seeded). Point the learn plugin at it with GENESEED_HARNESS=<cfg>.

    The target dir is shared with the user's own OpenCode config, so it is NEVER
    wiped. A `.geneseed-manifest.json` tracks exactly the files this layer owns
    (AGENT.md, agents/, skills/, plugins/ — NOT memory); on re-emit, files we
    previously wrote but no longer produce are removed, and the user's own
    agents/skills/plugins (and the memory store) are left untouched.

    Writes: <cfg>/AGENT.md, <cfg>/agents/*.md, <cfg>/skills/<name>/SKILL.md,
    <cfg>/plugins/*.js (single copy — kills the double-injection), the memory store,
    and merges <cfg>/opencode.json to point `instructions` at the absolute
    <cfg>/AGENT.md. It does NOT write context.json — project docs are auto-discovered
    by the context plugin. `out`, if given, is only a migration source for an
    existing memory store (the legacy bundle location); nothing is built there.
    `cfg` overrides the target dir (default: the resolved OpenCode config dir) — used
    by `harness.py diff` to render an 'expected' copy into a temp dir for comparison."""
    cfg = cfg or _opencode_config_dir()
    theme, items = render_all(theme_name)
    assert_source_complete(items, context="opencode-global")
    cfg.mkdir(parents=True, exist_ok=True)

    # Files this layer owned on a previous run — read now, but pruned only AFTER the new
    # set is fully written (below). Write-before-delete: a failed or partial write can
    # never remove a still-needed file, so a re-emit can only improve the install, never
    # degrade it. (With assert_source_complete above, an incomplete source aborts before
    # this point and never touches the existing bundle.)
    manifest_path = cfg / GLOBAL_MANIFEST
    old_owned: list[str] = []
    if manifest_path.exists():
        try:
            old_owned = json.loads(manifest_path.read_text(encoding="utf-8")).get("owned", [])
        except (json.JSONDecodeError, OSError):
            old_owned = []

    owned: list[str] = []
    agent_text = next((t for r, t, _s in items if r == "AGENT.md" and t is not None), None)
    if agent_text is not None:
        # OpenCode loads agents/skills natively, so drop AGENT.md's per-row spec links
        # to plain names (no nested-path rewrite to maintain, nothing to break).
        agent_text = _strip_capability_links(agent_text)
        # Memory links stay RELATIVE. In the global layout AGENT.md and the store are
        # siblings (<cfg>/AGENT.md + <cfg>/memory/), so a relative `memory/` resolves
        # correctly from AGENT.md's own location AND stays hermetic — no absolute
        # /Users/…/.config/opencode/memory path that a markdown viewer renders as a
        # broken link or that doctor flags as a non-hermetic escape. (The learn and
        # context plugins locate the store via $GENESEED_HARNESS, independently of
        # this link, so recall does not depend on absolutising it here.)
        (cfg / "AGENT.md").write_text(agent_text, encoding="utf-8")
        owned.append("AGENT.md")

    ensure_agent_overrides_stub(cfg)
    overrides = _load_agent_overrides(cfg)
    n_agents, n_skills, written = _write_native_layer(items, cfg / "agents", cfg / "skills", overrides)
    owned += [p.relative_to(cfg).as_posix() for p in written]
    primary = _write_primary_agent(cfg / "agents", overrides)
    if primary:
        owned.append(primary.relative_to(cfg).as_posix())
    commands = _write_command_layer(items, cfg / "command")
    owned += [p.relative_to(cfg).as_posix() for p in commands]
    theme_file = _write_theme(cfg / "themes", theme_name, theme)   # branded /theme
    owned.append(theme_file.relative_to(cfg).as_posix())

    n_plugins = 0
    if PLUGIN_SRC.is_dir():
        (cfg / "plugins").mkdir(parents=True, exist_ok=True)
        for js in sorted(PLUGIN_SRC.glob("*.js")):
            shutil.copy2(js, cfg / "plugins" / js.name)
            owned.append(f"plugins/{js.name}")
            n_plugins += 1

    n_workflows = 0
    if WORKFLOW_SRC.is_dir():
        (cfg / "workflows").mkdir(parents=True, exist_ok=True)
        for js in sorted(WORKFLOW_SRC.glob("*.js")):
            shutil.copy2(js, cfg / "workflows" / js.name)
            owned.append(f"workflows/{js.name}")
            n_workflows += 1

    mem_status = _global_memory(cfg, theme, items, out)
    ensure_memory_index(cfg / "memory")   # guarantee the index on every path (seed/migrate/keep)

    write_version(cfg)
    owned.append(VERSION_MARKER)
    _merge_opencode_json(cfg / "opencode.json", (cfg / "AGENT.md").as_posix())

    # Now that the whole current set is on disk, remove only what we owned before but
    # no longer produce (a removed agent/skill, a disabled primary/command). Everything
    # current was just (over)written above, so a live file is never momentarily absent.
    for relp in sorted(set(old_owned) - set(owned)):
        victim = cfg / relp
        try:
            if victim.is_file():
                victim.unlink()
                if victim.name == "SKILL.md" and victim.parent != cfg \
                        and not any(victim.parent.iterdir()):
                    victim.parent.rmdir()
        except OSError:
            pass

    manifest_path.write_text(
        json.dumps({"_comment": "Files owned by Geneseed's --emit opencode-global. "
                                "Do not edit; removed on re-emit. The memory store is "
                                "NOT listed — it is never deleted.", "owned": sorted(owned)},
                   indent=2) + "\n", encoding="utf-8")

    extras = (["primary agent"] if primary else []) + ([f"{len(commands)} command(s)"] if commands else [])
    extra = (" + " + ", ".join(extras)) if extras else ""
    print(f"[geneseed] opencode-global -> {cfg}: {n_agents} subagents, {n_skills} skills, "
          f"{n_plugins} plugin(s), {n_workflows} workflow file(s), AGENT.md, {mem_status}, "
          f"opencode.json (no context.json){extra}. "
          f"The learn plugin now finds <cfg>/memory automatically; set GENESEED_HARNESS only to override.")


def main() -> None:
    default_theme = "neutral"
    if CONFIG.exists():
        default_theme = json.loads(CONFIG.read_text(encoding="utf-8")).get("theme", "neutral")

    ap = argparse.ArgumentParser(description="Render the Geneseed harness for a theme.")
    ap.add_argument("--theme", default=default_theme, help="theme name (neutral, imperial, ...)")
    ap.add_argument("--out", "--target", dest="out", default="Harness",
                    help="output directory — absolute, or relative to the current "
                         "directory (default: ./Harness)")
    ap.add_argument("--emit", choices=["files", "opencode", "opencode-global"], default="files",
                    help="files: plain bundle (default). opencode: bundle + per-repo "
                         ".opencode/ subagents, native skills & opencode.json. "
                         "opencode-global: render straight into OpenCode's global config "
                         "dir ($OPENCODE_CONFIG_DIR / ~/.config/opencode) — everything "
                         "global, zero per-repo files (GLOBAL-HARNESS-SPEC.md)")
    ap.add_argument("--root", default=None,
                    help="project root the agent/OpenCode run from — where opencode.json "
                         "and .opencode/ are placed (default: same as --out). Set this when "
                         "the bundle lives in a subfolder, e.g. --out myrepo/Harness "
                         "--root myrepo; instruction paths are prefixed accordingly")
    args = ap.parse_args()

    out = resolve_out(args.out)
    root = resolve_out(args.root) if args.root else out
    if args.emit == "opencode":
        emit_opencode(args.theme, out, root)
    elif args.emit == "opencode-global":
        emit_opencode_global(args.theme, out)
    else:
        build(args.theme, out)

    # Persist the emit mode (host state) so a later bare `./upgrade.sh` keeps
    # deploying the same way — regardless of which entrypoint chose it. Global mode's
    # marker lives in the config dir (no Harness is built); other modes' in `out`.
    emit_marker = (_opencode_config_dir() if args.emit == "opencode-global" else out) / ".geneseed-emit"
    try:
        emit_marker.parent.mkdir(parents=True, exist_ok=True)
        emit_marker.write_text(args.emit + "\n", encoding="utf-8")
    except OSError:
        pass

    # build() already drops a .geneseed-theme marker in `out`; the global emit renders
    # into the config dir without calling build(), so record the theme there too —
    # so tools (e.g. the setup wizard) can detect the installed theme later.
    if args.emit == "opencode-global":
        try:
            (_opencode_config_dir() / ".geneseed-theme").write_text(args.theme + "\n", encoding="utf-8")
        except OSError:
            pass


if __name__ == "__main__":
    main()
