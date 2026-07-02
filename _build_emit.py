"""Geneseed build — the OpenCode emit: native subagent/skill/command layers,
opencode.json merge, plugin/workflow copy, primary-agent and theme writers.

Part of the build CLI (see build.py). Imports the shared toolset from _build_core."""
from __future__ import annotations

from _build_core import *  # noqa: F401,F403  shared stdlib + constants


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


# Curated full-palette OpenCode colour themes (themes/opencode/*.json), decoupled from
# the voice theme. Each source carries one palette (named roles); the slot map below is
# shared, so a new theme = one palette file. See docs/specs/2026-06-17-opencode-color-themes.md.
COLOR_THEMES = THEMES / "opencode"

# OpenCode theme slot -> palette role. Background roles flip to "none" in the transparent
# flavour (see _TRANSPARENT_NONE) — that's the ONLY difference between the two flavours.
_SLOT_ROLE = {
    "primary": "accent", "secondary": "secondary", "accent": "accent",
    "error": "err", "warning": "warn", "success": "ok", "info": "accent",
    "text": "fg", "textMuted": "fgMuted",
    "background": "bg", "backgroundPanel": "bgPanel", "backgroundElement": "bgElement",
    "border": "border", "borderActive": "accent", "borderSubtle": "border",
    "diffAdded": "ok", "diffRemoved": "err", "diffContext": "fgMuted",
    "diffHunkHeader": "accent", "diffHighlightAdded": "ok", "diffHighlightRemoved": "err",
    "diffAddedBg": "addBg", "diffRemovedBg": "delBg", "diffContextBg": "bgPanel",
    "diffLineNumber": "fgMuted", "diffAddedLineNumberBg": "addBg", "diffRemovedLineNumberBg": "delBg",
    "markdownText": "fg", "markdownHeading": "accent", "markdownLink": "secondary",
    "markdownLinkText": "accent", "markdownCode": "ok", "markdownBlockQuote": "fgMuted",
    "markdownEmph": "warn", "markdownStrong": "warn", "markdownHorizontalRule": "border",
    "markdownListItem": "accent", "markdownListEnumeration": "accent", "markdownImage": "secondary",
    "markdownImageText": "accent", "markdownCodeBlock": "bgElement",
    "syntaxComment": "comment", "syntaxKeyword": "kw", "syntaxFunction": "fn",
    "syntaxVariable": "fg", "syntaxString": "str", "syntaxNumber": "num",
    "syntaxType": "type", "syntaxOperator": "kw", "syntaxPunctuation": "fgMuted",
}
# Slots that become the terminal default ("none") in the transparent flavour. The diff
# *line* backgrounds (addBg/delBg/their line-number bgs) deliberately stay tinted hex even
# when transparent — going fully none there makes +/- lines unreadable.
_TRANSPARENT_NONE = {"background", "backgroundPanel", "backgroundElement",
                     "diffContextBg", "markdownCodeBlock"}
_PALETTE_ROLES = set(_SLOT_ROLE.values())


def _color_theme_json(palette: dict, transparent: bool) -> dict:
    t = {slot: ("none" if transparent and slot in _TRANSPARENT_NONE else palette[role])
         for slot, role in _SLOT_ROLE.items()}
    return {"$schema": "https://opencode.ai/theme.json", "theme": t}


def color_theme_files() -> list[Path]:
    """Shipped colour-theme sources under themes/opencode/, excluding `_`-prefixed scaffolds."""
    if not COLOR_THEMES.is_dir():
        return []
    return sorted(p for p in COLOR_THEMES.glob("*.json") if not p.name.startswith("_"))


def _snapshot_user_themes(themes_dir: Path) -> dict[str, bytes]:
    """Capture EVERY theme file (name->bytes) before the full `.opencode` wipe. After the
    emit re-creates the shipped themes, _restore_user_themes rewrites only the ones that
    were NOT regenerated — i.e. the user's own themes — so a rebuild never erases them,
    whether or not they carry the `geneseed-` prefix (spec §8.2). Ownership is thus the
    set of files this emit writes, not the filename prefix.
    # ponytail: a shipped theme whose source palette was deleted would be resurrected here
    # rather than dropped. Only bites a maintainer editing themes/opencode/, who rebuilds
    # and sees it — switch to a manifest/emit-set diff if that ever matters."""
    if not themes_dir.is_dir():
        return {}
    return {p.name: p.read_bytes() for p in themes_dir.glob("*.json")}


