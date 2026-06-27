"""Geneseed harness — MCP-server presets/state and the manifest-tracked uninstall.

Part of the harness CLI (see harness.py). Imports the shared toolset from
_harness_core; cross-submodule names are linked at import time by harness.py,
so this file is only ever used through `import harness`."""
from __future__ import annotations

from _harness_core import *  # noqa: F401,F403  shared stdlib + primitives



def _unmerge_opencode_json(path: Path, entry: str) -> bool:
    """Remove `entry` from the OpenCode config's `instructions`, leaving every other
    key intact. Resolves a sibling `opencode.jsonc` first (the file OpenCode treats as
    authoritative) and reads it comment-tolerantly. Returns True if the file was
    changed. A commented `.jsonc` is NOT rewritten — that would drop the comments — so
    the user is told to remove the entry by hand and this returns False (unchanged)."""
    target = build._opencode_target(path)
    if not target.exists():
        return False
    try:
        cfg, had_comments = build._read_jsonc(target.read_text(encoding="utf-8"))
    except OSError:
        return False
    if not isinstance(cfg, dict):
        return False
    instr = cfg.get("instructions")
    if not isinstance(instr, list) or entry not in instr:
        return False
    if target.suffix == ".jsonc" and had_comments:
        print(f"[uninstall] {target.name} has comments — not rewriting it. Remove this "
              f"from its \"instructions\" by hand: {json.dumps(entry)}")
        return False
    cfg["instructions"] = [i for i in instr if i != entry]
    target.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    return True


# ---- MCP servers (OpenCode) -------------------------------------------------
# Known, ready-to-wire MCP server presets the TUI can toggle into an opencode.json.
# Each `block` is written verbatim under the config's `mcp` key. Registering a server
# only points OpenCode at a command — the user still installs the tool itself (the
# harness never installs a converter silently; see SETUP.md → "MarkItDown via MCP").
_MCP_PRESETS = {
    "markitdown": {
        "label": "MarkItDown",
        "desc": "PDF / Office / HTML -> Markdown for the ingest skill. Runs via `uvx` "
                "(needs uv; zero-install, fetches on first call). No uv? Switch the command "
                "to [\"markitdown-mcp\"] after `pipx install markitdown-mcp`. Exposes one "
                "tool: convert_to_markdown(uri).",
        "block": {"type": "local", "command": ["uvx", "markitdown-mcp"], "enabled": True},
    },
    "gitlab": {
        "label": "GitLab",
        "desc": "GitLab repo / MR / issue / CI tools via @zereight/mcp-gitlab (npx, no "
                "install). Edit GITLAB_PERSONAL_ACCESS_TOKEN (scopes: api, read_repository) "
                "and GITLAB_API_URL before use. Add a second entry (gitlab-2) for another "
                "instance.",
        "block": {"type": "local",
                  "command": ["npx", "-y", "@zereight/mcp-gitlab"],
                  "environment": {"GITLAB_PERSONAL_ACCESS_TOKEN": "",
                                  "GITLAB_API_URL": "https://gitlab.com/api/v4"},
                  "enabled": True},
    },
    "gitlab-2": {
        "label": "GitLab (2nd instance)",
        "desc": "A second GitLab instance (e.g. a self-hosted server) via the same "
                "@zereight/mcp-gitlab command. Point GITLAB_API_URL at the other instance "
                "and give it that instance's own token.",
        "block": {"type": "local",
                  "command": ["npx", "-y", "@zereight/mcp-gitlab"],
                  "environment": {"GITLAB_PERSONAL_ACCESS_TOKEN": "",
                                  "GITLAB_API_URL": "https://gitlab.example.com/api/v4"},
                  "enabled": True},
    },
    "filesystem": {
        "label": "Filesystem",
        "desc": "Read/write files under explicitly allowed directories via "
                "@modelcontextprotocol/server-filesystem (npx, no install). Replace the "
                "trailing path arg(s) with only the dir(s) the agent may touch "
                "(least-privilege).",
        "block": {"type": "local",
                  "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem",
                              "/path/to/allowed/dir"],
                  "enabled": True},
    },
}


def _mcp_servers_key(host: str) -> str:
    """The config key holding the server map for `host`: OpenCode nests servers under
    `mcp`, Claude Code and IBM Bob under `mcpServers`."""
    return "mcpServers" if host in ("claude", "bob") else "mcp"


def _mcp_preset_block(name: str, host: str = "opencode") -> dict:
    """The server block to WRITE for preset `name`, shaped for `host`. OpenCode takes the
    preset block verbatim (`type` / `command`-list / `environment` / `enabled`). Claude
    splits the command list into `command` (head) + `args` (tail), renames
    `environment` → `env`, and drops the `type` / `enabled` keys it has no concept of —
    matching SETUP.md's `.mcp.json` shape."""
    block = dict(_MCP_PRESETS[name]["block"])
    if host not in ("claude", "bob"):   # Bob shares Claude's command/args + env shape
        return block
    cmd = list(block.get("command") or [])
    out: dict = {"command": cmd[0] if cmd else "", "args": cmd[1:]}
    env = block.get("environment")
    if env:
        out["env"] = dict(env)
    return out


def _mcp_apply(config: dict, name: str, block: "dict | None", host: str = "opencode") -> dict:
    """Pure: return a copy of `config` with MCP server `name` set to `block`, or removed
    when `block` is None. Never touches another key; drops an emptied servers map.
    Host-aware: OpenCode keeps servers under `mcp` and stamps a `$schema` onto a freshly
    created file; Claude keeps them under `mcpServers` and adds no schema."""
    cfg = dict(config)
    key = _mcp_servers_key(host)
    if host == "opencode":
        cfg.setdefault("$schema", "https://opencode.ai/config.json")
    servers = dict(cfg.get(key) or {})
    if block is None:
        servers.pop(name, None)
    else:
        servers[name] = block
    if servers:
        cfg[key] = servers
    else:
        cfg.pop(key, None)
    return cfg


