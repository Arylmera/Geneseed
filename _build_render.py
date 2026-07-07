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


def _insert_theme_keys(raw: str, theme: dict, tmpl: dict, tmpl_keys: list,
                       missing: list) -> str | None:
    """Insert ONLY the missing keys into the theme's existing TEXT, each as one new
    line at its template-order position — never re-serialising the untouched lines.
    A full `json.dumps` round-trip cannot reproduce the shipped files byte-for-byte
    (they mix raw Unicode with legacy \\uXXXX escapes), so re-dumping made a one-key
    sync rewrite ~170 lines per theme; textual insertion keeps the diff to the
    inserted line (plus at most a comma on its predecessor).

    Assumes the shipped convention: `{` on its own first line, one `  "KEY": value`
    entry per line. Returns None when the file doesn't follow it, or when the result
    fails the reparse safety check — the caller then falls back to a full re-dump."""
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "{":
        return None

    def line_of(key: str) -> int | None:
        prefix = f'  "{key}":'
        for i, ln in enumerate(lines):
            if ln.startswith(prefix):
                return i
        return None

    # Every existing key must be locatable as its own line, or the format assumption
    # is wrong and inserting would corrupt the file.
    if any(line_of(k) is None for k in theme):
        return None
    for k in missing:   # template order, so an earlier insert can anchor a later one
        entry = f'  "{k}": {json.dumps(tmpl[k], ensure_ascii=False)}'
        pred = None
        for pk in reversed(tmpl_keys[:tmpl_keys.index(k)]):
            li = line_of(pk)
            if li is not None:
                pred = li
                break
        if pred is None:
            # No earlier template key exists in this theme: insert right after `{`.
            follows = any(ln.lstrip().startswith('"') for ln in lines[1:])
            lines.insert(1, entry + ("," if follows else ""))
        elif lines[pred].rstrip().endswith(","):
            lines.insert(pred + 1, entry + ",")
        else:
            # Predecessor was the last entry: it gains the comma, the new line is last.
            lines[pred] += ","
            lines.insert(pred + 1, entry)
    new_text = "\n".join(lines) + "\n"
    # Safety net: the surgically-edited text must parse back to exactly the merge we
    # meant (theme + missing template keys). Anything else — a multi-line value we
    # didn't anticipate, a stray edit — and the caller uses the re-dump fallback.
    try:
        reparsed = json.loads(new_text)
    except json.JSONDecodeError:
        return None
    want = dict(theme)
    for k in missing:
        want[k] = tmpl[k]
    return new_text if reparsed == want else None


def sync_themes() -> int:
    """Fill every shipped theme with the keys `_TEMPLATE.json` defines but the theme is
    missing — the assist for the parity gate (`_theme_parity_problems`) a maintainer
    hits after adding a new VOICE token. Each missing key is added with the template's
    own (placeholder) value and reported so the maintainer knows exactly what to
    restyle; keys a theme has that the template doesn't are reported too, but never
    removed automatically (a maintainer call, not a build-time one).

    New keys are inserted in TEMPLATE ORDER — matching the convention every shipped
    theme already follows (see themes/neutral.json) — via minimal textual insertion
    (`_insert_theme_keys`): untouched lines stay byte-identical, so a one-key sync is
    a one-line diff per theme, and a no-op run rewrites nothing at all.

    Returns the number of themes actually modified (0 == already in sync). The CLI
    maps that to the exit code (non-zero when files changed), so CI can run
    `build.py --sync-themes` as a check."""
    tmpl_path = THEMES / "_TEMPLATE.json"
    try:
        tmpl = json.loads(tmpl_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"[sync-themes] {tmpl_path.name} unreadable: {e}")
        return 0
    tmpl_keys = list(tmpl.keys())
    changed = 0
    for p in theme_files():
        try:
            raw = p.read_text(encoding="utf-8")
            theme = json.loads(raw)
        except (OSError, json.JSONDecodeError) as e:
            print(f"[sync-themes] {p.name}: unreadable ({e}) — skipped")
            continue
        missing = [k for k in tmpl_keys if k not in theme]
        extra = sorted(set(theme) - set(tmpl))
        if not missing:
            if extra:
                print(f"[sync-themes] {p.name}: in sync (extra key(s) not in template, "
                      f"not removed: {', '.join(extra)})")
            continue
        new_text = _insert_theme_keys(raw, theme, tmpl, tmpl_keys, missing)
        if new_text is None:
            # Unconventional formatting: fall back to a full re-dump — template order,
            # theme-only extras preserved at the end, real Unicode kept as-is.
            merged = {k: theme.get(k, tmpl[k]) for k in tmpl_keys}
            for k in theme:
                if k not in merged:
                    merged[k] = theme[k]
            new_text = json.dumps(merged, indent=2, ensure_ascii=False) + "\n"
        p.write_text(new_text, encoding="utf-8")
        changed += 1
        print(f"[sync-themes] {p.name}: added {len(missing)} key(s) from the template — "
              f"RESTYLE these in this theme's voice: {', '.join(missing)}")
        if extra:
            print(f"[sync-themes] {p.name}: extra key(s) not in template, not removed: "
                  f"{', '.join(extra)}")
    if not changed:
        print("[sync-themes] all themes already carry every template key.")
    return changed


