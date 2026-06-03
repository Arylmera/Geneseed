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
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
CONFIG = ROOT / "harness.config.json"
THEMES = ROOT / "themes"

TOKEN_RE = re.compile(r"\{\{([A-Z_]+)\}\}")
INCLUDE_RE = re.compile(r"^[ \t]*<!--[ \t]*INCLUDE:[ \t]*(?P<path>[^ \t]+)[ \t]*-->[ \t]*$", re.M)

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


def render_file(path: Path, theme: dict) -> str:
    """Render one source file: inline INCLUDE directives, then substitute tokens."""
    text = path.read_text(encoding="utf-8")

    def inline(m: re.Match) -> str:
        target = (SRC / m.group("path")).resolve()
        if not target.exists():
            return f"<!-- MISSING INCLUDE: {m.group('path')} -->"
        return render_file(target, theme).rstrip("\n")

    text = INCLUDE_RE.sub(inline, text)
    return substitute(text, theme)


# Source top-level dirs whose OUTPUT name is themed (the source tree stays neutral).
SRC_DIR_TOKENS = {
    "laws": "DIR_LAWS",
    "agents": "DIR_AGENTS",
    "skills": "DIR_SKILLS",
    "memory": "DIR_MEMORY",
}

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

    Shared by `build()` (writes to a directory) and the prompt emitter (embeds
    the text in a single self-contained prompt) so the two never drift."""
    theme = load_theme(theme_name)
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


def build(theme_name: str, out: Path) -> None:
    """Render the bundle into `out`.

    Before rendering, the dirs the build fully owns (`OWNED_SRC_DIRS` — laws,
    agents, skills, in their themed form) are wiped, so a renamed or removed source
    file never leaves a stale copy behind. Everything else in `out` is preserved:
    the surrounding application code, the agent's runtime `memory/` (MEMORY.md +
    fact files, refreshed in place), and `context.json` (created once, never
    touched again). The build therefore cleans its own footprint without ever
    destroying the user's repository or data."""
    theme, items = render_all(theme_name)
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
    ensure_context_stub(out)
    print(f"[geneseed] built theme '{theme_name}' -> {out} ({len(items)} files)")


def resolve_out(raw: str) -> Path:
    """A target may be absolute or relative to the current working directory,
    so the harness can be rendered straight into any repository."""
    p = Path(raw)
    if not p.is_absolute():
        p = Path.cwd() / p
    return p.resolve()


def _first_blockquote(text: str) -> str:
    """The one-line purpose: the first `>` line in a spec."""
    for line in text.splitlines():
        s = line.strip()
        if s.startswith(">"):
            return s.lstrip(">").strip()
    return ""


def _is_readonly(text: str) -> bool:
    return "Read-only" in text


def emit_opencode(theme_name: str, out: Path) -> None:
    """Render the standard bundle, then add an OpenCode-native layer derived from
    the same source: capability agents become subagents, skills become commands,
    and an opencode.json wires AGENT.md as a rule file."""
    build(theme_name, out)
    # Owned by this layer — wipe so a removed agent/skill leaves no stale subagent
    # or command file behind.
    if (out / ".opencode").is_dir():
        shutil.rmtree(out / ".opencode")
    _, items = render_all(theme_name)

    n_agents = n_cmds = 0
    for _out_rel, text, src in items:
        if text is None:
            continue
        # Key off the SOURCE folder (always neutral); the themed output name
        # must not change OpenCode's fixed .opencode/agent and command dirs.
        sparts = src.relative_to(SRC).as_posix().split("/")
        if len(sparts) != 2 or not sparts[1].endswith(".md") or sparts[1].startswith("_"):
            continue
        folder, stem = sparts[0], sparts[1][:-3]
        desc = _first_blockquote(text)
        body = text.lstrip("\n")
        if folder == "agents":
            fm = [f"description: {json.dumps(desc)}", "mode: subagent"]
            if _is_readonly(text):
                fm += ["tools:", "  write: false", "  edit: false"]
            dest = out / ".opencode" / "agent" / f"{stem}.md"
            n_agents += 1
        elif folder == "skills":
            fm = [f"description: {json.dumps(desc)}", "agent: build"]
            dest = out / ".opencode" / "command" / f"{stem}.md"
            n_cmds += 1
        else:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("---\n" + "\n".join(fm) + "\n---\n\n" + body, encoding="utf-8")

    config = {"$schema": "https://opencode.ai/config.json", "instructions": ["AGENT.md"]}
    (out / "opencode.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    print(f"[geneseed] opencode layer: {n_agents} subagents, {n_cmds} commands, opencode.json")


def main() -> None:
    default_theme = "neutral"
    if CONFIG.exists():
        default_theme = json.loads(CONFIG.read_text(encoding="utf-8")).get("theme", "neutral")

    ap = argparse.ArgumentParser(description="Render the Geneseed harness for a theme.")
    ap.add_argument("--theme", default=default_theme, help="theme name (neutral, imperial, ...)")
    ap.add_argument("--out", "--target", dest="out", default="Harness",
                    help="output directory — absolute, or relative to the current "
                         "directory (default: ./Harness)")
    ap.add_argument("--emit", choices=["files", "opencode"], default="files",
                    help="files: plain bundle (default). opencode: bundle + native "
                         ".opencode/ subagents & commands + opencode.json")
    args = ap.parse_args()

    out = resolve_out(args.out)
    if args.emit == "opencode":
        emit_opencode(args.theme, out)
    else:
        build(args.theme, out)


if __name__ == "__main__":
    main()
