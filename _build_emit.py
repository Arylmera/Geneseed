"""Geneseed build — the OpenCode emit: native subagent/skill/command layers,
opencode.json merge, plugin/workflow copy, primary-agent and theme writers.

Part of the build CLI (see build.py). Imports the shared toolset from _build_core."""
from __future__ import annotations

import _build_core
from _build_core import *  # noqa: F401,F403  shared stdlib + constants

# PLUGIN_SRC / WORKFLOW_SRC / COLOR_THEMES moved to _build_core with the rest of the
# path constants (its `_OWNED` tuple): one binding, no spliced copies, so a test that
# repoints the source tree is seen here too. Spelled `_build_core.X` on every read.


def _strip_capability_links(text: str) -> str:
    """Reduce AGENT.md's per-row agent/skill table links to plain names — for the
    OpenCode emits only. OpenCode loads agents and skills by native discovery
    (HOW-OPENCODE-LOADS §4), so these hrefs are navigation-only, never followed, and
    were the recurring dead-link source. The table keeps its names + trigger text and
    the section intros keep their `agents/` / `skills/` folder pointer; only the
    per-row spec links are removed. The portable `files` emit keeps the links (its
    specs are flat siblings that resolve)."""
    return _build_core.CAPABILITY_LINK_RE.sub(r"\1", text)


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
#
# The canonical mapping now lives in themes/_TEMPLATE.json's AGENT_COLORS key (propagated
# to every shipped theme by `build.py --sync-themes`), so a theme can restyle its own
# agent-color grouping. This module-level dict is ONLY the fallback used when a theme
# is somehow missing the key (defensive — the parity gate guarantees every shipped theme
# carries it, but a hand-authored or third-party theme file might not).
AGENT_COLORS = {
    "architect": "primary", "reviewer": "warning", "tester": "success",
    "docs": "info", "security": "error", "explorer": "accent",
    "_default": "secondary",
}

# OpenCode's accepted NAMED theme slots for an agent `color:` — mirrors the slot set
# _theme_json/_SLOT_ROLE fill for a full OpenCode theme. Any AGENT_COLORS value outside
# this set is invalid frontmatter and must never be emitted as-is.
_VALID_AGENT_COLOR_SLOTS = {"primary", "secondary", "accent", "success", "warning", "error", "info"}


def _agent_color_map(theme: dict | None) -> dict:
    """The effective agent-color map: the theme's own AGENT_COLORS when present and a
    dict, else the module fallback above. Every value is validated against OpenCode's
    named slot set — an unknown value warns and falls back to 'secondary' rather than
    ever reaching an emitted file."""
    raw = None
    if isinstance(theme, dict):
        raw = theme.get("AGENT_COLORS")
    if not isinstance(raw, dict):
        raw = AGENT_COLORS
    cleaned = {}
    for k, v in raw.items():
        if v in _VALID_AGENT_COLOR_SLOTS:
            cleaned[k] = v
        else:
            print(f"[geneseed] WARN: AGENT_COLORS[{k!r}] = {v!r} is not a valid OpenCode "
                  f"theme slot ({', '.join(sorted(_VALID_AGENT_COLOR_SLOTS))}) — falling "
                  f"back to 'secondary'", file=sys.stderr)
            cleaned[k] = "secondary"
    cleaned.setdefault("_default", "secondary")
    return cleaned


def _agent_color(stem: str, theme: dict | None) -> str:
    """The display colour for agent `stem` under the effective theme, via
    `_agent_color_map` (validated, always a valid OpenCode slot)."""
    colors = _agent_color_map(theme)
    return colors.get(stem, colors["_default"])

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
# The path itself is _build_core.COLOR_THEMES (single-owner set); read it there.

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
    if not _build_core.COLOR_THEMES.is_dir():
        return []
    return sorted(p for p in _build_core.COLOR_THEMES.glob("*.json")
                  if not p.name.startswith("_"))


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
        denied = ["Write", "Edit", "NotebookEdit", "WebFetch"]
        if "<!-- bash: allow -->" not in text:
            denied.append("Bash")
        fm.append("disallowedTools: " + ", ".join(denied))
    return fm


