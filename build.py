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
import os
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

# Document STRUCTURE is theme-INDEPENDENT — the section names, the structural nouns,
# and the folder names (DIR_*) are always plain English, in every theme and every
# emit. A theme governs only VOICE: how the AI responds and how the prose inside the
# docs is written (TAGLINE, LOADED_SIGIL, EPI_*, BENEDICTION, DESC_*, ROAST_PERSONA,
# VOICE). So the scaffolding stays consistent and tool-friendly while the flavour
# lives in the words. Theme files carry voice tokens only; these values are fixed.
STRUCTURE = {
    "HARNESS": "Geneseed", "CHARTER": "Charter",
    "LAW": "Rule", "LAWS": "Rules",
    "AGENT": "Agent", "AGENTS": "Agents",
    "SKILL": "Skill", "SKILLS": "Skills",
    "MEMORY": "Memory", "VAULT": "Workspace", "CONTEXT": "Context",
    "SCRIPT": "Script", "SCRIPTS": "Scripts",
    "DIR_LAWS": "laws", "DIR_AGENTS": "agents", "DIR_SKILLS": "skills", "DIR_MEMORY": "memory",
}


def effective_theme(theme_name: str) -> dict:
    """The token map used to render: the chosen theme's VOICE with the fixed neutral
    STRUCTURE laid on top (structure wins, so a theme can never change section names,
    structural nouns, or folder names — only voice/prose)."""
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

# Which theme + emit mode this host last built (local build state, must not travel).
.geneseed-theme
.geneseed-emit

# memory/ keeps its own .gitignore so learned facts stay on this machine.
"""


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
    ensure_bundle_gitignore(out)
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


PLUGIN_SRC = ROOT / "adapters" / "opencode" / "plugins"


def _write_native_layer(items, agents_dir: Path, skills_dir: Path) -> tuple[int, int, list[Path]]:
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
    n_agents = n_skills = 0
    written: list[Path] = []
    for _out_rel, text, src in items:
        if text is None:
            continue
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
            dest = agents_dir / f"{stem}.md"
            n_agents += 1
        elif folder == "skills":
            fm = [f"name: {stem}", f"description: {json.dumps(desc)}", "compatibility: opencode"]
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
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def _copy_plugins(dst: Path) -> int:
    """Copy the static OpenCode plugins (context + learn) into `dst`. They are
    maintained files, not rendered from src, so copy them verbatim."""
    n = 0
    if PLUGIN_SRC.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for js in sorted(PLUGIN_SRC.glob("*.js")):
            shutil.copy2(js, dst / js.name)
            n += 1
    return n


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
    # `.opencode/` is fully owned by this layer — wipe so a removed agent/skill
    # leaves no stale file behind. (Plural dir names are canonical in OpenCode;
    # singular is back-compat only.)
    if (root / ".opencode").is_dir():
        shutil.rmtree(root / ".opencode")
    _, items = render_all(theme_name)

    oc = root / ".opencode"
    n_agents, n_skills, _ = _write_native_layer(items, oc / "agents", oc / "skills")

    rel = _rel_under(out, root)
    agent_path = f"{rel}/AGENT.md" if rel else "AGENT.md"
    _merge_opencode_json(root / "opencode.json", agent_path)

    n_plugins = _copy_plugins(oc / "plugins")

    print(f"[geneseed] opencode layer: {n_agents} subagents, {n_skills} skills, "
          f"{n_plugins} plugin(s), opencode.json (instructions: {agent_path})")


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
    cfg.mkdir(parents=True, exist_ok=True)

    # Remove files this layer owned on a previous run (stale agent/skill/plugin).
    manifest_path = cfg / GLOBAL_MANIFEST
    if manifest_path.exists():
        try:
            old = json.loads(manifest_path.read_text(encoding="utf-8")).get("owned", [])
        except (json.JSONDecodeError, OSError):
            old = []
        for relp in old:
            victim = cfg / relp
            try:
                if victim.is_file():
                    victim.unlink()
                    # prune an emptied skill dir
                    if victim.name == "SKILL.md" and victim.parent != cfg \
                            and not any(victim.parent.iterdir()):
                        victim.parent.rmdir()
            except OSError:
                pass

    owned: list[str] = []
    agent_text = next((t for r, t, _s in items if r == "AGENT.md" and t is not None), None)
    if agent_text is not None:
        # AGENT.md lists skills as flat `skills/<name>.md`, but native skills are
        # nested `skills/<name>/SKILL.md` — rewrite the links so they resolve in the
        # config dir. (Agent and memory links already match: agents/<name>.md, memory/.)
        agent_text = re.sub(r"\]\(skills/([A-Za-z0-9_-]+)\.md\)", r"](skills/\1/SKILL.md)", agent_text)
        (cfg / "AGENT.md").write_text(agent_text, encoding="utf-8")
        owned.append("AGENT.md")

    n_agents, n_skills, written = _write_native_layer(items, cfg / "agents", cfg / "skills")
    owned += [p.relative_to(cfg).as_posix() for p in written]

    n_plugins = 0
    if PLUGIN_SRC.is_dir():
        (cfg / "plugins").mkdir(parents=True, exist_ok=True)
        for js in sorted(PLUGIN_SRC.glob("*.js")):
            shutil.copy2(js, cfg / "plugins" / js.name)
            owned.append(f"plugins/{js.name}")
            n_plugins += 1

    mem_status = _global_memory(cfg, theme, items, out)

    _merge_opencode_json(cfg / "opencode.json", (cfg / "AGENT.md").as_posix())

    manifest_path.write_text(
        json.dumps({"_comment": "Files owned by Geneseed's --emit opencode-global. "
                                "Do not edit; removed on re-emit. The memory store is "
                                "NOT listed — it is never deleted.", "owned": sorted(owned)},
                   indent=2) + "\n", encoding="utf-8")

    print(f"[geneseed] opencode-global -> {cfg}: {n_agents} subagents, {n_skills} skills, "
          f"{n_plugins} plugin(s), AGENT.md, {mem_status}, opencode.json (no context.json). "
          f"Point the learn plugin here once:  export GENESEED_HARNESS=\"{cfg}\"")


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


if __name__ == "__main__":
    main()