def _mcp_state(config: dict, name: str, host: str = "opencode") -> str:
    """'enabled' | 'disabled' | 'absent' for server `name`. OpenCode: a present server
    with no explicit `enabled` key counts as enabled (its default), `enabled: false` is
    'disabled'. Claude `.mcp.json` has no per-server enabled flag, so a present server is
    always 'enabled' and 'disabled' never occurs — toggling off removes the entry."""
    server = (config.get(_mcp_servers_key(host)) or {}).get(name)
    if not isinstance(server, dict):
        return "absent"
    if host in ("claude", "bob"):   # flag-less mcpServers: present == enabled
        return "enabled"
    return "enabled" if server.get("enabled", True) else "disabled"


def _mcp_set_enabled(config: dict, name: str, enabled: bool, host: str = "opencode") -> dict:
    """Pure: flip a present server's enabled-ness. OpenCode toggles its `enabled` flag.
    Claude has no such flag, so enabling is a no-op (presence == enabled) and disabling
    removes the entry. No-op when the server is absent."""
    server = (config.get(_mcp_servers_key(host)) or {}).get(name)
    if not isinstance(server, dict):
        return config
    if host in ("claude", "bob"):   # no enabled flag: enable is a no-op, disable removes
        return config if enabled else _mcp_apply(config, name, None, host)
    block = dict(server)
    block["enabled"] = enabled
    return _mcp_apply(config, name, block, host)


def _mcp_load(path: Path, host: str = "opencode") -> dict:
    """Read an MCP config into a dict; {} if missing or malformed. OpenCode is parsed
    comment-tolerantly (a hand-maintained `opencode.jsonc` carries `//` and `/* */`).
    Claude configs (`.mcp.json`, `~/.claude.json`) are STRICT JSON — machine-written, no
    comments — and are parsed with `json.loads`: the comment-stripper's trailing-comma
    pass is not string-aware and would silently drop a comma from any string value
    containing `,]` or `, }`, corrupting unrelated data (a `~/.claude.json` holds projects
    and history far beyond MCP). The catalog/TUI callers pass no host and keep the
    OpenCode-tolerant behaviour."""
    if not path.exists():
        return {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}
    if host == "claude":
        try:
            data = json.loads(text)
        except ValueError:                 # JSONDecodeError ⊂ ValueError
            return {}
        return data if isinstance(data, dict) else {}
    data, _ = build._read_jsonc(text)
    return data if isinstance(data, dict) else {}


def _mcp_commented(path: Path) -> bool:
    """True when `path` is an existing `.jsonc` that carries comments — the case where
    a non-destructive rewrite would drop the user's comments, so the MCP screen must
    refuse to save and warn instead."""
    if path.suffix != ".jsonc" or not path.exists():
        return False
    try:
        _, had = build._read_jsonc(path.read_text(encoding="utf-8"))
        return had
    except OSError:
        return False


