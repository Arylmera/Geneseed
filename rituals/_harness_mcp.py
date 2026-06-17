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


def _mcp_apply(config: dict, name: str, block: "dict | None") -> dict:
    """Pure: return a copy of `config` with MCP server `name` set to `block`, or
    removed when `block` is None. Never touches another key; drops an emptied `mcp`
    map; keeps `$schema` so a freshly created file is valid."""
    cfg = dict(config)
    cfg.setdefault("$schema", "https://opencode.ai/config.json")
    servers = dict(cfg.get("mcp") or {})
    if block is None:
        servers.pop(name, None)
    else:
        servers[name] = block
    if servers:
        cfg["mcp"] = servers
    else:
        cfg.pop("mcp", None)
    return cfg


def _mcp_state(config: dict, name: str) -> str:
    """'enabled' | 'disabled' | 'absent' for server `name`. A server with no explicit
    `enabled` key counts as enabled (OpenCode's default)."""
    server = (config.get("mcp") or {}).get(name)
    if not isinstance(server, dict):
        return "absent"
    return "enabled" if server.get("enabled", True) else "disabled"


def _mcp_set_enabled(config: dict, name: str, enabled: bool) -> dict:
    """Pure: flip a present server's `enabled` flag. No-op when the server is absent."""
    server = (config.get("mcp") or {}).get(name)
    if not isinstance(server, dict):
        return config
    block = dict(server)
    block["enabled"] = enabled
    return _mcp_apply(config, name, block)


def _mcp_load(path: Path) -> dict:
    """Read an OpenCode config into a dict; {} if missing or malformed. Comment-tolerant
    so a hand-maintained `opencode.jsonc` parses (its `//` and `/* */` are stripped)."""
    if not path.exists():
        return {}
    try:
        data, _ = build._read_jsonc(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except OSError:
        return {}


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
    """Write `config` back as pretty JSON (the same shape build.py emits)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


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


def _mcp_known_names(config: dict) -> list:
    """Server names to show in the MCP screen: the built-in presets first, then any
    server already present in THIS config that isn't a preset — so user-added servers
    (gitlab, filesystem, …) are visible and manageable, not just the presets. Pure."""
    names = list(_MCP_PRESETS)
    present = list((config.get("mcp") or {}).keys()) if isinstance(config, dict) else []
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


def _uninstall_global(target: Path, archive_memory: bool) -> dict:
    """Reverse a global install at `target` using its manifest: remove owned files,
    prune emptied dirs, drop the AGENT.md entry from opencode.json, and delete the
    markers. The memory store is NEVER deleted — kept in place by default, or moved to
    a sibling `archived-memory/<timestamp>/` when archive_memory. Returns a summary
    dict (with `archived` = the archive path, or None)."""
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
    has_memory = (target / "memory").is_dir()
    print(f"[uninstall] target: {target}")
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
    s = _uninstall_global(target, args.archive_memory)
    mem = f"archived -> {s['archived']}" if s["archived"] else "kept in place"
    print(f"[uninstall] done — removed {s['removed']} file(s); opencode.json "
          f"{'updated' if s['unmerged'] else 'unchanged'}; memory {mem}. "
          f"Start a new OpenCode session to apply.")
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


def _install_targets() -> "list[tuple[str, Path]]":
    """Roots that may carry a Geneseed install, most-local first: this project's
    root, then OpenCode's global config dir. De-duplicated when cwd IS the global
    config dir (else both rows would point at one root and collide)."""
    cands = [("this project", Path.cwd())]
    try:
        cands.append(("global config", build._opencode_config_dir()))
    except Exception:
        pass
    seen, out = set(), []
    for label, root in cands:
        if root.resolve() not in seen:
            seen.add(root.resolve()); out.append((label, root))
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


def _install_state(root: Path) -> str:
    """'active' | 'disabled' | 'absent' for the install at `root`."""
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


def _install_deactivate(root: Path) -> dict:
    """Turn the install at `root` OFF without deleting a byte: move every owned
    artifact into `root/DISABLED_STASH/<rel>` and drop the AGENT.md `instructions`
    entry. ALL-OR-NOTHING — a move failure rolls back every move already done and
    leaves the install fully `active`, never half-gutted."""
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
    # Prune emptied owned dirs the global walk left behind (the `_uninstall_global`
    # ancestor-climb, not a destructive rmtree). No-op for a project move (its single
    # `.opencode/` entry already went whole).
    for d in ("agents", "skills", "plugins", "workflows", "command"):
        p = root / d
        try:
            if p.is_dir() and not any(p.iterdir()):
                p.rmdir()
        except OSError:
            pass
    return {"ok": True, "kind": kind, "moved": len(done)}


def _install_reactivate(root: Path) -> dict:
    """Turn a disabled install back ON: move every stashed tree back to its original
    rel path and re-add the AGENT.md `instructions` entry, then remove the empty
    stash. The inverse of `_install_deactivate`."""
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