def _restore_user_themes(themes_dir: Path, saved: dict[str, bytes]) -> None:
    """Re-write captured themes the new emit did NOT regenerate — that leaves exactly the
    user's own themes, since every shipped theme was just recreated and so already exists."""
    themes_dir.mkdir(parents=True, exist_ok=True)
    for name, data in saved.items():
        dest = themes_dir / name
        if not dest.exists():
            dest.write_bytes(data)


def _write_color_themes(themes_dir: Path) -> list[Path]:
    """Emit every curated colour theme in both flavours: geneseed-<name>-solid.json and
    geneseed-<name>-transparent.json (select with `/theme geneseed-<name>-solid`). Returns
    the written paths."""
    themes_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for src in color_theme_files():
        spec = json.loads(src.read_text(encoding="utf-8"))
        palette = spec["palette"]
        for flavour, transparent in (("solid", False), ("transparent", True)):
            dest = themes_dir / f"geneseed-{spec['name']}-{flavour}.json"
            dest.write_text(json.dumps(_color_theme_json(palette, transparent), indent=2) + "\n",
                            encoding="utf-8")
            written.append(dest)
    return written


def _claude_agent_frontmatter(stem: str, text: str, overrides: dict) -> list[str]:
    """Claude Code subagent frontmatter (~/.claude/agents/<name>.md or project
    .claude/agents/). Required `name` + `description`; a read-only agent maps
    OpenCode's `permission` deny-tree onto Claude's `disallowedTools:` denylist
    (Write/Edit/WebFetch, plus Bash unless the spec opts in with `<!-- bash: allow -->`).
    Claude has no `mode:`/`color:`/`permission:` keys, so those are omitted. Only a
    `model:` override carries over (Claude has no temperature/variant/steps)."""
    fm = [f"name: {stem}", f"description: {json.dumps(desc_of(text))}"]
    ov = overrides.get(stem) or {}
    if ov.get("model"):
        fm.append(f"model: {ov['model']}")
    if _is_readonly(text):
        denied = ["Write", "Edit", "WebFetch"]
        if "<!-- bash: allow -->" not in text:
            denied.append("Bash")
        fm.append("disallowedTools: " + ", ".join(denied))
    return fm


def _opencode_agent_frontmatter(stem: str, text: str, overrides: dict) -> list[str]:
    """OpenCode subagent frontmatter: description, mode: subagent, a NAMED theme-slot
    colour, optional per-agent overrides, and (for read-only agents) the permission
    deny-tree. Factored out of _write_native_layer so the Claude dialect is a sibling."""
    fm = [f"description: {json.dumps(desc_of(text))}", "mode: subagent"]
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
    return fm


def desc_of(text: str) -> str:
    """The first block-quote of a spec — its one-line purpose. Thin alias for
    _first_blockquote so the frontmatter builders read cleanly."""
    return _first_blockquote(text)