def _mcp_save(path: Path, config: dict) -> None:
    """Write `config` back as pretty JSON (the same shape build.py emits), ATOMICALLY:
    serialise to a sibling temp file, then os.replace it into place. A plain truncate-then-
    write leaves the file empty/partial if the process is killed or the disk fills mid-write
    — survivable for a small opencode.json, ruinous for the large ~/.claude.json, which
    holds projects/history. The rename is atomic on the same filesystem (same dir guarantees
    it), so a reader/crash sees either the whole old file or the whole new one."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _mcp_targets() -> "list[tuple[str, Path]]":
    """Candidate OpenCode config files to manage, most-local first: the current
    project's, then OpenCode's global config dir. Each resolves to a present sibling
    `opencode.jsonc` (the file OpenCode treats as authoritative) when one exists, else
    `opencode.json`. Both targets are offered whether or not they exist yet — choosing
    one creates the `.json` on first write."""
    targets = [("this project", build._opencode_target(Path.cwd() / "opencode.json"))]
    try:
        targets.append(("global config",
                        build._opencode_target(build._opencode_config_dir() / "opencode.json")))
    except Exception:
        pass
    return targets


def _mcp_config_for(host: str, scope: str, root: Path) -> "Path | None":
    """The MCP config file an install writes its servers into. OpenCode: the
    `opencode.json(c)` under the install root (a present `.jsonc` sibling wins). Claude:
    `<root>/.mcp.json` for a project install, `~/.claude.json` (the user-scope config) for
    the global one. None for a host that carries no MCP wiring."""
    if host == "opencode":
        return build._opencode_target(root / "opencode.json")
    if host == "claude":
        return (root / ".mcp.json") if scope == "project" else (Path.home() / ".claude.json").resolve()
    if host == "bob":
        # Bob keeps MCP under `mcpServers` in its settings.json (bob.ibm.com/docs/ide):
        # <repo>/.bob/settings.json for a project install, ~/.bob/settings.json globally —
        # the same file the emit writes hooks into (the MCP merge only touches mcpServers).
        return (root / ".bob" / "settings.json") if scope == "project" \
            else (build._bob_config_dir() / "settings.json")
    return None


def _mcp_install_targets() -> "list[tuple[str, Path, str, str, Path]]":
    """(label, config_file, host, scope, install_root) for every detected install that can
    carry MCP wiring — both OpenCode and Claude, global and per-repo. The web MCP screen
    filters these to ACTIVE installs and joins each to its harness row by (host,
    install_root); see api_mcp. (The TUI's MCP screen uses the OpenCode-only
    `_mcp_targets` above, which offers both project + global configs regardless of install
    state — a different shape for a different screen.)"""
    out: "list[tuple[str, Path, str, str, Path]]" = []
    for host, scope, root in _install_targets():
        cfg = _mcp_config_for(host, scope, root)
        if cfg is not None:
            out.append((f"{scope} config", cfg, host, scope, root))
    return out


def _mcp_default_target(targets: "list[tuple[str, Path]]") -> int:
    """Pick which target the screen opens on. The strongest signal is which config
    file already exists — that's the one OpenCode actually reads — so if exactly one
    is present, land there (this is what stops edits going to a stray `<cwd>/
    opencode.json` while the user watches the global file). If none or both exist,
    follow the detected install mode: a global install opens on the global config,
    otherwise the project."""
    existing = [i for i, (_l, p) in enumerate(targets) if p.exists()]
    if len(existing) == 1:
        return existing[0]
    prefer = "global config" if (_installed_defaults().get("emit") or "") == \
        "opencode-global" else "this project"
    return next((i for i, (label, _p) in enumerate(targets) if label == prefer), 0)


def _mcp_known_names(config: dict, host: str = "opencode") -> list:
    """Server names to show in the MCP screen: the built-in presets first, then any
    server already present in THIS config that isn't a preset — so user-added servers
    (gitlab, filesystem, …) are visible and manageable, not just the presets. Pure;
    host-aware so it reads the right server map (`mcp` vs `mcpServers`)."""
    names = list(_MCP_PRESETS)
    present = list((config.get(_mcp_servers_key(host)) or {}).keys()) if isinstance(config, dict) else []
    names += [n for n in present if n not in _MCP_PRESETS]
    return names


def _mcp_meta(name: str) -> "tuple[str, str]":
    """(label, description) for a server row: the preset's metadata when known, else the
    bare server name and a generic note (a server discovered in the config, not a
    Harness preset — still toggleable/removable). Pure."""
    p = _MCP_PRESETS.get(name)
    if p:
        return p["label"], p["desc"]
    return name, ("User-defined MCP server (not a Harness preset). It lives in this "
                  "config already — 'e' enables/disables it, Enter removes it.")


def _archive_memory(memory_dir: Path) -> Path:
    """Move a memory store into a timestamped snapshot under a sibling
    `archived-memory/` (created if absent). Memory is NEVER deleted — only set aside,
    so learned facts survive an uninstall and can be restored by copying back.
    Returns the archive path."""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = memory_dir.parent / "archived-memory" / stamp
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(memory_dir), str(dest))
    return dest


def _uninstall_global(target: Path, archive_memory: bool, host: str = "opencode") -> dict:
    """Reverse a global install at `target` using its manifest: remove owned files,
    prune emptied dirs, drop the AGENT.md entry from opencode.json, and delete the
    markers. The memory store is NEVER deleted — kept in place by default, or moved to
    a sibling `archived-memory/<timestamp>/` when archive_memory. Returns a summary
    dict (with `archived` = the archive path, or None). Host-aware: a Claude install is
    reversed by `_claude_uninstall` (no opencode.json — settings.json hooks + the
    CLAUDE.md block instead); IBM Bob rides the same manifest-driven reversal."""
    if host in ("claude", "bob"):
        return _claude_uninstall(target, archive_memory)
    try:
        owned = json.loads((target / build.GLOBAL_MANIFEST).read_text(encoding="utf-8")).get("owned", [])
    except (json.JSONDecodeError, OSError):
        owned = []
    removed = 0
    failed = []
    for rel in owned:
        victim = target / rel
        try:
            if victim.is_file():
                victim.unlink()
                removed += 1
                # Prune now-empty ancestor dirs up to (not including) target. Walking
                # up — not just the immediate parent — clears the nested layout of a
                # vendored skill folder (skills/<name>/references/…, …/.claude-plugin/…)
                # as well as a flat native skill (skills/<name>/SKILL.md).
                d = victim.parent
                while d != target and d.is_dir() and not any(d.iterdir()):
                    d.rmdir()
                    d = d.parent
        except OSError as e:
            failed.append(f"{rel} ({e})")
    if failed:
        # A locked or permission-blocked file survives the uninstall while the
        # manifest below is deleted — name the leftovers so the user can finish
        # the job by hand instead of believing the dir is clean.
        sys.stderr.write("[uninstall] WARN: could not remove "
                         f"{len(failed)} owned file(s): {', '.join(failed)}\n")
    for d in ("agents", "skills", "plugins"):
        p = target / d
        try:
            if p.is_dir() and not any(p.iterdir()):
                p.rmdir()
        except OSError:
            pass
    unmerged = _unmerge_opencode_json(target / "opencode.json", (target / "AGENT.md").as_posix())
    for m in (build.GLOBAL_MANIFEST, ".geneseed-theme", ".geneseed-emit", build.VERSION_MARKER):
        try:
            (target / m).unlink()
        except OSError:
            pass
    archived = None
    if archive_memory and (target / "memory").is_dir():
        archived = _archive_memory(target / "memory")
    return {"removed": removed, "unmerged": unmerged, "archived": archived}


def cmd_uninstall(args: argparse.Namespace) -> int:
    """Remove a global Geneseed install (the manifest-tracked opencode-global one):
    its owned files, the opencode.json instructions entry, and the markers. The
    memory store is NEVER deleted — kept in place by default, or moved aside to a
    sibling `archived-memory/<timestamp>/` with --archive-memory. Per-repo `.opencode/`
    installs have no manifest — remove those manually (`rm -rf .opencode`, drop
    AGENT.md from opencode.json)."""
    target = Path(args.target).expanduser().resolve() if args.target else build._opencode_config_dir()
    if not (target / build.GLOBAL_MANIFEST).exists():
        sys.stderr.write(
            f"[uninstall] no global Geneseed install at {target} (no {build.GLOBAL_MANIFEST}).\n"
            f"[uninstall] per-repo installs: rm -rf .opencode and drop AGENT.md from "
            f"opencode.json's instructions.\n")
        return 1
    host = "claude" if _manifest_is_claude(target) else "opencode"
    has_memory = (target / "memory").is_dir()
    print(f"[uninstall] target: {target} ({host})")
    if host == "claude":
        print("[uninstall] removes: agents/, skills/, markers, the CLAUDE.md block, and "
              "Geneseed's settings.json hooks (your own keys/hooks are kept).")
    else:
        print("[uninstall] removes: AGENT.md, agents/, skills/, plugins/, markers, and the "
              "opencode.json instructions entry.")
    if has_memory:
        print("[uninstall] memory: " + ("will be ARCHIVED to archived-memory/ (never deleted)"
                                         if args.archive_memory
                                         else "KEPT in place — pass --archive-memory to set it aside"))
    if not args.yes:
        if not sys.stdin.isatty():
            sys.stderr.write("[uninstall] refusing to proceed without --yes (non-interactive).\n")
            return 1
        if not _confirm("Proceed with uninstall?", False):
            print("[uninstall] cancelled — nothing removed.")
            return 0
    s = _uninstall_global(target, args.archive_memory, host)
    mem = f"archived -> {s['archived']}" if s["archived"] else "kept in place"
    cfgfile = "settings.json" if host == "claude" else "opencode.json"
    print(f"[uninstall] done — removed {s['removed']} file(s); {cfgfile} "
          f"{'updated' if s['unmerged'] else 'unchanged'}; memory {mem}. "
          f"Start a new session to apply.")
    return 0


# ---- Install activation (deactivate / reactivate, non-destructive) ----------
# A whole OpenCode install can be turned OFF without deleting a byte: drop the
# AGENT.md `instructions` entry and MOVE every owned artifact into a sibling
# stash. Reactivate moves the same bytes back and re-adds the entry. The stash
# dir's PRESENCE is the disabled flag; its CONTENTS are the restore source — no
# recorded JSON state to drift from the filesystem. This is the reversible
# sibling of `_uninstall_global`: the same owned-file walk + empty-dir prune, but
# `move` into the stash instead of `unlink`, plus an inverse restore.
DISABLED_STASH = ".geneseed-disabled"   # sibling dir; presence == disabled


# Inverse of _web_actions._EMIT_FOR: a registered root's `.geneseed-emit` marker names
# its emit, which fixes (host, scope) with no stored state to drift.
_EMIT_HOST_SCOPE = {
    "opencode": ("opencode", "project"), "opencode-global": ("opencode", "global"),
    "claude": ("claude", "project"), "claude-global": ("claude", "global"),
    "bob": ("bob", "project"), "bob-global": ("bob", "global"),
}


def _registered_targets() -> "list[tuple[str, str, Path]]":
    """(host, scope, root) for every folder a harness was deployed into, recovered from
    the persistent registry — the installs `_install_targets` can't rediscover because
    they're neither the cwd nor a global config dir. Each root's own `.geneseed-emit`
    marker fixes (host, scope); dead roots are pruned by the registry on read. Empty and
    silent if the registry is unavailable (it's a convenience layer, never required)."""
    try:
        import _install_registry
        roots = _install_registry.roots()
    except Exception:
        return []
    out: "list[tuple[str, str, Path]]" = []
    for root in roots:
        try:
            emit = (root / ".geneseed-emit").read_text(encoding="utf-8").strip()
        except OSError:
            continue
        hs = _EMIT_HOST_SCOPE.get(emit)
        if hs:
            out.append((hs[0], hs[1], root))
    return out


def _install_targets() -> "list[tuple[str, str, Path]]":
    """Every (host, scope, root) an install may live at, most-local first. For each
    host in build.HOSTS: a `global` row (the host's config dir) and a `project` row
    (the cwd) when that host's project marker is present there. Then every folder a
    harness was deployed into outside those (the persistent registry), so the console
    lists installs it can't otherwise rediscover. De-duplicated on the (host,
    resolved-path) PAIR — so a cwd that carries BOTH `.opencode/` and `.claude/` yields
    two independent, correctly-typed rows, a cwd that IS a global config dir never
    doubles its own host's row, and a registered root that's also the cwd/global never
    doubles either."""
    out: "list[tuple[str, str, Path]]" = []
    seen = set()

    def _add(host: str, scope: str, root: Path) -> None:
        # A "project" whose marker dir IS this host's global config dir is the global
        # install seen from its parent (the common case: the daemon's cwd is $HOME, where
        # $HOME/.claude == ~/.claude) — NOT a separate project. Surfacing it would alias
        # the global's files, so toggling/removing one row would hit both. Drop it.
        if scope != "global":
            try:
                spec = build.HOSTS[host]
                if (root / spec["project_marker"]).resolve() == spec["config_dir"]().resolve():
                    return
            except Exception:
                pass
        key = (host, root.resolve())
        if key not in seen:
            seen.add(key); out.append((host, scope, root))

    cwd = Path.cwd()
    for host, spec in build.HOSTS.items():
        if (cwd / spec["project_marker"]).is_dir():
            _add(host, "project", cwd)
    for host, spec in build.HOSTS.items():
        try:
            _add(host, "global", spec["config_dir"]())
        except Exception:
            pass
    for host, scope, root in _registered_targets():
        _add(host, scope, root)
    return out


def _install_kind(root: Path) -> "str | None":
    """Which move strategy applies at `root`, so the engine never guesses from an
    untagged path: 'global' when the global manifest is present, else 'project'
    when a `.opencode/` dir is, else None (no install here). The global manifest is
    a MARKER left in place while disabled, so a 'global' answer here means "this is
    (or was) a global install" — not "the content is live"; `_install_relive` is
    the live-content test the reactivate guard needs."""
    if (root / build.GLOBAL_MANIFEST).exists():
        return "global"
    if (root / ".opencode").is_dir():
        return "project"
    return None


def _stashed_kind(root: Path) -> "str | None":
    """Recover which kind of install a stash holds from its CONTENTS, so reactivate
    can pick the right live-content test without a recorded tag: a project stash
    carries `.opencode/`, a global one carries the moved owned files (AGENT.md,
    agents/, …). None when the stash is empty/missing."""
    stash = root / DISABLED_STASH
    if (stash / ".opencode").is_dir():
        return "project"
    if stash.is_dir() and any(stash.iterdir()):
        return "global"
    return None


def _install_relive(root: Path) -> bool:
    """True when a disabled install's CONTENT was re-created live at `root` (the user
    ran `geneseed build`/`upgrade` while disabled), distinct from leftover markers.
    The reactivate re-emit guard needs this. The live signal is kind-specific: a
    global deactivate MOVES AGENT.md aside (and leaves the manifest marker, so
    `_install_kind` still says 'global'), so a live AGENT.md back at the root means a
    re-emit; a project deactivate leaves AGENT.md in place and moves `.opencode/`, so
    a live `.opencode/` is the signal. We read the stashed kind to choose the right
    test (else a project's untouched AGENT.md would false-positive)."""
    if _stashed_kind(root) == "project":
        return (root / ".opencode").is_dir()
    return (root / "AGENT.md").is_file()


def _install_state(root: Path, host: str = "opencode", scope: str = "global") -> str:
    """'active' | 'disabled' | 'absent' for the install at `root`. Host-aware: the
    OpenCode path is unchanged; Claude dispatches to `_claude_state` (its manifest and
    stash live under a host-specific cfg dir — ~/.claude for global, <repo>/.claude for
    a project install)."""
    if host in ("claude", "bob"):
        return _claude_state(root, scope, host)
    # ponytail: state is just "does the stash dir exist" + "is an install present".
    # No JSON record to keep in sync with the filesystem — the dir IS the record.
    if (root / DISABLED_STASH).is_dir():
        return "disabled"
    return "active" if _install_kind(root) is not None else "absent"


def _move_tree(src: Path, dst: Path) -> None:
    """Move `src` (file or dir) to `dst`, creating parent dirs. Raises (caller
    rolls back) if `dst` already exists — a destination collision must never
    silently overwrite a file the move-list is responsible for restoring."""
    if dst.exists():
        raise FileExistsError(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), str(dst))


