#!/usr/bin/env python3
"""Geneseed harness generator.

Renders the canonical neutral source in `src/` into a themed, ready-to-port
bundle in `dist/`. The only thing a theme changes is *terminology* (the labels
in the prose); folder and file names in `dist/` stay neutral so any
AGENT.md-aware tool can consume them unchanged.

Stdlib only. No dependencies.

Usage:
    python build.py                      # use default theme from harness.config.json
    python build.py --theme imperial     # render the Warhammer-flavoured bundle
    python build.py --theme neutral --out dist
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
        out_rel = dest_rel(rel).as_posix()
        if path.suffix in TEXT_SUFFIXES:
            items.append((out_rel, render_file(path, theme), path))
        else:
            items.append((out_rel, None, path))
    return theme, items


def build(theme_name: str, out: Path) -> None:
    _, items = render_all(theme_name)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    for out_rel, text, src in items:
        dest = out / out_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if text is not None:
            dest.write_text(text, encoding="utf-8")
        else:
            shutil.copy2(src, dest)

    (out / ".geneseed-theme").write_text(theme_name + "\n", encoding="utf-8")
    print(f"[geneseed] built theme '{theme_name}' -> {out} ({len(items)} files)")


def resolve_out(raw: str) -> Path:
    """A target may be absolute or relative to the current working directory,
    so the harness can be rendered straight into any repository."""
    p = Path(raw)
    if not p.is_absolute():
        p = Path.cwd() / p
    return p.resolve()


def main() -> None:
    default_theme = "neutral"
    if CONFIG.exists():
        default_theme = json.loads(CONFIG.read_text(encoding="utf-8")).get("theme", "neutral")

    ap = argparse.ArgumentParser(description="Render the Geneseed harness for a theme.")
    ap.add_argument("--theme", default=default_theme, help="theme name (neutral, imperial, ...)")
    ap.add_argument("--out", "--target", dest="out", default="dist",
                    help="output directory — absolute, or relative to the current "
                         "directory (default: ./dist)")
    args = ap.parse_args()

    build(args.theme, resolve_out(args.out))


if __name__ == "__main__":
    main()