def _write_native_layer(items, agents_dir: Path, skills_dir: Path, overrides=None,
                        host: str = "opencode", old_owned=None,
                        cfg: Path | None = None) -> tuple[int, int, list[Path]]:
    """Render capability agents and skills into host-native files.

    - Agents -> `<agents_dir>/<name>.md`. `host` selects the frontmatter dialect:
      'opencode' (description, mode: subagent, color, permission deny-tree) or
      'claude' (name, description, disallowedTools denylist). See the two
      `_*_agent_frontmatter` builders.
    - Skills -> `<skills_dir>/<name>/SKILL.md`. BYTE-IDENTICAL across hosts: name +
      description, body link-stripped. Model-invoked via the `skill` tool, NOT slash
      commands. See adapters/opencode/GLOBAL-HARNESS-SPEC.md §9.1.

    User-content safety (claim-on-create): when BOTH `old_owned` and `cfg` are given, a
    target that ALREADY EXISTS and is NOT in the prior manifest is the user's own — it
    is left untouched (a warning is printed) and never added to the returned owned set,
    so a re-emit never clobbers a same-named user agent/skill and uninstall never
    deletes it. With `old_owned`/`cfg` omitted (the per-repo and portable bundle emits,
    which write into a dir they fully own) every file is written unconditionally.

    Keys off the SOURCE folder name (always neutral) so a theme can rename the
    rendered bundle dirs without moving the host's fixed `agents/`/`skills/`.
    Returns (n_agents, n_skills, written_paths)."""
    overrides = overrides or {}
    old_set = set(old_owned) if old_owned is not None else None
    n_agents = n_skills = 0
    written: list[Path] = []

    def _claim(dest: Path) -> bool:
        # True -> ok to (over)write; False -> a pre-existing file we never owned, so it
        # is the user's: leave it, warn, and keep it out of the manifest.
        if old_set is None or cfg is None or not dest.exists():
            return True
        rel = dest.relative_to(cfg).as_posix()
        if rel in old_set:
            return True
        print(f"[geneseed] kept your existing {rel} — skipped Geneseed's copy to avoid "
              f"clobbering it", file=sys.stderr)
        return False

    for _out_rel, text, src in items:
        sparts = src.relative_to(SRC).as_posix().split("/")
        # Vendored third-party skill folders (skills/<name>/…) ride along verbatim into
        # the native skills dir, preserving their own multi-file layout and upstream
        # format, so AGENT.md's vendored-skill pointer resolves in this emit too (the
        # global install builds no sibling bundle). They are copied through — NOT wrapped
        # as a native SKILL.md — and never counted as harness skills.
        if len(sparts) >= 2 and sparts[0] == "skills" and sparts[1] in VENDORED_SKILL_DIRS:
            dest = skills_dir.joinpath(*sparts[1:])
            if not _claim(dest):
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            if text is not None:
                dest.write_text(text, encoding="utf-8")
            else:
                shutil.copy2(src, dest)
            written.append(dest)
            continue
        if text is None:
            continue
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
            if not _claim(dest):
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text.lstrip("\n"), encoding="utf-8")
            written.append(dest)
            continue
        stem = fname[:-3]
        body = text.lstrip("\n")
        if folder == "agents":
            fm = (_claude_agent_frontmatter(stem, text, overrides) if host == "claude"
                  else _opencode_agent_frontmatter(stem, text, overrides))
            dest = agents_dir / f"{stem}.md"
            kind = "agent"
        elif folder == "skills":
            fm = [f"name: {stem}", f"description: {json.dumps(desc_of(text))}"]
            body = _strip_skill_body_links(body)   # the host never follows these — plain text
            dest = skills_dir / stem / "SKILL.md"
            kind = "skill"
        else:
            continue
        if not _claim(dest):
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("---\n" + "\n".join(fm) + "\n---\n\n" + body, encoding="utf-8")
        written.append(dest)
        if kind == "agent":
            n_agents += 1
        else:
            n_skills += 1
    return n_agents, n_skills, written


_OPENCODE_SCHEMA = "https://opencode.ai/config.json"


def _default_permission() -> dict:
    """A fresh copy of the minimal, non-destructive default permission policy — ASK
    before the few genuinely irreversible or outward-facing bash patterns (Laws
    I/IV/XX). `git commit*` and `git push*` gate EVERY commit and push, on any branch,
    so the agent never records or shares history unprompted (Law XX's host-level
    backstop); the `--force`/`-f` entries are kept as explicit, more-specific markers.
    Added ONLY when the user has no `permission` key at all; never overwrites an
    existing policy. Unmatched commands keep OpenCode's default (allow), so normal
    local work (edits, builds, tests) is unaffected."""
    return {
        "bash": {
            "rm -rf *": "ask",
            "git commit*": "ask",
            "git push*": "ask",
            "git push --force*": "ask",
            "git push -f*": "ask",
        }
    }