def _prune_empty_ancestors(start: Path, stop: Path) -> None:
    """Remove `start` and its now-empty ancestor dirs, climbing up to (not including)
    `stop`. Clears the leftover `skills/<name>/` (and nested vendored-skill) folders a
    move/unlink leaves behind once their file is gone — the same ancestor-climb
    `_uninstall_global` does, so deactivate leaves no empty husks either."""
    d = start
    while d != stop and d.is_dir() and not any(d.iterdir()):
        try:
            d.rmdir()
        except OSError:
            break
        d = d.parent


def _install_move_list(root: Path, kind: str) -> "list[str]":
    """The relative paths to move aside for `kind` at `root`. project: just the
    `.opencode/` dir. global: the manifest `owned` list MINUS `VERSION_MARKER`
    (the only marker in `owned` — markers stay put so theme/emit/version detection
    keeps working while disabled). Every rel is `_within`-guarded against a
    `..`-escaping manifest entry, mirroring `api_restore`."""
    if kind == "project":
        rels = [".opencode"]
    else:
        try:
            owned = json.loads(
                (root / build.GLOBAL_MANIFEST).read_text(encoding="utf-8")).get("owned", [])
        except (json.JSONDecodeError, OSError):
            owned = []
        rels = [r for r in owned if r != build.VERSION_MARKER]
    # Resolve before `_within`, mirroring `api_restore`: `_within` is purely lexical,
    # so a raw `root / "../evil.md"` would pass as "under root". Resolving collapses
    # the `..` first, so a manifest entry escaping the root is rejected.
    rroot = root.resolve()
    return [r for r in rels if r and _within((rroot / r).resolve(), rroot)]