def substitute(text: str, theme: dict) -> str:
    def repl(m: re.Match) -> str:
        key = m.group(1)
        if key not in theme:
            return m.group(0)  # leave unknown tokens untouched, visible for debugging
        return str(theme[key])

    return TOKEN_RE.sub(repl, text)


def _terse_laws(text: str, theme: dict, laws_prefix: str = "") -> str:
    """Lean rendering of the (already-themed) laws: each law's heading + its first
    sentence (the rule itself), elaboration dropped, plus a pointer to the full
    standalone file. Keeps the agent rule-aware in §1 while the rationale loads on
    demand — the lean footprint's whole point.

    ponytail: naive first-sentence split (`.`/`!`/`?` + space). It governs only how
    much of each law shows inline — the binding full text always ships at
    `<laws>/universal.md`, so a mis-split costs a slightly long line, never meaning."""
    blocks = re.split(r"(?m)^(?=### )", text)
    out = [blocks[0].rstrip()]   # preamble before the first law heading, kept verbatim
    for b in blocks[1:]:
        lines = b.splitlines()
        heading = lines[0].rstrip()
        body = " ".join(l.strip() for l in lines[1:]).strip()
        m = re.match(r"(.+?[.!?])(?:\s|$)", body, re.S)
        out.append(f"{heading}\n{m.group(1).strip() if m else body}")
    law = theme.get("LAW", "Law")
    laws_dir = theme.get("DIR_LAWS", "laws")
    pointer = (
        f"> Each {law} above is given in brief — the rule, not its reasoning. The "
        f"complete, binding text of every {law} is in `{laws_prefix}{laws_dir}/universal.md`; "
        f"read it whenever a {law}'s application is unclear, and before any act touching "
        f"secrets, deletion, git history, scope, or untrusted content."
    )
    return "\n\n".join(out) + "\n\n" + pointer


def render_file(path: Path, theme: dict, footprint: str = "full",
                laws_prefix: str = "", _visiting: "frozenset[Path]" = frozenset()) -> str:
    """Render one source file: inline INCLUDE directives, then substitute tokens.

    `footprint='lean'` replaces the INLINED copy of laws/universal.md (AGENT.md §1)
    with a terse rule-only digest + a pointer to the standalone full file; `laws_prefix`
    prefixes that pointer for hosts whose laws dir sits under a marker dir beside the
    instructions file (e.g. '.claude/'). The STANDALONE laws file is rendered by
    render_all's own loop, never through this inline path, so it always stays full.

    `_visiting` carries the chain of files currently being inlined, so a circular
    INCLUDE (a -> b -> a, or a file including itself) is caught and reported as a
    visible marker instead of recursing until Python raises RecursionError."""
    here = path.resolve()
    text = path.read_text(encoding="utf-8")

    def inline(m: re.Match) -> str:
        rel = m.group("path")
        target = (SRC / rel).resolve()
        if not target.exists():
            return f"<!-- MISSING INCLUDE: {rel} -->"
        if target == here or target in _visiting:
            return f"<!-- CIRCULAR INCLUDE: {rel} -->"
        inner = render_file(target, theme, footprint, laws_prefix, _visiting | {here}).rstrip("\n")
        if footprint == "lean" and rel == "laws/universal.md":
            inner = _terse_laws(inner, theme, laws_prefix)
        return inner

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