# Sibling-agent links inside an agent spec (`](skeptic.md)` — a bare same-dir
# filename, never a path). The Copilot dialect renames every agent file to
# `<name>.agent.md`, so these links must be rewritten with it or they die.
_SIBLING_AGENT_LINK_RE = re.compile(r"\]\(([A-Za-z0-9_-]+)\.md\)")


def _copilot_agent_frontmatter(stem: str, text: str, overrides: dict) -> list[str]:
    """GitHub Copilot custom-agent frontmatter (repo .github/agents/<name>.agent.md or
    personal ~/.copilot/agents/). `name` is optional but kept for parity with the other
    dialects; `description` is the one required key. Copilot's `tools:` is an ALLOWLIST
    (unset = every tool), so a read-only agent lists the built-in tool ids it may keep —
    docs.github.com/copilot/reference/custom-agents-configuration — instead of Claude's
    denylist: `edit`, `web` and (without the `<!-- bash: allow -->` opt-in) `execute`
    are simply not granted. Only a `model:` override carries over."""
    fm = [f"name: {stem}", f"description: {json.dumps(desc_of(text))}"]
    ov = overrides.get(stem) or {}
    if ov.get("model"):
        fm.append(f"model: {ov['model']}")
    if _is_readonly(text):
        allowed = ["read", "search", "todo", "agent"]
        if "<!-- bash: allow -->" in text:
            allowed.append("execute")
        fm.append("tools: [" + ", ".join(allowed) + "]")
    return fm