def _opencode_target(json_path: Path) -> Path:
    """The OpenCode config file to actually operate on at this location. OpenCode loads
    BOTH `opencode.json` and `opencode.jsonc` and merges them, with `.jsonc` winning on
    conflict, and writes to `.jsonc` first when it exists. So a present sibling `.jsonc`
    is the authoritative file — operate on it, not on a separate `.json` we'd be
    splitting config across. Given a `…/opencode.json` path, return its `…/opencode.jsonc`
    sibling when that exists, else the `.json` path (so we never create a `.jsonc`
    ourselves)."""
    jsonc = json_path.with_suffix(".jsonc")
    return jsonc if jsonc.exists() else json_path


def _read_jsonc(text: str) -> "tuple[object, bool]":
    """Parse JSON-with-comments, returning (data, had_comments). String-aware: `//`
    line and `/* */` block comments are stripped only OUTSIDE string literals, and
    trailing commas are removed, before `json.loads`. A `//` inside a string — notably
    the `$schema` value `https://opencode.ai/config.json` — is preserved and does NOT
    set `had_comments`. Only `"` delimits strings (JSON has no single-quoted strings),
    so an apostrophe inside a description never confuses the scan. Unparseable input
    yields ({}, had_comments), preserving the caller's malformed-file fallback."""
    out: "list[str]" = []
    had_comments = False
    i, n, in_str = 0, len(text), False
    while i < n:
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            had_comments = True
            i += 2
            while i < n and text[i] not in ("\n", "\r"):
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            had_comments = True
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        if ch in "}]":
            # Structural close, outside any string: drop a trailing comma before it
            # (with intervening whitespace). String-aware by construction — a comma
            # inside a string is followed by that string's closing quote, never by a
            # bare structural brace, so it is never the char we pop here.
            while out and out[-1] in " \t\r\n":
                out.pop()
            if out and out[-1] == ",":
                out.pop()
            out.append(ch)
            i += 1
            continue
        out.append(ch)
        i += 1
    stripped = "".join(out)
    try:
        return json.loads(stripped), had_comments
    except (json.JSONDecodeError, ValueError):
        # None = UNPARSEABLE, distinct from a legitimately empty {} — writers
        # must refuse to rewrite such a file (it would destroy the user's
        # config over a single typo); readers treat it like "no data".
        return None, had_comments


def _warn_commented_jsonc(target: Path, agent_path: str, include_permission: bool,
                          include_lsp: bool = False, prefix: str = "geneseed") -> None:
    """Tell the user how to wire Geneseed in by hand. Called only when `target` is a
    `.jsonc` carrying comments and we have a real change to make — we refuse to rewrite
    such a file (it would drop the comments), so we print the exact entry instead."""
    print(f"[{prefix}] {target.name} has comments — not rewriting it (your edits are "
          f"kept). Add this to its \"instructions\" array by hand:")
    print(f"[{prefix}]     {json.dumps(agent_path)}")
    if include_permission:
        print(f"[{prefix}] and, for Geneseed's default ask-gates, a \"permission\" key:")
        for line in json.dumps(_default_permission(), indent=2).splitlines():
            print(f"[{prefix}]     {line}")
    if include_lsp:
        print(f"[{prefix}] and, to enable code intelligence, a top-level \"lsp\": true")


def _merge_opencode_json(path: Path, agent_path: str) -> Path:
    """Ensure the OpenCode config at `path`'s location has `agent_path` in its
    `instructions` array, preserving every other key the user may have set. Resolves a
    sibling `opencode.jsonc` first (see `_opencode_target`) and reads it comment-tolerantly.
    Never clobbers a hand-edited config — it merges the one entry (plus a default
    `permission` policy only when absent). An already-satisfied config is left
    completely untouched. A commented `.jsonc` that still needs a change is NOT
    rewritten (that would strip the comments); the user is warned with the exact entry
    to add. A malformed config is likewise never rewritten — one typo must not cost the
    user their whole file. Returns the resolved target path (the file we wrote, warned
    about, or found already wired)."""
    target = _opencode_target(path)
    config: dict = {"$schema": _OPENCODE_SCHEMA, "instructions": []}
    had_comments = False
    if target.exists():
        try:
            loaded, had_comments = _read_jsonc(target.read_text(encoding="utf-8"))
            if loaded is None:
                print(f"[geneseed] {target.name} is not valid JSON — NOT rewriting it "
                      f"(fix the syntax, then re-run). Add {json.dumps(agent_path)} to "
                      f'its "instructions" once repaired.', file=sys.stderr)
                return target
            if isinstance(loaded, dict):
                config = loaded
        except OSError:
            pass
    config.setdefault("$schema", _OPENCODE_SCHEMA)
    instr = config.get("instructions")
    if not isinstance(instr, list):
        instr = []
    add_instr = agent_path not in instr
    if add_instr:
        instr.append(agent_path)
    config["instructions"] = instr
    add_perm = "permission" not in config
    if add_perm:
        config["permission"] = _default_permission()
    add_lsp = "lsp" not in config
    if add_lsp:
        config["lsp"] = True   # enable every built-in server (LSP is off by default)
    if not (add_instr or add_perm or add_lsp):
        return target   # already wired — leave the file (and any comments) untouched
    if target.suffix == ".jsonc" and had_comments:
        _warn_commented_jsonc(target, agent_path, add_perm, add_lsp)
        return target
    target.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return target