def _install_agent_entry(root: Path, kind: str) -> str:
    """The AGENT.md `instructions` entry to drop / re-add. For a global install the
    emit writes the absolute posix path (mirrors `_uninstall_global`); for a
    per-project install it is the relative `…/AGENT.md` the emit recorded — read it
    back from the live config so a bundle sub-dir layout round-trips, falling back
    to the canonical `AGENT.md`."""
    if kind == "global":
        return (root / "AGENT.md").as_posix()
    cfg = _mcp_load(build._opencode_target(root / "opencode.json"))
    instr = cfg.get("instructions") if isinstance(cfg, dict) else None
    if isinstance(instr, list):
        for e in instr:
            if isinstance(e, str) and not Path(e).is_absolute() \
                    and Path(e).name == "AGENT.md":
                return e
    return "AGENT.md"


def _install_readd_entry(target: Path, entry: str) -> bool:
    """Re-add just the AGENT.md `instructions` entry to `target`, touching nothing
    else. Deliberately a minimal inline re-add rather than `build._merge_opencode_json`,
    whose side effects (adding `permission` + `lsp: true` when absent) would clobber
    values the user may have set since. Mirrors `_unmerge_opencode_json`'s
    comment-tolerant read and its commented-`.jsonc` refusal. Returns True if the
    file was changed."""
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(
            {"$schema": "https://opencode.ai/config.json", "instructions": [entry]},
            indent=2) + "\n", encoding="utf-8")
        return True
    try:
        cfg, had_comments = build._read_jsonc(target.read_text(encoding="utf-8"))
    except OSError:
        return False
    if not isinstance(cfg, dict):
        return False
    instr = cfg.get("instructions")
    if not isinstance(instr, list):
        instr = []
    if entry in instr:
        return False
    if target.suffix == ".jsonc" and had_comments:
        print(f"[activate] {target.name} has comments — not rewriting it. Add this "
              f"to its \"instructions\" by hand: {json.dumps(entry)}")
        return False
    cfg["instructions"] = instr + [entry]
    target.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    return True