# The user's own standing rules — seeded once beside AGENT.md, never overwritten,
# never in an owned-manifest. The laws are regenerated on every update; this file
# is where user-authored governance lives so it survives updates, reinstalls, and
# theme switches. Deliberately NOT in BUNDLE_GITIGNORE: project rules are meant to
# be committed and shared with the team (unlike context.json's private paths).
# The filename is user-rules.md — not rules.md — because the neutral theme renders
# the laws themselves as "Rules"; the user- prefix keeps the two unmistakable.
RULES_FILE = "user-rules.md"

RULES_STUB = """\
# User rules

Your own standing rules. The agent obeys every rule in this file exactly as it
obeys the laws in AGENT.md §1 — always in force, in every task. A user rule may
*tighten* a law, never repeal one: where they conflict, the law wins.

Geneseed seeded this file once and will never overwrite it. The laws file is
regenerated on every update — never edit that one; this file is where your own
governance lives, and it survives updates, reinstalls, and theme switches.
Unlike `context.json`, it is safe to commit: project rules are meant to travel
with the repo and bind the whole team.

Keep the set small — every rule here is loaded every session, and a bloated
rule set dilutes the rules that matter. A durable fact belongs in memory, a
pointer to documentation belongs in `context.json`; only a standing *behaviour*
belongs here.

Format — one rule per `## R<n> — Title` heading, an optional metadata line in
parentheses, then the rule stated plainly:

    ## R1 — No emoji in commit subjects
    (scope: project | source: written by hand)
    Commit subjects are plain text; no emoji, no decorative unicode.

`trial until: YYYY-MM-DD` in the metadata line marks a rule on probation —
usually one promoted from a recurring memory. Review it by that date, then
graduate it (remove the marker) or demote it back to memory.
"""


def ensure_rules_stub(out: Path) -> None:
    """Drop the `user-rules.md` stub beside AGENT.md the first time only — and NEVER
    overwrite it (it holds the user's own standing rules; an update that touched it
    would destroy exactly the governance the file exists to preserve). Never recorded
    in an owned-manifest either, so the global emits' prune treats it as the user's —
    the same contract as context.json and wiki.jsonc."""
    dest = out / RULES_FILE
    if not dest.exists():
        dest.write_text(RULES_STUB, encoding="utf-8")


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

# Which theme + emit mode + footprint this host last built (local build state, must not travel).
.geneseed-theme
.geneseed-emit
.geneseed-footprint
.geneseed-srcdirs.json

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


def render_all(theme_name: str, footprint: str = "full",
               laws_prefix: str = "") -> tuple[dict, list[tuple[str, str | None, Path]]]:
    """Render every source file once. Returns (theme, items) where each item is
    (output_relpath, rendered_text_or_None, source_path). Text files carry their
    rendered text; binary files carry None text and are copied from source_path.

    Renders with `effective_theme` — the chosen theme's voice over the fixed neutral
    STRUCTURE — so section names and folder names are theme-independent everywhere.

    `footprint='lean'` makes AGENT.md's inlined §1 laws terse (see render_file); the
    standalone laws/universal.md item stays full. `laws_prefix` is the pointer prefix
    for hosts whose laws dir lives under a marker dir (e.g. '.claude/').

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
            items.append((out_rel, render_file(path, theme, footprint, laws_prefix), path))
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


def read_release_version(path: Path) -> "str | None":
    """The human-readable release label (harness.config.json's `version` at the time
    of that build) recorded in a deployed harness's .geneseed-version — the
    `[release X]` bracket write_version appends — or None if absent/unreadable/from
    a build predating this stamp (legacy marker, fingerprint-only)."""
    try:
        txt = (path / VERSION_MARKER).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    m = re.search(r"\[release ([^\]]+)\]", txt)
    return m.group(1) if m else None


def _warn_if_downgrade(out: Path) -> None:
    """Loud, warn-only notice when re-emitting over an install whose recorded
    release version is NEWER than the source tree's — the classic "forgot to git
    pull" trap. Never blocks: the self-update flow is `git pull` + rebuild, but a
    deliberate downgrade (checking out an older tag, testing a past release) must
    stay possible. Silent no-op when either side's version doesn't parse (tuple
    compare — see version_is_newer) or there's nothing deployed yet to compare."""
    deployed = read_release_version(out)
    if deployed is None:
        return
    current = source_release_version()
    newer = version_is_newer(deployed, current)
    if newer:
        # ASCII-only prefix: build.py is often run with an unconfigured cp1252
        # Windows console, where a warning-sign emoji would raise UnicodeEncodeError
        # and eat the warning exactly when it matters.
        print(f"[geneseed] WARN: installing older Geneseed {current} over newer "
              f"{deployed} at {out} — did you forget git pull?")