# ---- Claude Code wiring: settings.json hooks + the CLAUDE.md managed block --------
# Claude has no `instructions` array (it auto-loads CLAUDE.md by location) and no JS
# plugins (~/.claude/plugins/ is a managed marketplace, never written). The harness
# reaches Claude through settings.json HOOKS instead — context injection, learn, and
# the git-gate, the same three `harness.py` subcommands the OpenCode plugins drive.

# The adapter's adapters/claude-code/settings.json is the reference for a MANUAL /
# vendored-in-repo install (project-relative, assumes rituals/ at the repo root). A
# GENERATED install (global or an arbitrary folder) can't assume that, so the hooks are
# built programmatically here with ABSOLUTE paths: the interpreter + absolute harness.py
# (known at emit time), and `learn --memory <install>/memory` so memory lands in the
# install's store, not the project cwd. The `cat AGENT.md` startup hooks are dropped —
# CLAUDE.md auto-loads by location, so re-injecting it would double up and would error in
# any repo without an AGENT.md. Hooks run with the project cwd, which is exactly what
# `context` wants (it auto-discovers the project's docs).
def _claude_hook_groups(cfg: Path) -> dict:
    """Geneseed's Claude hooks for an install rooted at `cfg`, keyed by event."""
    py = f'"{sys.executable}"'
    h = f'"{ROOT / "rituals" / "harness.py"}"'
    mem = f'--memory "{cfg / "memory"}"'
    # --root carries the install's own dir so a GLOBAL hook can stand down when a project
    # install of the same host sits at/above cwd (project-bypasses-global; see cmd_context).
    context = f'{py} {h} context --root "{cfg}"'
    return {
        "PreToolUse": [
            {"matcher": "Bash", "hooks": [{"type": "command", "command": f"{py} {h} git-gate"}]},
        ],
        "SessionStart": [
            {"matcher": "startup|clear", "hooks": [{"type": "command", "command": context}]},
            {"matcher": "resume", "hooks": [{"type": "command", "command": context}]},
        ],
        "Stop": [
            {"hooks": [{"type": "command", "command": f"{py} {h} learn {mem} || true"}]},
        ],
    }


def _merge_claude_settings(path: Path, scope: str = "global") -> "tuple[Path, list]":
    """Surgically merge Geneseed's Claude hooks into the user's settings.json,
    preserving every other key AND the user's own hook entries. The install root is
    `path.parent` (so `learn` is pointed at <root>/memory). Returns (target, added)
    where `added` is the list of {event, group} entries actually written — recorded in
    the manifest so unwire/uninstall removes EXACTLY those and nothing else. Idempotent
    (a group already present is not re-added). A settings.json carrying comments is
    never rewritten — the user is warned and nothing changes (mirrors the commented
    `.jsonc` refusal for opencode.json). `scope` is accepted for caller symmetry; the
    generated hooks are absolute either way."""
    config: dict = {}
    had_comments = False
    if path.exists():
        try:
            loaded, had_comments = _read_jsonc(path.read_text(encoding="utf-8"))
            if loaded is None:
                print(f"[geneseed] {path.name} is not valid JSON — NOT rewriting it "
                      f"(fix the syntax, then re-run). Hooks were not wired.",
                      file=sys.stderr)
                return path, []
            if isinstance(loaded, dict):
                config = loaded
        except OSError:
            pass
    hooks = config.get("hooks")
    if not isinstance(hooks, dict):
        hooks = {}
    added: list = []
    for event, new_groups in _claude_hook_groups(path.parent).items():
        arr = hooks.get(event)
        if not isinstance(arr, list):
            arr = []
        for g in new_groups:
            if g in arr:
                continue
            arr.append(g)
            added.append({"event": event, "group": g})
        hooks[event] = arr
    if not added:
        return path, []   # already wired (or nothing to add) — leave the file untouched
    if had_comments:
        print(f"[geneseed] {path.name} has comments — not rewriting it (your edits are "
              f"kept). Add Geneseed's hooks by hand from adapters/claude-code/settings.json.",
              file=sys.stderr)
        return path, []
    config["hooks"] = hooks
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return path, added