def _install_deactivate(root: Path, host: str = "opencode", scope: str = "global") -> dict:
    """Turn the install at `root` OFF without deleting a byte: move every owned
    artifact into `root/DISABLED_STASH/<rel>` and drop the AGENT.md `instructions`
    entry. ALL-OR-NOTHING — a move failure rolls back every move already done and
    leaves the install fully `active`, never half-gutted. Host-aware: Claude has its
    own (manifest-driven) deactivate — see `_claude_deactivate`. IBM Bob rides the same
    Claude-style path (manifest + AGENTS.md block), tagged by host."""
    if host in ("claude", "bob"):
        return _claude_deactivate(root, scope, host)
    if _install_state(root) != "active":
        return {"ok": False, "error": f"install is not active ({_install_state(root)})"}
    kind = _install_kind(root)
    target = build._opencode_target(root / "opencode.json")
    # A commented `.jsonc` can't be rewritten without dropping the user's comments,
    # so refuse and move NOTHING — the same refusal `_unmerge_opencode_json` and the
    # MCP toggle use. (Catch it up front, before any file moves.)
    if _mcp_commented(target):
        return {"ok": False, "error": f"{target.name} has comments — refusing to rewrite "
                f"it. Disable by hand or convert it to plain .json first."}
    stash = root / DISABLED_STASH
    rels = _install_move_list(root, kind)
    done: "list[str]" = []   # rels already moved, for rollback
    for rel in rels:
        src, dst = root / rel, stash / rel
        if not src.exists():
            continue   # a manifest entry already gone — nothing to move, skip
        try:
            _move_tree(src, dst)
            done.append(rel)
        except OSError as e:
            # Roll back every move already done — put each tree back where it was —
            # then report, having touched nothing else. The install stays `active`.
            for r in reversed(done):
                try:
                    shutil.move(str(stash / r), str(root / r))
                except OSError:
                    pass
            shutil.rmtree(stash, ignore_errors=True)
            return {"ok": False, "failed": [f"{rel} ({e})"], "rolled_back": len(done)}
    # ponytail: config edit is the LAST step and the only non-move mutation, so a
    # move failure rolls back cleanly with the instructions entry still intact.
    _unmerge_opencode_json(root / "opencode.json", _install_agent_entry(root, kind))
    # Prune the dirs each moved file emptied — climbing from its parent so a
    # skills/<name>/ husk goes too, not just the top-level skills/. No-op for a project
    # move (its single `.opencode/` entry already went whole).
    for rel in done:
        _prune_empty_ancestors((root / rel).parent, root)
    return {"ok": True, "kind": kind, "moved": len(done)}


def _install_reactivate(root: Path, host: str = "opencode", scope: str = "global") -> dict:
    """Turn a disabled install back ON: move every stashed tree back to its original
    rel path and re-add the AGENT.md `instructions` entry, then remove the empty
    stash. The inverse of `_install_deactivate`. Host-aware: Claude has its own
    reactivate — see `_claude_reactivate`. IBM Bob rides the same Claude-style path."""
    if host in ("claude", "bob"):
        return _claude_reactivate(root, scope, host)
    if _install_state(root) != "disabled":
        return {"ok": False, "error": f"install is not disabled ({_install_state(root)})"}
    stash = root / DISABLED_STASH
    # Re-emit-while-disabled guard: if live content already exists (the user ran
    # `geneseed build`/`upgrade` while disabled), the install is already active.
    # Discard the now-stale snapshot rather than clobber the fresh files, ensure the
    # instructions entry is present, and report it. `_install_relive` (not
    # `_install_kind`) is the live-content test — a global deactivate leaves the
    # manifest marker behind, so `_install_kind` would falsely say 'global' here.
    if _install_relive(root):
        kind = _install_kind(root) or "global"
        shutil.rmtree(stash, ignore_errors=True)
        _install_readd_entry(build._opencode_target(root / "opencode.json"),
                             _install_agent_entry(root, kind))
        return {"ok": True, "note": "install was re-created while disabled; "
                "discarded the stashed snapshot"}
    # Walk the stash for the top-level entries to restore (a project stash holds a
    # single `.opencode/`; a global one holds AGENT.md + agents/ + skills/ + …).
    leftovers: "list[str]" = []
    moved = 0
    for src in sorted(stash.rglob("*")):
        if src.is_dir():
            continue
        rel = src.relative_to(stash)
        dst = root / rel
        if dst.exists():
            # Never delete the stash while anything is unrestored — skip the
            # collision, keep the stash, report the leftover.
            leftovers.append(rel.as_posix())
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        moved += 1
    if leftovers:
        return {"ok": False, "failed": leftovers, "moved": moved}
    # The kind is `project` if a `.opencode/` came back, else `global` (an AGENT.md
    # at the root). Resolve it now that the files are live again.
    kind = _install_kind(root) or "global"
    _install_readd_entry(build._opencode_target(root / "opencode.json"),
                         _install_agent_entry(root, kind))
    # Remove the now-empty stash (its dir tree may linger after the file moves).
    shutil.rmtree(stash, ignore_errors=True)
    return {"ok": True, "kind": kind, "moved": moved}


# ---- Claude install activation (manifest-driven, host-tagged stash) ----------
# Claude installs have NO `instructions` array — the harness reaches Claude via the
# CLAUDE.md managed block (auto-loaded by location) and settings.json hooks. So a Claude
# deactivate (1) stashes the owned agents/skills, (2) excises the CLAUDE.md block —
# stashing its content for an exact restore — and (3) unwires the settings.json hooks
# (the recorded groups only). The stash lives under a host-tagged subdir so a cwd that
# carries BOTH an OpenCode and a Claude project install can disable each independently.

def _claude_cfg(root: Path, scope: str, host: str = "claude") -> Path:
    """The dir holding a Claude-style install's manifest/agents/skills: the config dir for
    a global install (root IS the cfg), <repo>/<marker> for a project install. Host-aware
    so IBM Bob (marker `.bob`) reuses the whole Claude lifecycle — the marker comes from
    build.HOSTS, so the only Bob-vs-Claude difference is which subdir."""
    if scope == "global":
        return root
    marker = build.HOSTS.get(host, {}).get("project_marker", ".claude")
    return root / marker


def _clean_host_stash(cfg: Path, host: str = "claude") -> None:
    """Remove a host's stash subdir (DISABLED_STASH/<host>) and the parent
    DISABLED_STASH dir if it is then empty — so 'disabled' never lingers as an empty
    marker, and a same-root other-host stash is left untouched."""
    shutil.rmtree(cfg / DISABLED_STASH / host, ignore_errors=True)
    parent = cfg / DISABLED_STASH
    try:
        if parent.is_dir() and not any(parent.iterdir()):
            parent.rmdir()
    except OSError:
        pass