def _opencode_agent_frontmatter(stem: str, text: str, overrides: dict,
                                theme: dict | None = None) -> list[str]:
    """OpenCode subagent frontmatter: description, mode: subagent, a NAMED theme-slot
    colour, optional per-agent overrides, and (for read-only agents) the permission
    deny-tree. Factored out of _write_native_layer so the Claude dialect is a sibling."""
    fm = [f"description: {json.dumps(desc_of(text))}", "mode: subagent"]
    # Per-agent display colour — one of OpenCode's NAMED theme slots (never a raw
    # hex/ANSI name), so it follows whatever theme the host has active and stays
    # portable. Capability roles get distinct semantic slots; everything else (the
    # council seats) shares 'secondary'. Cosmetic only. Sourced from the effective
    # theme's AGENT_COLORS (themes/_TEMPLATE.json), so a theme can restyle its own
    # agent-color grouping; see _agent_color_map for the fallback + validation.
    fm.append(f"color: {_agent_color(stem, theme)}")
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
                        cfg: Path | None = None,
                        manifest_existed: bool = True,
                        theme: dict | None = None) -> tuple[int, int, list[Path]]:
    """Render capability agents and skills into host-native files.

    - Agents -> `<agents_dir>/<name>.md`. `host` selects the frontmatter dialect:
      'opencode' (description, mode: subagent, color, permission deny-tree),
      'claude' (name, description, disallowedTools denylist) or 'copilot'
      (name, description, tools allowlist — and a `.agent.md` filename, Copilot's
      custom-agent extension). See the three `_*_agent_frontmatter` builders.
    - Skills -> `<skills_dir>/<name>/SKILL.md`. BYTE-IDENTICAL across hosts: name +
      description, body link-stripped. Model-invoked via the `skill` tool, NOT slash
      commands. See adapters/opencode/GLOBAL-HARNESS-SPEC.md §9.1.

    User-content safety (claim-on-create): when BOTH `old_owned` and `cfg` are given, a
    target that ALREADY EXISTS and is NOT in the prior manifest is the user's own — it
    is left untouched (a warning is printed) and never added to the returned owned set,
    so a re-emit never clobbers a same-named user agent/skill and uninstall never
    deletes it. With `old_owned`/`cfg` omitted (the per-repo and portable bundle emits,
    which write into a dir they fully own) every file is written unconditionally.
    `manifest_existed=False` (only ever passed when the caller found no prior manifest
    on disk at all, i.e. a legacy manifest-less install) prints ONE header line before
    the first skip, so the wall of "kept your existing ..." lines isn't presented with
    no context — the reader learns up front why files it never touched are suddenly
    being called "yours".

    Keys off the SOURCE folder name (always neutral) so a theme can rename the
    rendered bundle dirs without moving the host's fixed `agents/`/`skills/`.

    `theme` is the effective theme dict (from `render_all`/`effective_theme`) — passed
    through to the OpenCode frontmatter builder so each agent's display `color:` comes
    from the theme's own AGENT_COLORS (see `_agent_color_map`). Omitted (None) falls
    back to the module-level AGENT_COLORS default; only ever relevant for a caller
    that hasn't threaded a theme through (there is none left in-tree, but this keeps
    the function safely callable standalone, e.g. from a test).

    Returns (n_agents, n_skills, written_paths)."""
    overrides = overrides or {}
    old_set = set(old_owned) if old_owned is not None else None
    n_agents = n_skills = 0
    written: list[Path] = []
    header_printed = False

    def _claim(dest: Path) -> bool:
        nonlocal header_printed
        # True -> ok to (over)write; False -> a pre-existing file we never owned, so it
        # is the user's: leave it, warn, and keep it out of the manifest.
        if old_set is None or cfg is None or not dest.exists():
            return True
        rel = dest.relative_to(cfg).as_posix()
        if rel in old_set:
            return True
        if not manifest_existed and not header_printed:
            print("[geneseed] first emit over a pre-manifest install — existing files "
                  "are treated as yours", file=sys.stderr)
            header_printed = True
        print(f"[geneseed] kept your existing {rel} — skipped Geneseed's copy to avoid "
              f"clobbering it", file=sys.stderr)
        return False

    for _out_rel, text, src in items:
        sparts = src.relative_to(_build_core.SRC).as_posix().split("/")
        # Vendored third-party skill folders (skills/<name>/…) ride along verbatim into
        # the native skills dir, preserving their own multi-file layout and upstream
        # format, so AGENT.md's vendored-skill pointer resolves in this emit too (the
        # global install builds no sibling bundle). They are copied through — NOT wrapped
        # as a native SKILL.md — and never counted as harness skills.
        if len(sparts) >= 2 and sparts[0] == "skills" and sparts[1] in _build_core.VENDORED_SKILL_DIRS:
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
            if host == "claude":
                fm = _claude_agent_frontmatter(stem, text, overrides)
                dest = agents_dir / f"{stem}.md"
            elif host == "copilot":
                fm = _copilot_agent_frontmatter(stem, text, overrides)
                dest = agents_dir / f"{stem}.agent.md"
                body = _SIBLING_AGENT_LINK_RE.sub(r"](\1.agent.md)", body)
            else:
                fm = _opencode_agent_frontmatter(stem, text, overrides, theme)
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


# The JSONC / settings.json / opencode.json / hook-shim / managed-block layer moved to
# _build_settings.py — it is the part of the emit that edits files the user co-owns, and
# the part the runtime (deactivate/remerge/reactivate/uninstall, exclude, mcp) drives too.
# Every name is still reachable unqualified here: build.py splices _build_settings into
# the shared namespace alongside this module.



def _copy_plugins(dst: Path, owned: list | None = None) -> int:
    """Copy the static OpenCode plugins (context, learn, guard, workflow, notify, ponytail, activity) into `dst`.
    They are maintained files, not rendered from src, so copy them verbatim. When the
    caller tracks an ownership manifest (the global emit), pass `owned` and each copy
    is appended to it as `plugins/<name>`."""
    n = 0
    if _build_core.PLUGIN_SRC.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for js in sorted(_build_core.PLUGIN_SRC.glob("*.js")):
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
    if _build_core.WORKFLOW_SRC.is_dir():
        dst.mkdir(parents=True, exist_ok=True)
        for js in sorted(_build_core.WORKFLOW_SRC.glob("*.js")):
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