def _unwire_claude_settings(path: Path, added: list) -> None:
    """Reverse _merge_claude_settings: remove exactly the recorded hook groups, leaving
    the user's own keys and hooks intact. An emptied event key is dropped; an emptied
    `hooks` block is dropped. A commented settings.json is never rewritten."""
    if not path.exists() or not added:
        return
    try:
        loaded, had_comments = _read_jsonc(path.read_text(encoding="utf-8"))
    except OSError:
        return
    if had_comments or not isinstance(loaded, dict):
        return
    hooks = loaded.get("hooks")
    if not isinstance(hooks, dict):
        return
    for rec in added:
        event, group = rec.get("event"), rec.get("group")
        arr = hooks.get(event)
        if isinstance(arr, list) and group in arr:
            arr.remove(group)
        if isinstance(arr, list) and not arr:
            hooks.pop(event, None)
    if not hooks:
        loaded.pop("hooks", None)
    path.write_text(json.dumps(loaded, indent=2) + "\n", encoding="utf-8")


def _wire_claude_excludes(path: Path, excludes: list) -> list:
    """Add absolute path(s) to a settings.json `claudeMdExcludes` array — Claude's native
    knob to skip a CLAUDE.md by path. A PROJECT install writes the GLOBAL same-host
    preamble here so it is suppressed while cwd is this repo (project-bypasses-global),
    and nowhere else (a project settings.json only merges in its own repo). Append-if-
    absent, every other key preserved, a commented file never rewritten (warned instead).
    Returns the entries actually written."""
    want = [e for e in (excludes or []) if e]
    if not want:
        return []
    config: dict = {}
    had_comments = False
    if path.exists():
        try:
            loaded, had_comments = _read_jsonc(path.read_text(encoding="utf-8"))
            if loaded is None:
                print(f"[geneseed] {path.name} is not valid JSON — NOT rewriting it "
                      f"(fix the syntax, then re-run). Excludes were not wired.",
                      file=sys.stderr)
                return []
            if isinstance(loaded, dict):
                config = loaded
        except OSError:
            pass
    cur = config.get("claudeMdExcludes")
    if not isinstance(cur, list):
        cur = []
    added = [e for e in want if e not in cur]
    if not added:
        return []
    if had_comments:
        print(f"[geneseed] {path.name} has comments — not rewriting it (your edits are "
              f'kept). Add to its "claudeMdExcludes" array by hand: {json.dumps(added)}',
              file=sys.stderr)
        return []
    cur.extend(added)
    config["claudeMdExcludes"] = cur
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return added


def _unwire_claude_excludes(path: Path, excludes: list) -> None:
    """Reverse _wire_claude_excludes: remove exactly these paths from `claudeMdExcludes`,
    dropping the key when it empties. The user's own excludes and keys are untouched; a
    commented file is never rewritten."""
    if not path.exists() or not excludes:
        return
    try:
        loaded, had_comments = _read_jsonc(path.read_text(encoding="utf-8"))
    except OSError:
        return
    if had_comments or not isinstance(loaded, dict):
        return
    cur = loaded.get("claudeMdExcludes")
    if not isinstance(cur, list):
        return
    for e in excludes:
        if e in cur:
            cur.remove(e)
    if cur:
        loaded["claudeMdExcludes"] = cur
    else:
        loaded.pop("claudeMdExcludes", None)
    path.write_text(json.dumps(loaded, indent=2) + "\n", encoding="utf-8")