def _claude_read_manifest(cfg: Path) -> dict:
    try:
        data = json.loads((cfg / build.GLOBAL_MANIFEST).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _manifest_is_claude(cfg: Path) -> bool:
    """True when the manifest at `cfg` was written by a Claude emit (it records a
    `managed.claude_md`). Lets cmd_uninstall pick the right reversal without a flag."""
    mg = _claude_read_manifest(cfg).get("managed")
    return isinstance(mg, dict) and "claude_md" in mg


def _claude_state(root: Path, scope: str = "global", host: str = "claude") -> str:
    """'active' | 'disabled' | 'absent' for the Claude-style install rooted at `root`
    (Claude or IBM Bob — the stash is tagged by host)."""
    cfg = _claude_cfg(root, scope, host)
    if (cfg / DISABLED_STASH / host).is_dir():
        return "disabled"
    return "active" if (cfg / build.GLOBAL_MANIFEST).exists() else "absent"


def _claude_md_path(cfg: Path, managed: dict) -> Path:
    """The CLAUDE.md the manifest's `managed.claude_md.rel` points at (relative to cfg —
    "../CLAUDE.md" for a project install). Falls back to <cfg>/CLAUDE.md."""
    rel = ((managed.get("claude_md") or {}).get("rel")) or "CLAUDE.md"
    return (cfg / rel).resolve()


def _claude_deactivate(root: Path, scope: str = "global", host: str = "claude") -> dict:
    cfg = _claude_cfg(root, scope, host)
    if _claude_state(root, scope, host) != "active":
        return {"ok": False, "error": f"install is not active ({_claude_state(root, scope, host)})"}
    man = _claude_read_manifest(cfg)
    managed = man.get("managed") if isinstance(man.get("managed"), dict) else {}
    stash = cfg / DISABLED_STASH / host
    rroot = cfg.resolve()
    rels = [r for r in man.get("owned", []) if r and r != build.VERSION_MARKER
            and _within((rroot / r).resolve(), rroot)]
    done: "list[str]" = []
    for rel in rels:
        src, dst = cfg / rel, stash / rel
        if not src.exists():
            continue
        try:
            _move_tree(src, dst)
            done.append(rel)
        except OSError as e:
            for r in reversed(done):
                try:
                    shutil.move(str(stash / r), str(cfg / r))
                except OSError:
                    pass
            _clean_host_stash(cfg, host)
            return {"ok": False, "failed": [f"{rel} ({e})"], "rolled_back": len(done)}
    # Unwire the settings.json hooks (exact recorded groups only) — the user's own
    # keys/hooks are untouched.
    build._unwire_claude_settings(cfg / "settings.json", managed.get("settings_hooks", []))
    build._unwire_claude_excludes(cfg / "settings.json", managed.get("settings_excludes", []))
    # Excise the CLAUDE.md block, stashing its content for an exact restore.
    cm = _claude_md_path(cfg, managed)
    block = build._managed_block_read(cm)
    stash.mkdir(parents=True, exist_ok=True)   # presence == disabled, even if nothing moved
    if block is not None:
        (stash / "_claude_md_block.txt").write_text(block, encoding="utf-8")
        build._managed_block_remove(cm, whole=bool((managed.get("claude_md") or {}).get("whole")))
    # Prune the dirs each moved file emptied — climbs so skills/<name>/ husks go too.
    for rel in done:
        _prune_empty_ancestors((cfg / rel).parent, cfg)
    return {"ok": True, "kind": host, "moved": len(done)}


def _claude_reactivate(root: Path, scope: str = "global", host: str = "claude") -> dict:
    cfg = _claude_cfg(root, scope, host)
    if _claude_state(root, scope, host) != "disabled":
        return {"ok": False, "error": f"install is not disabled ({_claude_state(root, scope, host)})"}
    stash = cfg / DISABLED_STASH / host
    block_file = stash / "_claude_md_block.txt"
    # Re-emit-while-disabled guard (mirrors _install_reactivate's _install_relive): if
    # the harness was rebuilt live while disabled, the CLAUDE.md block is back and the
    # manifest is fresh — discard the stale stash rather than collide with the new files.
    relive_managed = _claude_read_manifest(cfg).get("managed") or {}
    if build._managed_block_read(_claude_md_path(cfg, relive_managed)) is not None:
        build._merge_claude_settings(cfg / "settings.json")   # ensure hooks are present
        _clean_host_stash(cfg, host)
        return {"ok": True, "note": "install was re-created while disabled; "
                "discarded the stashed snapshot"}
    leftovers: "list[str]" = []
    moved = 0
    for src in sorted(stash.rglob("*")):
        if src.is_dir():
            continue
        rel = src.relative_to(stash)
        if rel.as_posix() == "_claude_md_block.txt":
            continue   # restored separately, below
        dst = cfg / rel
        if dst.exists():
            leftovers.append(rel.as_posix())
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        moved += 1
    if leftovers:
        return {"ok": False, "failed": leftovers, "moved": moved}
    # Re-wire: re-merge the hooks (idempotent) and re-insert the CLAUDE.md block.
    build._merge_claude_settings(cfg / "settings.json")
    managed = _claude_read_manifest(cfg).get("managed") or {}
    build._wire_claude_excludes(cfg / "settings.json", managed.get("settings_excludes", []))
    if block_file.exists():
        build._managed_block_write(_claude_md_path(cfg, managed),
                                   block_file.read_text(encoding="utf-8"))
    _clean_host_stash(cfg, host)
    return {"ok": True, "kind": host, "moved": moved}


def _claude_uninstall(cfg: Path, archive_memory: bool) -> dict:
    """Reverse a Claude install at `cfg` via its manifest: remove owned files, unwire
    the settings.json hooks, excise/delete the CLAUDE.md block, drop the markers. The
    memory store is NEVER deleted (kept, or archived). Mirrors `_uninstall_global`."""
    man = _claude_read_manifest(cfg)
    managed = man.get("managed") if isinstance(man.get("managed"), dict) else {}
    removed, failed = 0, []
    for rel in man.get("owned", []):
        victim = cfg / rel
        try:
            if victim.is_file():
                victim.unlink()
                removed += 1
                d = victim.parent
                while d != cfg and d.is_dir() and not any(d.iterdir()):
                    d.rmdir(); d = d.parent
        except OSError as e:
            failed.append(f"{rel} ({e})")
    if failed:
        sys.stderr.write("[uninstall] WARN: could not remove "
                         f"{len(failed)} owned file(s): {', '.join(failed)}\n")
    hooks = managed.get("settings_hooks", [])
    build._unwire_claude_settings(cfg / "settings.json", hooks)
    build._unwire_claude_excludes(cfg / "settings.json", managed.get("settings_excludes", []))
    build._managed_block_remove(_claude_md_path(cfg, managed),
                                whole=bool((managed.get("claude_md") or {}).get("whole")))
    for m in (build.GLOBAL_MANIFEST, ".geneseed-theme", ".geneseed-emit", build.VERSION_MARKER):
        try:
            (cfg / m).unlink()
        except OSError:
            pass
    archived = None
    if archive_memory and (cfg / "memory").is_dir():
        archived = _archive_memory(cfg / "memory")
    return {"removed": removed, "unmerged": bool(hooks), "archived": archived}


# ---- Folder-install removal (the destructive sibling of deactivate) ----------
# Deactivate moves a deployed harness aside (reversible); REMOVE deletes it for good and
# de-lists it. Reuses the per-host reversal cmd_uninstall already drives, then clears the
# ROOT registry markers so `_install_registry.roots()` self-prunes the row (a project
# install keeps `.geneseed-emit` at the repo root, OUTSIDE the per-host cfg). Memory and
# notebook are runtime stores — NEVER removed by the file deletion itself, so the default
# 'keep' can't lose a learned fact; the caller opts into archive/delete explicitly.

def _install_data_dir(root: Path, host: str = "opencode", scope: str = "global") -> Path:
    """The dir holding an install's manifest + memory/notebook stores: <root>/<marker>
    for a Claude/Bob PROJECT install, else `root`. Mirrors _web_actions._view_cfg, kept
    here too so the uninstall path carries no web dependency."""
    if scope == "project" and host in ("claude", "bob"):
        return root / build.HOSTS[host]["project_marker"]
    return root


def _archive_store(store: Path) -> Path:
    """Move a runtime store (memory/ or notebook/) aside to a sibling
    `archived-<name>/<timestamp>/` — the generic form of _archive_memory, so a 'set aside,
    never delete' covers the notebook too. Returns the archive path."""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = store.parent / f"archived-{store.name}" / stamp
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(store), str(dest))
    return dest


