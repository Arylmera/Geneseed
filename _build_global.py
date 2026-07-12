"""Geneseed build — the global OpenCode emit: config-dir resolution, the install
manifest, global memory/notebook seeding, emit_opencode_global.

Part of the build CLI (see build.py). Imports the shared toolset from _build_core."""
from __future__ import annotations

from _build_core import *  # noqa: F401,F403  shared stdlib + constants


def _write_manifest_atomic(path: Path, data: dict) -> None:
    """Manifest writes are temp + os.replace (mirrors _install_registry._save): a
    torn manifest would make the next emit treat every owned file as the user's
    own — never updated, never pruned, never uninstalled."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


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


def _claude_config_dir() -> Path:
    """Claude Code's global/user config dir: ~/.claude (Windows: %USERPROFILE%\\.claude,
    which Path.home() resolves). Unlike OpenCode there is no documented env var that
    relocates it, so — by design — this resolver is simpler than its sibling: no env
    branch. (configuration: https://code.claude.com/docs/en/configuration)"""
    return (Path.home() / ".claude").resolve()


def _bob_config_dir() -> Path:
    """IBM Bob's global config dir: ~/.bob (its global skills live at ~/.bob/skills per
    bob.ibm.com/docs/ide). $BOB_CONFIG_DIR relocates it (mirrors the OpenCode env knob),
    so a CI/locked-down setup can point it at a git-tracked folder."""
    env = os.environ.get("BOB_CONFIG_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return (Path.home() / ".bob").resolve()


def _copilot_config_dir() -> Path:
    """GitHub Copilot's personal config dir: ~/.copilot — the CLI auto-loads
    copilot-instructions.md there and discovers skills/ and agents/ natively
    (docs.github.com/copilot/how-tos/copilot-cli). $COPILOT_CONFIG_DIR relocates it
    (Geneseed's knob, mirroring $BOB_CONFIG_DIR — Copilot documents no such env var,
    but tests/doctor and locked-down setups still need to re-point the target)."""
    env = os.environ.get("COPILOT_CONFIG_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return (Path.home() / ".copilot").resolve()


GLOBAL_MANIFEST = ".geneseed-manifest.json"

# Project-bypasses-global (Claude only): map a preamble filename to the GLOBAL config
# dir holding the copy a project install suppresses via claudeMdExcludes. OpenCode gates
# differently (its cwd-aware context plugin). Bob is deliberately NOT here:
# claudeMdExcludes is a Claude-only settings key with no documented Bob semantics (a
# filename-keyed match would suppress the project's own AGENTS.md too), so Bob's bypass
# rides on its rules folder instead — the workspace rules/geneseed.md overrides the
# global one (see _emit_claude_core).
_PREAMBLE_CONFIG_DIR = {"CLAUDE.md": _claude_config_dir}

# The workspace rules stub a PROJECT Bob emit ships as .bob/rules/geneseed.md. Its only
# job is to exist under the same name as the global ~/.bob/rules/geneseed.md so Bob's
# native rule precedence shadows the global copy (project-bypasses-global) — the actual
# preamble is the repo-root AGENTS.md, which Bob auto-loads. Kept deliberately tiny: Bob
# injects every workspace rule each turn, so a full second preamble copy here would
# double the install's fixed per-turn token cost.
_BOB_RULES_STUB = """\
<!-- geneseed: workspace shadow stub -->
This project's Geneseed instructions are the repo-root `AGENTS.md`, which Bob
auto-loads. This file exists only to shadow the same-named global Geneseed rules
file (`~/.bob/rules/geneseed.md`) so the global preamble does not stack on top of
the project's own. Follow the root `AGENTS.md`.
"""


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


def _global_notebook(cfg: Path, theme: dict, items, legacy: Path | None) -> str:
    """Ensure the global notebook store exists at <cfg>/notebook. If it already holds
    files it is left alone — it carries the agent's own freeform work. Otherwise
    migrate an existing legacy bundle's notebook into it (one-time, so a host
    switching from a sibling Harness loses nothing), else seed from the src template.
    The store is host state, never tracked in the owned-manifest, never deleted.

    Like `memory/`, the dir name is ALWAYS the classic English `notebook/`, never
    themed: the OpenCode config dir uses fixed directory names — the theme only
    flavors prose, not paths."""
    nb_name = "notebook"
    nb_dir = cfg / nb_name
    if nb_dir.is_dir() and any(nb_dir.iterdir()):
        return f"kept {nb_name}/"
    nb_dir.mkdir(parents=True, exist_ok=True)
    if legacy:
        src = legacy / nb_name
        if src.is_dir() and any(src.iterdir()):
            for f in src.rglob("*"):
                if f.is_file():
                    dest = nb_dir / f.relative_to(src)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, dest)
            return f"migrated {nb_name}/"
    for _out_rel, text, src in items:
        sp = src.relative_to(SRC).as_posix().split("/")
        if sp[0] == nb_name and len(sp) > 1:
            dest = nb_dir / Path(*sp[1:])
            dest.parent.mkdir(parents=True, exist_ok=True)
            if text is not None:
                dest.write_text(text, encoding="utf-8")
            else:
                shutil.copy2(src, dest)
    return f"seeded {nb_name}/"


def _ship_lean_laws(items, theme, cfg: Path, owned: list) -> None:
    """Under the lean footprint, AGENT.md's §1 is terse and points at the standalone
    laws file — which the global/claude/bob emits don't otherwise write (the full
    footprint inlines the laws, so a standalone copy would be dead weight). Materialise
    it from the rendered items so the pointer resolves, and record it in `owned` so a
    later switch back to full prunes it. Written under <cfg>/<themed laws dir>/."""
    laws_dir = theme.get("DIR_LAWS", "laws")
    for rel, text, _src in items:
        parts = Path(rel).parts
        if text is not None and parts and parts[0] == laws_dir:
            dest = cfg / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text, encoding="utf-8")
            owned.append(rel)


def emit_opencode_global(theme_name: str, out: Path | None = None, cfg: Path | None = None,
                         footprint: str = "full") -> None:
    """Render the harness straight into OpenCode's GLOBAL config dir — the
    "everything global, zero per-repo" deployment (GLOBAL-HARNESS-SPEC.md).

    Self-contained: it writes ONLY into <cfg> and builds NO sibling Harness bundle.
    AGENT.md is rendered straight to <cfg>/AGENT.md, and the memory store lives at
    <cfg>/<memory|anamnesis> (migrated once from a legacy Harness if present, else
    seeded). Point the learn plugin at it with GENESEED_HARNESS=<cfg>.

    The target dir is shared with the user's own OpenCode config, so it is NEVER
    wiped. A `.geneseed-manifest.json` tracks exactly the files this layer owns
    (AGENT.md, agents/, skills/, plugins/ — NOT memory or notebook); on re-emit,
    files we previously wrote but no longer produce are removed, and the user's own
    agents/skills/plugins (and the memory + notebook stores) are left untouched.

    Writes: <cfg>/AGENT.md, <cfg>/agents/*.md, <cfg>/skills/<name>/SKILL.md,
    <cfg>/plugins/*.js (single copy — kills the double-injection), the memory and
    notebook stores, a one-time empty wiki.jsonc (machine-level, user-owned, never
    overwritten or pruned), and merges <cfg>/opencode.json to point `instructions`
    at the absolute <cfg>/AGENT.md. It does NOT write context.json — project docs
    are auto-discovered by the context plugin. `out`, if given, is only a migration source for an
    existing memory store (the legacy bundle location); nothing is built there.
    `cfg` overrides the target dir (default: the resolved OpenCode config dir) — used
    by `harness.py diff` to render an 'expected' copy into a temp dir for comparison."""
    cfg = cfg or _opencode_config_dir()
    # laws_prefix='' — the standalone laws dir sits beside AGENT.md in <cfg>, so the
    # lean pointer's relative `laws/universal.md` resolves with no prefix.
    theme, items = render_all(theme_name, footprint)
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
    n_agents, n_skills, written = _write_native_layer(
        items, cfg / "agents", cfg / "skills", overrides,
        host="opencode", old_owned=old_owned, cfg=cfg, theme=theme)
    owned += [p.relative_to(cfg).as_posix() for p in written]
    primary = _write_primary_agent(cfg / "agents", overrides)
    if primary:
        owned.append(primary.relative_to(cfg).as_posix())
    commands = _write_command_layer(items, cfg / "command")
    commands.append(_write_ponytail_command(cfg / "command"))   # always-on /ponytail switch
    owned += [p.relative_to(cfg).as_posix() for p in commands]
    theme_file = _write_theme(cfg / "themes", theme_name, theme)   # branded /theme
    owned.append(theme_file.relative_to(cfg).as_posix())
    for p in _write_color_themes(cfg / "themes"):   # curated colour themes (solid + transparent)
        owned.append(p.relative_to(cfg).as_posix())

    n_plugins = _copy_plugins(cfg / "plugins", owned)
    n_workflows = _copy_workflows(cfg / "workflows", owned)

    mem_status = _global_memory(cfg, theme, items, out)
    ensure_memory_index(cfg / "memory")   # guarantee the index on every path (seed/migrate/keep)
    nb_status = _global_notebook(cfg, theme, items, out)
    ensure_notebook_index(cfg / "notebook")   # guarantee the index on every path (seed/migrate/keep)
    ensure_wiki_stub(cfg)   # machine-level wiki.jsonc — seeded once, user-owned, never in the manifest
    ensure_rules_stub(cfg)  # user-rules.md — seeded once, user-owned, never in the manifest
    ensure_profile_stub(cfg)  # PROFILE.md — seeded once, user-owned, never in the manifest

    write_version(cfg)
    owned.append(VERSION_MARKER)
    cfg_name = _merge_opencode_json(cfg / "opencode.json", (cfg / "AGENT.md").as_posix()).name

    if footprint == "lean":
        _ship_lean_laws(items, theme, cfg, owned)

    # Now that the whole current set is on disk, remove only what we owned before but
    # no longer produce (a removed agent/skill, a disabled primary/command). Everything
    # current was just (over)written above, so a live file is never momentarily absent.
    prune_failed = []
    for relp in sorted(set(old_owned) - set(owned)):
        victim = cfg / relp
        try:
            if victim.is_file():
                victim.unlink()
                # Drop a now-empty owned dir (a per-skill <name>/ folder, or the laws/
                # dir a switch from lean back to full just emptied) — never <cfg> itself.
                if victim.parent != cfg and not any(victim.parent.iterdir()):
                    victim.parent.rmdir()
        except OSError as e:
            prune_failed.append(f"{relp} ({e})")
    if prune_failed:
        # A locked/permission-blocked file stays on disk but is no longer in the
        # manifest — name it so the user can remove it by hand.
        print("[geneseed] WARN: could not remove stale owned file(s): "
              + ", ".join(prune_failed), file=sys.stderr)

    _write_manifest_atomic(manifest_path, {
        "_comment": "Files owned by Geneseed's --emit opencode-global. "
                    "Do not edit; removed on re-emit. The memory and notebook "
                    "stores are NOT listed — they are never deleted.",
        "owned": sorted(owned)})

    extras = (["primary agent"] if primary else []) + ([f"{len(commands)} command(s)"] if commands else [])
    extra = (" + " + ", ".join(extras)) if extras else ""
    print(f"[geneseed] opencode-global -> {cfg}: {n_agents} subagents, {n_skills} skills, "
          f"{n_plugins} plugin(s), {n_workflows} workflow file(s), AGENT.md, {mem_status}, {nb_status}, "
          f"{cfg_name} (no context.json){extra}. "
          f"The learn plugin now finds <cfg>/memory automatically; set GENESEED_HARNESS only to override.")


def _emit_claude_core(theme_name: str, cfg: Path, claude_md: Path, scope: str,
                      out: Path | None = None, footprint: str = "full",
                      host: str = "claude") -> tuple:
    """Shared engine for the Claude-shaped emits (Claude global → ~/.claude, folder →
    <repo>/.claude; Bob and Copilot ride the same engine — see their emit_* wrappers).
    Mirrors emit_opencode_global's manifest + write-before-delete prune, but for the
    Claude layout: CLAUDE.md as a managed block (auto-loaded by Claude), agents in the
    Claude subagent dialect, byte-identical skills, settings.json hooks merged
    surgically. NO plugins/workflows/colour-themes (Claude has no analogue; its
    plugins/ dir is a managed marketplace, never written). User content is never
    clobbered: agents/skills collide → claim-on-create skip; CLAUDE.md → block merge;
    settings.json → surgical, recorded hook merge. memory/notebook/wiki are host state,
    never tracked, never deleted. `host` names the dialect ('claude' | 'bob' |
    'copilot') — it can no longer be inferred from the carrier filename, since Bob and
    Copilot both use a repo-root AGENTS.md at project scope. Returns
    (n_agents, n_skills, n_hook_groups, mem_status, nb_status, managed)."""
    # Lean footprint: the standalone laws file lands under <cfg> (e.g. <repo>/.claude),
    # but CLAUDE.md/AGENTS.md sits at claude_md's own dir (the repo root for a project
    # install). The lean §1 pointer must be RELATIVE to the instructions file, so prefix
    # it with the path from that dir to <cfg> — '' for a global install (same dir),
    # '.claude/' or '.bob/' for a project one.
    rel_cfg = os.path.relpath(cfg, claude_md.parent).replace(os.sep, "/")
    laws_prefix = "" if rel_cfg == "." else rel_cfg + "/"
    theme, items = render_all(theme_name, footprint, laws_prefix)
    assert_source_complete(items, context=f"claude-{scope}")
    cfg.mkdir(parents=True, exist_ok=True)

    def _prefixed_agent_text(prefix: str) -> "str | None":
        """The instructions text re-rendered with every store dir prefixed. The
        carrier file can sit at a different level than the stores (repo-root
        CLAUDE.md vs <repo>/.claude/*, or ~/.bob/rules/geneseed.md vs ~/.bob/*):
        bare `memory/`/`skills/` pointers there send the agent to nonexistent
        dirs — it then creates a parallel memory store while the Stop hook writes
        the real one (split-brain). Re-rendering with prefixed DIR_* tokens fixes
        every pointer at once; laws_prefix is left empty because the prefixed
        DIR_LAWS already carries it into the lean pointer."""
        src_tmpl = next((s for r, _t, s in items if r == "AGENT.md"), None)
        if src_tmpl is None:
            return None
        if not prefix:
            return next((t for r, t, _s in items if r == "AGENT.md"), None)
        ptheme = dict(theme)
        for tok in ("DIR_LAWS", "DIR_AGENTS", "DIR_SKILLS", "DIR_MEMORY", "DIR_NOTEBOOK"):
            ptheme[tok] = prefix + ptheme.get(tok, tok.split("_", 1)[1].lower())
        return render_file(src_tmpl, ptheme, footprint)

    manifest_path = cfg / GLOBAL_MANIFEST
    old_owned: list[str] = []
    old_managed: dict = {}
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            old_owned = data.get("owned", []) or []
            om = data.get("managed")
            old_managed = om if isinstance(om, dict) else {}
        except (json.JSONDecodeError, OSError):
            old_owned, old_managed = [], {}

    owned: list[str] = []
    managed: dict = {}

    # CLAUDE.md — Claude auto-loads it by location; merge as a delimited block so any
    # user prose around it survives. `whole` (Geneseed created the file) sticks across
    # re-emits so uninstall knows whether to delete the file or just excise the block.
    # Exception — Bob GLOBAL: Bob never auto-loads a global ~/.bob/AGENTS.md (its
    # always-injected channel is rules/geneseed.md, below), so a global copy is pure
    # disk weight; none is written, and a re-emit self-heals the one an older install
    # carries (excise the managed block, or delete the file when Geneseed created it).
    agent_text = next((t for r, t, _s in items if r == "AGENT.md" and t is not None), None)
    is_bob = host == "bob"
    is_copilot = host == "copilot"
    if agent_text is not None and not (is_bob and scope == "global"):
        # Project scope: the carrier sits at the repo root, the stores under <cfg> —
        # render its store pointers with the marker-dir prefix (.claude//.bob/).
        _managed_block_write(claude_md, _strip_capability_links(
            _prefixed_agent_text(laws_prefix) or agent_text))
        # No sticky "whole" flag: teardown always excises the block and deletes the
        # file only when nothing else remains — a whole-file delete would eat prose
        # the user added AFTER Geneseed created the file. (Old manifests may still
        # carry the key; every remove site now ignores it.)
        managed["claude_md"] = {
            "rel": os.path.relpath(claude_md, cfg).replace(os.sep, "/"),
        }
    elif is_bob and scope == "global" and old_managed.get("claude_md"):
        old_cm = old_managed["claude_md"] if isinstance(old_managed["claude_md"], dict) else {}
        victim = (cfg / (old_cm.get("rel") or claude_md.name)).resolve()
        _managed_block_remove(victim)

    # IBM Bob's only documented always-injected channel is the rules folder (project
    # .bob/rules/*.md, global ~/.bob/rules/*.md — bob.ibm.com/docs/ide/configuration/rules).
    # A global ~/.bob/AGENTS.md is NOT auto-loaded, so at GLOBAL scope rules/geneseed.md
    # IS the preamble — the sole carrier of the harness voice (~/.bob/skills already
    # loads natively). At PROJECT scope the repo-root AGENTS.md auto-loads the preamble,
    # so the workspace file is the slim _BOB_RULES_STUB: same filename at both scopes on
    # purpose — workspace rules override global ones, Bob's native
    # project-bypasses-global — and the stub only has to exist to shadow the global copy
    # (without it the global voice would stack on top of the project's). Owned (not a
    # managed block): the file is wholly Geneseed's, so a re-emit rewrites it in place —
    # older installs that shipped a full second preamble copy here heal on upgrade —
    # and uninstall/deactivate remove it via the manifest like any other owned file.
    if is_bob and agent_text is not None:
        rules_md = cfg / "rules" / "geneseed.md"
        rules_md.parent.mkdir(parents=True, exist_ok=True)
        # Global: the preamble lives one level DOWN (rules/geneseed.md) from the
        # stores at ~/.bob — its pointers need a ../ prefix or `laws/`/`memory/`
        # resolve under rules/ where nothing exists.
        rules_md.write_text(_BOB_RULES_STUB if scope == "project"
                            else _strip_capability_links(
                                _prefixed_agent_text("../") or agent_text),
                            encoding="utf-8")
        owned.append("rules/geneseed.md")

    ensure_agent_overrides_stub(cfg)
    # Bob's agents/skills use the Claude dialect verbatim; Copilot has its own agent
    # frontmatter (allowlist tools, .agent.md extension) — skills stay byte-identical.
    n_agents, n_skills, written = _write_native_layer(
        items, cfg / "agents", cfg / "skills", _load_agent_overrides(cfg),
        host=("copilot" if is_copilot else "claude"), old_owned=old_owned, cfg=cfg)
    owned += [p.relative_to(cfg).as_posix() for p in written]

    mem_status = _global_memory(cfg, theme, items, out)
    ensure_memory_index(cfg / "memory")
    nb_status = _global_notebook(cfg, theme, items, out)
    ensure_notebook_index(cfg / "notebook")
    ensure_wiki_stub(cfg)
    ensure_rules_stub(cfg)
    ensure_profile_stub(cfg)

    # Project hygiene: keep the personal/self-documented-never-commit files out of
    # the team's git. Claim-on-create — an existing (possibly user-authored)
    # .gitignore is never rewritten, but one we created stays owned across re-emits.
    if scope == "project":
        gi = cfg / ".gitignore"
        gi_lines = (["settings.local.json"] if host == "claude" else []) \
            + ["wiki.jsonc", "agent-overrides.json"]
        if not gi.exists():
            gi.write_text("\n".join(gi_lines) + "\n", encoding="utf-8")
            owned.append(".gitignore")
        elif ".gitignore" in old_owned:
            owned.append(".gitignore")

    write_version(cfg)
    owned.append(VERSION_MARKER)

    # Hooks embed machine-absolute paths (interpreter + checkout). At PROJECT scope
    # for Claude they go into settings.local.json — the personal, untracked settings
    # file — never the team-shared settings.json, which would hand every teammate
    # failing hooks pointing at this machine's python. (Bob documents no local
    # variant, so it keeps settings.json.) Recorded in the manifest so every
    # lifecycle path unwires the file that was actually written. Copilot has NO
    # settings.json and no hook mechanism at all — its per-repo config surface is
    # .github/, its personal one ~/.copilot, neither of which reads a Claude-shaped
    # settings file — so the whole settings/hooks/excludes stage is skipped: nothing
    # is written, and no settings_* keys are recorded for the lifecycle to unwire.
    if not is_copilot:
        settings_name = "settings.local.json" if (scope == "project" and not is_bob) \
            else "settings.json"
        settings_path = cfg / settings_name
        managed["settings_file"] = settings_name
        # Migration: an older install wired hooks/excludes into a different file —
        # unwire the recorded claims there, or they linger (and run) forever.
        old_sf = old_managed.get("settings_file") or "settings.json"
        if old_sf != settings_name:
            _unwire_claude_settings(cfg / old_sf, old_managed.get("settings_hooks") or [])
            _unwire_claude_excludes(cfg / old_sf, old_managed.get("settings_excludes") or [])
        # The merge prunes recorded groups that are no longer canonical (interpreter or
        # checkout moved, hook form changed) and returns the complete current claim set —
        # store it as-is; unioning with prior would resurrect the stale claims.
        _settings, managed_hooks = _merge_claude_settings(
            settings_path, scope, prior_hooks=(old_managed.get("settings_hooks")
                                               if old_sf == settings_name else None))
        managed["settings_hooks"] = managed_hooks

        # Project-bypasses-global (Claude only): a PROJECT install suppresses the GLOBAL
        # ~/.claude/CLAUDE.md while cwd is this repo, via Claude's native claudeMdExcludes.
        # Written only when this run actually emitted the project's own preamble (never
        # suppress with no replacement); GENESEED_STACK_GLOBAL=1 opts out (and a re-emit with
        # it set strips a prior exclude). Recorded in the manifest so deactivate/uninstall
        # remove exactly it. The companion context-hook stand-down (cmd_context) handles the
        # injected-context half. Bob never gets an exclude (see _PREAMBLE_CONFIG_DIR): its
        # bypass is the same-named workspace rules file.
        prior_excl = old_managed.get("settings_excludes")
        prior_excl = prior_excl if isinstance(prior_excl, list) else []
        cfgdir = _PREAMBLE_CONFIG_DIR.get(claude_md.name)
        if scope == "project" and agent_text is not None and cfgdir:
            # as_posix: claudeMdExcludes entries are glob patterns, where a backslash is
            # an escape — the Windows-native spelling risks never matching.
            want_excl = [(cfgdir() / claude_md.name).resolve().as_posix()]
            if os.environ.get("GENESEED_STACK_GLOBAL"):
                _unwire_claude_excludes(settings_path, want_excl)
                managed["settings_excludes"] = []
            else:
                added_excl = _wire_claude_excludes(settings_path, want_excl)
                # Claim only what Geneseed itself wired (prior + newly added) — folding
                # `want_excl` in unconditionally would claim a user's own pre-existing
                # exclude and uninstall would then strip it.
                managed["settings_excludes"] = sorted(set(prior_excl) | set(added_excl))
        elif prior_excl and is_bob:
            # Self-heal older Bob installs: earlier versions wrote the global AGENTS.md into
            # claudeMdExcludes here. The key is Claude-only and its Bob semantics are unknown
            # (a filename-keyed match would suppress the project's own AGENTS.md), so a
            # re-emit removes it instead of carrying it forward.
            _unwire_claude_excludes(settings_path, prior_excl)
        elif prior_excl:
            managed["settings_excludes"] = prior_excl

    if footprint == "lean":
        _ship_lean_laws(items, theme, cfg, owned)

    # Write-before-delete prune: now that the whole current set is on disk, remove only
    # what we owned before but no longer produce. A live file is never momentarily absent.
    prune_failed = []
    for relp in sorted(set(old_owned) - set(owned)):
        victim = cfg / relp
        try:
            if victim.is_file():
                victim.unlink()
                # Drop a now-empty owned dir (a per-skill <name>/ folder, or the laws/
                # dir a switch from lean back to full just emptied) — never <cfg> itself.
                if victim.parent != cfg and not any(victim.parent.iterdir()):
                    victim.parent.rmdir()
        except OSError as e:
            prune_failed.append(f"{relp} ({e})")
    if prune_failed:
        print("[geneseed] WARN: could not remove stale owned file(s): "
              + ", ".join(prune_failed), file=sys.stderr)

    _write_manifest_atomic(manifest_path, {
        "_comment": "Files owned by Geneseed's Claude emit. Do not edit; removed on "
                    "re-emit. The memory and notebook stores are NOT listed — never "
                    "deleted. `managed` records the CLAUDE.md block + settings.json "
                    "hooks so uninstall removes exactly those.",
        "owned": sorted(owned), "managed": managed, "scope": scope})
    # Verify the merge actually stuck (a commented file, a mid-flight external edit, or
    # a bug in the merge itself would otherwise go unnoticed until the hooks silently
    # don't fire) — loud warning only, never fatal to the emit.
    if not is_copilot:
        _settings_integrity_check(settings_path, managed, expect="present")
    return n_agents, n_skills, len(managed.get("settings_hooks", [])), mem_status, nb_status, managed


def emit_claude_global(theme_name: str, out: Path | None = None, cfg: Path | None = None,
                       footprint: str = "full") -> None:
    """Render the harness into Claude Code's GLOBAL config dir (~/.claude) — the Claude
    sibling of emit_opencode_global. Self-contained: writes ONLY into <cfg>, builds no
    bundle. CLAUDE.md carries the instructions (auto-loaded), agents use Claude's
    subagent schema, skills are byte-identical to the OpenCode emit, and settings.json
    gains Geneseed's hooks with ABSOLUTE harness.py paths (hooks run with the project
    cwd, not the config dir). `cfg` overrides the target (used by tests / doctor to
    render an expected copy into a temp dir)."""
    cfg = cfg or _claude_config_dir()
    n_agents, n_skills, n_hooks, mem_status, nb_status, _ = _emit_claude_core(
        theme_name, cfg, cfg / "CLAUDE.md", "global", out, footprint)
    print(f"[geneseed] claude-global -> {cfg}: {n_agents} subagents, {n_skills} skills, "
          f"CLAUDE.md, {n_hooks} hook group(s), settings.json, {mem_status}, {nb_status}. "
          f"No plugins/workflows/themes (no Claude analogue); ~/.claude/plugins is never touched. "
          f"Hooks call harness.py by absolute path; set GENESEED_HARNESS only to relocate memory.")


def emit_claude(theme_name: str, out: Path, root: Path | None = None,
                footprint: str = "full") -> None:
    """Per-repo Claude install: CLAUDE.md at the repo root + a project `.claude/` layer
    (agents, skills, settings.json hooks with absolute harness.py paths — same as the
    global emit; scope doesn't change the generated paths).
    Reuses the same manifest + claim-on-create machinery as the global emit, so a user's
    own project `.claude/` files are never clobbered. `out`/`root` mirror emit_opencode;
    the harness lands under `root` (default: `out`)."""
    root = root or out
    cfg = root / ".claude"
    n_agents, n_skills, n_hooks, mem_status, nb_status, _ = _emit_claude_core(
        theme_name, cfg, root / "CLAUDE.md", "project", out, footprint)
    print(f"[geneseed] claude (folder) -> {root}: CLAUDE.md + .claude/ "
          f"({n_agents} subagents, {n_skills} skills, {n_hooks} hook group(s), settings.json), "
          f"{mem_status}, {nb_status}.")


# IBM Bob (bob.ibm.com) is Claude-Code-shaped: a `.bob/` project layer + an AGENTS.md
# instructions file, SKILL.md skills, agents, and a settings.json that also carries
# `mcpServers`. So both Bob emits REUSE the Claude engine, only swapping the marker dir
# (.bob) and the instructions filename (AGENTS.md). Two verified Bob-isms the engine
# handles: (1) only a PROJECT-ROOT AGENTS.md is auto-loaded — a global ~/.bob/AGENTS.md
# is not — so the preamble rides rules/geneseed.md, Bob's documented always-injected
# channel: the full preamble at global scope (no AGENTS.md is written there), a slim
# shadow stub at project scope (the root AGENTS.md carries the preamble; a full second
# copy would double the per-turn token cost); (2) claudeMdExcludes is Claude-only,
# so Bob never gets one (the workspace rules file overriding the global one IS the
# project-bypasses-global). Still best-effort: the agent frontmatter + settings.json hook
# merge use the Claude dialect (hooks are unverified for Bob and inert if unsupported);
# MCP wiring lives in rituals/_harness_mcp (settings.json key `mcpServers`).


def _project_survivors(emit_name: str) -> "list[Path]":
    """Registered per-repo PROJECT installs of `emit_name` still on record — read
    straight from `_install_registry` (pure stdlib, no import cycle with build.py — see
    its own docstring) rather than `rituals/_harness_mcp._registered_targets`, which this
    build-side module must never import (build.py is imported BY harness.py; a
    back-import would be circular). Each candidate root's own `.geneseed-emit` marker
    is read directly and compared to the literal project emit name — the one-entry
    equivalent of `_EMIT_HOST_SCOPE[emit_name] == (emit_name, "project")`
    without duplicating that whole table here. Dead/stale registry rows are pruned by
    `roots()` itself; unreadable markers are skipped, never raised."""
    try:
        import _install_registry
    except Exception:
        return []
    out: "list[Path]" = []
    for root in _install_registry.roots():
        try:
            marker = (root / ".geneseed-emit").read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if marker == emit_name:
            out.append(root)
    return out


def _warn_bob_global_over_project(cfg: Path) -> None:
    """A GLOBAL Bob emit writes the full preamble into `<cfg>/rules/geneseed.md`. If a
    PROJECT Bob install already exists elsewhere (its own `.bob/rules/geneseed.md` is
    the slim shadow stub, but Bob auto-loads BOTH the workspace rules folder and the
    global one whenever it runs inside that project — the stub only shadows a
    same-named global rule when Bob's precedence is honoured; nothing here can verify
    that at emit time), warn so the operator knows two preambles may now be in play for
    that repo and can remove the one they don't want. Purely informational — never
    auto-removes anything, mirrors `_print_surviving_project_inventory`'s uninstall-side
    warning but fires at EMIT time instead, before the double-load ever happens."""
    survivors = _project_survivors("bob")
    if not survivors:
        return
    print(f"[geneseed] WARN: {len(survivors)} project Bob install(s) already exist — "
          f"emitting GLOBAL now means BOTH may auto-load together in those repos "
          f"(doubled context) unless Bob's workspace rules truly shadow the global "
          f"one there. Review and remove what you don't want:", file=sys.stderr)
    for root in survivors:
        print(f'  - {root}  ->  harness uninstall --target "{root}"', file=sys.stderr)


def emit_bob_global(theme_name: str, out: Path | None = None, cfg: Path | None = None,
                    footprint: str = "full") -> None:
    """Render the harness into Bob's GLOBAL config dir (~/.bob). rules/geneseed.md carries
    the instructions (Bob's always-injected channel — a global AGENTS.md is not auto-
    loaded, so none is written; a re-emit removes one left by an older install);
    agents/skills/settings.json mirror the Claude global emit. `cfg` overrides the
    target (tests/doctor). Before writing, warns (non-blocking) if any project-scoped
    Bob install is already registered elsewhere — see `_warn_bob_global_over_project`.
    The reverse direction (a PROJECT emit while a global install exists) needs no
    matching check: the project's own `rules/geneseed.md` shadow stub is written
    specifically so the workspace copy always wins over the global one by filename,
    regardless of which was emitted first — see `_BOB_RULES_STUB`."""
    cfg = cfg or _bob_config_dir()
    _warn_bob_global_over_project(cfg)
    n_agents, n_skills, n_hooks, mem_status, nb_status, _ = _emit_claude_core(
        theme_name, cfg, cfg / "AGENTS.md", "global", out, footprint, host="bob")
    print(f"[geneseed] bob-global -> {cfg}: {n_agents} subagents, {n_skills} skills, "
          f"rules/geneseed.md (Bob's always-injected channel; a global AGENTS.md is not "
          f"auto-loaded, so none is written), {n_hooks} hook group(s), settings.json, "
          f"{mem_status}, {nb_status}.")


def emit_bob(theme_name: str, out: Path, root: Path | None = None,
             footprint: str = "full") -> None:
    """Per-repo Bob install: AGENTS.md at the repo root (auto-loaded by Bob, carries the
    preamble) + a project `.bob/` layer (agents, skills, rules/geneseed.md, settings.json).
    The rules file is a slim stub whose filename shadows the global rules copy — Bob's
    native project-bypasses-global — without re-paying the preamble's per-turn token
    cost. Reuses the Claude engine's manifest + claim-on-create, so a user's own `.bob/`
    files are never clobbered. `out`/`root` mirror emit_claude."""
    root = root or out
    cfg = root / ".bob"
    n_agents, n_skills, n_hooks, mem_status, nb_status, _ = _emit_claude_core(
        theme_name, cfg, root / "AGENTS.md", "project", out, footprint, host="bob")
    print(f"[geneseed] bob (folder) -> {root}: AGENTS.md + .bob/ "
          f"({n_agents} subagents, {n_skills} skills, rules/geneseed.md shadow stub, "
          f"{n_hooks} hook group(s), settings.json), {mem_status}, {nb_status}.")


# GitHub Copilot is the second Claude-shaped host, and a closer fit than Bob: skills
# are the same SKILL.md dirs (Copilot's Agent Skills — repo .github/skills/, personal
# ~/.copilot/skills), custom agents are markdown-with-frontmatter (its own dialect and
# a `.agent.md` extension — see _build_emit._copilot_agent_frontmatter), the repo-root
# AGENTS.md is auto-loaded at project scope, and — unlike Bob — a PERSONAL instructions
# file (~/.copilot/copilot-instructions.md) is auto-loaded by the Copilot CLI, so the
# global emit has a real carrier and needs no rules-folder workaround. Two verified
# Copilot-isms the engine handles via `host="copilot"`: (1) there is NO settings.json
# and no hook mechanism, so the settings/hooks/excludes stage is skipped entirely —
# the install is docs + skills + agents only, and the memory convention rides on the
# preamble's instructions instead of a Stop hook; (2) the per-repo layer lives in the
# SHARED .github/ dir (Copilot's repo config surface), not a tool-private marker dir —
# safe because the engine's manifest + claim-on-create machinery never touches files
# it doesn't own. There is no project-bypasses-global exclude mechanism either: the
# global emit warns (like Bob's) when project installs exist, since both preambles
# load together. MCP wiring lives in rituals/_harness_mcp (~/.copilot/mcp-config.json).


def _warn_copilot_global_over_project(cfg: Path) -> None:
    """A GLOBAL Copilot emit writes the full preamble into ~/.copilot/
    copilot-instructions.md, which the Copilot CLI loads in EVERY repo — including
    repos carrying a PROJECT Copilot install whose root AGENTS.md holds the same
    preamble. Copilot documents no exclude/shadow mechanism (nothing like Claude's
    claudeMdExcludes or Bob's same-named workspace rule), so both copies simply stack.
    Warn so the operator can remove the one they don't want — purely informational,
    mirrors `_warn_bob_global_over_project`."""
    survivors = _project_survivors("copilot")
    if not survivors:
        return
    print(f"[geneseed] WARN: {len(survivors)} project Copilot install(s) already exist — "
          f"emitting GLOBAL now means BOTH preambles load together in those repos "
          f"(doubled context): Copilot stacks ~/.copilot/copilot-instructions.md on top "
          f"of a repo's own AGENTS.md. Review and remove what you don't want:",
          file=sys.stderr)
    for root in survivors:
        print(f'  - {root}  ->  harness uninstall --target "{root}"', file=sys.stderr)


def emit_copilot_global(theme_name: str, out: Path | None = None, cfg: Path | None = None,
                        footprint: str = "full") -> None:
    """Render the harness into Copilot's PERSONAL config dir (~/.copilot).
    copilot-instructions.md carries the instructions as a managed block (the CLI
    auto-loads it); agents land as agents/<name>.agent.md in Copilot's custom-agent
    dialect, skills byte-identical under skills/. No settings.json, hooks or excludes —
    Copilot has none (see the host note above). `cfg` overrides the target
    (tests/doctor). Warns (non-blocking) when project-scoped Copilot installs are
    already registered — the two preambles stack; see
    `_warn_copilot_global_over_project`."""
    cfg = cfg or _copilot_config_dir()
    _warn_copilot_global_over_project(cfg)
    n_agents, n_skills, _n_hooks, mem_status, nb_status, _ = _emit_claude_core(
        theme_name, cfg, cfg / "copilot-instructions.md", "global", out, footprint,
        host="copilot")
    print(f"[geneseed] copilot-global -> {cfg}: {n_agents} agents (.agent.md), "
          f"{n_skills} skills, copilot-instructions.md, {mem_status}, {nb_status}. "
          f"No settings.json/hooks (Copilot has no hook mechanism — memory rides the "
          f"preamble's instructions); MCP servers go in mcp-config.json.")


def emit_copilot(theme_name: str, out: Path, root: Path | None = None,
                 footprint: str = "full") -> None:
    """Per-repo Copilot install: AGENTS.md at the repo root (auto-loaded by the Copilot
    CLI, coding agent and VS Code agent mode; carries the preamble) + a `.github/` layer
    (agents/<name>.agent.md, skills/, both Copilot-native discovery paths). `.github/`
    is the repo's SHARED config dir — the manifest + claim-on-create machinery is what
    makes writing there safe (a user's own workflows/agents/skills are never clobbered,
    and uninstall removes only manifest-owned files). No settings.json or hooks.
    `out`/`root` mirror emit_claude."""
    root = root or out
    cfg = root / ".github"
    n_agents, n_skills, _n_hooks, mem_status, nb_status, _ = _emit_claude_core(
        theme_name, cfg, root / "AGENTS.md", "project", out, footprint, host="copilot")
    print(f"[geneseed] copilot (folder) -> {root}: AGENTS.md + .github/ "
          f"({n_agents} agents (.agent.md), {n_skills} skills), {mem_status}, "
          f"{nb_status}. No settings.json/hooks (Copilot has none).")


# The host registry — the single source of truth shared by build dispatch and the
# install-detection/activation layer (rituals/_harness_mcp.py). Bounded to the four
# hosts that exist (YAGNI): each row is the data those layers need to stop hardcoding
# ".opencode"/"AGENT.md"/"opencode.json". wire/unwire are NOT here — their signatures
# differ per host (opencode.json `instructions` splice vs settings.json hook merge), so
# the activation layer dispatches them with a small host branch rather than forcing a
# uniform-but-dishonest callable.
HOSTS = {
    "opencode": {
        "config_dir": _opencode_config_dir,
        "config_file": "opencode.json",
        "project_marker": ".opencode",
        "agent_file": "AGENT.md",
        "emit_global": emit_opencode_global,
    },
    "claude": {
        "config_dir": _claude_config_dir,
        "config_file": "settings.json",
        "project_marker": ".claude",
        "agent_file": "CLAUDE.md",
        "emit_global": emit_claude_global,
    },
    "bob": {
        "config_dir": _bob_config_dir,
        "config_file": "settings.json",
        "project_marker": ".bob",
        "agent_file": "AGENTS.md",
        "emit_global": emit_bob_global,
    },
    "copilot": {
        "config_dir": _copilot_config_dir,
        "config_file": "mcp-config.json",
        "project_marker": ".github",
        "agent_file": "AGENTS.md",
        "emit_global": emit_copilot_global,
    },
}