_BLOCK_BEGIN = "<!-- BEGIN {id} -->"
_BLOCK_END = "<!-- END {id} -->"


def _managed_block_write(path: Path, content: str, block_id: str = "GENESEED") -> str:
    """Write `content` into a single delimited managed block in `path`. Absent file ->
    create it whole (returns 'created'). Existing block -> replace it in place (returns
    'updated'). Otherwise append the block, preserving the user's prose around it
    (returns 'merged'). Idempotent: a re-emit replaces the block, never stacks them."""
    begin, end = _BLOCK_BEGIN.format(id=block_id), _BLOCK_END.format(id=block_id)
    block = f"{begin}\n{content.rstrip()}\n{end}\n"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(block, encoding="utf-8")
        return "created"
    existing = path.read_text(encoding="utf-8")
    if begin in existing and end in existing:
        pre = existing.split(begin, 1)[0]
        post = existing.split(end, 1)[1]
        path.write_text(pre + block + post.lstrip("\n"), encoding="utf-8")
        return "updated"
    sep = "" if existing.endswith("\n") else "\n"
    path.write_text(existing + sep + "\n" + block, encoding="utf-8")
    return "merged"


def _managed_block_remove(path: Path, block_id: str = "GENESEED", whole: bool = False) -> None:
    """Reverse _managed_block_write. `whole` (Geneseed created the file) -> delete it.
    Otherwise excise just the delimited block, keeping the user's prose; a file left
    empty after excision is removed."""
    if not path.exists():
        return
    if whole:
        path.unlink()
        return
    begin, end = _BLOCK_BEGIN.format(id=block_id), _BLOCK_END.format(id=block_id)
    existing = path.read_text(encoding="utf-8")
    if begin not in existing or end not in existing:
        return
    pre = existing.split(begin, 1)[0]
    post = existing.split(end, 1)[1]
    rest = (pre.rstrip("\n") + "\n" + post.lstrip("\n")).strip()
    if rest:
        path.write_text(rest + "\n", encoding="utf-8")
    else:
        path.unlink()


def _managed_block_read(path: Path, block_id: str = "GENESEED") -> "str | None":
    """Return the inner content of the managed block in `path` (between the delimiters,
    exclusive), or None if absent. Lets a deactivate stash the block for an exact
    restore on reactivate without re-rendering."""
    if not path.exists():
        return None
    begin, end = _BLOCK_BEGIN.format(id=block_id), _BLOCK_END.format(id=block_id)
    text = path.read_text(encoding="utf-8")
    if begin not in text or end not in text:
        return None
    return text.split(begin, 1)[1].split(end, 1)[0].strip("\n")


def _copy_plugins(dst: Path, owned: list | None = None) -> int:
    """Copy the static OpenCode plugins (context, learn, guard, workflow, notify, ponytail, activity) into `dst`.
    They are maintained files, not rendered from src, so copy them verbatim. When the
    caller tracks an ownership manifest (the global emit), pass `owned` and each copy
    is appended to it as `plugins/<name>`."""
    n = 0
    if PLUGIN_SRC.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for js in sorted(PLUGIN_SRC.glob("*.js")):
            shutil.copy2(js, dst / js.name)
            if owned is not None:
                owned.append(f"plugins/{js.name}")
            n += 1
    return n


def _copy_workflows(dst: Path, owned: list | None = None) -> int:
    """Copy the saved, code-driven workflow scripts (incl. the `_runtime.js` core) into
    `dst`. They sit beside the plugins dir so `geneseed-workflow.js` resolves them via a
    relative `../workflows/` path. Maintained files, copied verbatim like the plugins;
    `owned` works as in `_copy_plugins` (entries land as `workflows/<name>`)."""
    n = 0
    if WORKFLOW_SRC.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for js in sorted(WORKFLOW_SRC.glob("*.js")):
            shutil.copy2(js, dst / js.name)
            if owned is not None:
                owned.append(f"workflows/{js.name}")
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