def _opencode_project_uninstall(root: Path) -> dict:
    """Reverse a per-repo OpenCode emit at `root` (which carries no manifest): delete the
    fully-owned layers — `.opencode/` plus the bundle dirs the build WIPES every run
    (laws/agents/skills; folder names are always neutral, never themed) and AGENT.md — and
    drop the opencode.json `instructions` entry. memory/ + notebook/ and the user-owned
    stubs (context.json, wiki.jsonc, .gitignore) are left for the caller / kept as data.
    # ponytail: the deploy itself clobbers laws/agents/skills (build() rmtrees them each
    # run), so removing them here is the exact inverse — not a guess at user files. If a
    # repo ever needs them preserved through an uninstall, give the project emit a manifest."""
    entry = _install_agent_entry(root, "project")   # read the wire BEFORE deleting AGENT.md
    removed = 0
    for d in (".opencode", "laws", "agents", "skills"):
        p = root / d
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
            removed += 1
    am = root / "AGENT.md"
    if am.is_file():
        try:
            am.unlink(); removed += 1
        except OSError:
            pass
    unmerged = _unmerge_opencode_json(root / "opencode.json", entry)
    return {"removed": removed, "unmerged": unmerged, "archived": None}


def _install_uninstall(root: Path, host: str = "opencode", scope: str = "global",
                       memory: str = "keep") -> dict:
    """Permanently REMOVE the install at `root` — owned files, config wiring, markers —
    then de-list it. The destructive sibling of `_install_deactivate`. `memory` ∈
    {keep, archive, delete} governs the memory/ + notebook/ runtime stores only. Every op
    is best-effort and idempotent, so a partly-removed install can simply be retried."""
    if memory not in ("keep", "archive", "delete"):
        memory = "keep"
    if _install_state(root, host, scope) == "absent":
        return {"ok": False, "error": "nothing installed here"}
    data = _install_data_dir(root, host, scope)
    # 1. Delete the harness files via the matching per-host reversal, then drop any
    #    disabled-state stash (its bytes are this install's, removed with it).
    if host in ("claude", "bob"):
        summary = _claude_uninstall(data, archive_memory=False)
        shutil.rmtree(data / DISABLED_STASH / host, ignore_errors=True)
    elif _install_kind(root) == "global":
        summary = _uninstall_global(root, False, "opencode")
        shutil.rmtree(root / DISABLED_STASH, ignore_errors=True)
    else:
        summary = _opencode_project_uninstall(root)
        shutil.rmtree(root / DISABLED_STASH, ignore_errors=True)
    # 2. Memory + notebook disposition (independent of the owned-file removal above).
    archived: "list[str]" = []
    for name in ("memory", "notebook"):
        store = data / name
        if not store.is_dir():
            continue
        if memory == "archive":
            archived.append(str(_archive_store(store)))
        elif memory == "delete":
            shutil.rmtree(store, ignore_errors=True)
    # 3. Clear the ROOT registry markers so the registry self-prunes this row. Done for
    #    every scope: harmless where the reversal already removed them, essential for a
    #    project install (its markers live at the repo root, not under cfg).
    for m in (".geneseed-emit", ".geneseed-theme", build.VERSION_MARKER):
        try:
            (root / m).unlink()
        except OSError:
            pass
    # 4. Tidy an emptied marker dir (.claude/.bob) so no husk lingers in the repo.
    if data != root and data.is_dir() and not any(data.iterdir()):
        try:
            data.rmdir()
        except OSError:
            pass
    out = {"ok": True, "removed": summary.get("removed", 0), "memory": memory}
    if archived:
        out["archived"] = archived
    return out