PRIMARY_AGENT_SRC = _build_core.ROOT / "adapters" / "opencode" / "agents" / "orchestrator.md"

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
    """Drop an agent-overrides.json once (never overwrite) — the host's editable,
    git-ignored model-routing map. Empty by default => no behaviour change. Stamped
    with `_version`: the source release label (harness.config.json) at creation
    time, so a later re-emit can tell the user their overrides predate an upgrade
    (see `_warn_if_overrides_stale`) without ever touching their file."""
    dest = base / "agent-overrides.json"
    if dest.exists():
        _warn_if_overrides_stale(dest)
        return
    stub = dict(AGENT_OVERRIDES_STUB)
    stub["_version"] = source_release_version()
    dest.write_text(json.dumps(stub, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _warn_if_overrides_stale(dest: Path) -> None:
    """One-line notice (never a rewrite) when an EXISTING agent-overrides.json's
    `_version` doesn't match the current source release AND the file actually
    carries overrides beyond the stub defaults (`agents` non-empty) — an empty
    override map is never worth flagging, drift or not. Tolerates a missing
    `_version` (legacy file, predates this stamp) by naming it "unknown version"."""
    try:
        data = json.loads(dest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(data, dict) or not data.get("agents"):
        return
    stamped = data.get("_version")
    current = source_release_version()
    if stamped != current:
        print(f"[geneseed] agent-overrides.json was written for Geneseed "
              f"{stamped if isinstance(stamped, str) and stamped else 'unknown version'}, "
              f"current is {current} — review your overrides against the updated "
              f"agent specs")


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
        sp = src.relative_to(_build_core.SRC).as_posix().split("/")
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


def _opencode_render_py(theme_name: str, out: Path, root: Path, footprint: str,
                        native_catalog: bool, old_owned: list[str],
                        manifest_existed: bool) -> dict:
    """The RENDER stage of `emit_opencode`, in Python — the reference the Node
    implementation (`js/emit.mjs`'s `emitOpencodeRender`) is held byte-identical to.

    Returns the two things the WIRE/PRUNE/MANIFEST stages need from it: `owned` (the
    layer's files, relative to `.opencode/`, in write order) and the counts the final
    progress line reports. Nothing else crosses the seam."""
    oc = root / ".opencode"
    # native_catalog: OpenCode reads this bundle's AGENT.md as the session
    # preamble AND catalogues skills/agents to the model itself, so the tables
    # would be the second copy. See HOSTS['opencode'] for why that is asserted
    # for OpenCode and not for every host.
    build(theme_name, out, footprint, native_catalog=native_catalog)
    # OpenCode loads agents/skills natively, so strip AGENT.md's per-row spec links to
    # plain names (the portable build keeps them). The bundle's flat specs still exist
    # beside it — this is a deliberate de-link, not a fix for a broken target.
    agent_md = out / "AGENT.md"
    if agent_md.is_file():
        agent_md.write_text(_strip_capability_links(agent_md.read_text(encoding="utf-8")),
                            encoding="utf-8")

    owned: list[str] = []
    theme, items = render_all(theme_name)

    ensure_agent_overrides_stub(out)
    overrides = _load_agent_overrides(out)

    n_agents, n_skills, written = _write_native_layer(
        items, oc / "agents", oc / "skills", overrides,
        host="opencode", old_owned=old_owned, cfg=oc, manifest_existed=manifest_existed,
        theme=theme)
    owned += [p.relative_to(oc).as_posix() for p in written]
    primary = _write_primary_agent(oc / "agents", overrides)
    if primary:
        owned.append(primary.relative_to(oc).as_posix())
    commands = _write_command_layer(items, oc / "command")
    commands.append(_write_ponytail_command(oc / "command"))   # always-on /ponytail switch
    owned += [p.relative_to(oc).as_posix() for p in commands]
    theme_file = _write_theme(oc / "themes", theme_name, theme)   # branded `/theme geneseed-<theme>`
    owned.append(theme_file.relative_to(oc).as_posix())
    for p in _write_color_themes(oc / "themes"):   # curated full-palette colour themes (solid + transparent)
        owned.append(p.relative_to(oc).as_posix())

    n_plugins = _copy_plugins(oc / "plugins", owned)
    n_workflows = _copy_workflows(oc / "workflows", owned)
    return {"owned": owned,
            "stats": {"nAgents": n_agents, "nSkills": n_skills, "nPlugins": n_plugins,
                      "nWorkflows": n_workflows, "nCommands": len(commands),
                      "primary": bool(primary)}}


def _opencode_render(theme_name: str, out: Path, root: Path, footprint: str,
                     native_catalog: bool, old_owned: list[str],
                     manifest_existed: bool, agent_path: str) -> dict:
    """RENDER — one spawn into Node when it is available, the Python body otherwise.

    `old_owned` and `manifest_existed` are read by the CALLER and passed in rather than
    read here, so the manifest has one owner across the seam: Python reads it, prunes
    against it and writes it, and the child never opens it. `agent_path` is WIRE's one
    input and travels for the same reason: `_rel_under` is the Python side by design, so
    the value arrives decided rather than re-derived on the far side.

    Since P3b the spawn runs the WIRE half too (one child per emit is the contract); the
    wiring keeps its own statement at the call site — see `_opencode_wire` below."""
    if _build_core.js_render_available():
        return _build_core.run_node({
            "kind": "opencode",
            "cfg": {**_build_core.js_cfg(), "primaryAgentSrc": str(PRIMARY_AGENT_SRC)},
            "theme": theme_name, "out": str(out), "root": str(root),
            "footprint": footprint, "nativeCatalog": native_catalog,
            "oldOwned": old_owned, "manifestExisted": manifest_existed,
            "agentPath": agent_path})
    return _opencode_render_py(theme_name, out, root, footprint, native_catalog,
                               old_owned, manifest_existed)


def _opencode_wire_py(root: Path, agent_path: str) -> str:
    """WIRE — the one file of this emit the user co-owns. Returns the target's BASENAME,
    which is all the caller consumes (`opencode.json` or the `.jsonc` sibling when that is
    what is on disk). Reference implementation of `js/emit.mjs`'s opencode wire half."""
    return _merge_opencode_json(root / "opencode.json", agent_path).name


def _opencode_wire(rendered: dict, root: Path, agent_path: str) -> str:
    """WIRE — already done by the child that rendered, or run here against Python.

    Same shape as `_build_global._claude_wire`, and for the same reason: one spawn per
    emit means this stage cannot dispatch on its own, so the payload carrying `cfgName`
    IS the signal that Node already wired."""
    cfg_name = rendered.get("cfgName")
    if cfg_name is not None:
        return cfg_name
    return _opencode_wire_py(root, agent_path)


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
    # `.opencode/` used to be fully wiped and rebuilt every re-emit — simple, but it
    # destroyed ANY user-authored file under it (a hand-added agent, plugin, command),
    # not just the one carve-out (themes) the old code knew to snapshot-and-restore.
    # Now it follows the same manifest + write-before-delete model as the Claude/Bob
    # emits (`_emit_claude_core` in _build_global.py): read what THIS layer owned last
    # time, write the complete new set, then prune only files still in the old owned
    # set but not the new one. A pre-existing file NOT in the old manifest is the
    # user's (claim-on-create, via _write_native_layer's old_owned/cfg) — left alone,
    # warned about, never pruned. (Plural dir names are canonical in OpenCode; singular
    # is back-compat only.) `agent-overrides.json` lives beside `.opencode/` in `out`,
    # never inside it, so it was never touched by the wipe and needs no manifest entry.
    #
    # Migration nuance: an install from the wipe-and-rebuild era has NO manifest yet.
    # `old_owned` then reads as [] (manifest missing == "owned nothing before"), so
    # `_write_native_layer`'s claim-on-create sees every ALREADY-EXISTING agent/skill
    # file as user-authored on this FIRST post-upgrade re-emit — including one that is
    # actually still a current Geneseed spec — and skips it with a warning instead of
    # refreshing it. Nothing is deleted (the prune set old_owned - owned is empty), and
    # the manifest this run writes bootstraps tracking for everything actually written
    # (a freshly-created theme/plugin/command IS captured from this very run). A
    # pre-existing file that got skipped this once stays permanently unclaimed unless
    # the user removes it and lets a later re-emit recreate it — the exact same
    # characteristic the Claude/Bob engine's own migration already has (same
    # claim-on-create machinery), not a new limitation introduced here.
    oc = root / ".opencode"
    manifest_path = oc / GLOBAL_MANIFEST
    manifest_existed = manifest_path.exists()
    old_owned: list[str] = []
    if manifest_existed:
        try:
            old_owned = json.loads(manifest_path.read_text(encoding="utf-8")).get("owned", []) or []
        except (json.JSONDecodeError, OSError):
            old_owned = []

    # `_rel_under` stays Python (see `_opencode_render`), so the instruction path is
    # computed before the seam and travels into it as WIRE's one input.
    rel = _rel_under(out, root)
    agent_path = f"{rel}/AGENT.md" if rel else "AGENT.md"

    # RENDER — one process seam. Everything Geneseed owns wholesale is written by
    # `_opencode_render`, in Node when there is one; only `owned` and the progress counts
    # come back across it.
    render = _opencode_render(theme_name, out, root, footprint,
                              host_catalogs_natively("opencode"),
                              old_owned, manifest_existed, agent_path)
    owned = render["owned"]
    stats = render["stats"]

    # WIRE — the one file of this emit the user co-owns. Every emit runs the same five
    # stages in the same order (RENDER* -> WIRE* -> PRUNE -> MANIFEST -> VERIFY); see
    # _build_global._emit_claude_core for why that order is load-bearing rather than
    # tidy. opencode.json is never in `owned`, so the merge commutes with the prune and
    # the manifest — it used to sit after both. Byte-inert, and moving it is what lets
    # a single seam separate "files Geneseed writes wholesale" from "files the user
    # co-owns" in all nine emits since P3c. `emit_opencode_global` is the ninth and merges
    # the same file under a different root, through its own `_opencode_global_wire_py`;
    # `tests/test_seam_coverage.py` pins the measured spawn count of every mode.
    cfg_name = _opencode_wire(render, root, agent_path)

    # Write-before-delete: only now that the whole current set is on disk do we remove
    # what this layer owned before but no longer produces (a removed agent/skill, a
    # disabled primary/command, a theme dropped from the palette). A live file is never
    # momentarily absent partway through the emit.
    prune_failed = []
    for relp in sorted(set(old_owned) - set(owned)):
        victim = oc / relp
        try:
            if victim.is_file():
                victim.unlink()
                if victim.parent != oc and not any(victim.parent.iterdir()):
                    victim.parent.rmdir()
        except OSError as e:
            prune_failed.append(f"{relp} ({e})")
    if prune_failed:
        print("[geneseed] WARN: could not remove stale owned file(s): "
              + ", ".join(prune_failed), file=sys.stderr)

    _write_manifest_atomic(manifest_path, {
        "_comment": "Files owned by Geneseed's per-repo OpenCode emit (--emit opencode). "
                    "Do not edit; removed on re-emit. A pre-existing file not in this "
                    "list is yours and is never touched.",
        "owned": sorted(owned), "scope": "project"})

    extras = ([f"primary agent"] if stats["primary"] else []) + \
             ([f"{stats['nCommands']} command(s)"] if stats["nCommands"] else [])
    extra = (" + " + ", ".join(extras)) if extras else ""
    print(f"[geneseed] opencode layer: {stats['nAgents']} subagents, {stats['nSkills']} skills, "
          f"{stats['nPlugins']} plugin(s), {stats['nWorkflows']} workflow file(s), "
          f"{cfg_name} (instructions: {agent_path}){extra}")