# The ponytail level-switch command is registered UNCONDITIONALLY — independent of
# GENESEED_COMMANDS and COMMAND_SET. The geneseed-ponytail plugin's
# `command.execute.before` hook only fires if OpenCode knows a `ponytail` command, so
# without this the `/ponytail lite|full|ultra|off` switch could never reach the plugin
# (skills map to the native `skill` tool, NOT slash commands). The full behaviour lives
# in the native `ponytail` skill + the plugin; this command is only the switch surface.
PONYTAIL_COMMAND_BODY = (
    "Ponytail level requested: $ARGUMENTS\n\n"
    "The geneseed-ponytail plugin records this level and, from your next turn, appends "
    "the matching \"laziest solution that works\" ruleset to your system prompt — honour "
    "it going forward, not just this message. An empty argument means `full`; `off` "
    "disables ponytail. Acknowledge the new level in one line, then continue.\n"
)


def _write_ponytail_command(command_dir: Path) -> Path:
    """Register the `/ponytail <level>` switch command unconditionally so the
    geneseed-ponytail plugin's `command.execute.before` hook can fire. Returns the
    written path (callers append it to their command/owned lists)."""
    dest = command_dir / "ponytail.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    desc = "Set the ponytail minimal-code level for the session: lite | full | ultra | off"
    dest.write_text("---\n" + f"description: {json.dumps(desc)}\n" + "---\n\n" + PONYTAIL_COMMAND_BODY,
                    encoding="utf-8")
    return dest


def emit_opencode(theme_name: str, out: Path, root: Path | None = None,
                  footprint: str = "full") -> None:
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
    build(theme_name, out, footprint)
    # OpenCode loads agents/skills natively, so strip AGENT.md's per-row spec links to
    # plain names (the portable build keeps them). The bundle's flat specs still exist
    # beside it — this is a deliberate de-link, not a fix for a broken target.
    agent_md = out / "AGENT.md"
    if agent_md.is_file():
        agent_md.write_text(_strip_capability_links(agent_md.read_text(encoding="utf-8")),
                            encoding="utf-8")
    # `.opencode/` is fully owned by this layer — wipe so a removed agent/skill
    # leaves no stale file behind. (Plural dir names are canonical in OpenCode;
    # singular is back-compat only.) The one carve-out: user-authored themes under
    # .opencode/themes/ are snapshot and restored (any theme the emit doesn't itself
    # regenerate), so a rebuild never erases them (spec §8.2).
    saved_themes = _snapshot_user_themes(root / ".opencode" / "themes")
    if (root / ".opencode").is_dir():
        shutil.rmtree(root / ".opencode")
    oc = root / ".opencode"
    try:
        theme, items = render_all(theme_name)

        ensure_agent_overrides_stub(out)
        overrides = _load_agent_overrides(out)

        n_agents, n_skills, _ = _write_native_layer(items, oc / "agents", oc / "skills", overrides)
        primary = _write_primary_agent(oc / "agents", overrides)
        commands = _write_command_layer(items, oc / "command")
        commands.append(_write_ponytail_command(oc / "command"))   # always-on /ponytail switch
        _write_theme(oc / "themes", theme_name, theme)   # branded `/theme geneseed-<theme>`
        _write_color_themes(oc / "themes")   # curated full-palette colour themes (solid + transparent)
    finally:
        # The snapshot is the ONLY copy of the user's themes once the wipe above
        # ran — restore it even when the emit crashes midway (spec §8.2).
        _restore_user_themes(oc / "themes", saved_themes)   # user themes survive the wipe

    rel = _rel_under(out, root)
    agent_path = f"{rel}/AGENT.md" if rel else "AGENT.md"
    cfg_name = _merge_opencode_json(root / "opencode.json", agent_path).name

    n_plugins = _copy_plugins(oc / "plugins")
    n_workflows = _copy_workflows(oc / "workflows")

    extras = ([f"primary agent"] if primary else []) + ([f"{len(commands)} command(s)"] if commands else [])
    extra = (" + " + ", ".join(extras)) if extras else ""
    print(f"[geneseed] opencode layer: {n_agents} subagents, {n_skills} skills, "
          f"{n_plugins} plugin(s), {n_workflows} workflow file(s), "
          f"{cfg_name} (instructions: {agent_path}){extra}")