def write_version(out: Path) -> str:
    """Stamp <out>/.geneseed-version with the source fingerprint + build date + the
    current release label, so a deployed harness records which source produced it.
    Before overwriting, warns (never blocks) if the install's PREVIOUS recorded
    release is newer than the source tree's — see `_warn_if_downgrade`. Returns the
    fingerprint."""
    _warn_if_downgrade(out)
    fp = source_fingerprint()
    release = source_release_version()
    (out / VERSION_MARKER).write_text(
        f"{fp} (built {datetime.date.today().isoformat()}) [release {release}]\n",
        encoding="utf-8")
    return fp


def read_version(path: Path) -> "str | None":
    """The fingerprint token recorded in a deployed harness's .geneseed-version (the
    first whitespace-delimited token), or None if absent/empty/unreadable."""
    try:
        txt = (path / VERSION_MARKER).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return txt.split()[0] if txt else None


# Task 9: the portable bundle (build()) has no per-file manifest — it wipes and
# regenerates OWNED_SRC_DIRS wholesale each run, keyed by the CURRENT theme's DIR_*
# resolution. That is not enough on its own: if a theme's DIR_* value ever changes
# between two builds into the SAME `out` (a theme edit, or switching themes), the
# OLD themed dir name is never targeted by the new run's wipe and is orphaned. This
# tiny marker remembers which dir name was actually used for each OWNED_SRC_DIRS
# entry last time, so build() can also wipe THAT one when it no longer matches.
# (DIR_* is theme-independent in practice today — STRUCTURE always wins over a
# theme's own value, see effective_theme — but the marker costs nothing and closes
# the gap the moment that changes, or for a future theme that does vary it.)
SRC_DIRS_MARKER = ".geneseed-srcdirs.json"


