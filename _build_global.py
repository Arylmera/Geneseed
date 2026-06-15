"""Geneseed build — the global OpenCode emit: config-dir resolution, the install
manifest, global memory/notebook seeding, emit_opencode_global.

Part of the build CLI (see build.py). Imports the shared toolset from _build_core."""
from __future__ import annotations

from _build_core import *  # noqa: F401,F403  shared stdlib + constants


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


def emit_opencode_global(theme_name: str, out: Path | None = None, cfg: Path | None = None) -> None:
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

    n_plugins = _copy_plugins(cfg / "plugins", owned)
    n_workflows = _copy_workflows(cfg / "workflows", owned)

    mem_status = _global_memory(cfg, theme, items, out)
    ensure_memory_index(cfg / "memory")   # guarantee the index on every path (seed/migrate/keep)
    nb_status = _global_notebook(cfg, theme, items, out)
    ensure_notebook_index(cfg / "notebook")   # guarantee the index on every path (seed/migrate/keep)
    ensure_wiki_stub(cfg)   # machine-level wiki.jsonc — seeded once, user-owned, never in the manifest

    write_version(cfg)
    owned.append(VERSION_MARKER)
    cfg_name = _merge_opencode_json(cfg / "opencode.json", (cfg / "AGENT.md").as_posix()).name

    # Now that the whole current set is on disk, remove only what we owned before but
    # no longer produce (a removed agent/skill, a disabled primary/command). Everything
    # current was just (over)written above, so a live file is never momentarily absent.
    prune_failed = []
    for relp in sorted(set(old_owned) - set(owned)):
        victim = cfg / relp
        try:
            if victim.is_file():
                victim.unlink()
                if victim.name == "SKILL.md" and victim.parent != cfg \
                        and not any(victim.parent.iterdir()):
                    victim.parent.rmdir()
        except OSError as e:
            prune_failed.append(f"{relp} ({e})")
    if prune_failed:
        # A locked/permission-blocked file stays on disk but is no longer in the
        # manifest — name it so the user can remove it by hand.
        print("[geneseed] WARN: could not remove stale owned file(s): "
              + ", ".join(prune_failed), file=sys.stderr)

    manifest_path.write_text(
        json.dumps({"_comment": "Files owned by Geneseed's --emit opencode-global. "
                                "Do not edit; removed on re-emit. The memory and notebook "
                                "stores are NOT listed — they are never deleted.", "owned": sorted(owned)},
                   indent=2) + "\n", encoding="utf-8")

    extras = (["primary agent"] if primary else []) + ([f"{len(commands)} command(s)"] if commands else [])
    extra = (" + " + ", ".join(extras)) if extras else ""
    print(f"[geneseed] opencode-global -> {cfg}: {n_agents} subagents, {n_skills} skills, "
          f"{n_plugins} plugin(s), {n_workflows} workflow file(s), AGENT.md, {mem_status}, {nb_status}, "
          f"{cfg_name} (no context.json){extra}. "
          f"The learn plugin now finds <cfg>/memory automatically; set GENESEED_HARNESS only to override.")


