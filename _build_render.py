"""Geneseed build — the render pipeline: theme loading, token/include substitution,
the bundle structure + stubs, render_all, versioning, and source-completeness checks.

Part of the build CLI (see build.py). Imports the shared toolset from _build_core."""
from __future__ import annotations

from _build_core import *  # noqa: F401,F403  shared stdlib + constants


def is_vendored_path(rel) -> bool:
    """True if a bundle-relative path lives under a vendored skill folder
    (skills/<vendored>/…). DIR_SKILLS is always the neutral 'skills', so the second
    segment is the skill name — match it against the vendored set."""
    parts = Path(rel).parts
    return len(parts) >= 2 and parts[0] == "skills" and parts[1] in VENDORED_SKILL_DIRS


def theme_files() -> list[Path]:
    """Shipped theme JSONs under themes/, excluding `_`-prefixed authoring scaffolds
    (e.g. `_TEMPLATE.json`) — the same convention skills/_template.md uses. Every
    theme enumeration (load, parity, doctor, setup wizard, web gallery, tests) goes
    through here so a scaffold is never mistaken for a real theme."""
    return sorted(p for p in THEMES.glob("*.json") if not p.name.startswith("_"))


def load_theme(name: str) -> dict:
    path = THEMES / f"{name}.json"
    if not path.exists():
        available = ", ".join(p.stem for p in theme_files())
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
    "notebook": "DIR_NOTEBOOK",
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
    "DIR_NOTEBOOK": "notebook",
}


def effective_theme(theme_name: str) -> dict:
    """The token map used to render: the chosen theme's VOICE + VOCABULARY with the fixed
    neutral STRUCTURE laid on top (structure wins, so a theme can never change a section
    layout, the harness name, a folder name, or a law number — only the prose words and
    the agent's tone)."""
    return {**load_theme(theme_name), **STRUCTURE}

# Dirs the build fully owns: wiped and regenerated each run so a renamed/removed
# source file never leaves a stale copy behind. `memory` and `notebook` are
# intentionally NOT here — they hold the agent's runtime stores (MEMORY.md + fact
# files; the NOTEBOOK.md index + the agent's own freeform files) and are refreshed
# in place, never wiped, so nothing the agent kept is ever destroyed by a rebuild.
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


# The wiki manifest is JSONC — its consumers (the context and guard plugins, and the
# agent itself) strip // and /* */ comments and trailing commas before parsing, so the
# seeded stub can carry its documentation and a copy-and-edit example inline.
WIKI_STUB = """\
// Geneseed wiki.jsonc — declare your machine-wide knowledge base(s) here, typically
// an Obsidian vault (AGENT.md: the Wiki section). Comments are allowed in this file
// (JSONC). It is host-specific — never commit it. The build created it once, empty,
// and will never overwrite it.
//
// Each wiki carries:
//   name         a short label
//   path         absolute root of the vault (use forward slashes, also on Windows)
//   description  one line shown to the agent
//   entries      notes OR folders to load: path relative to the vault root ("." =
//                the whole vault); load "eager" = read every session, "lazy" =
//                read on demand; a folder applies its mode to every note beneath
//                it, a file entry overrides its folder, "exclude" prunes
//   conventions  the vault's authoring-rules note — read before the first write
//   inbox        drop folder for notes the agent cannot confidently file
//   protected    folders the agent must never write to (guard-enforced on OpenCode)
//
// Example — copy this object into the "wikis" array below and edit:
// {
//   "name": "Brain",
//   "path": "C:/Users/me/Documents/Brain",
//   "description": "my machine-wide knowledge base",
//   "entries": [
//     { "path": "ARCHITECTURE.md", "load": "eager", "description": "the root map" },
//     { "path": ".", "load": "lazy" }
//   ],
//   "conventions": "STYLE.md",
//   "inbox": "Inbox/",
//   "protected": ["Journal/"]
// }
{
  "wikis": []
}
"""


def ensure_wiki_stub(out: Path) -> None:
    """Drop the `wiki.jsonc` stub beside AGENT.md the first time only — and NEVER
    overwrite one (it holds the user's own knowledge-base declarations). A legacy
    `wiki.json` from an earlier seed counts as present: the consumers still honour
    it, and seeding a second manifest beside it would fork the declarations."""
    dest = out / "wiki.jsonc"
    if not dest.exists() and not (out / "wiki.json").exists():
        dest.write_text(WIKI_STUB, encoding="utf-8")


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

# Knowledge-base manifest — holds private machine paths; never commit.
# (wiki.json is the legacy name from earlier seeds.)
wiki.jsonc
wiki.json

# Per-agent model/temperature overrides — host-specific; never commit.
agent-overrides.json

# Which theme + emit mode this host last built (local build state, must not travel).
.geneseed-theme
.geneseed-emit

# memory/ keeps its own .gitignore so learned facts stay on this machine.
# notebook/ keeps its own .gitignore so the agent's own files stay on this machine.
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


def ensure_notebook_index(nb_dir: Path) -> None:
    """Create an empty `NOTEBOOK.md` index in the notebook store if absent — and
    NEVER overwrite one (the agent curates it). The store's README is the static
    convention; NOTEBOOK.md is the live table of contents the agent reads and keeps
    (AGENT.md §5). A freshly-seeded or hand-emptied store would otherwise lack it,
    so the agent is told to read a file that does not exist."""
    if nb_dir.is_dir():
        idx = nb_dir / "NOTEBOOK.md"
        if not idx.exists():
            idx.write_text("# Notebook Index\n", encoding="utf-8")


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
    fact files, refreshed in place) and `notebook/` (the agent's sovereign
    space — seeded once, never re-emitted; only its `.gitignore` is re-asserted),
    and `context.json` — written once, beside
    AGENT.md, and never touched again. The build therefore cleans its own footprint
    without ever destroying the user's repository or data."""
    theme, items = render_all(theme_name)
    assert_source_complete(items, context=f"theme '{theme_name}'")
    out.mkdir(parents=True, exist_ok=True)

    for src_dir in OWNED_SRC_DIRS:
        managed = out / theme.get(SRC_DIR_TOKENS[src_dir], src_dir)
        if managed.is_dir():
            shutil.rmtree(managed)

    nb_dirname = theme.get(SRC_DIR_TOKENS["notebook"], "notebook")
    for out_rel, text, src in items:
        dest = out / out_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        # The notebook is the agent's sovereign space (spec 2026-06-11): its
        # seeded files (charter README) are written once and never re-emitted,
        # so the agent may rewrite its own rules. Only `.gitignore` is
        # re-asserted every run — the one law the agent cannot lift: the space
        # never enters the host repo.
        rel = Path(out_rel)
        if (rel.parts[0] == nb_dirname and rel.name != ".gitignore"
                and dest.exists()):
            continue
        if text is not None:
            dest.write_text(text, encoding="utf-8")
        else:
            shutil.copy2(src, dest)

    (out / ".geneseed-theme").write_text(theme_name + "\n", encoding="utf-8")
    write_version(out)
    ensure_context_stub(out)
    ensure_wiki_stub(out)
    ensure_bundle_gitignore(out)
    ensure_memory_index(out / theme.get(SRC_DIR_TOKENS["memory"], "memory"))
    ensure_notebook_index(out / theme.get(SRC_DIR_TOKENS["notebook"], "notebook"))
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