def _read_prior_src_dirs(out: Path) -> dict:
    try:
        data = json.loads((out / SRC_DIRS_MARKER).read_text(encoding="utf-8"))
    except OSError:
        return {}
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _write_src_dirs_marker(out: Path, resolved: dict) -> None:
    tmp = out / (SRC_DIRS_MARKER + ".tmp")
    tmp.write_text(json.dumps(resolved, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, out / SRC_DIRS_MARKER)


def build(theme_name: str, out: Path, footprint: str = "full") -> None:
    """Render the bundle into `out`.

    `footprint='lean'` renders AGENT.md's §1 laws terse (rule + pointer); the
    standalone laws/<universal>.md beside it stays full as the on-demand fallback.
    The `.geneseed-footprint` marker is written by build.py main() (the single
    marker choke point), not here.

    Before rendering, the dirs the build fully owns (`OWNED_SRC_DIRS` — laws,
    agents, skills, in their themed form) are wiped, so a renamed or removed source
    file never leaves a stale copy behind. A renamed DIR_* dir from a PRIOR build
    (recorded in `.geneseed-srcdirs.json`) is wiped too, even though the current
    theme no longer produces that name — see the marker's module comment (Task 9).
    Accepted edge: a user dir that merely SHARES a previously-recorded themed name
    is deleted only because the build itself recorded that name — nothing outside
    what a prior build wrote down (and shape-checked) is ever pruned.
    Everything else in `out` is preserved: the surrounding application code, the
    agent's runtime `memory/` (MEMORY.md + fact files, refreshed in place) and
    `notebook/` (the agent's sovereign space — seeded once, never re-emitted; only
    its `.gitignore` is re-asserted), and `context.json` — written once, beside
    AGENT.md, and never touched again. The build therefore cleans its own footprint
    without ever destroying the user's repository or data."""
    theme, items = render_all(theme_name, footprint)
    assert_source_complete(items, context=f"theme '{theme_name}'")
    out.mkdir(parents=True, exist_ok=True)

    # Wipe the owned dirs ONLY inside an established Geneseed bundle (marker
    # present). A first render into an arbitrary repo (`--out .`) must never
    # delete a pre-existing agents/ or skills/ dir the USER owns.
    is_bundle = ((out / ".geneseed-theme").is_file()
                 or (out / ".geneseed-version").is_file())
    prior_src_dirs = _read_prior_src_dirs(out) if is_bundle else {}
    resolved_src_dirs = {}
    for src_dir in OWNED_SRC_DIRS:
        dirname = theme.get(SRC_DIR_TOKENS[src_dir], src_dir)
        resolved_src_dirs[src_dir] = dirname
        managed = out / dirname
        # A prior build recorded a DIFFERENT resolved name for this same
        # OWNED_SRC_DIRS entry (a DIR_* rename) — that old dir is no longer
        # produced by anything and would otherwise be orphaned; wipe it too.
        # NEVER rmtree an unvalidated marker value: the marker is a plain file a
        # user (or another tool) can edit — ".." would delete the bundle's PARENT,
        # an absolute path replaces `out` entirely under Path.__truediv__, and
        # "a/b" reaches into nested content. Only a plain single-segment dir name
        # resolving directly under `out` is ever deleted; anything else is skipped
        # with a loud WARN naming the marker, never guessed at.
        prior_name = prior_src_dirs.get(src_dir)
        if is_bundle and prior_name and prior_name != dirname:
            if (isinstance(prior_name, str)
                    and prior_name not in (".", "..")
                    and not Path(prior_name).is_absolute()
                    and Path(prior_name).name == prior_name
                    and (out / prior_name).resolve().parent == out.resolve()):
                stale = out / prior_name
                if stale.is_dir():
                    shutil.rmtree(stale)
            else:
                print(f"[geneseed] WARN: ignoring suspicious prior dir name "
                      f"{ascii(prior_name)} recorded in {SRC_DIRS_MARKER} - "
                      f"not pruned.", file=sys.stderr)
        if not managed.is_dir():
            continue
        if is_bundle:
            shutil.rmtree(managed)
        else:
            # WARN, not the old warning-sign emoji: this print crashed with
            # UnicodeEncodeError on a cp1252 Windows console (U+26A0 is unencodable
            # there) — the warning must survive the consoles most likely to need it.
            print(f"[geneseed] WARN: {managed} already exists and {out} is not a "
                  f"Geneseed bundle — keeping it; rendered files merge into it.")

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
    _write_src_dirs_marker(out, resolved_src_dirs)
    ensure_context_stub(out)
    ensure_wiki_stub(out)
    ensure_rules_stub(out)
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


_HTML_COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")


def _desc_block_problem(text: str) -> str:
    """Guard against `_first_blockquote` (and its `desc_of` alias, which every
    OpenCode/Claude/Bob frontmatter `description:` is built from) silently grabbing
    the WRONG line. `_first_blockquote` returns the first `>`-line anywhere in the
    file — if a spec's actual first content block is plain prose (not a blockquote)
    and a `>` line only shows up later (in a code sample, a nested callout, a stray
    quote), the description becomes that unrelated line with no error anywhere.

    Every real agent/skill spec (after its authoring `<!-- -->` comment is stripped)
    opens with an H1 title line, then its one-line purpose as a `>` blockquote — see
    src/agents/_template.md and src/skills/_template.md. This validates exactly that
    shape: the first non-blank line is the title, and the very next non-blank line is
    the blockquote (non-empty after its `>` marker is stripped). Returns "" when the
    shape holds, else a one-line reason naming what was found instead."""
    stripped = _HTML_COMMENT_RE.sub("", text)
    nonblank = [ln for ln in stripped.splitlines() if ln.strip()]
    if not nonblank:
        return "file is empty (after stripping authoring comments)"
    if not nonblank[0].lstrip().startswith("#"):
        return f"first content line is not a title ('# ...'): {nonblank[0].strip()!r}"
    if len(nonblank) < 2:
        return "has a title but no purpose blockquote after it"
    second = nonblank[1].strip()
    if not second.startswith(">"):
        return f"first block after the title is not a '>' blockquote: {second!r}"
    if not second.lstrip(">").strip():
        return "purpose blockquote is empty"
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
    good copies). This is the gate the upgrade path runs on the pulled source, brought
    into the build itself so direct `build.py`, `harness build`, and the `setup` wizard
    are guarded too — not just the upgrade path."""
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

